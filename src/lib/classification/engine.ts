import { createHash } from "node:crypto";
import {
  CONFLICT_WINDOW,
  ENGINE_VERSION,
  MIN_APPLY_CONFIDENCE,
  type ClassificationConflict,
  type ClassificationDecision,
  type ClassificationEvidence,
  type EvidenceSource,
} from "./types";

export interface DecideOpts {
  cascade_slug?: string | null;
  previous_classification?: string | null;
  previous_confidence?: number | null;
  classification_manual?: boolean;
}

export interface PreviousClassification {
  classification: string | null;
  confidence: number | null;
}

/** Somma grezza weight×confidence per slug `votes_for`. */
export function scoreByClassification(
  evidence: ClassificationEvidence[]
): Map<string, number> {
  const scores = new Map<string, number>();
  for (const e of evidence) {
    if (!e.votes_for) continue;
    const slug = e.votes_for;
    scores.set(slug, (scores.get(slug) ?? 0) + e.weight * e.confidence);
  }
  return scores;
}

/** Normalizza score grezzo (~0–1 tipico) a 0–100. */
export function normalizeOverall(rawMax: number): number {
  if (!Number.isFinite(rawMax) || rawMax <= 0) return 0;
  return Math.min(100, Math.round(rawMax * 100));
}

/** Top-2 slug con Δ overall (0–100) < CONFLICT_WINDOW. */
export function detectConflicts(
  scores: Map<string, number>
): ClassificationConflict[] {
  const ranked = [...scores.entries()]
    .map(([slug, raw]) => ({ slug, overall: normalizeOverall(raw) }))
    .sort((a, b) => b.overall - a.overall || a.slug.localeCompare(b.slug));

  if (ranked.length < 2) return [];

  const top = ranked[0]!;
  const second = ranked[1]!;
  const delta = Math.abs(top.overall - second.overall);
  if (delta >= CONFLICT_WINDOW) return [];

  return [
    {
      a: top.slug,
      b: second.slug,
      score_a: top.overall,
      score_b: second.overall,
      delta,
    },
  ];
}

function isGenericNmapOs(value: string): boolean {
  return /\b(linux|windows)\b/i.test(value);
}

/** One-liner spiegabile: top evidence observed + override nmap generico se presente. */
export function buildReason(
  best: string,
  evidence: ClassificationEvidence[],
  conflicts: ClassificationConflict[]
): string {
  if (best === "unknown") {
    return "Insufficient evidence to classify host";
  }

  const forBest = evidence
    .filter((e) => e.votes_for === best && e.observed)
    .sort((a, b) => b.weight * b.confidence - a.weight * a.confidence);

  const top = forBest[0];
  const parts: string[] = [];

  if (top) {
    parts.push(
      `${top.source} ${top.attribute} "${top.value}" indicates ${best}`
    );
  } else {
    parts.push(`Signals indicate ${best}`);
  }

  const nmapGeneric = evidence.find(
    (e) =>
      e.source === "nmap" &&
      e.votes_for &&
      e.votes_for !== best &&
      isGenericNmapOs(e.value)
  );
  if (nmapGeneric) {
    parts.push(
      `overrides generic ${nmapGeneric.source} OS fingerprint (${nmapGeneric.value})`
    );
  }

  if (conflicts.length > 0) {
    const c = conflicts[0]!;
    parts.push(`near-tie with ${c.a === best ? c.b : c.a} (Δ${c.delta})`);
  }

  return parts.join("; ");
}

/** sha256 di JSON stabile di `source|attribute|value` ordinati. */
export function createFingerprintHash(
  evidence: ClassificationEvidence[]
): string {
  const keys = evidence
    .map((e) => `${e.source}|${e.attribute}|${e.value}`)
    .sort();
  return createHash("sha256").update(JSON.stringify(keys)).digest("hex");
}

function uniqueSources(evidence: ClassificationEvidence[]): EvidenceSource[] {
  const seen = new Set<EvidenceSource>();
  const out: EvidenceSource[] = [];
  for (const e of evidence) {
    if (seen.has(e.source)) continue;
    seen.add(e.source);
    out.push(e.source);
  }
  return out;
}

function cascadeConfidence(
  evidence: ClassificationEvidence[],
  cascadeSlug: string
): number {
  const rule = evidence
    .filter((e) => e.source === "rule" && (e.votes_for === cascadeSlug || !e.votes_for))
    .sort((a, b) => b.confidence - a.confidence)[0];
  if (rule) return normalizeOverall(rule.weight * rule.confidence);
  // Floor basso quando solo cascade senza voti
  return 40;
}

/**
 * Decide classificazione da evidence multi-sorgente (Fase B facade).
 */
export function decideClassification(
  evidence: ClassificationEvidence[],
  opts: DecideOpts = {}
): ClassificationDecision {
  const scores = scoreByClassification(evidence);
  let bestSlug: string | null = null;
  let bestRaw = 0;

  for (const [slug, raw] of scores) {
    if (
      raw > bestRaw ||
      (raw === bestRaw &&
        bestSlug != null &&
        slug.localeCompare(bestSlug) < 0) ||
      (raw === bestRaw && bestSlug == null)
    ) {
      bestRaw = raw;
      bestSlug = slug;
    }
  }

  // Nessun voto ma cascade → usa cascade con confidenza da rule o floor
  if (bestSlug == null && opts.cascade_slug) {
    bestSlug = opts.cascade_slug;
    bestRaw = cascadeConfidence(evidence, opts.cascade_slug) / 100;
  }

  let confidence = bestSlug != null ? normalizeOverall(bestRaw) : 0;
  let classification = bestSlug ?? "unknown";

  const cascadeSlug =
    opts.cascade_slug && opts.cascade_slug !== "unknown"
      ? opts.cascade_slug
      : null;

  if (confidence < MIN_APPLY_CONFIDENCE) {
    // Keep cascade_slug at low confidence (hostname/rules floor ~40) instead of
    // coercing the label to unknown — otherwise new hosts never land a slug.
    if (cascadeSlug) {
      if (bestSlug != null && bestSlug !== cascadeSlug) {
        confidence = cascadeConfidence(evidence, cascadeSlug);
      }
      classification = cascadeSlug;
    } else {
      classification = "unknown";
    }
  }

  const conflicts = detectConflicts(scores);
  const reason = buildReason(classification, evidence, conflicts);

  return {
    classification,
    confidence,
    reason,
    evidence,
    conflicts,
    fingerprint_hash: createFingerprintHash(evidence),
    engine_version: ENGINE_VERSION,
    sources: uniqueSources(evidence),
  };
}

/**
 * Policy update: manual lock; upgrade solo se new >= previous;
 * unknown sotto soglia non sovrascrive slug noti.
 */
export function shouldTouchClassification(
  prev: PreviousClassification,
  decision: ClassificationDecision,
  manual: boolean
): { apply: boolean; reason: string } {
  if (manual) {
    return { apply: false, reason: "classification_manual lock" };
  }

  const prevConf = prev.confidence ?? 0;
  const prevClass = prev.classification ?? "unknown";

  if (decision.classification === "unknown") {
    if (prevClass === "unknown" || prevClass === null || prevClass === "") {
      return {
        apply: decision.confidence >= prevConf,
        reason: "unknown→unknown confidence upgrade",
      };
    }
    return {
      apply: false,
      reason: "refuse unknown overwrite of known classification",
    };
  }

  if (decision.confidence < prevConf) {
    return {
      apply: false,
      reason: `new confidence ${decision.confidence} < previous ${prevConf}`,
    };
  }

  // Conflitto e previous già ≥ decision → non toccare classification
  // (caller può comunque persistere conflicts)
  if (
    decision.conflicts.length > 0 &&
    prevConf >= decision.confidence &&
    prevClass !== "unknown" &&
    prevClass !== decision.classification
  ) {
    return {
      apply: false,
      reason: "conflict with previous confidence not dominated",
    };
  }

  return {
    apply: true,
    reason: "upgrade allowed (new confidence >= previous)",
  };
}
