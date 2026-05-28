"use client";

/**
 * Patch Management — Storico operazioni (F9).
 *
 * Tabella `patch_operations` (audit log immutabile) filtrabile per host,
 * CVE, user, status, action, intervallo date. Riga cliccabile → dialog
 * read-only con dettagli + log se presenti.
 *
 * Backend: `GET /api/patch/operations?hostId=&cveId=&userId=&status=&action=&since=&until=&limit=&offset=`
 *
 * NOTA: la search "host" è client-side su `hostHostname/hostIp/hostCustomName`
 * (campi che il backend già JOIN-a su `hosts`). Per CVE/user/status/action/since
 * il filtro è server-side (riavvia la fetch).
 *
 * Toggle "Solo le mie" usa lo userId della sessione → ?userId=N.
 *
 * Polling: NON usato (lista statica, refresh manuale + auto refresh al cambio
 * filtri/pagina).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import {
  AlertCircle,
  ClipboardList,
  Filter,
  History,
  Loader2,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogScrollableArea,
  DialogTitle,
  DIALOG_PANEL_WIDE_CLASS,
} from "@/components/ui/dialog";

type PatchAction =
  | "probe"
  | "bootstrap"
  | "upgrade"
  | "install"
  | "uninstall"
  | "rollback";

type PatchStatus =
  | "queued"
  | "running"
  | "success"
  | "failed"
  | "reboot_pending"
  | "cancelled";

interface OperationItem {
  id: number;
  hostId: number;
  userId: number;
  cveId: string | null;
  packageManager: string;
  packageId: string | null;
  packageVersionBefore: string | null;
  packageVersionTarget: string | null;
  packageVersionAfter: string | null;
  action: PatchAction;
  status: PatchStatus;
  exitCode: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  rebootRequired: boolean;
  logFilePath: string | null;
  logOffset: number;
  errorMessage: string | null;
  hostHostname: string | null;
  hostIp: string | null;
  hostCustomName: string | null;
}

interface OperationsResponse {
  items: OperationItem[];
  limit: number;
  offset: number;
}

interface LogLine {
  id: number;
  ts: string;
  stream: string;
  line: string;
}

interface LogsResponse {
  lines: LogLine[];
  nextOffset?: number;
  lastLogId?: number;
  finished?: boolean;
  status?: PatchStatus;
}

const PAGE_SIZE = 50;

type StatusFilter = "all" | PatchStatus;
type ActionFilter = "all" | PatchAction;

function statusVariant(
  s: PatchStatus
): "default" | "destructive" | "secondary" | "outline" {
  if (s === "success") return "default";
  if (s === "failed" || s === "cancelled") return "destructive";
  if (s === "reboot_pending") return "outline";
  return "secondary";
}

function statusLabel(s: PatchStatus): string {
  switch (s) {
    case "queued":
      return "In coda";
    case "running":
      return "In corso";
    case "success":
      return "Successo";
    case "failed":
      return "Fallita";
    case "reboot_pending":
      return "Riavvio richiesto";
    case "cancelled":
      return "Annullata";
  }
}

function actionLabel(a: PatchAction): string {
  switch (a) {
    case "probe":
      return "Probe";
    case "bootstrap":
      return "Bootstrap";
    case "upgrade":
      return "Upgrade";
    case "install":
      return "Install";
    case "uninstall":
      return "Uninstall";
    case "rollback":
      return "Rollback";
  }
}

function actionVariant(a: PatchAction): "default" | "secondary" | "outline" {
  if (a === "upgrade" || a === "install") return "default";
  if (a === "uninstall" || a === "rollback") return "outline";
  return "secondary";
}

function formatRelative(iso: string | null): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  const diffMs = Date.now() - t;
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return `${sec}s fa`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}min fa`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h fa`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}g fa`;
  return new Date(t).toLocaleDateString("it-IT");
}

function formatAbsolute(iso: string | null): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  return new Date(t).toLocaleString("it-IT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatDuration(start: string | null, end: string | null): string {
  if (!start || !end) return "—";
  const ts = Date.parse(start);
  const te = Date.parse(end);
  if (!Number.isFinite(ts) || !Number.isFinite(te)) return "—";
  const sec = Math.max(0, Math.floor((te - ts) / 1000));
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s}s`;
}

function hostDisplayName(op: OperationItem): string {
  return (
    op.hostCustomName ||
    op.hostHostname ||
    op.hostIp ||
    `Host #${op.hostId}`
  );
}

function packageDisplay(op: OperationItem): string {
  if (!op.packageId) return "—";
  const before = op.packageVersionBefore;
  const after = op.packageVersionAfter ?? op.packageVersionTarget;
  if (before && after && before !== after) {
    return `${op.packageId} (${before} → ${after})`;
  }
  if (after) return `${op.packageId} (${after})`;
  return op.packageId;
}

export default function PatchHistoryPage() {
  const { data: session } = useSession();
  const sessionUserId = useMemo(() => {
    const raw = (session?.user as { id?: string } | undefined)?.id;
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }, [session]);

  const [items, setItems] = useState<OperationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [moduleMissing, setModuleMissing] = useState(false);

  // Filtri server-side
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [actionFilter, setActionFilter] = useState<ActionFilter>("all");
  const [cveIdFilter, setCveIdFilter] = useState("");
  const [sinceFilter, setSinceFilter] = useState(""); // YYYY-MM-DD
  const [onlyMine, setOnlyMine] = useState(false);

  // Filtro client-side: search host
  const [searchHost, setSearchHost] = useState("");

  // Paginazione
  const [offset, setOffset] = useState(0);

  // Dialog dettaglio
  const [detailOp, setDetailOp] = useState<OperationItem | null>(null);
  const [detailLogs, setDetailLogs] = useState<LogLine[]>([]);
  const [detailLogsLoading, setDetailLogsLoading] = useState(false);
  const [detailLogsError, setDetailLogsError] = useState<string | null>(null);

  const fetchOps = useCallback(async () => {
    setLoading(true);
    setError(null);
    setModuleMissing(false);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (actionFilter !== "all") params.set("action", actionFilter);
      const trimmedCve = cveIdFilter.trim();
      if (trimmedCve) params.set("cveId", trimmedCve);
      if (sinceFilter) params.set("since", sinceFilter);
      if (onlyMine && sessionUserId != null) {
        params.set("userId", String(sessionUserId));
      }
      params.set("limit", String(PAGE_SIZE));
      params.set("offset", String(offset));

      const res = await fetch(`/api/patch/operations?${params.toString()}`, {
        cache: "no-store",
      });

      if (res.status === 404) {
        setModuleMissing(true);
        setItems([]);
        toast.error(
          "Modulo Patch Management non installato. Vai a Impostazioni → Moduli per installarlo."
        );
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as OperationsResponse;
      setItems(data.items ?? []);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Errore caricamento operazioni";
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [
    statusFilter,
    actionFilter,
    cveIdFilter,
    sinceFilter,
    onlyMine,
    sessionUserId,
    offset,
  ]);

  useEffect(() => {
    void fetchOps();
  }, [fetchOps]);

  // Reset offset quando cambiano i filtri server-side
  useEffect(() => {
    setOffset(0);
  }, [statusFilter, actionFilter, cveIdFilter, sinceFilter, onlyMine]);

  const filteredItems = items.filter((op) => {
    if (!searchHost) return true;
    const q = searchHost.toLowerCase();
    return (
      hostDisplayName(op).toLowerCase().includes(q) ||
      (op.hostIp ?? "").toLowerCase().includes(q) ||
      (op.hostHostname ?? "").toLowerCase().includes(q)
    );
  });

  const pageIndex = Math.floor(offset / PAGE_SIZE) + 1;

  const resetFilters = () => {
    setStatusFilter("all");
    setActionFilter("all");
    setCveIdFilter("");
    setSinceFilter("");
    setOnlyMine(false);
    setSearchHost("");
  };

  // Apertura dialog dettaglio: carica log se presenti
  const openDetail = useCallback(async (op: OperationItem) => {
    setDetailOp(op);
    setDetailLogs([]);
    setDetailLogsError(null);
    if (op.status === "queued") {
      // niente log ancora
      return;
    }
    setDetailLogsLoading(true);
    try {
      // after_log_id=0 → recupera tutta la storia dal DB
      const res = await fetch(
        `/api/patch/operations/${op.id}/logs?after_log_id=0`,
        { cache: "no-store" }
      );
      if (!res.ok) {
        if (res.status === 404) {
          // Modulo disattivato nel frattempo, ignora
          setDetailLogsError("Modulo non più disponibile");
          return;
        }
        const body = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as LogsResponse;
      setDetailLogs(data.lines ?? []);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Errore caricamento log";
      setDetailLogsError(msg);
    } finally {
      setDetailLogsLoading(false);
    }
  }, []);

  const closeDetail = () => {
    setDetailOp(null);
    setDetailLogs([]);
    setDetailLogsError(null);
  };

  const hasActiveFilters =
    statusFilter !== "all" ||
    actionFilter !== "all" ||
    cveIdFilter.trim() !== "" ||
    sinceFilter !== "" ||
    onlyMine ||
    searchHost !== "";

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <History className="h-6 w-6" />
            Storico operazioni
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Audit log immutabile delle operazioni Patch Management (probe,
            bootstrap, upgrade). Click su una riga per il dettaglio.{" "}
            <Link
              href="/patch-management"
              className="underline text-primary"
            >
              ← Torna a Patch Management
            </Link>
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-sm text-muted-foreground">
            {filteredItems.length} operazioni • pagina {pageIndex}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void fetchOps()}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            Aggiorna
          </Button>
        </div>
      </div>

      {/* Filtri */}
      <Card>
        <CardContent className="pt-6 flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1 min-w-[220px] flex-1 max-w-sm">
            <label className="text-xs text-muted-foreground">
              Cerca host (hostname / IP)
            </label>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="es. PC-MARIO o 192.168..."
                value={searchHost}
                onChange={(e) => setSearchHost(e.target.value)}
                className="pl-8"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1 min-w-[180px]">
            <label className="text-xs text-muted-foreground">CVE</label>
            <Input
              placeholder="CVE-2026-..."
              value={cveIdFilter}
              onChange={(e) => setCveIdFilter(e.target.value)}
              className="font-mono"
            />
          </div>

          <div className="flex flex-col gap-1 min-w-[160px]">
            <label className="text-xs text-muted-foreground">Status</label>
            <Select
              value={statusFilter}
              onValueChange={(v) => setStatusFilter(v as StatusFilter)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tutti</SelectItem>
                <SelectItem value="queued">In coda</SelectItem>
                <SelectItem value="running">In corso</SelectItem>
                <SelectItem value="success">Successo</SelectItem>
                <SelectItem value="failed">Fallita</SelectItem>
                <SelectItem value="reboot_pending">
                  Riavvio richiesto
                </SelectItem>
                <SelectItem value="cancelled">Annullata</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1 min-w-[160px]">
            <label className="text-xs text-muted-foreground">Azione</label>
            <Select
              value={actionFilter}
              onValueChange={(v) => setActionFilter(v as ActionFilter)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Azione" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tutte</SelectItem>
                <SelectItem value="probe">Probe</SelectItem>
                <SelectItem value="bootstrap">Bootstrap</SelectItem>
                <SelectItem value="upgrade">Upgrade</SelectItem>
                <SelectItem value="install">Install</SelectItem>
                <SelectItem value="uninstall">Uninstall</SelectItem>
                <SelectItem value="rollback">Rollback</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1 min-w-[170px]">
            <label className="text-xs text-muted-foreground">Dal</label>
            <Input
              type="date"
              value={sinceFilter}
              onChange={(e) => setSinceFilter(e.target.value)}
            />
          </div>

          <label className="flex items-center gap-2 text-sm cursor-pointer pb-2">
            <Checkbox
              checked={onlyMine}
              onCheckedChange={(v) => setOnlyMine(v === true)}
              disabled={sessionUserId == null}
            />
            Solo le mie
          </label>

          {hasActiveFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={resetFilters}
              className="mb-1"
            >
              <X className="h-4 w-4 mr-1" />
              Reset
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Stato modulo non installato */}
      {moduleMissing && !loading && (
        <Card>
          <CardContent className="py-6 text-sm flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-amber-600" />
            <span>
              Modulo Patch Management non installato per questo tenant. Vai a{" "}
              <Link
                href="/settings/features"
                className="underline font-medium"
              >
                Impostazioni → Moduli
              </Link>{" "}
              per attivarlo.
            </span>
          </CardContent>
        </Card>
      )}

      {/* Errore generico */}
      {error && !moduleMissing && (
        <Card>
          <CardContent className="py-6 text-sm flex items-center gap-2 text-destructive">
            <AlertCircle className="h-4 w-4" />
            Errore: {error}
          </CardContent>
        </Card>
      )}

      {/* Loading */}
      {loading && !moduleMissing && (
        <Card>
          <CardContent className="py-6 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Caricamento operazioni...
          </CardContent>
        </Card>
      )}

      {/* Empty state */}
      {!loading &&
        !error &&
        !moduleMissing &&
        filteredItems.length === 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Filter className="h-4 w-4" />
                Nessuna operazione trovata
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground space-y-2">
              <p>
                Nessuna riga in <code>patch_operations</code> corrisponde ai
                filtri attivi. Prova a:
              </p>
              <ul className="list-disc pl-5 space-y-1">
                <li>Rimuovere filtri (bottone Reset).</li>
                <li>
                  Avviare un probe o un upgrade da{" "}
                  <Link
                    href="/patch-management"
                    className="underline"
                  >
                    Patch Management
                  </Link>
                  .
                </li>
              </ul>
            </CardContent>
          </Card>
        )}

      {/* Tabella */}
      {!loading &&
        !error &&
        !moduleMissing &&
        filteredItems.length > 0 && (
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-44">Data</TableHead>
                  <TableHead>Host</TableHead>
                  <TableHead className="w-28">Azione</TableHead>
                  <TableHead>Pacchetto / CVE</TableHead>
                  <TableHead className="w-40">Status</TableHead>
                  <TableHead className="w-24 text-right">Durata</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredItems.map((op) => (
                  <TableRow
                    key={op.id}
                    className="hover:bg-muted/50 cursor-pointer"
                    onClick={() => void openDetail(op)}
                  >
                    <TableCell>
                      <div
                        className="text-sm"
                        title={formatAbsolute(op.startedAt)}
                      >
                        {formatRelative(op.startedAt)}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {formatAbsolute(op.startedAt)}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/hosts/${op.hostId}`}
                        className="hover:underline font-medium"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {hostDisplayName(op)}
                      </Link>
                      {op.hostIp && hostDisplayName(op) !== op.hostIp && (
                        <div className="text-[11px] text-muted-foreground font-mono">
                          {op.hostIp}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={actionVariant(op.action)}>
                        {actionLabel(op.action)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">{packageDisplay(op)}</div>
                      {op.cveId && (
                        <div className="text-[11px] text-muted-foreground font-mono">
                          <Link
                            href={`/patch-management/cve/${encodeURIComponent(op.cveId)}`}
                            className="hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {op.cveId}
                          </Link>
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <Badge variant={statusVariant(op.status)}>
                          {statusLabel(op.status)}
                          {op.exitCode != null && ` (exit ${op.exitCode})`}
                        </Badge>
                        {op.rebootRequired && op.status !== "reboot_pending" && (
                          <span className="text-[11px] text-amber-600">
                            Riavvio necessario
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm text-muted-foreground">
                      {formatDuration(op.startedAt, op.finishedAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}

      {/* Paginazione */}
      {!moduleMissing && !error && (
        <div className="flex items-center justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            disabled={offset === 0 || loading}
          >
            Precedente
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setOffset(offset + PAGE_SIZE)}
            disabled={items.length < PAGE_SIZE || loading}
          >
            Successiva
          </Button>
        </div>
      )}

      {/* Dialog dettaglio read-only */}
      <Dialog
        open={detailOp !== null}
        onOpenChange={(open) => {
          if (!open) closeDetail();
        }}
      >
        <DialogContent className={DIALOG_PANEL_WIDE_CLASS}>
          {detailOp && (
            <>
              <DialogHeader className="shrink-0 px-4 pt-4 pb-3 border-b">
                <DialogTitle className="flex items-center gap-2">
                  <ClipboardList className="h-5 w-5" />
                  Operation #{detailOp.id} — {actionLabel(detailOp.action)}
                </DialogTitle>
                <DialogDescription>
                  {hostDisplayName(detailOp)}
                  {detailOp.hostIp && ` · ${detailOp.hostIp}`}
                </DialogDescription>
              </DialogHeader>

              <DialogScrollableArea className="px-4 py-3">
                <div className="space-y-4 text-sm">
                  {/* Metadata grid */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <div className="text-xs text-muted-foreground">
                        Status
                      </div>
                      <Badge variant={statusVariant(detailOp.status)}>
                        {statusLabel(detailOp.status)}
                        {detailOp.exitCode != null &&
                          ` (exit ${detailOp.exitCode})`}
                      </Badge>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">
                        Azione
                      </div>
                      <Badge variant={actionVariant(detailOp.action)}>
                        {actionLabel(detailOp.action)}
                      </Badge>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">
                        Avviata
                      </div>
                      <div>{formatAbsolute(detailOp.startedAt)}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">
                        Conclusa
                      </div>
                      <div>{formatAbsolute(detailOp.finishedAt)}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">
                        Durata
                      </div>
                      <div>
                        {formatDuration(
                          detailOp.startedAt,
                          detailOp.finishedAt
                        )}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">
                        Utente
                      </div>
                      <div>#{detailOp.userId}</div>
                    </div>
                    <div className="col-span-2">
                      <div className="text-xs text-muted-foreground">
                        Pacchetto
                      </div>
                      <div className="font-mono">
                        {packageDisplay(detailOp)} ·{" "}
                        <span className="text-muted-foreground">
                          {detailOp.packageManager}
                        </span>
                      </div>
                    </div>
                    {detailOp.cveId && (
                      <div className="col-span-2">
                        <div className="text-xs text-muted-foreground">
                          CVE
                        </div>
                        <Link
                          href={`/patch-management/cve/${encodeURIComponent(detailOp.cveId)}`}
                          className="font-mono hover:underline text-primary"
                        >
                          {detailOp.cveId}
                        </Link>
                      </div>
                    )}
                    {detailOp.rebootRequired && (
                      <div className="col-span-2">
                        <Badge variant="outline" className="text-amber-600">
                          Riavvio necessario
                        </Badge>
                      </div>
                    )}
                    {detailOp.errorMessage && (
                      <div className="col-span-2">
                        <div className="text-xs text-muted-foreground">
                          Messaggio errore
                        </div>
                        <div className="text-destructive whitespace-pre-wrap break-words">
                          {detailOp.errorMessage}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Log */}
                  <div className="pt-2 border-t">
                    <div className="text-xs text-muted-foreground mb-2">
                      Output ({detailLogs.length} righe)
                    </div>
                    {detailLogsLoading && (
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Caricamento log...
                      </div>
                    )}
                    {detailLogsError && (
                      <div className="text-destructive text-xs">
                        {detailLogsError}
                      </div>
                    )}
                    {!detailLogsLoading &&
                      !detailLogsError &&
                      detailLogs.length === 0 && (
                        <div className="text-muted-foreground text-xs italic">
                          Nessun log disponibile.
                        </div>
                      )}
                    {detailLogs.length > 0 && (
                      <pre className="font-mono text-[11px] bg-muted/40 p-3 rounded-md max-h-80 overflow-y-auto whitespace-pre-wrap break-all">
                        {detailLogs
                          .map(
                            (l) =>
                              `[${l.stream}] ${l.line}`
                          )
                          .join("\n")}
                      </pre>
                    )}
                  </div>
                </div>
              </DialogScrollableArea>

              <DialogFooter className="shrink-0 px-4 py-3 border-t flex justify-end">
                <Button variant="outline" size="sm" onClick={closeDetail}>
                  Chiudi
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
