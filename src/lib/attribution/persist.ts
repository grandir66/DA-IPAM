import type Database from "better-sqlite3";
import type { AttributionResult } from "./fuse";

/**
 * Scrive il risultato della fusione su hosts.attr_* e appende alla history estesa.
 * NON tocca classification/inferred_* (parallel-run, fase 1 — il legacy resta fino alla fase 4).
 * Il trigger riusa i valori del CHECK esistente (decisione 8 del piano).
 */
export function applyAttribution(
  dbh: Database.Database,
  hostId: number,
  result: AttributionResult,
  trigger: "scan" | "apply" | "manual" | "backfill"
): void {
  dbh.transaction(() => {
    dbh.prepare(
      `UPDATE hosts SET
         attr_vendor = ?, attr_vendor_name = ?, attr_category = ?,
         attr_os_family = ?, attr_os_name = ?,
         attr_confidence_vendor = ?, attr_confidence_category = ?, attr_confidence_os = ?,
         attr_min_phase = ?, attr_at = datetime('now'), attr_engine_version = ?
       WHERE id = ?`
    ).run(
      result.vendor.claim, result.vendor.vendor_name, result.category.claim,
      result.os.claim, result.os.os_name,
      result.vendor.confidence, result.category.confidence, result.os.confidence,
      result.category.min_phase, result.engine_version, hostId
    );
    dbh.prepare(
      `INSERT INTO host_classification_history
         (host_id, classification, confidence, reason, evidence_json, conflicts_json, attr_vendor, attr_category, attr_os, trigger)
       VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      hostId, result.category.confidence,
      `attribution-v2 ${result.engine_version}`,
      JSON.stringify({ vendor: result.vendor.evidence_ids, category: result.category.evidence_ids, os: result.os.evidence_ids }),
      JSON.stringify(result.category.conflicts),
      result.vendor.claim, result.category.claim, result.os.claim, trigger
    );
  })();
}
