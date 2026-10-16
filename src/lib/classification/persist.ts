import type Database from "better-sqlite3";
import { shouldTouchClassification } from "./engine";
import {
  HISTORY_CONFIDENCE_DELTA,
  MAX_EVIDENCE_KEPT,
  type ClassificationDecision,
  type ClassificationEvidence,
  type ClassificationJson,
} from "./types";

export type PersistTrigger = "scan" | "apply" | "manual" | "backfill";

export interface PersistContext {
  classification_manual: boolean;
  previous_classification: string | null;
  previous_confidence: number | null;
  trigger: PersistTrigger;
  force?: boolean;
}

export interface PersistResult {
  touchedClassification: boolean;
  historyAppended: boolean;
}

function evidenceScore(e: ClassificationEvidence): number {
  return e.weight * e.confidence;
}

/** Keep top N evidence by score desc, then timestamp desc. */
export function trimEvidence(
  evidence: ClassificationEvidence[],
  limit = MAX_EVIDENCE_KEPT
): ClassificationEvidence[] {
  return [...evidence]
    .sort((a, b) => {
      const byScore = evidenceScore(b) - evidenceScore(a);
      if (byScore !== 0) return byScore;
      return b.timestamp.localeCompare(a.timestamp);
    })
    .slice(0, limit);
}

function hostsHasColumn(db: Database.Database, name: string): boolean {
  const cols = db.prepare("PRAGMA table_info(hosts)").all() as Array<{ name: string }>;
  return cols.some((c) => c.name === name);
}

function mergeInferredReasons(
  db: Database.Database,
  hostId: number,
  reason: string
): void {
  if (!reason || !hostsHasColumn(db, "inferred_reasons")) return;

  const row = db
    .prepare("SELECT inferred_reasons FROM hosts WHERE id = ?")
    .get(hostId) as { inferred_reasons: string | null } | undefined;

  let reasons: string[] = [];
  if (row?.inferred_reasons) {
    try {
      const parsed = JSON.parse(row.inferred_reasons) as unknown;
      if (Array.isArray(parsed)) {
        reasons = parsed.filter((x): x is string => typeof x === "string");
      }
    } catch {
      // corrupt snapshot — start fresh
    }
  }

  if (!reasons.includes(reason)) {
    reasons = [...reasons, reason].slice(-MAX_EVIDENCE_KEPT);
  }

  db.prepare("UPDATE hosts SET inferred_reasons = ? WHERE id = ?").run(
    JSON.stringify(reasons),
    hostId
  );
}

/**
 * Persist a ClassificationDecision onto hosts (+ optional history).
 * Always refreshes summary fields; classification slug only when policy/force allows.
 */
export function applyClassificationDecision(
  db: Database.Database,
  hostId: number,
  decision: ClassificationDecision,
  ctx: PersistContext
): PersistResult {
  const evidence = trimEvidence(decision.evidence);
  const snapshot: ClassificationJson = {
    evidence,
    fingerprint_hash: decision.fingerprint_hash,
    engine_version: decision.engine_version,
    sources: decision.sources,
  };
  if (decision.conflicts.length > 0) {
    snapshot.conflicts = decision.conflicts;
  }
  const classificationJson = JSON.stringify(snapshot);

  const force = ctx.force === true;
  // force=true may overwrite manual — but never only to write "unknown"
  // (would wipe classification_manual without a real cascade/engine slug).
  const policy =
    force && decision.classification !== "unknown"
      ? { apply: true as const, reason: "force" }
      : force && decision.classification === "unknown"
        ? { apply: false as const, reason: "force refused: unknown decision" }
        : shouldTouchClassification(
            {
              classification: ctx.previous_classification,
              confidence: ctx.previous_confidence,
            },
            decision,
            ctx.classification_manual
          );

  const touchedClassification = policy.apply;

  if (touchedClassification) {
    if (force && ctx.classification_manual) {
      db.prepare(
        `UPDATE hosts SET
           classification = ?,
           classification_manual = 0,
           inferred_confidence = ?,
           classification_reason = ?,
           classification_json = ?
         WHERE id = ?`
      ).run(
        decision.classification,
        decision.confidence,
        decision.reason,
        classificationJson,
        hostId
      );
    } else {
      db.prepare(
        `UPDATE hosts SET
           classification = ?,
           inferred_confidence = ?,
           classification_reason = ?,
           classification_json = ?
         WHERE id = ?`
      ).run(
        decision.classification,
        decision.confidence,
        decision.reason,
        classificationJson,
        hostId
      );
    }
  } else {
    db.prepare(
      `UPDATE hosts SET
         inferred_confidence = ?,
         classification_reason = ?,
         classification_json = ?
       WHERE id = ?`
    ).run(decision.confidence, decision.reason, classificationJson, hostId);
  }

  mergeInferredReasons(db, hostId, decision.reason);

  const prevConf = ctx.previous_confidence ?? 0;
  const deltaConf = Math.abs(decision.confidence - prevConf);
  const historyAppended =
    touchedClassification ||
    deltaConf >= HISTORY_CONFIDENCE_DELTA ||
    decision.conflicts.length > 0;

  if (historyAppended) {
    const slugAtT = touchedClassification
      ? decision.classification
      : ctx.previous_classification;

    db.prepare(
      `INSERT INTO host_classification_history (
         host_id, classification, confidence, reason,
         evidence_json, conflicts_json, trigger
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      hostId,
      slugAtT,
      decision.confidence,
      decision.reason,
      JSON.stringify(evidence),
      decision.conflicts.length > 0 ? JSON.stringify(decision.conflicts) : null,
      ctx.trigger
    );
  }

  return { touchedClassification, historyAppended };
}
