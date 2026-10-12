/**
 * Registro dei ripieghi del facade del database (NUC-1, fase A).
 *
 * Un «ripiego» è un accesso al database che non passa da un contesto tenant:
 *   - `default`: `getDb()` senza contesto, con hub presente, va su DEFAULT.db;
 *   - `legacy`: `getDb()` senza contesto, con hub presente, apre ipam.db;
 *   - `tenant_non_registrato`: `getTenantDb(code)` sta per CREARE il file di un
 *     tenant che l'hub non conosce.
 * In fase A l'esito non cambia: si conta chi lo fa, per sapere chi va corretto
 * prima di trasformare il ripiego in errore (fase B).
 *
 * PERCHÉ un registro su file e non solo un contatore: il contatore in memoria
 * riparte a ogni aggiornamento (su `dev` arrivano più volte al giorno), e la
 * verifica di NUC-1 è «chi ripiega in una settimana». Il file sì sopravvive.
 *
 * Forma del registro: JSONL, un file al giorno in `<DATA_DIR>/logs/ripieghi/`,
 * tenuto `GIORNI_CONSERVATI` giorni (la pulizia la fa questo modulo).
 * Righe:
 *   - `tipo:"stack"` una volta per firma e per processo (dove si chiama, intero);
 *   - `tipo:"conteggio"` per (firma, ora) quando il conteggio di quell'ora tocca
 *     1, 10, 100, 1000…: il numero vero dell'ora è il massimo `n` letto, con
 *     un'approssimazione per ordine di grandezza. Mille chiamate = quattro righe.
 *   - `tipo:"limite"` se in un'ora si supera `MAX_RIGHE_ORA` righe: da lì fino
 *     all'ora dopo si conta solo in memoria.
 *
 * Non lancia mai: il registro non deve far fallire l'accesso che registra.
 * Nessun dato del cliente: solo caso, codice del tenant, firma del chiamante.
 */
import fs from "node:fs";
import path from "node:path";
import { resolveDataDir } from "../data-dir";

export type CasoRipiego = "default" | "legacy" | "tenant_non_registrato";

export const GIORNI_CONSERVATI = 30;
export const MAX_RIGHE_ORA = 200;
const MAX_FIRME = 500;

interface Chiamante {
  firma: string;
  caso: CasoRipiego;
  tenant: string | null;
  n: number;
  ultimo: string;
  ora: string;
  nOra: number;
}

interface Stato {
  totale: number;
  perCaso: Partial<Record<CasoRipiego, number>>;
  chiamanti: Map<string, Chiamante>;
  stackScritti: Set<string>;
  oraCorrente: string;
  righeOra: number;
  limiteSegnalato: boolean;
  ultimaPulizia: string;
}

// Su globalThis: sotto tsx possono coesistere due istanze dello stesso modulo
// (vedi no-dynamic-db-tenant-import.test.ts) e il conteggio deve essere uno.
const CHIAVE = Symbol.for("da-ipam.db-maintenance.ripieghi");
function stato(): Stato {
  const g = globalThis as unknown as Record<symbol, Stato | undefined>;
  let s = g[CHIAVE];
  if (!s) {
    s = {
      totale: 0,
      perCaso: {},
      chiamanti: new Map(),
      stackScritti: new Set(),
      oraCorrente: "",
      righeOra: 0,
      limiteSegnalato: false,
      ultimaPulizia: "",
    };
    g[CHIAVE] = s;
  }
  return s;
}

/** Cartella del registro (letta a ogni chiamata: segue `DA_INVENT_DATA_DIR`). */
export function DIR_REGISTRO_RIPIEGHI(): string {
  return path.join(resolveDataDir(), "logs", "ripieghi");
}

const FILE_INTERNI = /[\\/](db|db-tenant|ripieghi)\.[cm]?[jt]s\b|node:internal|[\\/]node_modules[\\/]/;

/** Il primo frame dello stack che non sta nel facade: «funzione @ file:riga». */
function righeStack(): string[] {
  const vecchioLimite = Error.stackTraceLimit;
  Error.stackTraceLimit = 25;
  const stack = new Error().stack ?? "";
  Error.stackTraceLimit = vecchioLimite;
  return stack.split("\n").slice(1).map((r) => r.trim());
}

function firmaDa(righe: string[]): string {
  const esterna = righe.find((r) => r.startsWith("at ") && !FILE_INTERNI.test(r));
  if (!esterna) return "sconosciuto";
  const m = /^at (?:(.+?) \()?(.+?):(\d+):\d+\)?$/.exec(esterna);
  if (!m) return esterna.slice(3, 160);
  const funzione = m[1] ?? "<anonima>";
  const file = m[2].replace(/^file:\/\//, "");
  const idx = file.lastIndexOf("/src/");
  const corto = idx >= 0 ? file.slice(idx + 1) : file.split(/[\\/]/).slice(-3).join("/");
  return `${funzione} @ ${corto}:${m[3]}`;
}

function scrivi(riga: Record<string, unknown>, adesso: Date): void {
  const dir = DIR_REGISTRO_RIPIEGHI();
  fs.mkdirSync(dir, { recursive: true });
  const giorno = adesso.toISOString().slice(0, 10);
  fs.appendFileSync(path.join(dir, `ripieghi-${giorno}.jsonl`), `${JSON.stringify(riga)}\n`);
  const s = stato();
  if (s.ultimaPulizia !== giorno) {
    s.ultimaPulizia = giorno;
    pulisci(dir, adesso);
  }
}

function pulisci(dir: string, adesso: Date): void {
  const soglia = new Date(adesso.getTime() - GIORNI_CONSERVATI * 86_400_000).toISOString().slice(0, 10);
  for (const f of fs.readdirSync(dir)) {
    const m = /^ripieghi-(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(f);
    if (m && m[1] < soglia) fs.rmSync(path.join(dir, f), { force: true });
  }
}

function potenzaDiDieci(n: number): boolean {
  while (n >= 10 && n % 10 === 0) n /= 10;
  return n === 1;
}

/** Conta un ripiego. Non lancia, non cambia l'esito dell'accesso. */
export function registraRipiego(caso: CasoRipiego, tenant: string | null = null): void {
  try {
    const s = stato();
    const adesso = new Date();
    const ora = adesso.toISOString().slice(0, 13);
    s.totale += 1;
    s.perCaso[caso] = (s.perCaso[caso] ?? 0) + 1;

    if (s.oraCorrente !== ora) {
      s.oraCorrente = ora;
      s.righeOra = 0;
      s.limiteSegnalato = false;
    }

    const righe = righeStack();
    const firma = firmaDa(righe);
    const chiave = `${caso}|${tenant ?? ""}|${firma}`;
    let c = s.chiamanti.get(chiave);
    if (!c) {
      if (s.chiamanti.size >= MAX_FIRME) {
        // Tetto alla memoria: si scarta il chiamante visto meno di recente.
        let vecchia: string | null = null;
        let quando = "￿";
        for (const [k, v] of s.chiamanti) if (v.ultimo < quando) { quando = v.ultimo; vecchia = k; }
        if (vecchia) s.chiamanti.delete(vecchia);
      }
      c = { firma, caso, tenant, n: 0, ultimo: "", ora, nOra: 0 };
      s.chiamanti.set(chiave, c);
    }
    c.n += 1;
    c.ultimo = adesso.toISOString();
    if (c.ora !== ora) { c.ora = ora; c.nOra = 0; }
    c.nOra += 1;

    const daScrivere: Record<string, unknown>[] = [];
    const base = { ts: c.ultimo, caso, tenant, firma };
    if (!s.stackScritti.has(chiave)) {
      s.stackScritti.add(chiave);
      daScrivere.push({ ...base, tipo: "stack", stack: righe.filter((r) => !/node:internal/.test(r)).slice(0, 15) });
      // Una sola riga nel journal per chiamante e processo: niente inondazione.
      console.warn(`[db] ripiego ${caso}${tenant ? ` (${tenant})` : ""} da ${firma}`);
    }
    if (potenzaDiDieci(c.nOra)) daScrivere.push({ ...base, tipo: "conteggio", ora, n: c.nOra });

    for (const riga of daScrivere) {
      if (s.righeOra >= MAX_RIGHE_ORA) {
        if (!s.limiteSegnalato) {
          s.limiteSegnalato = true;
          scrivi({ ts: c.ultimo, tipo: "limite", ora, max_righe: MAX_RIGHE_ORA }, adesso);
        }
        break;
      }
      s.righeOra += 1;
      scrivi(riga, adesso);
    }
  } catch {
    /* il registro non fa mai fallire l'accesso che registra */
  }
}

/** Il solo numero aggregato: è quello che può uscire da un endpoint pubblico. */
export function contaRipieghi(): number {
  return stato().totale;
}

export interface RiepilogoRipieghi {
  totale: number;
  per_caso: Partial<Record<CasoRipiego, number>>;
  chiamanti: Array<{ firma: string; caso: CasoRipiego; tenant: string | null; n: number; ultimo: string }>;
}

/** Dettaglio dal processo corrente (riparte a ogni avvio: lo storico è nel file). */
export function riepilogoRipieghi(limite = 20): RiepilogoRipieghi {
  const s = stato();
  const chiamanti = [...s.chiamanti.values()]
    .sort((a, b) => (a.ultimo < b.ultimo ? 1 : a.ultimo > b.ultimo ? -1 : 0))
    .slice(0, limite)
    .map(({ firma, caso, tenant, n, ultimo }) => ({ firma, caso, tenant, n, ultimo }));
  return { totale: s.totale, per_caso: { ...s.perCaso }, chiamanti };
}
