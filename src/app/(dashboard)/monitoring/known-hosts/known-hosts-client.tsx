"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/shared/status-badge";
import { ExternalLink, Activity } from "lucide-react";
import { toast } from "sonner";
import type { KnownHostWithNetworkRow } from "@/types";

type Row = KnownHostWithNetworkRow;

export function KnownHostsClient({ initialRows }: { initialRows: Row[] }) {
  const router = useRouter();
  const [running, setRunning] = useState(false);

  async function runCheck() {
    setRunning(true);
    try {
      const res = await fetch("/api/monitoring/known-hosts/run-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = (await res.json()) as { error?: string; message?: string };
      if (res.ok) {
        toast.success(data.message ?? "Verifica completata");
        router.refresh();
      } else {
        toast.error(data.error ?? "Errore");
      }
    } catch {
      toast.error("Errore di rete");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => void runCheck()} disabled={running || initialRows.length === 0}>
          <Activity className={`h-4 w-4 mr-2 ${running ? "animate-pulse" : ""}`} />
          {running ? "Verifica in corso…" : "Verifica ora"}
        </Button>
        <span className="text-xs text-muted-foreground">
          Esegue ping/TCP come il job «Monitoraggio host conosciuti» (può richiedere tempo).
        </span>
      </div>

      {initialRows.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center border rounded-md">
          Nessun host conosciuto. Dalla scheda rete, seleziona gli IP e usa «Segna come conosciuti».
        </p>
      ) : (
        <div className="rounded-md border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Rete</TableHead>
                <TableHead>IP</TableHead>
                <TableHead>Hostname / nome</TableHead>
                <TableHead>Stato</TableHead>
                <TableHead className="whitespace-nowrap">Ultimo contatto</TableHead>
                <TableHead className="text-right">Latenza ms</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {initialRows.map((h) => {
                const displayName =
                  h.custom_name || h.hostname || h.dns_reverse || "—";
                const unreachable = h.status === "offline" || h.status === "unknown";
                return (
                  <TableRow
                    key={h.id}
                    className={unreachable ? "bg-destructive/5" : undefined}
                  >
                    <TableCell className="text-sm">
                      <span className="font-medium">{h.network_name}</span>
                      <span className="text-muted-foreground font-mono text-xs ml-1">{h.network_cidr}</span>
                    </TableCell>
                    <TableCell className="font-mono text-sm">{h.ip}</TableCell>
                    <TableCell className="text-sm max-w-[200px] truncate" title={displayName}>
                      {displayName}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2 flex-wrap">
                        <StatusBadge status={h.status} />
                        {unreachable && (
                          <Badge variant="destructive" className="text-xs">
                            Irraggiungibile
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {h.last_seen ? new Date(h.last_seen).toLocaleString("it-IT") : "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {h.last_response_time_ms != null ? h.last_response_time_ms : "—"}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        nativeButton={false}
                        render={<Link href={`/hosts/${h.id}`} title="Schede host" />}
                      >
                        <ExternalLink className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
