import type Database from "better-sqlite3";
import type { AttributionResult } from "./fuse";

interface CurrentAttrRow {
  attr_vendor: string | null;
  attr_vendor_name: string | null;
  attr_category: string | null;
  attr_os_family: string | null;
  attr_os_name: string | null;
  attr_confidence_vendor: number | null;
  attr_confidence_category: number | null;
  attr_confidence_os: number | null;
  attr_min_phase: string | null;
}

/** null e undefined sono equivalenti ai fini del confronto "nessun cambiamento". */
function norm(v: unknown): unknown {
  return v === undefined ? null : v;
}

/**
 * Scrive il risultato della fusione su hosts.attr_* e appende alla history estesa.
 * NON tocca classification/inferred_* (parallel-run, fase 1 — il legacy resta fino alla fase 4).
 * Il trigger riusa i valori del CHECK esistente (decisione 8 del piano).
 *
 * Salta UPDATE + INSERT history se il risultato è identico a quanto già persistito
 * (write amplification: gli hook ARP/DHCP/Wazuh/AD/discovery ricomputano gli stessi
 * host più volte per flusso).
 *
 * @returns true se ha scritto (cambiamento reale), false se il risultato era invariato.
 */
export function applyAttribution(
  dbh: Database.Database,
  hostId: number,
  result: AttributionResult,
  trigger: "scan" | "apply" | "manual" | "backfill"
): boolean {
  const current = dbh.prepare(
    `SELECT attr_vendor, attr_vendor_name, attr_category, attr_os_family, attr_os_name,
            attr_confidence_vendor, attr_confidence_category, attr_confidence_os, attr_min_phase
     FROM hosts WHERE id = ?`
  ).get(hostId) as CurrentAttrRow | undefined;

  const next: CurrentAttrRow = {
    attr_vendor: result.vendor.claim,
    attr_vendor_name: result.vendor.vendor_name,
    attr_category: result.category.claim,
    attr_os_family: result.os.claim,
    attr_os_name: result.os.os_name,
    attr_confidence_vendor: result.vendor.confidence,
    attr_confidence_category: result.category.confidence,
    attr_confidence_os: result.os.confidence,
    attr_min_phase: result.category.min_phase,
  };

  const unchanged = current !== undefined
    && (Object.keys(next) as Array<keyof CurrentAttrRow>).every((k) => norm(current[k]) === norm(next[k]));
  if (unchanged) return false;

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
  return true;
}
