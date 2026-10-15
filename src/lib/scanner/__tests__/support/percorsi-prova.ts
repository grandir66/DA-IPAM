// Controllo dei percorsi della prova dei giri sovrapposti (T3-22).
//
// La prova scrive su una copia del database di un tenant vero. Prima di partire
// si verifica che tutto ciò che può essere scritto — la cartella dei dati, l'hub
// di prova, la copia — stia dentro la cartella di lavoro dichiarata, e che la
// cartella di lavoro non sia il repo né una cartella di dati in esercizio. Un
// percorso sbagliato in un argomento non deve poter arrivare al DB vero.
//
// Modulo leggero, senza dipendenze dal resto dell'app: lo script lo usa PRIMA di
// impostare l'ambiente e di caricare i moduli del database.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface PercorsiProva {
  /** Cartella di lavoro della prova (lo scratchpad). */
  scratchpad: string;
  /** Il database da copiare (già una copia del tenant vero). */
  sorgente: string;
  /** DA_INVENT_DATA_DIR della prova: la copia della copia finisce in `tenants/`. */
  dataDir: string;
  /** Hub di prova (DA_IPAM_HUB_DB_PATH). */
  hubDb: string;
  /** Radice del repo: la cartella di lavoro non può stare lì dentro. */
  repo: string;
}

/** Percorso reale anche se il file non esiste ancora (risolve la cartella più vicina che esiste). */
export function percorsoReale(p: string): string {
  const assoluto = path.resolve(p);
  const coda: string[] = [];
  let corrente = assoluto;
  for (;;) {
    try {
      const reale = fs.realpathSync(corrente);
      return coda.length ? path.join(reale, ...coda.reverse()) : reale;
    } catch {
      const su = path.dirname(corrente);
      if (su === corrente) return assoluto;
      coda.push(path.basename(corrente));
      corrente = su;
    }
  }
}

function dentro(figlio: string, padre: string): boolean {
  const rel = path.relative(padre, figlio);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/** Radici temporanee ammesse per la cartella di lavoro. */
function radiciTemporanee(): string[] {
  return [...new Set([os.tmpdir(), "/tmp", "/private/tmp"].map(percorsoReale))];
}

/**
 * Restituisce l'elenco dei motivi per cui la prova NON deve partire (vuoto = si parte).
 */
export function controllaPercorsi(p: PercorsiProva): string[] {
  const errori: string[] = [];
  const scratch = percorsoReale(p.scratchpad);
  const repo = percorsoReale(p.repo);

  if (!fs.existsSync(scratch) || !fs.statSync(scratch).isDirectory()) {
    errori.push("la cartella di lavoro non esiste");
  }
  if (!radiciTemporanee().some((r) => dentro(scratch, r))) {
    errori.push("la cartella di lavoro non sta in una cartella temporanea");
  }
  if (scratch === repo || dentro(scratch, repo)) {
    errori.push("la cartella di lavoro sta dentro il repo");
  }

  const voci: Array<[string, string]> = [
    ["database sorgente", p.sorgente],
    ["cartella dei dati", p.dataDir],
    ["hub di prova", p.hubDb],
  ];
  for (const [nome, valore] of voci) {
    if (!dentro(percorsoReale(valore), scratch)) errori.push(`${nome} fuori dalla cartella di lavoro`);
  }

  if (!fs.existsSync(p.sorgente) || !fs.statSync(p.sorgente).isFile()) {
    errori.push("database sorgente assente");
  }
  // La cartella dei dati nasce vuota: niente tenant di un giro precedente, e la
  // sorgente non può stare dentro (la copia la sovrascriverebbe).
  if (fs.existsSync(p.dataDir) && fs.readdirSync(p.dataDir).length > 0) {
    errori.push("la cartella dei dati non è vuota");
  }
  if (dentro(percorsoReale(p.sorgente), percorsoReale(p.dataDir))) {
    errori.push("il database sorgente sta dentro la cartella dei dati");
  }
  return errori;
}

/**
 * Esito dell'integrità di una copia prima e dopo una misura (`PRAGMA integrity_check`, righe già pulite di vuoti e
 * dell'intestazione «*** in database main ***»). Lo usa `scripts/misura-migrazione-cavi.ts`. Prima: solo «ok» o pagine
 * mai usate (spazio non referenziato della copia: l'hub ne ha 4), altrimenti la copia è già rovinata e non si misura.
 * Dopo: IDENTICA a prima, riga per riga. Una «Page N: never used» nata con l'apertura è del codice nuovo, non della copia
 * (revisione del Task 1 di T2: prima si accettava qualunque «never used», anche nuova).
 */
export function integritaInvariata(prima: readonly string[], dopo: readonly string[]): boolean {
  const accettabile = (x: string) => x === "ok" || /^Page \d+: never used$/.test(x);
  return prima.every(accettabile) && dopo.length === prima.length && dopo.every((x, i) => x === prima[i]);
}
