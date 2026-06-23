"use client";

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
import { ClassificationProposalDialog } from "@/components/networks/classification-proposal-dialog";
import { ArrowLeft, Scan, Download, LayoutGrid, List, Pencil, RefreshCw, CheckCircle2, Cpu, ExternalLink, X, Plus, Server, Sparkles, Trash2, UserCheck, UserX, Key, PlusCircle, Loader2, Activity, Zap, Radar, Layers, Wifi, Tags } from "lucide-react";
import { toast } from "sonner";
import type { Network, Host, NetworkDevice, ScanProgress as ScanProgressType } from "@/types";
import { cn, hostOpenPortsToFullLabel } from "@/lib/utils";

/** Altezza uniforme per tutti i pulsanti della toolbar azioni subnet. */
const ACTION_BTN = "h-8 min-h-8 px-2.5 text-xs font-medium shrink-0";
const ACTION_PANEL =
  "rounded-lg border-2 border-primary/45 bg-primary/5 px-2.5 pt-1.5 pb-1.5 min-w-[min(100%,14rem)] flex-1 sm:flex-none shadow-sm flex flex-col";
const ACTION_PANEL_TITLE =
  "text-[11px] font-bold uppercase tracking-wide text-primary leading-tight mb-1.5";
import {
  DEVICE_CLASSIFICATIONS_ORDERED,
  getClassificationLabel,
  sortClassificationsByDisplayLabel,
} from "@/lib/device-classifications";
import { parseDetectedDeviceFromDetectionJson } from "@/lib/device-fingerprint-classification";
import { NetworkCredentialsTable } from "@/components/shared/network-credentials-table";
import { ProtocolBadges } from "@/components/shared/protocol-badges";
import { AddableSelect } from "@/components/shared/addable-select";
import { credTypeForProtocol, CRED_TYPE_OPTIONS } from "@/lib/credential-protocol-map";
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
};

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
  initialCredentialChains: {
    windows: number[];
    linux: number[];
    ssh: number[];
    snmp: number[];
  };
  initialCredentialIds: number[];
  initialAvailableSources: Array<{ id: number; name: string; cidr: string; credential_count: number }>;
  initialHostValidatedProtocols: Record<number, string[]>;
}

export function NetworkDetailClient({
  network: initialNetwork,
  initialHosts,
  routerId: initialRouterId,
  routers,
  initialCredentialChains,
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
  const [classifyOpen, setClassifyOpen] = useState(false);
  const [addDeviceCredentials, setAddDeviceCredentials] = useState<{ id: number; name: string; credential_type: string }[]>([]);
  const [selectedHostIds, setSelectedHostIds] = useState<Set<number>>(new Set());
  const [bulkAddOpen, setBulkAddOpen] = useState(false);
  const [bulkAddClassification, setBulkAddClassification] = useState("server");
  const [bulkAddProtocol, setBulkAddProtocol] = useState("ssh");
  const [bulkAddVendor, setBulkAddVendor] = useState("other");
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
  const [credWindows, setCredWindows] = useState<number[]>(initialCredentialChains.windows);
  const [credLinux, setCredLinux] = useState<number[]>(initialCredentialChains.linux);
  const [credSsh, setCredSsh] = useState<number[]>(initialCredentialChains.ssh);
  const [credSnmp, setCredSnmp] = useState<number[]>(initialCredentialChains.snmp);
  // v2: lista unificata credenziali subnet
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
    setCredWindows(initialCredentialChains.windows);
    setCredLinux(initialCredentialChains.linux);
    setCredSsh(initialCredentialChains.ssh);
    setCredSnmp(initialCredentialChains.snmp);
  }, [initialCredentialChains]);

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
        const data = (await r.json()) as { id: number; name: string; credential_type: string }[];
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
        if (Array.isArray(data.windows_credential_ids)) setCredWindows(data.windows_credential_ids);
        if (Array.isArray(data.linux_credential_ids)) setCredLinux(data.linux_credential_ids);
        if (Array.isArray(data.ssh_credential_ids)) setCredSsh(data.ssh_credential_ids);
        if (Array.isArray(data.snmp_credential_ids)) setCredSnmp(data.snmp_credential_ids);
        // v2
        if (Array.isArray(data.network_credentials)) {
          setNetworkCredentialIds(data.network_credentials.map((c: { credential_id: number }) => c.credential_id));
        }
        if (data.host_validated_protocols) {
          setHostValidatedProtocols(data.host_validated_protocols);
        }
      }
    } catch { /* ignore */ }
  }, [network.id]);

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

  async function handleBulkAdd() {
    if (selectedHostIds.size === 0) return;
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
      windows_credential_ids: credWindows,
      linux_credential_ids: credLinux,
      ssh_credential_ids: credSsh,
      snmp_credential_ids: credSnmp,
    };
    // Salva anche credenziali v2 (lista unificata) in parallelo
    const saveV2 = fetch(`/api/networks/${network.id}/credentials`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ credential_ids: networkCredentialIds }),
    }).catch(() => null);
    try {
      const [res] = await Promise.all([
        fetch(`/api/networks/${network.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
        saveV2,
      ]);
      if (res.ok) {
        const updated = await res.json();
        setNetwork((n) => ({ ...n, ...updated }));
        setRouterId(updated.router_id ?? null);
        if (Array.isArray(updated.windows_credential_ids)) setCredWindows(updated.windows_credential_ids);
        if (Array.isArray(updated.linux_credential_ids)) setCredLinux(updated.linux_credential_ids);
        if (Array.isArray(updated.ssh_credential_ids)) setCredSsh(updated.ssh_credential_ids);
        if (Array.isArray(updated.snmp_credential_ids)) setCredSnmp(updated.snmp_credential_ids);
        if (Array.isArray(updated.network_credentials)) {
          setNetworkCredentialIds(updated.network_credentials.map((c: { credential_id: number }) => c.credential_id));
        }
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
      scanType === "scan_snmp_verify";
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
      toast.error("Errore nell'avvio della scansione");
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
      } else {
        toast.error(data.error || "Errore enrich");
      }
    } catch {
      toast.error("Errore di rete");
    } finally {
      setEnriching(false);
    }
  }

  async function triggerAdvancedDetection() {
    if (selectedHostIds.size === 0) {
      toast.error("Seleziona uno o più host nella vista lista (azioni manuali solo sugli IP selezionati)");
      return;
    }
    toast.info("Rilevamento avanzato — fase 1/2: WinRM (Windows)…");
    const phase1 = await runScanJob("windows", { showStartToast: false, refreshOnComplete: true });
    if (!phase1.ok) {
      toast.error(
        phase1.lastProgress?.status === "failed"
          ? "Fase WinRM terminata con errori"
          : "Impossibile completare la fase WinRM"
      );
      setScanning(null);
      return;
    }
    toast.info("Rilevamento avanzato — fase 2/2: SSH (Linux)…");
    const phase2 = await runScanJob("ssh", { showStartToast: false, refreshOnComplete: true });
    if (!phase2.ok) {
      toast.error(
        phase2.lastProgress?.status === "failed"
          ? "Fase SSH terminata con errori"
          : "Impossibile completare la fase SSH"
      );
      setScanning(null);
      return;
    }
    toast.success("Rilevamento avanzato completato (WinRM + SSH)");
    setScanning(null);
  }

  const onlineCount = hosts.filter((h) => h.status === "online").length;
  const offlineCount = hosts.filter((h) => h.status === "offline").length;

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

        {/* Toolbar a fasi: area principale in evidenza rispetto ad auto-refresh sotto */}
        <div className="space-y-2">
          <div className="rounded-xl border-2 border-primary/20 bg-card/95 shadow-md ring-1 ring-primary/10 p-3">
            <p className="text-xs font-semibold text-foreground mb-1.5 flex items-center gap-2">
              <span className="rounded bg-primary/15 text-primary px-1.5 py-0.5 text-[10px] uppercase tracking-wide">Azioni</span>
              Scansione e acquisizione dati
            </p>
            <div className="flex flex-wrap gap-2 items-stretch content-start">

            {/* ─── SCAN — intera subnet ─────────────────────────────── */}
            <div className={`${ACTION_PANEL} min-w-[min(100%,22rem)]`}>
              <p className={ACTION_PANEL_TITLE}>Scan — intera subnet</p>
              <div className="flex flex-col gap-1.5 flex-1 justify-end">
                <Button
                  size="default"
                  variant="default"
                  className={cn("w-full", ACTION_BTN)}
                  onClick={() => triggerScan("scan_full")}
                  disabled={!!scanning || enriching}
                  title="Scan completo: ICMP → Nmap base → SNMP verify → Enrich (ARP/DHCP/AD)"
                >
                  <Radar className="h-3.5 w-3.5 mr-1 shrink-0" />
                  Scan completo
                </Button>
                <div className="flex flex-nowrap gap-1 overflow-x-auto pb-0.5">
                  <Button
                    size="default"
                    variant="outline"
                    className={cn(ACTION_BTN, "bg-background/90")}
                    onClick={() => triggerScan("scan_icmp")}
                    disabled={!!scanning || enriching}
                    title="1.1 — Solo ICMP sweep + second-pass TCP. Additivo, niente flip offline."
                  >
                    <Zap className="h-3.5 w-3.5 mr-1 shrink-0" />
                    ICMP
                  </Button>
                  <Button
                    size="default"
                    variant="outline"
                    className={cn(ACTION_BTN, "bg-background/90")}
                    onClick={() => triggerScan("scan_nmap_base")}
                    disabled={!!scanning || enriching}
                    title="1.2 — Nmap quick TCP sugli host già online in DB"
                  >
                    <Scan className="h-3.5 w-3.5 mr-1 shrink-0" />
                    Nmap base
                  </Button>
                  <Button
                    size="default"
                    variant="outline"
                    className={cn(ACTION_BTN, "bg-background/90")}
                    onClick={() => triggerScan("scan_snmp_verify")}
                    disabled={!!scanning || enriching}
                    title="1.3 — SNMP sysObjectID probe (community subnet + public)"
                  >
                    <Cpu className="h-3.5 w-3.5 mr-1 shrink-0" />
                    SNMP verify
                  </Button>
                  <Button
                    size="default"
                    variant="outline"
                    className={cn(ACTION_BTN, "bg-background/90")}
                    onClick={() => void triggerEnrich(false)}
                    disabled={!!scanning || enriching}
                    title="1.4 — ARP router + DHCP MikroTik + DNS + AD relink (cache)"
                  >
                    <Layers className="h-3.5 w-3.5 mr-1 shrink-0" />
                    {enriching ? "Enrich…" : "Enrich"}
                  </Button>
                  <Button
                    size="default"
                    variant="outline"
                    className={cn(ACTION_BTN, "bg-background/90")}
                    onClick={() => void triggerEnrich(true)}
                    disabled={!!scanning || enriching}
                    title="1.4 + sync LDAP fresco dall'AD prima del relink (più lento, 10-60s)"
                  >
                    <Wifi className="h-3.5 w-3.5 mr-1 shrink-0" />
                    Enrich + AD sync
                  </Button>
                </div>
              </div>
            </div>

            {/* ─── DETECT — host selezionati ─────────────────────────── */}
            <div className={ACTION_PANEL}>
              <p className={ACTION_PANEL_TITLE}>Detect — host selezionati</p>
              <div className="flex flex-nowrap gap-1.5 overflow-x-auto pb-0.5 flex-1 items-end">
                <Button
                  size="default"
                  variant="default"
                  className={ACTION_BTN}
                  onClick={() => triggerScan("nmap")}
                  disabled={!!scanning || view !== "list" || selectedHostIds.size === 0}
                  title="Nmap profilo completo: port scan TCP/UDP esteso + SNMP unificato"
                >
                  <Scan className="h-3.5 w-3.5 mr-1 shrink-0" />
                  Nmap adv
                </Button>
                <Button
                  size="default"
                  variant="outline"
                  className={cn(ACTION_BTN, "bg-background/90")}
                  onClick={() => triggerScan("snmp")}
                  disabled={!!scanning || view !== "list" || selectedHostIds.size === 0}
                  title="SNMP deep walk: produttore, modello, firmware, seriale, ARP table, OID fingerprint"
                >
                  <Cpu className="h-3.5 w-3.5 mr-1 shrink-0" />
                  SNMP deep
                </Button>
                <Button
                  size="default"
                  variant="outline"
                  className={cn(ACTION_BTN, "bg-background/90")}
                  onClick={() => void triggerAdvancedDetection()}
                  disabled={!!scanning || view !== "list" || selectedHostIds.size === 0}
                  title="WinRM (Windows) + SSH (Linux) in sequenza"
                >
                  <Sparkles className="h-3.5 w-3.5 mr-1 shrink-0" />
                  Rilevamento OS
                </Button>
              </div>
            </div>

            {/* ─── CREDENZIALI — host selezionati ────────────────────── */}
            <div className={ACTION_PANEL}>
              <p className={ACTION_PANEL_TITLE}>Test credenziali</p>
              <Button
                size="default"
                variant="default"
                className={cn("w-full mt-auto", ACTION_BTN)}
                onClick={() => triggerScan("credential_validate")}
                disabled={!!scanning || networkCredentialIds.length === 0 || view !== "list" || selectedHostIds.size === 0}
                title={networkCredentialIds.length === 0
                  ? "Configura credenziali nella modifica rete"
                  : "Verifica SSH/WinRM/SNMP della subnet sugli IP selezionati. Le credenziali validate vengono salvate sul host."}
              >
                <Key className="h-3.5 w-3.5 mr-1 shrink-0" />
                Verifica SSH/WinRM
              </Button>
            </div>

            {/* ─── CLASSIFICAZIONE ──────────────────────────────────── */}
            <div className="rounded-lg border border-dashed border-border bg-muted/25 px-2.5 pt-1.5 pb-1.5 min-w-[min(100%,12rem)] flex-1 sm:flex-none flex flex-col">
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide leading-tight mb-1.5">
                Classificazione
              </p>
              <div className="flex flex-nowrap gap-1.5 overflow-x-auto pb-0.5 items-center mt-auto">
                <Button
                  size="default"
                  variant="secondary"
                  className={ACTION_BTN}
                  onClick={() => setClassifyOpen(true)}
                  disabled={!!scanning || enriching}
                  title="Analizza proposte: mostra anteprima delle riclassificazioni e applica solo quelle scelte"
                >
                  <Tags className="h-3.5 w-3.5 mr-1" />
                  Analizza proposte
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 shrink-0"
                  onClick={() => refreshHosts()}
                  title="Aggiorna elenco"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            {/* ─── VA SCAN — vulnerability assessment (ultimo) ─────────── */}
            <div className="rounded-lg border-2 border-purple-500/45 bg-purple-500/5 px-2.5 pt-1.5 pb-1.5 min-w-[min(100%,14rem)] flex-1 sm:flex-none shadow-sm flex flex-col sm:max-w-[16rem]">
              <p className="text-[11px] font-bold uppercase tracking-wide text-purple-800 dark:text-purple-300 leading-tight mb-1.5">
                VA Scan
              </p>
              <div className="mt-auto">
                <SubnetEdgeScanPanel networkId={network.id} disabled={!!scanning || enriching} />
              </div>
            </div>

            </div>
          </div>

          <SubnetScheduleCard networkId={network.id} />

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
              {view === "list" ? (
                <>
                  <div className="min-w-0 shrink">
                    <p className="text-[11px] font-semibold text-foreground leading-tight">
                      Selezione in lista
                    </p>
                    <p className="text-[10px] text-muted-foreground leading-snug">
                      {selectedHostIds.size === 0
                        ? "Spunta gli host nella tabella per le azioni a sinistra."
                        : `${selectedHostIds.size} host selezionati`}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1.5 items-center">
                    <Button
                      variant="default"
                      size="default"
                      className="font-medium"
                      onClick={() => setBulkAddOpen(true)}
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

      {/* Vista: subito dopo le azioni principali (prima di statistiche e auto-refresh) */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-medium text-muted-foreground mr-1">Visualizzazione</span>
        <Button
          variant={view === "grid" ? "secondary" : "outline"}
          size="default"
          onClick={() => setView("grid")}
        >
          <LayoutGrid className="h-4 w-4 mr-1.5" />
          Griglia IP
        </Button>
        <Button
          variant={view === "list" ? "secondary" : "outline"}
          size="default"
          onClick={() => setView("list")}
        >
          <List className="h-4 w-4 mr-1.5" />
          Lista
        </Button>
      </div>

      {/* Stats - minimali */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5 text-xs">
        <span className="text-muted-foreground">Host Totali <span className="font-semibold text-foreground">{hosts.length}</span></span>
        <span className="text-muted-foreground">Online <span className="font-semibold text-success">{onlineCount}</span></span>
        <span className="text-muted-foreground">Offline <span className="font-semibold text-destructive">{offlineCount}</span></span>
        <span className="text-muted-foreground">Gateway <span className="font-mono font-semibold text-foreground">{network.gateway || "—"}</span></span>
        {(routerId || network.snmp_community || network.dns_server) && (
          <span className="text-muted-foreground">
            {[
              routerId && `Router: ${routers.find((r) => r.id === routerId)?.name ?? routerId}`,
              network.snmp_community && `SNMP: ${network.snmp_community}`,
              network.dns_server && `DNS: ${network.dns_server}`,
            ].filter(Boolean).join(" · ")}
          </span>
        )}
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
              onClassificationChange={(v) => setBulkAddClassification(v)}
              onVendorChange={(v) => {
                setBulkAddVendor(v);
                if (v !== "hp") setBulkAddVendorSubtype(null);
                const nextP = coerceProtocolForVendor(v, bulkAddProtocol);
                if (nextP !== bulkAddProtocol) setBulkAddProtocol(nextP);
                const nextS = coerceScanTargetForVendor(v, bulkAddScanTarget);
                if (nextS !== bulkAddScanTarget) setBulkAddScanTarget(nextS);
              }}
              onVendorSubtypeChange={(v) => setBulkAddVendorSubtype(v)}
              onProtocolChange={(v) => setBulkAddProtocol(v)}
              onScanTargetChange={(v) => setBulkAddScanTarget(v)}
              onCredentialIdChange={(v) => setBulkAddCredentialId(v)}
              onSnmpCredentialIdChange={(v) => setBulkAddSnmpCredentialId(v)}
              vendorOptions={bulkVendorOptions}
              defaultClassification="server"
              defaultVendor="other"
              defaultProtocol="ssh"
            />

            {/* Credenziali: scelta esplicita + creazione inline ─ con badge eredità automatica */}
            {(() => {
              const credMap = credTypeForProtocol(bulkAddProtocol);
              const primaryOpts = addDeviceCredentials.filter((c) => c.credential_type !== "snmp");
              const snmpOpts = addDeviceCredentials.filter((c) => c.credential_type === "snmp");
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
                        options={primaryOpts.map((c) => ({ id: c.id, label: c.name, extra: c.credential_type }))}
                        entityLabel="credenziale"
                        createApiUrl="/api/credentials"
                        extraFields={[
                          { key: "credential_type", label: "Tipo", type: "select", required: true, defaultValue: credMap.primary, options: CRED_TYPE_OPTIONS },
                          { key: "username", label: "Username", placeholder: "admin" },
                          { key: "password", label: "Password / Community", type: "password", required: true },
                        ]}
                        onCreated={refreshCredentialsList}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Credenziale SNMP (opzionale)</Label>
                      <AddableSelect
                        value={bulkAddSnmpCredentialId && bulkAddSnmpCredentialId !== "none" ? Number(bulkAddSnmpCredentialId) : null}
                        onChange={(v) => setBulkAddSnmpCredentialId(v != null ? String(v) : null)}
                        options={snmpOpts.map((c) => ({ id: c.id, label: c.name }))}
                        entityLabel="credenziale SNMP"
                        createApiUrl="/api/credentials"
                        extraFields={[
                          { key: "credential_type", label: "Tipo", type: "select", required: true, defaultValue: "snmp", options: [{ value: "snmp", label: "SNMP" }] },
                          { key: "password", label: "Community string", type: "password", required: true, placeholder: "public" },
                        ]}
                        onCreated={refreshCredentialsList}
                      />
                    </div>
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
                      }),
                    });
                    const data = await res.json();
                    if (res.ok && data.success) {
                      setBulkTestResult({ ok: true, message: data.message || `Connessione a ${firstHost.ip} riuscita` });
                    } else {
                      setBulkTestResult({ ok: false, message: data.error || "Connessione fallita" });
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
              <Button onClick={handleBulkAdd} disabled={bulkAddSaving} className="flex-1">
                {bulkAddSaving ? "Aggiunta in corso..." : "Aggiungi dispositivi"}
              </Button>
            </div>
          </div>
          </DialogScrollableArea>
        </DialogContent>
      </Dialog>

      {view === "list" && (
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 p-2 border-b">
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
            <div className="flex items-center gap-1 ml-auto">
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
          </div>
          <Table>
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
                <SortableTableHead columnId="classification" sortColumn={listSortColumn} sortDirection={listSortDir} onSort={handleListSort}>
                  Classificazione
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
                          {new Date(host.last_seen).toLocaleDateString("it-IT", { day: "2-digit", month: "short" })}{" "}
                          {new Date(host.last_seen).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}
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
                      className="min-w-[140px] cursor-text"
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
                      ) : (
                        <Badge variant="outline">{host.classification ? getClassificationLabel(host.classification) : "—"}</Badge>
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

      <ClassificationProposalDialog
        open={classifyOpen}
        onOpenChange={setClassifyOpen}
        networkId={network.id}
        onApplied={() => { void refreshHosts(); router.refresh(); }}
      />
    </div>
  );
}
