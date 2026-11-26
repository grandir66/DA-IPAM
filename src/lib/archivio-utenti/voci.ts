/**
 * Le voci dell'archivio degli utenti (ADR 0043): elenco, dettaglio, lettura di un segreto, scrittura, cancellazione.
 * Ogni funzione vuole la sessione APERTA di chi chiama (`sessioni.ts`): ad archivio chiuso non esce niente, nemmeno i
 * titoli. L'elenco e il dettaglio non portano mai i valori segreti: quelli si chiedono uno per volta con `leggiCampo`,
 * e ogni lettura va nel registro.
 *
 * Una voce sta in un gruppo; il percorso nel file è `<gruppo>/<identificativo>`, in lettere minuscole (il formato di
 * `vault/kdbx.ts`). Il titolo come lo scrive una persona sta nel campo `titolo`.
 */
import crypto from "node:crypto";
import { ArchivioKdbx, ErroreKdbx, type ValoriVoce } from "../vault/kdbx";
import { cartellaArchivio, scriviRegistroArchivio, type Esito, type Persona } from "./motore";
import { chiaveAperta } from "./sessioni";

const NOME = "utenti";
/** Campi che non sono segreti: stanno nel dettaglio. Tutti gli altri si leggono solo con `leggiCampo`. */
const IN_VISTA = new Set(["titolo", "username", "url", "notes"]);
const no = (stato: number, errore: string): { ok: false; stato: number; errore: string } => ({ ok: false, stato, errore });

export interface VoceElenco {
  percorso: string;
  gruppo: string;
  titolo: string;
  utente: string;
  url: string;
  versione: number;
}

export interface VoceDettaglio extends VoceElenco {
  note: string;
  /** I nomi dei campi segreti che la voce ha (`password`, `pin`…): mai i valori. */
  segreti: string[];
  /** Quante versioni di prima ci sono nello storico. */
  versioniPrima: number;
}

/** Da un testo scritto da una persona a un segmento di percorso: minuscole, cifre, trattini. */
export function segmento(testo: string): string {
  const s = testo.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return s || "voce";
}
/** Come `segmento`, ma un testo che non lascia niente di scrivibile («..», «//») dà vuoto invece di «voce». */
function pezzoDiGruppo(testo: string): string {
  const s = segmento(testo);
  return s === "voce" && !/voce/i.test(testo) ? "" : s;
}

async function conArchivio<T>(chi: Persona, scrittura: boolean, ora: number | undefined, f: (a: ArchivioKdbx) => T | Promise<T>): Promise<Esito<{ dato: T }>> {
  const aperta = chiaveAperta(chi.id, { ora });
  if (!aperta) return no(423, "L'archivio è chiuso: aprilo con la tua password principale e il codice");
  let a: ArchivioKdbx | null = null;
  try {
    a = await ArchivioKdbx.apri(cartellaArchivio(), NOME, aperta.chiave, { scrittura });
    return { ok: true, dato: await f(a) };
  } catch (e) {
    if (e instanceof ErroreKdbx) {
      if (e.codice === "conflitto") return no(409, "Un'altra persona ha cambiato questa voce nel frattempo: ricaricala");
      if (e.codice === "occupato") return no(409, "Un'altra persona sta salvando: riprova fra un momento");
      return no(e.codice === "non_trovato" ? 404 : 400, e.message);
    }
    console.error("[archivio] operazione non riuscita:", e instanceof Error ? e.name : "errore");
    return no(500, "Operazione non riuscita");
  } finally {
    a?.chiudi();
  }
}

function riga(a: ArchivioKdbx, percorso: string, v: ValoriVoce): VoceElenco {
  const pezzi = percorso.split("/");
  return { percorso, gruppo: pezzi.slice(0, -1).join("/"), titolo: v.titolo || pezzi[pezzi.length - 1], utente: v.username ?? "", url: v.url ?? "", versione: a.versione(percorso) };
}

export async function elencoVoci(chi: Persona, op: { ora?: number } = {}): Promise<Esito<{ voci: VoceElenco[] }>> {
  const r = await conArchivio(chi, false, op.ora, (a) => a.elenca().map((p) => riga(a, p, a.leggi(p))));
  return r.ok ? { ok: true, voci: r.dato.sort((x, y) => x.gruppo.localeCompare(y.gruppo) || x.titolo.localeCompare(y.titolo)) } : r;
}

export async function dettaglioVoce(chi: Persona, percorso: string, op: { ora?: number } = {}): Promise<Esito<{ voce: VoceDettaglio }>> {
  const r = await conArchivio(chi, false, op.ora, (a) => {
    const v = a.leggi(percorso);
    return { ...riga(a, percorso, v), note: v.notes ?? "", segreti: Object.keys(v).filter((k) => !IN_VISTA.has(k) && v[k] !== "").sort(), versioniPrima: a.storico(percorso).length };
  });
  return r.ok ? { ok: true, voce: r.dato } : r;
}

/** Il valore di UN campo segreto. Ogni lettura va nel registro: chi, quale voce, quale campo, mostrato o copiato. */
export async function leggiCampo(chi: Persona, op: { percorso: string; campo: string; modo: "mostrato" | "copiato"; indirizzo?: string | null; ora?: number }): Promise<Esito<{ valore: string }>> {
  if (IN_VISTA.has(op.campo) || !/^[a-z0-9._-]{1,64}$/.test(op.campo)) return no(400, "Campo non valido");
  const r = await conArchivio(chi, false, op.ora, (a) => a.leggi(op.percorso)[op.campo]);
  if (!r.ok) return r;
  if (r.dato === undefined || r.dato === "") return no(404, "La voce non ha questo campo");
  scriviRegistroArchivio({ azione: "voce_letta", utente: chi.nome, utenteId: chi.id, da: op.indirizzo ?? null, su: op.percorso, dettaglio: `${op.campo} · ${op.modo}` }, new Date(op.ora ?? Date.now()));
  return { ok: true, valore: r.dato };
}

export interface DatiVoce {
  /** Percorso della voce da cambiare; assente = voce nuova. */
  percorso?: string;
  gruppo: string;
  titolo: string;
  utente?: string;
  url?: string;
  note?: string;
  /** Segreti da scrivere. In modifica, un campo assente resta com'è; una stringa vuota lo toglie. */
  segreti?: Record<string, string>;
  /** La versione che chi salva aveva davanti: se nel frattempo è cambiata, il salvataggio si rifiuta. */
  versioneAttesa?: number;
}

export async function scriviVoce(chi: Persona, d: DatiVoce, op: { indirizzo?: string | null; ora?: number } = {}): Promise<Esito<{ percorso: string; versione: number }>> {
  const titolo = d.titolo.trim();
  if (!titolo) return no(400, "Manca il titolo");
  if (titolo.length > 120) return no(400, "Titolo troppo lungo");
  // Un pezzo che non lascia niente di scrivibile non diventa un gruppo e non risale di cartella.
  const gruppo = d.gruppo.split("/").map(pezzoDiGruppo).filter(Boolean).slice(0, 6).join("/") || "generale";
  for (const k of Object.keys(d.segreti ?? {})) if (IN_VISTA.has(k) || !/^[a-z0-9._-]{1,64}$/.test(k)) return no(400, `Nome di campo non valido: «${k}»`);
  const nuova = !d.percorso;
  const percorso = d.percorso ?? `${gruppo}/${segmento(titolo)}-${crypto.randomBytes(3).toString("hex")}`;
  const r = await conArchivio(chi, true, op.ora, async (a) => {
    const prima: ValoriVoce = nuova ? {} : a.leggi(percorso);
    const valori: ValoriVoce = {};
    // I segreti di prima restano, salvo quelli riscritti; un valore vuoto toglie il campo.
    for (const [k, v] of Object.entries(prima)) if (!IN_VISTA.has(k)) valori[k] = v;
    for (const [k, v] of Object.entries(d.segreti ?? {})) { if (v === "") delete valori[k]; else valori[k] = v; }
    valori.titolo = titolo;
    if (d.utente?.trim()) valori.username = d.utente.trim();
    if (d.url?.trim()) valori.url = d.url.trim();
    if (d.note?.trim()) valori.notes = d.note;
    const versione = a.scrivi(percorso, valori, { versioneAttesa: nuova ? 0 : d.versioneAttesa });
    await a.salva();
    return versione;
  });
  if (!r.ok) return r;
  scriviRegistroArchivio({ azione: nuova ? "voce_creata" : "voce_cambiata", utente: chi.nome, utenteId: chi.id, da: op.indirizzo ?? null, su: percorso }, new Date(op.ora ?? Date.now()));
  return { ok: true, percorso, versione: r.dato };
}

export async function cancellaVoce(chi: Persona, percorso: string, op: { versioneAttesa?: number; indirizzo?: string | null; ora?: number } = {}): Promise<Esito> {
  const r = await conArchivio(chi, true, op.ora, async (a) => {
    a.cancella(percorso, { versioneAttesa: op.versioneAttesa });
    await a.salva();
    return true;
  });
  if (!r.ok) return r;
  scriviRegistroArchivio({ azione: "voce_cancellata", utente: chi.nome, utenteId: chi.id, da: op.indirizzo ?? null, su: percorso }, new Date(op.ora ?? Date.now()));
  return { ok: true };
}
