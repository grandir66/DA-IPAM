/**
 * Tappa 2f credenziali (T23): il controller entra con una voce dell'archivio.
 *
 * Prima della 2f i segreti stavano nella riga di `network_controllers`
 * (`username` in chiaro, `password_enc`, `api_key_enc`) e la pagina
 * Credenziali non li vedeva. Il T22 li ha portati in voci «UniFi · <nome>»
 * (`credential_id`); qui si leggono e si scrivono da lì:
 * - lettura: la voce, con `leggiSegretoDb` (tipo «Controller UniFi», o
 *   «Controller Omada»), e la regola tipo ↔ metodo dell'ADR 0019: una console
 *   UniFi OS entra con la chiave API o con un utente locale, il self-hosted
 *   solo con utente e password;
 * - senza voce, le colonne della riga valgono solo per le righe MAI
 *   convertite, cioè col segno `credenziali_t2_integrazioni` diverso da
 *   `done:`. Con `done:` ogni riga col segreto ha ricevuto la sua voce: un
 *   `credential_id` NULL è uno scollegamento voluto (indirizzo cambiato, voce
 *   eliminata, `resetConfiguration`), non una riga da convertire, e le colonne
 *   ancora piene non si leggono. Il ripiego lo registra chi legge
 *   (`controllers/service.ts`), non questo modulo: le verifiche non registrano;
 * - scrittura: segreti nuovi → voce «UniFi · <nome>» col CRUD dell'archivio
 *   (`creaVoceDb`, campi richiesti per tipo e metodo); col nome già preso,
 *   « (controller #id)» come nella conversione del T22.
 *
 * Modulo con l'handle: non importa né `db.ts` né `db-tenant.ts`.
 */
import type Database from "better-sqlite3";
import type { z } from "zod";
import type { CredentialSchema } from "@/lib/validators";
import { creaCredenzialeDb, creaVoceDb } from "@/lib/credentials/archivio";
import { leggiSegretoDb } from "@/lib/credentials/segreti";
import { leggiSegno, SEGNO_INTEGRAZIONI } from "@/lib/credentials/segni-t2";
import { METODI_PER_TIPO, normalizzaTipo } from "@/lib/credentials/tipi";
import { metodiVocePerController, type ControllerKind, type MetodoVoceController, type NetworkControllerRow } from "./types";

type DatiCredenziale = z.infer<typeof CredentialSchema>;

/** Nessuna voce e nessuna colonna da leggere: non parte nessuna connessione. */
export const CREDENZIALE_MANCANTE = "Credenziale mancante: scegli una voce dell'archivio nella modifica del controller";

/** La riga è entrata con le colonne di prima della 2f: lo dice `last_message`. */
export const FORMA_VECCHIA = "Credenziale ancora nella forma vecchia: sceglila dall'archivio nella modifica del controller";

/** Una voce nuova che non passa le regole dell'archivio: le rotte rispondono 400. */
export class CredenzialeControllerNonValida extends Error {
  constructor(messaggio: string) {
    super(messaggio);
    this.name = "CredenzialeControllerNonValida";
  }
}

/** Il segreto della voce, già decifrato: resta in memoria, mai in una risposta. */
export type EsitoVoceController =
  | { ok: true; credentialId: number; nome: string; metodo: MetodoVoceController; username: string; password: string; apiKey: string }
  | { ok: false; motivo: string };

export type CredenzialeController =
  | (Extract<EsitoVoceController, { ok: true }> & { fonte: "voce" })
  | { ok: true; fonte: "colonne" }
  | { ok: false; motivo: string };

const COME: Readonly<Record<MetodoVoceController, string>> = {
  chiave: "a chiave API",
  utente: "a utente e password",
  client: "a client ID e secret",
};

const NOME_TIPO: Readonly<Record<ControllerKind, string>> = {
  udm: "la console UniFi OS",
  self_hosted: "il controller UniFi self-hosted",
  omada: "il controller Omada",
};

/**
 * La voce `credentialId` per un controller di tipo `kind`: il segreto
 * decifrato e il metodo. `metodo` è quello scelto nel modulo (solo UniFi OS):
 * se c'è, la voce deve averlo. Non lancia.
 */
export function voceControllerDb(
  dbh: Database.Database,
  credentialId: number,
  kind: ControllerKind,
  metodo?: MetodoVoceController,
): EsitoVoceController {
  const e = leggiSegretoDb(dbh, credentialId, kind === "omada" ? "controller_omada" : "controller_unifi");
  if (!e.ok) return { ok: false, motivo: e.motivo };
  let v: { metodo: MetodoVoceController; username: string; password: string; apiKey: string };
  switch (e.segreto.forma) {
    case "chiave_api":
      v = { metodo: "chiave", username: "", password: "", apiKey: e.segreto.chiave };
      break;
    case "utente":
      v = { metodo: "utente", username: e.segreto.username, password: e.segreto.password, apiKey: "" };
      break;
    case "client":
      v = { metodo: "client", username: e.segreto.clientId, password: e.segreto.clientSecret, apiKey: "" };
      break;
    default:
      return { ok: false, motivo: `La credenziale «${e.nome}» non ha un accesso per un controller` };
  }
  const ammessi = metodiVocePerController(kind);
  if (!ammessi.includes(v.metodo)) {
    return {
      ok: false,
      motivo: `La credenziale «${e.nome}» è ${COME[v.metodo]}: ${NOME_TIPO[kind]} entra solo ${ammessi.map((m) => COME[m]).join(" o ")}`,
    };
  }
  if (metodo && metodo !== v.metodo) {
    return {
      ok: false,
      motivo: `La credenziale «${e.nome}» è ${COME[v.metodo]}, ma l'accesso scelto è ${COME[metodo]}: scegli una voce adatta o creane una nuova`,
    };
  }
  return { ok: true, credentialId, nome: e.nome, ...v };
}

/**
 * Con che cosa entra la riga salvata: la sua voce; senza voce, le colonne
 * solo se la riga non è mai stata convertita (segno della 2f diverso da
 * `done:`) e se ci sono; altrimenti «Credenziale mancante». Non lancia, non
 * registra.
 */
export function credenzialeControllerDb(
  dbh: Database.Database,
  row: Pick<NetworkControllerRow, "kind" | "credential_id" | "password_enc" | "api_key_enc">,
  metodo?: MetodoVoceController,
): CredenzialeController {
  if (row.credential_id != null) {
    const v = voceControllerDb(dbh, row.credential_id, row.kind, metodo);
    return v.ok ? { ...v, fonte: "voce" } : v;
  }
  if (!row.password_enc && !row.api_key_enc) return { ok: false, motivo: CREDENZIALE_MANCANTE };
  if ((leggiSegno(dbh, SEGNO_INTEGRAZIONI) ?? "").startsWith("done:")) return { ok: false, motivo: CREDENZIALE_MANCANTE };
  return { ok: true, fonte: "colonne" };
}

/** Il controller per cui nasce una voce: il nome dà il nome della voce, l'id lo rende unico. */
export interface ControllerDellaVoce {
  id: number;
  name: string;
  kind: ControllerKind;
}

/** «UniFi · <nome>» (o «Omada · …»); se c'è già, « (controller #id)», poi un numero. */
function nomeVoceDb(dbh: Database.Database, c: ControllerDellaVoce): string {
  const base = `${c.kind === "omada" ? "Omada" : "UniFi"} · ${c.name}`;
  const esiste = dbh.prepare("SELECT 1 FROM credentials WHERE name = ?");
  if (!esiste.get(base)) return base;
  const conId = `${base} (controller #${c.id})`;
  if (!esiste.get(conId)) return conId;
  for (let i = 2; ; i++) {
    const nome = `${base} (controller #${c.id}, ${i})`;
    if (!esiste.get(nome)) return nome;
  }
}

/** Segreti nuovi dal modulo, in chiaro: diventano una voce. */
export interface NuovaCredenzialeController {
  metodo: "chiave" | "utente";
  username: string;
  password: string;
  apiKey: string;
}

/**
 * Crea la voce di un controller dai segreti nuovi, con le regole delle API
 * (`creaVoceDb`). Un campo mancante lancia `CredenzialeControllerNonValida`.
 */
export function creaVoceControllerDb(dbh: Database.Database, c: ControllerDellaVoce, nuova: NuovaCredenzialeController): { id: number; nome: string } {
  const nome = nomeVoceDb(dbh, c);
  const dati: DatiCredenziale = {
    name: nome,
    credential_type: c.kind === "omada" ? "omada" : "unifi",
    auth_method: nuova.metodo,
    username: nuova.metodo === "utente" ? nuova.username : undefined,
    password: nuova.metodo === "chiave" ? nuova.apiKey : nuova.password,
  };
  const esito = creaVoceDb(dbh, dati);
  if (!esito.ok) throw new CredenzialeControllerNonValida(esito.errore);
  return { id: esito.vista.id, nome };
}

/**
 * Crea la voce dai segreti GIÀ cifrati della configurazione vecchia dell'hub
 * (`migrateLegacyUnifiConfig`): si copiano senza decifrarli, come prima nelle
 * colonne.
 */
export function creaVoceControllerCifrataDb(
  dbh: Database.Database,
  c: ControllerDellaVoce,
  v: { metodo: "chiave" | "utente"; encrypted_username: string | null; encrypted_password: string },
): { id: number; nome: string } {
  const nome = nomeVoceDb(dbh, c);
  const voce = creaCredenzialeDb(dbh, {
    name: nome,
    credential_type: c.kind === "omada" ? "omada" : "unifi",
    auth_method: v.metodo,
    encrypted_username: v.metodo === "utente" ? v.encrypted_username : null,
    encrypted_password: v.encrypted_password,
  });
  return { id: voce.id, nome };
}

/** Nome e metodo della voce di un controller, per la vista della pagina. */
export interface VoceDelController {
  nome: string;
  metodo: MetodoVoceController | null;
}

const METODI_VOCE: ReadonlySet<string> = new Set<MetodoVoceController>(["chiave", "utente", "client"]);

/** Le voci di tutti i controller in una query (niente N+1 nell'elenco). */
export function vociDeiControllerDb(dbh: Database.Database): Map<number, VoceDelController> {
  const righe = dbh
    .prepare(
      `SELECT nc.id AS id, c.name AS nome, c.credential_type AS tipo, c.auth_method AS metodo
         FROM network_controllers nc JOIN credentials c ON c.id = nc.credential_id`,
    )
    .all() as Array<{ id: number; nome: string; tipo: string; metodo: string | null }>;
  const out = new Map<number, VoceDelController>();
  for (const r of righe) {
    const tipo = normalizzaTipo(r.tipo);
    // auth_method NULL = il primo metodo del tipo (per UniFi la chiave).
    const m = r.metodo ?? (tipo ? METODI_PER_TIPO[tipo][0] : null);
    out.set(r.id, { nome: r.nome, metodo: m && METODI_VOCE.has(m) ? (m as MetodoVoceController) : null });
  }
  return out;
}
