/**
 * Banco di parità fra le due copie delle funzioni dati (NUC-2).
 *
 * `db.ts` e `db-tenant.ts` hanno ciascuno la propria copia di molte funzioni,
 * e le copie si sono separate nel tempo. Prima di sostituirne una con una
 * riesportazione dell'altra si dimostra che fanno la stessa cosa: due tenant
 * temporanei, la stessa fixture, la funzione della facciata sul primo e quella
 * tenant sul secondo; poi si confrontano il valore restituito e il contenuto
 * delle tabelle toccate.
 *
 * Gira su tenant temporanei: il file di prova importa per primo
 * `../support/data-dir-isolata`.
 */
import type Database from "better-sqlite3";
import { withTenant, getTenantDb, deleteTenantDatabase } from "@/lib/db-tenant";

export interface CasoParita<R> {
  /** Nome breve del caso, entra nel codice dei tenant temporanei. */
  nome: string;
  /** Stessi dati su entrambi i tenant (gli id coincidono: i due database partono vuoti). */
  fixture: (db: Database.Database) => void;
  /** La copia della facciata (`@/lib/db`, o la sua copia congelata se già spostata), eseguita nel contesto del tenant A. */
  facciata: () => R;
  /** La copia tenant (`@/lib/db-tenant`), eseguita nel contesto del tenant B. */
  tenant: () => R;
  /**
   * Le due funzioni confrontate, come oggetti. Se sono lo stesso oggetto (la
   * facciata ormai riesporta la copia tenant) il confronto non può fallire e il
   * banco lo rifiuta: dopo lo spostamento si confronta con la copia della
   * vecchia facciata congelata nel test (revisione 2026-10-12).
   */
  funzioni: readonly [unknown, unknown];
  /** Tabelle da confrontare dopo la chiamata. */
  tabelle: string[];
  /**
   * Colonne scritte con l'ora corrente (`datetime('now')`): si confrontano come
   * distanza da adesso in minuti, perché le due chiamate non cadono nello
   * stesso secondo.
   */
  colonneOra?: string[];
  /**
   * Colonne con un valore casuale (un `randomUUID()`): si confrontano solo come
   * «presente» o «assente», perché due chiamate non generano lo stesso valore.
   */
  colonneCasuali?: string[];
}

export interface EsitoParita<R> {
  valoreFacciata: R;
  valoreTenant: R;
  tabelleFacciata: Record<string, unknown[]>;
  tabelleTenant: Record<string, unknown[]>;
}

function minutiDaAdesso(v: unknown): unknown {
  if (typeof v !== "string") return v;
  // Due forme: quella di SQLite (`2026-10-13 09:00:00`, UTC senza zona) e l'ISO
  // di `toISOString()` (`2026-10-13T09:00:00.000Z`).
  const ms = Date.parse(/[zZ]$|[+-]\d\d:\d\d$/.test(v) ? v : v.replace(" ", "T") + "Z");
  if (Number.isNaN(ms)) return v;
  const minuti = Math.round((ms - Date.now()) / 60_000);
  return `ora${minuti >= 0 ? "+" : ""}${minuti}min`;
}

interface Normalizza {
  colonneOra: string[];
  colonneCasuali: string[];
}

function normalizzaRiga(r: Record<string, unknown>, n: Normalizza): Record<string, unknown> {
  const copia: Record<string, unknown> = { ...r };
  for (const c of n.colonneOra) if (c in copia) copia[c] = minutiDaAdesso(copia[c]);
  for (const c of n.colonneCasuali) if (c in copia) copia[c] = copia[c] == null ? copia[c] : "<casuale>";
  return copia;
}

/** Il valore restituito passa dalla stessa normalizzazione delle tabelle (righe singole e liste di righe). */
function normalizzaValore(v: unknown, n: Normalizza): unknown {
  if (Array.isArray(v)) return v.map((x) => normalizzaValore(x, n));
  if (v && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype) {
    const riga = normalizzaRiga(v as Record<string, unknown>, n);
    for (const [k, x] of Object.entries(riga)) if (x && typeof x === "object") riga[k] = normalizzaValore(x, n);
    return riga;
  }
  return v;
}

function dump(db: Database.Database, tabelle: string[], n: Normalizza): Record<string, unknown[]> {
  const out: Record<string, unknown[]> = {};
  for (const t of tabelle) {
    const righe = db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all() as Record<string, unknown>[];
    out[t] = righe.map((r) => normalizzaRiga(r, n));
  }
  return out;
}

let progressivo = 0;

/** Esegue il caso sui due tenant e restituisce i due esiti; i tenant si cancellano sempre. */
export function eseguiParita<R>(caso: CasoParita<R>): EsitoParita<R> {
  if (caso.funzioni[0] === caso.funzioni[1]) {
    throw new Error(`parità «${caso.nome}»: le due funzioni sono lo stesso oggetto, il confronto non proverebbe niente`);
  }
  progressivo += 1;
  const base = `PARITA${caso.nome.toUpperCase().replace(/[^A-Z0-9]/g, "")}${process.pid}${progressivo}`;
  const a = `${base}A`;
  const b = `${base}B`;
  const norm: Normalizza = { colonneOra: caso.colonneOra ?? [], colonneCasuali: caso.colonneCasuali ?? [] };
  try {
    const lato = (codice: string, chiama: () => R) =>
      withTenant(codice, () => {
        const db = getTenantDb(codice);
        caso.fixture(db);
        const valore = normalizzaValore(chiama(), norm) as R;
        return { valore, tabelle: dump(db, caso.tabelle, norm) };
      });
    const fa = lato(a, caso.facciata);
    const tb = lato(b, caso.tenant);
    return {
      valoreFacciata: fa.valore,
      valoreTenant: tb.valore,
      tabelleFacciata: fa.tabelle,
      tabelleTenant: tb.tabelle,
    };
  } finally {
    deleteTenantDatabase(a);
    deleteTenantDatabase(b);
  }
}
