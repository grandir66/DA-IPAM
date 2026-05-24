/**
 * GET /api/hosts/[id]/vulnerabilities
 *
 * Findings CVE per un host, UNIFICATI tra le sorgenti:
 *   - Greenbone / scanner-edge (vuln_findings + vuln_scan_runs + vuln_scanners)
 *   - Wazuh agent (wazuh_vuln via wazuh_agent.host_id)
 *
 * Dedupe per `cve_id` (oppure `nvt_oid` quando CVE assente). Per ogni gruppo
 * teniamo il rilevamento più recente come `scanned_at`, max severity, max
 * cvss_score, e accumulo le fonti come array `sources`. Coerenza UI: il
 * conteggio rollup è sui finding *deduplicati* → header e tabella sempre allineati.
 */

import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getTenantDb, getCurrentTenantCode } from "@/lib/db-tenant";

interface SeverityRollup {
  Critical: number;
  High: number;
  Medium: number;
  Low: number;
  Log: number;
}

const EMPTY: SeverityRollup = { Critical: 0, High: 0, Medium: 0, Low: 0, Log: 0 };

interface UnifiedFinding {
  id: string;            // key sintetica (cve_id o nvt_oid o synthesis)
  cve_id: string | null;
  cvss_score: number | null;
  cvss_vector: string | null;
  severity: string;
  port: string | null;
  service: string | null;
  nvt_oid: string | null;
  nvt_name: string | null;
  description: string | null;
  scanned_at: string;
  sources: string[];     // ["Greenbone", "Wazuh"] etc — fonti che hanno rilevato la stessa CVE
}

const SEVERITY_RANK: Record<string, number> = {
  Critical: 4, High: 3, Medium: 2, Low: 1, Log: 0,
};

function maxSeverity(a: string, b: string): string {
  return (SEVERITY_RANK[b] ?? 0) > (SEVERITY_RANK[a] ?? 0) ? b : a;
}

/** Wazuh severity può essere "Critical|High|Medium|Low|Untriaged" — mappa Untriaged a Low. */
function normalizeSeverity(raw: string | null | undefined): string {
  if (!raw) return "Low";
  const s = raw.trim();
  if (s === "Critical" || s === "High" || s === "Medium" || s === "Low") return s;
  return "Low";
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await requireAuth();
  if (session instanceof NextResponse) return session;
  const { id } = await ctx.params;
  const hostId = Number(id);
  if (!Number.isFinite(hostId) || hostId <= 0) {
    return NextResponse.json({ error: "id non valido" }, { status: 400 });
  }

  return await withTenantFromSession(() => {
    const code = getCurrentTenantCode() ?? "DEFAULT";
    const db = getTenantDb(code);

    // ─── Step 1: Greenbone (raw findings dal scanner-edge che wrappa Greenbone) ──
    // Dedup per (cve_id|nvt_oid, port). Per ogni gruppo teniamo MAX(scanned_at).
    // La fonte è SEMPRE "Greenbone" — scanner-edge è il trasporto, non lo strumento.
    const greenboneRows = db
      .prepare(
        `SELECT f.id, f.cve_id, MAX(f.cvss_score) AS cvss_score, f.cvss_vector,
                f.severity, f.port, f.service, f.nvt_oid, f.nvt_name,
                f.description, MAX(f.scanned_at) AS scanned_at,
                'Greenbone' AS source
           FROM vuln_findings f
          WHERE f.host_id = ?
            AND f.severity IN ('Critical','High','Medium','Low')
          GROUP BY COALESCE(f.cve_id, ''), COALESCE(f.nvt_oid, ''), COALESCE(f.port, '')`,
      )
      .all(hostId) as Array<{
        id: number; cve_id: string | null; cvss_score: number | null;
        cvss_vector: string | null; severity: string; port: string | null;
        service: string | null; nvt_oid: string | null; nvt_name: string | null;
        description: string | null; scanned_at: string; source: string;
      }>;

    // ─── Step 2: Wazuh — CVE registrate per l'agent collegato a questo host ──
    const wazuhRows = db
      .prepare(
        `SELECT v.cve, COALESCE(v.cvss3_score, v.cvss2_score) AS cvss_score,
                v.severity, v.package_name, v.package_version,
                v.detection_time AS scanned_at,
                a.agent_id AS agent_id
           FROM wazuh_vuln v
           JOIN wazuh_agent a ON a.agent_id = v.agent_id
          WHERE a.host_id = ?
            AND v.status = 'VALID'`,
      )
      .all(hostId) as Array<{
        cve: string; cvss_score: number | null; severity: string | null;
        package_name: string | null; package_version: string | null;
        scanned_at: string | null; agent_id: string;
      }>;

    // ─── Step 3: merge per (cve_id | nvt_oid) — accumulo sources ─────────────
    const merged = new Map<string, UnifiedFinding>();

    for (const g of greenboneRows) {
      const key = g.cve_id ?? g.nvt_oid ?? `nvt:${g.id}`;
      const sev = normalizeSeverity(g.severity);
      const existing = merged.get(key);
      if (existing) {
        existing.severity = maxSeverity(existing.severity, sev);
        existing.cvss_score = Math.max(existing.cvss_score ?? 0, g.cvss_score ?? 0) || existing.cvss_score;
        if (g.scanned_at > existing.scanned_at) existing.scanned_at = g.scanned_at;
        if (!existing.sources.includes(g.source)) existing.sources.push(g.source);
      } else {
        merged.set(key, {
          id: key,
          cve_id: g.cve_id,
          cvss_score: g.cvss_score,
          cvss_vector: g.cvss_vector,
          severity: sev,
          port: g.port,
          service: g.service,
          nvt_oid: g.nvt_oid,
          nvt_name: g.nvt_name,
          description: g.description,
          scanned_at: g.scanned_at,
          sources: [g.source],
        });
      }
    }

    for (const w of wazuhRows) {
      const key = w.cve;
      const sev = normalizeSeverity(w.severity);
      if (!["Critical", "High", "Medium", "Low"].includes(sev)) continue;
      const existing = merged.get(key);
      const pkgLabel = w.package_name
        ? `${w.package_name}${w.package_version ? " " + w.package_version : ""}`
        : null;
      if (existing) {
        existing.severity = maxSeverity(existing.severity, sev);
        existing.cvss_score = Math.max(existing.cvss_score ?? 0, w.cvss_score ?? 0) || existing.cvss_score;
        if (w.scanned_at && w.scanned_at > existing.scanned_at) existing.scanned_at = w.scanned_at;
        if (!existing.sources.includes("Wazuh")) existing.sources.push("Wazuh");
        if (!existing.nvt_name && pkgLabel) existing.nvt_name = `Pacchetto: ${pkgLabel}`;
      } else {
        merged.set(key, {
          id: key,
          cve_id: w.cve,
          cvss_score: w.cvss_score,
          cvss_vector: null,
          severity: sev,
          port: null,
          service: pkgLabel,
          nvt_oid: null,
          nvt_name: pkgLabel ? `Pacchetto: ${pkgLabel}` : null,
          description: null,
          scanned_at: w.scanned_at ?? new Date().toISOString(),
          sources: ["Wazuh"],
        });
      }
    }

    // ─── Step 4: rollup (sui finding deduplicati per CVE, non sui raw) ───────
    const rollup: SeverityRollup = { ...EMPTY };
    for (const f of merged.values()) {
      if (f.severity in rollup) rollup[f.severity as keyof SeverityRollup]++;
    }

    // Ordine: severity DESC, poi cvss DESC, poi scanned_at DESC
    const findingsSorted = Array.from(merged.values()).sort((a, b) => {
      const sa = SEVERITY_RANK[a.severity] ?? 0;
      const sb = SEVERITY_RANK[b.severity] ?? 0;
      if (sa !== sb) return sb - sa;
      const ca = a.cvss_score ?? 0;
      const cb = b.cvss_score ?? 0;
      if (ca !== cb) return cb - ca;
      return b.scanned_at.localeCompare(a.scanned_at);
    });

    // ─── Step 5: aggregate per pacchetto/NVT ────────────────────────────────
    // Wazuh genera spesso decine di CVE per la stessa applicazione (Firefox,
    // Chrome, Windows Defender, ...) — UI inutilizzabile se mostra 1 riga per
    // CVE. Raggruppiamo per `nvt_name` (Greenbone) o "Pacchetto: <name>"
    // (Wazuh), tenendo il count breakdown per severity e i sample CVE.
    interface FindingGroup {
      key: string;
      label: string;
      top_severity: string;
      top_cvss: number | null;
      port: string | null;
      service: string | null;
      sources: string[];
      latest_scanned_at: string;
      breakdown: { Critical: number; High: number; Medium: number; Low: number };
      cves: Array<{
        cve_id: string | null;
        severity: string;
        cvss_score: number | null;
        scanned_at: string;
      }>;
    }

    const groupsMap = new Map<string, FindingGroup>();
    for (const f of findingsSorted) {
      // Chiave gruppo: nvt_name (preferito perché user-facing).
      // Se nvt_name è null, fallback a service o a "_unknown".
      const groupKey = (f.nvt_name ?? f.service ?? "_unknown").trim();
      const existing = groupsMap.get(groupKey);
      if (existing) {
        if (SEVERITY_RANK[f.severity] > SEVERITY_RANK[existing.top_severity]) {
          existing.top_severity = f.severity;
          existing.top_cvss = f.cvss_score;
        } else if (SEVERITY_RANK[f.severity] === SEVERITY_RANK[existing.top_severity]) {
          if ((f.cvss_score ?? 0) > (existing.top_cvss ?? 0)) existing.top_cvss = f.cvss_score;
        }
        if (f.scanned_at > existing.latest_scanned_at) existing.latest_scanned_at = f.scanned_at;
        for (const src of f.sources) if (!existing.sources.includes(src)) existing.sources.push(src);
        if (f.severity in existing.breakdown) {
          existing.breakdown[f.severity as keyof typeof existing.breakdown]++;
        }
        existing.cves.push({
          cve_id: f.cve_id,
          severity: f.severity,
          cvss_score: f.cvss_score,
          scanned_at: f.scanned_at,
        });
      } else {
        groupsMap.set(groupKey, {
          key: groupKey,
          label: groupKey === "_unknown" ? "(senza etichetta)" : groupKey,
          top_severity: f.severity,
          top_cvss: f.cvss_score,
          port: f.port,
          service: f.service,
          sources: [...f.sources],
          latest_scanned_at: f.scanned_at,
          breakdown: {
            Critical: f.severity === "Critical" ? 1 : 0,
            High: f.severity === "High" ? 1 : 0,
            Medium: f.severity === "Medium" ? 1 : 0,
            Low: f.severity === "Low" ? 1 : 0,
          },
          cves: [
            {
              cve_id: f.cve_id,
              severity: f.severity,
              cvss_score: f.cvss_score,
              scanned_at: f.scanned_at,
            },
          ],
        });
      }
    }

    const groups = Array.from(groupsMap.values())
      .map((g) => ({
        ...g,
        // ordina CVE dentro il gruppo per severity DESC, cvss DESC
        cves: g.cves.sort((a, b) => {
          const sa = SEVERITY_RANK[a.severity] ?? 0;
          const sb = SEVERITY_RANK[b.severity] ?? 0;
          if (sa !== sb) return sb - sa;
          return (b.cvss_score ?? 0) - (a.cvss_score ?? 0);
        }),
      }))
      .sort((a, b) => {
        const sa = SEVERITY_RANK[a.top_severity] ?? 0;
        const sb = SEVERITY_RANK[b.top_severity] ?? 0;
        if (sa !== sb) return sb - sa;
        // più CVE prima
        const totA = a.breakdown.Critical + a.breakdown.High + a.breakdown.Medium + a.breakdown.Low;
        const totB = b.breakdown.Critical + b.breakdown.High + b.breakdown.Medium + b.breakdown.Low;
        if (totA !== totB) return totB - totA;
        return a.label.localeCompare(b.label);
      });

    // Last scan info
    const lastScannedAt = findingsSorted.length > 0
      ? findingsSorted.reduce((acc, f) => (f.scanned_at > acc ? f.scanned_at : acc), findingsSorted[0].scanned_at)
      : null;

    return NextResponse.json({
      host_id: hostId,
      last_run: lastScannedAt
        ? {
            id: 0,
            started_at: lastScannedAt,
            finished_at: lastScannedAt,
            finding_count: findingsSorted.length,
          }
        : null,
      severity_rollup: rollup,
      groups,
      // Limite alto: la UI gestisce paginazione/scroll quando serve.
      findings: findingsSorted.slice(0, 2000),
    });
  });
}
