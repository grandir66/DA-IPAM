"use client";

/**
 * Patch Management — Drill-down singola CVE (F7 PR2).
 *
 * Client Component: fetch parallelo `/api/patch/cve/[cveId]` (dettaglio) e
 * `/api/patch/cve/[cveId]/hosts` (host vulnerabili). Permette:
 *   - Triggera matching (PUT /api/patch/cve/[cveId]/match) per ricalcolare il fix
 *   - Pin manuale fix (POST /api/patch/cve/[cveId]/match) — dialog dedicato
 *   - Selezione multipla host (max 50) con disabilita su WinRM ✗
 *   - Probe selezionati (POST /api/patch/probe per ogni host)
 *   - Bootstrap choco selezionati (POST /api/patch/bootstrap per ogni host)
 *   - Patch selezionati (POST /api/patch/operations con action=upgrade) —
 *     disabilitato se non c'è fix.packageId
 *
 * Per ogni bulk action apre <HostActionModal> con polling 3s status.
 * Log live streaming raffinato arriva in F8.
 *
 * Contratto backend (verificato sui route handler):
 *   GET /api/patch/cve/[cveId]:
 *     { cveId, cvssScore, cvssVector, severity, title, description,
 *       packageName, packageVersion, references[],
 *       matches: [{ softwareId, matchStrategy, confidence,
 *                   fixPackageManager, fixPackageId, fixVersion }] }
 *   GET /api/patch/cve/[cveId]/hosts:
 *     { items: [{ hostId, ip, hostname, customName, osInfo, osFamily,
 *                 winrmAvailable, softwareInventoryAvailable,
 *                 lastProbeStatus, lastProbeAt }] }
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
  PackageSearch,
  Pin,
  Play,
  RefreshCw,
  Rocket,
  Server,
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

interface CveMatch {
  softwareId: number;
  matchStrategy: string;
  confidence: number;
  fixPackageManager: string | null;
  fixPackageId: string | null;
  fixVersion: string | null;
}

interface CveDetail {
  cveId: string;
  cvssScore: number | null;
  cvssVector: string | null;
  severity: string | null;
  title: string | null;
  description: string | null;
  packageName: string | null;
  packageVersion: string | null;
  references: string[];
  matches: CveMatch[];
}

interface VulnHost {
  hostId: number;
  ip: string | null;
  hostname: string | null;
  customName: string | null;
  osInfo: string | null;
  osFamily: string | null;
  winrmAvailable: boolean;
  softwareInventoryAvailable: boolean;
  lastProbeStatus: string | null;
  lastProbeAt: string | null;
}

const MAX_SELECTION = 50;

function severityVariant(
  sev: string | null
): "default" | "destructive" | "secondary" | "outline" {
  if (!sev) return "outline";
  const s = sev.toLowerCase();
  if (s === "critical" || s === "high") return "destructive";
  if (s === "medium") return "default";
  return "secondary";
}

function severityLabel(sev: string | null): string {
  if (!sev) return "—";
  return sev.charAt(0).toUpperCase() + sev.slice(1).toLowerCase();
}

function pickBestFix(matches: CveMatch[]): CveMatch | null {
  if (matches.length === 0) return null;
  // Prima preferenza: manual (confidence 1.0). Poi confidence desc.
  const manual = matches.find((m) => m.matchStrategy === "manual");
  if (manual && manual.fixPackageId) return manual;
  const withFix = matches.filter((m) => m.fixPackageId);
  if (withFix.length === 0) return null;
  return [...withFix].sort((a, b) => b.confidence - a.confidence)[0];
}

function hostLabel(h: VulnHost): string {
  return (
    h.customName ?? h.hostname ?? h.ip ?? `host-${h.hostId}`
  );
}

function relativeTime(iso: string | null): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const diffSec = Math.floor((Date.now() - t) / 1000);
  if (diffSec < 60) return `${diffSec}s fa`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m fa`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h fa`;
  return `${Math.floor(diffSec / 86400)}g fa`;
}

function ChocoStatusCell({ host }: { host: VulnHost }) {
  // F7 base: derivato SOLO da lastProbeStatus dell'ultimo `action='probe'`.
  // F4 endpoint hosts non espone chocoVersion direttamente — per averlo
  // l'admin deve lanciare un probe.
  if (host.lastProbeStatus === "success") {
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <Badge
              variant="default"
              className="bg-emerald-600 hover:bg-emerald-700 gap-1"
            />
          }
        >
          <CheckCircle2 className="h-3 w-3" />
          ok
        </TooltipTrigger>
        <TooltipContent>Probe Chocolatey riuscito</TooltipContent>
      </Tooltip>
    );
  }
  if (host.lastProbeStatus === "failed") {
    return (
      <Tooltip>
        <TooltipTrigger
          render={<Badge variant="destructive" className="gap-1" />}
        >
          <XCircle className="h-3 w-3" />
          fail
        </TooltipTrigger>
        <TooltipContent>Ultimo probe Chocolatey fallito</TooltipContent>
      </Tooltip>
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger render={<Badge variant="outline" className="gap-1" />}>
        <HelpCircle className="h-3 w-3" />?
      </TooltipTrigger>
      <TooltipContent>
        Stato sconosciuto — lancia &quot;Probe selezionati&quot; per scoprirlo
      </TooltipContent>
    </Tooltip>
  );
}

function WinrmCell({ host }: { host: VulnHost }) {
  if (host.winrmAvailable) {
    return (
      <Badge
        variant="default"
        className="bg-emerald-600 hover:bg-emerald-700 gap-1"
      >
        <CheckCircle2 className="h-3 w-3" />
        ok
      </Badge>
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger
        render={<Badge variant="destructive" className="gap-1" />}
      >
        <XCircle className="h-3 w-3" />
        ✗
      </TooltipTrigger>
      <TooltipContent>
        WinRM non configurato/validato per questo host
      </TooltipContent>
    </Tooltip>
  );
}

export default function CveDetailPage() {
  const params = useParams<{ cveId: string }>();
  const cveIdRaw = params?.cveId ?? "";
  const cveId = useMemo(() => decodeURIComponent(cveIdRaw), [cveIdRaw]);

  const [detail, setDetail] = useState<CveDetail | null>(null);
  const [hosts, setHosts] = useState<VulnHost[]>([]);
  const [loadingDetail, setLoadingDetail] = useState(true);
  const [loadingHosts, setLoadingHosts] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [moduleMissing, setModuleMissing] = useState(false);
  const [showDescriptionFull, setShowDescriptionFull] = useState(false);

  // Selezione multipla
  const [selected, setSelected] = useState<Set<number>>(new Set());

  // Trigger match
  const [matching, setMatching] = useState(false);

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

  const fetchDetail = useCallback(async () => {
    if (!cveId) return;
    setLoadingDetail(true);
    try {
      const res = await fetch(`/api/patch/cve/${encodeURIComponent(cveId)}`, {
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
        setError(body?.error ?? "CVE non trovata");
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as CveDetail;
      setDetail(data);
      setError(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Errore caricamento CVE";
      setError(msg);
      toast.error(msg);
    } finally {
      setLoadingDetail(false);
    }
  }, [cveId]);

  const fetchHosts = useCallback(async () => {
    if (!cveId) return;
    setLoadingHosts(true);
    try {
      const res = await fetch(
        `/api/patch/cve/${encodeURIComponent(cveId)}/hosts`,
        { cache: "no-store" }
      );
      if (res.status === 404) {
        const body = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        if (body?.error === "Module not installed") {
          setModuleMissing(true);
          return;
        }
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { items: VulnHost[] };
      setHosts(data.items ?? []);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Errore caricamento host";
      toast.error(msg);
    } finally {
      setLoadingHosts(false);
    }
  }, [cveId]);

  useEffect(() => {
    void fetchDetail();
    void fetchHosts();
  }, [fetchDetail, fetchHosts]);

  // Reset selezione se cambia la lista host (es. dopo refresh)
  useEffect(() => {
    setSelected((prev) => {
      const validIds = new Set(hosts.map((h) => h.hostId));
      const next = new Set<number>();
      for (const id of prev) {
        if (validIds.has(id)) next.add(id);
      }
      return next;
    });
  }, [hosts]);

  const fix = useMemo(
    () => (detail ? pickBestFix(detail.matches) : null),
    [detail]
  );

  const selectableHosts = useMemo(
    () => hosts.filter((h) => h.winrmAvailable),
    [hosts]
  );

  const allSelectableSelected =
    selectableHosts.length > 0 &&
    selectableHosts.every((h) => selected.has(h.hostId));

  const toggleHost = (host: VulnHost, checked: boolean) => {
    if (!host.winrmAvailable) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) {
        if (next.size >= MAX_SELECTION) {
          toast.warning(
            `Limite massimo: ${MAX_SELECTION} host selezionabili per batch`
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

  const toggleAll = (checked: boolean) => {
    if (checked) {
      const next = new Set<number>();
      for (const h of selectableHosts) {
        if (next.size >= MAX_SELECTION) break;
        next.add(h.hostId);
      }
      if (selectableHosts.length > MAX_SELECTION) {
        toast.warning(
          `Selezionati i primi ${MAX_SELECTION} di ${selectableHosts.length} host (limite batch)`
        );
      }
      setSelected(next);
    } else {
      setSelected(new Set());
    }
  };

  const handleTriggerMatch = async () => {
    setMatching(true);
    try {
      const res = await fetch(
        `/api/patch/cve/${encodeURIComponent(cveId)}/match`,
        { method: "PUT" }
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { cveId: string; matched: number };
      toast.success(
        `Match completato: ${data.matched} riga/righe scritte/aggiornate`
      );
      await fetchDetail();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Errore matching";
      toast.error(msg);
    } finally {
      setMatching(false);
    }
  };

  const launchBulk = useCallback(
    async (
      action: "probe" | "bootstrap" | "upgrade",
      title: string,
      description?: string
    ) => {
      const targetHosts = hosts.filter((h) => selected.has(h.hostId));
      if (targetHosts.length === 0) {
        toast.warning("Seleziona almeno un host");
        return;
      }
      if (action === "upgrade" && !fix?.fixPackageId) {
        toast.error(
          "Nessun fix Chocolatey associato a questa CVE — usa 'Triggera matching' o 'Pin manuale'"
        );
        return;
      }
      setLaunching(true);
      const results: HostActionOperation[] = [];
      const errors: string[] = [];

      // Lancio sequenziale per evitare di sovraccaricare l'executor WinRM,
      // ma con un piccolo throttle minimo (200ms) tra una POST e l'altra.
      // F8 può promuovere a batch parallelo controllato lato server.
      for (const h of targetHosts) {
        try {
          let endpoint: string;
          let body: Record<string, unknown>;
          if (action === "probe") {
            endpoint = "/api/patch/probe";
            body = { hostId: h.hostId, cveId };
          } else if (action === "bootstrap") {
            endpoint = "/api/patch/bootstrap";
            body = { hostId: h.hostId, cveId };
          } else {
            endpoint = "/api/patch/operations";
            body = {
              hostId: h.hostId,
              cveId,
              action: "upgrade",
              packageId: fix!.fixPackageId,
              version: fix?.fixVersion ?? undefined,
            };
          }

          const res = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
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
            hostId: h.hostId,
            hostLabel: hostLabel(h),
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Errore";
          errors.push(`${hostLabel(h)}: ${msg}`);
        }
        // throttle leggero (non blocca l'UI con sleep grandi)
        await new Promise((r) => setTimeout(r, 200));
      }

      setLaunching(false);
      if (errors.length > 0) {
        toast.error(
          `${errors.length} host non avviati: ${errors.slice(0, 3).join(" • ")}${errors.length > 3 ? "..." : ""}`
        );
      }
      if (results.length === 0) {
        return;
      }
      setModalTitle(title);
      setModalDescription(description);
      setModalOps(results);
      setModalOpen(true);
    },
    [hosts, selected, fix, cveId]
  );

  const handleModalClose = () => {
    setModalOpen(false);
    // Dopo aver chiuso il modal, refresh hosts per aggiornare lastProbeStatus
    void fetchHosts();
  };

  const description = detail?.description ?? "";
  const longDescription = description.length > 280;
  const displayedDescription =
    showDescriptionFull || !longDescription
      ? description
      : `${description.slice(0, 280)}…`;

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

        {/* Errore */}
        {!moduleMissing && error && (
          <Card>
            <CardContent className="py-6 text-sm flex items-center gap-2 text-destructive">
              <AlertCircle className="h-4 w-4" />
              {error}
            </CardContent>
          </Card>
        )}

        {/* Header CVE */}
        {!moduleMissing && (
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-3 flex-wrap">
                    <CardTitle className="font-mono text-xl">{cveId}</CardTitle>
                    {detail?.severity && (
                      <Badge variant={severityVariant(detail.severity)}>
                        {severityLabel(detail.severity)}
                      </Badge>
                    )}
                    {detail?.cvssScore !== null &&
                      detail?.cvssScore !== undefined && (
                        <Badge
                          variant={severityVariant(detail.severity)}
                          className="font-mono"
                        >
                          CVSS {detail.cvssScore.toFixed(1)}
                        </Badge>
                      )}
                  </div>
                  <CardDescription className="break-words">
                    {detail?.title ?? (loadingDetail ? "Caricamento..." : "—")}
                  </CardDescription>
                  {detail?.cvssVector && (
                    <p className="text-xs font-mono text-muted-foreground">
                      {detail.cvssVector}
                    </p>
                  )}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    void fetchDetail();
                    void fetchHosts();
                  }}
                  disabled={loadingDetail || loadingHosts}
                >
                  {loadingDetail || loadingHosts ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <RefreshCw className="h-4 w-4 mr-2" />
                  )}
                  Aggiorna
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Descrizione */}
              {description && (
                <div className="text-sm text-muted-foreground space-y-1">
                  <p className="whitespace-pre-wrap break-words">
                    {displayedDescription}
                  </p>
                  {longDescription && (
                    <button
                      type="button"
                      onClick={() => setShowDescriptionFull((v) => !v)}
                      className="text-xs underline text-primary"
                    >
                      {showDescriptionFull ? "Mostra meno" : "Mostra tutto"}
                    </button>
                  )}
                </div>
              )}

              {/* Package coinvolto */}
              {(detail?.packageName || detail?.packageVersion) && (
                <div className="text-sm flex items-start gap-2">
                  <PackageSearch className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
                  <div>
                    <span className="font-medium">Pacchetto coinvolto:</span>{" "}
                    <span className="font-mono">
                      {detail.packageName ?? "?"}
                      {detail.packageVersion ? ` ${detail.packageVersion}` : ""}
                    </span>
                  </div>
                </div>
              )}

              {/* Riferimenti esterni */}
              {detail?.references && detail.references.length > 0 && (
                <div className="text-sm">
                  <p className="font-medium mb-1">Riferimenti</p>
                  <ul className="space-y-1">
                    {detail.references.slice(0, 5).map((ref) => (
                      <li key={ref}>
                        <a
                          href={ref}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-primary hover:underline break-all"
                        >
                          <ExternalLink className="h-3 w-3 shrink-0" />
                          {ref}
                        </a>
                      </li>
                    ))}
                    {detail.references.length > 5 && (
                      <li className="text-xs text-muted-foreground">
                        ... e altri {detail.references.length - 5} riferimenti
                      </li>
                    )}
                  </ul>
                </div>
              )}

              {/* Fix suggerito */}
              <div className="border rounded-md p-3 bg-muted/30">
                <div className="flex items-start gap-2">
                  <Wrench className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">Fix suggerito</p>
                    {fix ? (
                      <div className="text-sm space-y-1 mt-1">
                        <p className="font-mono text-xs bg-background border rounded px-2 py-1 inline-block">
                          choco upgrade {fix.fixPackageId}
                          {fix.fixVersion
                            ? ` --version ${fix.fixVersion}`
                            : ""}{" "}
                          -y
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Strategia:{" "}
                          <span className="font-mono">{fix.matchStrategy}</span>{" "}
                          • Confidence:{" "}
                          <span className="font-mono">
                            {fix.confidence.toFixed(2)}
                          </span>
                        </p>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground mt-1">
                        Nessun fix automatico associato. Usa &quot;Triggera
                        matching&quot; o &quot;Pin manuale&quot;.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Toolbar azioni globali */}
        {!moduleMissing && (
          <Card>
            <CardContent className="py-4 flex flex-wrap items-center gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleTriggerMatch()}
                disabled={matching}
              >
                {matching ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <RefreshCw className="h-4 w-4 mr-2" />
                )}
                Triggera matching
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPinOpen(true)}
              >
                <Pin className="h-4 w-4 mr-2" />
                Pin manuale fix
              </Button>
              <div className="ml-auto text-sm text-muted-foreground">
                {selected.size} host selezionati di {hosts.length} • max{" "}
                {MAX_SELECTION}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Tabella host */}
        {!moduleMissing && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Server className="h-4 w-4" />
                Host vulnerabili ({hosts.length})
              </CardTitle>
              <CardDescription>
                Solo host Windows con software inventory popolato. Checkbox
                disabilitata se WinRM non è configurato.
              </CardDescription>
            </CardHeader>
            <CardContent className="px-0">
              {loadingHosts ? (
                <div className="py-6 px-6 flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Caricamento host...
                </div>
              ) : hosts.length === 0 ? (
                <div className="py-6 px-6 text-sm text-muted-foreground">
                  Nessun host vulnerabile trovato per questa CVE. Verifica che
                  almeno un host Windows abbia <code>software_inventory</code>{" "}
                  popolato e una vulnerability rilevata da Wazuh o Scanner-Edge.
                </div>
              ) : (
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
                      <TableHead>Hostname</TableHead>
                      <TableHead className="w-36">IP</TableHead>
                      <TableHead>OS</TableHead>
                      <TableHead className="w-20 text-center">
                        Inventory
                      </TableHead>
                      <TableHead className="w-20 text-center">WinRM</TableHead>
                      <TableHead className="w-20 text-center">Choco</TableHead>
                      <TableHead className="w-32">Ultimo probe</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {hosts.map((h) => {
                      const isSelected = selected.has(h.hostId);
                      const checkboxDisabled = !h.winrmAvailable;
                      return (
                        <TableRow
                          key={h.hostId}
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
                                    aria-label="WinRM non configurato"
                                  />
                                </TooltipTrigger>
                                <TooltipContent>
                                  WinRM non configurato — host non patchabile
                                </TooltipContent>
                              </Tooltip>
                            ) : (
                              <Checkbox
                                checked={isSelected}
                                onCheckedChange={(v) =>
                                  toggleHost(h, v === true)
                                }
                                aria-label={`Seleziona ${hostLabel(h)}`}
                              />
                            )}
                          </TableCell>
                          <TableCell className="font-medium">
                            <Link
                              href={`/hosts/${h.hostId}`}
                              className="hover:underline text-primary"
                            >
                              {hostLabel(h)}
                            </Link>
                          </TableCell>
                          <TableCell className="font-mono text-sm">
                            {h.ip ?? "—"}
                          </TableCell>
                          <TableCell className="text-sm">
                            {h.osInfo ?? h.osFamily ?? "—"}
                          </TableCell>
                          <TableCell className="text-center">
                            {h.softwareInventoryAvailable ? (
                              <Badge
                                variant="default"
                                className="bg-emerald-600 hover:bg-emerald-700"
                              >
                                <CheckCircle2 className="h-3 w-3 mr-1" />
                                ok
                              </Badge>
                            ) : (
                              <Badge variant="outline">
                                <HelpCircle className="h-3 w-3 mr-1" />?
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-center">
                            <WinrmCell host={h} />
                          </TableCell>
                          <TableCell className="text-center">
                            <ChocoStatusCell host={h} />
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {relativeTime(h.lastProbeAt)}
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

        {/* Bottoni azione bulk */}
        {!moduleMissing && hosts.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 sticky bottom-0 bg-background/80 backdrop-blur py-3 border-t">
            <Button
              variant="outline"
              size="sm"
              disabled={selected.size === 0 || launching}
              onClick={() =>
                void launchBulk(
                  "probe",
                  "Probe Chocolatey",
                  "Verifica versione choco installata e pacchetti outdated."
                )
              }
            >
              {launching ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Play className="h-4 w-4 mr-2" />
              )}
              Probe selezionati
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={selected.size === 0 || launching}
              onClick={() =>
                void launchBulk(
                  "bootstrap",
                  "Bootstrap Chocolatey",
                  "Installa Chocolatey sugli host che ne sono privi. Idempotente."
                )
              }
            >
              {launching ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Wrench className="h-4 w-4 mr-2" />
              )}
              Bootstrap choco selezionati
            </Button>
            <Button
              size="sm"
              disabled={
                selected.size === 0 || launching || !fix?.fixPackageId
              }
              onClick={() =>
                void launchBulk(
                  "upgrade",
                  fix
                    ? `Patch ${fix.fixPackageId}${fix.fixVersion ? ` ${fix.fixVersion}` : ""}`
                    : "Patch",
                  "choco upgrade fire-and-forget. Stato aggiornato in polling 3s."
                )
              }
              title={
                fix?.fixPackageId
                  ? undefined
                  : "Nessun fix Chocolatey associato — usa 'Triggera matching' o 'Pin manuale'"
              }
            >
              {launching ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Rocket className="h-4 w-4 mr-2" />
              )}
              Patch selezionati
            </Button>
          </div>
        )}

        {/* Modal esecuzione bulk */}
        <HostActionModal
          open={modalOpen}
          onClose={handleModalClose}
          title={modalTitle}
          description={modalDescription}
          operations={modalOps}
        />

        {/* Dialog pin manuale fix */}
        <PinFixDialog
          open={pinOpen}
          onClose={() => setPinOpen(false)}
          cveId={cveId}
          onPinned={() => {
            void fetchDetail();
          }}
        />
      </div>
    </TooltipProvider>
  );
}
