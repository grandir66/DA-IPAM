export const ENGINE_VERSION = "0.1.0";
export const CONFLICT_WINDOW = 10;
export const MIN_APPLY_CONFIDENCE = 56;
export const MAX_EVIDENCE_KEPT = 20;
export const HISTORY_CONFIDENCE_DELTA = 5;

export type EvidenceSource =
  | "naabu" | "nmap" | "snmp" | "http" | "ssh" | "smb"
  | "mac_oui" | "dns" | "ttl" | "rule";

export interface ClassificationEvidence {
  source: EvidenceSource;
  attribute: string;
  value: string;
  weight: number;
  confidence: number;
  observed: boolean;
  timestamp: string;
  votes_for?: string;
}

export interface ClassificationConflict {
  a: string;
  b: string;
  score_a: number;
  score_b: number;
  delta: number;
}

export interface ClassificationDecision {
  classification: string; // slug or "unknown"
  confidence: number;     // 0-100
  reason: string;
  evidence: ClassificationEvidence[];
  conflicts: ClassificationConflict[];
  fingerprint_hash: string;
  engine_version: string;
  sources: EvidenceSource[];
}

export interface ClassificationJson {
  evidence: ClassificationEvidence[];
  conflicts?: ClassificationConflict[];
  fingerprint_hash: string;
  engine_version: string;
  sources: EvidenceSource[];
}
