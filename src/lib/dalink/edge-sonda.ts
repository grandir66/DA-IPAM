/**
 * La lettura della sonda locale per il blocco `edge` del segnale verso DA-Link (sonde
 * integrate, spec DA-Vul-can 2026-10-20 §8.2). La lista bianca sta in `edge-segnale.ts`.
 *
 * - Modulo edge presente = una riga in `vuln_scanners` con un indirizzo, accesa o spenta
 *   dalla sequenza di errori consecutivi (`auto_disabled_at`): è proprio lì che serve
 *   sapere se la sonda risponde. Nessuna riga, o spenta per scelta (`enabled=0` senza
 *   `auto_disabled_at`, revisione del 20/10) → null: il blocco non esce e alla sonda non
 *   si chiede niente (contratto 8.2, «assente se il modulo edge non c'è»).
 * - Stessa fiducia TLS delle altre chiamate alla sonda (`leggiSaluteEdge`, pin SPKI di
 *   `cert_pin`): nessun `rejectUnauthorized: false` nuovo.
 * - Timeout breve e TOTALE (`TIMEOUT_EDGE_MS`): una sonda appesa non ferma il segnale, e
 *   allo scadere la connessione si chiude davvero (AbortSignal); corpo al massimo 64 KB.
 * - Ogni guasto della chiamata (rete, TLS, pin diverso, 5xx, non JSON, timeout) è
 *   `raggiungibile: false`, senza il messaggio: può contenere indirizzi del cliente.
 * - Se la riga non si legge, null («non so»): mai un errore che ferma il segnale.
 *
 * `db-tenant` si importa solo staticamente (regola 14 di DA-IPAM, ADR 0002).
 */
import type { Database } from "better-sqlite3";
import { getTenantDb } from "@/lib/db-tenant";
import { leggiSaluteEdge } from "@/lib/vuln/scanner-edge-client";
import type { LetturaEdge } from "./edge-segnale";

/** Il segnale parte ogni 5 minuti: tre secondi bastano a una sonda sulla stessa macchina o in LAN. */
export const TIMEOUT_EDGE_MS = 3000;

export interface ScannerEdgeLocale {
  base_url: string;
  cert_pin: string | null;
}

export interface DipendenzeEdge {
  scanner: (tenant: string) => ScannerEdgeLocale | null;
  salute: (baseUrl: string, certPin: string | null, timeoutMs: number, signal: AbortSignal) => Promise<unknown>;
}

/** La sonda del cliente, come la leggono registro dei moduli e sonda di salute (prima riga). */
export function scannerEdgeDaDb(db: Database): ScannerEdgeLocale | null {
  const r = db
    .prepare("SELECT base_url, cert_pin, enabled, auto_disabled_at FROM vuln_scanners ORDER BY id LIMIT 1")
    .get() as
    | { base_url: string | null; cert_pin: string | null; enabled: number | null; auto_disabled_at: string | null }
    | undefined;
  if (!r || typeof r.base_url !== "string" || !r.base_url.trim()) return null;
  const spentoDagliErrori = typeof r.auto_disabled_at === "string" && r.auto_disabled_at.trim() !== "";
  if (r.enabled !== 1 && !spentoDagliErrori) return null;
  return { base_url: r.base_url.trim(), cert_pin: r.cert_pin ?? null };
}

export const dipendenzeEdgeReali: DipendenzeEdge = {
  scanner: (tenant) => scannerEdgeDaDb(getTenantDb(tenant)),
  salute: (baseUrl, certPin, timeoutMs, signal) => leggiSaluteEdge(baseUrl, certPin, timeoutMs, signal),
};

const SCADUTO = Symbol("scaduto");

export async function leggiEdgeSonda(
  tenant: string,
  dip: Partial<DipendenzeEdge> = {},
  timeoutMs: number = TIMEOUT_EDGE_MS,
): Promise<LetturaEdge | null> {
  const d: DipendenzeEdge = { ...dipendenzeEdgeReali, ...dip };
  let scanner: ScannerEdgeLocale | null;
  try {
    scanner = d.scanner(tenant);
  } catch {
    return null;
  }
  if (!scanner) return null;

  const fermo = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const scadenza = new Promise<typeof SCADUTO>((resolve) => {
    // Niente unref: è breve e si cancella sempre, e deve scattare anche se nient'altro
    // tiene vivo il processo (visto nelle prove: col timer «unref» la lettura restava appesa).
    timer = setTimeout(() => {
      fermo.abort(); // la connessione si chiude davvero, non resta appesa dietro al segnale
      resolve(SCADUTO);
    }, timeoutMs);
  });
  try {
    const health = await Promise.race([d.salute(scanner.base_url, scanner.cert_pin, timeoutMs, fermo.signal), scadenza]);
    if (health === SCADUTO) return { raggiungibile: false };
    return { raggiungibile: true, health };
  } catch {
    return { raggiungibile: false };
  } finally {
    clearTimeout(timer);
  }
}
