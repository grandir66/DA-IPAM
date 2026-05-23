/**
 * Stili e helper condivisi per badge severity / source CVE.
 * Usato da:
 *   - components/hosts/host-vulnerabilities-card.tsx (dettaglio host)
 *   - app/(dashboard)/vulnerabilities/ (vista globale)
 *   - app/(dashboard)/software/ (vista globale)
 */

export const SEVERITY_STYLE: Record<string, string> = {
  Critical: "bg-red-600 text-white",
  High: "bg-orange-500 text-white",
  Medium: "bg-yellow-500 text-black",
  Low: "bg-blue-500 text-white",
};

export const SOURCE_BADGE_STYLE: Record<string, string> = {
  Wazuh: "bg-violet-600 text-white",
  Greenbone: "bg-emerald-700 text-white",
  Probe: "bg-sky-600 text-white",
};

export const SEVERITY_RANK: Record<string, number> = {
  Critical: 4,
  High: 3,
  Medium: 2,
  Low: 1,
  Log: 0,
};

export type Severity = "Critical" | "High" | "Medium" | "Low";

export const SEVERITIES: readonly Severity[] = ["Critical", "High", "Medium", "Low"] as const;

export function maxSeverity(a: string, b: string): string {
  return (SEVERITY_RANK[b] ?? 0) > (SEVERITY_RANK[a] ?? 0) ? b : a;
}

/** Wazuh può ritornare "Untriaged" — la mappiamo a "Low" per coerenza UI. */
export function normalizeSeverity(raw: string | null | undefined): Severity {
  if (!raw) return "Low";
  const s = raw.trim();
  if (s === "Critical" || s === "High" || s === "Medium" || s === "Low") return s;
  return "Low";
}

export function nvdCveUrl(cve: string): string {
  return `https://nvd.nist.gov/vuln/detail/${encodeURIComponent(cve)}`;
}
