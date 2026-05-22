"use client";

/**
 * Card "Software" sulla pagina dettaglio host o device.
 *   - header con stato ultimo scan
 *   - bottone "Scansiona ora" → dialog (credenziale + timeout)
 *   - sub-tabs: Applicazioni / Storico / Log
 *   - polling /api/software-scans/{id}?withLogs=true durante un run
 *
 * Wrapper esportati:
 *   - HostSoftwareCard({ hostId })   → target /api/hosts/[id]/...
 *   - DeviceSoftwareCard({ deviceId }) → target /api/devices/[id]/...
 *
 * Stringhe italiane. Nessun `any`. Cleanup intervalli con useRef + useEffect.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Boxes, Download, RefreshCw, ScanSearch } from "lucide-react";
import type {
  Credential,
  SoftwareInventoryRow,
  SoftwareScan,
  SoftwareScanLog,
} from "@/types";

/** Target del componente: host (entry di rete) o device (managed network_device). */
type CardTarget = { kind: "host"; id: number } | { kind: "device"; id: number };

interface InternalProps {
  target: CardTarget;
}

interface HostProps {
  hostId: number;
}

interface DeviceProps {
  deviceId: number;
}

interface CurrentResponse {
  scan: SoftwareScan | null;
  inventory: SoftwareInventoryRow[];
}

interface ScansResponse {
  scans: SoftwareScan[];
}

interface DetailResponse {
  scan: SoftwareScan;
  inventory: SoftwareInventoryRow[];
  logs?: SoftwareScanLog[];
}

interface ScanResultResponse {
  scanId: number;
  status: "ok" | "error" | "timeout";
  appsCount: number;
  errorMessage?: string;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso.replace(" ", "T") + (iso.includes("Z") ? "" : "Z"));
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("it-IT");
}

function fmtDuration(scan: SoftwareScan): string {
  if (!scan.finished_at) return "—";
  const s = new Date(scan.started_at.replace(" ", "T") + "Z").getTime();
  const f = new Date(scan.finished_at.replace(" ", "T") + "Z").getTime();
  if (!Number.isFinite(s) || !Number.isFinite(f) || f <= s) return "—";
  const ms = f - s;
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

function statusBadge(status: SoftwareScan["status"]): { label: string; className: string } {
  switch (status) {
    case "ok":
      return { label: "OK", className: "bg-green-500/15 text-green-600 border-green-300" };
    case "running":
      return { label: "In corso", className: "bg-blue-500/15 text-blue-600 border-blue-300" };
    case "timeout":
      return { label: "Timeout", className: "bg-amber-500/15 text-amber-600 border-amber-300" };
    case "cancelled":
      return { label: "Annullato", className: "bg-muted text-muted-foreground" };
    case "error":
    default:
      return { label: "Errore", className: "bg-red-500/15 text-red-600 border-red-300" };
  }
}

function logLevelBadge(level: SoftwareScanLog["level"]): string {
  switch (level) {
    case "error":
      return "bg-red-500/15 text-red-600 border-red-300";
    case "warn":
      return "bg-amber-500/15 text-amber-600 border-amber-300";
    case "debug":
      return "bg-muted text-muted-foreground";
    case "info":
    default:
      return "bg-blue-500/15 text-blue-600 border-blue-300";
  }
}

function csvEscape(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (s.includes('"') || s.includes(",") || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function exportInventoryCsv(label: string, scanId: number, rows: SoftwareInventoryRow[]) {
  const header = [
    "name",
    "version",
    "publisher",
    "install_date",
    "install_location",
    "source",
    "architecture",
    "size_bytes",
  ].join(",");
  const lines = rows.map((r) =>
    [
      r.name,
      r.version,
      r.publisher,
      r.install_date,
      r.install_location,
      r.source,
      r.architecture,
      r.size_bytes,
    ]
      .map(csvEscape)
      .join(",")
  );
  const blob = new Blob([header + "\n" + lines.join("\n")], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${label}-software-scan-${scanId}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function SoftwareScanCard({ target }: InternalProps) {
  const apiBase =
    target.kind === "host"
      ? `/api/hosts/${target.id}`
      : `/api/devices/${target.id}`;
  const csvLabel = target.kind === "host" ? `host-${target.id}` : `device-${target.id}`;
  const [current, setCurrent] = useState<CurrentResponse | null>(null);
  const [history, setHistory] = useState<SoftwareScan[]>([]);
  const [selectedScanId, setSelectedScanId] = useState<number | null>(null);
  const [detail, setDetail] = useState<DetailResponse | null>(null);
  const [loadingCurrent, setLoadingCurrent] = useState(true);
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [scanDialogOpen, setScanDialogOpen] = useState(false);
  const [scanForm, setScanForm] = useState({
    credentialId: "",
    timeoutSec: 60,
  });
  const [running, setRunning] = useState<{
    scanId: number;
    startedAt: number;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [filter, setFilter] = useState("");
  const pollRef = useRef<NodeJS.Timeout | null>(null);

  const refreshCurrent = useCallback(async () => {
    try {
      const r = await fetch(`${apiBase}/software-current`);
      if (!r.ok) {
        setCurrent({ scan: null, inventory: [] });
        return;
      }
      const data = (await r.json()) as CurrentResponse;
      setCurrent(data);
    } catch {
      setCurrent({ scan: null, inventory: [] });
    } finally {
      setLoadingCurrent(false);
    }
  }, [apiBase]);

  const refreshHistory = useCallback(async () => {
    try {
      const r = await fetch(`${apiBase}/software-scans?limit=50`);
      if (!r.ok) {
        setHistory([]);
        return;
      }
      const data = (await r.json()) as ScansResponse;
      setHistory(data.scans);
    } catch {
      setHistory([]);
    }
  }, [apiBase]);

  const refreshDetail = useCallback(
    async (scanId: number, withLogs: boolean) => {
      try {
        const r = await fetch(
          `/api/software-scans/${scanId}${withLogs ? "?withLogs=true" : ""}`
        );
        if (!r.ok) {
          setDetail(null);
          return null;
        }
        const data = (await r.json()) as DetailResponse;
        setDetail(data);
        return data;
      } catch {
        setDetail(null);
        return null;
      }
    },
    []
  );

  // Carica credenziali compatibili
  useEffect(() => {
    void (async () => {
      try {
        const r = await fetch("/api/credentials");
        if (!r.ok) return;
        const data = (await r.json()) as Credential[];
        const compat = data.filter(
          (c) => c.credential_type === "windows" || c.credential_type === "linux"
        );
        setCredentials(compat);
        if (compat.length > 0 && !scanForm.credentialId) {
          setScanForm((f) => ({ ...f, credentialId: String(compat[0].id) }));
        }
      } catch {
        /* no-op */
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void refreshCurrent();
    void refreshHistory();
  }, [refreshCurrent, refreshHistory]);

  // Quando arriva un scan corrente, seleziona quello come default per il detail
  useEffect(() => {
    if (current?.scan && selectedScanId === null) {
      setSelectedScanId(current.scan.id);
    }
  }, [current, selectedScanId]);

  useEffect(() => {
    if (selectedScanId !== null) {
      void refreshDetail(selectedScanId, true);
    }
  }, [selectedScanId, refreshDetail]);

  // Polling durante un run attivo
  useEffect(() => {
    if (!running) {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }
    const tick = async () => {
      const data = await refreshDetail(running.scanId, true);
      if (data && data.scan.status !== "running") {
        setRunning(null);
        void refreshCurrent();
        void refreshHistory();
      }
    };
    void tick();
    pollRef.current = setInterval(() => {
      void tick();
    }, 2000);
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [running, refreshDetail, refreshCurrent, refreshHistory]);

  const handleStartScan = useCallback(async () => {
    const credId = Number(scanForm.credentialId);
    if (!Number.isFinite(credId) || credId <= 0) {
      toast.error("Seleziona una credenziale");
      return;
    }
    const timeoutMs = Math.max(5, Math.trunc(scanForm.timeoutSec)) * 1000;
    setScanDialogOpen(false);
    setSubmitting(true);
    try {
      const r = await fetch(`${apiBase}/software-scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credentialId: credId, timeoutMs }),
      });
      if (!r.ok) {
        const err = (await r.json().catch(() => null)) as { error?: string } | null;
        toast.error(err?.error ?? `Errore HTTP ${r.status}`);
        return;
      }
      const data = (await r.json()) as ScanResultResponse;
      setSelectedScanId(data.scanId);
      if (data.status === "ok") {
        toast.success(`Scan completato: ${data.appsCount} applicazioni`);
      } else if (data.status === "timeout") {
        toast.error(`Timeout scan: ${data.errorMessage ?? ""}`);
      } else {
        toast.error(`Scan in errore: ${data.errorMessage ?? ""}`);
      }
      void refreshCurrent();
      void refreshHistory();
      void refreshDetail(data.scanId, true);
    } catch (e) {
      toast.error(`Errore: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSubmitting(false);
    }
  }, [
    apiBase,
    scanForm.credentialId,
    scanForm.timeoutSec,
    refreshCurrent,
    refreshHistory,
    refreshDetail,
  ]);

  const filteredInventory = useMemo(() => {
    if (!detail) return [];
    const f = filter.trim().toLowerCase();
    if (!f) return detail.inventory;
    return detail.inventory.filter(
      (p) =>
        p.name.toLowerCase().includes(f) ||
        (p.publisher && p.publisher.toLowerCase().includes(f)) ||
        (p.version && p.version.toLowerCase().includes(f))
    );
  }, [detail, filter]);

  if (loadingCurrent) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Boxes className="h-3.5 w-3.5" />
            Software installato
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Caricamento…</p>
        </CardContent>
      </Card>
    );
  }

  const lastScan = current?.scan ?? null;
  const credentialOptions = credentials;
  const noCompatCredentials = credentialOptions.length === 0;
  const isRunning = running !== null || submitting;

  return (
    <>
      <Card>
        <CardHeader className="pb-2 flex flex-row items-start justify-between gap-3">
          <div>
            <CardTitle className="text-sm flex items-center gap-2">
              <Boxes className="h-3.5 w-3.5" />
              Software installato
            </CardTitle>
            <CardDescription className="text-xs">
              {lastScan
                ? `Ultimo scan: ${fmtDate(lastScan.started_at)} — ${lastScan.apps_count} applicazioni (${lastScan.probe})`
                : "Nessuno scan eseguito"}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void refreshCurrent();
                void refreshHistory();
                if (selectedScanId !== null) void refreshDetail(selectedScanId, true);
              }}
              disabled={isRunning}
              className="gap-1.5"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Aggiorna
            </Button>
            <Button
              size="sm"
              onClick={() => setScanDialogOpen(true)}
              disabled={isRunning || noCompatCredentials}
              className="gap-1.5"
            >
              <ScanSearch className="h-3.5 w-3.5" />
              Scansiona ora
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {noCompatCredentials && (
            <p className="text-xs text-amber-600">
              Nessuna credenziale Windows o Linux configurata. Aggiungila da
              Impostazioni → Credenziali.
            </p>
          )}
          {(submitting || running) && (
            <div className="rounded-md border border-blue-300 bg-blue-50/50 px-3 py-2 text-xs space-y-1.5">
              <div className="flex items-center gap-2">
                <RefreshCw className="h-3 w-3 animate-spin" />
                <span className="font-medium">
                  {running ? `Scan in corso (#${running.scanId})…` : "Scan in corso…"}
                </span>
                {running && (
                  <span className="text-muted-foreground">
                    trascorsi {Math.round((Date.now() - running.startedAt) / 1000)} s
                  </span>
                )}
              </div>
              {detail?.logs && detail.logs.length > 0 && (
                <div className="mt-1 max-h-40 overflow-auto rounded bg-background/60 p-1 font-mono text-[10px]">
                  {detail.logs.slice(-10).map((l) => (
                    <div key={l.id} className="truncate">
                      <span className="text-muted-foreground">{l.ts}</span>{" "}
                      <span className="uppercase">{l.level}</span>{" "}
                      {l.step && <span>[{l.step}]</span>} {l.message}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <Tabs defaultValue="apps">
            <TabsList>
              <TabsTrigger value="apps">
                Applicazioni {detail ? `(${detail.inventory.length})` : ""}
              </TabsTrigger>
              <TabsTrigger value="history">
                Storico {history.length > 0 ? `(${history.length})` : ""}
              </TabsTrigger>
              <TabsTrigger value="logs">Log</TabsTrigger>
            </TabsList>

            <TabsContent value="apps" className="mt-3 space-y-2">
              {!detail || detail.inventory.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nessuna applicazione disponibile per lo scan selezionato.
                </p>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <Input
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                      placeholder="Cerca per nome, editore, versione…"
                      className="h-8"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        exportInventoryCsv(csvLabel, detail.scan.id, filteredInventory)
                      }
                      className="gap-1.5 shrink-0"
                    >
                      <Download className="h-3.5 w-3.5" />
                      Export CSV
                    </Button>
                  </div>
                  <div className="rounded-md border max-h-[480px] overflow-auto">
                    <Table>
                      <TableHeader className="sticky top-0 bg-background">
                        <TableRow>
                          <TableHead>Nome</TableHead>
                          <TableHead className="w-32">Versione</TableHead>
                          <TableHead className="w-48">Editore</TableHead>
                          <TableHead className="w-28">Installazione</TableHead>
                          <TableHead className="w-24">Source</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredInventory.slice(0, 1000).map((p) => (
                          <TableRow key={p.id}>
                            <TableCell className="text-xs">{p.name}</TableCell>
                            <TableCell className="font-mono text-[11px]">
                              {p.version ?? "—"}
                            </TableCell>
                            <TableCell className="text-xs truncate max-w-[200px]" title={p.publisher ?? ""}>
                              {p.publisher ?? "—"}
                            </TableCell>
                            <TableCell className="text-xs">
                              {p.install_date ?? "—"}
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className="text-[10px]">
                                {p.source}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  {filteredInventory.length > 1000 && (
                    <p className="text-[11px] text-muted-foreground">
                      Mostrate 1000 di {filteredInventory.length} righe (raffina il filtro o esporta CSV).
                    </p>
                  )}
                </>
              )}
            </TabsContent>

            <TabsContent value="history" className="mt-3">
              {history.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nessuno scan storico.</p>
              ) : (
                <div className="rounded-md border max-h-[480px] overflow-auto">
                  <Table>
                    <TableHeader className="sticky top-0 bg-background">
                      <TableRow>
                        <TableHead className="w-32">Data</TableHead>
                        <TableHead className="w-20">Stato</TableHead>
                        <TableHead className="w-16">App</TableHead>
                        <TableHead className="w-24">Durata</TableHead>
                        <TableHead className="w-24">Probe</TableHead>
                        <TableHead className="w-24">Trigger</TableHead>
                        <TableHead className="w-20"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {history.map((s) => {
                        const sb = statusBadge(s.status);
                        return (
                          <TableRow
                            key={s.id}
                            className={selectedScanId === s.id ? "bg-muted/40" : ""}
                          >
                            <TableCell className="text-xs">{fmtDate(s.started_at)}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className={`text-[10px] ${sb.className}`}>
                                {sb.label}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-xs">{s.apps_count}</TableCell>
                            <TableCell className="text-xs">{fmtDuration(s)}</TableCell>
                            <TableCell className="text-[11px]">
                              <Badge variant="outline" className="text-[10px]">
                                {s.probe}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-[11px] text-muted-foreground">
                              {s.triggered_by}
                            </TableCell>
                            <TableCell>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setSelectedScanId(s.id)}
                              >
                                Apri
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </TabsContent>

            <TabsContent value="logs" className="mt-3">
              {!detail || !detail.logs || detail.logs.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nessun log disponibile per lo scan selezionato.
                </p>
              ) : (
                <div className="rounded-md border max-h-[480px] overflow-auto">
                  <Table>
                    <TableHeader className="sticky top-0 bg-background">
                      <TableRow>
                        <TableHead className="w-40">Timestamp</TableHead>
                        <TableHead className="w-16">Livello</TableHead>
                        <TableHead className="w-24">Step</TableHead>
                        <TableHead>Messaggio</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {detail.logs.map((l) => (
                        <TableRow key={l.id}>
                          <TableCell className="font-mono text-[11px]">{l.ts}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={`text-[10px] ${logLevelBadge(l.level)}`}>
                              {l.level}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs">{l.step ?? "—"}</TableCell>
                          <TableCell className="text-xs">{l.message}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Dialog open={scanDialogOpen} onOpenChange={setScanDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Scansiona software</DialogTitle>
            <DialogDescription>
              Seleziona una credenziale Windows o Linux e avvia lo scan inventario.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Credenziale</Label>
              <Select
                value={scanForm.credentialId}
                onValueChange={(v) =>
                  setScanForm((f) => ({ ...f, credentialId: v ?? "" }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Seleziona credenziale" />
                </SelectTrigger>
                <SelectContent>
                  {credentialOptions.map((c) => {
                    const isWin = c.credential_type === "windows";
                    return (
                      <SelectItem key={c.id} value={String(c.id)}>
                        <span className="inline-flex items-center gap-2">
                          <Badge
                            variant="outline"
                            className={
                              isWin
                                ? "border-blue-400 text-blue-700 bg-blue-50 dark:bg-blue-950"
                                : "border-orange-400 text-orange-700 bg-orange-50 dark:bg-orange-950"
                            }
                          >
                            {isWin ? "Windows" : "Linux"}
                          </Badge>
                          <span>{c.name}</span>
                        </span>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Il badge indica il protocollo: <span className="text-blue-700 dark:text-blue-300">Windows → WinRM 5986</span>, <span className="text-orange-700 dark:text-orange-300">Linux → SSH 22</span>.
              </p>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Timeout (secondi)</Label>
              <Input
                type="number"
                min={5}
                max={600}
                value={scanForm.timeoutSec}
                onChange={(e) =>
                  setScanForm((f) => ({
                    ...f,
                    timeoutSec: Number.parseInt(e.target.value, 10) || 60,
                  }))
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setScanDialogOpen(false)}>
              Annulla
            </Button>
            <Button onClick={handleStartScan}>Avvia</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Wrapper: card software per pagina dettaglio host. */
export function HostSoftwareCard({ hostId }: HostProps) {
  return <SoftwareScanCard target={{ kind: "host", id: hostId }} />;
}

/** Wrapper: card software per pagina dettaglio device (network_devices). */
export function DeviceSoftwareCard({ deviceId }: DeviceProps) {
  return <SoftwareScanCard target={{ kind: "device", id: deviceId }} />;
}
