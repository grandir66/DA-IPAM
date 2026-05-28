"use client";

/**
 * Patch Management — Home hub asset-first (F12 PR3).
 *
 * Sostituisce la vecchia lista CVE (spostata in `/patch-management/cve`).
 * Due tab:
 *   - Device (default): host Windows con software inventory + counter CVE
 *     per severity. Fetch `GET /api/patch/device`.
 *   - Software: software dedup per (name, version) con CVE/Choco/patchable.
 *     Fetch `GET /api/patch/software` (search/onlyWithCve/onlyPatchable
 *     server-side).
 *
 * Link "Filtra per CVE →" in header punta a `/patch-management/cve`
 * (lista classica per chi vuole partire dal CVE).
 *
 * Drill-down click riga:
 *   - Device → `/patch-management/device/[hostId]` (F13)
 *   - Software → `/patch-management/software/[softwareKey]` (F14)
 *
 * Se modulo non installato → 404 dal backend → toast + empty state.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  AlertCircle,
  Filter,
  History,
  Loader2,
  Package,
  PackageSearch,
  RefreshCw,
  Rocket,
  Search,
  ServerCog,
  ShieldCheck,
  ShieldQuestion,
  Sparkles,
  Wand2,
} from "lucide-react";
import {
  HostActionModal,
  type HostActionOperation,
} from "@/components/patch/host-action-modal";
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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

// ─── tipi ────────────────────────────────────────────────────────────────
interface DeviceItem {
  hostId: number;
  ip: string | null;
  hostname: string | null;
  customName: string | null;
  osInfo: string | null;
  osFamily: string | null;
  softwareCount: number;
  cveCritical: number;
  cveHigh: number;
  cveMedium: number;
  cveLow: number;
  cveTotal: number;
  winrmValidated: boolean;
  lastProbeStatus: string | null;
  lastProbeAt: string | null;
}

interface DeviceListResponse {
  items: DeviceItem[];
  limit: number;
  offset: number;
}

interface SoftwareItem {
  name: string;
  version: string | null;
  publisher: string | null;
  hostCount: number;
  cveCount: number;
  chocoId: string | null;
  patchable: boolean;
}

interface SoftwareListResponse {
  items: SoftwareItem[];
  limit: number;
  offset: number;
}

const PAGE_SIZE = 50;
const NULL_VERSION_TOKEN = "__NULL__";

type SeverityThreshold = "all" | "critical" | "high" | "medium";

function encodeSoftwareKey(name: string, version: string | null): string {
  const v = version ?? NULL_VERSION_TOKEN;
  return `${encodeURIComponent(name)}|${encodeURIComponent(v)}`;
}

function formatProbeStatus(status: string | null): {
  label: string;
  variant: "default" | "secondary" | "outline" | "destructive";
} {
  if (!status) return { label: "Mai", variant: "outline" };
  const s = status.toLowerCase();
  if (s === "ok" || s === "success" || s === "completed")
    return { label: "OK", variant: "default" };
  if (s === "error" || s === "failed")
    return { label: "Errore", variant: "destructive" };
  if (s === "running" || s === "pending")
    return { label: status, variant: "secondary" };
  return { label: status, variant: "outline" };
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleString("it-IT", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

// ─── home ────────────────────────────────────────────────────────────────
export default function PatchManagementHomePage() {
  const [matchingBusy, setMatchingBusy] = useState(false);
  // Bump per forzare il refresh dei tab dopo "Calcola matching" (rimonta sub-tree).
  const [refreshKey, setRefreshKey] = useState(0);

  const handleRunMatching = useCallback(async () => {
    setMatchingBusy(true);
    try {
      const res = await fetch("/api/patch/matcher/run", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const msg =
          typeof body?.error === "string"
            ? body.error
            : `HTTP ${res.status}`;
        toast.error(`Matching fallito: ${msg}`);
        return;
      }
      const data = (await res.json()) as {
        softwareWithChoco: number;
        cveTargetsWritten: number;
        durationMs: number;
      };
      toast.success(
        `Matching completato in ${(data.durationMs / 1000).toFixed(1)}s: ` +
          `${data.softwareWithChoco} software con choco_id, ${data.cveTargetsWritten} CVE→fix mappati`
      );
      setRefreshKey((k) => k + 1);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Errore matching";
      toast.error(msg);
    } finally {
      setMatchingBusy(false);
    }
  }, []);

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <PackageSearch className="h-6 w-6" />
            Patch Management
          </h1>
          <p className="text-sm text-muted-foreground">
            Gestione patch per host Windows. Esplora per device o per software
            installato; entra nel dettaglio per pianificare un&apos;operazione.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="default"
            size="sm"
            onClick={handleRunMatching}
            disabled={matchingBusy}
            title="Calcola match CVE↔software e popola choco_id dal dizionario per tutto il tenant"
          >
            {matchingBusy ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Sparkles className="h-4 w-4 mr-2" />
            )}
            Calcola matching
          </Button>
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={<Link href="/patch-management/cve" />}
          >
            <Filter className="h-4 w-4 mr-2" />
            Filtra per CVE
          </Button>
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={<Link href="/patch-management/history" />}
          >
            <History className="h-4 w-4 mr-2" />
            Storico operazioni
          </Button>
        </div>
      </div>

      {/* Tabs (key bump → refetch dopo matching) */}
      <Tabs key={refreshKey} defaultValue="device" className="space-y-4">
        <TabsList className="!h-10 p-1 gap-1 bg-muted border border-border">
          <TabsTrigger value="device" className="px-4 py-1.5 text-sm">
            <ServerCog className="h-4 w-4 mr-1.5" />
            Device
          </TabsTrigger>
          <TabsTrigger value="software" className="px-4 py-1.5 text-sm">
            <Package className="h-4 w-4 mr-1.5" />
            Software
          </TabsTrigger>
        </TabsList>

        <TabsContent value="device" className="space-y-4">
          <DeviceTab />
        </TabsContent>

        <TabsContent value="software" className="space-y-4">
          <SoftwareTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── DeviceTab ───────────────────────────────────────────────────────────
const MAX_BULK_SELECTION = 50;

function DeviceTab() {
  const [items, setItems] = useState<DeviceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [moduleMissing, setModuleMissing] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
  const [severityThreshold, setSeverityThreshold] =
    useState<SeverityThreshold>("all");
  const [offset, setOffset] = useState(0);

  // Selezione bulk multi-host (cap MAX_BULK_SELECTION).
  // Solo host con winrmValidated=true sono selezionabili.
  const [selected, setSelected] = useState<Set<number>>(new Set());

  // Modal esecuzione bulk (riusa HostActionModal con polling 2s).
  const [modalOpen, setModalOpen] = useState(false);
  const [modalTitle, setModalTitle] = useState("");
  const [modalOps, setModalOps] = useState<HostActionOperation[]>([]);
  const [bulkBusy, setBulkBusy] = useState(false);

  // Stato config Wazuh manager (per abilitare bottone "Installa Wazuh").
  const [wazuhConfigured, setWazuhConfigured] = useState(false);
  const [wazuhManagerHost, setWazuhManagerHost] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/patch/install-wazuh", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { configured?: boolean; managerHost?: string | null } | null) => {
        if (cancelled || !data) return;
        setWazuhConfigured(!!data.configured);
        setWazuhManagerHost(data.managerHost ?? null);
      })
      .catch(() => {
        // Network/auth fail: lascia disabilitato il bottone
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const fetchDevices = useCallback(async () => {
    setLoading(true);
    setError(null);
    setModuleMissing(false);
    try {
      const params = new URLSearchParams();
      params.set("limit", String(PAGE_SIZE));
      params.set("offset", String(offset));
      const res = await fetch(`/api/patch/device?${params.toString()}`, {
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
      const data = (await res.json()) as DeviceListResponse;
      setItems(data.items ?? []);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Errore caricamento device";
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [offset]);

  useEffect(() => {
    void fetchDevices();
  }, [fetchDevices]);

  // Reset selezione quando cambia la pagina
  useEffect(() => {
    setSelected((prev) => {
      const valid = new Set(items.map((d) => d.hostId));
      const next = new Set<number>();
      for (const id of prev) if (valid.has(id)) next.add(id);
      return next;
    });
  }, [items]);

  // ---- Selezione bulk ----
  const toggleHost = (host: DeviceItem, checked: boolean) => {
    if (!host.winrmValidated) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) {
        if (next.size >= MAX_BULK_SELECTION) {
          toast.warning(
            `Limite massimo: ${MAX_BULK_SELECTION} host selezionabili per batch`
          );
          return prev;
        }
        next.add(host.hostId);
      } else {
        next.delete(host.hostId);
      }
      return next;
    });
  };

  const selectableHosts = items.filter((d) => d.winrmValidated);
  const allSelectableSelected =
    selectableHosts.length > 0 &&
    selectableHosts.every((d) => selected.has(d.hostId));

  const toggleAll = (checked: boolean) => {
    if (checked) {
      const next = new Set<number>();
      for (const d of selectableHosts) {
        if (next.size >= MAX_BULK_SELECTION) break;
        next.add(d.hostId);
      }
      if (selectableHosts.length > MAX_BULK_SELECTION) {
        toast.warning(
          `Selezionati i primi ${MAX_BULK_SELECTION} di ${selectableHosts.length} (limite batch)`
        );
      }
      setSelected(next);
    } else {
      setSelected(new Set());
    }
  };

  // ---- Bulk launch ----
  // Lancia N POST sequenziali (throttle 200ms) verso un endpoint e apre il
  // HostActionModal aggregando tutte le operations.
  const launchBulk = useCallback(
    async (params: {
      endpoint: string;
      body?: (host: DeviceItem) => Record<string, unknown>;
      title: string;
      label: (host: DeviceItem) => string;
    }) => {
      const targets = items.filter((d) => selected.has(d.hostId));
      if (targets.length === 0) return;
      setBulkBusy(true);
      const ops: HostActionOperation[] = [];
      try {
        for (const host of targets) {
          try {
            const payload = params.body?.(host) ?? { hostId: host.hostId };
            const res = await fetch(params.endpoint, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            });
            if (res.status === 404) {
              toast.error("Modulo Patch Management non installato.");
              break;
            }
            if (!res.ok) {
              const body = (await res.json().catch(() => null)) as
                | { error?: string }
                | null;
              toast.error(
                `${host.hostname ?? host.hostId}: ${body?.error ?? `HTTP ${res.status}`}`
              );
              continue;
            }
            const data = (await res.json()) as { operationId?: number };
            if (typeof data.operationId === "number") {
              ops.push({
                operationId: data.operationId,
                hostId: host.hostId,
                hostLabel: params.label(host),
              });
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            toast.error(`${host.hostname ?? host.hostId}: ${msg}`);
          }
          // Throttle anti-WinRM-burst
          await new Promise((r) => setTimeout(r, 200));
        }
        if (ops.length > 0) {
          setModalOps(ops);
          setModalTitle(`${params.title} (${ops.length} host)`);
          setModalOpen(true);
        }
      } finally {
        setBulkBusy(false);
      }
    },
    [items, selected]
  );

  const handleBulkBootstrap = () =>
    launchBulk({
      endpoint: "/api/patch/bootstrap",
      title: "Bootstrap Chocolatey",
      label: (h) => h.customName || h.hostname || `host #${h.hostId}`,
    });

  const handleBulkInstallWazuh = () =>
    launchBulk({
      endpoint: "/api/patch/install-wazuh",
      title: "Install Wazuh agent",
      label: (h) => h.customName || h.hostname || `host #${h.hostId}`,
    });

  const handleModalClose = () => {
    setModalOpen(false);
    // Ricarica device list per riflettere lastProbeStatus / inventory aggiornato
    void fetchDevices();
  };

  // Filtri client-side
  const filtered = items.filter((d) => {
    if (severityThreshold === "critical" && d.cveCritical === 0) return false;
    if (
      severityThreshold === "high" &&
      d.cveCritical === 0 &&
      d.cveHigh === 0
    )
      return false;
    if (
      severityThreshold === "medium" &&
      d.cveCritical === 0 &&
      d.cveHigh === 0 &&
      d.cveMedium === 0
    )
      return false;
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      (d.hostname ?? "").toLowerCase().includes(q) ||
      (d.customName ?? "").toLowerCase().includes(q) ||
      (d.ip ?? "").toLowerCase().includes(q) ||
      (d.osInfo ?? "").toLowerCase().includes(q)
    );
  });

  const pageIndex = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <>
      {/* Filtri */}
      <Card>
        <CardContent className="pt-6 flex flex-wrap items-center gap-3">
          <div className="relative max-w-sm flex-1 min-w-[220px]">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Cerca hostname, IP, OS..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8"
            />
          </div>

          <div className="flex items-center gap-1">
            <Button
              variant={severityThreshold === "all" ? "default" : "outline"}
              size="sm"
              onClick={() => setSeverityThreshold("all")}
            >
              Tutti
            </Button>
            <Button
              variant={severityThreshold === "critical" ? "default" : "outline"}
              size="sm"
              onClick={() => setSeverityThreshold("critical")}
            >
              Solo Critical
            </Button>
            <Button
              variant={severityThreshold === "high" ? "default" : "outline"}
              size="sm"
              onClick={() => setSeverityThreshold("high")}
            >
              Critical + High
            </Button>
            <Button
              variant={severityThreshold === "medium" ? "default" : "outline"}
              size="sm"
              onClick={() => setSeverityThreshold("medium")}
            >
              + Medium
            </Button>
          </div>

          <div className="ml-auto flex items-center gap-3">
            <div className="text-sm text-muted-foreground">
              {filtered.length} device • pagina {pageIndex}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void fetchDevices()}
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
        </CardContent>
      </Card>

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

      {error && !moduleMissing && (
        <Card>
          <CardContent className="py-6 text-sm flex items-center gap-2 text-destructive">
            <AlertCircle className="h-4 w-4" />
            Errore: {error}
          </CardContent>
        </Card>
      )}

      {loading && !moduleMissing && (
        <Card>
          <CardContent className="py-6 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Caricamento device...
          </CardContent>
        </Card>
      )}

      {!loading && !error && !moduleMissing && filtered.length === 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <ShieldQuestion className="h-4 w-4" />
              Nessun device trovato
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-2">
            <p>
              Solo host Windows con software inventory popolato (Wazuh o
              Scanner-Edge) compaiono in questa lista.
            </p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Esegui uno scan software inventory dalla pagina host.</li>
              <li>Verifica integrazioni Wazuh / Scanner-Edge attive.</li>
              <li>Rimuovi i filtri attivi e riprova.</li>
            </ul>
          </CardContent>
        </Card>
      )}

      {!loading && !error && !moduleMissing && filtered.length > 0 && (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={allSelectableSelected}
                    onCheckedChange={(v) => toggleAll(v === true)}
                    aria-label="Seleziona tutti gli host con WinRM"
                    disabled={selectableHosts.length === 0}
                  />
                </TableHead>
                <TableHead>Host</TableHead>
                <TableHead className="w-32">IP</TableHead>
                <TableHead className="w-48">OS</TableHead>
                <TableHead className="w-20 text-right">Software</TableHead>
                <TableHead className="w-56 text-center">CVE</TableHead>
                <TableHead className="w-24 text-center">WinRM</TableHead>
                <TableHead className="w-40">Ultimo probe</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((d) => {
                const probe = formatProbeStatus(d.lastProbeStatus);
                return (
                  <TableRow
                    key={d.hostId}
                    className="hover:bg-muted/50 cursor-pointer"
                  >
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={selected.has(d.hostId)}
                        onCheckedChange={(v) => toggleHost(d, v === true)}
                        disabled={!d.winrmValidated}
                        aria-label={`Seleziona host ${d.hostname ?? d.hostId}`}
                        title={
                          !d.winrmValidated
                            ? "WinRM non configurato — host non selezionabile per bulk"
                            : undefined
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/patch-management/device/${d.hostId}`}
                        className="hover:underline font-medium"
                      >
                        {d.customName || d.hostname || `host #${d.hostId}`}
                      </Link>
                      {d.customName && d.hostname && (
                        <div className="text-xs text-muted-foreground">
                          {d.hostname}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {d.ip ?? "—"}
                    </TableCell>
                    <TableCell className="text-xs truncate max-w-[12rem]" title={d.osInfo ?? undefined}>
                      {d.osInfo ?? "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {d.softwareCount}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-center gap-1 flex-wrap">
                        {d.cveCritical > 0 && (
                          <Badge
                            variant="destructive"
                            title="Critical"
                            className="px-1.5 py-0 h-5 text-xs"
                          >
                            C {d.cveCritical}
                          </Badge>
                        )}
                        {d.cveHigh > 0 && (
                          <Badge
                            variant="default"
                            title="High"
                            className="px-1.5 py-0 h-5 text-xs bg-orange-600 hover:bg-orange-700"
                          >
                            H {d.cveHigh}
                          </Badge>
                        )}
                        {d.cveMedium > 0 && (
                          <Badge
                            variant="secondary"
                            title="Medium"
                            className="px-1.5 py-0 h-5 text-xs bg-yellow-500/80 hover:bg-yellow-500 text-black"
                          >
                            M {d.cveMedium}
                          </Badge>
                        )}
                        {d.cveLow > 0 && (
                          <Badge
                            variant="outline"
                            title="Low"
                            className="px-1.5 py-0 h-5 text-xs"
                          >
                            L {d.cveLow}
                          </Badge>
                        )}
                        {d.cveTotal === 0 && (
                          <span className="text-xs text-muted-foreground">
                            —
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      {d.winrmValidated ? (
                        <Badge
                          variant="default"
                          className="bg-emerald-600 hover:bg-emerald-700"
                        >
                          <ShieldCheck className="h-3 w-3 mr-1" />
                          OK
                        </Badge>
                      ) : (
                        <Badge variant="outline">N/D</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">
                      <div className="flex flex-col gap-0.5">
                        <Badge variant={probe.variant} className="w-fit px-1.5 py-0 h-5 text-xs">
                          {probe.label}
                        </Badge>
                        <span className="text-muted-foreground">
                          {formatDate(d.lastProbeAt)}
                        </span>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}

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

      {/* Bulk action bar — sticky bottom */}
      {!moduleMissing && !error && items.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 sticky bottom-0 bg-background/80 backdrop-blur py-3 border-t">
          <div className="text-sm text-muted-foreground mr-auto">
            {selected.size > 0
              ? `${selected.size} host selezionati`
              : "Seleziona host con WinRM ✓ per azioni bulk"}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleBulkBootstrap}
            disabled={selected.size === 0 || bulkBusy}
            title="Installa Chocolatey su tutti gli host selezionati (richiesto prima del patch)"
          >
            {bulkBusy ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Rocket className="h-4 w-4 mr-2" />
            )}
            Bootstrap Choco ({selected.size})
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleBulkInstallWazuh}
            disabled={selected.size === 0 || bulkBusy || !wazuhConfigured}
            title={
              !wazuhConfigured
                ? "Wazuh manager non configurato (Integrazioni → Wazuh)"
                : `Installa Wazuh agent (manager: ${wazuhManagerHost})`
            }
          >
            {bulkBusy ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Wand2 className="h-4 w-4 mr-2" />
            )}
            Installa Wazuh ({selected.size})
          </Button>
        </div>
      )}

      <HostActionModal
        open={modalOpen}
        onClose={handleModalClose}
        title={modalTitle}
        operations={modalOps}
      />
    </>
  );
}

// ─── SoftwareTab ─────────────────────────────────────────────────────────
function SoftwareTab() {
  const [items, setItems] = useState<SoftwareItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [moduleMissing, setModuleMissing] = useState(false);

  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [onlyWithCve, setOnlyWithCve] = useState(false);
  const [onlyPatchable, setOnlyPatchable] = useState(false);
  const [offset, setOffset] = useState(0);

  const fetchSoftware = useCallback(async () => {
    setLoading(true);
    setError(null);
    setModuleMissing(false);
    try {
      const params = new URLSearchParams();
      params.set("limit", String(PAGE_SIZE));
      params.set("offset", String(offset));
      if (searchQuery.trim()) params.set("search", searchQuery.trim());
      if (onlyWithCve) params.set("onlyWithCve", "true");
      if (onlyPatchable) params.set("onlyPatchable", "true");

      const res = await fetch(`/api/patch/software?${params.toString()}`, {
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
      const data = (await res.json()) as SoftwareListResponse;
      setItems(data.items ?? []);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Errore caricamento software";
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [offset, searchQuery, onlyWithCve, onlyPatchable]);

  useEffect(() => {
    void fetchSoftware();
  }, [fetchSoftware]);

  // Reset offset quando cambiano i filtri server-side
  useEffect(() => {
    setOffset(0);
  }, [searchQuery, onlyWithCve, onlyPatchable]);

  // Debounce search input → searchQuery (server-side)
  useEffect(() => {
    const id = setTimeout(() => {
      setSearchQuery(searchInput);
    }, 350);
    return () => clearTimeout(id);
  }, [searchInput]);

  const pageIndex = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <>
      {/* Filtri */}
      <Card>
        <CardContent className="pt-6 flex flex-wrap items-center gap-3">
          <div className="relative max-w-sm flex-1 min-w-[220px]">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Cerca nome software..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="pl-8"
            />
          </div>

          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <Checkbox
              checked={onlyWithCve}
              onCheckedChange={(v) => setOnlyWithCve(v === true)}
            />
            Solo con CVE
          </label>

          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <Checkbox
              checked={onlyPatchable}
              onCheckedChange={(v) => setOnlyPatchable(v === true)}
            />
            Solo patchable
          </label>

          <div className="ml-auto flex items-center gap-3">
            <div className="text-sm text-muted-foreground">
              {items.length} software • pagina {pageIndex}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void fetchSoftware()}
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
        </CardContent>
      </Card>

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

      {error && !moduleMissing && (
        <Card>
          <CardContent className="py-6 text-sm flex items-center gap-2 text-destructive">
            <AlertCircle className="h-4 w-4" />
            Errore: {error}
          </CardContent>
        </Card>
      )}

      {loading && !moduleMissing && (
        <Card>
          <CardContent className="py-6 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Caricamento software...
          </CardContent>
        </Card>
      )}

      {!loading && !error && !moduleMissing && items.length === 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <ShieldQuestion className="h-4 w-4" />
              Nessun software trovato
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-2">
            <p>
              I software vengono raccolti dagli host Windows con scan software
              inventory completati con successo.
            </p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Verifica che almeno un host abbia uno scan ok recente.</li>
              <li>Rimuovi i filtri attivi e riprova.</li>
            </ul>
          </CardContent>
        </Card>
      )}

      {!loading && !error && !moduleMissing && items.length > 0 && (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead className="w-32">Versione</TableHead>
                <TableHead className="w-48">Publisher</TableHead>
                <TableHead className="w-20 text-right">Host</TableHead>
                <TableHead className="w-20 text-right">CVE</TableHead>
                <TableHead className="w-24 text-center">Choco</TableHead>
                <TableHead className="w-24 text-center">Patchable</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((s) => {
                const key = encodeSoftwareKey(s.name, s.version);
                return (
                  <TableRow
                    key={`${s.name}|${s.version ?? "_"}`}
                    className="hover:bg-muted/50 cursor-pointer"
                  >
                    <TableCell>
                      <Link
                        href={`/patch-management/software/${key}`}
                        className="hover:underline font-medium"
                        title={s.name}
                      >
                        {s.name}
                      </Link>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {s.version ?? "—"}
                    </TableCell>
                    <TableCell className="text-xs truncate max-w-[12rem]" title={s.publisher ?? undefined}>
                      {s.publisher ?? "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {s.hostCount}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {s.cveCount > 0 ? (
                        <Badge variant="destructive" className="px-1.5 py-0 h-5">
                          {s.cveCount}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      {s.chocoId ? (
                        <Badge
                          variant="default"
                          className="bg-emerald-600 hover:bg-emerald-700"
                          title={s.chocoId}
                        >
                          <ShieldCheck className="h-3 w-3 mr-1" />
                          OK
                        </Badge>
                      ) : (
                        <Badge variant="outline">N/D</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      {s.patchable ? (
                        <Badge
                          variant="default"
                          className="bg-emerald-600 hover:bg-emerald-700"
                        >
                          Sì
                        </Badge>
                      ) : (
                        <Badge variant="outline">No</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}

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
    </>
  );
}
