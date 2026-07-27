import { severityFromPoints } from "../score";
import {
  SAMPLE_CAP,
  type HealthAxis,
  type HealthFinding,
  type HealthSeverity,
} from "../types";

export function daysSince(iso: string | null | undefined, now: Date): number | null {
  if (iso == null || iso === "") return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const ms = now.getTime() - t;
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

export function sample(list: string[]): string[] {
  return list.slice(0, SAMPLE_CAP);
}

export function aggFinding(args: {
  ruleId: string;
  axis: Exclude<HealthAxis, "score">;
  points: number;
  title: string;
  description: string;
  dns: string[];
  raw?: Record<string, unknown>;
  /** Excluded from the score; use for collector-health findings. */
  diagnostic?: boolean;
  /** Overrides the points-derived severity (diagnostic findings score 0). */
  severity?: HealthSeverity;
}): HealthFinding {
  return {
    ruleId: args.ruleId,
    axis: args.axis,
    points: args.points,
    severity: args.severity ?? severityFromPoints(args.points),
    title: args.title,
    description: args.description,
    objectCount: args.dns.length,
    sampleDns: sample(args.dns),
    ...(args.raw ? { raw: args.raw } : {}),
    ...(args.diagnostic ? { diagnostic: true } : {}),
  };
}
