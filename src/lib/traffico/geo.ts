/**
 * Paese e fornitore di un indirizzo esterno (23/11/2026, tappa 4 dei «dati in più»).
 *
 * L'archivio è DB-IP Lite (paese e sistema autonomo), licenza Creative Commons Attribution 4.0:
 * la pagina che lo usa deve citare «IP Geolocation by DB-IP» (https://db-ip.com).
 *
 * Regola da non rompere: **mai una richiesta a un servizio esterno con dentro un indirizzo**. Si scarica
 * l'archivio intero del mese (la richiesta non porta nessun dato dell'installazione) e si cerca in locale.
 * Sta in un file a sé nella cartella dei dati (`geo/dbip.db`), uguale per tutti i clienti dell'installazione,
 * fuori dai database dei tenant. Solo IPv4. Senza archivio le ricerche danno null: niente paese, niente avvisi.
 */
import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { createGunzip } from "node:zlib";
import { resolveDataDir } from "@/lib/data-dir";
import { unisci } from "@/lib/percorsi";

export const ATTRIBUZIONE = "IP Geolocation by DB-IP";
export const ATTRIBUZIONE_URL = "https://db-ip.com";
const BASE = "https://download.db-ip.com/free";
const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const numero = (ip: string): number => ip.split(".").reduce((n, p) => n * 256 + Number(p), 0);

export interface Geo { paese: string | null; asn: number | null; fornitore: string | null }
export interface StatoGeo { presente: boolean; mese: string | null; scaricato_il: string | null; paesi: number; fornitori: number; attribuzione: string; attribuzione_url: string }

let aperto: { percorso: string; db: Database.Database } | null = null;

function percorsoGeo(): string {
  return unisci(resolveDataDir(), "geo", "dbip.db");
}

function apri(crea: boolean): Database.Database | null {
  const percorso = percorsoGeo();
  if (aperto && aperto.percorso === percorso) return aperto.db;
  if (!crea && !existsSync(percorso)) return null;
  mkdirSync(unisci(resolveDataDir(), "geo"), { recursive: true });
  const db = new Database(percorso);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS paese (inizio INTEGER PRIMARY KEY, fine INTEGER NOT NULL, paese TEXT NOT NULL) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS asn (inizio INTEGER PRIMARY KEY, fine INTEGER NOT NULL, numero INTEGER NOT NULL, nome TEXT NOT NULL) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS meta (chiave TEXT PRIMARY KEY, valore TEXT NOT NULL);`);
  aperto = { percorso, db };
  return db;
}

/** Chiude il file (serve alle prove, che cambiano cartella dei dati). */
export function chiudiGeo(): void {
  aperto?.db.close();
  aperto = null;
}

/** Una riga CSV di DB-IP: campi separati da virgola, il nome del fornitore fra virgolette (con `""` per una virgoletta). */
export function campiCsv(riga: string): string[] {
  const campi: string[] = [];
  let i = 0;
  while (i <= riga.length) {
    if (riga[i] === '"') {
      let v = "";
      i++;
      while (i < riga.length && !(riga[i] === '"' && riga[i + 1] !== '"')) {
        if (riga[i] === '"') i++;
        v += riga[i++];
      }
      campi.push(v);
      i += 2;
    } else {
      const fine = riga.indexOf(",", i);
      campi.push(riga.slice(i, fine < 0 ? riga.length : fine));
      i = (fine < 0 ? riga.length : fine) + 1;
    }
  }
  return campi;
}

/** Mette in archivio le righe di un CSV (paese: `inizio,fine,IT`; fornitore: `inizio,fine,1234,"Nome"`). Le righe IPv6 si saltano. Ritorna quante ne ha tenute. */
export async function importaGeo(tipo: "paese" | "asn", righe: AsyncIterable<string> | Iterable<string>, minimo = 10000): Promise<number> {
  const db = apri(true)!;
  const nuova = `${tipo}_nuova`;
  db.exec(`DROP TABLE IF EXISTS ${nuova}`);
  db.exec(tipo === "paese"
    ? `CREATE TABLE ${nuova} (inizio INTEGER PRIMARY KEY, fine INTEGER NOT NULL, paese TEXT NOT NULL) WITHOUT ROWID`
    : `CREATE TABLE ${nuova} (inizio INTEGER PRIMARY KEY, fine INTEGER NOT NULL, numero INTEGER NOT NULL, nome TEXT NOT NULL) WITHOUT ROWID`);
  const ins = db.prepare(tipo === "paese" ? `INSERT OR REPLACE INTO ${nuova} VALUES (?, ?, ?)` : `INSERT OR REPLACE INTO ${nuova} VALUES (?, ?, ?, ?)`);
  let tenute = 0;
  let blocco: (string | number)[][] = [];
  const scrivi = db.transaction((b: (string | number)[][]) => { for (const v of b) ins.run(...v); });
  for await (const riga of righe) {
    const c = campiCsv(riga);
    if (!IPV4.test(c[0] ?? "") || !IPV4.test(c[1] ?? "")) continue;
    if (tipo === "paese") {
      if (!/^[A-Z]{2}$/.test(c[2] ?? "")) continue;
      blocco.push([numero(c[0]), numero(c[1]), c[2]]);
    } else {
      if (!/^\d{1,10}$/.test(c[2] ?? "")) continue;
      blocco.push([numero(c[0]), numero(c[1]), Number(c[2]), (c[3] ?? "").slice(0, 120)]);
    }
    tenute++;
    if (blocco.length >= 5000) { scrivi(blocco); blocco = []; }
  }
  scrivi(blocco);
  // un archivio vuoto o troncato non sostituisce quello buono
  if (tenute < minimo) {
    db.exec(`DROP TABLE ${nuova}`);
    throw new Error("Archivio scaricato vuoto o troppo corto: tengo quello di prima");
  }
  db.transaction(() => {
    db.exec(`DROP TABLE ${tipo}; ALTER TABLE ${nuova} RENAME TO ${tipo}`);
  })();
  return tenute;
}

async function scarica(nome: string): Promise<AsyncIterable<string>> {
  const r = await fetch(`${BASE}/${nome}`, { signal: AbortSignal.timeout(120_000) });
  if (!r.ok || !r.body) throw new Error(`Archivio non scaricato (${r.status})`);
  return createInterface({ input: Readable.fromWeb(r.body as Parameters<typeof Readable.fromWeb>[0]).pipe(createGunzip()), crlfDelay: Infinity });
}

/** Scarica l'archivio del mese (o del mese prima, se quello nuovo non è ancora uscito) e lo sostituisce al vecchio. */
export async function scaricaGeo(adesso: Date = new Date()): Promise<StatoGeo> {
  let ultimoErrore: unknown = null;
  for (const indietro of [0, 1]) {
    const d = new Date(Date.UTC(adesso.getUTCFullYear(), adesso.getUTCMonth() - indietro, 1));
    const mese = d.toISOString().slice(0, 7);
    try {
      await importaGeo("paese", await scarica(`dbip-country-lite-${mese}.csv.gz`));
      await importaGeo("asn", await scarica(`dbip-asn-lite-${mese}.csv.gz`));
      const db = apri(true)!;
      const metti = db.prepare("INSERT INTO meta (chiave, valore) VALUES (?, ?) ON CONFLICT(chiave) DO UPDATE SET valore = excluded.valore");
      metti.run("mese", mese);
      metti.run("scaricato_il", new Date().toISOString().slice(0, 19).replace("T", " "));
      return statoGeo();
    } catch (e) {
      ultimoErrore = e;
    }
  }
  throw ultimoErrore instanceof Error ? ultimoErrore : new Error("Archivio non scaricato");
}

export function statoGeo(): StatoGeo {
  const db = apri(false);
  const base = { attribuzione: ATTRIBUZIONE, attribuzione_url: ATTRIBUZIONE_URL };
  if (!db) return { presente: false, mese: null, scaricato_il: null, paesi: 0, fornitori: 0, ...base };
  const meta = new Map((db.prepare("SELECT chiave, valore FROM meta").all() as { chiave: string; valore: string }[]).map((m) => [m.chiave, m.valore]));
  const paesi = (db.prepare("SELECT COUNT(*) AS n FROM paese").get() as { n: number }).n;
  const fornitori = (db.prepare("SELECT COUNT(*) AS n FROM asn").get() as { n: number }).n;
  return { presente: paesi > 0, mese: meta.get("mese") ?? null, scaricato_il: meta.get("scaricato_il") ?? null, paesi, fornitori, ...base };
}

/** Prepara una ricerca per molti indirizzi (una vista intera): le due query si compilano una volta. */
export function creaCercaGeo(): (ip: string) => Geo {
  const db = apri(false);
  const niente: Geo = { paese: null, asn: null, fornitore: null };
  if (!db) return () => niente;
  const qp = db.prepare("SELECT fine, paese FROM paese WHERE inizio <= ? ORDER BY inizio DESC LIMIT 1");
  const qa = db.prepare("SELECT fine, numero, nome FROM asn WHERE inizio <= ? ORDER BY inizio DESC LIMIT 1");
  const memo = new Map<string, Geo>();
  return (ip) => {
    if (!IPV4.test(ip)) return niente;
    let g = memo.get(ip);
    if (!g) {
      const n = numero(ip);
      const p = qp.get(n) as { fine: number; paese: string } | undefined;
      const a = qa.get(n) as { fine: number; numero: number; nome: string } | undefined;
      g = { paese: p && p.fine >= n ? p.paese : null, asn: a && a.fine >= n ? a.numero : null, fornitore: a && a.fine >= n ? a.nome : null };
      memo.set(ip, g);
    }
    return g;
  };
}
