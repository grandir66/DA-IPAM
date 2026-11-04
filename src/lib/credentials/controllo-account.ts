/**
 * Controllo di cosa può fare un account Windows (piano accesso Windows, Task 8).
 *
 * Riccardo, 04/11/2026: «nell'applicativo deve essere chiaro cosa abilitare per l'utente e cosa abilitare per la sicurezza
 * del dominio». Il controllo mette a confronto il catalogo dei diritti (`diritti.ts`) con ciò che l'account può fare:
 *
 *  - **Gruppi del dominio** (eventi dei DC, DHCP, utente di dominio): si leggono dal DC con l'account dell'integrazione AD,
 *    col filtro ricorsivo `LDAP_MATCHING_RULE_IN_CHAIN` (1.2.840.113556.1.4.1941), perché chi sta dentro un gruppo tramite un
 *    altro gruppo è dentro. I gruppi di sistema si cercano per SID noto (Event Log Readers S-1-5-32-573, Remote Management
 *    Users S-1-5-32-580), non per nome: su un DC in italiano i nomi sono altri. DHCP Administrators non ha un SID noto:
 *    si cerca per nome, e se quel nome sul DC non esiste lo stato è `non_verificato`, non «no».
 *  - **PC e server**: al clic non si prova niente. Lo stato viene dagli esiti già scritti dalle scansioni (nessun logon in
 *    più, nessun tentativo consumato). «2 su 3» conta gli host provati: porte chiuse e budget esaurito non lo sono. `no` solo
 *    con almeno un `diritti_mancanti` e nessun host riuscito; alcuni riusciti e altri con `diritti_mancanti` è `in_parte`
 *    (con «6 su 36» la pagina diceva Sì e «nessun diritto mancante», ed era falso). Firewall, errore o password errata non
 *    dicono se il diritto c'è: `non_verificato` col motivo. Senza esiti: `non_verificato`.
 *  - **Registrazione degli eventi** (GPO di audit): non si verifica da qui, resta `non_verificato`.
 *  - **Password**: si riusa `provaLdapDellaVoce` (solo cifrato, mai un bind in chiaro se StartTLS fallisce; `errata` solo con
 *    prova certa). Con `non_so` si dice «non verificabile» e il controllo continua. Una password `errata` si ricorda per
 *    30 minuti (`RicordoErrate`, lo stesso della scansione): un bind sbagliato a ogni clic porta al blocco dell'account.
 *
 * Mai «no» senza prova: LDAP giù, nessuna integrazione, account che non è del dominio dell'integrazione (account locale),
 * utente non trovato per i gruppi, nome del gruppo assente dal DC → `non_verificato`. Niente nome utente né password nel
 * risultato e nei log: l'account si legge qui e non esce.
 *
 * `db-tenant` si importa solo in modo statico (regola 14 di CLAUDE.md).
 */
import type { Client } from "ldapts";
import { connectLdap } from "@/lib/ad/ad-client";
import {
  getAdIntegrations,
  getCredentialById,
  getCredentialLoginPair,
  getCurrentTenantCode,
  getEsitiAccessoPerVoce,
  type AdIntegration,
  type EsitoAccessoVoce,
} from "@/lib/db-tenant";
import { chiaveAccount, ricordoDelTenant, type RicordoErrate } from "@/lib/scanner/account-windows";
import { provaLdapDellaVoce, utenteDelDominio, type EsitoPassword } from "@/lib/scanner/verifica-password-run";
import { DIRITTI, GRUPPI } from "./diritti";
import type { StradaAccesso } from "./motivi-accesso";

/** `in_parte`: entra su alcuni host e su altri mancano i diritti. Per chi chiede all'IT è un diritto che manca. */
export type StatoDiritto = "si" | "in_parte" | "no" | "non_verificato";

export interface RigaControllo {
  dirittoId: string;
  stato: StatoDiritto;
  /** Su che cosa si fonda lo stato, una riga per chi legge. Mai utente né password. */
  base: string;
}

export interface RisultatoControllo {
  password: EsitoPassword;
  /** ISO-8601 del momento del controllo. */
  controllatoIl: string;
  righe: RigaControllo[];
}

/** La voce non esiste o non è di tipo Windows: la rotta risponde 404. */
export class VoceNonWindows extends Error {
  constructor(messaggio: string) {
    super(messaggio);
    this.name = "VoceNonWindows";
  }
}

export interface DipendenzeControllo {
  password: (credId: number) => Promise<EsitoPassword>;
  integrazione: () => AdIntegration | undefined;
  /** Connessione al DC già autenticata con l'account dell'integrazione. */
  connetti: (integrazione: AdIntegration) => Promise<Client>;
  ricordo: RicordoErrate;
  adesso: () => Date;
  /** Tetto a tutta la lettura dei gruppi: un DC che non risponde non appende la pagina. */
  tettoMs: number;
}

const TETTO_LETTURA_MS = 25_000;
const OID_CATENA = "1.2.840.113556.1.4.1941";
/** Gruppi di sistema con SID noto: uguali su ogni DC, in ogni lingua. */
const SID_EVENT_LOG_READERS = "S-1-5-32-573";
const SID_REMOTE_MANAGEMENT = "S-1-5-32-580";
/** Bit 2 di userAccountControl: account disabilitato. */
const UAC_DISABILITATO = 2;

function integrazionePredefinita(): AdIntegration | undefined {
  return getAdIntegrations().filter((i) => i.enabled === 1).sort((a, b) => a.id - b.id)[0];
}

function dipendenzePredefinite(): DipendenzeControllo {
  return {
    password: (credId) => provaLdapDellaVoce(credId),
    integrazione: integrazionePredefinita,
    connetti: (integrazione) => connectLdap(integrazione),
    ricordo: ricordoDelTenant(getCurrentTenantCode() ?? "DEFAULT"),
    adesso: () => new Date(),
    tettoMs: TETTO_LETTURA_MS,
  };
}

/** Un valore dentro un filtro LDAP (RFC 4515): `\ * ( )` e NUL come sequenze di sfuggita. */
function sfuggi(valore: string): string {
  return valore.replace(/[\\*()\0]/g, (c) => `\\${c.charCodeAt(0).toString(16).padStart(2, "0")}`);
}

/** Il nome SAM dell'utente: `DOM\mario` → mario, `mario@dom.local` → mario. */
function nomeSam(username: string): string {
  const dopoBarra = username.includes("\\") ? username.slice(username.indexOf("\\") + 1) : username;
  const prima = dopoBarra.includes("@") ? dopoBarra.slice(0, dopoBarra.lastIndexOf("@")) : dopoBarra;
  return prima.trim();
}

async function conTetto<T>(lavoro: Promise<T>, tettoMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const scaduto = new Promise<never>((_, rifiuta) => {
    timer = setTimeout(() => rifiuta(new Error("Tetto di lettura del DC superato")), tettoMs);
  });
  try {
    return await Promise.race([lavoro, scaduto]);
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ gruppi */

type IdGruppo = "event_log_readers" | "remote_management" | "dhcp_admin";

interface DefinizioneGruppo {
  nome: string;
  /** Il pezzo di filtro che identifica il gruppo: per SID se noto, per nome altrimenti. */
  filtro: string;
}

const GRUPPI_CERCATI: Readonly<Record<IdGruppo, DefinizioneGruppo>> = {
  event_log_readers: { nome: GRUPPI.lettoriRegistri, filtro: `(objectSid=${SID_EVENT_LOG_READERS})` },
  remote_management: { nome: GRUPPI.gestioneRemota, filtro: `(objectSid=${SID_REMOTE_MANAGEMENT})` },
  dhcp_admin: { nome: GRUPPI.dhcpAdmin, filtro: `(cn=${sfuggi(GRUPPI.dhcpAdmin)})` },
};

/** I gruppi che ogni diritto richiede, tutti insieme. */
const GRUPPI_DEL_DIRITTO: Readonly<Record<string, readonly IdGruppo[]>> = {
  eventi_dc: ["event_log_readers", "remote_management"],
  dhcp: ["dhcp_admin", "remote_management"],
};

type Annuario =
  | { letto: true; utente: "assente" | "presente"; abilitato: boolean; gruppi: Record<IdGruppo, StatoDiritto> }
  | { letto: false; motivo: string };

const MOTIVO_DC_MUTO = "Il controller di dominio non ha risposto: l'appartenenza ai gruppi non si è potuta leggere.";

async function cerca(client: Client, base: string, filtro: string, attributi: string[]): Promise<Array<{ dn: string } & Record<string, unknown>>> {
  const { searchEntries } = await client.search(base, { scope: "sub", filter: filtro, attributes: attributi, sizeLimit: 2 });
  return searchEntries as Array<{ dn: string } & Record<string, unknown>>;
}

/**
 * L'appartenenza ai gruppi dell'utente `dn`: `si` se è dentro (anche per annidamento), `no` solo se il gruppo esiste sul DC e
 * l'utente non c'è dentro, `non_verificato` se il gruppo sul DC non si trova (nome cambiato con la lingua).
 */
async function statoGruppo(client: Client, base: string, g: DefinizioneGruppo, dn: string): Promise<StatoDiritto> {
  const dentro = await cerca(client, base, `(&(objectClass=group)${g.filtro}(member:${OID_CATENA}:=${sfuggi(dn)}))`, ["dn"]);
  if (dentro.length > 0) return "si";
  const esiste = await cerca(client, base, `(&(objectClass=group)${g.filtro})`, ["dn"]);
  return esiste.length > 0 ? "no" : "non_verificato";
}

async function leggiAnnuario(integrazione: AdIntegration, username: string, deps: DipendenzeControllo): Promise<Annuario> {
  let client: Client;
  try {
    client = await conTetto(deps.connetti(integrazione), deps.tettoMs);
  } catch {
    return { letto: false, motivo: MOTIVO_DC_MUTO };
  }
  try {
    return await conTetto(
      (async (): Promise<Annuario> => {
        const base = integrazione.base_dn;
        const utenti = await cerca(client, base, `(&(objectCategory=person)(objectClass=user)(sAMAccountName=${sfuggi(nomeSam(username))}))`, ["dn", "userAccountControl"]);
        if (utenti.length > 1) return { letto: false, motivo: "In Active Directory ci sono più account con questo nome: non si sa quale controllare." };
        const vuoti: Record<IdGruppo, StatoDiritto> = { event_log_readers: "non_verificato", remote_management: "non_verificato", dhcp_admin: "non_verificato" };
        if (utenti.length === 0) return { letto: true, utente: "assente", abilitato: false, gruppi: vuoti };
        const dn = utenti[0].dn;
        const uac = Number.parseInt(String(utenti[0].userAccountControl ?? ""), 10);
        const abilitato = Number.isNaN(uac) ? true : (uac & UAC_DISABILITATO) === 0;
        const gruppi = { ...vuoti };
        for (const id of Object.keys(GRUPPI_CERCATI) as IdGruppo[]) gruppi[id] = await statoGruppo(client, base, GRUPPI_CERCATI[id], dn);
        return { letto: true, utente: "presente", abilitato, gruppi };
      })(),
      deps.tettoMs,
    );
  } catch {
    return { letto: false, motivo: MOTIVO_DC_MUTO };
  } finally {
    void client.unbind().catch(() => undefined); // su una connessione appesa non si aspetta la chiusura
  }
}

const PAROLA_STATO: Readonly<Record<StatoDiritto, string>> = { si: "sì", in_parte: "in parte", no: "no", non_verificato: "non verificabile" };

function riunisci(stati: readonly StatoDiritto[]): StatoDiritto {
  if (stati.includes("no")) return "no";
  if (stati.includes("non_verificato")) return "non_verificato";
  return "si";
}

function dalDominio(dirittoId: string, annuario: Annuario): RigaControllo {
  if (!annuario.letto) return { dirittoId, stato: "non_verificato", base: annuario.motivo };
  if (dirittoId === "account_dominio") {
    if (annuario.utente === "assente") return { dirittoId, stato: "no", base: "L'account non risulta in Active Directory." };
    return annuario.abilitato
      ? { dirittoId, stato: "si", base: "L'account è in Active Directory ed è abilitato." }
      : { dirittoId, stato: "no", base: "L'account è in Active Directory ma è disabilitato." };
  }
  if (annuario.utente === "assente") {
    return { dirittoId, stato: "non_verificato", base: "L'account non risulta in Active Directory: i suoi gruppi non si leggono." };
  }
  const ids = GRUPPI_DEL_DIRITTO[dirittoId] ?? [];
  const stati = ids.map((id) => annuario.gruppi[id]);
  const dettaglio = ids.map((id, i) => `${GRUPPI_CERCATI[id].nome} ${PAROLA_STATO[stati[i]]}`).join(", ");
  return { dirittoId, stato: riunisci(stati), base: `Letto dal DC, anche per gruppi annidati: ${dettaglio}.` };
}

function perTuttiNonVerificato(dirittoId: string, motivo: string): RigaControllo {
  return { dirittoId, stato: "non_verificato", base: motivo };
}

/* -------------------------------------------------------------------- PC */

const NOME_STRADA: Readonly<Record<StradaAccesso, string>> = { winrm: "WinRM", wmi: "WMI" };

function daiPc(dirittoId: string, strada: StradaAccesso, esiti: readonly EsitoAccessoVoce[]): RigaControllo {
  const nome = NOME_STRADA[strada];
  const e = esiti.find((x) => x.strada === strada);
  if (!e || e.provati === 0) {
    return { dirittoId, stato: "non_verificato", base: `Nessun host provato con ${nome}: lancia una scansione.` };
  }
  const base = `${e.riusciti} su ${e.provati} host provati con ${nome}, dall'ultima scansione.`;
  if (e.riusciti > 0) return { dirittoId, stato: e.diritti > 0 ? "in_parte" : "si", base };
  if (e.diritti > 0) return { dirittoId, stato: "no", base };
  const cause = [
    e.firewall > 0 ? `${e.firewall} firewall` : "",
    e.errori > 0 ? `${e.errori} con errore` : "",
    e.password > 0 ? `${e.password} con password errata` : "",
  ].filter(Boolean);
  return { dirittoId, stato: "non_verificato", base: `Provati ${e.provati} host con ${nome}: nessuno dice se il diritto c'è (${cause.join(", ")}).` };
}

/* ---------------------------------------------------------------- insieme */

async function esitoPassword(credId: number, chiave: string | null, deps: DipendenzeControllo): Promise<EsitoPassword> {
  if (chiave && deps.ricordo.ricorda(chiave)) return "errata";
  let esito: EsitoPassword;
  try {
    esito = await deps.password(credId);
  } catch {
    esito = "non_so";
  }
  if (esito === "errata" && chiave) deps.ricordo.segna(chiave);
  return esito;
}

/**
 * Controlla un account Windows dell'archivio. Va chiamata dentro `withTenant` (la rotta lo fa con `withTenantFromSession`).
 * Lancia `VoceNonWindows` se la voce non c'è o non è di tipo Windows.
 */
export async function controlloAccount(credId: number, parziali: Partial<DipendenzeControllo> = {}): Promise<RisultatoControllo> {
  const voce = getCredentialById(credId);
  if (!voce) throw new VoceNonWindows("Voce non trovata");
  if (voce.credential_type !== "windows") throw new VoceNonWindows("Il controllo vale solo per le voci di tipo Windows");

  const deps: DipendenzeControllo = { ...dipendenzePredefinite(), ...parziali };
  const account = getCredentialLoginPair(credId, "windows");
  const password = await esitoPassword(credId, account ? chiaveAccount(account.username, account.password) : null, deps);
  const esiti = getEsitiAccessoPerVoce(credId);

  const integrazione = deps.integrazione();
  let dominio: (id: string) => RigaControllo;
  if (!account) {
    dominio = (id) => perTuttiNonVerificato(id, "La voce non ha utente e password.");
  } else if (!integrazione) {
    dominio = (id) => perTuttiNonVerificato(id, "Nessuna integrazione Active Directory accesa.");
  } else if (!utenteDelDominio(account.username, integrazione.domain)) {
    dominio = (id) => perTuttiNonVerificato(id, `Account non del dominio ${integrazione.domain}: niente da leggere sul DC.`);
  } else {
    const annuario = await leggiAnnuario(integrazione, account.username, deps);
    dominio = (id) => dalDominio(id, annuario);
  }

  const righe = DIRITTI.map((d): RigaControllo => {
    switch (d.id) {
      case "inventario_wmi":
        return daiPc(d.id, "wmi", esiti);
      case "inventario_winrm":
        return daiPc(d.id, "winrm", esiti);
      case "software_patch": {
        const r = daiPc(d.id, "winrm", esiti);
        return { ...r, base: `Serve WinRM. ${r.base}` };
      }
      case "audit_gpo":
        return perTuttiNonVerificato(d.id, "Non si verifica da qui: si controlla sul domain controller.");
      default:
        return dominio(d.id);
    }
  });

  return { password, controllatoIl: deps.adesso().toISOString(), righe };
}

/** Le sole righe, come nell'interfaccia del piano. */
export async function controllaAccount(credId: number, deps: Partial<DipendenzeControllo> = {}): Promise<RigaControllo[]> {
  return (await controlloAccount(credId, deps)).righe;
}
