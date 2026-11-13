"use client";
import { parseDbDate } from "@/lib/db-date";

import { Fragment, useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogScrollableArea,
  DialogTitle,
  DialogTrigger,
  DIALOG_PANEL_WIDE_CLASS,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusBadge } from "@/components/shared/status-badge";
import { Checkbox } from "@/components/ui/checkbox";
import { IpGrid } from "@/components/shared/ip-grid";
import { useGiri } from "@/components/shared/giri-context";
import { SubnetScheduleCard } from "@/components/networks/subnet-schedule-card";
import { SubnetEdgeScanPanel } from "@/components/networks/subnet-edge-scan-panel";
import { CategoriaBloccoDialog } from "@/components/networks/categoria-blocco-dialog";
import { ScegliCategoria } from "@/components/networks/scegli-categoria";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { origineCategoria, passaFiltroCategoria } from "@/lib/classification/scelta-categoria";
import { OpzioniCategorie } from "@/components/networks/opzioni-categorie";
import { passaFiltroSistema, SISTEMA_IGNOTO, SISTEMI } from "@/lib/classification/sistema";
import { passaFiltroProduttore, produttoriTrovati, PRODUTTORE_IGNOTO } from "@/lib/classification/produttore";
import { FORMA_IGNOTA, FORME, passaFiltroForma } from "@/lib/classification/forma";
import { OpzioniFunzioni, type FunzioneInRiga } from "@/components/networks/funzioni-host";
import { FunzioniInRiga } from "@/components/networks/funzioni-in-riga";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { aggiungiFiltroValore, passaFiltriValore, togliFiltroValore, valoreLeggibile, type FiltroValore } from "@/lib/discovery/filtri-valore";
import { colonnaDaIndice, etichettaColonnaSubnet, hostDelMenu, nomeHost, testoCellaSubnet } from "@/lib/networks/celle-subnet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ArrowLeft, Scan, Download, LayoutGrid, List, Pencil, RefreshCw, CheckCircle2, ExternalLink, X, Plus, Trash2, UserCheck, UserX, Key, Loader2, Radar, Tags, ChevronDown, Microscope, Filter, EyeOff, Copy, Tag } from "lucide-react";
import { toast } from "sonner";
import type { Network, Host, NetworkDevice, ScanProgress as ScanProgressType } from "@/types";
import { cn, hostOpenPortsToFullLabel } from "@/lib/utils";

/** Altezza uniforme per tutti i pulsanti della toolbar azioni subnet. */
const ACTION_BTN = "h-8 min-h-8 px-2.5 text-xs font-medium shrink-0";
import { getClassificationLabel, getDeviceCategoryGroup, DEVICE_CATEGORY_GROUP_LABELS, DEVICE_CATEGORY_GROUP_ORDER } from "@/lib/device-classifications";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { etichettaFunzione } from "@/lib/classification/funzioni";
import { figliePresenti, PREFISSO_GRUPPO } from "@/lib/classification/scelta-categoria";
import { parseDetectedDeviceFromDetectionJson } from "@/lib/device-fingerprint-classification";
import { NetworkCredentialsTable } from "@/components/shared/network-credentials-table";
import { ProtocolBadges } from "@/components/shared/protocol-badges";
import { RendiApparatoDialog } from "@/components/devices/rendi-apparato-dialog";
import { BadgeAMano, BadgeSenzaProva } from "@/components/devices/credenziali-assegnate";
import { hostGestitoSenzaProva } from "@/lib/devices/credenziali-assegnate";
import { HostCredentialsDialog } from "@/components/shared/host-credentials-dialog";
import { ipAssignmentShortLabel } from "@/lib/ip-assignment";
import { SortableTableHead } from "@/components/shared/sortable-table-head";
import { compareUnknown, type SortDirection } from "@/lib/table-sort";
import { CassettoHost } from "@/components/hosts/cassetto-host";

type HostWithDevice = Host & {
  device_id?: number;
  device?: { id: number; name: string; sysname: string | null; vendor: string; protocol: string };
  ad_dns_host_name?: string | null;
  multihomed?: { group_id: string; match_type: string; peers: Array<{ ip: string; network_name: string; host_id: number }> } | null;
  /** 1 = classificazione bloccata da modifica manuale dell'utente, esclusa dalle proiezioni automatiche di Attribution v2. */
  classification_manual?: number;
};

/** Contratto di GET /api/networks/[id]/scan-phases (Task 1, fase 3b). */
interface ScanPhasesResponse {
  naabuAvailable: boolean;
  phases: Array<{
    key: "initial" | "nmap_deep" | "snmp" | "enrich" | "credentials";
    label: string;
    adds: string;
    last_run: string | null;
    stale: boolean;
  }>;
  attribution: {
    total: number;
    level2: number;
    level1: number;
    none: number;
    suggestion: string | null;
  };
}

/** "network.access_point" → "Access Point" (ultimo segmento dello slug categoria, capitalizzato). */
function attrCategoryLabel(slug: string): string {
  const last = slug.includes(".") ? slug.slice(slug.lastIndexOf(".") + 1) : slug;
  return last.split("_").filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

/** Formatta un ISO timestamp come "il DD/MM HH:mm" per la riga di stato fase. */
function formatPhaseLastRun(iso: string): string {
  const d = parseDbDate(iso);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `il ${dd}/${mm} ${hh}:${mi}`;
}

/** «Ultima esecuzione: il DD/MM HH:mm» / «Mai eseguita» [+ «, obsoleta»], per suggerimenti e menu. */
function phaseWhen(phase: ScanPhasesResponse["phases"][number] | null): string {
  if (!phase?.last_run) return "Mai eseguita";
  return `Ultima esecuzione: ${formatPhaseLastRun(phase.last_run)}${phase.stale ? ", obsoleta" : ""}`;
}

/** Voce di menu di una fase della subnet: nome a sinistra, ultima esecuzione a destra. */
function PhaseMenuItem({ label, phase, onClick }: { label: string; phase: ScanPhasesResponse["phases"][number] | null; onClick: () => void }) {
  return (
    <DropdownMenuItem onClick={onClick} title={phase?.adds}>
      {label}
      <span className="ml-auto pl-4 text-xs text-muted-foreground inline-flex items-center gap-1">
        {phase?.last_run ? formatPhaseLastRun(phase.last_run) : "mai"}
        {phase?.stale && (
          <Badge variant="outline" className="text-[10px] leading-none py-0 px-1 h-4">
            obsoleta
          </Badge>
        )}
      </span>
    </DropdownMenuItem>
  );
}

const REFRESH_INTERVALS = [
  { value: 0, label: "Off" },
  { value: 30, label: "30s" },
  { value: 60, label: "1m" },
  { value: 120, label: "2m" },
  { value: 300, label: "5m" },
] as const;

interface NetworkDetailClientProps {
  network: Network;
  initialHosts: (Host & { device_id?: number })[];
  routerId: number | null;
  routers: NetworkDevice[];
  initialCredentialIds: number[];
  initialAvailableSources: Array<{ id: number; name: string; cidr: string; credential_count: number }>;
  initialHostValidatedProtocols: Record<number, string[]>;
}

export function NetworkDetailClient({
  network: initialNetwork,
  initialHosts,
  routerId: initialRouterId,
  routers,
  initialCredentialIds,
  initialAvailableSources,
  initialHostValidatedProtocols,
}: NetworkDetailClientProps) {
  const router = useRouter();
  const [network, setNetwork] = useState(initialNetwork);
  const [routerId, setRouterId] = useState<number | null>(initialRouterId);
  const [hosts, setHosts] = useState<HostWithDevice[]>(initialHosts);
  const [cassettoId, setCassettoId] = useState<number | null>(null);
  const [scanning, setScanning] = useState<ScanProgressType | null>(null);
  const scanIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { giri, apri: apriGiro } = useGiri();
  // Ultimo giro di una sequenza a più fasi: chi chiude il pannello non se lo vede riaprire alla fase dopo.
  const ultimoGiroRef = useRef<string | null>(null);
  useEffect(() => {
    if (!scanning) ultimoGiroRef.current = null;
  }, [scanning]);

  // Cleanup interval on unmount per evitare memory leak
  useEffect(() => {
    return () => {
      if (scanIntervalRef.current) clearInterval(scanIntervalRef.current);
    };
  }, []);
  // Stato fasi di scansione + completezza attribuzione (§6.2/6.3, fase 3b)
  const [scanPhases, setScanPhases] = useState<ScanPhasesResponse | null>(null);
  const [scanPhasesRefreshKey, setScanPhasesRefreshKey] = useState(0);
  const [editOpen, setEditOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [view, setView] = useState<"grid" | "list">("list");
  const [autoRefreshInterval, setAutoRefreshInterval] = useState<number>(() => {
    if (typeof window === "undefined") return 0;
    const v = localStorage.getItem("daipam-auto-refresh-interval");
    return v ? Number(v) : 0;
  });
  const [autoScanPing, setAutoScanPing] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("daipam-auto-refresh-scan") === "1";
  });
  const [filterStatus, setFilterStatus] = useState<string>("");
  const [filterClassification, setFilterClassification] = useState<string>("");
  const [filterKnownOnly, setFilterKnownOnly] = useState(false);
  /** Filtri sì/no aggiunti il 12/11/2026. Dichiarati QUI, prima di `filteredHosts` che li legge: messi più sotto, la pagina
   *  cadeva a ogni resa («Cannot access before initialization», 0.9.1222 e 0.9.1223 su DTS) (Riccardo: «i filtri attivabili potrebbero essere di più»). */
  const [filterApparato, setFilterApparato] = useState(false);
  const [filterAd, setFilterAd] = useState(false);
  const [filterDhcp, setFilterDhcp] = useState(false);
  const [filterSistema, setFilterSistema] = useState<string>("");
  const [filterProduttore, setFilterProduttore] = useState<string>("");
  const [filterForma, setFilterForma] = useState<string>("");
  const [filterFunzione, setFilterFunzione] = useState<string>("");
  /** Le funzioni degli host della rete, lette a parte (`/api/hosts/funzioni`). */
  const [funzioniHost, setFunzioniHost] = useState<Record<number, FunzioneInRiga[]>>({});
  const caricaFunzioni = useCallback(async () => {
    try {
      const r = await fetch(`/api/hosts/funzioni?network_id=${network.id}`, { cache: "no-store" });
      if (r.ok) setFunzioniHost((await r.json()) as Record<number, FunzioneInRiga[]>);
    } catch {
      /* le funzioni sono un di più: senza, la lista resta com'è */
    }
  }, [network.id]);
  useEffect(() => { void caricaFunzioni(); }, [caricaFunzioni]);

  /** Mette, toglie o rende automatica una funzione, sulla riga o su tutte le righe spuntate se la riga è fra quelle. */
  async function cambiaFunzione(hostId: number, funzione: string, azione: "metti" | "togli" | "automatica") {
    const ids = hostDelMenu(selectedHostIds, hostId);
    try {
      const res = await fetch("/api/hosts/funzioni", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ host_ids: ids, funzione, azione }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(data.error ?? "Salvataggio non riuscito");
        return;
      }
      await caricaFunzioni();
      const su = ids.length > 1 ? ` su ${ids.length} host` : "";
      toast.success(azione === "metti" ? `Funzione messa${su}` : azione === "togli" ? `Funzione tolta${su}` : `Tornata automatica${su}`);
    } catch {
      toast.error("Errore di rete");
    }
  }
  const [listSortColumn, setListSortColumn] = useState<string | null>("ip");
  const [listSortDir, setListSortDir] = useState<SortDirection>("asc");
  const [editingHostId, setEditingHostId] = useState<number | null>(null);
  const [editingField, setEditingField] = useState<"custom_name" | "notes" | "classification" | null>(null);
  const [enriching, setEnriching] = useState(false);
  const [addDeviceCredentials, setAddDeviceCredentials] = useState<{ id: number; name: string; credential_type: string; port?: number | null }[]>([]);
  const [selectedHostIds, setSelectedHostIds] = useState<Set<number>>(new Set());
  const [bulkAddOpen, setBulkAddOpen] = useState(false);
  const [bulkHostBusy, setBulkHostBusy] = useState(false);
  // Tasto destro sulla lista (Riccardo, 08/11): filtri sul valore della cella e azioni pronte,
  // come in Discovery. La riga premuta fissa il bersaglio prima che il menu chieda di aprirsi.
  const [filtriValore, setFiltriValore] = useState<FiltroValore[]>([]);
  const bersaglioRef = useRef<{ host: HostWithDevice; colonna: string | null } | null>(null);
  const [menuRiga, setMenuRiga] = useState<{ host: HostWithDevice; colonna: string | null } | null>(null);
  const [categoriaOpen, setCategoriaOpen] = useState(false);
  // Lista unica delle credenziali della rete. Le quattro catene vecchie non si
  // leggono né si rimandano più (tappa 2 credenziali, T12): restano nel DB,
  // congelate, fino alla 2d.
  const [networkCredentialIds, setNetworkCredentialIds] = useState<number[]>(initialCredentialIds);
  const [availableSources, setAvailableSources] = useState(initialAvailableSources);
  const [hostValidatedProtocols, setHostValidatedProtocols] = useState<Record<number, string[]>>(initialHostValidatedProtocols);
  const [credDialogHost, setCredDialogHost] = useState<{ id: number; ip: string } | null>(null);


  useEffect(() => {
    setNetworkCredentialIds(initialCredentialIds);
  }, [initialCredentialIds]);

  useEffect(() => {
    setHostValidatedProtocols(initialHostValidatedProtocols);
  }, [initialHostValidatedProtocols]);

  useEffect(() => {
    fetch("/api/credentials")
      .then((r) => (r.ok ? r.json() : []))
      .then(setAddDeviceCredentials)
      .catch(() => setAddDeviceCredentials([]));
  }, []);

  const refreshCredentialsList = useCallback(async () => {
    try {
      const r = await fetch("/api/credentials");
      if (r.ok) {
        const data = (await r.json()) as { id: number; name: string; credential_type: string; port?: number | null }[];
        setAddDeviceCredentials(data);
      }
    } catch {
      /* ignore */
    }
  }, []);

  const refreshHosts = useCallback(async () => {
    try {
      const res = await fetch(`/api/networks/${network.id}`, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setHosts(data.hosts ?? []);
        setNetwork((n) => ({ ...n, ...data }));
        setRouterId(data.router_id ?? null);
        if (Array.isArray(data.network_credentials)) {
          setNetworkCredentialIds(data.network_credentials.map((c: { credential_id: number }) => c.credential_id));
        }
        if (data.host_validated_protocols) {
          setHostValidatedProtocols(data.host_validated_protocols);
        }
      }
    } catch { /* ignore */ }
  }, [network.id]);

  // Stato fasi di scansione + completezza attribuzione (§6.3): al mount e dopo
  // ogni scan completato (scanPhasesRefreshKey incrementato). Cleanup con
  // AbortController per evitare setState su fetch pendenti allo unmount.
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/networks/${network.id}/scan-phases`, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("fetch failed"))))
      .then((data: ScanPhasesResponse) => setScanPhases(data))
      .catch((err) => {
        if (err instanceof Error && err.name === "AbortError") return;
      });
    return () => controller.abort();
  }, [network.id, scanPhasesRefreshKey]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("daipam-auto-refresh-interval", String(autoRefreshInterval));
    }
  }, [autoRefreshInterval]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("daipam-auto-refresh-scan", autoScanPing ? "1" : "0");
    }
  }, [autoScanPing]);

  useEffect(() => {
    if (autoRefreshInterval <= 0) return;
    const ms = autoRefreshInterval * 1000;
    let scanCounter = 0;
    const tick = async () => {
      await refreshHosts();
      if (autoScanPing) {
        scanCounter++;
        if (scanCounter >= Math.max(1, Math.floor(120 / autoRefreshInterval))) {
          scanCounter = 0;
          try {
            await fetch("/api/scans/trigger", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ network_id: network.id, scan_type: "network_discovery" }),
            });
          } catch { /* ignore */ }
        }
      }
    };
    const id = setInterval(tick, ms);
    return () => clearInterval(id);
  }, [autoRefreshInterval, autoScanPing, network.id, refreshHosts]);

  // Dalla griglia: funzioni stabili (la griglia è `memo`, 256 celle), che chiamano l'ultima versione di quelle vere.
  const azioniGriglia = useRef<{ salva: (id: number, slug: string) => void; automatica: (id: number) => void }>({ salva: () => {}, automatica: () => {} });
  const categoriaDallaGriglia = useCallback((id: number, slug: string) => azioniGriglia.current.salva(id, slug), []);
  const automaticaDallaGriglia = useCallback((id: number) => azioniGriglia.current.automatica(id), []);
  useEffect(() => {
    azioniGriglia.current = {
      salva: (id, slug) => { void saveHostField(id, "classification", slug, (hosts.find((h) => h.id === id) as HostWithDevice | undefined)?.device_id); },
      automatica: (id) => { void tornaAutomaticaRiga(id); },
    };
  });

  /**
   * La categoria scelta dal menu di una riga vale per tutte le righe spuntate, se quella riga è fra le spuntate
   * (Riccardo, 11/11/2026: la scelta deve essere «l'applicazione per il gruppo scelto di una categoria comune»).
   * Stessa rotta della finestra «Assegna categoria…».
   */
  async function categoriaAiSelezionati(ids: number[], slug: string) {
    try {
      const res = await fetch("/api/hosts/bulk-update", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ host_ids: ids, classification: slug }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(data.error ?? "Salvataggio non riuscito");
        return;
      }
      await refreshHosts();
      toast.success(`${getClassificationLabel(slug)} su ${ids.length} host`);
    } catch {
      toast.error("Errore di rete");
    } finally {
      setEditingHostId(null);
      setEditingField(null);
    }
  }

  /** «Torna automatica» dal menu della riga: toglie la scelta a mano, poi rilegge gli host. */
  async function tornaAutomaticaRiga(hostId: number) {
    try {
      const res = await fetch("/api/classificazione/automatica", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hostId }),
      });
      if (!res.ok) {
        toast.error("Non sono riuscito a togliere la scelta a mano");
        return;
      }
      await refreshHosts();
      toast.success("Tornata automatica: decide il prossimo giro");
    } catch {
      toast.error("Errore di rete");
    } finally {
      setEditingHostId(null);
      setEditingField(null);
    }
  }

  async function saveHostField(hostId: number, field: "custom_name" | "notes" | "classification" | "known_host", value: string | number, deviceId?: number) {
    try {
      const payload =
        field === "known_host"
          ? { known_host: value as 0 | 1 }
          : { [field]: value };
      const res = await fetch(`/api/hosts/${hostId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const updated = await res.json();
        setHosts((prev) =>
          prev.map((h) =>
            h.id === hostId
              ? {
                  ...(updated as HostWithDevice),
                  device_id: (h as HostWithDevice).device_id,
                  device: (h as HostWithDevice).device,
                  ad_dns_host_name: (updated as HostWithDevice).ad_dns_host_name ?? (h as HostWithDevice).ad_dns_host_name,
                }
              : h
          )
        );
        if (field === "classification" && deviceId != null) {
          const patchRes = await fetch(`/api/devices/${deviceId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ classification: value }),
          });
          if (!patchRes.ok) toast.error("Host aggiornato, ma errore nell'aggiornamento del dispositivo");
        }
        toast.success("Salvato");
      } else {
        toast.error("Errore nel salvataggio");
      }
    } catch {
      toast.error("Errore nel salvataggio");
    } finally {
      setEditingHostId(null);
      setEditingField(null);
    }
  }

  const produttori = useMemo(() => produttoriTrovati(hosts), [hosts]);
  const filteredHosts = hosts.filter((h) => {
    if (filterStatus && h.status !== filterStatus) return false;
    if (filterClassification) {
      if (filterClassification === "__empty__") {
        if (h.classification) return false;
      } else if (!passaFiltroCategoria(filterClassification, h.classification)) {
        return false;
      }
    }
    if (filterKnownOnly && !h.known_host) return false;
    if (filterApparato && !(h as HostWithDevice).device) return false;
    if (filterAd && !(h as HostWithDevice).ad_dns_host_name) return false;
    if (filterDhcp && h.ip_assignment !== "dynamic") return false;
    if (!passaFiltroSistema(filterSistema, h)) return false;
    if (!passaFiltroProduttore(filterProduttore, h.vendor)) return false;
    if (!passaFiltroForma(filterForma, h)) return false;
    if (filterFunzione && !(funzioniHost[h.id] ?? []).some((f) => f.funzione === filterFunzione)) return false;
    if (filtriValore.length > 0 && !passaFiltriValore(filtriValore, (c) => testoCellaSubnet(h, c))) return false;
    return true;
  });

  const [filtriAperti, setFiltriAperti] = useState(false);
  const cancellaFiltri = () => { setFilterStatus(""); setFilterClassification(""); setFilterKnownOnly(false); setFilterSistema(""); setFilterProduttore(""); setFilterForma(""); setFilterFunzione(""); setFilterApparato(false); setFilterAd(false); setFilterDhcp(false); };
  /** Le categorie madri presenti in questa rete, col numero di righe: un pulsante l'una. */
  const categorieMadri = useMemo(() => {
    const conta = new Map<string, number>();
    for (const h of hosts) {
      const g = getDeviceCategoryGroup(h.classification);
      conta.set(g, (conta.get(g) ?? 0) + 1);
    }
    const gruppoScelto = filterClassification.startsWith(PREFISSO_GRUPPO)
      ? filterClassification.slice(PREFISSO_GRUPPO.length)
      : filterClassification && filterClassification !== "__empty__" ? getDeviceCategoryGroup(filterClassification) : null;
    const madri = DEVICE_CATEGORY_GROUP_ORDER.filter((g) => (conta.get(g) ?? 0) > 0).map((g) => ({
      gruppo: g as string, titolo: DEVICE_CATEGORY_GROUP_LABELS[g], quanti: conta.get(g) ?? 0,
      valore: `${PREFISSO_GRUPPO}${g}`, attiva: gruppoScelto === g,
    }));
    const senza = conta.get("unknown") ?? 0;
    if (senza > 0) madri.push({ gruppo: "unknown", titolo: "Senza categoria", quanti: senza, valore: "__empty__", attiva: filterClassification === "__empty__" });
    return madri;
  }, [hosts, filterClassification]);
  /** La madre scelta (anche quando è scelta una sua figlia) e le sue classi presenti. */
  const madreScelta = categorieMadri.find((c) => c.attiva && c.gruppo !== "unknown")?.gruppo ?? null;
  const figlie = useMemo(() => (madreScelta ? figliePresenti(hosts, madreScelta) : []), [hosts, madreScelta]);
  /** I filtri accesi, come etichette che si tolgono una per una. */
  const filtriAttivi: Array<{ chiave: string; testo: string; togli: () => void }> = [];
  if (filterStatus) filtriAttivi.push({ chiave: "stato", testo: `Stato: ${filterStatus === "online" ? "online" : filterStatus === "offline" ? "offline" : "sconosciuto"}`, togli: () => setFilterStatus("") });
  if (filterClassification) {
    const testo = filterClassification === "__empty__" ? "Senza categoria"
      : filterClassification.startsWith(PREFISSO_GRUPPO)
        ? (DEVICE_CATEGORY_GROUP_LABELS as Record<string, string>)[filterClassification.slice(PREFISSO_GRUPPO.length)] ?? filterClassification
        : getClassificationLabel(filterClassification);
    filtriAttivi.push({ chiave: "categoria", testo: `Categoria: ${testo}`, togli: () => setFilterClassification("") });
  }
  if (filterSistema) filtriAttivi.push({ chiave: "sistema", testo: `Sistema: ${filterSistema === SISTEMA_IGNOTO ? "non si sa" : SISTEMI.find((x) => x.valore === filterSistema)?.etichetta ?? filterSistema}`, togli: () => setFilterSistema("") });
  if (filterProduttore) filtriAttivi.push({ chiave: "produttore", testo: `Produttore: ${filterProduttore === PRODUTTORE_IGNOTO ? "non si sa" : filterProduttore}`, togli: () => setFilterProduttore("") });
  if (filterForma) filtriAttivi.push({ chiave: "forma", testo: filterForma === FORMA_IGNOTA ? "Fisico o virtuale: non si sa" : FORME.find((x) => x.valore === filterForma)?.etichetta ?? filterForma, togli: () => setFilterForma("") });
  if (filterFunzione) filtriAttivi.push({ chiave: "funzione", testo: `Funzione: ${etichettaFunzione(filterFunzione)}`, togli: () => setFilterFunzione("") });
  if (filterKnownOnly) filtriAttivi.push({ chiave: "conosciuti", testo: "Solo conosciuti", togli: () => setFilterKnownOnly(false) });
  if (filterApparato) filtriAttivi.push({ chiave: "apparato", testo: "È un apparato", togli: () => setFilterApparato(false) });
  if (filterAd) filtriAttivi.push({ chiave: "ad", testo: "In Active Directory", togli: () => setFilterAd(false) });
  if (filterDhcp) filtriAttivi.push({ chiave: "dhcp", testo: "Indirizzo da DHCP", togli: () => setFilterDhcp(false) });

  const displayHosts = useMemo(() => {
    if (!listSortColumn) return filteredHosts;
    const getVal = (h: HostWithDevice): unknown => {
      switch (listSortColumn) {
        case "ip":
          return h.ip;
        case "status":
          return h.status;
        case "name":
          return h.custom_name || h.hostname || "";
        case "classification":
          return h.classification || "";
        case "vendor":
          return h.vendor || "";
        default:
          return "";
      }
    };
    return [...filteredHosts].sort((a, b) => compareUnknown(getVal(a), getVal(b), listSortDir));
  }, [filteredHosts, listSortColumn, listSortDir]);

  const handleListSort = useCallback(
    (columnId: string) => {
      if (listSortColumn === columnId) {
        setListSortDir((d) => (d === "asc" ? "desc" : "asc"));
      } else {
        setListSortColumn(columnId);
        setListSortDir("asc");
      }
    },
    [listSortColumn]
  );

  const toggleSelectHost = (id: number) => {
    setSelectedHostIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAllHosts = () => {
    if (selectedHostIds.size === displayHosts.length) {
      setSelectedHostIds(new Set());
    } else {
      setSelectedHostIds(new Set(displayHosts.map((h) => h.id)));
    }
  };

  const clearHostSelection = () => setSelectedHostIds(new Set());

  /** «Rendi apparato» sugli host scelti: la finestra unica propone, prova le credenziali e crea (tappa 3). */
  function apriAggiungiDispositivi() {
    setBulkAddOpen(true);
  }

  async function handleBulkKnown(known: 0 | 1, ids: number[] = Array.from(selectedHostIds)) {
    if (ids.length === 0) return;
    const n = ids.length;
    const msg =
      known === 1
        ? `Segnare ${n} host come conosciuti (monitoraggio continuo)?`
        : `Rimuovere ${n} host dall'elenco conosciuti?`;
    if (!confirm(msg)) return;
    setBulkHostBusy(true);
    try {
      const res = await fetch("/api/hosts/bulk", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          network_id: network.id,
          host_ids: ids,
          known_host: known,
        }),
      });
      const data = (await res.json()) as { error?: string; updated?: number };
      if (res.ok) {
        toast.success(known === 1 ? "Host segnati come conosciuti" : "Flag conosciuto rimosso");
        clearHostSelection();
        await refreshHosts();
        router.refresh();
      } else {
        toast.error(data.error || "Errore");
      }
    } catch {
      toast.error("Errore di rete");
    } finally {
      setBulkHostBusy(false);
    }
  }

  async function handleBulkDeleteHosts(ids: number[] = Array.from(selectedHostIds)) {
    if (ids.length === 0) return;
    const n = ids.length;
    if (!confirm(`Eliminare definitivamente ${n} host dall'inventario IP? Azione irreversibile.`)) return;
    setBulkHostBusy(true);
    try {
      const res = await fetch("/api/hosts/bulk", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          network_id: network.id,
          host_ids: ids,
        }),
      });
      const data = (await res.json()) as { error?: string; deleted?: number };
      if (res.ok) {
        toast.success(data.deleted != null ? `${data.deleted} host eliminati` : "Host eliminati");
        clearHostSelection();
        await refreshHosts();
        router.refresh();
      } else {
        toast.error(data.error || "Errore");
      }
    } catch {
      toast.error("Errore di rete");
    } finally {
      setBulkHostBusy(false);
    }
  }

  /** Tasto destro su una riga: la cella premuta dà la colonna; nelle caselle di testo resta il menu del browser. */
  function puntaMenu(e: React.MouseEvent<HTMLTableRowElement>, host: HostWithDevice) {
    const t = e.target;
    if (t instanceof Element && t.closest("input, textarea, select, [contenteditable=true]")) {
      e.stopPropagation();
      bersaglioRef.current = null;
      return;
    }
    const cella = t instanceof Element ? t.closest("td") : null;
    bersaglioRef.current = { host, colonna: cella ? colonnaDaIndice((cella as HTMLTableCellElement).cellIndex) : null };
  }

  /** Le azioni del menu valgono sulla selezione se la riga ne fa parte, altrimenti sulla riga sola. */
  function selezionaPerMenu(host: HostWithDevice): number[] {
    const ids = hostDelMenu(selectedHostIds, host.id);
    if (!selectedHostIds.has(host.id)) setSelectedHostIds(new Set(ids));
    return ids;
  }

  function menuTastoDestro({ host, colonna }: { host: HostWithDevice; colonna: string | null }) {
    const n = hostDelMenu(selectedHostIds, host.id).length;
    const valore = colonna ? testoCellaSubnet(host, colonna) : "";
    const nome = nomeHost(host);
    return (
      <>
        <ContextMenuLabel className="max-w-72 truncate">
          {n > 1 ? `${n} host selezionati` : nome ? `${nome} · ${host.ip}` : host.ip}
        </ContextMenuLabel>
        <ContextMenuSeparator />
        {colonna && (
          <>
            <ContextMenuLabel className="max-w-72 truncate" title={valore}>
              {etichettaColonnaSubnet(colonna)}: <span className="font-mono text-foreground">{valoreLeggibile(valore)}</span>
            </ContextMenuLabel>
            <ContextMenuItem onClick={() => setFiltriValore((f) => aggiungiFiltroValore(f, { colonna, valore, escludi: false }))}>
              <Filter className="h-3.5 w-3.5" />
              Mostra solo questo valore
            </ContextMenuItem>
            <ContextMenuItem onClick={() => setFiltriValore((f) => aggiungiFiltroValore(f, { colonna, valore, escludi: true }))}>
              <EyeOff className="h-3.5 w-3.5" />
              Nascondi questo valore
            </ContextMenuItem>
            {valore.trim() !== "" && (
              <ContextMenuItem
                onClick={() => {
                  void navigator.clipboard?.writeText(valore)
                    .then(() => toast.success("Copiato"))
                    .catch(() => toast.error("Il browser non permette di copiare"));
                }}
              >
                <Copy className="h-3.5 w-3.5" />
                Copia il valore
              </ContextMenuItem>
            )}
            <ContextMenuSeparator />
          </>
        )}
        <ContextMenuItem onClick={() => { selezionaPerMenu(host); setCategoriaOpen(true); }}>
          <Tag className="h-3.5 w-3.5" />
          {n > 1 ? `Categoria ai ${n} selezionati…` : "Categoria…"}
        </ContextMenuItem>
        <ContextMenuItem onClick={() => { selezionaPerMenu(host); apriAggiungiDispositivi(); }}>
          <Plus className="h-3.5 w-3.5" />
          Rendi apparato
        </ContextMenuItem>
        <ContextMenuItem onClick={() => void handleBulkKnown(1, selezionaPerMenu(host))}>
          <UserCheck className="h-3.5 w-3.5" />
          Conosciuti
        </ContextMenuItem>
        <ContextMenuItem onClick={() => void handleBulkKnown(0, selezionaPerMenu(host))}>
          <UserX className="h-3.5 w-3.5" />
          Rimuovi noti
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onClick={() => void handleBulkDeleteHosts(selezionaPerMenu(host))}>
          <Trash2 className="h-3.5 w-3.5" />
          {n > 1 ? `Elimina ${n}…` : "Elimina…"}
        </ContextMenuItem>
      </>
    );
  }

  /**
   * Dopo l'assegnazione (o il cambio) del router ARP di una rete:
   *  1. verifica reachability + credenziali del router (GET /api/devices/[id]/test);
   *  2. se raggiungibile, scarica subito ARP + DHCP (scan_enrich) senza attendere una scan.
   * Mostra il feedback all'utente via toast. Non blocca il salvataggio della rete.
   */
  async function testAndFetchRouter(routerId: number) {
    const tId = toast.loading("Verifico raggiungibilità del router…");
    try {
      const testRes = await fetch(`/api/devices/${routerId}/test`);
      const testData = await testRes.json().catch(() => ({}));
      if (!testData?.success) {
        toast.error(
          `Router non raggiungibile: ${testData?.error || testData?.message || "verifica credenziali e connettività"}`,
          { id: tId }
        );
        return;
      }
      toast.loading("Router OK — scarico ARP/DHCP…", { id: tId });
      const enrichRes = await fetch("/api/scans/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ network_id: network.id, scan_type: "scan_enrich" }),
      });
      const enrichData = await enrichRes.json().catch(() => ({}));
      if (enrichRes.ok && enrichData?.progress?.status !== "failed") {
        toast.success(`Router verificato. ${enrichData?.progress?.phase ?? "ARP/DHCP scaricati"}`, { id: tId });
        await refreshHosts();
        router.refresh();
      } else {
        toast.error(`Router OK ma fetch ARP/DHCP fallito: ${enrichData?.error || enrichData?.progress?.phase || "errore"}`, { id: tId });
      }
    } catch {
      toast.error("Errore durante la verifica del router", { id: tId });
    }
  }

  async function handleSaveEdit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    const form = e.currentTarget;
    const prevRouterId = routerId;
    const body = {
      cidr: (form.elements.namedItem("cidr") as HTMLInputElement).value.trim(),
      name: (form.elements.namedItem("name") as HTMLInputElement).value,
      description: (form.elements.namedItem("description") as HTMLInputElement).value || "",
      gateway: (form.elements.namedItem("gateway") as HTMLInputElement).value?.trim() || null,
      vlan_id: (form.elements.namedItem("vlan_id") as HTMLInputElement).value ? Number((form.elements.namedItem("vlan_id") as HTMLInputElement).value) : null,
      location: (form.elements.namedItem("location") as HTMLInputElement).value || "",
      snmp_community: (form.elements.namedItem("snmp_community") as HTMLInputElement).value?.trim() || null,
      dns_server: (form.elements.namedItem("dns_server") as HTMLInputElement).value?.trim() || null,
      router_id: (form.elements.namedItem("router_id") as HTMLSelectElement).value ? Number((form.elements.namedItem("router_id") as HTMLSelectElement).value) : null,
      // Un PUT solo, con la lista: rete e credenziali si salvano insieme o per
      // niente. Prima la lista partiva in una seconda richiesta che ingoiava
      // gli errori, e le catene vecchie nascoste tornavano indietro col PUT.
      credential_ids: networkCredentialIds,
    };
    try {
      const res = await fetch(`/api/networks/${network.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const updated = await res.json();
        setNetwork((n) => ({ ...n, ...updated }));
        setRouterId(updated.router_id ?? null);
        if (Array.isArray(updated.credential_ids)) setNetworkCredentialIds(updated.credential_ids);
        setEditOpen(false);
        toast.success("Rete aggiornata");
        router.refresh();
        // Se è stato assegnato/cambiato un router ARP, verifica subito reachability
        // e scarica ARP/DHCP (in background, non blocca la chiusura del dialog).
        const newRouterId = updated.router_id ?? null;
        if (newRouterId && newRouterId !== prevRouterId) {
          void testAndFetchRouter(newRouterId);
        }
      } else {
        const data = await res.json();
        toast.error(data.error || "Errore nell'aggiornamento");
      }
    } catch {
      toast.error("Errore nell'aggiornamento");
    } finally {
      setSaving(false);
    }
  }

  type ScanJobType =
    | "fast"
    | "network_discovery"
    | "snmp"
    | "nmap"
    | "windows"
    | "ssh"
    | "credential_validate"
    | "scan_icmp"
    | "scan_nmap_base"
    | "scan_snmp_verify"
    | "scan_naabu"
    | "scan_full";

  const SCAN_LABELS: Record<ScanJobType, string> = {
    fast: "Scansione veloce",
    network_discovery: "Scoperta rete",
    snmp: "SNMP",
    nmap: "Nmap",
    windows: "WinRM (Windows)",
    ssh: "SSH (Linux)",
    credential_validate: "Validazione credenziali",
    scan_icmp: "ICMP",
    scan_nmap_base: "Nmap base",
    scan_snmp_verify: "SNMP verify",
    scan_naabu: "Naabu",
    scan_full: "Scan completo",
  };

  async function runScanJob(
    scanType: ScanJobType,
    options?: { showStartToast?: boolean; refreshOnComplete?: boolean }
  ): Promise<{ ok: boolean; lastProgress: ScanProgressType | null }> {
    const showStartToast = options?.showStartToast !== false;
    const refreshOnComplete = options?.refreshOnComplete !== false;

    const noHostSelectionNeeded =
      scanType === "network_discovery" ||
      scanType === "fast" ||
      scanType === "scan_full" ||
      scanType === "scan_icmp" ||
      scanType === "scan_nmap_base" ||
      scanType === "scan_snmp_verify" ||
      scanType === "scan_naabu";
    // credential_validate NON è qui di proposito: ogni tentativo è un logon fallito reale (allarmi MDR/XDR, lockout AD) → solo host selezionati.
    if (!noHostSelectionNeeded && selectedHostIds.size === 0) {
      toast.error("Seleziona uno o più host nella vista lista (azioni manuali solo sugli IP selezionati)");
      return { ok: false, lastProgress: null };
    }
    const body: Record<string, unknown> = {
      network_id: network.id,
      scan_type: scanType,
    };
    if (!noHostSelectionNeeded && selectedHostIds.size > 0) {
      body.host_ids = Array.from(selectedHostIds);
    }

    const res = await fetch("/api/scans/trigger", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      // 409: sulla rete c'è già un giro in corso (T3-18); il server manda il messaggio pronto.
      const errore = res.status === 409
        ? await res.json().then((d: { error?: unknown }) => (typeof d.error === "string" ? d.error : null)).catch(() => null)
        : null;
      toast.error(errore ?? "Errore nell'avvio della scansione");
      return { ok: false, lastProgress: null };
    }

    const data = (await res.json()) as { id: string; progress: ScanProgressType };
    if (showStartToast) {
      toast.success(`Scansione ${SCAN_LABELS[scanType]} avviata`);
    }
    setScanning(data.progress);
    apriPannello(data.id);

    return await seguiGiro(data.id, refreshOnComplete);
  }

  function apriPannello(jobId: string) {
    apriGiro(jobId, { dopo: ultimoGiroRef.current });
    ultimoGiroRef.current = jobId;
  }

  /**
   * Segue un giro già avviato sul server fino a «completed» o «failed».
   *
   * Estratta da `runScanJob` (04/11/2026) perché la usa anche `runProfilo`:
   * duplicare il poller significherebbe correggere due volte il caso dei 404.
   */
  async function seguiGiro(
    jobId: string,
    refreshOnComplete: boolean
  ): Promise<{ ok: boolean; lastProgress: ScanProgressType | null }> {
    if (scanIntervalRef.current) clearInterval(scanIntervalRef.current);
    return await new Promise((resolve) => {
      // R4 2026-06-23: il progress vive in una mappa in-memory persa al restart
      // del processo → dopo un restart la GET dà 404 e il poller girava all'INFINITO
      // (lo spinner "scansione in corso" non si risolveva mai). Contiamo i 404
      // consecutivi e terminiamo dopo qualche tentativo.
      let notFoundCount = 0;
      const interval = setInterval(() => {
        void (async () => {
          try {
            const progressRes = await fetch(`/api/scans/progress/${jobId}`);
            if (progressRes.ok) {
              notFoundCount = 0;
              const progress = (await progressRes.json()) as ScanProgressType;
              setScanning(progress);
              if (progress.status === "completed" || progress.status === "failed") {
                clearInterval(interval);
                scanIntervalRef.current = null;
                if (refreshOnComplete) {
                  refreshHosts();
                  router.refresh();
                  setScanPhasesRefreshKey((k) => k + 1);
                }
                resolve({
                  ok: progress.status === "completed",
                  lastProgress: progress,
                });
              }
            } else if (++notFoundCount >= 5) {
              // progress non più disponibile (restart) → termina invece di pollare all'infinito
              clearInterval(interval);
              scanIntervalRef.current = null;
              setScanning(null);
              resolve({ ok: false, lastProgress: null });
            }
          } catch {
            clearInterval(interval);
            scanIntervalRef.current = null;
            setScanning(null);
            resolve({ ok: false, lastProgress: null });
          }
        })();
      }, 1000);
      scanIntervalRef.current = interval;
    });
  }

  async function triggerScan(scanType: ScanJobType) {
    await runScanJob(scanType);
    setScanning(null);
  }

  /**
   * "Scansione iniziale" (§6.2, Blocco A): unico ingresso, percorso deciso
   * client-side da naabuAvailable (letto da scan-phases). Mai chiedere
   * all'utente quale percorso — naabu se disponibile, altrimenti ICMP → Nmap
   * base in sequenza. Toast finale col percorso effettivo.
   */
  async function runInitialScan() {
    if (!!scanning || enriching) return;
    let naabuAvailable = scanPhases?.naabuAvailable ?? false;
    if (!scanPhases) {
      // scan-phases non ancora risolto (mount fetch in corso/fallito): un
      // tentativo sincrono qui evita di sottostimare naabu col fallback
      // ICMP+Nmap quando naabu è in realtà disponibile. Se fallisce, resta
      // il fallback attuale (naabuAvailable = false).
      try {
        const res = await fetch(`/api/networks/${network.id}/scan-phases`);
        if (res.ok) {
          const data = (await res.json()) as ScanPhasesResponse;
          naabuAvailable = data.naabuAvailable;
          setScanPhases(data);
        }
      } catch {
        /* fallback al percorso ICMP + Nmap sotto */
      }
    }
    if (naabuAvailable) {
      const { ok } = await runScanJob("scan_naabu");
      if (ok) toast.success("Percorso: ICMP + Naabu");
    } else {
      await runSequenza("scoperta");
    }
    setScanning(null);
  }

  // scan_enrich non passa per discoverNetwork: chiama l'endpoint dedicato che
  // esegue ARP + DHCP + DNS + AD relink. Con fresh_sync=true esegue prima un
  // sync LDAP fresco (più lento, ma utile se la cache AD è obsoleta).
  async function triggerEnrich(freshSync = false) {
    setEnriching(true);
    try {
      const res = await fetch("/api/scans/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ network_id: network.id, scan_type: "scan_enrich", fresh_sync: freshSync }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(data.progress?.phase ?? "Enrich completato");
        await refreshHosts();
        router.refresh();
        setScanPhasesRefreshKey((k) => k + 1);
      } else {
        toast.error(data.error || "Errore enrich");
      }
    } catch {
      toast.error("Errore di rete");
    } finally {
      setEnriching(false);
    }
  }

  /**
   * «Avanzata» (testata semplificata, 20/10). Senza selezione: la sequenza della
   * subnet lato server (scan_full: ping → Nmap -sV → SNMP → Enrich), un giro solo che
   * sopravvive alla chiusura della pagina. Con host selezionati: Nmap profilo completo
   * poi SNMP deep su quegli host (ex «Nmap adv» + «SNMP deep»).
   */
  async function runAdvanced() {
    if (!hostScope) {
      await runScanJob("scan_full");
      setScanning(null);
      return;
    }
    await runSequenza("avanzata");
  }

  /**
   * Sequenza a più fasi sul server (05/11): gira anche a pagina chiusa, qui si segue e basta. L'esito
   * lo scrive il server; un giro fermato a mano non è un errore.
   */
  async function runSequenza(sequenza: "scoperta" | "avanzata" | "accesso") {
    try {
      const res = await fetch("/api/scans/sequenza", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          network_id: network.id,
          sequenza,
          // La scoperta guarda tutta la subnet: una selezione nella lista non la restringe.
          ...(sequenza !== "scoperta" ? { host_ids: Array.from(selectedHostIds) } : {}),
        }),
      });
      if (!res.ok) {
        const errore = await res
          .json()
          .then((d: { error?: unknown }) => (typeof d.error === "string" ? d.error : null))
          .catch(() => null);
        toast.error(errore ?? "Errore nell'avvio della sequenza");
        return;
      }
      const data = (await res.json()) as { id: string; progress: ScanProgressType };
      setScanning(data.progress);
      apriPannello(data.id);
      const esito = await seguiGiro(data.id, true);
      if (esito.ok) toast.success(esito.lastProgress?.phase ?? "Sequenza completata");
      else if (esito.lastProgress?.error && !esito.lastProgress.fermato) toast.error(esito.lastProgress.error);
    } catch {
      toast.error("Errore di rete");
    } finally {
      setScanning(null);
    }
  }

  /**
   * «Profilo» (04/11/2026): esegue un profilo di scansione sugli host SELEZIONATI.
   *
   * Solo selezione, come «Accesso agli host»: sono scansioni lunghe (OS
   * detection, probe di versione piene, una trentina di script NSE) e, col
   * profilo IoT/OT, pacchetti verso apparati di campo. Si scelgono nella lista.
   */
  async function runProfilo(profilo: "approfondito" | "iot_ot") {
    if (!hostScope) {
      toast.error("Seleziona gli host nella vista lista: un profilo gira solo sugli host scelti");
      return;
    }
    const nome = profilo === "approfondito" ? "Approfondito" : "IoT / OT";
    try {
      const res = await fetch("/api/scans/profilo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          network_id: network.id,
          profilo,
          host_ids: Array.from(selectedHostIds),
        }),
      });
      if (!res.ok) {
        const errore = await res
          .json()
          .then((d: { error?: unknown }) => (typeof d.error === "string" ? d.error : null))
          .catch(() => null);
        toast.error(errore ?? `Errore nell'avvio del profilo ${nome}`);
        return;
      }
      const data = (await res.json()) as { id: string; progress: ScanProgressType };
      toast.info(`Profilo ${nome} avviato su ${selectedHostIds.size} host`);
      setScanning(data.progress);
      apriPannello(data.id);
      const esito = await seguiGiro(data.id, true);
      /* La fase finale del server riassume rilievi, campi riempiti ed eventuali
       * avvisi (script mancanti, privilegi): si mostra quella, non un testo nostro. */
      if (esito.ok) toast.success(esito.lastProgress?.phase ?? `Profilo ${nome} completato`);
      else toast.error(esito.lastProgress?.error ?? `Profilo ${nome} terminato con errori`);
    } catch {
      toast.error("Errore di rete");
    } finally {
      setScanning(null);
    }
  }

  /**
   * «Accesso agli host» (testata semplificata, 20/10): un comando solo al posto di
   * «Credenziali» e «Rilevamento OS». Verifica le credenziali della rete (se ce ne
   * sono), poi WinRM, poi SSH, sugli host selezionati. Solo selezione: ogni
   * tentativo è un logon reale (allarmi MDR/XDR, lockout AD); ogni fase ha il suo
   * freno CredentialRunBudget lato server.
   */
  async function runHostAccess() {
    if (!hostScope) {
      toast.error("Seleziona gli host nella vista lista: l'accesso fa tentativi di login reali");
      return;
    }
    await runSequenza("accesso");
  }

  const onlineCount = hosts.filter((h) => h.status === "online").length;
  const offlineCount = hosts.filter((h) => h.status === "offline").length;

  // Portata dei comandi: host selezionati nella lista, altrimenti tutta la subnet.
  const hostScope = view === "list" && selectedHostIds.size > 0;
  // Il giro sulla rete può averlo avviato un'altra pagina o lo scheduler: i comandi si fermano lo stesso.
  const giroSullaRete = giri.some((g) => g.network_id === network.id && g.status === "running");
  const busy = !!scanning || enriching || giroSullaRete;

  // Giro non seguito da questa pagina (riaperta a metà, o dello scheduler): a fine giro i dati si rileggono qui.
  const reteOccupataRef = useRef(false);
  useEffect(() => {
    const finito = reteOccupataRef.current && !giroSullaRete && !scanning;
    reteOccupataRef.current = giroSullaRete;
    if (!finito) return;
    void refreshHosts();
    router.refresh();
    setScanPhasesRefreshKey((k) => k + 1);
  }, [giroSullaRete, scanning, refreshHosts, router]);

  // Stato delle fasi successive alla "Scansione iniziale" (§6.2 Blocco A)
  const phaseInitial = scanPhases?.phases.find((p) => p.key === "initial") ?? null;
  const phaseNmapDeep = scanPhases?.phases.find((p) => p.key === "nmap_deep") ?? null;
  const phaseSnmp = scanPhases?.phases.find((p) => p.key === "snmp") ?? null;
  const phaseEnrich = scanPhases?.phases.find((p) => p.key === "enrich") ?? null;
  const phaseCredentials = scanPhases?.phases.find((p) => p.key === "credentials") ?? null;

  return (
    <div className="space-y-3">
      {/* Header: titolo compatto + azioni */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-1.5 flex-wrap min-h-8">
          <Link href="/networks">
            <Button variant="ghost" size="icon" className="size-7 shrink-0">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-lg font-bold tracking-tight leading-tight">{network.name}</h1>
              <Badge variant="secondary" className="font-mono text-xs py-0">{network.cidr}</Badge>
              {/* Contatori accanto al titolo (testata compatta, 20/10) */}
              <span className="text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">{hosts.length}</span> host
                {" · "}<span className="font-semibold text-success">● {onlineCount}</span> online
                {" · "}<span className="font-semibold text-destructive">○ {offlineCount}</span> offline
                {" · "}GW <span className="font-mono font-semibold text-foreground">{network.gateway || "—"}</span>
                {[
                  routerId && `Router ${routers.find((r) => r.id === routerId)?.name ?? routerId}`,
                  network.snmp_community && `SNMP ${network.snmp_community}`,
                  network.dns_server && `DNS ${network.dns_server}`,
                ].filter(Boolean).map((t) => ` · ${t}`).join("")}
              </span>
            </div>
            {network.description && (
              <p className="text-muted-foreground text-xs leading-snug line-clamp-1 mt-0.5" title={network.description}>
                {network.description}
              </p>
            )}
          </div>
          <div className="flex gap-1 flex-wrap items-center shrink-0">
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={<Link href="/network-changes" />}
            >
              Network Changes
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => { window.location.href = `/api/export?network_id=${network.id}`; }}
            >
              <Download className="h-4 w-4 mr-2" />
              CSV
            </Button>
            <Dialog open={editOpen} onOpenChange={(open) => { setEditOpen(open); if (open) void refreshCredentialsList(); }}>
              <DialogTrigger render={<Button variant="outline" size="sm" />}>
                <Pencil className="h-4 w-4 mr-2" />
                Modifica
              </DialogTrigger>
              <DialogContent className={DIALOG_PANEL_WIDE_CLASS}>
                <DialogHeader className="shrink-0 border-b border-border/50 px-4 pt-4 pb-3">
                  <DialogTitle>Modifica Rete</DialogTitle>
                </DialogHeader>
                <DialogScrollableArea className="px-4 py-3">
                <form onSubmit={handleSaveEdit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="edit-cidr">Rete (IP/Subnet)</Label>
                  <Input id="edit-cidr" name="cidr" defaultValue={network.cidr} placeholder="192.168.1.0/24" required className="font-mono" />
                  <p className="text-xs text-muted-foreground">Es. 192.168.1.0/24</p>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="edit-name">Nome</Label>
                    <Input id="edit-name" name="name" defaultValue={network.name} required />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-gateway">Gateway</Label>
                    <Input id="edit-gateway" name="gateway" defaultValue={network.gateway || ""} placeholder="192.168.1.1" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-description">Descrizione</Label>
                  <Input id="edit-description" name="description" defaultValue={network.description || ""} />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="edit-vlan">VLAN ID</Label>
                    <Input id="edit-vlan" name="vlan_id" type="number" defaultValue={network.vlan_id || ""} placeholder="100" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-location">Posizione</Label>
                    <Input id="edit-location" name="location" defaultValue={network.location || ""} />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-dns">Server DNS</Label>
                  <Input id="edit-dns" name="dns_server" defaultValue={network.dns_server || ""} placeholder="192.168.1.1" className="font-mono" />
                  <p className="text-xs text-muted-foreground">DNS per forward/reverse lookup di questa rete. Vuoto = DNS di sistema</p>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="edit-snmp">Community SNMP (default)</Label>
                    <Input id="edit-snmp" name="snmp_community" defaultValue={network.snmp_community || ""} placeholder="es. public, privata" className="font-mono" />
                    <p className="text-xs text-muted-foreground">Usata per scansioni nmap su questa rete se il profilo non ne specifica una</p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-router">Router ARP (default)</Label>
                    <select
                      id="edit-router"
                      name="router_id"
                      defaultValue={routerId ? String(routerId) : ""}
                      className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
                    >
                      <option value="">Nessuno</option>
                      {routers.map((r) => (
                        <option key={r.id} value={r.id}>{r.name} ({r.host})</option>
                      ))}
                    </select>
                    <p className="text-xs text-muted-foreground">Router per acquisizione tabella ARP di questa subnet</p>
                  </div>
                </div>
                <NetworkCredentialsTable
                  credentials={addDeviceCredentials}
                  credentialIds={networkCredentialIds}
                  onCredentialIdsChange={setNetworkCredentialIds}
                  onCredentialsRefresh={refreshCredentialsList}
                  networkId={network.id}
                  availableSources={availableSources}
                />
                <Button type="submit" className="w-full" disabled={saving}>
                  {saving ? "Salvataggio..." : "Salva"}
                </Button>
                </form>
                </DialogScrollableArea>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Testata delle scansioni (semplificata il 20/10): quattro comandi invece di dodici.
            La portata la decide la selezione — nessun host selezionato = subnet, altrimenti
            gli host selezionati — e le ore dell'ultima esecuzione stanno nei menu. */}
        <div className="space-y-2">
          <div className="rounded-lg border bg-card p-1.5 flex flex-wrap items-center gap-1.5">
            <Button
              size="default"
              variant="default"
              className={ACTION_BTN}
              onClick={() => void runInitialScan()}
              disabled={busy}
              title={`Trova gli host attivi su tutta la subnet: Naabu se disponibile (Impostazioni → Scansione), altrimenti ICMP + Nmap quick. ${phaseWhen(phaseInitial)}`}
            >
              {scanning || giroSullaRete ? (
                <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin shrink-0" />
              ) : (
                <Radar className="h-3.5 w-3.5 mr-1 shrink-0" />
              )}
              Scoperta host
            </Button>

            <div className="flex items-center">
              <Button
                size="default"
                variant="outline"
                className={cn(ACTION_BTN, "bg-background/90 rounded-r-none")}
                onClick={() => void runAdvanced()}
                disabled={busy}
                title={
                  hostScope
                    ? `Porte e servizi (Nmap profilo completo) poi SNMP deep sui ${selectedHostIds.size} host selezionati`
                    : "Tutte le fasi avanzate sulla subnet: ping, porte e servizi (Nmap -sV), SNMP, Enrich (ARP/DHCP/AD)"
                }
              >
                <Scan className="h-3.5 w-3.5 mr-1 shrink-0" />
                {hostScope ? `Avanzata · ${selectedHostIds.size} host` : "Avanzata"}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      size="default"
                      variant="outline"
                      className={cn(ACTION_BTN, "bg-background/90 rounded-l-none border-l-0 px-1.5")}
                      disabled={busy}
                      aria-label="Fasi singole della scansione avanzata"
                    >
                      <ChevronDown className="h-3.5 w-3.5" />
                    </Button>
                  }
                />
                <DropdownMenuContent align="start" className="w-auto min-w-64">
                  {hostScope ? (
                    <DropdownMenuGroup>
                      <DropdownMenuLabel>Sui {selectedHostIds.size} host selezionati</DropdownMenuLabel>
                      <DropdownMenuItem onClick={() => void triggerScan("nmap")}>
                        Porte e servizi
                        <span className="ml-auto pl-4 text-xs text-muted-foreground">Nmap profilo completo</span>
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => void triggerScan("snmp")}>
                        SNMP deep
                        <span className="ml-auto pl-4 text-xs text-muted-foreground">modello, firmware, seriale</span>
                      </DropdownMenuItem>
                    </DropdownMenuGroup>
                  ) : (
                    <DropdownMenuGroup>
                      <DropdownMenuLabel>Su tutta la subnet</DropdownMenuLabel>
                      <PhaseMenuItem label="Porte e servizi" phase={phaseNmapDeep} onClick={() => void triggerScan("scan_nmap_base")} />
                      <PhaseMenuItem label="SNMP" phase={phaseSnmp} onClick={() => void triggerScan("scan_snmp_verify")} />
                      <PhaseMenuItem label="Enrich (ARP/DHCP/AD)" phase={phaseEnrich} onClick={() => void triggerEnrich(true)} />
                    </DropdownMenuGroup>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    size="default"
                    variant="outline"
                    className={cn(ACTION_BTN, "bg-background/90")}
                    disabled={busy || !hostScope}
                    title={
                      hostScope
                        ? `Profilo di scansione sui ${selectedHostIds.size} host selezionati: riconoscimento del sistema operativo, probe di versione piene e script NSE di sola lettura`
                        : "Seleziona gli host nella vista lista: un profilo gira solo sugli host scelti"
                    }
                  >
                    <Microscope className="h-3.5 w-3.5 mr-1 shrink-0" />
                    {hostScope ? `Profilo · ${selectedHostIds.size} host` : "Profilo"}
                    <ChevronDown className="h-3.5 w-3.5 ml-1 shrink-0" />
                  </Button>
                }
              />
              <DropdownMenuContent align="start" className="w-auto min-w-80">
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Sui {selectedHostIds.size} host selezionati</DropdownMenuLabel>
                  <DropdownMenuItem onClick={() => void runProfilo("approfondito")}>
                    Approfondito
                    <span className="ml-auto pl-4 text-xs text-muted-foreground">
                      sistema operativo, certificati, NetBIOS, chiavi SSH
                    </span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => void runProfilo("iot_ot")}>
                    IoT / OT
                    <span className="ml-auto pl-4 text-xs text-muted-foreground">
                      Modbus, S7, EtherNet/IP, BACnet, MQTT
                    </span>
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>

            <Button
              size="default"
              variant="outline"
              className={cn(ACTION_BTN, "bg-background/90")}
              onClick={() => void runHostAccess()}
              disabled={busy || !hostScope}
              title={
                hostScope
                  ? `Login sui ${selectedHostIds.size} host selezionati: ${networkCredentialIds.length > 0 ? "verifica credenziali, poi " : ""}WinRM (Windows) e SSH (Linux). ${phaseWhen(phaseCredentials)}`
                  : "Seleziona gli host nella vista lista: l'accesso fa tentativi di login reali (allarmi MDR/XDR, rischio lockout AD)"
              }
            >
              <Key className="h-3.5 w-3.5 mr-1 shrink-0" />
              {hostScope ? `Accedi a ${selectedHostIds.size} host` : "Accesso agli host"}
            </Button>

            {/* Un modo solo per la classificazione (Riccardo, 12/11/2026): il pulsante apre la pagina «Attribuzione»
                ristretta a questa rete; le righe con fonti in disaccordo si aprono da lì. */}
            <Link
              href={`/controllo-classificazione?rete=${network.id}`}
              className={cn(buttonVariants({ variant: "outline", size: "default" }), ACTION_BTN, "bg-background/90")}
              title={
                scanPhases
                  ? `Controlla e correggi la classificazione di questa rete. Oggi: ${scanPhases.attribution.level2} host con categoria precisa, ${scanPhases.attribution.level1} con la sola famiglia, ${scanPhases.attribution.none} senza, su ${scanPhases.attribution.total}`
                  : "Controlla e correggi la classificazione di questa rete"
              }
            >
              <Tags className="h-3.5 w-3.5 mr-1 shrink-0" />
              Attribuzione
              {scanPhases && (
                <span className="ml-1.5 tabular-nums text-muted-foreground">
                  {scanPhases.attribution.level2}/{scanPhases.attribution.total}
                </span>
              )}
            </Link>

            <SubnetScheduleCard networkId={network.id} />

            {/* VA Scan a parte: scansione invasiva dall'edge, con la sua pianificazione */}
            <div>
              <SubnetEdgeScanPanel networkId={network.id} disabled={busy} hosts={hosts} cidr={network.cidr} networkName={network.name} />
            </div>
            {/* Una barra sola divisa in aree (13/11/2026): a sinistra le azioni sulla rete, a destra filtri, conteggio e
                cambio di vista. Prima stavano su una riga loro, sotto. */}
            <div className="ml-auto flex min-w-0 items-center gap-2 border-l pl-3">
              {view === "list" && (
                <>
                  <Button variant="outline" size="sm" className="shrink-0" onClick={() => setFiltriAperti(true)}>
                    <Filter className="h-4 w-4 mr-1" />
                    Filtri{filtriAttivi.length > 0 ? ` · ${filtriAttivi.length}` : ""}
                  </Button>
                  <div className="flex items-center gap-1.5 min-w-0 overflow-x-auto">
                    {filtriAttivi.map((f) => (
                      <button
                        key={f.chiave}
                        type="button"
                        onClick={f.togli}
                        title="Togli questo filtro"
                        className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-primary/60 bg-primary/10 px-2 text-[13px] hover:bg-primary/20"
                      >
                        {f.testo}
                        <X className="h-3 w-3" />
                      </button>
                    ))}
                    {filtriAttivi.length > 1 && (
                      <Button variant="ghost" size="sm" className="shrink-0" onClick={cancellaFiltri}>Togli tutti</Button>
                    )}
                  </div>
                  <span className="ml-auto shrink-0 text-[13px] tabular-nums text-muted-foreground">
                    {filteredHosts.length === hosts.length ? `${hosts.length} righe` : `${filteredHosts.length} di ${hosts.length} righe`}
                  </span>
                </>
              )}
              <div className={cn("flex items-center gap-1 shrink-0", view !== "list" && "ml-auto")} role="group" aria-label="Visualizzazione">
                <Button variant={view === "list" ? "secondary" : "outline"} size="sm" aria-pressed={view === "list"} onClick={() => setView("list")}>
                  <List className="h-4 w-4 mr-1" />
                  Lista
                </Button>
                <Button variant={view === "grid" ? "secondary" : "outline"} size="sm" aria-pressed={view === "grid"} onClick={() => setView("grid")}>
                  <LayoutGrid className="h-4 w-4 mr-1" />
                  Griglia IP
                </Button>
              </div>
              <select
                id="auto-refresh"
                aria-label="Aggiornamento automatico della pagina"
                title="Aggiornamento automatico della pagina"
                value={autoRefreshInterval}
                onChange={(e) => setAutoRefreshInterval(Number(e.target.value))}
                className="h-8 shrink-0 rounded-md border border-input bg-background px-1.5 text-[13px]"
              >
                {REFRESH_INTERVALS.map((o) => (
                  <option key={o.value} value={o.value}>{o.value === 0 ? "Aggiorna: mai" : `Aggiorna: ${o.label}`}</option>
                ))}
              </select>
              {autoRefreshInterval > 0 && (
                <div className="flex items-center gap-1.5 shrink-0">
                  <Switch id="auto-scan" checked={autoScanPing} onCheckedChange={setAutoScanPing} />
                  <Label htmlFor="auto-scan" className="text-[13px] font-normal text-muted-foreground">Scoperta periodica</Label>
                </div>
              )}
            </div>
          </div>


          {/* Barra dei filtri compatta (Riccardo, 12/11/2026: «non usare tutto lo schermo per i filtri… un pannello che
              si apre a destra»; «i pulsanti diretti sono comodi»). Riga 1: «Filtri» apre il pannello, i filtri accesi sono
              etichette che si tolgono; riga 2: le categorie madri, un pulsante l'una; la barra delle azioni compare solo
              con righe spuntate. Via «Spunta le righe di tipo»: si filtra e si spunta la casella in testa. */}
          <div className="rounded-lg border border-border/80 bg-muted/10 px-2.5 py-2 space-y-2">
            {view === "list" && (
              <div className="flex items-center gap-1.5 overflow-x-auto" role="group" aria-label="Categoria">
                <Button variant={filterClassification === "" ? "default" : "outline"} size="sm" className="h-7 shrink-0" onClick={() => setFilterClassification("")}>
                  Tutte <span className="ml-1.5 tabular-nums opacity-70">{hosts.length}</span>
                </Button>
                {categorieMadri.map((c) => (
                  <Fragment key={c.gruppo}>
                    <Button
                      key={c.gruppo}
                      variant={c.attiva ? "default" : "outline"}
                      size="sm"
                      className="h-7 shrink-0"
                      title={`Tutta la categoria «${c.titolo}». Per una sola classe: Filtri → Classificazione`}
                      onClick={() => setFilterClassification(c.attiva ? "" : c.valore)}
                    >
                      {c.titolo} <span className="ml-1.5 tabular-nums opacity-70">{c.quanti}</span>
                    </Button>
                    {c.gruppo === madreScelta && figlie.map((f) => (
                  <Button
                    key={f.slug}
                    variant={filterClassification === f.slug ? "secondary" : "ghost"}
                    size="sm"
                    className="h-7 shrink-0 border border-dashed text-[13px]"
                    title={`Solo «${f.etichetta}»`}
                    onClick={() => setFilterClassification(filterClassification === f.slug ? `${PREFISSO_GRUPPO}${madreScelta}` : f.slug)}
                  >
                    › {f.etichetta} <span className="ml-1.5 tabular-nums opacity-70">{f.quanti}</span>
                  </Button>
                ))}
                  </Fragment>
                ))}
              </div>
            )}

            {view === "list" && selectedHostIds.size > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-primary/50 bg-primary/5 px-2 py-1.5">
                <span className="mr-1 text-[13px] font-semibold tabular-nums">{selectedHostIds.size} righe spuntate</span>
                    <Button
                      variant="default"
                      size="default"
                      className="font-medium"
                      onClick={apriAggiungiDispositivi}
                      disabled={selectedHostIds.size === 0 || bulkHostBusy}
                    >
                      <Plus className="h-4 w-4 mr-1.5 shrink-0" />
                      Rendi apparato
                    </Button>
                    <Button
                      variant={selectedHostIds.size > 0 ? "default" : "secondary"}
                      size="sm"
                      onClick={() => setCategoriaOpen(true)}
                      disabled={selectedHostIds.size === 0 || bulkHostBusy}
                      title={selectedHostIds.size === 0
                        ? "Spunta una o più righe: poi qui assegni a tutte la stessa categoria"
                        : "Assegna la stessa categoria a tutti gli host spuntati (anche dal tasto destro, o dalla cella Categoria di una riga spuntata)"}
                    >
                      <Tag className="h-3.5 w-3.5 mr-1" />
                      {selectedHostIds.size > 0 ? `Assegna categoria a ${selectedHostIds.size}…` : "Assegna categoria…"}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => void handleBulkKnown(1)}
                      disabled={selectedHostIds.size === 0 || bulkHostBusy}
                    >
                      <UserCheck className="h-3.5 w-3.5 mr-1" />
                      Conosciuti
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void handleBulkKnown(0)}
                      disabled={selectedHostIds.size === 0 || bulkHostBusy}
                    >
                      <UserX className="h-3.5 w-3.5 mr-1" />
                      Rimuovi noti
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => void handleBulkDeleteHosts()}
                      disabled={selectedHostIds.size === 0 || bulkHostBusy}
                    >
                      <Trash2 className="h-3.5 w-3.5 mr-1" />
                      Elimina
                    </Button>
                    <Button variant="ghost" size="icon-sm" className="size-8" onClick={clearHostSelection} disabled={selectedHostIds.size === 0} title="Deseleziona tutti">
                      <X className="h-3.5 w-3.5" />
                    </Button>
              </div>
            )}
          </div>

          <Sheet open={filtriAperti} onOpenChange={setFiltriAperti}>
            <SheetContent side="right" className="sm:max-w-sm overflow-y-auto" showCloseButton>
              <SheetHeader>
                <SheetTitle>Filtri</SheetTitle>
              </SheetHeader>
              <div className="flex flex-col gap-3 px-4 pb-4">
              <div className="flex flex-col gap-1">
                <Label className="text-[13px] text-muted-foreground">Stato</Label>
                <select
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value)}
                  className="h-8 rounded-md border border-input bg-background px-2 text-sm w-full"
                >
                  <option value="">Tutti</option>
                  <option value="online">Online</option>
                  <option value="offline">Offline</option>
                  <option value="unknown">Sconosciuto</option>
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-[13px] text-muted-foreground">Classificazione</Label>
                <select
                  value={filterClassification}
                  onChange={(e) => setFilterClassification(e.target.value)}
                  className="h-8 rounded-md border border-input bg-background px-2 text-sm w-full"
                >
                  <option value="">Tutte</option>
                  <option value="__empty__">— Senza classificazione</option>
                  <OpzioniCategorie />
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-[13px] text-muted-foreground">Sistema</Label>
                <select
                  aria-label="Sistema"
                  value={filterSistema}
                  onChange={(e) => setFilterSistema(e.target.value)}
                  className="h-8 rounded-md border border-input bg-background px-2 text-sm w-full"
                >
                  <option value="">Tutti</option>
                  {SISTEMI.map((x) => <option key={x.valore} value={x.valore}>{x.etichetta}</option>)}
                  <option value={SISTEMA_IGNOTO}>— Non si sa</option>
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-[13px] text-muted-foreground">Produttore</Label>
                <select
                  aria-label="Produttore"
                  value={filterProduttore}
                  onChange={(e) => setFilterProduttore(e.target.value)}
                  className="h-8 rounded-md border border-input bg-background px-2 text-sm w-full"
                >
                  <option value="">Tutti</option>
                  {produttori.trovati.map((x) => <option key={x.valore} value={x.valore}>{x.valore} ({x.quanti})</option>)}
                  {produttori.ignoti > 0 && <option value={PRODUTTORE_IGNOTO}>— Non si sa ({produttori.ignoti})</option>}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-[13px] text-muted-foreground">Fisico o virtuale</Label>
                <select
                  aria-label="Fisico o virtuale"
                  value={filterForma}
                  onChange={(e) => setFilterForma(e.target.value)}
                  className="h-8 rounded-md border border-input bg-background px-2 text-sm w-full"
                >
                  <option value="">Tutti</option>
                  {FORME.map((x) => <option key={x.valore} value={x.valore}>{x.etichetta}</option>)}
                  <option value={FORMA_IGNOTA}>— Non si sa</option>
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-[13px] text-muted-foreground">Funzione</Label>
                <select
                  aria-label="Funzione"
                  value={filterFunzione}
                  onChange={(e) => setFilterFunzione(e.target.value)}
                  className="h-8 rounded-md border border-input bg-background px-2 text-sm w-full"
                >
                  <option value="">Tutte</option>
                  <OpzioniFunzioni />
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <Switch
                  id="filter-known"
                  checked={filterKnownOnly}
                  onCheckedChange={setFilterKnownOnly}
                />
                <Label htmlFor="filter-known" className="text-[13px] text-muted-foreground">Solo conosciuti</Label>
              </div>
                <div className="flex items-center gap-2">
                  <Switch id="filter-apparato" checked={filterApparato} onCheckedChange={setFilterApparato} />
                  <Label htmlFor="filter-apparato" className="text-[13px] text-muted-foreground">Solo gli apparati</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch id="filter-ad" checked={filterAd} onCheckedChange={setFilterAd} />
                  <Label htmlFor="filter-ad" className="text-[13px] text-muted-foreground">Solo quelli in Active Directory</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch id="filter-dhcp" checked={filterDhcp} onCheckedChange={setFilterDhcp} />
                  <Label htmlFor="filter-dhcp" className="text-[13px] text-muted-foreground">Solo con indirizzo da DHCP</Label>
                </div>
                <div className="flex justify-between gap-2 pt-2">
                  <Button variant="ghost" size="sm" onClick={cancellaFiltri} disabled={filtriAttivi.length === 0}>Togli tutti</Button>
                  <Button size="sm" onClick={() => setFiltriAperti(false)}>Mostra {filteredHosts.length} righe</Button>
                </div>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>

      {/* Scan Progress */}

      {/* Grid view */}
      {view === "grid" && (
        <Card className="overflow-visible" size="sm">
          <CardHeader className="py-2 px-3">
            <CardTitle className="text-sm">Mappa degli Indirizzi IP</CardTitle>
          </CardHeader>
          <CardContent className="overflow-visible p-3">
            <IpGrid cidr={network.cidr} hosts={hosts} gateway={network.gateway} onCategoria={categoriaDallaGriglia} onAutomatica={automaticaDallaGriglia} />
            <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
              <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-sm bg-success inline-block" /> Online</span>
              <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-sm bg-destructive inline-block" /> Offline</span>
              <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-sm bg-muted-foreground/40 inline-block" /> Sconosciuto</span>
              <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-sm bg-accent/60 inline-block" /> Gateway</span>
              <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-sm bg-card border border-border inline-block" /> Libero</span>
            </div>
          </CardContent>
        </Card>
      )}

      {bulkAddOpen && selectedHostIds.size > 0 && (
        <RendiApparatoDialog
          hosts={hosts.filter((h) => selectedHostIds.has(h.id)).slice(0, 50)}
          open={bulkAddOpen}
          onOpenChange={setBulkAddOpen}
          onCreated={() => { clearHostSelection(); void refreshHosts(); router.refresh(); }}
        />
      )}

      {categoriaOpen && selectedHostIds.size > 0 && (
        <CategoriaBloccoDialog
          hosts={hosts.filter((h) => selectedHostIds.has(h.id))}
          open={categoriaOpen}
          onOpenChange={setCategoriaOpen}
          onSalvato={() => { clearHostSelection(); void refreshHosts(); router.refresh(); }}
        />
      )}

      {view === "list" && filtriValore.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] text-muted-foreground">Filtri dal tasto destro:</span>
          {filtriValore.map((f, i) => (
            <Button
              key={`${f.colonna}:${f.valore}:${f.escludi}`}
              variant="outline"
              size="sm"
              className="h-7 gap-1.5 text-[13px]"
              title="Togli questo filtro"
              onClick={() => setFiltriValore((prec) => togliFiltroValore(prec, i))}
            >
              {f.escludi ? <EyeOff className="h-3.5 w-3.5" /> : <Filter className="h-3.5 w-3.5" />}
              {etichettaColonnaSubnet(f.colonna)} {f.escludi ? "≠" : "="} <span className="font-mono">{valoreLeggibile(f.valore)}</span>
              <X className="h-3.5 w-3.5" />
            </Button>
          ))}
          {filtriValore.length > 1 && (
            <Button variant="ghost" size="sm" className="h-7 text-[13px] text-muted-foreground" onClick={() => setFiltriValore([])}>
              Togli tutti
            </Button>
          )}
        </div>
      )}

      {view === "list" && (
        <Card className="overflow-hidden py-0 gap-0">
          <Table fissa>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={displayHosts.length > 0 && selectedHostIds.size === displayHosts.length}
                    onCheckedChange={toggleSelectAllHosts}
                    aria-label="Seleziona tutti"
                  />
                </TableHead>
                <TableHead className="w-12 text-center" title="Apri scheda host">Dettagli</TableHead>
                <SortableTableHead columnId="ip" sortColumn={listSortColumn} sortDirection={listSortDir} onSort={handleListSort}>
                  IP
                </SortableTableHead>
                <SortableTableHead columnId="status" sortColumn={listSortColumn} sortDirection={listSortDir} onSort={handleListSort}>
                  Stato
                </SortableTableHead>
                <TableHead title="Credenziali validate">Cred.</TableHead>
                <TableHead>Conosciuto</TableHead>
                <TableHead>DHCP</TableHead>
                <TableHead title="Presente in Active Directory" className="w-10 text-center">AD</TableHead>
                <SortableTableHead columnId="name" sortColumn={listSortColumn} sortDirection={listSortDir} onSort={handleListSort}>
                  Nome
                </SortableTableHead>
                <SortableTableHead
                  columnId="classification"
                  sortColumn={listSortColumn}
                  sortDirection={listSortDir}
                  onSort={handleListSort}
                  title="Che cos'è l'apparato e da dove lo sappiamo. Un clic sulla cella apre la scelta: «a mano» vuol dire che le scansioni non la cambiano più"
                >
                  Categoria
                </SortableTableHead>
                <TableHead title="Che cosa fa l'apparato: riconosciuto dalle letture o messo a mano">Funzioni</TableHead>
                <TableHead title="È un apparato: il segno apre la sua scheda" className="w-12 text-center">App.</TableHead>
                <TableHead title="Stesso device su più subnet" className="w-10 text-center">MH</TableHead>
                <SortableTableHead columnId="vendor" sortColumn={listSortColumn} sortDirection={listSortDir} onSort={handleListSort}>
                  Vendor
                </SortableTableHead>
                <TableHead>Note</TableHead>
                <TableHead>Porte</TableHead>
              </TableRow>
            </TableHeader>
            <ContextMenu open={menuRiga !== null} onOpenChange={(o) => {
              setMenuRiga(o ? bersaglioRef.current : null);
              if (!o) bersaglioRef.current = null;
            }}>
            <ContextMenuTrigger render={<TableBody />}>
              {displayHosts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={17} className="text-center text-muted-foreground py-8">
                    {hosts.length === 0
                      ? "Nessun host trovato. Avvia una scansione per scoprire i dispositivi."
                      : "Nessun host corrisponde ai filtri."}
                  </TableCell>
                </TableRow>
              ) : (
                displayHosts.map((host) => (
                  <TableRow
                    key={host.id}
                    className="cursor-pointer"
                    title="Prima lettura: OS, servizi, identità"
                    onContextMenu={(e) => puntaMenu(e, host)}
                    onClick={(e) => {
                      const el = e.target as HTMLElement;
                      if (el.closest("a, button, input, [role=checkbox], [role=menuitem]")) return;
                      setCassettoId(host.id);
                    }}
                  >
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={selectedHostIds.has(host.id)}
                        onCheckedChange={() => toggleSelectHost(host.id)}
                        aria-label={`Seleziona ${host.ip}`}
                      />
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()} className="text-center">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        nativeButton={false}
                        render={<Link href={`/hosts/${host.id}`} title="Apri scheda host" />}
                      >
                        <ExternalLink className="h-4 w-4" />
                      </Button>
                    </TableCell>
                    <TableCell>
                      <Link href={`/objects/${host.id}`} className="font-mono font-medium text-primary hover:underline">
                        {host.ip}
                      </Link>
                      {host.mac && <div className="font-mono text-[10px] text-muted-foreground">{host.mac}</div>}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={host.status} />
                      {host.last_seen && (
                        <div className="text-[10px] text-muted-foreground mt-0.5">
                          {parseDbDate(host.last_seen).toLocaleDateString("it-IT", { day: "2-digit", month: "short" })}{" "}
                          {parseDbDate(host.last_seen).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}
                        </div>
                      )}
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      {hostGestitoSenzaProva((host as HostWithDevice).device_id, hostValidatedProtocols[host.id]) && <BadgeSenzaProva corto />}
                      <ProtocolBadges
                        protocols={hostValidatedProtocols[host.id] || []}
                        onClick={() => setCredDialogHost({ id: host.id, ip: host.ip })}
                      />
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Switch
                        checked={!!host.known_host}
                        onCheckedChange={(v) => saveHostField(host.id, "known_host", v ? 1 : 0)}
                        title="Host conosciuto: monitoraggio continuo"
                      />
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()} className="min-w-[52px]">
                      {(() => {
                        const short = ipAssignmentShortLabel(host.ip_assignment ?? "unknown");
                        return short ? (
                          <Badge variant="outline" className="text-[10px] font-mono px-1.5 py-0 font-semibold tracking-tight">
                            {short}
                          </Badge>
                        ) : null;
                      })()}
                    </TableCell>
                    <TableCell className="text-center">
                      {(host as HostWithDevice).ad_dns_host_name ? (
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 font-semibold" title={(host as HostWithDevice).ad_dns_host_name!}>
                          AD
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell
                      className="min-w-[120px] cursor-text"
                      onClick={(e) => { e.stopPropagation(); if (!(e.target as HTMLElement).closest("input")) { setEditingHostId(host.id); setEditingField("custom_name"); } }}
                    >
                      {editingHostId === host.id && editingField === "custom_name" ? (
                        <Input
                          autoFocus
                          defaultValue={host.custom_name || ""}
                          className="h-8 text-sm"
                          onBlur={(e) => saveHostField(host.id, "custom_name", e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.currentTarget.blur();
                            } else if (e.key === "Escape") {
                              setEditingHostId(null);
                              setEditingField(null);
                            }
                          }}
                          onClick={(e) => e.stopPropagation()}
                        />
                      ) : (
                        <span className="flex items-center gap-1 truncate max-w-[140px]" title={host.custom_name || host.hostname || host.dns_reverse || (host as HostWithDevice).device?.sysname || ((host as HostWithDevice).device?.name !== host.ip ? (host as HostWithDevice).device?.name : null) || undefined}>
                          {host.known_host ? (
                             <span title="Host conosciuto"><CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-primary" /></span>
                          ) : null}
                          {host.custom_name || host.hostname || host.dns_reverse || (host as HostWithDevice).device?.sysname || ((host as HostWithDevice).device?.name !== host.ip ? (host as HostWithDevice).device?.name : null) || "—"}
                        </span>
                      )}
                    </TableCell>
                    <TableCell
                      className="min-w-[160px] cursor-pointer text-xs"
                      title={(() => {
                        const det = parseDetectedDeviceFromDetectionJson(host.detection_json);
                        return det ? `Scegli la categoria · impronta delle porte: ${det.label}${det.confidence != null ? ` (${Math.round(det.confidence * 100)}%)` : ""}` : "Scegli la categoria";
                      })()}
                      onClick={(e) => { e.stopPropagation(); if (!(e.target as HTMLElement).closest("button, [role=combobox]")) { setEditingHostId(host.id); setEditingField("classification"); } }}
                    >
                      {editingHostId === host.id && editingField === "classification" ? (
                        <Popover open onOpenChange={(open) => { if (!open) { setEditingHostId(null); setEditingField(null); } }}>
                          <PopoverTrigger
                            render={<button type="button" className="rounded-md border px-2 py-1 text-left text-[13px]" onClick={(e) => e.stopPropagation()} />}
                          >
                            {host.classification ? getClassificationLabel(host.classification) : "Senza categoria"}
                          </PopoverTrigger>
                          <PopoverContent onClick={(e) => e.stopPropagation()}>
                            {hostDelMenu(selectedHostIds, host.id).length > 1 && (
                              <p className="mb-1 shrink-0 rounded-md border border-[#C9A800] bg-[#FFD400] px-2 py-1 text-[13px] font-medium text-[#0D2537]">
                                Vale per i {hostDelMenu(selectedHostIds, host.id).length} host spuntati
                              </p>
                            )}
                            <ScegliCategoria
                              attuale={host.classification}
                              proposta={(host as HostWithDevice).classification_manual === 1 ? null : host.classification}
                              onScegli={(v) => {
                                const ids = hostDelMenu(selectedHostIds, host.id);
                                if (ids.length > 1) void categoriaAiSelezionati(ids, v);
                                else void saveHostField(host.id, "classification", v, (host as HostWithDevice).device_id);
                              }}
                              onAutomatica={(host as HostWithDevice).classification_manual === 1 ? () => void tornaAutomaticaRiga(host.id) : undefined}
                            />
                          </PopoverContent>
                        </Popover>
                      ) : (host as HostWithDevice).classification_manual === 1 ? (
                        // Lock manuale: la proiezione automatica di Attribution v2 non tocca
                        // classification/inferred_* per questo host (invariante sacro, persist.ts).
                        // Mostriamo il valore impostato a mano + eventuale suggerimento v2 non applicato.
                        <div className="flex flex-col gap-0.5 leading-tight">
                          <div className="flex items-center gap-1 flex-wrap">
                            <BadgeAMano piccolo />
                            <Badge variant="outline">{host.classification ? getClassificationLabel(host.classification) : "—"}</Badge>
                          </div>
                          {host.attr_category ? (
                            <span
                              className="text-muted-foreground truncate max-w-[160px] block"
                              title="Suggerimento Attribution v2 non applicato: classificazione bloccata manualmente"
                            >
                              v2: {attrCategoryLabel(host.attr_category)}
                            </span>
                          ) : null}
                        </div>
                      ) : host.attr_category ? (
                        <div className="flex flex-col gap-0.5 leading-tight">
                          <span
                            className="font-medium text-foreground"
                            title={`${host.attr_category}${host.attr_confidence_category != null ? ` (confidenza ${host.attr_confidence_category}%)` : ""}`}
                          >
                            {attrCategoryLabel(host.attr_category)}
                            {host.attr_confidence_category != null && (
                              <span className="text-muted-foreground font-normal ml-1">{host.attr_confidence_category}%</span>
                            )}
                            {origineCategoria(false, host.attr_min_phase) && (
                              <span className="text-muted-foreground font-normal ml-1">· {origineCategoria(false, host.attr_min_phase)}</span>
                            )}
                          </span>
                          {(() => {
                            /* L'OS: la famiglia dell'attribuzione se c'è, altrimenti il nome
                             * grezzo — quello che nmap o SNMP hanno letto (05/11/2026,
                             * Riccardo: «non riporta alcun dato alle tabelle delle subnet»).
                             * «HP iLO 4 or iLO 5» non è una famiglia, ma vale più di una cella
                             * vuota: si mostra in corsivo per dire che non è normalizzato. */
                            const vendor = host.attr_vendor_name || host.attr_vendor;
                            const famiglia = host.attr_os_family;
                            const grezzo = host.os_info || host.attr_os_name || null;
                            if (!vendor && !famiglia && !grezzo) return null;
                            return (
                              <span className="text-muted-foreground truncate max-w-[200px] block" title={[vendor, famiglia, grezzo].filter(Boolean).join(" · ")}>
                                {[vendor, famiglia].filter(Boolean).join(" · ")}
                                {grezzo && grezzo !== famiglia && (
                                  <>
                                    {vendor || famiglia ? " · " : ""}
                                    <em className="not-italic opacity-80">{grezzo}</em>
                                  </>
                                )}
                              </span>
                            );
                          })()}
                        </div>
                      ) : host.classification ? (
                        <Badge variant="outline">{getClassificationLabel(host.classification)}</Badge>
                      ) : (
                        <span className="rounded-md border border-dashed px-2 py-0.5 text-muted-foreground">Senza categoria</span>
                      )}
                    </TableCell>
                    <TableCell className="min-w-[120px] text-xs" onClick={(e) => e.stopPropagation()}>
                      <FunzioniInRiga
                        funzioni={funzioniHost[host.id]}
                        quantiHost={hostDelMenu(selectedHostIds, host.id).length}
                        onCambia={(f, azione) => cambiaFunzione(host.id, f, azione)}
                      />
                    </TableCell>
                    <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                      {(host as HostWithDevice).device ? (
                        <Link
                          href={`/devices/${(host as HostWithDevice).device!.id}`}
                          title={`Apparato: ${(host as HostWithDevice).device!.name} · apri la scheda`}
                          aria-label={`Apri la scheda dell'apparato ${(host as HostWithDevice).device!.name}`}
                        >
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 font-semibold">APP</Badge>
                        </Link>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-center">
                      {(host as HostWithDevice).multihomed ? (
                        <span
                          className="inline-flex items-center gap-0.5 cursor-help"
                          title={`Multi-homed (${(host as HostWithDevice).multihomed!.match_type}): ${(host as HostWithDevice).multihomed!.peers.map((p) => `${p.ip} (${p.network_name})`).join(", ")}`}
                        >
                          <Badge variant="outline" className="text-[10px] px-1 py-0 bg-cyan-500/15 text-cyan-600 border-cyan-300 dark:text-cyan-400">
                            {(host as HostWithDevice).multihomed!.peers.length + 1} IF
                          </Badge>
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-sm">{host.vendor || "—"}</TableCell>
                    <TableCell
                      className="min-w-[120px] max-w-[180px] cursor-text"
                      onClick={(e) => { e.stopPropagation(); if (!(e.target as HTMLElement).closest("input, textarea")) { setEditingHostId(host.id); setEditingField("notes"); } }}
                    >
                      {editingHostId === host.id && editingField === "notes" ? (
                        <Input
                          autoFocus
                          defaultValue={host.notes || ""}
                          className="h-8 text-sm"
                          onBlur={(e) => saveHostField(host.id, "notes", e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.currentTarget.blur();
                            } else if (e.key === "Escape") {
                              setEditingHostId(null);
                              setEditingField(null);
                            }
                          }}
                          onClick={(e) => e.stopPropagation()}
                        />
                      ) : (
                        <span className="block truncate max-w-[140px] text-muted-foreground text-sm" title={host.notes || undefined}>
                          {host.notes || "—"}
                        </span>
                      )}
                    </TableCell>
                    <TableCell
                      className="text-xs font-mono max-w-[200px] cursor-default"
                      title={host.open_ports ? hostOpenPortsToFullLabel(host.open_ports) : undefined}
                    >
                      {host.open_ports ? (() => {
                        try {
                          const ports = JSON.parse(host.open_ports) as { port: number; protocol?: string }[];
                          const sorted = [...ports].sort(
                            (a, b) => a.port - b.port || String(a.protocol ?? "").localeCompare(String(b.protocol ?? ""))
                          );
                          const maxShown = 20;
                          return (
                            <>
                              {sorted.slice(0, maxShown).map((p, i) => (
                                <span key={`${p.port}-${p.protocol}`}>
                                  {i > 0 && ", "}
                                  <span className={p.protocol === "udp" ? "text-primary" : ""}>{p.port}{p.protocol === "udp" ? "/u" : ""}</span>
                                </span>
                              ))}
                              {sorted.length > maxShown ? ` +${sorted.length - maxShown}` : ""}
                            </>
                          );
                        } catch { return "—"; }
                      })() : "—"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </ContextMenuTrigger>
            <ContextMenuContent className="w-64">{menuRiga && menuTastoDestro(menuRiga)}</ContextMenuContent>
            </ContextMenu>
          </Table>
        </Card>
      )}

      {/* Dialog credenziali host */}
      {credDialogHost && (
        <HostCredentialsDialog
          hostId={credDialogHost.id}
          hostIp={credDialogHost.ip}
          open={!!credDialogHost}
          onOpenChange={(open) => { if (!open) setCredDialogHost(null); }}
          availableCredentials={addDeviceCredentials}
          onCredentialsChanged={() => void refreshHosts()}
        />
      )}


      <CassettoHost hostId={cassettoId} onClose={() => setCassettoId(null)} />
    </div>
  );
}
