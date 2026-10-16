/**
 * CRUD per la tabella classification_feedback nel DB tenant.
 * Salva le correzioni manuali di classificazione come training data per future regole.
 */

import { getTenantDb, getCurrentTenantCode } from "@/lib/db-tenant";
import type { ClassificationFeedback } from "@/types";

function db() {
  const code = getCurrentTenantCode();
  if (!code) throw new Error("Nessun contesto tenant attivo");
  return getTenantDb(code);
}

export interface InsertClassificationFeedbackInput {
  host_id: number;
  corrected_classification: string;
  previous_classification: string | null;
  feature_snapshot_json?: string | null;
  fingerprint_device_label?: string | null;
  fingerprint_confidence?: number | null;
  corrected_by?: string | null;
}

export function insertClassificationFeedback(
  input: InsertClassificationFeedbackInput
): number {
  const result = db()
    .prepare(
      `INSERT INTO classification_feedback
         (host_id, corrected_classification, previous_classification,
          feature_snapshot_json, fingerprint_device_label, fingerprint_confidence, corrected_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.host_id,
      input.corrected_classification,
      input.previous_classification,
      input.feature_snapshot_json ?? null,
      input.fingerprint_device_label ?? null,
      input.fingerprint_confidence ?? null,
      input.corrected_by ?? null
    );
  return result.lastInsertRowid as number;
}

export function getClassificationFeedback(filters: {
  host_id?: number;
  corrected_classification?: string;
  limit?: number;
}): ClassificationFeedback[] {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.host_id !== undefined) {
    conditions.push("host_id = ?");
    params.push(filters.host_id);
  }
  if (filters.corrected_classification !== undefined) {
    conditions.push("corrected_classification = ?");
    params.push(filters.corrected_classification);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = filters.limit ?? 50;

  return db()
    .prepare(`SELECT * FROM classification_feedback ${where} ORDER BY created_at DESC LIMIT ?`)
    .all(...params, limit) as ClassificationFeedback[];
}

export function deleteClassificationFeedback(id: number): boolean {
  const result = db()
    .prepare("DELETE FROM classification_feedback WHERE id = ?")
    .run(id);
  return result.changes > 0;
}

/** `classification_feedback` con l'host associato via JOIN (una sola query, mai
 *  un `getHostById()` per riga — regola 6 CLAUDE.md). Usata dal loop di feedback
 *  (Fase 2 Task 4): la UI deve sapere se il MAC dell'host è risolvibile per
 *  abilitare/disabilitare l'azione "Promuovi a regola" senza N+1 lookup. */
export interface ClassificationFeedbackWithHost extends ClassificationFeedback {
  host_ip: string | null;
  host_mac: string | null;
  host_hostname: string | null;
  host_custom_name: string | null;
  host_vendor: string | null;
}

export function getClassificationFeedbackWithHost(filters: {
  host_id?: number;
  corrected_classification?: string;
  limit?: number;
}): ClassificationFeedbackWithHost[] {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.host_id !== undefined) {
    conditions.push("cf.host_id = ?");
    params.push(filters.host_id);
  }
  if (filters.corrected_classification !== undefined) {
    conditions.push("cf.corrected_classification = ?");
    params.push(filters.corrected_classification);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = filters.limit ?? 50;

  return db()
    .prepare(
      `SELECT cf.*, h.ip as host_ip, h.mac as host_mac, h.hostname as host_hostname,
              h.custom_name as host_custom_name, h.vendor as host_vendor
       FROM classification_feedback cf
       LEFT JOIN hosts h ON h.id = cf.host_id
       ${where}
       ORDER BY cf.created_at DESC LIMIT ?`
    )
    .all(...params, limit) as ClassificationFeedbackWithHost[];
}
