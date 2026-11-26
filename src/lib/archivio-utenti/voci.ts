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
import { faiCopia } from "./copia";
import { cartellaArchivio, scriviRegistroArchivio } from "./deposito";
import type { Esito, Persona } from "./motore";
import { chiaveAperta } from "./sessioni";

const NOME = "utenti";
/** Campi che non sono segreti: stanno nel dettaglio. Tutti gli altri si leggono solo con `leggiCampo`. */
const IN_VISTA = new Set(["titolo", "username", "url", "notes", "da-ref"]);
/** Il gruppo dove finisce una voce cancellata: da lì si ripristina o si cancella per sempre. */
export const CESTINO = "cestino";
const PASSWORD_CORTA = 10;
const no = (stato: number, errore: string): { ok: false; stato: number; errore: string } => ({ ok: false, stato, errore });

export interface VoceElenco {
  percorso: string;
  gruppo: string;
  titolo: string;
  utente: string;
  url: string;
  versione: number;
  /** Cosa non va nella password, senza dirla: `debole` (corta), `doppia` (uguale a quella di un'altra voce). */
  segni: string[];
}

export interface VoceDettaglio extends VoceElenco {
  note: string;
  /** I nomi dei campi segreti che la voce ha (`password`, `pin`…): mai i valori. */
  segreti: string[];
  /** Quante versioni di prima ci sono nello storico. */
  versioniPrima: number;
  /** Per una voce nel cestino: il gruppo da cui viene. */
  provenienza: string | null;
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
  return { percorso, gruppo: pezzi.slice(0, -1).join("/"), titolo: v.titolo || pezzi[pezzi.length - 1], utente: v.username ?? "", url: v.url ?? "", versione: a.versione(percorso), segni: [] };
}

/** Dopo ogni scrittura riuscita: una copia cifrata verso la chiave di recupero (se c'è). Non fa fallire la scrittura. */
async function copiaDopoScrittura(chi: Persona, op: { indirizzo?: string | null; ora?: number }): Promise<void> {
  const aperta = chiaveAperta(chi.id, { ora: op.ora, tocca: false });
  if (aperta) await faiCopia(aperta.chiave, { adesso: new Date(op.ora ?? Date.now()), chi, indirizzo: op.indirizzo });
}

export async function elencoVoci(chi: Persona, op: { ora?: number } = {}): Promise<Esito<{ voci: VoceElenco[] }>> {
  const r = await conArchivio(chi, false, op.ora, (a) => {
    const lette = a.elenca().map((p) => ({ p, v: a.leggi(p) }));
    // Le password si guardano qui, in memoria, solo per contare: fuori escono i segni, mai i valori.
    const quante = new Map<string, number>();
    for (const { p, v } of lette) if (v.password && !p.startsWith(`${CESTINO}/`)) quante.set(v.password, (quante.get(v.password) ?? 0) + 1);
    return lette.map(({ p, v }) => {
      const x = riga(a, p, v);
      if (v.password && !p.startsWith(`${CESTINO}/`)) {
        if (v.password.length < PASSWORD_CORTA) x.segni.push("debole");
        if ((quante.get(v.password) ?? 0) > 1) x.segni.push("doppia");
      }
      return x;
    });
  });
  return r.ok ? { ok: true, voci: r.dato.sort((x, y) => x.gruppo.localeCompare(y.gruppo) || x.titolo.localeCompare(y.titolo)) } : r;
}

export async function dettaglioVoce(chi: Persona, percorso: string, op: { ora?: number } = {}): Promise<Esito<{ voce: VoceDettaglio }>> {
  const r = await conArchivio(chi, false, op.ora, (a) => {
    const v = a.leggi(percorso);
    return { ...riga(a, percorso, v), note: v.notes ?? "", segreti: Object.keys(v).filter((k) => !IN_VISTA.has(k) && v[k] !== "").sort(), versioniPrima: a.storico(percorso).length, provenienza: v["da-ref"] || null };
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
  await copiaDopoScrittura(chi, op);
  return { ok: true, percorso, versione: r.dato };
}

/**
 * Cancella una voce: la prima volta la mette nel **cestino** (ricordando da dove viene), da lì la toglie per sempre.
 */
export async function cancellaVoce(chi: Persona, percorso: string, op: { versioneAttesa?: number; indirizzo?: string | null; ora?: number } = {}): Promise<Esito<{ nelCestino: boolean }>> {
  if (!percorso.startsWith(`${CESTINO}/`)) {
    const r = await spostaVoce(chi, { percorso, gruppo: CESTINO, versioneAttesa: op.versioneAttesa }, op);
    return r.ok ? { ok: true, nelCestino: true } : r;
  }
  const r = await conArchivio(chi, true, op.ora, async (a) => {
    a.cancella(percorso, { versioneAttesa: op.versioneAttesa });
    await a.salva();
    return true;
  });
  if (!r.ok) return r;
  scriviRegistroArchivio({ azione: "voce_cancellata", utente: chi.nome, utenteId: chi.id, da: op.indirizzo ?? null, su: percorso }, new Date(op.ora ?? Date.now()));
  await copiaDopoScrittura(chi, op);
  return { ok: true, nelCestino: false };
}

/**
 * Sposta una voce in un altro gruppo. Nel file è una voce nuova con gli stessi valori e la vecchia tolta: lo storico
 * delle versioni di prima non la segue. Verso il cestino ricorda il gruppo di partenza.
 */
export async function spostaVoce(chi: Persona, d: { percorso: string; gruppo: string; versioneAttesa?: number }, op: { indirizzo?: string | null; ora?: number } = {}): Promise<Esito<{ percorso: string }>> {
  const pezzi = d.percorso.split("/");
  const ultimo = pezzi[pezzi.length - 1];
  const daGruppo = pezzi.slice(0, -1).join("/");
  const gruppo = d.gruppo.split("/").map(pezzoDiGruppo).filter(Boolean).slice(0, 6).join("/");
  if (!gruppo) return no(400, "Manca il gruppo di destinazione");
  if (gruppo === daGruppo) return no(400, "La voce è già in quel gruppo");
  const nuovo = `${gruppo}/${ultimo}`;
  const r = await conArchivio(chi, true, op.ora, async (a) => {
    const valori = { ...a.leggi(d.percorso) };
    if (gruppo === CESTINO) valori["da-ref"] = daGruppo;
    else delete valori["da-ref"];
    a.scrivi(nuovo, valori, { versioneAttesa: 0 });
    a.cancella(d.percorso, { versioneAttesa: d.versioneAttesa });
    await a.salva();
    return true;
  });
  if (!r.ok) return r;
  scriviRegistroArchivio({ azione: "voce_spostata", utente: chi.nome, utenteId: chi.id, da: op.indirizzo ?? null, su: d.percorso, dettaglio: `verso ${gruppo}` }, new Date(op.ora ?? Date.now()));
  await copiaDopoScrittura(chi, op);
  return { ok: true, percorso: nuovo };
}

export interface VersionePrima {
  /** 1 = la versione subito prima di quella corrente. */
  indietro: number;
  titolo: string;
  utente: string;
  url: string;
  note: string;
  segreti: string[];
}

/** Le versioni di prima di una voce, dalla più recente: i campi in vista e i NOMI dei segreti, mai i valori. */
export async function storicoVoce(chi: Persona, percorso: string, op: { ora?: number } = {}): Promise<Esito<{ versioni: VersionePrima[] }>> {
  const r = await conArchivio(chi, false, op.ora, (a) => a.storico(percorso).map((v, i) => ({ indietro: i + 1, titolo: v.titolo ?? "", utente: v.username ?? "", url: v.url ?? "", note: v.notes ?? "", segreti: Object.keys(v).filter((k) => !IN_VISTA.has(k) && v[k] !== "").sort() })));
  return r.ok ? { ok: true, versioni: r.dato } : r;
}

/** Rimette com'era una versione di prima: diventa una versione nuova, quella corrente va nello storico. */
export async function ripristinaVersione(chi: Persona, d: { percorso: string; indietro: number; versioneAttesa?: number }, op: { indirizzo?: string | null; ora?: number } = {}): Promise<Esito<{ versione: number }>> {
  const r = await conArchivio(chi, true, op.ora, async (a) => {
    const prima = a.storico(d.percorso)[d.indietro - 1];
    if (!prima) return null;
    const versione = a.scrivi(d.percorso, prima, { versioneAttesa: d.versioneAttesa });
    await a.salva();
    return versione;
  });
  if (!r.ok) return r;
  if (r.dato === null) return no(404, "Quella versione non c'è più nello storico");
  scriviRegistroArchivio({ azione: "voce_ripristinata", utente: chi.nome, utenteId: chi.id, da: op.indirizzo ?? null, su: d.percorso, dettaglio: `versione di ${d.indietro} prima` }, new Date(op.ora ?? Date.now()));
  await copiaDopoScrittura(chi, op);
  return { ok: true, versione: r.dato };
}

export interface VoceDaImportare {
  gruppo: string;
  titolo: string;
  valori: ValoriVoce;
}

/** Scrive molte voci nuove con un solo salvataggio (importazione). Dà quante ne ha scritte. */
export async function scriviMolte(chi: Persona, voci: readonly VoceDaImportare[], op: { indirizzo?: string | null; ora?: number } = {}): Promise<Esito<{ scritte: number }>> {
  if (voci.length === 0) return { ok: true, scritte: 0 };
  const r = await conArchivio(chi, true, op.ora, async (a) => {
    let n = 0;
    for (const v of voci) {
      const gruppo = v.gruppo.split("/").map(pezzoDiGruppo).filter(Boolean).slice(0, 6).join("/") || "importati";
      const valori: ValoriVoce = {};
      for (const [k, x] of Object.entries(v.valori)) if (x !== "" && /^[a-z0-9._-]{1,64}$/.test(k)) valori[k] = x;
      valori.titolo = v.titolo.trim().slice(0, 120) || "senza titolo";
      a.scrivi(`${gruppo}/${segmento(valori.titolo)}-${crypto.randomBytes(3).toString("hex")}`, valori, { versioneAttesa: 0 });
      n += 1;
    }
    await a.salva();
    return n;
  });
  if (!r.ok) return r;
  scriviRegistroArchivio({ azione: "voci_importate", utente: chi.nome, utenteId: chi.id, da: op.indirizzo ?? null, dettaglio: `${r.dato} voci` }, new Date(op.ora ?? Date.now()));
  await copiaDopoScrittura(chi, op);
  return { ok: true, scritte: r.dato };
}
