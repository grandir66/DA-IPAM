import type Database from "better-sqlite3";
import type { AttributionEvidenceRow, EvidenceInput } from "./types";
import { ATTR_SOURCE_WEIGHTS } from "./weights";

export interface RecordEvidenceResult { inserted: number; refreshed: number; superseded: number; }

/**
 * Registra evidenze per un host (spec §4.2, decisione 10 del piano):
 * - identica a una attiva (source, dimension, claim, raw_value) → refresh di
 *   observed_at/confidence/expires_at;
 * - claim/raw diverso dalla stessa (source, dimension) → INSERT + supersede
 *   delle attive precedenti di quella coppia;
 * - le evidenze manual sono superseded SOLO da un nuovo manual.
 */
export function recordEvidence(
  dbh: Database.Database,
  hostId: number,
  inputs: EvidenceInput[]
): RecordEvidenceResult {
  const result: RecordEvidenceResult = { inserted: 0, refreshed: 0, superseded: 0 };
  const selActive = dbh.prepare(
    `SELECT id, claim, raw_value FROM attribution_evidence
     WHERE host_id = ? AND source = ? AND dimension = ? AND superseded_by IS NULL`
  );
  const refresh = dbh.prepare(
    `UPDATE attribution_evidence
     SET observed_at = datetime('now'), confidence = ?, expires_at = ? WHERE id = ?`
  );
  const insert = dbh.prepare(
    `INSERT INTO attribution_evidence
       (host_id, source, phase, dimension, claim, confidence, weight, raw_value, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const supersede = dbh.prepare(`UPDATE attribution_evidence SET superseded_by = ? WHERE id = ?`);

  dbh.transaction(() => {
    for (const input of inputs) {
      const weight = input.weight ?? ATTR_SOURCE_WEIGHTS[input.source];
      const active = selActive.all(hostId, input.source, input.dimension) as Array<{
        id: number; claim: string; raw_value: string | null;
      }>;
      const identical = active.find(
        (a) => a.claim === input.claim && (a.raw_value ?? null) === (input.raw_value ?? null)
      );
      if (identical) {
        refresh.run(input.confidence, input.expires_at ?? null, identical.id);
        result.refreshed += 1;
        continue;
      }
      const newId = insert.run(
        hostId, input.source, input.phase, input.dimension, input.claim,
        input.confidence, weight, input.raw_value ?? null, input.expires_at ?? null
      ).lastInsertRowid as number;
      result.inserted += 1;
      for (const a of active) {
        supersede.run(newId, a.id);
        result.superseded += 1;
      }
    }
  })();
  return result;
}

export function getActiveEvidence(
  dbh: Database.Database,
  hostId: number
): AttributionEvidenceRow[] {
  return dbh
    .prepare(
      `SELECT * FROM attribution_evidence
       WHERE host_id = ? AND superseded_by IS NULL
       ORDER BY dimension, source, id`
    )
    .all(hostId) as AttributionEvidenceRow[];
}
