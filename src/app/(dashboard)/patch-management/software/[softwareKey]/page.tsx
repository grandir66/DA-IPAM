"use client";

/**
 * Patch Management — Drill-down singolo software (F14).
 *
 * Vista software-centric: si parte da un pacchetto specifico (es. "Firefox
 * 124.0") e si vedono tutti gli host che ce l'hanno installato, con la lista
 * delle CVE associate al pacchetto. Permette di patchare in bulk tutti gli
 * host vulnerabili in un colpo solo (choco upgrade <packageId>, version=latest).
 *
 * Client Component: fetch `/api/patch/software/[softwareKey]` (header software +
 * cves[] + hosts[]). Azioni:
 *   - Probe selezionati (POST /api/patch/probe per ogni host)
 *   - Bootstrap choco selezionati (POST /api/patch/bootstrap per ogni host)
 *   - Upgrade selezionati (POST /api/patch/operations per ogni host,
 *     action='upgrade', packageId=chocoId, version=undefined → latest)
 *   - Pin manuale fix (riusa PinFixDialog F7) se chocoId mancante e
 *     almeno una CVE associata
 *
 * Tutte le azioni di tipo "operation" aprono `HostActionModal` per polling
 * status + tail log live (N operationId, uno per host).
 *
 * Contratto backend (route handler `/api/patch/software/[softwareKey]`):
 *   {
 *     name, version, publisher, chocoId, patchable,
 *     cves: [{ cveId, cvssScore, severity, source }],
 *     hosts: [{ hostId, hostname, ip, customName, osInfo, osFamily,
 *               winrmValidated, lastProbeStatus, lastProbeAt }]
 *   }
 *   404 con error="Module not installed" → modulo non installato per tenant.
 *   404 con altro error → software non trovato.
 *
 * Decisioni F14:
 *   - Cap selezione bulk = 50 host (MAX_SELECTION, coerente con F7/F13).
 *   - softwareKey nella URL preserva l'encoding fatto dalla lista F12:
 *     `${encodeURIComponent(name)}|${encodeURIComponent(version ?? "__NULL__")}`
 *     Per la fetch passiamo direttamente il param raw (è già encoded).
 *   - cveId passato a POST /api/patch/operations = primo CVE (per audit trail).
 *   - version target = undefined (omessa nel body) → choco installa latest.
 *     Se in futuro vorremo "patch a fix_version specifica" potrà arrivare da
 *     un URL param `?targetVersion=X.Y.Z` ma F14 base usa latest.
 *   - lastProbeStatus deriva dall'ultimo `action='probe'` dell'host.
 *   - Pin manuale: pre-popola cveId con il primo CVE dell'elenco.
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
interface SoftwareCve {
  cveId: string;
  cvssScore: number | null;
  severity: string | null;
  source: string;
}

interface SoftwareHost {
  hostId: number;
  hostname: string | null;
  ip: string | null;
  customName: string | null;
  osInfo: string | null;
  osFamily: string | null;
  winrmValidated: boolean;
  lastProbeStatus: string | null;
  lastProbeAt: string | null;
}

interface SoftwareDetail {
  name: string;
  version: string | null;
  publisher: string | null;
  chocoId: string | null;
  patchable: boolean;
  cves: SoftwareCve[];
  hosts: SoftwareHost[];
}

const MAX_SELECTION = 50;
const CVE_PREVIEW_LIMIT = 5;
const NULL_VERSION_TOKEN = "__NULL__";

// ─── helpers ─────────────────────────────────────────────────────────────
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

function severityRank(sev: string | null): number {
  if (!sev) return 0;
  const s = sev.toLowerCase();
  if (s === "critical") return 4;
  if (s === "high") return 3;
  if (s === "medium") return 2;
  if (s === "low") return 1;
  return 0;
}

function hostLabel(h: SoftwareHost): string {
  return h.customName ?? h.hostname ?? h.ip ?? `host-${h.hostId}`;
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

/**
 * Decode softwareKey della URL per il display nel breadcrumb / fallback.
 * Tollerante: in caso di malformazione torna stringa grezza.
 * NB: la fetch usa direttamente il raw param (preserva l'encoding atteso dal
 * backend), questa funzione serve solo per UI fallback se il fetch fallisce.
 */
function decodeSoftwareKeyForDisplay(
  raw: string
): { name: string; version: string | null } | null {
  if (!raw) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  const sep = decoded.indexOf("|");
  if (sep < 0) return null;
  const namePart = decoded.slice(0, sep);
  const versionPart = decoded.slice(sep + 1);
  if (!namePart) return null;
  try {
    const name = decodeURIComponent(namePart);
    const version =
      versionPart === NULL_VERSION_TOKEN
        ? null
        : decodeURIComponent(versionPart);
    return { name, version };
  } catch {
    return null;
  }
}

// ─── Cells riusabili ─────────────────────────────────────────────────────
function WinrmCell({ host }: { host: SoftwareHost }) {
  if (host.winrmValidated) {
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

function ChocoStatusCell({ host }: { host: SoftwareHost }) {
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

// ─── pagina ──────────────────────────────────────────────────────────────
export default function SoftwareDetailPage() {
  const params = useParams<{ softwareKey: string }>();
  const softwareKeyRaw = params?.softwareKey ?? "";

  const [detail, setDetail] = useState<SoftwareDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [moduleMissing, setModuleMissing] = useState(false);
  const [notFound, setNotFound] = useState(false);

  // Filtri host
  const [searchInput, setSearchInput] = useState("");
  const [onlyWithWinrm, setOnlyWithWinrm] = useState(true);

  // Selezione multipla host
  const [selected, setSelected] = useState<Set<number>>(new Set());

  // Espansione lista CVE (>5)
  const [cvesExpanded, setCvesExpanded] = useState(false);

  // Modal esecuzione bulk
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

  const fetchDetail = useCallback(async () => {
    if (!softwareKeyRaw) {
      setError("softwareKey non specificato");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    setModuleMissing(false);
    setNotFound(false);
    try {
      // softwareKeyRaw è già URL-encoded dalla lista F12 (encodeSoftwareKey).
      // Next già fa una pass di decode sui params, quindi rincapsuliamo per
      // preservare il formato atteso dall'endpoint.
      const res = await fetch(
        `/api/patch/software/${encodeURIComponent(softwareKeyRaw)}`,
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
        setNotFound(true);
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as SoftwareDetail;
      setDetail(data);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Errore caricamento software";
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [softwareKeyRaw]);

  useEffect(() => {
    void fetchDetail();
  }, [fetchDetail]);

  // Reset selezione se cambia la lista host (es. dopo refresh)
  useEffect(() => {
    setSelected((prev) => {
      const validIds = new Set((detail?.hosts ?? []).map((h) => h.hostId));
      const next = new Set<number>();
      for (const id of prev) {
        if (validIds.has(id)) next.add(id);
      }
      return next;
    });
  }, [detail]);

  // ─── derivazioni ─────────────────────────────────────────────────────
  const fallbackKey = useMemo(
    () => decodeSoftwareKeyForDisplay(softwareKeyRaw),
    [softwareKeyRaw]
  );

  const displayName = detail?.name ?? fallbackKey?.name ?? "Software";
  const displayVersion = detail?.version ?? fallbackKey?.version ?? null;

  // CVE ordinate per severity desc → cvss desc → cveId asc
  const sortedCves = useMemo(() => {
    if (!detail?.cves) return [];
    return [...detail.cves].sort((a, b) => {
      const sd = severityRank(b.severity) - severityRank(a.severity);
      if (sd !== 0) return sd;
      const cd = (b.cvssScore ?? 0) - (a.cvssScore ?? 0);
      if (cd !== 0) return cd;
      return a.cveId.localeCompare(b.cveId);
    });
  }, [detail?.cves]);

  const cvesToShow = useMemo(() => {
    if (cvesExpanded || sortedCves.length <= CVE_PREVIEW_LIMIT) {
      return sortedCves;
    }
    return sortedCves.slice(0, CVE_PREVIEW_LIMIT);
  }, [cvesExpanded, sortedCves]);

  // Host filtrati: search + onlyWithWinrm
  const filteredHosts = useMemo(() => {
    const all = detail?.hosts ?? [];
    const q = searchInput.trim().toLowerCase();
    return all.filter((h) => {
      if (onlyWithWinrm && !h.winrmValidated) return false;
      if (!q) return true;
      return (
        (h.hostname ?? "").toLowerCase().includes(q) ||
        (h.ip ?? "").toLowerCase().includes(q) ||
        (h.customName ?? "").toLowerCase().includes(q)
      );
    });
  }, [detail?.hosts, searchInput, onlyWithWinrm]);

  const selectableHosts = useMemo(
    () => filteredHosts.filter((h) => h.winrmValidated),
    [filteredHosts]
  );

  const allSelectableSelected =
    selectableHosts.length > 0 &&
    selectableHosts.every((h) => selected.has(h.hostId));

  // ─── handlers selezione ──────────────────────────────────────────────
  const toggleHost = (host: SoftwareHost, checked: boolean) => {
    if (!host.winrmValidated) return;
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

  // ─── bulk action launcher ────────────────────────────────────────────
  const launchBulk = useCallback(
    async (
      action: "probe" | "bootstrap" | "upgrade",
      title: string,
      description?: string
    ) => {
      if (!detail) return;
      const targets = (detail.hosts ?? []).filter((h) =>
        selected.has(h.hostId)
      );
      if (targets.length === 0) {
        toast.warning("Seleziona almeno un host");
        return;
      }
      if (action === "upgrade" && !detail.chocoId) {
        toast.error(
          "Nessun fix Chocolatey associato — usa 'Pin manuale' per fissare il chocoId"
        );
        return;
      }

      const firstCve = detail.cves[0]?.cveId;

      setLaunching(true);
      const results: HostActionOperation[] = [];
      const errors: string[] = [];

      // Lancio sequenziale con throttle leggero (200ms) per non sovraccaricare
      // l'executor WinRM. Stesso pattern di F7/F13.
      for (const h of targets) {
        try {
          let endpoint: string;
          let body: Record<string, unknown>;
          if (action === "probe") {
            endpoint = "/api/patch/probe";
            body = { hostId: h.hostId };
          } else if (action === "bootstrap") {
            endpoint = "/api/patch/bootstrap";
            body = { hostId: h.hostId };
          } else {
            endpoint = "/api/patch/operations";
            body = {
              hostId: h.hostId,
              cveId: firstCve,
              action: "upgrade",
              packageId: detail.chocoId,
              // version omessa → choco installa latest. F14 base.
              version: undefined,
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
    [detail, selected]
  );

  const handleModalClose = () => {
    setModalOpen(false);
    // Rifetch detail per aggiornare lastProbeStatus host
    void fetchDetail();
  };

  const handlePinClick = () => {
    if (!detail || detail.cves.length === 0) {
      toast.warning(
        "Pin manuale richiede almeno una CVE associata al software"
      );
      return;
    }
    setPinCveId(sortedCves[0]?.cveId ?? detail.cves[0].cveId);
    setPinOpen(true);
  };

  // ─── computed UI ─────────────────────────────────────────────────────
  const totalHosts = detail?.hosts.length ?? 0;
  const totalWithWinrm = (detail?.hosts ?? []).filter(
    (h) => h.winrmValidated
  ).length;
  const upgradeDisabledReason = !detail?.chocoId
    ? "Nessun fix Chocolatey associato — usa 'Pin manuale'"
    : null;

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

        {/* Software non trovato */}
        {notFound && !moduleMissing && (
          <Card>
            <CardContent className="py-6 text-sm flex items-start gap-2 text-muted-foreground">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <div className="space-y-1">
                <p>
                  Software{" "}
                  <span className="font-mono">
                    {displayName}
                    {displayVersion ? ` ${displayVersion}` : ""}
                  </span>{" "}
                  non trovato.
                </p>
                <p>
                  Potrebbe essere stato rimosso da tutti gli host o non avere
                  più scan inventory associati.{" "}
                  <Link
                    href="/patch-management"
                    className="underline text-primary"
                  >
                    Torna alla lista software
                  </Link>
                  .
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Errore generico */}
        {!moduleMissing && !notFound && error && (
          <Card>
            <CardContent className="py-6 text-sm flex items-center gap-2 text-destructive">
              <AlertCircle className="h-4 w-4" />
              {error}
            </CardContent>
          </Card>
        )}

        {/* Header software */}
        {!moduleMissing && !notFound && (
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-3 flex-wrap">
                    <CardTitle className="text-xl flex items-center gap-2">
                      <Package className="h-5 w-5" />
                      {displayName}
                    </CardTitle>
                    {displayVersion && (
                      <Badge variant="outline" className="font-mono">
                        {displayVersion}
                      </Badge>
                    )}
                    {detail?.chocoId ? (
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <Badge
                              variant="default"
                              className="bg-emerald-600 hover:bg-emerald-700 gap-1 font-mono text-xs"
                            />
                          }
                        >
                          <ShieldCheck className="h-3 w-3" />
                          choco: {detail.chocoId}
                        </TooltipTrigger>
                        <TooltipContent>
                          Pacchetto Chocolatey associato — upgrade automatico
                          disponibile
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      <Tooltip>
                        <TooltipTrigger
                          render={<Badge variant="outline" className="gap-1" />}
                        >
                          <HelpCircle className="h-3 w-3" />
                          choco: ?
                        </TooltipTrigger>
                        <TooltipContent>
                          Nessun pacchetto Chocolatey associato — usa &quot;Pin
                          manuale&quot; per fissarlo
                        </TooltipContent>
                      </Tooltip>
                    )}
                  </div>
                  <CardDescription className="break-words">
                    {detail?.publisher ?? (loading ? "Caricamento..." : "—")}
                  </CardDescription>
                  <p className="text-xs text-muted-foreground">
                    {detail?.cves.length ?? 0} CVE associate ·{" "}
                    {totalHosts} host con questo pacchetto ({totalWithWinrm}{" "}
                    con WinRM)
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {detail && !detail.chocoId && detail.cves.length > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handlePinClick}
                    >
                      <Pin className="h-4 w-4 mr-2" />
                      Pin manuale fix
                    </Button>
                  )}
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
              </div>
            </CardHeader>
          </Card>
        )}

        {/* Box CVE associate */}
        {!moduleMissing && !notFound && detail && detail.cves.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <AlertCircle className="h-4 w-4" />
                CVE rilevate ({detail.cves.length})
              </CardTitle>
              <CardDescription>
                Vulnerabilità note che riguardano questo pacchetto. Apri la
                pagina CVE per dettaglio e fix specifico.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-1.5">
                {cvesToShow.map((c) => (
                  <li
                    key={`${c.cveId}-${c.source}`}
                    className="flex items-center gap-3 flex-wrap text-sm py-1"
                  >
                    <Badge
                      variant={severityVariant(c.severity)}
                      className="min-w-[4.5rem] justify-center"
                    >
                      {severityLabel(c.severity)}
                    </Badge>
                    <Link
                      href={`/patch-management/cve/${encodeURIComponent(c.cveId)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-primary hover:underline inline-flex items-center gap-1"
                    >
                      {c.cveId}
                      <ExternalLink className="h-3 w-3" />
                    </Link>
                    {c.cvssScore !== null && (
                      <span className="text-xs font-mono text-muted-foreground">
                        CVSS {c.cvssScore.toFixed(1)}
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground ml-auto">
                      source: {c.source}
                    </span>
                  </li>
                ))}
              </ul>
              {sortedCves.length > CVE_PREVIEW_LIMIT && (
                <button
                  type="button"
                  className="mt-3 text-xs underline text-primary"
                  onClick={() => setCvesExpanded((v) => !v)}
                >
                  {cvesExpanded
                    ? "Nascondi"
                    : `Mostra tutte (${sortedCves.length - CVE_PREVIEW_LIMIT} altre)`}
                </button>
              )}
            </CardContent>
          </Card>
        )}

        {/* Toolbar filtri host */}
        {!moduleMissing && !notFound && detail && (
          <Card>
            <CardContent className="pt-6 flex flex-wrap items-center gap-3">
              <div className="relative max-w-sm flex-1 min-w-[220px]">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Cerca hostname, IP, custom name..."
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  className="pl-8"
                />
              </div>

              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox
                  checked={onlyWithWinrm}
                  onCheckedChange={(v) => setOnlyWithWinrm(v === true)}
                />
                Solo con WinRM
              </label>

              <div className="ml-auto text-sm text-muted-foreground">
                {selected.size} selezionati di {filteredHosts.length} • max{" "}
                {MAX_SELECTION}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Tabella host */}
        {!moduleMissing && !notFound && detail && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Package className="h-4 w-4" />
                Host con questo pacchetto ({filteredHosts.length})
              </CardTitle>
              <CardDescription>
                Solo host Windows con il pacchetto installato. Checkbox
                disabilitata se WinRM non è validato.
              </CardDescription>
            </CardHeader>
            <CardContent className="px-0">
              {loading ? (
                <div className="py-6 px-6 flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Caricamento host...
                </div>
              ) : filteredHosts.length === 0 ? (
                <div className="py-6 px-6 text-sm text-muted-foreground">
                  {totalHosts === 0
                    ? "Nessun host trovato con questo pacchetto installato."
                    : "Nessun host corrisponde ai filtri. Disattiva 'Solo con WinRM' o pulisci la ricerca."}
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
                      <TableHead className="w-20 text-center">WinRM</TableHead>
                      <TableHead className="w-20 text-center">Choco</TableHead>
                      <TableHead className="w-32">Ultimo probe</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredHosts.map((h) => {
                      const isSelected = selected.has(h.hostId);
                      const checkboxDisabled = !h.winrmValidated;
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
                              href={`/patch-management/device/${h.hostId}`}
                              className="hover:underline text-primary"
                            >
                              {hostLabel(h)}
                            </Link>
                          </TableCell>
                          <TableCell className="font-mono text-sm">
                            {h.ip ?? "—"}
                          </TableCell>
                          <TableCell className="text-sm truncate max-w-[14rem]">
                            {h.osInfo ?? h.osFamily ?? "—"}
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

        {/* Bottoni azione bulk (sticky) */}
        {!moduleMissing && !notFound && detail && filteredHosts.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 sticky bottom-0 bg-background/80 backdrop-blur py-3 border-t">
            <div className="text-sm text-muted-foreground mr-auto">
              {selected.size > 0
                ? `${selected.size} host selezionati`
                : "Seleziona uno o più host con WinRM per il batch"}
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={selected.size === 0 || launching}
              onClick={() =>
                void launchBulk(
                  "probe",
                  "Probe Chocolatey",
                  "Verifica versione choco installata e pacchetti outdated sugli host selezionati."
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
              Bootstrap choco
            </Button>
            <Button
              size="sm"
              disabled={
                selected.size === 0 || launching || !detail.chocoId
              }
              onClick={() =>
                void launchBulk(
                  "upgrade",
                  detail.chocoId
                    ? `Upgrade ${detail.chocoId} (latest)`
                    : "Upgrade",
                  "choco upgrade fire-and-forget verso ultima versione disponibile. Stato aggiornato in polling 3s."
                )
              }
              title={upgradeDisabledReason ?? undefined}
            >
              {launching ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Rocket className="h-4 w-4 mr-2" />
              )}
              Upgrade selezionati ({selected.size})
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
