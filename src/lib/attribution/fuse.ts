// Fusione pura evidenze → attribuzione (spec §4.3). Nessun accesso DB, nessun side effect.
import {
  ATTR_ENGINE_VERSION, AUTHORITY_MIN_CONFIDENCE, CONFLICT_WINDOW, MIN_CLAIM_SCORE, phaseIndex,
} from "./types";
import type {
  AttributionDimension, AttributionEvidenceRow, AttributionPhase,
} from "./types";
import { AUTHORITATIVE_SOURCES } from "./weights";
import {
  categoryDepth, categoryParent, commonAncestor, isValidCategory,
} from "./taxonomy";
import type { CategorySlug } from "./taxonomy";

export interface AttributionConflict { a: string; b: string; score_a: number; score_b: number; }
export interface DimensionResult {
  claim: string | null;
  confidence: number;
  min_phase: AttributionPhase | null;
  evidence_ids: number[];
  conflicts: AttributionConflict[];
  authoritative: boolean;
}
export interface AttributionResult {
  vendor: DimensionResult & { vendor_name: string | null };
  category: DimensionResult;
  os: DimensionResult & { os_name: string | null };
  engine_version: string;
}

function emptyResult(): DimensionResult {
  return { claim: null, confidence: 0, min_phase: null, evidence_ids: [], conflicts: [], authoritative: false };
}

function minPhaseOf(rows: AttributionEvidenceRow[]): AttributionPhase | null {
  if (rows.length === 0) return null;
  return rows.reduce((acc, r) => (phaseIndex(r.phase) > phaseIndex(acc) ? r.phase : acc), rows[0].phase);
}

function bestRaw(rows: AttributionEvidenceRow[]): string | null {
  const withRaw = rows.filter((r) => r.raw_value != null);
  if (withRaw.length === 0) return null;
  return withRaw.reduce((a, b) => (b.confidence > a.confidence ? b : a)).raw_value;
}

function fuseDimension(
  all: AttributionEvidenceRow[],
  dimension: AttributionDimension,
  nowIso: string
): { result: DimensionResult; winnerRows: AttributionEvidenceRow[] } {
  // INVARIANTE: expires_at è sempre ISO-8601 UTC (normalizeExpiresAt in evidence.ts
  // lo garantisce in scrittura); il confronto lessicografico con nowIso qui sotto dipende da questo.
  const rows = all.filter(
    (e) => e.dimension === dimension && (e.expires_at == null || e.expires_at > nowIso)
  );
  const result = emptyResult();
  if (rows.length === 0) return { result, winnerRows: [] };

  // 1. manual vince sempre
  const manual = rows.filter((e) => e.source === "manual");
  if (manual.length > 0) {
    const m = manual[manual.length - 1];
    return {
      result: { ...result, claim: m.claim, confidence: 100, min_phase: "manual", evidence_ids: [m.id], authoritative: true },
      winnerRows: [m],
    };
  }

  // 2. sorgenti dichiarative (spec §4.3 punto 4). L'autorità vale solo per
  // claim DICHIARATIVI: una sorgente elencata in AUTHORITATIVE_SOURCES può
  // comunque emettere un claim debole/ambiguo (es. wsd generico "Device"+
  // "Computer" a confidence 0.5, che qualunque NAS/SMB/Windows restituisce).
  // Caso reale 192.168.40.23 (Synology): wsd/compute@0.5 saltava la somma
  // pesata e imponeva "compute" schiacciando "storage.nas" (score 1.2675).
  // Sotto AUTHORITY_MIN_CONFIDENCE l'evidenza NON conta come autoritativa e
  // ricade nel punto 3 (somma pesata) insieme al resto di `rows`.
  const authSources = AUTHORITATIVE_SOURCES[dimension];
  const auth = rows.filter((e) => authSources.includes(e.source) && e.confidence >= AUTHORITY_MIN_CONFIDENCE);
  if (auth.length > 0) {
    const winner = auth.reduce((a, b) => (b.confidence > a.confidence ? b : a));
    const supporting = auth.filter((e) => e.claim === winner.claim);
    return {
      result: {
        ...result, claim: winner.claim,
        confidence: Math.min(100, Math.round(winner.confidence * 100)),
        min_phase: minPhaseOf(supporting), evidence_ids: supporting.map((e) => e.id),
        authoritative: true,
      },
      winnerRows: supporting,
    };
  }

  // 3. somma pesata per claim
  const scores = new Map<string, number>();
  for (const e of rows) {
    scores.set(e.claim, (scores.get(e.claim) ?? 0) + e.weight * e.confidence);
  }

  if (dimension === "category") {
    // gerarchia: i livello-2 contribuiscono al proprio livello-1
    const l1: Map<string, number> = new Map();
    for (const [claim, s] of scores) {
      if (!isValidCategory(claim)) continue;
      const parent = categoryParent(claim as CategorySlug);
      l1.set(parent, (l1.get(parent) ?? 0) + s);
    }
    // classifica dei claim livello-2 sopra soglia, per profondità poi score
    const l2Sorted = [...scores.entries()]
      .filter(([c]) => isValidCategory(c) && categoryDepth(c as CategorySlug) === 2)
      .sort((a, b) => b[1] - a[1]);
    const conflicts: AttributionConflict[] = [];
    let claim: string | null = null;
    let citing: AttributionEvidenceRow[] = [];
    if (l2Sorted.length >= 2 && l2Sorted[0][1] >= MIN_CLAIM_SCORE && l2Sorted[0][1] - l2Sorted[1][1] < CONFLICT_WINDOW) {
      conflicts.push({ a: l2Sorted[0][0], b: l2Sorted[1][0], score_a: l2Sorted[0][1], score_b: l2Sorted[1][1] });
      const anc = commonAncestor(l2Sorted[0][0] as CategorySlug, l2Sorted[1][0] as CategorySlug);
      claim = anc;
    } else if (l2Sorted.length > 0 && l2Sorted[0][1] >= MIN_CLAIM_SCORE) {
      claim = l2Sorted[0][0];
    }
    if (claim == null) {
      // nessuna foglia qualificata: prova il livello 1 aggregato
      const l1Sorted = [...l1.entries()].sort((a, b) => b[1] - a[1]);
      if (l1Sorted.length > 0 && l1Sorted[0][1] >= MIN_CLAIM_SCORE) claim = l1Sorted[0][0];
    }
    if (claim == null) return { result: { ...result, conflicts }, winnerRows: [] };
    const score = categoryDepth(claim as CategorySlug) === 2 ? scores.get(claim)! : l1.get(claim)!;
    citing = rows.filter(
      (e) => e.claim === claim || (isValidCategory(e.claim) && categoryParent(e.claim as CategorySlug) === claim)
    );
    return {
      result: {
        claim, confidence: Math.min(100, Math.round(score * 100)),
        min_phase: minPhaseOf(citing), evidence_ids: citing.map((e) => e.id),
        conflicts, authoritative: false,
      },
      winnerRows: citing,
    };
  }

  // vendor / os: nessuna gerarchia
  const sorted = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  const conflicts: AttributionConflict[] = [];
  if (sorted.length === 0 || sorted[0][1] < MIN_CLAIM_SCORE) {
    return { result: { ...result, conflicts }, winnerRows: [] };
  }
  if (sorted.length >= 2 && sorted[0][1] - sorted[1][1] < CONFLICT_WINDOW) {
    conflicts.push({ a: sorted[0][0], b: sorted[1][0], score_a: sorted[0][1], score_b: sorted[1][1] });
  }
  const claim = sorted[0][0];
  const citing = rows.filter((e) => e.claim === claim);
  return {
    result: {
      claim, confidence: Math.min(100, Math.round(sorted[0][1] * 100)),
      min_phase: minPhaseOf(citing), evidence_ids: citing.map((e) => e.id),
      conflicts, authoritative: false,
    },
    winnerRows: citing,
  };
}

export function fuseAttribution(
  evidence: AttributionEvidenceRow[], nowIso: string
): AttributionResult {
  const vendor = fuseDimension(evidence, "vendor", nowIso);
  const category = fuseDimension(evidence, "category", nowIso);
  const os = fuseDimension(evidence, "os", nowIso);
  return {
    vendor: { ...vendor.result, vendor_name: bestRaw(vendor.winnerRows) },
    category: category.result,
    os: { ...os.result, os_name: bestRaw(os.winnerRows) },
    engine_version: ATTR_ENGINE_VERSION,
  };
}
