import { ENGINE_VERSION, type HealthFinding, type HealthScore, type HealthSeverity } from "./types";

export interface HubHealthExport {
  source: "domarc-ad-health";
  domain_fqdn: string;
  engine_version: string;
  generated_at: string;
  scores: HealthScore;
  findings: Array<{
    ip: null;
    hostname: string;
    severity: string;
    cvss_score: number;
    nvt_oid: string;
    nvt_name: string;
    description: string;
    source_kind: "ad_misconfig" | "risk_indicator";
    raw_json: string;
  }>;
}

const SEVERITY_CVSS: Record<HealthSeverity, number> = {
  Critical: 9.5,
  High: 8,
  Medium: 5.5,
  Low: 3,
};

function cvssForFinding(f: HealthFinding, score: HealthScore): number {
  if (f.ruleId === "DA-A-DomainScore") {
    return Math.min(10, score.global / 10);
  }
  // Collector diagnostics are data-quality signals, not domain weaknesses:
  // scoring them would inflate the hub's vulnerability list.
  if (f.diagnostic) return 0;
  return SEVERITY_CVSS[f.severity] ?? Math.min(10, f.points / 10);
}

export function toHubExport(args: {
  domainFqdn: string;
  score: HealthScore;
  findings: HealthFinding[];
  generatedAt?: Date;
}): HubHealthExport {
  const generatedAt = args.generatedAt ?? new Date();
  return {
    source: "domarc-ad-health",
    domain_fqdn: args.domainFqdn,
    engine_version: ENGINE_VERSION,
    generated_at: generatedAt.toISOString(),
    scores: args.score,
    findings: args.findings.map((f) => ({
      ip: null,
      hostname: args.domainFqdn,
      severity: f.severity,
      cvss_score: cvssForFinding(f, args.score),
      nvt_oid: f.ruleId,
      nvt_name: f.title,
      description: f.description,
      source_kind:
        f.ruleId === "DA-A-DomainScore" || f.diagnostic
          ? "risk_indicator"
          : "ad_misconfig",
      raw_json: JSON.stringify({
        ruleId: f.ruleId,
        axis: f.axis,
        points: f.points,
        objectCount: f.objectCount,
        sampleDns: f.sampleDns,
        ...(f.raw ? { raw: f.raw } : {}),
      }),
    })),
  };
}
