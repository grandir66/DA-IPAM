/**
 * Il motore dell'archivio degli utenti (ADR 0043): creare l'archivio, aprirlo con password principale personale e
 * codice a sei cifre, richiuderlo, dare e togliere l'accesso, contare i tentativi sbagliati, scrivere il registro.
 *
 * **Chi comanda sull'archivio è chi possiede il codice dell'amministratore dell'archivio** (Riccardo, 26/11/2026:
 * «l'admin di quell'archivio è un codice nuovo e solo chi lo possiede può resettare le credenziali; neppure il
 * superadmin dell'installazione può accedere senza il suo codice che può essere revocabile»). Il ruolo nell'app non
 * dà nessun potere qui: dare, ridare e togliere l'accesso si fa presentando quel codice. Il codice nasce alla
 * creazione, si mostra una volta sola, non sta sul disco (sul disco c'è una serratura che lui apre) e si può
 * sostituire: quello vecchio smette di valere.
 * Le voci (leggere, scrivere, cercare) e la copia cifrata arrivano con le tappe dopo.
 *
 * Sul disco, in `<dati>/archivio-utenti/` (0700): `utenti.kdbx` (formato di `vault/kdbx.ts`, il key file NON c'è) e
 * `serrature.json`. La chiave dell'archivio esiste in chiaro solo in memoria, finché una sessione è aperta.
 *
 * Il secondo fattore si verifica con una funzione passata da chi chiama (`dip.verificaCodice`): di serie è quella
 * dell'utente in `hub.users`; le prove ne passano una loro.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import { resolveDataDir } from "../data-dir";
import { unisci } from "../percorsi";
import { scriviTentativi } from "../protezione/tentativi";
import { ArchivioKdbx, ErroreKdbx, creaArchivioKdbx } from "../vault/kdbx";
import { apriSerratura, creaSerratura, difettoPassword, type Serratura } from "./serrature";
import { apriSessione, chiaveAperta, chiudiSessione } from "./sessioni";

const NOME = "utenti";
export const TENTATIVI_MASSIMI = 5;
export const FINESTRA_TENTATIVI_MS = 15 * 60_000;

export interface Persona {
  id: number;
  nome: string;
  ruolo: string;
}

export interface Dipendenze {
  /** Verifica il codice a sei cifre dell'utente e lo consuma. `false` anche se l'utente non ha la seconda verifica. */
  verificaCodice: (utenteId: number, codice: string, ora: number) => boolean;
  ora?: () => number;
  /** Da quale indirizzo arriva la richiesta, per il registro. */
  indirizzo?: string | null;
}

export type Esito<T = object> = ({ ok: true } & T) | { ok: false; stato: number; errore: string };
const no = (stato: number, errore: string): { ok: false; stato: number; errore: string } => ({ ok: false, stato, errore });

export function cartellaArchivio(): string {
  return unisci(resolveDataDir(), "archivio-utenti");
}
const fileSerrature = (): string => unisci(cartellaArchivio(), "serrature.json");
const fileKdbx = (): string => unisci(cartellaArchivio(), `${NOME}.kdbx`);
const fileAmministratore = (): string => unisci(cartellaArchivio(), "amministratore.json");

// ── Serrature su disco ───────────────────────────────────────────────────────

export function leggiSerrature(): Serratura[] {
  try {
    const dati = JSON.parse(fs.readFileSync(fileSerrature(), "utf8")) as unknown;
    return Array.isArray(dati) ? (dati as Serratura[]).filter((s) => s && s.formato === 1 && Number.isInteger(s.utenteId) && s.utenteId > 0) : [];
  } catch {
    return [];
  }
}

/** Scrittura atomica: file provvisorio, fsync, rename. Mai un file a metà. */
function scriviAtomico(percorso: string, testo: string): void {
  fs.mkdirSync(cartellaArchivio(), { recursive: true, mode: 0o700 });
  const tmp = `${percorso}.tmp-${process.pid}`;
  const fd = fs.openSync(tmp, "w", 0o600);
  try {
    fs.writeSync(fd, testo);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, percorso);
}
function scriviSerrature(serrature: Serratura[]): void {
  scriviAtomico(fileSerrature(), JSON.stringify(serrature, null, 1));
}

/** La serratura dell'amministratore dell'archivio: la apre il suo codice, non una persona. Id 0, che nessun utente ha. */
const ID_AMMINISTRATORE = 0;
function leggiSerraturaAmministratore(): Serratura | null {
  try {
    const s = JSON.parse(fs.readFileSync(fileAmministratore(), "utf8")) as Serratura;
    return s && s.formato === 1 && s.utenteId === ID_AMMINISTRATORE ? s : null;
  } catch {
    return null;
  }
}

/** Un codice nuovo: 160 bit casuali, in gruppi di quattro lettere e cifre senza quelle che si confondono. */
export function nuovoCodiceAmministratore(): string {
  const alfabeto = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const byte = crypto.randomBytes(32);
  let testo = "";
  for (let i = 0; i < 32; i++) testo += alfabeto[byte[i] % 32];
  return (testo.match(/.{4}/g) ?? []).join("-");
}

/** Il codice come lo scrive una persona: maiuscole, senza spazi; i trattini restano. */
function normalizzaCodice(codice: string): string {
  return codice.trim().toUpperCase().replace(/\s+/g, "");
}

// ── Registro ─────────────────────────────────────────────────────────────────

export interface RigaRegistroArchivio {
  azione: "creato" | "aperto" | "chiuso" | "richiuso_da_solo" | "tentativo_fallito" | "bloccato" | "accesso_dato" | "accesso_tolto" | "password_cambiata" | "codice_amministratore_rifiutato" | "codice_amministratore_sostituito";
  utente: string;
  utenteId: number;
  da: string | null;
  /** Su chi, quando l'azione riguarda un'altra persona. */
  su?: string;
  dettaglio?: string;
}

/** Lancia se non scrive: un'apertura dell'archivio non passa senza traccia. */
export function scriviRegistroArchivio(riga: RigaRegistroArchivio, adesso: Date = new Date()): void {
  const dir = unisci(resolveDataDir(), "audit");
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(unisci(dir, `archivio-${adesso.toISOString().slice(0, 10)}.jsonl`), `${JSON.stringify({ il: adesso.toISOString(), ...riga })}\n`);
}

// ── Tentativi sbagliati ──────────────────────────────────────────────────────

const CHIAVE_TENTATIVI = Symbol.for("da-ipam.archivio-utenti.tentativi");
function tentativi(): Map<number, number[]> {
  const g = globalThis as unknown as Record<symbol, Map<number, number[]> | undefined>;
  return (g[CHIAVE_TENTATIVI] ??= new Map());
}
function sbagliatiRecenti(utenteId: number, ora: number): number[] {
  const v = (tentativi().get(utenteId) ?? []).filter((t) => ora - t < FINESTRA_TENTATIVI_MS);
  tentativi().set(utenteId, v);
  return v;
}

// ── Stato ────────────────────────────────────────────────────────────────────

export interface StatoArchivio {
  esiste: boolean;
  /** Questo utente ha una serratura. */
  autorizzato: boolean;
  aperto: boolean;
  scade: number | null;
  /** La sua password è provvisoria: alla prossima apertura va cambiata. */
  provvisoria: boolean;
  /** Tentativi sbagliati negli ultimi 15 minuti. */
  sbagliati: number;
}

export function statoArchivio(utenteId: number, ora: number = Date.now()): StatoArchivio {
  const s = leggiSerrature().find((x) => x.utenteId === utenteId);
  const a = chiaveAperta(utenteId, { ora, tocca: false });
  return { esiste: fs.existsSync(fileKdbx()), autorizzato: Boolean(s), aperto: a !== null, scade: a?.scade ?? null, provvisoria: s?.provvisoria === true, sbagliati: sbagliatiRecenti(utenteId, ora).length };
}

// ── Gesti ────────────────────────────────────────────────────────────────────

/** Il conto dei codici dell'amministratore sbagliati è uno solo per l'archivio, non per utente: chi prova a indovinarlo cambiando utente non riparte da zero. */
const CONTO_CODICE = -1;

/**
 * Apre la serratura dell'amministratore col codice presentato. Chi lo presenta deve essere un utente collegato (va
 * nel registro), ma il suo ruolo non conta. `null` = codice sbagliato, o troppi tentativi.
 */
async function conCodiceAmministratore(chi: Persona, codice: string, dip: Pick<Dipendenze, "ora" | "indirizzo">): Promise<{ chiave: Uint8Array } | { errore: { ok: false; stato: number; errore: string } }> {
  const ora = dip.ora?.() ?? Date.now();
  const s = leggiSerraturaAmministratore();
  if (!s) return { errore: no(409, "L'archivio non ha un codice dell'amministratore valido") };
  if (sbagliatiRecenti(CONTO_CODICE, ora).length >= TENTATIVI_MASSIMI) return { errore: no(429, "Troppi codici sbagliati: riprova fra 15 minuti") };
  const chiave = await apriSerratura(s, normalizzaCodice(codice));
  if (!chiave) {
    sbagliatiRecenti(CONTO_CODICE, ora).push(ora);
    scriviRegistroArchivio({ azione: "codice_amministratore_rifiutato", utente: chi.nome, utenteId: chi.id, da: dip.indirizzo ?? null }, new Date(ora));
    scriviTentativi([{ il: new Date(ora).toISOString(), fonte: "archivio", indirizzo: dip.indirizzo ?? null, utente: chi.nome.slice(0, 64), cosa: "codice dell'amministratore dell'archivio rifiutato" }]);
    return { errore: no(403, "Codice dell'amministratore dell'archivio non valido") };
  }
  tentativi().delete(CONTO_CODICE);
  return { chiave };
}

/**
 * Crea l'archivio vuoto e il **codice dell'amministratore dell'archivio**, che torna qui UNA volta sola: non sta sul
 * disco e non si può rileggere. Lo avvia un amministratore dell'installazione (col suo codice a sei cifre), ma da quel
 * momento chi comanda è chi tiene il codice: chi ha creato l'archivio non ha nessun accesso alle voci finché non se lo
 * dà con quel codice.
 */
export async function creaArchivio(op: { chi: Persona; codice: string }, dip: Dipendenze): Promise<Esito<{ codiceAmministratore: string }>> {
  const ora = dip.ora?.() ?? Date.now();
  if (op.chi.ruolo !== "superadmin" && op.chi.ruolo !== "admin") return no(403, "L'archivio lo crea un amministratore dell'installazione");
  if (fs.existsSync(fileKdbx())) return no(409, "L'archivio c'è già");
  if (!dip.verificaCodice(op.chi.id, op.codice, ora)) return no(403, "Codice non valido, o la verifica in due passaggi non è attiva sul tuo utente");
  const chiave = await creaArchivioKdbx(cartellaArchivio(), NOME, { scriviKeyfile: false });
  try {
    const codiceAmministratore = nuovoCodiceAmministratore();
    const s = await creaSerratura(chiave, codiceAmministratore, { utenteId: ID_AMMINISTRATORE, utente: "amministratore dell'archivio", scrittaDa: op.chi.id, provvisoria: false, adesso: new Date(ora) });
    scriviAtomico(fileAmministratore(), JSON.stringify(s, null, 1));
    scriviSerrature([]);
    scriviRegistroArchivio({ azione: "creato", utente: op.chi.nome, utenteId: op.chi.id, da: dip.indirizzo ?? null }, new Date(ora));
    return { ok: true, codiceAmministratore };
  } finally {
    chiave.fill(0);
  }
}

/**
 * Apre l'archivio per questo utente. Con una password provvisoria serve anche `nuovaPassword`: l'apertura la cambia
 * prima di aprire. Password e codice sbagliati danno lo stesso messaggio, e contano tutti e due.
 */
export async function apriArchivio(op: { chi: Persona; password: string; codice: string; nuovaPassword?: string }, dip: Dipendenze): Promise<Esito<{ scade: number }>> {
  const ora = dip.ora?.() ?? Date.now();
  const da = dip.indirizzo ?? null;
  const tutte = leggiSerrature();
  const mia = tutte.find((s) => s.utenteId === op.chi.id);
  if (!mia) return no(403, "Non hai l'autorizzazione a usare l'archivio");
  if (sbagliatiRecenti(op.chi.id, ora).length >= TENTATIVI_MASSIMI) return no(429, "Troppi tentativi sbagliati: riprova fra 15 minuti");

  const sbagliato = (cosa: string): Esito<{ scade: number }> => {
    const v = sbagliatiRecenti(op.chi.id, ora);
    v.push(ora);
    const bloccato = v.length >= TENTATIVI_MASSIMI;
    scriviRegistroArchivio({ azione: bloccato ? "bloccato" : "tentativo_fallito", utente: op.chi.nome, utenteId: op.chi.id, da, dettaglio: cosa }, new Date(ora));
    scriviTentativi([{ il: new Date(ora).toISOString(), fonte: "archivio", indirizzo: da, utente: op.chi.nome.slice(0, 64), cosa: "apertura dell'archivio rifiutata" }]);
    return no(403, "Password principale o codice non validi");
  };

  const chiave = await apriSerratura(mia, op.password);
  if (!chiave) return sbagliato("password");
  try {
    if (!dip.verificaCodice(op.chi.id, op.codice, ora)) return sbagliato("codice");
    // La chiave deve aprire davvero l'archivio: una serratura rimasta da un archivio rifatto non vale.
    try {
      (await ArchivioKdbx.apri(cartellaArchivio(), NOME, chiave)).chiudi();
    } catch (e) {
      return no(e instanceof ErroreKdbx && e.codice === "chiave" ? 409 : 500, "La tua serratura non apre questo archivio: chiedi a chi ha il codice dell'amministratore di ridarti l'accesso");
    }
    if (mia.provvisoria) {
      if (!op.nuovaPassword) return no(428, "La tua password è provvisoria: scegline una nuova per aprire");
      const difetto = difettoPassword(op.nuovaPassword);
      if (difetto) return no(400, difetto);
      if (op.nuovaPassword === op.password) return no(400, "La password nuova deve essere diversa da quella provvisoria");
      const nuova = await creaSerratura(chiave, op.nuovaPassword, { utenteId: op.chi.id, utente: op.chi.nome, scrittaDa: op.chi.id, provvisoria: false, adesso: new Date(ora) });
      scriviSerrature(leggiSerrature().map((s) => (s.utenteId === op.chi.id ? nuova : s)));
      scriviRegistroArchivio({ azione: "password_cambiata", utente: op.chi.nome, utenteId: op.chi.id, da }, new Date(ora));
    }
    tentativi().delete(op.chi.id);
    const scade = apriSessione(op.chi.id, chiave, ora);
    scriviRegistroArchivio({ azione: "aperto", utente: op.chi.nome, utenteId: op.chi.id, da }, new Date(ora));
    return { ok: true, scade };
  } finally {
    chiave.fill(0);
  }
}

export function chiudiArchivio(chi: Persona, dip: Pick<Dipendenze, "ora" | "indirizzo"> = {}): boolean {
  const c = chiudiSessione(chi.id);
  if (c) scriviRegistroArchivio({ azione: "chiuso", utente: chi.nome, utenteId: chi.id, da: dip.indirizzo ?? null }, new Date(dip.ora?.() ?? Date.now()));
  return c;
}

/**
 * Dà (o ridà) l'accesso a una persona, anche a se stessi: serve il **codice dell'amministratore dell'archivio**.
 * Scrive una serratura con una password provvisoria, da cambiare alla prima apertura. È anche il recupero di chi ha
 * perso la propria password.
 */
export async function daiAccesso(op: { chi: Persona; codiceAmministratore: string; a: { id: number; nome: string }; passwordProvvisoria: string }, dip: Pick<Dipendenze, "ora" | "indirizzo"> = {}): Promise<Esito> {
  const ora = dip.ora?.() ?? Date.now();
  if (!Number.isInteger(op.a.id) || op.a.id <= 0) return no(400, "Utente non valido");
  const difetto = difettoPassword(op.passwordProvvisoria);
  if (difetto) return no(400, difetto);
  const adm = await conCodiceAmministratore(op.chi, op.codiceAmministratore, dip);
  if ("errore" in adm) return adm.errore;
  try {
    const nuova = await creaSerratura(adm.chiave, op.passwordProvvisoria, { utenteId: op.a.id, utente: op.a.nome, scrittaDa: op.chi.id, provvisoria: true, adesso: new Date(ora) });
    scriviSerrature([...leggiSerrature().filter((s) => s.utenteId !== op.a.id), nuova]);
  } finally {
    adm.chiave.fill(0);
  }
  // Chi riceve una serratura nuova perde la sessione aperta con la vecchia e il conto dei tentativi.
  chiudiSessione(op.a.id);
  tentativi().delete(op.a.id);
  scriviRegistroArchivio({ azione: "accesso_dato", utente: op.chi.nome, utenteId: op.chi.id, da: dip.indirizzo ?? null, su: op.a.nome }, new Date(ora));
  return { ok: true };
}

/** Toglie l'accesso a una persona: cancella la sua serratura. Serve il codice dell'amministratore dell'archivio. */
export async function togliAccesso(op: { chi: Persona; codiceAmministratore: string; a: { id: number; nome: string } }, dip: Pick<Dipendenze, "ora" | "indirizzo"> = {}): Promise<Esito> {
  const ora = dip.ora?.() ?? Date.now();
  const tutte = leggiSerrature();
  if (!tutte.some((s) => s.utenteId === op.a.id)) return no(404, "Questa persona non ha l'accesso");
  const adm = await conCodiceAmministratore(op.chi, op.codiceAmministratore, dip);
  if ("errore" in adm) return adm.errore;
  adm.chiave.fill(0);
  scriviSerrature(tutte.filter((s) => s.utenteId !== op.a.id));
  chiudiSessione(op.a.id);
  scriviRegistroArchivio({ azione: "accesso_tolto", utente: op.chi.nome, utenteId: op.chi.id, da: dip.indirizzo ?? null, su: op.a.nome }, new Date(ora));
  return { ok: true };
}

/**
 * Sostituisce il codice dell'amministratore dell'archivio: serve quello attuale, ne esce uno nuovo (mostrato una
 * volta sola) e il vecchio smette di valere subito. È la revoca: chi aveva il codice vecchio non può più niente.
 */
export async function sostituisciCodiceAmministratore(op: { chi: Persona; codiceAmministratore: string }, dip: Pick<Dipendenze, "ora" | "indirizzo"> = {}): Promise<Esito<{ codiceAmministratore: string }>> {
  const ora = dip.ora?.() ?? Date.now();
  const adm = await conCodiceAmministratore(op.chi, op.codiceAmministratore, dip);
  if ("errore" in adm) return adm.errore;
  try {
    const nuovo = nuovoCodiceAmministratore();
    const s = await creaSerratura(adm.chiave, nuovo, { utenteId: ID_AMMINISTRATORE, utente: "amministratore dell'archivio", scrittaDa: op.chi.id, provvisoria: false, adesso: new Date(ora) });
    scriviAtomico(fileAmministratore(), JSON.stringify(s, null, 1));
    scriviRegistroArchivio({ azione: "codice_amministratore_sostituito", utente: op.chi.nome, utenteId: op.chi.id, da: dip.indirizzo ?? null }, new Date(ora));
    return { ok: true, codiceAmministratore: nuovo };
  } finally {
    adm.chiave.fill(0);
  }
}

/** Chi ha l'accesso: mai niente della serratura, solo chi, da quando, se la password è provvisoria. */
export function chiHaAccesso(): Array<{ utenteId: number; utente: string; dal: string; provvisoria: boolean }> {
  return leggiSerrature().map((s) => ({ utenteId: s.utenteId, utente: s.utente, dal: s.creata, provvisoria: s.provvisoria })).sort((a, b) => a.utente.localeCompare(b.utente));
}
