"use client";

/**
 * Patch Management — Drill-down singolo device (F13).
 *
 * Pagina device-first: aprire un host Windows e vedere il suo software
 * inventory con le CVE associate, scegliere cosa patchare.
 *
 * Client Component: fetch `/api/patch/device/[hostId]` (header + software[]).
 * Permette:
 *   - Probe singolo host (POST /api/patch/probe { hostId })
 *   - Bootstrap choco singolo host (POST /api/patch/bootstrap { hostId })
 *   - Pin manuale fix (riusa PinFixDialog F7) per software senza chocoId
 *     ma con almeno una CVE
 *   - Patch singolo software (riga "▶ Patch") → 1 POST /api/patch/operations
 *   - Patch bulk (sticky footer) → N POST /api/patch/operations, una per
 *     software_id selezionato
 *
 * Tutte le azioni di tipo "operation" aprono `HostActionModal` per polling
 * status + tail log live (uno o più operationId con stesso hostId).
 *
 * Contratto backend (verificato sul route handler):
 *   GET /api/patch/device/[hostId]:
 *     {
 *       hostId, ip, hostname, customName, osInfo, osFamily,
 *       winrmValidated, lastProbeStatus, lastProbeAt, lastScanId,
 *       software: [{
 *         softwareId, name, version, publisher, source,
 *         chocoId, cpe, patchable,
 *         cves: [{ cveId, cvssScore, severity, source }]
 *       }]
 *     }
 *   404 con error="Module not installed" → modulo non installato per tenant.
 *
 * Decisioni F13:
 *   - Cap selezione bulk = 50 software (MAX_SELECTION)
 *   - Cap totale software inventory: API ritorna max 2000 righe; se la lista
 *     ha >=2000 software mostriamo warning toast (probabile troncamento)
 *   - Stato Choco derivato da lastProbeStatus (success/failed/null) — la
 *     versione choco precisa è dietro a un probe e non viene esposta
 *     dall'endpoint /device/[hostId]
 *   - Patch singolo: passa `{ hostId, action: 'upgrade', packageId: chocoId }`
 *     senza version (= latest); usa il primo cveId disponibile per il body
 *     opzionale (utile per audit trail)
 *   - Pin manuale: apre PinFixDialog con cveId pre-popolato dal primo CVE
 *     associato al software cliccato
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  ExternalLink,
  HelpCircle,
  Loader2,
  Monitor,
  Package,
  Pin,
  Play,
  RefreshCw,
  Rocket,
  Search,
  ShieldCheck,
  Wrench,
  XCircle,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  HostActionModal,
  type HostActionOperation,
} from "@/components/patch/host-action-modal";
import { PinFixDialog } from "@/components/patch/pin-fix-dialog";

// ─── tipi ────────────────────────────────────────────────────────────────
interface DeviceCve {
  cveId: string;
  cvssScore: number | null;
  severity: string | null;
  source: string;
}

interface DeviceSoftware {
  softwareId: number;
  name: string;
  version: string | null;
  publisher: string | null;
  source: string;
  chocoId: string | null;
  cpe: string | null;
  patchable: boolean;
  cves: DeviceCve[];
}

interface DeviceDetail {
  hostId: number;
  ip: string | null;
  hostname: string | null;
  customName: string | null;
  osInfo: string | null;
  osFamily: string | null;
  winrmValidated: boolean;
  lastProbeStatus: string | null;
  lastProbeAt: string | null;
  lastScanId: number | null;
  software: DeviceSoftware[];
}

const MAX_SELECTION = 50;
const SOFTWARE_LIMIT_HINT = 2000;

// ─── helpers ─────────────────────────────────────────────────────────────
function severityRank(sev: string | null): number {
  if (!sev) return 0;
  const s = sev.toLowerCase();
  if (s === "critical") return 4;
  if (s === "high") return 3;
  if (s === "medium") return 2;
  if (s === "low") return 1;
  return 0;
}

function countBySeverity(cves: DeviceCve[]): {
  critical: number;
  high: number;
  medium: number;
  low: number;
  other: number;
} {
  const out = { critical: 0, high: 0, medium: 0, low: 0, other: 0 };
  for (const c of cves) {
    const s = (c.severity ?? "").toLowerCase();
    if (s === "critical") out.critical += 1;
    else if (s === "high") out.high += 1;
    else if (s === "medium") out.medium += 1;
    else if (s === "low") out.low += 1;
    else out.other += 1;
  }
  return out;
}

function hostLabel(d: DeviceDetail | null): string {
  if (!d) return "—";
  return d.customName ?? d.hostname ?? d.ip ?? `host-${d.hostId}`;
}

function relativeTime(iso: string | null): string {
  if (!iso) return "mai";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const diffSec = Math.floor((Date.now() - t) / 1000);
  if (diffSec < 60) return `${diffSec}s fa`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m fa`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h fa`;
  return `${Math.floor(diffSec / 86400)}g fa`;
}

function chocoLabelFromProbe(status: string | null): {
  label: string;
  variant: "default" | "destructive" | "outline";
  className?: string;
  tooltip: string;
} {
  if (status === "success") {
    return {
      label: "Choco installato",
      variant: "default",
      className: "bg-emerald-600 hover:bg-emerald-700",
      tooltip: "Ultimo probe Chocolatey riuscito",
    };
  }
  if (status === "failed") {
    return {
      label: "Choco mancante / KO",
      variant: "destructive",
      tooltip:
        "Ultimo probe Chocolatey fallito — lancia 'Bootstrap choco' per installarlo",
    };
  }
  return {
    label: "Non testato",
    variant: "outline",
    tooltip: "Nessun probe Chocolatey eseguito — lancia 'Probe host' per scoprirlo",
  };
}

// ─── Cells riusabili ─────────────────────────────────────────────────────
function CveCountInline({
  cves,
  softwareName,
}: {
  cves: DeviceCve[];
  softwareName: string;
}) {
  const counts = useMemo(() => countBySeverity(cves), [cves]);
  // Top 8 CVE-id da mostrare in tooltip (ordinate per severity desc, poi cvss desc, poi id).
  // useMemo deve stare PRIMA dell'early return per non violare rules-of-hooks.
  const topCves = useMemo(() => {
    return [...cves]
      .sort((a, b) => {
        const sd = severityRank(b.severity) - severityRank(a.severity);
        if (sd !== 0) return sd;
        const cd = (b.cvssScore ?? 0) - (a.cvssScore ?? 0);
        if (cd !== 0) return cd;
        return a.cveId.localeCompare(b.cveId);
      })
      .slice(0, 8);
  }, [cves]);

  if (cves.length === 0) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <div className="inline-flex items-center gap-1 flex-wrap cursor-help" />
        }
      >
        {counts.critical > 0 && (
          <Badge
            variant="destructive"
            className="px-1.5 py-0 h-5 text-xs"
            title="Critical"
          >
            C {counts.critical}
          </Badge>
        )}
        {counts.high > 0 && (
          <Badge
            variant="default"
            className="px-1.5 py-0 h-5 text-xs bg-orange-600 hover:bg-orange-700"
            title="High"
          >
            H {counts.high}
          </Badge>
        )}
        {counts.medium > 0 && (
          <Badge
            variant="secondary"
            className="px-1.5 py-0 h-5 text-xs bg-yellow-500/80 hover:bg-yellow-500 text-black"
            title="Medium"
          >
            M {counts.medium}
          </Badge>
        )}
        {counts.low > 0 && (
          <Badge
            variant="outline"
            className="px-1.5 py-0 h-5 text-xs"
            title="Low"
          >
            L {counts.low}
          </Badge>
        )}
        {counts.other > 0 && (
          <Badge
            variant="outline"
            className="px-1.5 py-0 h-5 text-xs"
            title="Severity sconosciuta"
          >
            ? {counts.other}
          </Badge>
        )}
      </TooltipTrigger>
      <TooltipContent className="max-w-sm">
        <div className="space-y-1 text-xs">
          <div className="font-medium">{softwareName} — CVE associate</div>
          <ul className="space-y-0.5">
            {topCves.map((c) => (
              <li key={`${c.cveId}-${c.source}`} className="font-mono">
                {c.cveId}
                {c.cvssScore !== null
                  ? ` · CVSS ${c.cvssScore.toFixed(1)}`
                  : ""}
                {c.severity ? ` · ${c.severity}` : ""}
              </li>
            ))}
            {cves.length > topCves.length && (
              <li className="text-muted-foreground">
                ... e altre {cves.length - topCves.length}
              </li>
            )}
          </ul>
          <div className="text-muted-foreground">
            Click sulla riga per aprire la pagina CVE
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

// ─── pagina ──────────────────────────────────────────────────────────────
export default function DeviceDetailPage() {
  const params = useParams<{ hostId: string }>();
  const hostIdRaw = params?.hostId ?? "";
  const hostId = useMemo(() => Number(hostIdRaw), [hostIdRaw]);

  const [detail, setDetail] = useState<DeviceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [moduleMissing, setModuleMissing] = useState(false);
  const [notFound, setNotFound] = useState(false);

  // Filtri
  const [searchInput, setSearchInput] = useState("");
  const [onlyWithCve, setOnlyWithCve] = useState(false);
  const [onlyPatchable, setOnlyPatchable] = useState(true);

  // Selezione multipla software
  const [selected, setSelected] = useState<Set<number>>(new Set());

  // Modal esecuzione
  const [modalOpen, setModalOpen] = useState(false);
  const [modalTitle, setModalTitle] = useState("");
  const [modalDescription, setModalDescription] = useState<string | undefined>(
    undefined
  );
  const [modalOps, setModalOps] = useState<HostActionOperation[]>([]);
  const [launching, setLaunching] = useState(false);

  // Pin dialog
  const [pinOpen, setPinOpen] = useState(false);
  const [pinCveId, setPinCveId] = useState<string>("");

  // Probe / bootstrap pulsanti globali (loading state)
  const [probeBusy, setProbeBusy] = useState(false);
  const [bootstrapBusy, setBootstrapBusy] = useState(false);

  const fetchDetail = useCallback(async () => {
    if (!Number.isFinite(hostId) || hostId <= 0) {
      setError("hostId non valido");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    setModuleMissing(false);
    setNotFound(false);
    try {
      const res = await fetch(`/api/patch/device/${hostId}`, {
        cache: "no-store",
      });
      if (res.status === 404) {
        const body = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        if (body?.error === "Module not installed") {
          setModuleMissing(true);
          return;
        }
        setNotFound(true);
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as DeviceDetail;
      setDetail(data);

      // Warning soft se software vicino al cap
      const totalRows = (data.software ?? []).reduce(
        (acc, s) => acc + Math.max(1, s.cves.length),
        0
      );
      if (totalRows >= SOFTWARE_LIMIT_HINT) {
        toast.warning(
          `Inventory molto grande (${data.software.length} software, ${totalRows} righe software×CVE) — l'API limita a ${SOFTWARE_LIMIT_HINT} righe, alcuni dati potrebbero essere troncati.`
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Errore caricamento device";
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [hostId]);

  useEffect(() => {
    void fetchDetail();
  }, [fetchDetail]);

  // Reset selezione se cambia inventory (es. dopo refresh)
  useEffect(() => {
    setSelected((prev) => {
      const validIds = new Set((detail?.software ?? []).map((s) => s.softwareId));
      const next = new Set<number>();
      for (const id of prev) {
        if (validIds.has(id)) next.add(id);
      }
      return next;
    });
  }, [detail]);

  // Filtri client-side
  const filteredSoftware = useMemo(() => {
    const all = detail?.software ?? [];
    const q = searchInput.trim().toLowerCase();
    return all.filter((s) => {
      if (onlyWithCve && s.cves.length === 0) return false;
      if (onlyPatchable && !s.patchable) return false;
      if (!q) return true;
      return (
        s.name.toLowerCase().includes(q) ||
        (s.publisher ?? "").toLowerCase().includes(q) ||
        (s.version ?? "").toLowerCase().includes(q)
      );
    });
  }, [detail, searchInput, onlyWithCve, onlyPatchable]);

  const selectableInFiltered = useMemo(
    () => filteredSoftware.filter((s) => s.patchable),
    [filteredSoftware]
  );

  const allSelectableSelected =
    selectableInFiltered.length > 0 &&
    selectableInFiltered.every((s) => selected.has(s.softwareId));

  const toggleSoftware = (sw: DeviceSoftware, checked: boolean) => {
    if (!sw.patchable) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) {
        if (next.size >= MAX_SELECTION) {
          toast.warning(
            `Limite massimo: ${MAX_SELECTION} software selezionabili per batch`
          );
          return prev;
        }
        next.add(sw.softwareId);
      } else {
        next.delete(sw.softwareId);
      }
      return next;
    });
  };

  const toggleAll = (checked: boolean) => {
    if (checked) {
      const next = new Set<number>();
      for (const s of selectableInFiltered) {
        if (next.size >= MAX_SELECTION) break;
        next.add(s.softwareId);
      }
      if (selectableInFiltered.length > MAX_SELECTION) {
        toast.warning(
          `Selezionati i primi ${MAX_SELECTION} di ${selectableInFiltered.length} software patchable (limite batch)`
        );
      }
      setSelected(next);
    } else {
      setSelected(new Set());
    }
  };

  // ---- Probe singolo host ----
  const handleProbe = useCallback(async () => {
    if (!detail) return;
    setProbeBusy(true);
    try {
      const res = await fetch("/api/patch/probe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hostId: detail.hostId }),
      });
      if (!res.ok && res.status !== 202) {
        const body = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { operationId: number };
      if (typeof data.operationId !== "number") {
        throw new Error("Risposta probe senza operationId");
      }
      setModalTitle("Probe Chocolatey");
      setModalDescription(
        "Verifica versione choco installata e pacchetti outdated su questo host."
      );
      setModalOps([
        {
          operationId: data.operationId,
          hostId: detail.hostId,
          hostLabel: hostLabel(detail),
        },
      ]);
      setModalOpen(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Errore probe";
      toast.error(msg);
    } finally {
      setProbeBusy(false);
    }
  }, [detail]);

  // ---- Bootstrap singolo host ----
  const handleBootstrap = useCallback(async () => {
    if (!detail) return;
    setBootstrapBusy(true);
    try {
      const res = await fetch("/api/patch/bootstrap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hostId: detail.hostId }),
      });
      if (!res.ok && res.status !== 202) {
        const body = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { operationId: number };
      if (typeof data.operationId !== "number") {
        throw new Error("Risposta bootstrap senza operationId");
      }
      setModalTitle("Bootstrap Chocolatey");
      setModalDescription(
        "Installa Chocolatey sull'host se assente. Idempotente: skip se già presente."
      );
      setModalOps([
        {
          operationId: data.operationId,
          hostId: detail.hostId,
          hostLabel: hostLabel(detail),
        },
      ]);
      setModalOpen(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Errore bootstrap";
      toast.error(msg);
    } finally {
      setBootstrapBusy(false);
    }
  }, [detail]);

  // ---- Lancia upgrade per N software (singolo o bulk) ----
  const launchUpgrade = useCallback(
    async (targets: DeviceSoftware[]) => {
      if (!detail) return;
      if (targets.length === 0) {
        toast.warning("Nessun software da patchare");
        return;
      }
      const nonPatchable = targets.filter((s) => !s.patchable);
      if (nonPatchable.length > 0) {
        toast.error(
          `${nonPatchable.length} software senza fix Chocolatey — esclusi dal batch`
        );
      }
      const valid = targets.filter((s) => s.patchable && s.chocoId);
      if (valid.length === 0) {
        toast.error("Nessun software patchable selezionato");
        return;
      }

      setLaunching(true);
      const results: HostActionOperation[] = [];
      const errors: string[] = [];

      // Sequenziale con throttle leggero per non sovraccaricare l'executor
      for (const sw of valid) {
        try {
          // Primo CVE del software (per audit trail)
          const firstCve = sw.cves[0]?.cveId;
          const res = await fetch("/api/patch/operations", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              hostId: detail.hostId,
              cveId: firstCve,
              action: "upgrade",
              packageId: sw.chocoId,
              version: undefined,
            }),
          });
          if (!res.ok && res.status !== 202) {
            const eb = (await res.json().catch(() => null)) as
              | { error?: string }
              | null;
            throw new Error(eb?.error ?? `HTTP ${res.status}`);
          }
          const data = (await res.json()) as { operationId: number };
          if (typeof data.operationId !== "number") {
            throw new Error("Risposta senza operationId");
          }
          results.push({
            operationId: data.operationId,
            hostId: detail.hostId,
            hostLabel: `${hostLabel(detail)} · ${sw.name}`,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Errore";
          errors.push(`${sw.name}: ${msg}`);
        }
        await new Promise((r) => setTimeout(r, 200));
      }

      setLaunching(false);

      if (errors.length > 0) {
        toast.error(
          `${errors.length} upgrade non avviati: ${errors.slice(0, 3).join(" • ")}${errors.length > 3 ? "..." : ""}`
        );
      }
      if (results.length === 0) {
        return;
      }
      setModalTitle(
        results.length === 1
          ? `Patch ${valid[0].name}`
          : `Patch ${results.length} software`
      );
      setModalDescription(
        "choco upgrade fire-and-forget. Stato aggiornato in polling 3s."
      );
      setModalOps(results);
      setModalOpen(true);
    },
    [detail]
  );

  const handleModalClose = () => {
    setModalOpen(false);
    // Dopo chiusura modal refresh detail per aggiornare lastProbeStatus,
    // CVE potenzialmente risolte, ecc.
    void fetchDetail();
  };

  const handlePinClick = (sw: DeviceSoftware) => {
    const firstCve = sw.cves[0]?.cveId;
    if (!firstCve) {
      toast.warning(
        "Pin manuale richiede almeno una CVE associata al software"
      );
      return;
    }
    setPinCveId(firstCve);
    setPinOpen(true);
  };

  const choco = chocoLabelFromProbe(detail?.lastProbeStatus ?? null);
  const totalSoftware = detail?.software.length ?? 0;
  const totalWithCve = (detail?.software ?? []).filter(
    (s) => s.cves.length > 0
  ).length;
  const totalPatchable = (detail?.software ?? []).filter(
    (s) => s.patchable
  ).length;

  return (
    <TooltipProvider>
      <div className="space-y-6 p-6">
        {/* Backlink */}
        <div>
          <Link
            href="/patch-management"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Patch Management
          </Link>
        </div>

        {/* Modulo non installato */}
        {moduleMissing && (
          <Card>
            <CardContent className="py-6 text-sm flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-amber-600" />
              <span>
                Modulo Patch Management non installato per questo tenant. Vai
                a{" "}
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

        {/* Host non trovato */}
        {notFound && !moduleMissing && (
          <Card>
            <CardContent className="py-6 text-sm flex items-center gap-2 text-muted-foreground">
              <AlertCircle className="h-4 w-4" />
              Host #{hostId} non trovato o non Windows.
            </CardContent>
          </Card>
        )}

        {/* Errore */}
        {!moduleMissing && !notFound && error && (
          <Card>
            <CardContent className="py-6 text-sm flex items-center gap-2 text-destructive">
              <AlertCircle className="h-4 w-4" />
              {error}
            </CardContent>
          </Card>
        )}

        {/* Header device */}
        {!moduleMissing && !notFound && (
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-3 flex-wrap">
                    <CardTitle className="text-xl flex items-center gap-2">
                      <Monitor className="h-5 w-5" />
                      {hostLabel(detail)}
                    </CardTitle>
                    {detail?.ip && (
                      <Badge variant="outline" className="font-mono">
                        {detail.ip}
                      </Badge>
                    )}
                    {detail?.winrmValidated ? (
                      <Badge
                        variant="default"
                        className="bg-emerald-600 hover:bg-emerald-700 gap-1"
                      >
                        <ShieldCheck className="h-3 w-3" />
                        WinRM ok
                      </Badge>
                    ) : (
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <Badge variant="destructive" className="gap-1" />
                          }
                        >
                          <XCircle className="h-3 w-3" />
                          WinRM ✗
                        </TooltipTrigger>
                        <TooltipContent>
                          WinRM non configurato/validato — patch automatica non
                          disponibile
                        </TooltipContent>
                      </Tooltip>
                    )}
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Badge
                            variant={choco.variant}
                            className={`gap-1 ${choco.className ?? ""}`}
                          />
                        }
                      >
                        {choco.variant === "default" ? (
                          <CheckCircle2 className="h-3 w-3" />
                        ) : choco.variant === "destructive" ? (
                          <XCircle className="h-3 w-3" />
                        ) : (
                          <HelpCircle className="h-3 w-3" />
                        )}
                        {choco.label}
                      </TooltipTrigger>
                      <TooltipContent>{choco.tooltip}</TooltipContent>
                    </Tooltip>
                  </div>
                  <CardDescription className="break-words">
                    {detail?.osInfo ??
                      detail?.osFamily ??
                      (loading ? "Caricamento..." : "—")}
                  </CardDescription>
                  <p className="text-xs text-muted-foreground">
                    Ultimo probe: {relativeTime(detail?.lastProbeAt ?? null)}
                    {detail?.lastProbeStatus
                      ? ` (${detail.lastProbeStatus})`
                      : ""}
                    {detail?.lastScanId !== null &&
                    detail?.lastScanId !== undefined
                      ? ` · scan #${detail.lastScanId}`
                      : ""}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void fetchDetail()}
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
            </CardHeader>
            <CardContent className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleProbe()}
                disabled={probeBusy || !detail || !detail.winrmValidated}
                title={
                  !detail?.winrmValidated
                    ? "WinRM non configurato per questo host"
                    : undefined
                }
              >
                {probeBusy ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Play className="h-4 w-4 mr-2" />
                )}
                Probe host
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleBootstrap()}
                disabled={
                  bootstrapBusy ||
                  !detail ||
                  !detail.winrmValidated ||
                  detail.lastProbeStatus === "success"
                }
                title={
                  detail?.lastProbeStatus === "success"
                    ? "Chocolatey già installato (ultimo probe ok)"
                    : !detail?.winrmValidated
                      ? "WinRM non configurato per questo host"
                      : undefined
                }
              >
                {bootstrapBusy ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Wrench className="h-4 w-4 mr-2" />
                )}
                Bootstrap choco
              </Button>
              {detail && (
                <a
                  href={`/hosts/${detail.hostId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-primary hover:underline ml-1"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Vedi host in IPAM
                </a>
              )}
              <div className="ml-auto text-sm text-muted-foreground">
                {totalSoftware} software · {totalWithCve} con CVE ·{" "}
                {totalPatchable} patchable
              </div>
            </CardContent>
          </Card>
        )}

        {/* Toolbar filtri software */}
        {!moduleMissing && !notFound && detail && (
          <Card>
            <CardContent className="pt-6 flex flex-wrap items-center gap-3">
              <div className="relative max-w-sm flex-1 min-w-[220px]">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Cerca software, publisher, versione..."
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  className="pl-8"
                />
              </div>

              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox
                  checked={onlyPatchable}
                  onCheckedChange={(v) => setOnlyPatchable(v === true)}
                />
                Solo con CVE patchabili
              </label>

              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox
                  checked={onlyWithCve}
                  onCheckedChange={(v) => setOnlyWithCve(v === true)}
                />
                Solo con CVE
              </label>

              <div className="ml-auto text-sm text-muted-foreground">
                {selected.size} selezionati di {filteredSoftware.length} • max{" "}
                {MAX_SELECTION}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Tabella software */}
        {!moduleMissing && !notFound && detail && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Package className="h-4 w-4" />
                Software installati ({filteredSoftware.length})
              </CardTitle>
              <CardDescription>
                Solo software con CVE patchabili (Chocolatey id presente) può
                essere selezionato per il batch. Per software senza fix:
                &quot;Pin manuale&quot; in colonna azioni.
              </CardDescription>
            </CardHeader>
            <CardContent className="px-0">
              {loading ? (
                <div className="py-6 px-6 flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Caricamento inventory...
                </div>
              ) : filteredSoftware.length === 0 ? (
                <div className="py-6 px-6 text-sm text-muted-foreground space-y-2">
                  <p>
                    {totalSoftware === 0
                      ? "Nessun software inventory disponibile per questo host. Esegui uno scan software inventory (Wazuh o Scanner-Edge)."
                      : "Nessun software corrisponde ai filtri. Disattiva 'Solo patchabili' o 'Solo con CVE' per vedere tutto."}
                  </p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">
                        <Checkbox
                          checked={allSelectableSelected}
                          onCheckedChange={(v) => toggleAll(v === true)}
                          aria-label="Seleziona tutti i software patchabili"
                          disabled={selectableInFiltered.length === 0}
                        />
                      </TableHead>
                      <TableHead>Software</TableHead>
                      <TableHead className="w-24">Versione</TableHead>
                      <TableHead className="w-40">Publisher</TableHead>
                      <TableHead className="w-56">CVE</TableHead>
                      <TableHead className="w-40">Choco</TableHead>
                      <TableHead className="w-28 text-right">Azioni</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredSoftware.map((sw) => {
                      const isSelected = selected.has(sw.softwareId);
                      const checkboxDisabled = !sw.patchable;
                      return (
                        <TableRow
                          key={sw.softwareId}
                          className={
                            isSelected ? "bg-muted/40" : "hover:bg-muted/30"
                          }
                        >
                          <TableCell>
                            {checkboxDisabled ? (
                              <Tooltip>
                                <TooltipTrigger
                                  render={
                                    <span className="inline-flex items-center" />
                                  }
                                >
                                  <Checkbox
                                    checked={false}
                                    disabled
                                    aria-label="Software non patchabile"
                                  />
                                </TooltipTrigger>
                                <TooltipContent>
                                  {sw.cves.length === 0
                                    ? "Nessuna CVE associata"
                                    : !sw.chocoId
                                      ? "Nessun fix Chocolatey — usa 'Pin manuale'"
                                      : "Non patchabile"}
                                </TooltipContent>
                              </Tooltip>
                            ) : (
                              <Checkbox
                                checked={isSelected}
                                onCheckedChange={(v) =>
                                  toggleSoftware(sw, v === true)
                                }
                                aria-label={`Seleziona ${sw.name}`}
                              />
                            )}
                          </TableCell>
                          <TableCell className="font-medium">
                            <div className="flex flex-col gap-0.5">
                              <span title={sw.name}>{sw.name}</span>
                              {sw.source && (
                                <span className="text-xs text-muted-foreground">
                                  source: {sw.source}
                                </span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {sw.version ?? "—"}
                          </TableCell>
                          <TableCell
                            className="text-xs truncate max-w-[10rem]"
                            title={sw.publisher ?? undefined}
                          >
                            {sw.publisher ?? "—"}
                          </TableCell>
                          <TableCell>
                            <CveCountInline
                              cves={sw.cves}
                              softwareName={sw.name}
                            />
                          </TableCell>
                          <TableCell>
                            {sw.chocoId ? (
                              <Badge
                                variant="default"
                                className="bg-emerald-600 hover:bg-emerald-700 font-mono text-xs"
                                title={sw.chocoId}
                              >
                                <ShieldCheck className="h-3 w-3 mr-1" />
                                {sw.chocoId.length > 16
                                  ? `${sw.chocoId.slice(0, 16)}…`
                                  : sw.chocoId}
                              </Badge>
                            ) : sw.cves.length > 0 ? (
                              <Button
                                variant="outline"
                                size="xs"
                                onClick={() => handlePinClick(sw)}
                              >
                                <Pin className="h-3 w-3 mr-1" />
                                Pin manuale
                              </Button>
                            ) : (
                              <span className="text-xs text-muted-foreground">
                                —
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            {sw.patchable && sw.chocoId ? (
                              <Tooltip>
                                <TooltipTrigger
                                  render={
                                    <Button
                                      variant="outline"
                                      size="xs"
                                      onClick={() => void launchUpgrade([sw])}
                                      disabled={
                                        launching || !detail.winrmValidated
                                      }
                                    />
                                  }
                                >
                                  <Rocket className="h-3 w-3 mr-1" />
                                  Patch
                                </TooltipTrigger>
                                <TooltipContent>
                                  {detail.winrmValidated
                                    ? `choco upgrade ${sw.chocoId} -y`
                                    : "WinRM non configurato — patch non disponibile"}
                                </TooltipContent>
                              </Tooltip>
                            ) : (
                              <span className="text-xs text-muted-foreground">
                                —
                              </span>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        )}

        {/* Bottone bulk sticky */}
        {!moduleMissing && !notFound && detail && filteredSoftware.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 sticky bottom-0 bg-background/80 backdrop-blur py-3 border-t">
            <div className="text-sm text-muted-foreground mr-auto">
              {selected.size > 0
                ? `${selected.size} software selezionati`
                : "Seleziona uno o più software patchabili per il batch"}
            </div>
            <Button
              size="sm"
              disabled={
                selected.size === 0 ||
                launching ||
                !detail.winrmValidated
              }
              onClick={() => {
                const targets = (detail.software ?? []).filter((s) =>
                  selected.has(s.softwareId)
                );
                void launchUpgrade(targets);
              }}
              title={
                !detail.winrmValidated
                  ? "WinRM non configurato — patch non disponibile"
                  : undefined
              }
            >
              {launching ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Rocket className="h-4 w-4 mr-2" />
              )}
              Patch selezionati ({selected.size})
            </Button>
          </div>
        )}

        {/* Modal esecuzione (singola op o bulk) */}
        <HostActionModal
          open={modalOpen}
          onClose={handleModalClose}
          title={modalTitle}
          description={modalDescription}
          operations={modalOps}
        />

        {/* Dialog pin manuale */}
        <PinFixDialog
          open={pinOpen}
          onClose={() => setPinOpen(false)}
          cveId={pinCveId}
          onPinned={() => {
            void fetchDetail();
          }}
        />
      </div>
    </TooltipProvider>
  );
}
