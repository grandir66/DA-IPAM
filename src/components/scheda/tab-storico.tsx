"use client";

/**
 * Tab «Storico» (comune): disponibilità nel tempo, quando l'host è stato visto, cronologia delle scansioni e
 * gli IP che il suo MAC ha avuto prima. Le porte aperte non sono qui (stanno in Panoramica, una volta sola).
 */
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LoadError } from "@/components/shared/load-error";
import { fetchJson } from "@/lib/fetch-json";
import { dataIpPrecedente, soloData } from "@/lib/hosts/pulizia-testi";
import { Campo, formatDate } from "./blocchi";
import { Riquadro } from "./riquadro";
import type { ContestoScheda } from "./contesto";

const UptimeTimeline = dynamic(() => import("@/components/shared/uptime-timeline").then((m) => ({ default: m.UptimeTimeline })), { ssr: false });
const LatencyChart = dynamic(() => import("@/app/(dashboard)/hosts/[id]/latency-chart").then((m) => ({ default: m.LatencyChart })), { ssr: false });

/**
 * «IP precedenti» (pulizia degli host, piano 2026-10-20, Task 6): gli indirizzi che il MAC di questo host ha avuto
 * prima, dallo storico e dall'archivio. Non compare se non ce ne sono. Nello storico la data è l'ARRIVO del MAC su
 * quell'IP, non la partenza: per questo la colonna si chiama «Ultima data» e ogni riga dice cosa significa.
 */
export function IpPrecedenti({ hostId }: { hostId: number }) {
  const [righe, setRighe] = useState<Array<{ ip: string; fino_al: string; fonte: "storico" | "archivio" }> | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [tentativo, setTentativo] = useState(0);

  useEffect(() => {
    let vivo = true;
    fetchJson<{ righe: Array<{ ip: string; fino_al: string; fonte: "storico" | "archivio" }> }>(`/api/hosts/${hostId}/ip-precedenti`)
      .then((r) => {
        if (!vivo) return;
        if (r.ok) { setRighe(r.data.righe); setErrore(null); } else setErrore(r.message);
      })
      .catch(() => { if (vivo) setErrore("Server non raggiungibile"); });
    return () => { vivo = false; };
  }, [hostId, tentativo]);

  if (errore === null && (righe === null || righe.length === 0)) return null;
  return (
    <Riquadro titolo="IP precedenti">
      {errore !== null ? (
        <LoadError what="gli IP precedenti" message={errore} onRetry={() => setTentativo((t) => t + 1)} />
      ) : (
        <Table>
          <TableHeader>
            <TableRow><TableHead>IP</TableHead><TableHead>Ultima data</TableHead><TableHead>Da dove</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {(righe ?? []).map((r) => (
              <TableRow key={r.ip}>
                <TableCell className="font-mono text-[13px]">{r.ip}</TableCell>
                <TableCell className="text-[13px]">{dataIpPrecedente(r.fonte, soloData(r.fino_al))}</TableCell>
                <TableCell className="text-[13px]">{r.fonte}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Riquadro>
  );
}

export function TabStorico({ ctx }: { ctx: ContestoScheda }) {
  const { host, hostId } = ctx;
  return (
    <div className="space-y-4">
      <Riquadro titolo="Disponibilità">
        <div className="space-y-4">
          <div>
            <div className="mb-1.5 text-[13px] font-semibold text-muted-foreground">Uptime nel tempo</div>
            <UptimeTimeline hostId={host.id} />
          </div>
          <div>
            <div className="mb-1.5 text-[13px] font-semibold text-muted-foreground">Latenza ICMP (ms)</div>
            <LatencyChart hostId={host.id} />
          </div>
        </div>
      </Riquadro>

      <div className="grid gap-4 lg:grid-cols-2">
        <Riquadro titolo="Discovery">
          <dl className="grid grid-cols-2 gap-4">
            <Campo label="Scoperto" value={host.first_seen ? formatDate(host.first_seen) : null} />
            <Campo label="Ultima volta visto" value={host.last_seen ? formatDate(host.last_seen) : null} />
            <Campo label="Host noto" value={host.known_host ? "Sì" : "No"} />
          </dl>
        </Riquadro>

        <Riquadro titolo="Cronologia scansioni" vuoto={!host.recent_scans || host.recent_scans.length === 0}>
          <div className="space-y-1.5">
            {(host.recent_scans ?? []).slice(0, 10).map((s) => (
              <div key={s.id} className="flex items-center gap-3 font-mono text-[13px]">
                <span className="text-muted-foreground">{formatDate(s.timestamp)}</span>
                <Badge variant="outline" className="text-[13px]">{s.scan_type}</Badge>
                <span className={s.status === "online" ? "font-semibold" : "text-muted-foreground"}>
                  {s.status === "online" ? "✓ " : ""}{s.status}
                </span>
              </div>
            ))}
          </div>
        </Riquadro>
      </div>

      {Number.isFinite(hostId) && hostId > 0 && <IpPrecedenti hostId={hostId} />}
    </div>
  );
}
