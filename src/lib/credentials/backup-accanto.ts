/**
 * Backup di un DB accanto al file, prima di scriverci (tappa 2g credenziali,
 * T27: `pulizia-t2.ts` e `togli-chiavi-hub.ts`; vincolo «Zona rossa» del piano
 * 2026-10-15-tappa2-archivio-credenziali).
 *
 * - Con l'API di backup di SQLite (`db.backup()`), mai `cp`: un DB in WAL
 *   copiato a file lascerebbe indietro le righe ancora nel WAL.
 * - Nome `<file>.bak-YYYYMMDD-HHMMSS` con l'ora del server, come
 *   `date +%Y%m%d-%H%M%S` dei backup della procedura R: in un ripristino si
 *   perde quello che è stato scritto dopo quell'ora.
 * - Lo spazio si controlla prima (DB più WAL, più il 10%); un `.bak` che c'è
 *   già non si sovrascrive; la copia si riapre e si controlla
 *   (`quick_check`) prima di dire che c'è.
 *
 * Modulo puro: node e l'handle ricevuto, niente `db.ts` né `db-tenant.ts`.
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

export interface Backup {
  percorso: string;
  byte: number;
  quando: Date;
}

const due = (n: number) => String(n).padStart(2, "0");

/** `<file>.bak-YYYYMMDD-HHMMSS`, con l'ora locale del server. */
export function nomeBackup(file: string, quando: Date): string {
  const giorno = `${quando.getFullYear()}${due(quando.getMonth() + 1)}${due(quando.getDate())}`;
  const ora = `${due(quando.getHours())}${due(quando.getMinutes())}${due(quando.getSeconds())}`;
  return `${file}.bak-${giorno}-${ora}`;
}

/** L'ora italiana di un istante (i server scrivono in UTC): per il terminale. */
export function oraItaliana(d: Date): string {
  return d.toLocaleString("it-IT", { timeZone: "Europe/Rome", dateStyle: "short", timeStyle: "medium" });
}

function dimensione(file: string): number {
  let n = 0;
  for (const f of [file, `${file}-wal`]) {
    try {
      n += fs.statSync(f).size;
    } catch {
      /* il WAL può mancare: DB chiuso e già riportato */
    }
  }
  return n;
}

function liberoIn(cartella: string): number {
  const st = fs.statfsSync(cartella);
  return st.bavail * st.bsize;
}

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;

/**
 * Copia `dbh` (aperto su `file`) in `<file>.bak-…`. Lancia, senza lasciare
 * mezzo file, se lo spazio non basta, se il `.bak` c'è già o se la copia non
 * si rilegge. `libero`: lo spazio libero di una cartella (le prove lo
 * sostituiscono).
 */
export async function backupAccanto(
  dbh: Database.Database,
  file: string,
  opzioni: { quando?: Date; libero?: (cartella: string) => number } = {},
): Promise<Backup> {
  const quando = opzioni.quando ?? new Date();
  const percorso = nomeBackup(file, quando);
  if (fs.existsSync(percorso)) throw new Error(`Il backup ${percorso} esiste già: non lo sovrascrivo`);
  const serve = Math.ceil(dimensione(file) * 1.1);
  const cartella = path.dirname(file);
  const libero = (opzioni.libero ?? liberoIn)(cartella);
  if (libero < serve) throw new Error(`Spazio libero insufficiente in ${cartella} per il backup: servono ${mb(serve)}, liberi ${mb(libero)}`);
  try {
    await dbh.backup(percorso);
    fs.chmodSync(percorso, 0o600);
    const copia = new Database(percorso, { readonly: true, fileMustExist: true });
    try {
      const esito = copia.pragma("quick_check", { simple: true });
      if (esito !== "ok") throw new Error(`il controllo della copia dice «${String(esito)}»`);
    } finally {
      copia.close();
    }
  } catch (e) {
    fs.rmSync(percorso, { force: true });
    throw new Error(`Backup di ${file} non riuscito: ${e instanceof Error ? e.message : String(e)}`);
  }
  return { percorso, byte: fs.statSync(percorso).size, quando };
}
