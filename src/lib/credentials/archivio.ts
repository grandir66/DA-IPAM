/**
 * L'archivio delle credenziali: il CRUD e le regole delle API (tappa 2
 * credenziali, T13, 16/10).
 *
 * Dalla 2c la tabella `credentials` non ha più il CHECK sui tipi (ADR 0017):
 * la validazione sta in `tipi.ts` e qui. Questo è l'unico punto che scrive
 * una voce nuova, oltre alle conversioni dei dati
 * (`{normalizza,converti}-*.ts`): lo presidia
 * `src/lib/__tests__/insert-credentials-solo-crud.test.ts`.
 *
 * Due livelli:
 * - il CRUD (`creaCredenzialeDb`, `aggiornaCredenzialeDb`,
 *   `eliminaCredenzialeDb`), di cui `createCredential`, `updateCredential` e
 *   `deleteCredential` di `db.ts` e `db-tenant.ts` sono involucri di una riga:
 *   scrive le colonne che gli si danno, col tipo controllato e `linux` scritto
 *   come `ssh`;
 * - le regole delle API (`creaVoceDb`, `modificaVoceDb`, `eliminaVoceDb`):
 *   campi richiesti per tipo e metodo da `campiRichiesti` (prima erano regole
 *   scritte a mano nella rotta, solo per cinque tipi), voce in uso che non si
 *   elimina e non cambia tipo (D8 = (a)), risposta già mascherata.
 *
 * Modulo con l'handle del DB esplicito: non importa né `db.ts` né `db-tenant.ts`.
 */
import type Database from "better-sqlite3";
import type { z } from "zod";
import type { Credential } from "@/types";
import type { CredentialSchema } from "@/lib/validators";
import { aggiornamentiCredenziale, colonneNuovaCredenziale, togliRiferimentoSeCambianoSegreti } from "./aggiornamenti";
import { mascheraCredenziale, type CredenzialeVista } from "./maschera";
import {
  METODI_PER_TIPO,
  campiDelMetodo,
  campiRichiesti,
  etichettaMetodo,
  etichettaTipo,
  formaSegreto,
  normalizzaTipo,
  type CampoCredenziale,
  type MetodoAccesso,
  type TipoCredenziale,
} from "./tipi";
import { descriviUsi, totaleUsi, usiCredenzialeDb, type UsiCredenziale } from "./usi";

/** Le colonne scrivibili di una voce; i segreti già cifrati. */
export interface ColonneCredenziale {
  name: string;
  credential_type: string;
  auth_method?: string | null;
  encrypted_username?: string | null;
  encrypted_password?: string | null;
  encrypted_private_key?: string | null;
  encrypted_key_passphrase?: string | null;
  encrypted_auth_key?: string | null;
  auth_protocol?: string | null;
  encrypted_priv_key?: string | null;
  priv_protocol?: string | null;
  security_level?: string | null;
  port?: number | null;
  /** da-vault: il percorso in OpenBao (lo scrive la migrazione; la pagina lo toglie quando cambia un segreto). */
  credential_ref?: string | null;
}

type Colonna = keyof ColonneCredenziale;

const COLONNE: readonly Colonna[] = [
  "name",
  "credential_type",
  "auth_method",
  "encrypted_username",
  "encrypted_password",
  "encrypted_private_key",
  "encrypted_key_passphrase",
  "encrypted_auth_key",
  "auth_protocol",
  "encrypted_priv_key",
  "priv_protocol",
  "security_level",
  "port",
  "credential_ref",
];

function tipoDaScrivere(t: string): TipoCredenziale {
  const tipo = normalizzaTipo(t);
  if (!tipo) throw new Error(`Tipo di credenziale sconosciuto: «${t}»`);
  return tipo;
}

function leggi(dbh: Database.Database, id: number | bigint): Credential | undefined {
  return dbh.prepare("SELECT * FROM credentials WHERE id = ?").get(id) as Credential | undefined;
}

// ── CRUD ──

export function creaCredenzialeDb(dbh: Database.Database, input: ColonneCredenziale): Credential {
  const valori: Partial<Record<Colonna, unknown>> = { ...input, credential_type: tipoDaScrivere(input.credential_type) };
  // Solo le colonne con un valore: il vecchio ipam.db (facade senza tenant né
  // DEFAULT) non ha le colonne della tappa 2, e una voce che non le usa ci
  // entra come prima.
  const colonne = COLONNE.filter((c) => c === "name" || c === "credential_type" || (valori[c] !== undefined && valori[c] !== null));
  const r = dbh
    .prepare(`INSERT INTO credentials (${colonne.join(", ")}) VALUES (${colonne.map(() => "?").join(", ")})`)
    .run(...colonne.map((c) => valori[c]));
  return leggi(dbh, r.lastInsertRowid) as Credential;
}

export function aggiornaCredenzialeDb(dbh: Database.Database, id: number, input: Partial<ColonneCredenziale>): Credential | undefined {
  const campi: string[] = [];
  const valori: unknown[] = [];
  for (const c of COLONNE) {
    const v = input[c];
    if (v === undefined) continue;
    campi.push(`${c} = ?`);
    valori.push(c === "credential_type" ? tipoDaScrivere(String(v)) : v);
  }
  if (campi.length === 0) return leggi(dbh, id);
  campi.push("updated_at = datetime('now')");
  dbh.prepare(`UPDATE credentials SET ${campi.join(", ")} WHERE id = ?`).run(...valori, id);
  return leggi(dbh, id);
}

export function eliminaCredenzialeDb(dbh: Database.Database, id: number): boolean {
  return dbh.prepare("DELETE FROM credentials WHERE id = ?").run(id).changes > 0;
}

// ── regole delle API ──

type DatiCredenziale = z.infer<typeof CredentialSchema>;

export type EsitoVoce =
  | { ok: true; stato: 200 | 201; vista: CredenzialeVista }
  | { ok: false; stato: 400 | 404 | 409; errore: string; usi?: UsiCredenziale };

export type EsitoElimina = { ok: true } | { ok: false; stato: 404 | 409; errore: string; usi?: UsiCredenziale };

const COLONNA_DEL_CAMPO: Readonly<Record<CampoCredenziale | "passphrase", Colonna>> = {
  username: "encrypted_username",
  password: "encrypted_password",
  private_key: "encrypted_private_key",
  passphrase: "encrypted_key_passphrase",
  auth_key: "encrypted_auth_key",
  priv_key: "encrypted_priv_key",
};

/** Colonne non segrete della v3: valgono solo per il tipo `snmp_v3`. */
const COLONNE_V3: readonly Colonna[] = ["security_level", "auth_protocol", "priv_protocol"];

/** Segreti che cambiando forma (`formaSegreto`) si riscrivono: quelli salvati erano di un altro accesso. */
const SEGRETI: readonly Colonna[] = [
  "encrypted_password",
  "encrypted_private_key",
  "encrypted_key_passphrase",
  "encrypted_auth_key",
  "encrypted_priv_key",
];

type Riga = Partial<Record<Colonna, unknown>>;

const presente = (v: unknown): boolean => v != null && v !== "";

function nomeCampo(metodo: MetodoAccesso, campo: CampoCredenziale): string {
  switch (campo) {
    case "username":
      return metodo === "client" ? "il client ID" : metodo === "utente_v3" ? "l'utente SNMP v3" : "l'utente";
    case "password":
      if (metodo === "community") return "la community";
      if (metodo === "token") return "il token";
      if (metodo === "chiave") return "la chiave API";
      if (metodo === "client") return "il client secret";
      return "la password";
    case "private_key":
      return "la chiave privata";
    case "auth_key":
      return "la chiave di autenticazione SNMP v3";
    case "priv_key":
      return "la chiave di privacy SNMP v3";
  }
}

/** La richiesta porta campi SNMP v3 (un valore, non un vuoto o un null). */
function haCampiV3(d: Partial<DatiCredenziale>): boolean {
  return presente(d.security_level) || presente(d.auth_protocol) || presente(d.priv_protocol) || presente(d.auth_key) || presente(d.priv_key);
}

/**
 * La voce come sarà dopo il salvataggio, controllata: metodo del tipo, campi
 * v3 solo sul tipo v3, campi richiesti presenti. Restituisce le colonne fuori
 * dal metodo, da svuotare, oppure il rifiuto.
 */
function controlla(
  tipo: TipoCredenziale,
  metodoScritto: string | null,
  risultante: Riga,
  campiV3Mandati: boolean,
): { ok: true; daSvuotare: Colonna[] } | { ok: false; errore: string } {
  const metodi = METODI_PER_TIPO[tipo];
  const metodo = (metodoScritto ?? metodi[0]) as MetodoAccesso;
  if (!metodi.includes(metodo)) {
    return {
      ok: false,
      errore: `Il metodo «${metodoScritto}» non vale per ${etichettaTipo(tipo)}: ammessi ${metodi.map((m) => `«${etichettaMetodo(tipo, m)}»`).join(", ")}`,
    };
  }
  if (campiV3Mandati && tipo !== "snmp_v3") {
    return { ok: false, errore: "Livello, protocolli e chiavi SNMP v3 valgono solo per il tipo «SNMP v3»: scegli quel tipo" };
  }
  const campi = campiDelMetodo(tipo, metodo);
  const daSvuotare: Colonna[] = [];
  for (const [campo, colonna] of Object.entries(COLONNA_DEL_CAMPO) as Array<[CampoCredenziale | "passphrase", Colonna]>) {
    if (!campi.includes(campo) && presente(risultante[colonna])) daSvuotare.push(colonna);
  }
  if (!campi.includes("v3")) for (const c of COLONNE_V3) if (presente(risultante[c])) daSvuotare.push(c);

  const livello = typeof risultante.security_level === "string" && risultante.security_level ? risultante.security_level : null;
  let richiesti: CampoCredenziale[];
  try {
    richiesti = campiRichiesti(tipo, metodo, livello);
  } catch (e) {
    return { ok: false, errore: e instanceof Error ? e.message : String(e) };
  }
  const dove = `${etichettaTipo(tipo)}, ${etichettaMetodo(tipo, metodo)}`;
  for (const campo of richiesti) {
    if (!presente(risultante[COLONNA_DEL_CAMPO[campo]])) return { ok: false, errore: `Campo obbligatorio mancante: ${nomeCampo(metodo, campo)} (${dove})` };
  }
  if (tipo === "snmp_v3") {
    const l = livello ?? "authPriv";
    if (l !== "noAuthNoPriv" && !presente(risultante.auth_protocol)) {
      return { ok: false, errore: `Campo obbligatorio mancante: il protocollo di autenticazione SNMP v3 (${dove})` };
    }
    if (l === "authPriv" && !presente(risultante.priv_protocol)) {
      return { ok: false, errore: `Campo obbligatorio mancante: il protocollo di privacy SNMP v3 (${dove})` };
    }
  }
  return { ok: true, daSvuotare };
}

/** POST /api/credentials. */
export function creaVoceDb(dbh: Database.Database, dati: DatiCredenziale): EsitoVoce {
  const colonne = colonneNuovaCredenziale(dati);
  const c = controlla(dati.credential_type, dati.auth_method ?? null, colonne, haCampiV3(dati));
  if (!c.ok) return { ok: false, stato: 400, errore: c.errore };
  // Un campo che il metodo non ha (lo username di una community dalla
  // creazione rapida) non si scrive.
  for (const col of c.daSvuotare) (colonne as Riga)[col] = null;
  const voce = creaCredenzialeDb(dbh, colonne);
  return { ok: true, stato: 201, vista: mascheraCredenziale(voce, 0) };
}

/**
 * PUT /api/credentials/[id]. Ogni campo è facoltativo; i campi richiesti si
 * guardano sulla voce risultante (salvata più modifiche). Una voce in uso non
 * cambia tipo (D8 = (a)). Se tipo e metodo cambiano la forma del segreto
 * (`formaSegreto`) i segreti non mandati si svuotano: erano di un altro
 * accesso (la password di una SSH passata a chiave, che il trasporto
 * proverebbe ancora).
 */
export function modificaVoceDb(dbh: Database.Database, id: number, dati: Partial<DatiCredenziale>, corpo: unknown): EsitoVoce {
  return dbh.transaction((): EsitoVoce => {
    const salvata = leggi(dbh, id);
    if (!salvata) return { ok: false, stato: 404, errore: "Credenziale non trovata" };
    const tipoSalvato = normalizzaTipo(salvata.credential_type);
    const tipo = dati.credential_type ?? tipoSalvato;
    if (!tipo) {
      return { ok: false, stato: 400, errore: `La credenziale «${salvata.name}» ha un tipo sconosciuto («${salvata.credential_type}»): sceglilo dall'elenco` };
    }
    const cambiaTipo = tipo !== tipoSalvato;
    if (cambiaTipo) {
      const usi = usiCredenzialeDb(dbh, id);
      if (totaleUsi(usi) > 0) {
        return {
          ok: false,
          stato: 409,
          errore: `La credenziale «${salvata.name}» è in uso: ${descriviUsi(usi)}. Non le si cambia tipo: creane una nuova del tipo giusto`,
          usi,
        };
      }
    }

    const aggiornamenti = aggiornamentiCredenziale(dati, corpo) as Riga;
    // Il metodo salvato non vale per un tipo nuovo: se la richiesta non ne dice
    // uno, si torna al primo del tipo.
    if (dati.auth_method === undefined && cambiaTipo && salvata.auth_method != null) aggiornamenti.auth_method = null;
    const metodo = (aggiornamenti.auth_method !== undefined ? aggiornamenti.auth_method : salvata.auth_method) as string | null;
    const metodoDopo = (metodo ?? METODI_PER_TIPO[tipo][0]) as MetodoAccesso;
    const metodoPrima = tipoSalvato ? ((salvata.auth_method ?? METODI_PER_TIPO[tipoSalvato][0]) as MetodoAccesso) : null;
    const cambiaForma = !tipoSalvato || !metodoPrima || formaSegreto(tipo, metodoDopo) !== formaSegreto(tipoSalvato, metodoPrima);

    const risultante: Riga = { ...(salvata as unknown as Riga), ...aggiornamenti };
    if (cambiaForma) {
      for (const col of SEGRETI) {
        if (!(col in aggiornamenti) && presente(risultante[col])) {
          risultante[col] = null;
          aggiornamenti[col] = null;
        }
      }
    }
    const c = controlla(tipo, metodo, risultante, haCampiV3(dati));
    if (!c.ok) return { ok: false, stato: 400, errore: c.errore };
    for (const col of c.daSvuotare) aggiornamenti[col] = null;
    togliRiferimentoSeCambianoSegreti(aggiornamenti);

    const voce = aggiornaCredenzialeDb(dbh, id, aggiornamenti as Partial<ColonneCredenziale>);
    if (!voce) return { ok: false, stato: 404, errore: "Credenziale non trovata" };
    return { ok: true, stato: 200, vista: mascheraCredenziale(voce, totaleUsi(usiCredenzialeDb(dbh, id))) };
  })();
}

/**
 * DELETE /api/credentials/[id]. Una voce in uso non si elimina (D8 = (a)):
 * prima la cancellazione toglieva in silenzio binding, catene e righe host e
 * spegneva il WinRM dell'AD.
 */
export function eliminaVoceDb(dbh: Database.Database, id: number): EsitoElimina {
  return dbh.transaction((): EsitoElimina => {
    const salvata = leggi(dbh, id);
    if (!salvata) return { ok: false, stato: 404, errore: "Credenziale non trovata" };
    const usi = usiCredenzialeDb(dbh, id);
    if (totaleUsi(usi) > 0) {
      return {
        ok: false,
        stato: 409,
        errore: `La credenziale «${salvata.name}» è in uso: ${descriviUsi(usi)}. Togli prima questi usi, poi eliminala`,
        usi,
      };
    }
    eliminaCredenzialeDb(dbh, id);
    return { ok: true };
  })();
}
