/**
 * I tentativi di accesso non riusciti, da tutte le strade, in un solo registro (Protezione, tappa 3; piano §4.7).
 * Una riga JSONL per tentativo in `<DATA_DIR>/audit/tentativi-YYYY-MM-DD.jsonl`. Mai una password: solo quando,
 * da dove, su quale strada e il nome provato (tagliato). Le funzioni che aggregano e decidono gli avvisi sono
 * pure; scrivere e leggere i file sta in fondo.
 */
import fs from "node:fs";
import { resolveDataDir } from "../data-dir";
import { unisci } from "../percorsi";

export type Fonte = "pagina" | "ssh" | "filtro";
export const NOME_FONTE: Readonly<Record<Fonte, string>> = { pagina: "Pagina web", ssh: "SSH", filtro: "Filtro di rete" };

export interface Tentativo {
  il: string;
  fonte: Fonte;
  /** `null` quando la strada non lo dice (un login arrivato senza l'indirizzo passato da nginx). */
  indirizzo: string | null;
  utente?: string;
  porta?: number;
  /** Cosa è successo, in due parole: «password sbagliata», «utente inesistente», «scartato». */
  cosa: string;
}

export const GIORNI_TENTATIVI = 90;

// ── SSH: le righe del journal di sshd ────────────────────────────────────────

/**
 * Le righe di sshd che dicono un tentativo con un nome. NON contano «Connection closed by IP [preauth]» senza
 * utente: sono le sonde che guardano se la porta risponde (sull'hub, migliaia a settimana dal monitoraggio), e
 * «…from invalid user X», che ripete la riga «Invalid user X from» dello stesso tentativo.
 */
const RIGHE_SSH: ReadonlyArray<readonly [RegExp, string]> = [
  [/Failed (?:password|publickey|keyboard-interactive\/pam|none) for (?:invalid user )?(\S*) from (\S+) port \d+/, "accesso rifiutato"],
  [/Invalid user (\S*) from (\S+) port \d+/, "utente inesistente"],
  [/(?:Disconnected from|Connection closed by) authenticating user (\S+) (\S+) port \d+/, "accesso non completato"],
];

/** Una riga del journal in forma `short-iso` (`2026-11-25T18:13:53+00:00 host sshd[1]: …`) → tentativo, o `null`. */
export function tentativoDaRigaSsh(riga: string): Tentativo | null {
  const m = /^(\d{4}-\d{2}-\d{2}T[\d:.]+(?:[+-]\d{2}:?\d{2}|Z)) \S+ sshd(?:-session)?\[\d+\]: (.*)$/.exec(riga);
  if (!m) return null;
  const quando = new Date(m[1]);
  if (Number.isNaN(quando.getTime())) return null;
  for (const [re, cosa] of RIGHE_SSH) {
    const t = re.exec(m[2]);
    if (t) return { il: quando.toISOString(), fonte: "ssh", indirizzo: t[2], utente: t[1].slice(0, 64), porta: 22, cosa };
  }
  return null;
}

// ── Aggregazione e soglie ────────────────────────────────────────────────────

export interface Aggregato {
  fonte: Fonte;
  indirizzo: string | null;
  quanti: number;
  primo: string;
  ultimo: string;
  /** I nomi provati, al più cinque. */
  utenti: string[];
  porte: number[];
}

/** Una riga per strada e indirizzo, la più recente in cima. */
export function aggrega(tentativi: readonly Tentativo[]): Aggregato[] {
  const mappa = new Map<string, Aggregato>();
  for (const t of tentativi) {
    const k = `${t.fonte}|${t.indirizzo ?? ""}`;
    let a = mappa.get(k);
    if (!a) {
      a = { fonte: t.fonte, indirizzo: t.indirizzo, quanti: 0, primo: t.il, ultimo: t.il, utenti: [], porte: [] };
      mappa.set(k, a);
    }
    a.quanti += 1;
    if (t.il < a.primo) a.primo = t.il;
    if (t.il > a.ultimo) a.ultimo = t.il;
    if (t.utente && !a.utenti.includes(t.utente) && a.utenti.length < 5) a.utenti.push(t.utente);
    if (t.porta !== undefined && !a.porte.includes(t.porta)) a.porte.push(t.porta);
  }
  return [...mappa.values()].sort((a, b) => b.ultimo.localeCompare(a.ultimo));
}

/** Soglie di avviso nella finestra: quanti tentativi (pagina, SSH) o quante porte diverse (filtro). */
export const FINESTRA_MS = 10 * 60_000;
export const SOGLIA: Readonly<Record<Fonte, number>> = { pagina: 5, ssh: 5, filtro: 3 };
/** Dopo un avviso, per quanto non se ne manda un altro per la stessa strada e lo stesso indirizzo. */
export const SILENZIO_MS = 60 * 60_000;

export interface Avviso {
  chiave: string;
  aggregato: Aggregato;
  testo: string;
}

/**
 * Chi ha superato la soglia nella finestra che finisce `adesso`, tolti quelli già avvisati di recente e gli
 * indirizzi nostri (la macchina stessa: lo Scanner-Edge prova le credenziali anche su di lei).
 */
export function daAvvisare(tentativi: readonly Tentativo[], adesso: Date, avvisati: Readonly<Record<string, string>>, nostri: ReadonlySet<string>): Avviso[] {
  const da = new Date(adesso.getTime() - FINESTRA_MS).toISOString();
  const recenti = tentativi.filter((t) => t.il >= da && t.il <= adesso.toISOString());
  const avvisi: Avviso[] = [];
  for (const a of aggrega(recenti)) {
    if (a.indirizzo && nostri.has(a.indirizzo)) continue;
    const misura = a.fonte === "filtro" ? a.porte.length : a.quanti;
    if (misura < SOGLIA[a.fonte]) continue;
    const chiave = `${a.fonte}|${a.indirizzo ?? ""}`;
    const ultimo = avvisati[chiave];
    if (ultimo && adesso.getTime() - new Date(ultimo).getTime() < SILENZIO_MS) continue;
    const da_dove = a.indirizzo ?? "indirizzo non noto";
    const testo =
      a.fonte === "filtro"
        ? `${da_dove} ha provato ${a.porte.length} porte chiuse dal filtro in 10 minuti (${a.porte.slice(0, 8).join(", ")}).`
        : `${a.quanti} tentativi falliti su ${NOME_FONTE[a.fonte]} da ${da_dove} in 10 minuti${a.utenti.length ? ` (nomi provati: ${a.utenti.join(", ")})` : ""}.`;
    avvisi.push({ chiave, aggregato: a, testo });
  }
  return avvisi;
}

// ── File ─────────────────────────────────────────────────────────────────────

const dirAudit = (): string => unisci(resolveDataDir(), "audit");

/** Non lancia: un disco pieno non deve far fallire un login o un giro. Si vede nel journal. */
export function scriviTentativi(tentativi: readonly Tentativo[]): void {
  if (tentativi.length === 0) return;
  try {
    const dir = dirAudit();
    fs.mkdirSync(dir, { recursive: true });
    const perGiorno = new Map<string, string[]>();
    for (const t of tentativi) perGiorno.set(t.il.slice(0, 10), [...(perGiorno.get(t.il.slice(0, 10)) ?? []), JSON.stringify(t)]);
    for (const [giorno, righe] of perGiorno) fs.appendFileSync(unisci(dir, `tentativi-${giorno}.jsonl`), `${righe.join("\n")}\n`);
  } catch (e) {
    console.error("[tentativi] registro non scritto:", e);
  }
}

/** I tentativi degli ultimi `giorni`, dal più vecchio; al più `tetto` righe (le più recenti). */
export function leggiTentativi(giorni: number, adesso = new Date(), tetto = 20000): Tentativo[] {
  const dir = dirAudit();
  const soglia = new Date(adesso.getTime() - giorni * 86_400_000).toISOString().slice(0, 10);
  let file: string[];
  try {
    file = fs.readdirSync(dir).filter((f) => /^tentativi-\d{4}-\d{2}-\d{2}\.jsonl$/.test(f) && f.slice(10, 20) >= soglia).sort();
  } catch {
    return [];
  }
  const righe: Tentativo[] = [];
  for (const f of file) {
    for (const r of fs.readFileSync(unisci(dir, f), "utf8").split("\n")) {
      if (!r) continue;
      try {
        const t = JSON.parse(r) as Tentativo;
        if (typeof t.il === "string" && (t.fonte === "pagina" || t.fonte === "ssh" || t.fonte === "filtro")) righe.push(t);
      } catch {
        // una riga rotta non ferma la lettura delle altre
      }
    }
  }
  return righe.slice(-tetto);
}

/** Toglie i file più vecchi di `GIORNI_TENTATIVI`. */
export function pulisciTentativi(adesso = new Date()): void {
  try {
    const soglia = new Date(adesso.getTime() - GIORNI_TENTATIVI * 86_400_000).toISOString().slice(0, 10);
    for (const f of fs.readdirSync(dirAudit())) {
      const m = /^tentativi-(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(f);
      if (m && m[1] < soglia) fs.rmSync(unisci(dirAudit(), f), { force: true });
    }
  } catch {
    // la cartella può non esserci ancora
  }
}
