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
  Edge: "bg-emerald-700 text-white",
  // La sonda dice da quale strumento viene il rilievo (Riccardo, 29/10/2026): stessa tinta, la
  // lettera dopo il trattino distingue Greenbone, Nuclei e i controlli in più.
  "Edge-G": "bg-emerald-700 text-white",
  "Edge-N": "bg-emerald-700 text-white",
  "Edge-C": "bg-emerald-700 text-white",
  Probe: "bg-sky-600 text-white",
  Agent: "bg-teal-600 text-white",
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

/**
 * Fonte di un rilievo di vuln_findings, letta da `nvt_oid` come lo scrive la sonda (DA-Vul-can 0.8.208):
 * «nuclei:…» → Edge-N, «controllo:…» → Edge-C, il resto (Greenbone) → Edge-G. `alias` è la tabella.
 */
export function fonteEdgeSql(alias: string): string {
  return `CASE WHEN ${alias}.nvt_oid LIKE 'nuclei:%' THEN 'Edge-N' WHEN ${alias}.nvt_oid LIKE 'controllo:%' THEN 'Edge-C' ELSE 'Edge-G' END`;
}
