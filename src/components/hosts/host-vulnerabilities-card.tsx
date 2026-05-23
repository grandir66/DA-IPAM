"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ShieldAlert, ChevronRight, ChevronDown } from "lucide-react";
import { SEVERITY_STYLE } from "@/lib/severity-style";
import { CveLink, SourcesBadges } from "@/components/shared/vuln-badges";

interface Finding {
  id: string | number;
  cve_id: string | null;
  cvss_score: number | null;
  severity: string;
  port: string | null;
  service: string | null;
  nvt_name: string | null;
  scanned_at: string;
  sources?: string[];
}

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
  cves: Array<{ cve_id: string | null; severity: string; cvss_score: number | null; scanned_at: string }>;
}

interface VulnPayload {
  host_id: number;
  last_run: { id: number; started_at: string; finished_at: string | null; finding_count: number } | null;
  severity_rollup: { Critical: number; High: number; Medium: number; Low: number; Log: number };
  groups: FindingGroup[];
  findings: Finding[];
}

const PAGE_SIZE = 50;

function formatDate(ts: string): string {
  try { return new Date(ts).toLocaleDateString("it-IT"); } catch { return ts; }
}

function BreakdownBadges({ b }: { b: FindingGroup["breakdown"] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {(["Critical", "High", "Medium", "Low"] as const).map((sev) => {
        const n = b[sev];
        if (n === 0) return null;
        return (
          <Badge key={sev} className={`text-[10px] px-1.5 py-0 ${SEVERITY_STYLE[sev]}`}>
            {sev[0]}:{n}
          </Badge>
        );
      })}
    </div>
  );
}

export function HostVulnerabilitiesCard({ hostId }: { hostId: number }) {
  const [data, setData] = useState<VulnPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [view, setView] = useState<"groups" | "flat">("groups");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const r = await fetch(`/api/hosts/${hostId}/vulnerabilities`);
        if (!r.ok) { setErr(`HTTP ${r.status}`); return; }
        const d = (await r.json()) as VulnPayload;
        if (active) setData(d);
      } catch (e) {
        if (active) setErr((e as Error).message);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [hostId]);

  const flatPaged = useMemo(() => {
    if (!data) return [];
    return data.findings.slice(0, page * PAGE_SIZE);
  }, [data, page]);

  if (loading) return null;
  if (err) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-primary" />
            Vulnerabilità
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Errore: {err}</p>
        </CardContent>
      </Card>
    );
  }
  if (!data) return null;

  const totalFindings = data.last_run?.finding_count ?? 0;
  const totalGroups = data.groups.length;
  const hasFindings = totalFindings > 0;

  function toggleExpand(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2 justify-between">
          <span className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-primary" />
            Vulnerabilità
          </span>
          {data.last_run && (
            <span className="text-xs text-muted-foreground font-normal">
              Ultimo scan: {new Date(data.last_run.finished_at || data.last_run.started_at).toLocaleString("it-IT")}
              {" · "}{totalFindings} CVE · {totalGroups} pacchetti
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!hasFindings ? (
          <p className="text-sm text-muted-foreground">
            {"Nessun finding archiviato. Verifica che scanner-edge e/o Wazuh siano configurati in Impostazioni → Integrazioni e che il sync sia avvenuto."}
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <div className="flex flex-wrap gap-2 text-xs">
                {(["Critical", "High", "Medium", "Low"] as const).map((sev) => (
                  <Badge key={sev} className={SEVERITY_STYLE[sev]}>
                    {sev}: {data.severity_rollup[sev]}
                  </Badge>
                ))}
              </div>
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant={view === "groups" ? "default" : "outline"}
                  className="h-7 text-xs"
                  onClick={() => setView("groups")}
                >
                  Per pacchetto ({totalGroups})
                </Button>
                <Button
                  size="sm"
                  variant={view === "flat" ? "default" : "outline"}
                  className="h-7 text-xs"
                  onClick={() => { setView("flat"); setPage(1); }}
                >
                  Tutte le CVE ({totalFindings})
                </Button>
              </div>
            </div>

            {view === "groups" ? (
              <div className="overflow-x-auto max-h-[60vh] overflow-y-auto border border-border/40 rounded-md">
                <table className="w-full text-sm">
                  <thead className="text-xs text-muted-foreground border-b sticky top-0 bg-card">
                    <tr>
                      <th className="text-left py-1 pr-2 w-6"></th>
                      <th className="text-left py-1 pr-2">Pacchetto / NVT</th>
                      <th className="text-left py-1 pr-2">Top sev.</th>
                      <th className="text-left py-1 pr-2">CVE breakdown</th>
                      <th className="text-left py-1 pr-2">Fonte</th>
                      <th className="text-left py-1">Ultimo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.groups.map((g) => {
                      const isExp = expanded.has(g.key);
                      const total = g.breakdown.Critical + g.breakdown.High + g.breakdown.Medium + g.breakdown.Low;
                      return (
                        <>
                          <tr
                            key={g.key}
                            className="border-b last:border-b-0 hover:bg-muted/30 cursor-pointer"
                            onClick={() => toggleExpand(g.key)}
                          >
                            <td className="py-1 pr-2 text-center">
                              {isExp ? <ChevronDown className="h-3.5 w-3.5 inline" /> : <ChevronRight className="h-3.5 w-3.5 inline" />}
                            </td>
                            <td className="py-1 pr-2 truncate max-w-[28rem]" title={g.label}>
                              <span className="font-medium">{g.label}</span>
                              <span className="ml-2 text-xs text-muted-foreground">({total} CVE)</span>
                            </td>
                            <td className="py-1 pr-2">
                              <Badge className={SEVERITY_STYLE[g.top_severity] ?? ""}>
                                {g.top_severity}
                                {g.top_cvss != null && ` · ${g.top_cvss.toFixed(1)}`}
                              </Badge>
                            </td>
                            <td className="py-1 pr-2"><BreakdownBadges b={g.breakdown} /></td>
                            <td className="py-1 pr-2"><SourcesBadges sources={g.sources} /></td>
                            <td className="py-1 text-xs text-muted-foreground">{formatDate(g.latest_scanned_at)}</td>
                          </tr>
                          {isExp && (
                            <tr key={`${g.key}-detail`} className="bg-muted/10">
                              <td colSpan={6} className="py-2 px-4">
                                <table className="w-full text-xs">
                                  <thead className="text-muted-foreground">
                                    <tr>
                                      <th className="text-left py-0.5 pr-2">CVE</th>
                                      <th className="text-left py-0.5 pr-2">Severità</th>
                                      <th className="text-left py-0.5 pr-2">CVSS</th>
                                      <th className="text-left py-0.5">Scansionato</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {g.cves.map((c, i) => (
                                      <tr key={`${g.key}-cve-${i}`}>
                                        <td className="py-0.5 pr-2"><CveLink cve={c.cve_id} /></td>
                                        <td className="py-0.5 pr-2">
                                          <Badge className={`text-[10px] px-1.5 py-0 ${SEVERITY_STYLE[c.severity] ?? ""}`}>{c.severity}</Badge>
                                        </td>
                                        <td className="py-0.5 pr-2 font-mono">{c.cvss_score?.toFixed(1) ?? "—"}</td>
                                        <td className="py-0.5 text-muted-foreground">{formatDate(c.scanned_at)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </td>
                            </tr>
                          )}
                        </>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="overflow-x-auto max-h-[60vh] overflow-y-auto border border-border/40 rounded-md">
                <table className="w-full text-sm">
                  <thead className="text-xs text-muted-foreground border-b sticky top-0 bg-card">
                    <tr>
                      <th className="text-left py-1 pr-2">CVE</th>
                      <th className="text-left py-1 pr-2">Severità</th>
                      <th className="text-left py-1 pr-2">CVSS</th>
                      <th className="text-left py-1 pr-2">Porta</th>
                      <th className="text-left py-1 pr-2">Pacchetto / NVT</th>
                      <th className="text-left py-1 pr-2">Fonte</th>
                      <th className="text-left py-1">Scansionato</th>
                    </tr>
                  </thead>
                  <tbody>
                    {flatPaged.map((f) => (
                      <tr key={String(f.id)} className="border-b last:border-b-0">
                        <td className="py-1 pr-2"><CveLink cve={f.cve_id} /></td>
                        <td className="py-1 pr-2"><Badge className={SEVERITY_STYLE[f.severity] ?? ""}>{f.severity}</Badge></td>
                        <td className="py-1 pr-2 font-mono">{f.cvss_score?.toFixed(1) ?? "—"}</td>
                        <td className="py-1 pr-2 font-mono text-xs">{f.port ?? "—"}</td>
                        <td className="py-1 pr-2 truncate max-w-[28rem]" title={f.nvt_name ?? ""}>{f.nvt_name ?? "—"}</td>
                        <td className="py-1 pr-2"><SourcesBadges sources={f.sources} /></td>
                        <td className="py-1 text-xs text-muted-foreground">{formatDate(f.scanned_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {flatPaged.length < data.findings.length && (
                  <div className="flex justify-center p-2">
                    <Button size="sm" variant="outline" onClick={() => setPage((p) => p + 1)}>
                      Carica altri ({data.findings.length - flatPaged.length} rimasti)
                    </Button>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
