"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Pagination } from "@/components/shared/pagination";
import { RefreshCw, AlertTriangle, CheckCircle2, Play } from "lucide-react";
import type { AnomalyEvent, AnomalyType, AnomalySeverity } from "@/types";

// ---------------------------------------------------------------------------

const ANOMALY_TYPE_LABEL: Record<AnomalyType, string> = {
  mac_flip:         "MAC flip",
  new_unknown_host: "Nuovo host",
  port_change:      "Cambio porte",
  uptime_anomaly:   "Uptime anomalo",
  latency_anomaly:  "Latenza anomala",
};

const SEVERITY_STYLE: Record<AnomalySeverity, string> = {
  high:   "bg-red-100 text-red-800 border-red-200",
  medium: "bg-yellow-100 text-yellow-800 border-yellow-200",
  low:    "bg-blue-100 text-blue-800 border-blue-200",
};

const PAGE_SIZE = 50;

// ---------------------------------------------------------------------------

interface AnomalyEventEnriched extends AnomalyEvent {
  _detailParsed?: Record<string, unknown>;
}

function parseDetail(ev: AnomalyEvent): Record<string, unknown> {
  if (!ev.detail_json) return {};
  try { return JSON.parse(ev.detail_json) as Record<string, unknown>; } catch { return {}; }
}

function DetailContent({ ev }: { ev: AnomalyEvent }) {
  const d = parseDetail(ev);

  if (ev.anomaly_type === "mac_flip") {
    return (
      <div className="space-y-2 text-sm">
        <p><span className="font-medium">IP:</span> {String(d.ip ?? "—")}</p>
        <p><span className="font-medium">MAC precedente:</span> <code className="bg-muted px-1 rounded">{String(d.old_mac ?? "—")}</code>
          {d.old_vendor ? ` (${String(d.old_vendor)})` : ""}</p>
        <p><span className="font-medium">Nuovo MAC:</span> <code className="bg-muted px-1 rounded">{String(d.new_mac ?? "—")}</code></p>
      </div>
    );
  }

  if (ev.anomaly_type === "port_change") {
    const added = (d.ports_added as number[] | undefined) ?? [];
    const removed = (d.ports_removed as number[] | undefined) ?? [];
    return (
      <div className="space-y-2 text-sm">
        <p><span className="font-medium">IP:</span> {String(d.ip ?? "—")}</p>
        {added.length > 0 && (
          <p><span className="font-medium text-green-700">Porte aggiunte:</span> {added.join(", ")}</p>
        )}
        {removed.length > 0 && (
          <p><span className="font-medium text-red-700">Porte rimosse:</span> {removed.join(", ")}</p>
        )}
        <p className="text-muted-foreground text-xs">
          Porte baseline: {((d.baseline_ports as number[] | undefined) ?? []).join(", ") || "—"}
        </p>
      </div>
    );
  }

  if (ev.anomaly_type === "latency_anomaly") {
    return (
      <div className="space-y-2 text-sm">
        <p><span className="font-medium">IP:</span> {String(d.ip ?? "—")}</p>
        <p><span className="font-medium">Latenza attuale:</span> {String(d.current_ms ?? "—")} ms</p>
        <p><span className="font-medium">Baseline:</span> {String(d.baseline_mean_ms ?? "—")} ms (±{String(d.baseline_stddev_ms ?? "—")})</p>
        <p><span className="font-medium">Z-score:</span> {String(d.z_score ?? "—")}</p>
      </div>
    );
  }

  if (ev.anomaly_type === "uptime_anomaly") {
    return (
      <div className="space-y-2 text-sm">
        <p><span className="font-medium">IP:</span> {String(d.ip ?? "—")}</p>
        <p><span className="font-medium">Offline (recente):</span> {Math.round(Number(d.offline_rate_recent ?? 0) * 100)}%</p>
        <p><span className="font-medium">Offline (baseline):</span> {Math.round(Number(d.offline_rate_baseline ?? 0) * 100)}%</p>
      </div>
    );
  }

  if (ev.anomaly_type === "new_unknown_host") {
    const ports = (d.open_ports as number[] | undefined) ?? [];
    return (
      <div className="space-y-2 text-sm">
        <p><span className="font-medium">IP:</span> {String(d.ip ?? "—")}</p>
        {d.mac != null && <p><span className="font-medium">MAC:</span> {String(d.mac)}</p>}
        {ports.length > 0 && <p><span className="font-medium">Porte aperte:</span> {ports.join(", ")}</p>}
      </div>
    );
  }

  return <pre className="text-xs bg-muted p-2 rounded overflow-auto">{ev.detail_json ?? "—"}</pre>;
}

// ---------------------------------------------------------------------------

export default function AnalyticsPage() {
  const [events, setEvents] = useState<AnomalyEventEnriched[]>([]);
  const [total, setTotal] = useState(0);
  const [unacked, setUnacked] = useState(0);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [page, setPage] = useState(1);
  const [filterType, setFilterType] = useState<string>("all");
  const [filterAck, setFilterAck] = useState<string>("unacked");
  const [selected, setSelected] = useState<AnomalyEvent | null>(null);

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String((page - 1) * PAGE_SIZE),
      });
      if (filterType !== "all") params.set("type", filterType);
      if (filterAck === "unacked") params.set("acknowledged", "false");
      if (filterAck === "acked") params.set("acknowledged", "true");

      const res = await fetch(`/api/analytics/anomalies?${params}`);
      if (!res.ok) return;
      const data = await res.json() as { events: AnomalyEvent[]; total: number; unacked: number };
      setEvents(data.events.map((e) => ({ ...e, _detailParsed: parseDetail(e) })));
      setTotal(data.total);
      setUnacked(data.unacked);
    } finally {
      setLoading(false);
    }
  }, [page, filterType, filterAck]);

  useEffect(() => { void fetchEvents(); }, [fetchEvents]);

  const acknowledge = async (id: number) => {
    await fetch(`/api/analytics/anomalies/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "acknowledge" }),
    });
    void fetchEvents();
    if (selected?.id === id) setSelected(null);
  };

  const runCheck = async () => {
    setRunning(true);
    try {
      await fetch("/api/analytics/anomalies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      void fetchEvents();
    } finally {
      setRunning(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-4 p-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-yellow-500" />
            Anomalie
            {unacked > 0 && (
              <Badge className="bg-red-500 text-white text-xs px-1.5">{unacked}</Badge>
            )}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Cambiamenti anomali rilevati automaticamente nell&apos;infrastruttura
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void fetchEvents()} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} />
            Aggiorna
          </Button>
          <Button size="sm" onClick={() => void runCheck()} disabled={running}>
            <Play className={`h-3.5 w-3.5 mr-1.5 ${running ? "animate-spin" : ""}`} />
            Esegui check
          </Button>
        </div>
      </div>

      {/* Filtri */}
      <Card>
        <CardContent className="py-3 flex flex-wrap gap-3">
          <Select value={filterAck} onValueChange={(v) => { if (v) { setFilterAck(v); setPage(1); } }}>
            <SelectTrigger className="w-40 h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tutti</SelectItem>
              <SelectItem value="unacked">Non gestiti</SelectItem>
              <SelectItem value="acked">Gestiti</SelectItem>
            </SelectContent>
          </Select>

          <Select value={filterType} onValueChange={(v) => { if (v) { setFilterType(v); setPage(1); } }}>
            <SelectTrigger className="w-44 h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tutti i tipi</SelectItem>
              {Object.entries(ANOMALY_TYPE_LABEL).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <span className="text-xs text-muted-foreground self-center ml-auto">
            {total} eventi
          </span>
        </CardContent>
      </Card>

      {/* Tabella */}
      <Card>
        <CardHeader className="pb-2 pt-4 px-4">
          <CardTitle className="text-sm font-medium">Eventi anomalia</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableCell className="font-medium text-xs text-muted-foreground w-28">Tipo</TableCell>
                <TableCell className="font-medium text-xs text-muted-foreground w-20">Severità</TableCell>
                <TableCell className="font-medium text-xs text-muted-foreground">Descrizione</TableCell>
                <TableCell className="font-medium text-xs text-muted-foreground w-36">Rilevato</TableCell>
                <TableCell className="font-medium text-xs text-muted-foreground w-24">Stato</TableCell>
                <TableCell className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.length === 0 && !loading && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-8">
                    Nessun evento trovato
                  </TableCell>
                </TableRow>
              )}
              {events.map((ev) => (
                <TableRow
                  key={ev.id}
                  className="cursor-pointer hover:bg-muted/40"
                  onClick={() => setSelected(ev)}
                >
                  <TableCell className="py-2 text-xs">
                    {ANOMALY_TYPE_LABEL[ev.anomaly_type] ?? ev.anomaly_type}
                  </TableCell>
                  <TableCell className="py-2">
                    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${SEVERITY_STYLE[ev.severity]}`}>
                      {ev.severity === "high" ? "Alta" : ev.severity === "medium" ? "Media" : "Bassa"}
                    </span>
                  </TableCell>
                  <TableCell className="py-2 text-xs max-w-xs truncate">
                    {ev.description}
                  </TableCell>
                  <TableCell className="py-2 text-xs text-muted-foreground">
                    {new Date(ev.detected_at).toLocaleString("it-IT", {
                      day: "2-digit", month: "2-digit", year: "2-digit",
                      hour: "2-digit", minute: "2-digit",
                    })}
                  </TableCell>
                  <TableCell className="py-2">
                    {ev.acknowledged ? (
                      <span className="inline-flex items-center gap-1 text-xs text-green-700">
                        <CheckCircle2 className="h-3 w-3" /> Gestito
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs text-yellow-700">
                        <AlertTriangle className="h-3 w-3" /> Aperto
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="py-2">
                    {!ev.acknowledged && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs px-2"
                        onClick={(e) => { e.stopPropagation(); void acknowledge(ev.id); }}
                      >
                        Gestisci
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />

      {/* Detail dialog */}
      <Dialog open={!!selected} onOpenChange={(o) => { if (!o) setSelected(null); }}>
        <DialogContent className="max-w-lg">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-sm">
                  <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${SEVERITY_STYLE[selected.severity]}`}>
                    {selected.severity === "high" ? "Alta" : selected.severity === "medium" ? "Media" : "Bassa"}
                  </span>
                  {ANOMALY_TYPE_LABEL[selected.anomaly_type]}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-3 mt-2">
                <p className="text-sm">{selected.description}</p>
                <DetailContent ev={selected} />
                <p className="text-xs text-muted-foreground">
                  Rilevato: {new Date(selected.detected_at).toLocaleString("it-IT")}
                </p>
                {selected.acknowledged && (
                  <p className="text-xs text-green-700">
                    Gestito da {selected.acknowledged_by ?? "—"} il {selected.acknowledged_at ? new Date(selected.acknowledged_at).toLocaleString("it-IT") : "—"}
                  </p>
                )}
                {!selected.acknowledged && (
                  <Button size="sm" onClick={() => void acknowledge(selected.id)}>
                    <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                    Segna come gestito
                  </Button>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
