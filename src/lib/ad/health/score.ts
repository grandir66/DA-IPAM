import type { HealthFinding, HealthScore, HealthSeverity } from "./types";

export function severityFromPoints(points: number): HealthSeverity {
  if (points >= 30) return "Critical";
  if (points >= 20) return "High";
  if (points >= 10) return "Medium";
  return "Low";
}

export function aggregateScores(findings: HealthFinding[]): HealthScore {
  const axes = { stale: 0, privileged: 0, trust: 0, anomaly: 0 };

  for (const f of findings) {
    if (f.axis === "stale" || f.axis === "privileged" || f.axis === "trust" || f.axis === "anomaly") {
      axes[f.axis] += f.points;
    }
  }

  const stale = Math.min(100, axes.stale);
  const privileged = Math.min(100, axes.privileged);
  const trust = Math.min(100, axes.trust);
  const anomaly = Math.min(100, axes.anomaly);

  return {
    stale,
    privileged,
    trust,
    anomaly,
    global: Math.max(stale, privileged, trust, anomaly),
  };
}
