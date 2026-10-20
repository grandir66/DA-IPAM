"use client";
import { parseDbDate } from "@/lib/db-date";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
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
import { StatusBadge } from "@/components/shared/status-badge";
import { Checkbox } from "@/components/ui/checkbox";
import { IpGrid } from "@/components/shared/ip-grid";
import { ScanProgress } from "@/components/shared/scan-progress";
import { SubnetScheduleCard } from "@/components/networks/subnet-schedule-card";
import { SubnetEdgeScanPanel } from "@/components/networks/subnet-edge-scan-panel";
import { AttributionPreviewDialog } from "@/components/networks/attribution-preview-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ArrowLeft, Scan, Download, LayoutGrid, List, Pencil, RefreshCw, CheckCircle2, ExternalLink, X, Plus, Server, Trash2, UserCheck, UserX, Key, PlusCircle, Loader2, Activity, Radar, Tags, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import type { Network, Host, NetworkDevice, ScanProgress as ScanProgressType } from "@/types";
import { cn, hostOpenPortsToFullLabel } from "@/lib/utils";

/** Altezza uniforme per tutti i pulsanti della toolbar azioni subnet. */
const ACTION_BTN = "h-8 min-h-8 px-2.5 text-xs font-medium shrink-0";
import {
  DEVICE_CLASSIFICATIONS_ORDERED,
  getClassificationLabel,
  sortClassificationsByDisplayLabel,
} from "@/lib/device-classifications";
import { parseDetectedDeviceFromDetectionJson } from "@/lib/device-fingerprint-classification";
import { NetworkCredentialsTable } from "@/components/shared/network-credentials-table";
import { ProtocolBadges } from "@/components/shared/protocol-badges";
import { AddableSelect } from "@/components/shared/addable-select";
import { opzioniCreazioneRapida, tipiCredenzialePerProtocollo, tipoCreazioneRapida, vociSnmpAggiuntive } from "@/lib/credential-protocol-map";
import { etichettaTipo } from "@/lib/credentials/tipi";
import { profiloPerClassificazione, proponiApparato, riallineaAlProtocollo, type CredenzialeArchivio, type ProtocolloApparato } from "@/lib/devices/proposta-apparato";
import { HostCredentialsDialog } from "@/components/shared/host-credentials-dialog";
import {
  getDefaultNetworkDeviceVendorOptions,
  type NetworkDeviceVendorSelectOption,
} from "@/lib/network-device-vendor-options";
import { DeviceFormFields } from "@/components/shared/device-form-fields";
import {
  coerceProtocolForVendor,
  coerceScanTargetForVendor,
} from "@/lib/vendor-device-profile";
import { ipAssignmentShortLabel } from "@/lib/ip-assignment";
import { SortableTableHead } from "@/components/shared/sortable-table-head";
import { compareUnknown, type SortDirection } from "@/lib/table-sort";
import { WazuhHostBadge, type WazuhHostStatus } from "@/components/integrations/wazuh-host-badge";

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
  const [scanning, setScanning] = useState<ScanProgressType | null>(null);
  const scanIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
  const [listSortColumn, setListSortColumn] = useState<string | null>("ip");
  const [listSortDir, setListSortDir] = useState<SortDirection>("asc");
  const [editingHostId, setEditingHostId] = useState<number | null>(null);
  const [editingField, setEditingField] = useState<"custom_name" | "notes" | "classification" | null>(null);
  const [enriching, setEnriching] = useState(false);
  const [attributionPreviewOpen, setAttributionPreviewOpen] = useState(false);
  const [addDeviceCredentials, setAddDeviceCredentials] = useState<{ id: number; name: string; credential_type: string; port?: number | null }[]>([]);
  const [selectedHostIds, setSelectedHostIds] = useState<Set<number>>(new Set());
  const [bulkAddOpen, setBulkAddOpen] = useState(false);
  // Valori veri li mette apriAggiungiDispositivi dalla proposta sugli host scelti (tappa 1).
  const [bulkAddClassification, setBulkAddClassification] = useState("");
  const [bulkAddProtocol, setBulkAddProtocol] = useState("ssh");
  const [bulkAddVendor, setBulkAddVendor] = useState("other");
  const [bulkAddHostDiversi, setBulkAddHostDiversi] = useState(false);
  const [bulkAddCredentialId, setBulkAddCredentialId] = useState<string | null>(null);
  const [bulkAddSnmpCredentialId, setBulkAddSnmpCredentialId] = useState<string | null>(null);
  const [bulkAddVendorSubtype, setBulkAddVendorSubtype] = useState<string | null>(null);
  const [bulkAddScanTarget, setBulkAddScanTarget] = useState<string | null>(null);
  const [bulkAddProductProfile, setBulkAddProductProfile] = useState<string | null>(null);
  const [bulkVendorOptions, setBulkVendorOptions] = useState<NetworkDeviceVendorSelectOption[]>(() =>
    getDefaultNetworkDeviceVendorOptions()
  );
  const [bulkAddSaving, setBulkAddSaving] = useState(false);
  const [bulkTestResult, setBulkTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [bulkTesting, setBulkTesting] = useState(false);
  const [bulkHostBusy, setBulkHostBusy] = useState(false);
  // Lista unica delle credenziali della rete. Le quattro catene vecchie non si
  // leggono né si rimandano più (tappa 2 credenziali, T12): restano nel DB,
  // congelate, fino alla 2d.
  const [networkCredentialIds, setNetworkCredentialIds] = useState<number[]>(initialCredentialIds);
  const [availableSources, setAvailableSources] = useState(initialAvailableSources);
  const [hostValidatedProtocols, setHostValidatedProtocols] = useState<Record<number, string[]>>(initialHostValidatedProtocols);
  const [credDialogHost, setCredDialogHost] = useState<{ id: number; ip: string } | null>(null);

  // ─── LibreNMS: mapping host_ip → device_id ───────────────
  const [librenmsMap, setLibrenmsMap] = useState<Map<string, number>>(new Map());
  const [librenmsAdding, setLibrenmsAdding] = useState<Set<number>>(new Set());
  // ─── Wazuh: mapping host_id → agent status (batch) ───────
  const [wazuhMap, setWazuhMap] = useState<Map<number, WazuhHostStatus | null>>(new Map());

  useEffect(() => {
    fetch(`/api/integrations/librenms/sync?network_id=${network.id}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: { host_ip: string; librenms_device_id: number }[]) => {
        const m = new Map<string, number>();
        for (const row of rows) m.set(row.host_ip, row.librenms_device_id);
        setLibrenmsMap(m);
      })
      .catch(() => {});
  }, [network.id]);

  // Batch fetch Wazuh status: single query per tutti gli host della subnet
  useEffect(() => {
    const ids = hosts.map((h) => h.id).filter((v): v is number => Number.isFinite(v));
    if (ids.length === 0) return;
    fetch("/api/integrations/wazuh/host-status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host_ids: ids }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { statuses?: Record<string, WazuhHostStatus | null> } | null) => {
        if (!j?.statuses) return;
        const m = new Map<number, WazuhHostStatus | null>();
        for (const id of ids) m.set(id, j.statuses[id] ?? null);
        setWazuhMap(m);
      })
      .catch(() => {});
  }, [hosts]);

  async function addHostToLibreNMS(host: HostWithDevice) {
    setLibrenmsAdding((prev) => new Set(prev).add(host.id));
    try {
      const res = await fetch("/api/integrations/librenms/host", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ host_id: host.id }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(`${host.ip} aggiunto a LibreNMS (#${data.librenms_device_id})`);
        setLibrenmsMap((prev) => new Map(prev).set(host.ip, data.librenms_device_id));
      } else {
        toast.error(data.error ?? "Errore aggiunta a LibreNMS");
      }
    } catch {
      toast.error("Errore di rete");
    } finally {
      setLibrenmsAdding((prev) => { const next = new Set(prev); next.delete(host.id); return next; });
    }
  }

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

  useEffect(() => {
    let cancelled = false;
    fetch("/api/device-vendor-options")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { options?: NetworkDeviceVendorSelectOption[] } | null) => {
        if (cancelled || !data?.options?.length) return;
        setBulkVendorOptions(data.options);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
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

  const filteredHosts = hosts.filter((h) => {
    if (filterStatus && h.status !== filterStatus) return false;
    if (filterClassification) {
      if (filterClassification === "__empty__") {
        if (h.classification) return false;
      } else if (h.classification !== filterClassification) {
        return false;
      }
    }
    if (filterKnownOnly && !h.known_host) return false;
    return true;
  });

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

  const archivioCredenziali = (): CredenzialeArchivio[] =>
    addDeviceCredentials.map((c) => ({ id: c.id, name: c.name, credential_type: c.credential_type, port: c.port ?? null }));

  /**
   * Apre «Aggiungi dispositivi» coi valori proposti dagli host scelti (tappa 1):
   * prima partiva sempre da «server + Altro + UPS + SNMP v2». Se gli host
   * danno proposte diverse, la classificazione resta da scegliere.
   */
  function apriAggiungiDispositivi() {
    const archivio = archivioCredenziali();
    const proposte = hosts.filter((h) => selectedHostIds.has(h.id)).map((h) => proponiApparato(h, archivio));
    const prima = proposte[0];
    const uguali = !!prima && proposte.every(
      (p) => p.vendor === prima.vendor && p.protocol === prima.protocol && p.classification === prima.classification
    );
    setBulkAddVendor(prima?.vendor ?? "other");
    setBulkAddVendorSubtype(null);
    setBulkAddProtocol(prima?.protocol ?? "ssh");
    setBulkAddClassification(uguali ? prima.classification : "");
    setBulkAddProductProfile(uguali ? prima.productProfile : null);
    setBulkAddScanTarget(prima?.scanTarget ?? null);
    setBulkAddCredentialId(uguali ? prima.credentialId : null);
    setBulkAddSnmpCredentialId(uguali ? prima.snmpCredentialId : null);
    setBulkAddHostDiversi(proposte.length > 1 && !uguali);
    setBulkTestResult(null);
    setBulkAddOpen(true);
  }

  /** Cambio di protocollo: credenziale incompatibile azzerata, con SNMP la principale è la SNMP. */
  function cambiaProtocolloAggiunta(v: string) {
    const q = riallineaAlProtocollo(
      {
        name: "", vendor: bulkAddVendor, protocol: bulkAddProtocol as ProtocolloApparato,
        classification: bulkAddClassification, productProfile: bulkAddProductProfile, scanTarget: bulkAddScanTarget,
        port: 0, credentialId: bulkAddCredentialId, snmpCredentialId: bulkAddSnmpCredentialId, useForArpPoll: false,
      },
      v as ProtocolloApparato,
      archivioCredenziali(),
    );
    setBulkAddProtocol(v);
    setBulkAddCredentialId(q.credentialId);
    setBulkAddSnmpCredentialId(q.snmpCredentialId);
  }

  async function handleBulkAdd() {
    if (selectedHostIds.size === 0 || !bulkAddClassification) return;
    const hasCred = bulkAddCredentialId && bulkAddCredentialId !== "none";
    const hasSnmpCred = bulkAddSnmpCredentialId && bulkAddSnmpCredentialId !== "none";
    setBulkAddSaving(true);
    try {
      const body: Record<string, unknown> = {
        host_ids: Array.from(selectedHostIds),
        classification: bulkAddClassification,
        protocol: bulkAddProtocol,
        vendor: bulkAddVendor,
        scan_target: bulkAddScanTarget,
      };
      if (bulkAddProductProfile) body.product_profile = bulkAddProductProfile;
      if (hasCred) body.credential_id = Number(bulkAddCredentialId);
      if (hasSnmpCred) body.snmp_credential_id = Number(bulkAddSnmpCredentialId);
      body.inherit_host_credentials = true;
      const res = await fetch("/api/devices/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(data.message);
        setBulkAddOpen(false);
        clearHostSelection();
        await refreshHosts();
        router.refresh();
      } else {
        toast.error(data.error || "Errore nell'aggiunta");
      }
    } catch {
      toast.error("Errore nell'aggiunta");
    }
    setBulkAddSaving(false);
  }

  async function handleBulkKnown(known: 0 | 1) {
    if (selectedHostIds.size === 0) return;
    const n = selectedHostIds.size;
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
          host_ids: Array.from(selectedHostIds),
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

  async function handleBulkDeleteHosts() {
    if (selectedHostIds.size === 0) return;
    const n = selectedHostIds.size;
    if (!confirm(`Eliminare definitivamente ${n} host dall'inventario IP? Azione irreversibile.`)) return;
    setBulkHostBusy(true);
    try {
      const res = await fetch("/api/hosts/bulk", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          network_id: network.id,
          host_ids: Array.from(selectedHostIds),
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
            const progressRes = await fetch(`/api/scans/progress/${data.id}`);
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
      const first = await runScanJob("scan_icmp");
      if (!first.ok) return;
      const second = await runScanJob("scan_nmap_base");
      if (second.ok) toast.success("Percorso: ICMP + Nmap quick");
    }
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
      return;
    }
    const nmap = await runScanJob("nmap", { showStartToast: false });
    if (!nmap.ok) {
      toast.error("Porte e servizi terminata con errori: SNMP non avviato");
      setScanning(null);
      return;
    }
    const snmp = await runScanJob("snmp", { showStartToast: false });
    if (snmp.ok) toast.success(`Avanzata completata su ${selectedHostIds.size} host (porte e servizi + SNMP)`);
    setScanning(null);
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
    const steps: Array<{ type: ScanJobType; label: string }> = [
      ...(networkCredentialIds.length > 0 ? [{ type: "credential_validate" as const, label: "verifica credenziali" }] : []),
      { type: "windows", label: "WinRM (Windows)" },
      { type: "ssh", label: "SSH (Linux)" },
    ];
    for (const [i, step] of steps.entries()) {
      toast.info(`Accesso agli host — fase ${i + 1}/${steps.length}: ${step.label}…`);
      const r = await runScanJob(step.type, { showStartToast: false });
      if (!r.ok) {
        toast.error(`Accesso agli host: fase ${step.label} terminata con errori, le successive non sono partite`);
        setScanning(null);
        return;
      }
    }
    toast.success(`Accesso agli host completato (${steps.map((s) => s.label).join(" + ")})`);
    setScanning(null);
  }

  const onlineCount = hosts.filter((h) => h.status === "online").length;
  const offlineCount = hosts.filter((h) => h.status === "offline").length;

  // Portata dei comandi: host selezionati nella lista, altrimenti tutta la subnet.
  const hostScope = view === "list" && selectedHostIds.size > 0;
  const busy = !!scanning || enriching;

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
              {scanning ? (
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

            <Button
              size="default"
              variant="outline"
              className={cn(ACTION_BTN, "bg-background/90")}
              onClick={() => setAttributionPreviewOpen(true)}
              title={
                scanPhases
                  ? `Anteprima dei cambi di vendor/categoria/OS proposti dalle evidenze. Oggi: ${scanPhases.attribution.level2} host a livello 2, ${scanPhases.attribution.level1} a livello 1, ${scanPhases.attribution.none} senza su ${scanPhases.attribution.total}.${scanPhases.attribution.suggestion ? ` ${scanPhases.attribution.suggestion}` : ""}`
                  : "Anteprima dei cambi di vendor/categoria/OS proposti dalle evidenze"
              }
            >
              <Tags className="h-3.5 w-3.5 mr-1 shrink-0" />
              Attribuzione
              {scanPhases && (
                <span className="ml-1.5 tabular-nums text-muted-foreground">
                  {scanPhases.attribution.level2}/{scanPhases.attribution.total}
                </span>
              )}
            </Button>

            <SubnetScheduleCard networkId={network.id} />

            {/* VA Scan a parte: scansione invasiva dall'edge, con la sua pianificazione */}
            <div className="ml-auto">
              <SubnetEdgeScanPanel networkId={network.id} disabled={busy} hosts={hosts} cidr={network.cidr} networkName={network.name} />
            </div>
          </div>


          {/* Barra unica: azioni bulk a sinistra, refresh live a destra (niente toolbar dedicata sotto) */}
          <div
            className={cn(
              "rounded-lg border px-2.5 py-2 flex flex-wrap items-center gap-x-3 gap-y-2 justify-between",
              view === "list" && selectedHostIds.size > 0
                ? "border-amber-500/40 bg-amber-500/5"
                : "border-border/80 bg-muted/10"
            )}
          >
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 min-w-0 flex-1">
              {/* Vista: nella stessa barra (testata compatta, 20/10) */}
              <div className="flex items-center gap-1" role="group" aria-label="Visualizzazione">
                <Button variant={view === "grid" ? "secondary" : "outline"} size="sm" aria-pressed={view === "grid"} onClick={() => setView("grid")}>
                  <LayoutGrid className="h-4 w-4 mr-1" />
                  Griglia IP
                </Button>
                <Button variant={view === "list" ? "secondary" : "outline"} size="sm" aria-pressed={view === "list"} onClick={() => setView("list")}>
                  <List className="h-4 w-4 mr-1" />
                  Lista
                </Button>
              </div>
              {/* Filtri della lista nella stessa barra (testata compatta, 20/10) */}
              {view === "list" && (
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-2">
                <Label className="text-xs text-muted-foreground">Stato</Label>
                <select
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value)}
                  className="h-8 rounded-md border border-input bg-background px-2 text-sm min-w-[100px]"
                >
                  <option value="">Tutti</option>
                  <option value="online">Online</option>
                  <option value="offline">Offline</option>
                  <option value="unknown">Sconosciuto</option>
                </select>
              </div>
              <div className="flex items-center gap-2">
                <Label className="text-xs text-muted-foreground">Classificazione</Label>
                <select
                  value={filterClassification}
                  onChange={(e) => setFilterClassification(e.target.value)}
                  className="h-8 rounded-md border border-input bg-background px-2 text-sm min-w-[140px]"
                >
                  <option value="">Tutte</option>
                  <option value="__empty__">— Senza classificazione</option>
                  {sortClassificationsByDisplayLabel(DEVICE_CLASSIFICATIONS_ORDERED).map((c) => (
                    <option key={c} value={c}>{getClassificationLabel(c)}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  id="filter-known"
                  checked={filterKnownOnly}
                  onCheckedChange={setFilterKnownOnly}
                />
                <Label htmlFor="filter-known" className="text-xs text-muted-foreground">Solo conosciuti</Label>
              </div>
              {(filterStatus || filterClassification || filterKnownOnly) && (
                <Button variant="ghost" size="sm" onClick={() => { setFilterStatus(""); setFilterClassification(""); setFilterKnownOnly(false); }}>
                  Cancella filtri
                </Button>
              )}
            </div>
              )}
              {view === "list" ? (
                <>
                  <p className="text-[11px] text-muted-foreground whitespace-nowrap" title="Spunta gli host nella tabella per le azioni qui a fianco.">
                    {selectedHostIds.size === 0 ? "Nessun host selezionato" : `${selectedHostIds.size} host selezionati`}
                  </p>
                  {/* Aggiunge alla selezione, non filtra: sta col gruppo della selezione (revisione 20/10). */}
                  <div className="flex items-center gap-1">
                    <Label className="text-xs text-muted-foreground">Seleziona per tipo:</Label>
                    <select
                      className="h-8 rounded-md border border-input bg-background px-2 text-sm min-w-[140px]"
                      value=""
                      onChange={(e) => {
                        const c = e.target.value;
                        e.target.value = "";
                        if (!c) return;
                        const toSelect = c === "__empty__"
                          ? filteredHosts.filter((h) => !h.classification)
                          : filteredHosts.filter((h) => h.classification === c);
                        if (toSelect.length === 0) {
                          toast.info(c === "__empty__" ? "Nessun host senza classificazione" : `Nessun host con classificazione "${getClassificationLabel(c)}"`);
                          return;
                        }
                        setSelectedHostIds((prev) => {
                          const next = new Set(prev);
                          for (const h of toSelect) next.add(h.id);
                          return next;
                        });
                        toast.success(`${toSelect.length} host selezionati`);
                      }}
                    >
                      <option value="">—</option>
                      <option value="__empty__">— Senza classificazione</option>
                      {sortClassificationsByDisplayLabel(DEVICE_CLASSIFICATIONS_ORDERED).map((c) => (
                        <option key={c} value={c}>{getClassificationLabel(c)}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-wrap gap-1.5 items-center">
                    <Button
                      variant="default"
                      size="default"
                      className="font-medium"
                      onClick={apriAggiungiDispositivi}
                      disabled={selectedHostIds.size === 0 || bulkHostBusy}
                    >
                      <Plus className="h-4 w-4 mr-1.5 shrink-0" />
                      Aggiungi dispositivo
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
                </>
              ) : (
                <p className="text-[11px] text-muted-foreground">
                  Vista griglia: passa a <span className="font-medium text-foreground">Lista</span> per selezione e azioni bulk a sinistra.
                </p>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 shrink-0 border-t border-border/50 pt-2 mt-1 w-full sm:border-t-0 sm:border-l sm:pt-0 sm:mt-0 sm:pl-3 sm:w-auto sm:max-w-[min(100%,28rem)]">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/80 whitespace-nowrap">
                Refresh
              </span>
              <div className="flex items-center gap-1.5">
                <Label htmlFor="auto-refresh" className="text-[11px] whitespace-nowrap font-normal text-muted-foreground">
                  Intervallo
                </Label>
                <select
                  id="auto-refresh"
                  value={autoRefreshInterval}
                  onChange={(e) => setAutoRefreshInterval(Number(e.target.value))}
                  className="h-7 rounded border border-input/80 bg-background px-1.5 text-[11px] text-foreground"
                >
                  {REFRESH_INTERVALS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              {autoRefreshInterval > 0 && (
                <div className="flex items-center gap-1.5 min-w-0">
                  <Switch id="auto-scan" checked={autoScanPing} onCheckedChange={setAutoScanPing} />
                  <Label htmlFor="auto-scan" className="text-[11px] font-normal leading-snug text-muted-foreground">
                    Scoperta periodica
                  </Label>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Scan Progress */}
      {scanning && <ScanProgress progress={scanning} onClose={() => setScanning(null)} />}

      {/* Grid view */}
      {view === "grid" && (
        <Card className="overflow-visible" size="sm">
          <CardHeader className="py-2 px-3">
            <CardTitle className="text-sm">Mappa degli Indirizzi IP</CardTitle>
          </CardHeader>
          <CardContent className="overflow-visible p-3">
            <IpGrid cidr={network.cidr} hosts={hosts} gateway={network.gateway} />
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

      <Dialog open={bulkAddOpen} onOpenChange={(open) => { setBulkAddOpen(open); if (!open) setBulkTestResult(null); }}>
        <DialogContent className={DIALOG_PANEL_WIDE_CLASS}>
          <DialogHeader className="shrink-0 border-b border-border/50 px-4 pt-4 pb-3">
            <DialogTitle>Aggiungi {selectedHostIds.size} dispositivo{selectedHostIds.size !== 1 ? "i" : ""}</DialogTitle>
            <CardDescription>
              Configura profilo, protocollo e credenziali. Usa <strong>Prova connessione</strong> per testare le credenziali su uno degli host selezionati prima di salvare.
            </CardDescription>
          </DialogHeader>
          <DialogScrollableArea className="px-4 py-3">
          <div className="space-y-4">
            <DeviceFormFields
              mode="bulk"
              credentials={addDeviceCredentials}
              idPrefix="network-bulk-add"
              showIdentificazione={false}
              showProfilo={true}
              showCredenziali={false}
              classification={bulkAddClassification}
              vendor={bulkAddVendor}
              vendorSubtype={bulkAddVendorSubtype}
              protocol={bulkAddProtocol}
              scanTarget={bulkAddScanTarget}
              productProfile={bulkAddProductProfile}
              onProductProfileChange={setBulkAddProductProfile}
              credentialId={bulkAddCredentialId}
              snmpCredentialId={bulkAddSnmpCredentialId}
              onClassificationChange={(v) => {
                setBulkAddClassification(v);
                if (v) setBulkAddProductProfile(profiloPerClassificazione(bulkAddVendor, v));
              }}
              creazioneInBlocco
              onVendorChange={(v) => {
                setBulkAddVendor(v);
                if (v !== "hp") setBulkAddVendorSubtype(null);
                const nextP = coerceProtocolForVendor(v, bulkAddProtocol);
                if (nextP !== bulkAddProtocol) cambiaProtocolloAggiunta(nextP);
                const nextS = coerceScanTargetForVendor(v, bulkAddScanTarget);
                if (nextS !== bulkAddScanTarget) setBulkAddScanTarget(nextS);
              }}
              onVendorSubtypeChange={(v) => setBulkAddVendorSubtype(v)}
              onProtocolChange={(v) => { if (v !== bulkAddProtocol) cambiaProtocolloAggiunta(v); }}
              onScanTargetChange={(v) => setBulkAddScanTarget(v)}
              onCredentialIdChange={(v) => setBulkAddCredentialId(v)}
              onSnmpCredentialIdChange={(v) => setBulkAddSnmpCredentialId(v)}
              vendorOptions={bulkVendorOptions}
              defaultClassification=""
              defaultVendor={bulkAddVendor}
              defaultProtocol={bulkAddProtocol}
            />
            {bulkAddHostDiversi && (
              <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-800 dark:text-amber-200/90">
                Gli host selezionati non sono dello stesso tipo: scegli classificazione, marca e protocollo validi per tutti.
              </p>
            )}

            {/* Credenziali: scelta esplicita + creazione inline ─ con badge eredità automatica */}
            {(() => {
              const tipiPrincipale = tipiCredenzialePerProtocollo(bulkAddProtocol);
              const primaryOpts = addDeviceCredentials.filter((c) => tipiPrincipale.includes(c.credential_type));
              const snmpOpts = vociSnmpAggiuntive(addDeviceCredentials);
              // Con SNMP come protocollo la principale è già la SNMP: la seconda tendina non serve.
              const protocolloSnmp = bulkAddProtocol === "snmp_v2" || bulkAddProtocol === "snmp_v3";
              const protos = new Set<string>();
              for (const hid of selectedHostIds) {
                for (const p of (hostValidatedProtocols[hid] || [])) protos.add(p);
              }
              return (
                <div className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-3">
                  <div className="flex items-center gap-2">
                    <Key className="h-4 w-4 text-primary" />
                    <span className="text-sm font-medium">Credenziali</span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Credenziale principale</Label>
                      <AddableSelect
                        value={bulkAddCredentialId && bulkAddCredentialId !== "none" ? Number(bulkAddCredentialId) : null}
                        onChange={(v) => setBulkAddCredentialId(v != null ? String(v) : null)}
                        options={primaryOpts.map((c) => ({ id: c.id, label: c.name, extra: etichettaTipo(c.credential_type) }))}
                        entityLabel="credenziale"
                        createApiUrl="/api/credentials"
                        extraFields={[
                          { key: "credential_type", label: "Tipo", type: "select", required: true, defaultValue: tipoCreazioneRapida(bulkAddProtocol), options: opzioniCreazioneRapida(bulkAddProtocol) },
                          { key: "username", label: "Username", placeholder: "admin" },
                          { key: "password", label: "Password / Community", type: "password", required: true },
                        ]}
                        onCreated={refreshCredentialsList}
                      />
                    </div>
                    {!protocolloSnmp && (
                    <div className="space-y-1.5">
                      <Label className="text-xs">Credenziale SNMP (opzionale)</Label>
                      <AddableSelect
                        value={bulkAddSnmpCredentialId && bulkAddSnmpCredentialId !== "none" ? Number(bulkAddSnmpCredentialId) : null}
                        onChange={(v) => setBulkAddSnmpCredentialId(v != null ? String(v) : null)}
                        options={snmpOpts.map((c) => ({ id: c.id, label: c.name, extra: etichettaTipo(c.credential_type) }))}
                        entityLabel="credenziale SNMP"
                        createApiUrl="/api/credentials"
                        extraFields={[
                          { key: "credential_type", label: "Tipo", type: "select", required: true, defaultValue: "snmp", options: [{ value: "snmp", label: "SNMP" }] },
                          { key: "password", label: "Community string", type: "password", required: true, placeholder: "public" },
                        ]}
                        onCreated={refreshCredentialsList}
                      />
                    </div>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground border-t border-border/60 pt-2">
                    {protos.size > 0 ? (
                      <div className="flex items-center gap-2 flex-wrap">
                        <span>Protocolli già validati sugli host:</span>
                        <ProtocolBadges protocols={[...protos]} />
                        <span className="text-[11px] opacity-75">(verranno ereditati come fallback se non assegni qui sopra)</span>
                      </div>
                    ) : (
                      <span className="text-amber-600 dark:text-amber-400">Nessuna credenziale validata sugli host: assegnane una qui sopra.</span>
                    )}
                  </div>
                </div>
              );
            })()}
            {bulkTestResult && (
              <div className={cn("text-sm px-3 py-2 rounded border", bulkTestResult.ok ? "border-green-500 bg-green-50 text-green-700" : "border-red-500 bg-red-50 text-red-700")}>
                {bulkTestResult.message}
              </div>
            )}
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={async () => {
                  if (selectedHostIds.size === 0) return;
                  setBulkTesting(true);
                  setBulkTestResult(null);
                  try {
                    const firstHostId = Array.from(selectedHostIds)[0];
                    const firstHost = hosts.find((h) => h.id === firstHostId);
                    if (!firstHost) {
                      setBulkTestResult({ ok: false, message: "Host non trovato" });
                      setBulkTesting(false);
                      return;
                    }
                    const res = await fetch("/api/devices/test-provisional", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        host: firstHost.ip,
                        vendor: bulkAddVendor,
                        protocol: bulkAddProtocol,
                        scan_target: bulkAddScanTarget,
                        product_profile: bulkAddProductProfile,
                        credential_id: bulkAddCredentialId && bulkAddCredentialId !== "none" ? Number(bulkAddCredentialId) : null,
                        snmp_credential_id: bulkAddSnmpCredentialId && bulkAddSnmpCredentialId !== "none" ? Number(bulkAddSnmpCredentialId) : null,
                        // La stessa porta che userà la creazione: quella propria della credenziale, se c'è.
                        port: addDeviceCredentials.find((c) => String(c.id) === bulkAddCredentialId)?.port ?? undefined,
                      }),
                    });
                    const data = await res.json();
                    // Si prova sul primo host scelto: lo si dice, con più host l'esito non vale per tutti.
                    const suChi = selectedHostIds.size > 1 ? `Provato su ${firstHost.ip} (il primo dei ${selectedHostIds.size} scelti)` : `Provato su ${firstHost.ip}`;
                    if (res.ok && data.success) {
                      setBulkTestResult({ ok: true, message: `${suChi}: ${data.message || "connessione riuscita"}` });
                    } else {
                      setBulkTestResult({ ok: false, message: `${suChi}: ${data.error || "connessione fallita"}` });
                    }
                  } catch {
                    setBulkTestResult({ ok: false, message: "Errore di rete" });
                  } finally {
                    setBulkTesting(false);
                  }
                }}
                disabled={bulkTesting || bulkAddSaving}
                className="flex-1"
              >
                {bulkTesting ? "Test in corso..." : "Prova connessione"}
              </Button>
              <Button onClick={handleBulkAdd} disabled={bulkAddSaving || !bulkAddClassification} className="flex-1">
                {bulkAddSaving ? "Aggiunta in corso..." : "Aggiungi dispositivi"}
              </Button>
            </div>
            {!bulkAddClassification && (
              <p className="text-right text-sm text-amber-800 dark:text-amber-200">Scegli la classificazione</p>
            )}
          </div>
          </DialogScrollableArea>
        </DialogContent>
      </Dialog>

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
                  title="Attribution v2: categoria/vendor/OS calcolati da evidenze multi-fonte (OUI, SNMP, AD, Wazuh, LLDP/CDP). Badge 'Manuale' = classificazione impostata a mano, esclusa dai ricalcoli automatici."
                >
                  Attribuzione
                </SortableTableHead>
                <TableHead title="Tipo dispositivo da fingerprint (porte, SNMP, banner)">Rilevato</TableHead>
                <TableHead>Dispositivo</TableHead>
                <TableHead title="Stesso device su più subnet" className="w-10 text-center">MH</TableHead>
                <SortableTableHead columnId="vendor" sortColumn={listSortColumn} sortDirection={listSortDir} onSort={handleListSort}>
                  Vendor
                </SortableTableHead>
                <TableHead>Note</TableHead>
                <TableHead>Porte</TableHead>
                <TableHead title="LibreNMS NMS">LibreNMS</TableHead>
                <TableHead title="Wazuh SIEM/HIDS agent" className="w-12 text-center">Wazuh</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
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
                  <TableRow key={host.id}>
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
                      <div className="font-mono font-medium">{host.ip}</div>
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
                      className="min-w-[160px] cursor-text text-xs"
                      onClick={(e) => { e.stopPropagation(); if (!(e.target as HTMLElement).closest("button, [role=combobox]")) { setEditingHostId(host.id); setEditingField("classification"); } }}
                    >
                      {editingHostId === host.id && editingField === "classification" ? (
                        <Select
                          value={host.classification || "__empty__"}
                          onValueChange={(v) => {
                            saveHostField(host.id, "classification", v === "__empty__" ? "" : (v ?? ""), (host as HostWithDevice).device_id);
                            setEditingHostId(null);
                            setEditingField(null);
                          }}
                          onOpenChange={(open) => { if (!open) { setEditingHostId(null); setEditingField(null); } }}
                        >
                          <SelectTrigger className="h-8 text-sm min-w-[120px]" onClick={(e) => e.stopPropagation()}>
                            <SelectValue placeholder="Seleziona..." />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__empty__">— Nessuna —</SelectItem>
                            {sortClassificationsByDisplayLabel(DEVICE_CLASSIFICATIONS_ORDERED).map((c) => (
                              <SelectItem key={c} value={c}>
                                {getClassificationLabel(c)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (host as HostWithDevice).classification_manual === 1 ? (
                        // Lock manuale: la proiezione automatica di Attribution v2 non tocca
                        // classification/inferred_* per questo host (invariante sacro, persist.ts).
                        // Mostriamo il valore impostato a mano + eventuale suggerimento v2 non applicato.
                        <div className="flex flex-col gap-0.5 leading-tight">
                          <div className="flex items-center gap-1 flex-wrap">
                            <Badge variant="outline" className="text-[10px] py-0">Manuale</Badge>
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
                          </span>
                          {(host.attr_vendor_name || host.attr_vendor || host.attr_os_family) ? (
                            <span className="text-muted-foreground truncate max-w-[160px] block">
                              {[host.attr_vendor_name || host.attr_vendor, host.attr_os_family].filter(Boolean).join(" · ")}
                            </span>
                          ) : null}
                        </div>
                      ) : host.classification ? (
                        <Badge variant="outline">{getClassificationLabel(host.classification)}</Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm max-w-[200px]">
                      {(() => {
                        const det = parseDetectedDeviceFromDetectionJson(host.detection_json);
                        if (!det) {
                          return <span className="text-muted-foreground">—</span>;
                        }
                        const pct =
                          det.confidence != null ? `${Math.round(det.confidence * 100)}%` : null;
                        return (
                          <span
                            className="block truncate"
                            title={pct ? `Confidenza fingerprint: ${pct}` : "Fingerprint"}
                          >
                            {det.label}
                            {pct ? (
                              <span className="text-muted-foreground text-xs ml-1 tabular-nums">({pct})</span>
                            ) : null}
                          </span>
                        );
                      })()}
                    </TableCell>
                    <TableCell className="text-sm">
                      {(host as HostWithDevice).device ? (
                        <Link href={`/devices/${(host as HostWithDevice).device!.id}`} className="text-primary hover:underline flex items-center gap-1">
                          <Server className="h-3.5 w-3.5" />
                          {host.custom_name || host.hostname || (host as HostWithDevice).device!.sysname || ((host as HostWithDevice).device!.name !== host.ip ? (host as HostWithDevice).device!.name : null) || "—"}
                        </Link>
                      ) : (
                        "—"
                      )}
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
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      {(() => {
                        const deviceId = librenmsMap.get(host.ip);
                        const isAdding = librenmsAdding.has(host.id);
                        if (deviceId != null) {
                          return (
                            <span className="inline-flex items-center gap-1">
                              <Activity className="h-3 w-3 text-success shrink-0" />
                              <Badge variant="outline" className="font-mono text-xs">#{deviceId}</Badge>
                            </span>
                          );
                        }
                        return (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-6 px-2 text-xs gap-1"
                            disabled={isAdding}
                            onClick={() => addHostToLibreNMS(host)}
                            title={host.snmp_data ? "Aggiungi a LibreNMS con SNMP" : "Aggiungi a LibreNMS (ping-only)"}
                          >
                            {isAdding ? <Loader2 className="h-3 w-3 animate-spin" /> : <PlusCircle className="h-3 w-3" />}
                            Aggiungi
                          </Button>
                        );
                      })()}
                    </TableCell>
                    <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                      <WazuhHostBadge
                        hostId={host.id}
                        hostName={host.hostname ?? host.custom_name ?? null}
                        hostIp={host.ip}
                        prefetched={wazuhMap.get(host.id) ?? null}
                        mode="icon"
                      />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
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

      <AttributionPreviewDialog
        open={attributionPreviewOpen}
        onOpenChange={setAttributionPreviewOpen}
        networkId={network.id}
        onApplied={() => {
          void refreshHosts();
          router.refresh();
          setScanPhasesRefreshKey((k) => k + 1);
        }}
      />
    </div>
  );
}
