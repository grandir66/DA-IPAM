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
 * Gira su tenant temporanei: lanciare con DA_INVENT_DATA_DIR di prova.
 */
import type Database from "better-sqlite3";
import { withTenant, getTenantDb, deleteTenantDatabase } from "@/lib/db-tenant";

export interface CasoParita<R> {
  /** Nome breve del caso, entra nel codice dei tenant temporanei. */
  nome: string;
  /** Stessi dati su entrambi i tenant (gli id coincidono: i due database partono vuoti). */
  fixture: (db: Database.Database) => void;
  /** La copia della facciata (`@/lib/db`), eseguita nel contesto del tenant A. */
  facciata: () => R;
  /** La copia tenant (`@/lib/db-tenant`), eseguita nel contesto del tenant B. */
  tenant: () => R;
  /** Tabelle da confrontare dopo la chiamata. */
  tabelle: string[];
  /**
   * Colonne scritte con l'ora corrente (`datetime('now')`): si confrontano come
   * distanza da adesso in minuti, perché le due chiamate non cadono nello
   * stesso secondo.
   */
  colonneOra?: string[];
}

export interface EsitoParita<R> {
  valoreFacciata: R;
  valoreTenant: R;
  tabelleFacciata: Record<string, unknown[]>;
  tabelleTenant: Record<string, unknown[]>;
}

function minutiDaAdesso(v: unknown): unknown {
  if (typeof v !== "string") return v;
  const ms = Date.parse(v.replace(" ", "T") + "Z");
  if (Number.isNaN(ms)) return v;
  const minuti = Math.round((ms - Date.now()) / 60_000);
  return `ora${minuti >= 0 ? "+" : ""}${minuti}min`;
}

function dump(db: Database.Database, tabelle: string[], colonneOra: string[]): Record<string, unknown[]> {
  const out: Record<string, unknown[]> = {};
  for (const t of tabelle) {
    const righe = db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all() as Record<string, unknown>[];
    out[t] = righe.map((r) => {
      const copia: Record<string, unknown> = { ...r };
      for (const c of colonneOra) if (c in copia) copia[c] = minutiDaAdesso(copia[c]);
      return copia;
    });
  }
  return out;
}

let progressivo = 0;

/** Esegue il caso sui due tenant e restituisce i due esiti; i tenant si cancellano sempre. */
export function eseguiParita<R>(caso: CasoParita<R>): EsitoParita<R> {
  progressivo += 1;
  const base = `PARITA${caso.nome.toUpperCase().replace(/[^A-Z0-9]/g, "")}${process.pid}${progressivo}`;
  const a = `${base}A`;
  const b = `${base}B`;
  const colonneOra = caso.colonneOra ?? [];
  try {
    const lato = (codice: string, chiama: () => R) =>
      withTenant(codice, () => {
        const db = getTenantDb(codice);
        caso.fixture(db);
        const valore = chiama();
        return { valore, tabelle: dump(db, caso.tabelle, colonneOra) };
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
