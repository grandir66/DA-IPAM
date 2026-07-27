import type Database from "better-sqlite3";
import { getActiveEvidence, recordEvidence } from "./evidence";
import { emitEvidenceFromSignals } from "./emitters";
import type { AttributionSignals } from "./emitters";
import { fuseAttribution } from "./fuse";
import type { AttributionResult } from "./fuse";
import { applyAttribution } from "./persist";

/**
 * Fase 3b: emette le evidenze dai segnali già in DB e rifonde l'insieme
 * completo (spec §3: deterministica, non incrementale) SENZA persistere su
 * hosts.attr_* né in history. recordEvidence resta additivo (le evidenze
 * emesse vengono comunque scritte/aggiornate — solo l'applicazione del
 * risultato fuso viene saltata), quindi una preview seguita da un apply
 * produce lo stesso esito di un recompute diretto.
 */
export function previewHostAttribution(
  dbh: Database.Database,
  signals: AttributionSignals
): AttributionResult {
  recordEvidence(dbh, signals.host.id, emitEvidenceFromSignals(signals));
  return fuseAttribution(getActiveEvidence(dbh, signals.host.id), new Date().toISOString());
}

/**
 * Orchestratore fase 1: emette le evidenze dai segnali già in DB, rifonde
 * l'insieme completo (spec §3: deterministica, non incrementale) e persiste.
 */
export function recomputeHostAttribution(
  dbh: Database.Database,
  signals: AttributionSignals,
  trigger: "scan" | "apply" | "manual" | "backfill" = "apply"
): AttributionResult {
  const result = previewHostAttribution(dbh, signals);
  applyAttribution(dbh, signals.host.id, result, trigger);
  return result;
}

/**
 * Wrapper per gli hook nei flussi esistenti (scan, sync, cron): risolve il
 * contesto tenant corrente e NON propaga mai errori — un difetto del motore
 * di attribuzione non deve rompere scansioni o sync.
 */
export function recomputeAttributionSafe(
  hostId: number,
  trigger: "scan" | "apply" | "manual" | "backfill" = "scan"
): AttributionResult | null {
  try {
    // import dinamici per evitare cicli db-tenant ↔ attribution
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getAttributionSignalsForHost, getCurrentTenantCode, getTenantDb } = require("@/lib/db-tenant") as typeof import("@/lib/db-tenant");
    const code = getCurrentTenantCode();
    if (!code) return null;
    const signals = getAttributionSignalsForHost(hostId);
    if (!signals) return null;
    return recomputeHostAttribution(getTenantDb(code), signals, trigger);
  } catch (e) {
    console.error(`[attribution] recompute host ${hostId} fallito:`, e);
    return null;
  }
}
