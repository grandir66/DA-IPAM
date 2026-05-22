"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ShieldAlert } from "lucide-react";

interface Finding {
  id: number;
  cve_id: string | null;
  cvss_score: number | null;
  severity: string;
  port: string | null;
  service: string | null;
  nvt_name: string | null;
  scanned_at: string;
}

interface VulnPayload {
  host_id: number;
  last_run: {
    id: number;
    started_at: string;
    finished_at: string | null;
    finding_count: number;
  } | null;
  severity_rollup: {
    Critical: number;
    High: number;
    Medium: number;
    Low: number;
    Log: number;
  };
  findings: Finding[];
}

const SEVERITY_STYLE: Record<string, string> = {
  Critical: "bg-red-600 text-white",
  High: "bg-orange-500 text-white",
  Medium: "bg-yellow-500 text-black",
  Low: "bg-blue-500 text-white",
};

export function HostVulnerabilitiesCard({ hostId }: { hostId: number }) {
  const [data, setData] = useState<VulnPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const r = await fetch(`/api/hosts/${hostId}/vulnerabilities`);
        if (!r.ok) {
          setErr(`HTTP ${r.status}`);
          return;
        }
        const d = (await r.json()) as VulnPayload;
        if (active) setData(d);
      } catch (e) {
        if (active) setErr((e as Error).message);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [hostId]);

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

  const hasFindings = data.findings.length > 0;
  const totalLastRun = data.last_run?.finding_count ?? 0;

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
              {" · "}{totalLastRun} finding
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!hasFindings ? (
          <p className="text-sm text-muted-foreground">
            Nessun finding archiviato per questo host. Verifica che lo scanner-edge sia configurato in
            Impostazioni → Integrazioni e che il sync sia avvenuto.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2 mb-3 text-xs">
              {(["Critical", "High", "Medium", "Low"] as const).map((sev) => (
                <Badge key={sev} className={SEVERITY_STYLE[sev]}>
                  {sev}: {data.severity_rollup[sev]}
                </Badge>
              ))}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground border-b">
                  <tr>
                    <th className="text-left py-1 pr-2">CVE</th>
                    <th className="text-left py-1 pr-2">Severità</th>
                    <th className="text-left py-1 pr-2">CVSS</th>
                    <th className="text-left py-1 pr-2">Porta</th>
                    <th className="text-left py-1 pr-2">NVT</th>
                    <th className="text-left py-1">Scansionato</th>
                  </tr>
                </thead>
                <tbody>
                  {data.findings.slice(0, 20).map((f) => (
                    <tr key={f.id} className="border-b last:border-b-0">
                      <td className="py-1 pr-2 font-mono text-xs">
                        {f.cve_id ? (
                          <a
                            href={`https://nvd.nist.gov/vuln/detail/${f.cve_id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:underline"
                          >
                            {f.cve_id}
                          </a>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="py-1 pr-2">
                        <Badge className={SEVERITY_STYLE[f.severity] ?? ""}>{f.severity}</Badge>
                      </td>
                      <td className="py-1 pr-2 font-mono">{f.cvss_score?.toFixed(1) ?? "—"}</td>
                      <td className="py-1 pr-2 font-mono text-xs">{f.port ?? "—"}</td>
                      <td className="py-1 pr-2 truncate max-w-[28rem]" title={f.nvt_name ?? ""}>
                        {f.nvt_name ?? "—"}
                      </td>
                      <td className="py-1 text-xs text-muted-foreground">
                        {new Date(f.scanned_at).toLocaleDateString("it-IT")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {data.findings.length > 20 && (
                <p className="text-xs text-muted-foreground mt-2">
                  Mostrate 20 di {data.findings.length} findings storici per questo host.
                </p>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
