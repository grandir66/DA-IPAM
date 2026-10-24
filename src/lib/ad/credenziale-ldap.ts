/**
 * Tappa 2f credenziali (T24): l'account LDAP dell'Active Directory è una voce
 * dell'archivio, e il WinRM del DC prende la porta dalla sua voce.
 *
 * Prima della 2f l'account stava nella riga di `ad_integrations`
 * (`encrypted_username`, `encrypted_password`) e la pagina Credenziali non lo
 * vedeva. Il T22 l'ha portato in una voce «AD · <nome>» (`credential_id`);
 * qui lo si legge da lì, con `leggiSegretoDb` (tipo «Active Directory», D7):
 * - con la voce: il suo utente e la sua password, come sono stati salvati;
 * - senza voce: «Credenziale mancante», e nessun bind parte. Fino alla 2g le
 *   colonne della riga valevano per le righe mai convertite (segno della 2f
 *   diverso da `done:`); dalla 2g (T26) non si leggono più, qualunque sia il
 *   segno. È la stessa regola del controller (`controllers/credenziale.ts`).
 *
 * Chi usa l'account per entrare (bind LDAP, kinit, prova WinRM di Kerberos)
 * passa da `credenzialeLdapDi`.
 *
 * WinRM del DHCP e sonda della salute: la voce Windows `winrm_credential_id`,
 * letta da `segreti.ts` (solo voci Windows, D7), con la porta della voce
 * (`portaCredenziale`) al posto della 5985 fissa.
 *
 * Le funzioni `…Db` ricevono l'handle; le altre usano il DB del facade, lo
 * stesso da cui i chiamanti leggono l'integrazione (`getAdIntegrationById`).
 */
import type Database from "better-sqlite3";
import type { z } from "zod";
import { creaVoceDb, SegretiNonSalvati } from "@/lib/credentials/archivio";
import { leggiSegretoDb } from "@/lib/credentials/segreti";
import { portaCredenziale } from "@/lib/credentials/porte";
import { getDb, type AdIntegration } from "@/lib/db";
import type { CredentialSchema } from "@/lib/validators";
import { nomeVoceAd, type StatoAccountLdap } from "./account-ldap";

type DatiCredenziale = z.infer<typeof CredentialSchema>;

/** Nessuna voce: non parte nessun bind. */
export const CREDENZIALE_MANCANTE_AD =
  "Credenziale mancante: scegli l'account LDAP dall'archivio nella modifica dell'integrazione Active Directory";

/** Account scelto o scritto che non vale: le rotte rispondono 400 col messaggio. */
export class AccountLdapNonValido extends Error {
  constructor(messaggio: string) {
    super(messaggio);
    this.name = "AccountLdapNonValido";
  }
}

/** I campi della riga che servono a sapere con che cosa entra. */
export type RigaAccountLdap = Pick<AdIntegration, "encrypted_username" | "encrypted_password"> & { credential_id?: number | null };

/** L'account decifrato: resta in memoria, mai in una risposta. */
export type CredenzialeLdap =
  | { ok: true; fonte: "voce"; credentialId: number; nome: string; username: string; password: string }
  /** `mancante`: non c'è niente da leggere (stato, non guasto). */
  | { ok: false; mancante: boolean; motivo: string };

function stato(riga: RigaAccountLdap): StatoAccountLdap {
  return riga.credential_id != null ? "voce" : "mancante";
}

/** Con che cosa entra la riga, senza decifrare: per la pagina. */
export function statoAccountLdap(riga: RigaAccountLdap): StatoAccountLdap {
  return stato(riga);
}

/**
 * L'account LDAP della riga: la sua voce; senza voce «Credenziale mancante»
 * (dalla 2g le colonne della riga non si leggono più). Non lancia, non
 * registra.
 */
export function credenzialeLdapDb(dbh: Database.Database, riga: RigaAccountLdap): CredenzialeLdap {
  if (riga.credential_id == null) return { ok: false, mancante: true, motivo: CREDENZIALE_MANCANTE_AD };
  const e = leggiSegretoDb(dbh, riga.credential_id, "ldap");
  if (!e.ok) return { ok: false, mancante: false, motivo: e.motivo };
  if (e.segreto.forma !== "utente") return { ok: false, mancante: false, motivo: `La credenziale «${e.nome}» non ha utente e password` };
  return { ok: true, fonte: "voce", credentialId: riga.credential_id, nome: e.nome, username: e.segreto.username, password: e.segreto.password };
}

/** L'account per entrare (bind LDAP, kinit, prova WinRM di Kerberos), dal DB del facade. */
export function credenzialeLdapDi(integrazione: RigaAccountLdap): CredenzialeLdap {
  return credenzialeLdapDb(getDb(), integrazione);
}

/** La voce scelta come account deve essere una voce «Active Directory» leggibile. */
export function controllaVoceAdDb(dbh: Database.Database, credentialId: number): void {
  const e = leggiSegretoDb(dbh, credentialId, "ldap");
  if (!e.ok) throw new AccountLdapNonValido(e.motivo);
}

/** «AD · <nome>»; se c'è già, « (AD #id)», poi un numero (come la conversione del T22). */
function nomeUnicoDb(dbh: Database.Database, integrazione: { id: number; name: string }): string {
  const base = nomeVoceAd(integrazione.name);
  const esiste = dbh.prepare("SELECT 1 FROM credentials WHERE name = ?");
  if (!esiste.get(base)) return base;
  const conId = `${base} (AD #${integrazione.id})`;
  if (!esiste.get(conId)) return conId;
  for (let i = 2; ; i++) {
    const nome = `${base} (AD #${integrazione.id}, ${i})`;
    if (!esiste.get(nome)) return nome;
  }
}

/**
 * Un account nuovo diventa una voce «Active Directory» col CRUD dell'archivio
 * (`creaVoceDb`, stessi campi richiesti delle API). Un campo mancante lancia
 * `AccountLdapNonValido`.
 */
export function creaVoceAdDb(
  dbh: Database.Database,
  integrazione: { id: number; name: string },
  nuovo: { username: string; password: string },
): { id: number; nome: string } {
  const nome = nomeUnicoDb(dbh, integrazione);
  const dati: DatiCredenziale = { name: nome, credential_type: "ad", username: nuovo.username, password: nuovo.password };
  const esito = creaVoceDb(dbh, dati);
  if (!esito.ok) throw esito.stato === 503 ? new SegretiNonSalvati(esito.errore) : new AccountLdapNonValido(esito.errore);
  return { id: esito.vista.id, nome };
}

/** Accesso WinRM al DC: utente, password e porta della voce Windows. */
export type AccessoWinrmDc = { ok: true; nome: string; username: string; password: string; port: number } | { ok: false; motivo: string };

/** La voce WinRM dell'AD (`winrm_credential_id`): solo Windows (D7), con la sua porta o la 5985. */
export function accessoWinrmDelDcDb(dbh: Database.Database, credentialId: number): AccessoWinrmDc {
  const e = leggiSegretoDb(dbh, credentialId, "winrm");
  if (!e.ok) return { ok: false, motivo: e.motivo };
  if (e.segreto.forma !== "utente") return { ok: false, motivo: `La credenziale «${e.nome}» non ha utente e password` };
  return { ok: true, nome: e.nome, username: e.segreto.username, password: e.segreto.password, port: portaCredenziale({ port: e.port }, "winrm") };
}

export function accessoWinrmDelDc(credentialId: number): AccessoWinrmDc {
  return accessoWinrmDelDcDb(getDb(), credentialId);
}

/** L'integrazione per la pagina: niente segreti, il nome della voce e con che cosa entra. */
export type VistaIntegrazioneAd = Omit<AdIntegration, "encrypted_username" | "encrypted_password"> & {
  /** Maschere di sempre: la pagina non riceve mai l'account. */
  username: string;
  password: string;
  credential_name: string | null;
  account: StatoAccountLdap;
};

const MASCHERA = "●●●●●●●●";

export function vistaIntegrazioniAdDb(dbh: Database.Database, integrazioni: readonly AdIntegration[]): VistaIntegrazioneAd[] {
  const nomi = new Map(
    (
      dbh
        .prepare("SELECT ai.id AS id, c.name AS nome FROM ad_integrations ai JOIN credentials c ON c.id = ai.credential_id")
        .all() as Array<{ id: number; nome: string }>
    ).map((r) => [r.id, r.nome]),
  );
  return integrazioni.map((i) => {
    const { encrypted_username: _u, encrypted_password: _p, ...resto } = i;
    void _u;
    void _p;
    return {
      ...resto,
      credential_id: i.credential_id ?? null,
      username: MASCHERA,
      password: MASCHERA,
      credential_name: i.credential_id != null ? (nomi.get(i.id) ?? null) : null,
      account: stato(i),
    };
  });
}

export function vistaIntegrazioniAd(integrazioni: readonly AdIntegration[]): VistaIntegrazioneAd[] {
  return vistaIntegrazioniAdDb(getDb(), integrazioni);
}

export function vistaIntegrazioneAd(integrazione: AdIntegration): VistaIntegrazioneAd {
  return vistaIntegrazioniAd([integrazione])[0];
}
