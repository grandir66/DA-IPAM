"use client";

import { useState, useCallback, useEffect, useRef } from "react";
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
  DialogTitle,
  DialogTrigger,
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
import { ArrowLeft, Play, Scan, Download, LayoutGrid, List, Pencil, RefreshCw, CheckCircle2, Network as NetworkIcon, Cpu, ExternalLink, X, Plus, Server, Sparkles, Trash2, UserCheck, UserX, Monitor, Terminal } from "lucide-react";
import { toast } from "sonner";
import type { Network, Host, NetworkDevice, ScanProgress as ScanProgressType } from "@/types";

type HostWithDevice = Host & { device_id?: number; device?: { id: number; name: string; sysname: string | null; vendor: string; protocol: string } };
import { cn } from "@/lib/utils";
import { DEVICE_CLASSIFICATIONS_ORDERED, getClassificationLabel } from "@/lib/device-classifications";
import { parseDetectedDeviceFromDetectionJson } from "@/lib/device-fingerprint-classification";
import { CredentialAssignmentFields } from "@/components/shared/credential-assignment-fields";
import { NetworkCredentialChains } from "@/components/shared/network-credential-chains";

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
}

export function NetworkDetailClient({
  network: initialNetwork,
  initialHosts,
  routerId: initialRouterId,
  routers,
  initialCredentialChains,
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
  const [editingHostId, setEditingHostId] = useState<number | null>(null);
  const [editingField, setEditingField] = useState<"custom_name" | "notes" | "classification" | null>(null);
  const [arpPolling, setArpPolling] = useState(false);
  const [dhcpPolling, setDhcpPolling] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [dnsResolving, setDnsResolving] = useState(false);
  const [addDeviceCredentials, setAddDeviceCredentials] = useState<{ id: number; name: string; credential_type: string }[]>([]);
  const [selectedHostIds, setSelectedHostIds] = useState<Set<number>>(new Set());
  const [bulkAddOpen, setBulkAddOpen] = useState(false);
  const [bulkAddClassification, setBulkAddClassification] = useState("server");
  const [bulkAddProtocol, setBulkAddProtocol] = useState("ssh");
  const [bulkAddVendor, setBulkAddVendor] = useState("mikrotik");
  const [bulkAddCredentialId, setBulkAddCredentialId] = useState<string | null>(null);
  const [bulkAddSnmpCredentialId, setBulkAddSnmpCredentialId] = useState<string | null>(null);
  const [bulkAddVendorSubtype, setBulkAddVendorSubtype] = useState<string | null>(null);
  const [bulkAddSaving, setBulkAddSaving] = useState(false);
  const [bulkHostBusy, setBulkHostBusy] = useState(false);
  const [credWindows, setCredWindows] = useState<number[]>(initialCredentialChains.windows);
  const [credLinux, setCredLinux] = useState<number[]>(initialCredentialChains.linux);
  const [credSsh, setCredSsh] = useState<number[]>(initialCredentialChains.ssh);
  const [credSnmp, setCredSnmp] = useState<number[]>(initialCredentialChains.snmp);

  useEffect(() => {
    setCredWindows(initialCredentialChains.windows);
    setCredLinux(initialCredentialChains.linux);
    setCredSsh(initialCredentialChains.ssh);
    setCredSnmp(initialCredentialChains.snmp);
  }, [initialCredentialChains]);

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
      const payload = field === "known_host" ? { known_host: value as 0 | 1 } : { [field]: value };
      const res = await fetch(`/api/hosts/${hostId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const updated = await res.json();
        setHosts((prev) => prev.map((h) => (h.id === hostId ? { ...(updated as Host), device_id: (h as HostWithDevice).device_id } : h)));
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

  const toggleSelectHost = (id: number) => {
    setSelectedHostIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAllHosts = () => {
    if (selectedHostIds.size === filteredHosts.length) {
      setSelectedHostIds(new Set());
    } else {
      setSelectedHostIds(new Set(filteredHosts.map((h) => h.id)));
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
        vendor_subtype: bulkAddProtocol === "ssh" && bulkAddVendor === "hp" && bulkAddVendorSubtype ? bulkAddVendorSubtype : null,
      };
      if (bulkAddProtocol === "ssh" || bulkAddProtocol === "api" || bulkAddProtocol === "winrm") body.vendor = bulkAddVendor;
      if (hasCred) body.credential_id = Number(bulkAddCredentialId);
      if (hasSnmpCred) body.snmp_credential_id = Number(bulkAddSnmpCredentialId);
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

  async function handleSaveEdit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    const form = e.currentTarget;
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
        if (Array.isArray(updated.windows_credential_ids)) setCredWindows(updated.windows_credential_ids);
        if (Array.isArray(updated.linux_credential_ids)) setCredLinux(updated.linux_credential_ids);
        if (Array.isArray(updated.ssh_credential_ids)) setCredSsh(updated.ssh_credential_ids);
        if (Array.isArray(updated.snmp_credential_ids)) setCredSnmp(updated.snmp_credential_ids);
        setEditOpen(false);
        toast.success("Rete aggiornata");
        router.refresh();
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

  const SCAN_LABELS: Record<
    "network_discovery" | "snmp" | "nmap" | "windows" | "ssh",
    string
  > = {
    network_discovery: "Scoperta rete",
    snmp: "SNMP",
    nmap: "Nmap",
    windows: "WinRM (Windows)",
    ssh: "SSH (Linux)",
  };

  async function runScanJob(
    scanType: "network_discovery" | "snmp" | "nmap" | "windows" | "ssh",
    options?: { showStartToast?: boolean; refreshOnComplete?: boolean }
  ): Promise<{ ok: boolean; lastProgress: ScanProgressType | null }> {
    const showStartToast = options?.showStartToast !== false;
    const refreshOnComplete = options?.refreshOnComplete !== false;

    if (scanType !== "network_discovery" && selectedHostIds.size === 0) {
      toast.error("Seleziona uno o più host nella vista lista (azioni manuali solo sugli IP selezionati)");
      return { ok: false, lastProgress: null };
    }
    const body: Record<string, unknown> = {
      network_id: network.id,
      scan_type: scanType,
    };
    if (scanType !== "network_discovery" && selectedHostIds.size > 0) {
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
      const interval = setInterval(() => {
        void (async () => {
          try {
            const progressRes = await fetch(`/api/scans/progress/${data.id}`);
            if (progressRes.ok) {
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

  async function triggerScan(scanType: "network_discovery" | "snmp" | "nmap" | "windows" | "ssh") {
    await runScanJob(scanType);
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

  async function triggerArpPoll() {
    if (selectedHostIds.size === 0) {
      toast.error("Seleziona uno o più host nella lista (ARP manuale solo su IP selezionati)");
      return;
    }
    setArpPolling(true);
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60000);
      const res = await fetch("/api/scans/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          network_id: network.id,
          scan_type: "arp_poll",
          host_ids: Array.from(selectedHostIds),
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (res.ok) {
        const data = await res.json();
        toast.success(data.progress?.phase ?? "MAC recuperati dai router");
        await refreshHosts();
      } else {
        const data = await res.json();
        toast.error(data.error || "Errore nel recupero MAC");
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        toast.error("Timeout: il router non ha risposto entro 60 secondi");
      } else {
        toast.error("Errore nel recupero MAC");
      }
    } finally {
      setArpPolling(false);
    }
  }

  async function triggerDnsResolve() {
    if (selectedHostIds.size === 0) {
      toast.error("Seleziona uno o più host nella lista (DNS manuale solo su IP selezionati)");
      return;
    }
    setDnsResolving(true);
    try {
      const res = await fetch("/api/scans/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          network_id: network.id,
          scan_type: "dns",
          host_ids: Array.from(selectedHostIds),
        }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(data.progress?.phase || "DNS completato");
        refreshHosts();
        router.refresh();
      } else {
        toast.error(data.error || "Errore DNS");
      }
    } catch {
      toast.error("Errore di rete");
    } finally {
      setDnsResolving(false);
    }
  }

  async function triggerRefresh(force = false) {
    if (force && !confirm("Ricalcola forzato: sovrascrive TUTTE le classificazioni, anche quelle impostate manualmente. Continuare?")) return;
    setRefreshing(true);
    try {
      const res = await fetch(`/api/networks/${network.id}/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(data.message);
        refreshHosts();
        router.refresh();
      } else {
        toast.error(data.error || "Errore nell'aggiornamento");
      }
    } catch {
      toast.error("Errore di rete");
    } finally {
      setRefreshing(false);
    }
  }

  const currentRouter = routerId ? routers.find((r) => r.id === routerId) : null;
  const canDhcp = currentRouter?.vendor === "mikrotik" && currentRouter?.protocol === "ssh";

  async function triggerDhcpPoll() {
    if (!canDhcp) return;
    if (selectedHostIds.size === 0) {
      toast.error("Seleziona uno o più host nella lista (DHCP manuale solo su IP selezionati)");
      return;
    }
    setDhcpPolling(true);
    try {
      const res = await fetch("/api/scans/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          network_id: network.id,
          scan_type: "dhcp",
          host_ids: Array.from(selectedHostIds),
        }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(data.progress?.phase ?? "Host aggiornati da DHCP");
        await refreshHosts();
      } else {
        toast.error(data.error || "Errore nel recupero DHCP");
      }
    } catch {
      toast.error("Errore nel recupero DHCP");
    } finally {
      setDhcpPolling(false);
    }
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
            <Dialog open={editOpen} onOpenChange={setEditOpen}>
              <DialogTrigger render={<Button variant="outline" size="sm" />}>
                <Pencil className="h-4 w-4 mr-2" />
                Modifica
              </DialogTrigger>
              <DialogContent className="sm:max-w-4xl max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Modifica Rete</DialogTitle>
                </DialogHeader>
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
                <NetworkCredentialChains
                  credentials={addDeviceCredentials}
                  windowsIds={credWindows}
                  linuxIds={credLinux}
                  sshIds={credSsh}
                  snmpIds={credSnmp}
                  onWindowsChange={setCredWindows}
                  onLinuxChange={setCredLinux}
                  onSshChange={setCredSsh}
                  onSnmpChange={setCredSnmp}
                  onCredentialsRefresh={refreshCredentialsList}
                />
                <Button type="submit" className="w-full" disabled={saving}>
                  {saving ? "Salvataggio..." : "Salva"}
                </Button>
                </form>
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
            <div className="flex flex-wrap gap-2 items-start content-start">
            {/* Fase 1 */}
            <div
              className="rounded-lg border-2 border-primary/45 bg-primary/5 px-2.5 pt-1.5 pb-1.5 min-w-[min(100%,14rem)] flex-1 sm:flex-none sm:max-w-[min(100%,18rem)] shadow-sm"
              title="ICMP, Nmap rapido, DNS, ARP router (passi 1.1–1.4)"
            >
              <p className="text-[11px] font-bold uppercase tracking-wide text-primary leading-tight mb-1">
                Fase 1 — Scoperta rete
              </p>
              <div className="flex flex-nowrap gap-1.5 overflow-x-auto pb-0.5">
                <Button
                  size="default"
                  variant="default"
                  className="font-medium"
                  onClick={() => triggerScan("network_discovery")}
                  disabled={!!scanning}
                  title="Avvia scoperta rete completa"
                >
                  <Play className="h-4 w-4 mr-1.5 shrink-0" />
                  Scoperta rete
                </Button>
                <Link
                  href="/monitoring/known-hosts"
                  title="Monitoraggio continuo host conosciuti (1.5)"
                  className={cn(
                    buttonVariants({ variant: "outline", size: "default" }),
                    "border-primary/30 bg-background font-medium"
                  )}
                >
                  <Monitor className="h-4 w-4 mr-1.5 shrink-0" />
                  Host conosciuti
                </Link>
              </div>
            </div>

            {/* Dati subnet (non numerato) */}
            <div
              className="rounded-lg border border-border/80 bg-muted/40 px-2.5 pt-1.5 pb-1.5 min-w-[min(100%,14rem)] flex-1 sm:flex-none sm:max-w-[min(100%,18rem)]"
              title="ARP, DHCP, DNS su IP selezionati (vista lista)"
            >
              <p className="text-[11px] font-semibold text-foreground/90 leading-tight mb-1">
                Dati su IP selezionati
              </p>
              <div className="flex flex-nowrap gap-1.5 overflow-x-auto pb-0.5">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={triggerArpPoll}
                  disabled={arpPolling || !!scanning || view !== "list" || selectedHostIds.size === 0}
                  title={view !== "list" ? "Passa alla vista lista e seleziona gli IP" : "MAC dal router"}
                >
                  <NetworkIcon className="h-3.5 w-3.5 mr-1" />
                  {arpPolling ? "ARP…" : "ARP"}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={triggerDhcpPoll}
                  disabled={!canDhcp || dhcpPolling || !!scanning || view !== "list" || selectedHostIds.size === 0}
                  title={canDhcp ? "Lease DHCP MikroTik" : "Richiede router MikroTik SSH"}
                >
                  {dhcpPolling ? "DHCP…" : "DHCP"}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => { void triggerDnsResolve(); }}
                  disabled={dnsResolving || !!scanning || view !== "list" || selectedHostIds.size === 0}
                  title="Risoluzione DNS"
                >
                  {dnsResolving ? "DNS…" : "DNS"}
                </Button>
              </div>
            </div>

            {/* Fase 2 */}
            <div className="rounded-lg border-2 border-primary/45 bg-primary/5 px-2.5 pt-1.5 pb-1.5 min-w-[min(100%,10rem)] flex-1 sm:flex-none shadow-sm">
              <p className="text-[11px] font-bold uppercase tracking-wide text-primary leading-tight mb-1">
                Fase 2 — Nmap
              </p>
              <Button
                size="default"
                variant="default"
                className="w-full font-medium"
                onClick={() => triggerScan("nmap")}
                disabled={!!scanning || view !== "list" || selectedHostIds.size === 0}
                title="Profilo Nmap dalle impostazioni"
              >
                <Scan className="h-4 w-4 mr-1.5 shrink-0" />
                Nmap profilo
              </Button>
            </div>

            {/* Fase 3 */}
            <div className="rounded-lg border-2 border-primary/45 bg-primary/5 px-2.5 pt-1.5 pb-1.5 min-w-[min(100%,10rem)] flex-1 sm:flex-none shadow-sm">
              <p className="text-[11px] font-bold uppercase tracking-wide text-primary leading-tight mb-1">
                Fase 3 — SNMP
              </p>
              <Button
                size="default"
                variant="default"
                className="w-full font-medium"
                onClick={() => triggerScan("snmp")}
                disabled={!!scanning || view !== "list" || selectedHostIds.size === 0}
                title="Query SNMP sugli host selezionati"
              >
                <Cpu className="h-4 w-4 mr-1.5 shrink-0" />
                SNMP
              </Button>
            </div>

            {/* Fase 4 — una sola riga pulsanti (nowrap + scroll orizzontale se serve) */}
            <div
              className="rounded-lg border-2 border-primary/45 bg-primary/5 px-2.5 pt-1.5 pb-1.5 min-w-0 w-full sm:min-w-[min(100%,18rem)] sm:max-w-[min(100%,26rem)] flex-1 sm:flex-none shadow-sm"
              title="Sottovoci: avanzato (WinRM+SSH), oppure WinRM/SSH singoli"
            >
              <p className="text-[11px] font-bold uppercase tracking-wide text-primary leading-tight mb-1">
                Fase 4 — Rilevamento OS
              </p>
              <div className="flex flex-nowrap items-center gap-1 sm:gap-1.5 overflow-x-auto overscroll-x-contain pb-0.5 -mx-0.5 px-0.5 [scrollbar-width:thin]">
                <Button
                  size="sm"
                  variant="default"
                  className="shrink-0 font-medium h-8 text-xs sm:text-sm px-2 sm:px-3"
                  onClick={() => void triggerAdvancedDetection()}
                  disabled={!!scanning || view !== "list" || selectedHostIds.size === 0}
                  title="Sequenza WinRM poi SSH"
                >
                  <Sparkles className="h-3.5 w-3.5 sm:h-4 sm:w-4 mr-1 shrink-0" />
                  <span className="hidden min-[420px]:inline">Rilevamento avanzato</span>
                  <span className="min-[420px]:hidden">Avanzato</span>
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0 bg-background/90 font-medium h-8"
                  onClick={() => triggerScan("windows")}
                  disabled={!!scanning || view !== "list" || selectedHostIds.size === 0}
                  title="Solo WinRM"
                >
                  <Server className="h-3.5 w-3.5 mr-1" />
                  WinRM
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0 bg-background/90 font-medium h-8"
                  onClick={() => triggerScan("ssh")}
                  disabled={!!scanning || view !== "list" || selectedHostIds.size === 0}
                  title="Solo SSH"
                >
                  <Terminal className="h-3.5 w-3.5 mr-1" />
                  SSH
                </Button>
              </div>
            </div>

            {/* Classificazione */}
            <div className="rounded-lg border border-dashed border-border bg-muted/25 px-2.5 pt-1.5 pb-1.5 min-w-[min(100%,12rem)] flex-1 sm:flex-none">
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide leading-tight mb-1">
                Classificazione
              </p>
              <div className="flex flex-nowrap gap-1.5 overflow-x-auto pb-0.5">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => triggerRefresh(false)}
                  disabled={refreshing || !!scanning}
                  title="Ricalcola (rispetta manuali)"
                >
                  <RefreshCw className={`h-3.5 w-3.5 mr-1 ${refreshing ? "animate-spin" : ""}`} />
                  {refreshing ? "…" : "Ricalcola"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-orange-600 border-orange-300 hover:bg-orange-50 dark:text-orange-400 dark:border-orange-700 dark:hover:bg-orange-950"
                  onClick={() => triggerRefresh(true)}
                  disabled={refreshing || !!scanning}
                  title="Forza (sovrascrive manuali)"
                >
                  Forza
                </Button>
                <Button variant="ghost" size="icon-sm" className="size-8 shrink-0" onClick={() => refreshHosts()} title="Aggiorna elenco">
                  <RefreshCw className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
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

      <Dialog open={bulkAddOpen} onOpenChange={setBulkAddOpen}>
        <DialogContent className="sm:max-w-4xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Aggiungi {selectedHostIds.size} dispositivo{selectedHostIds.size !== 1 ? "i" : ""}</DialogTitle>
            <CardDescription>
              Categoria, protocollo di scansione (SSH/SNMP) e credenziali opzionali.
            </CardDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Categoria</Label>
              <Select value={bulkAddClassification} onValueChange={(v) => v && setBulkAddClassification(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DEVICE_CLASSIFICATIONS_ORDERED.map((c) => (
                    <SelectItem key={c} value={c}>
                      {getClassificationLabel(c)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Protocollo di scansione</Label>
              <Select value={bulkAddProtocol} onValueChange={(v) => { if (v) { setBulkAddProtocol(v as "ssh" | "snmp_v2" | "snmp_v3" | "api" | "winrm"); if (v !== "ssh" && v !== "api" && v !== "winrm") setBulkAddVendorSubtype(null); else setBulkAddSnmpCredentialId(null); } }}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ssh">SSH</SelectItem>
                  <SelectItem value="snmp_v2">SNMP v2</SelectItem>
                  <SelectItem value="snmp_v3">SNMP v3</SelectItem>
                  <SelectItem value="api">API</SelectItem>
                  <SelectItem value="winrm">WinRM / WMI (Windows)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {(bulkAddProtocol === "ssh" || bulkAddProtocol === "api" || bulkAddProtocol === "winrm") && (
              <>
                <div className="space-y-2">
                  <Label>Profilo vendor (per comandi SSH)</Label>
                  <Select value={bulkAddVendor} onValueChange={(v) => { if (v) { setBulkAddVendor(v); if (v !== "hp") setBulkAddVendorSubtype(null); } }}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="mikrotik">MikroTik</SelectItem>
                      <SelectItem value="cisco">Cisco</SelectItem>
                      <SelectItem value="hp">HP</SelectItem>
                      <SelectItem value="ubiquiti">Ubiquiti</SelectItem>
                      <SelectItem value="omada">Omada</SelectItem>
                      <SelectItem value="stormshield">Stormshield</SelectItem>
                      <SelectItem value="proxmox">Proxmox</SelectItem>
                      <SelectItem value="vmware">VMware</SelectItem>
                      <SelectItem value="linux">Linux</SelectItem>
                      <SelectItem value="windows">Windows</SelectItem>
                      <SelectItem value="synology">Synology</SelectItem>
                      <SelectItem value="qnap">QNAP</SelectItem>
                      <SelectItem value="other">Altro</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {bulkAddVendor === "hp" && (
                  <div className="space-y-2">
                    <Label>Sottotipo HP</Label>
                    <Select value={bulkAddVendorSubtype ?? "procurve"} onValueChange={(v) => setBulkAddVendorSubtype(v === "procurve" || v === "comware" ? v : null)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="procurve">ProCurve</SelectItem>
                        <SelectItem value="comware">Comware</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </>
            )}
            <CredentialAssignmentFields
              credentials={addDeviceCredentials}
              credentialId={bulkAddCredentialId}
              snmpCredentialId={bulkAddSnmpCredentialId}
              onCredentialIdChange={(v) => setBulkAddCredentialId(v)}
              onSnmpCredentialIdChange={(v) => setBulkAddSnmpCredentialId(v)}
              credentialPlaceholder="Nessuna"
              snmpPlaceholder="Nessuna"
              idPrefix="network-bulk-add"
            />
            <Button onClick={handleBulkAdd} disabled={bulkAddSaving} className="w-full">
              {bulkAddSaving ? "Aggiunta in corso..." : "Aggiungi dispositivi"}
            </Button>
          </div>
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
                {DEVICE_CLASSIFICATIONS_ORDERED.map((c) => (
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
                {DEVICE_CLASSIFICATIONS_ORDERED.map((c) => (
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
                    checked={filteredHosts.length > 0 && selectedHostIds.size === filteredHosts.length}
                    onCheckedChange={toggleSelectAllHosts}
                    aria-label="Seleziona tutti"
                  />
                </TableHead>
                <TableHead className="w-12 text-center" title="Apri scheda host">Dettagli</TableHead>
                <TableHead>IP</TableHead>
                <TableHead>Stato</TableHead>
                <TableHead>Conosciuto</TableHead>
                <TableHead>Nome</TableHead>
                <TableHead>Classificazione</TableHead>
                <TableHead title="Tipo dispositivo da fingerprint (porte, SNMP, banner)">Rilevato</TableHead>
                <TableHead>Dispositivo</TableHead>
                <TableHead>Vendor</TableHead>
                <TableHead>Note</TableHead>
                <TableHead>Hostname</TableHead>
                <TableHead>MAC</TableHead>
                <TableHead>Porte</TableHead>
                <TableHead>Ultimo Contatto</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredHosts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={15} className="text-center text-muted-foreground py-8">
                    {hosts.length === 0
                      ? "Nessun host trovato. Avvia una scansione per scoprire i dispositivi."
                      : "Nessun host corrisponde ai filtri."}
                  </TableCell>
                </TableRow>
              ) : (
                filteredHosts.map((host) => (
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
                    <TableCell className="font-mono font-medium">{host.ip}</TableCell>
                    <TableCell><StatusBadge status={host.status} /></TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Switch
                        checked={!!host.known_host}
                        onCheckedChange={(v) => saveHostField(host.id, "known_host", v ? 1 : 0)}
                        title="Host conosciuto: monitoraggio continuo"
                      />
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
                            {DEVICE_CLASSIFICATIONS_ORDERED.map((c) => (
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
                    <TableCell className="text-muted-foreground text-sm">{host.hostname || host.dns_reverse || "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{host.mac || "—"}</TableCell>
                    <TableCell className="text-xs font-mono">
                      {host.open_ports ? (() => {
                        try {
                          const ports = JSON.parse(host.open_ports) as { port: number; protocol?: string }[];
                          return (
                            <>
                              {ports.slice(0, 10).map((p, i) => (
                                <span key={`${p.port}-${p.protocol}`}>
                                  {i > 0 && ", "}
                                  <span className={p.protocol === "udp" ? "text-primary" : ""}>{p.port}{p.protocol === "udp" ? "/u" : ""}</span>
                                </span>
                              ))}
                              {ports.length > 10 ? ` +${ports.length - 10}` : ""}
                            </>
                          );
                        } catch { return "—"; }
                      })() : "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {host.last_seen ? new Date(host.last_seen).toLocaleString("it-IT") : "Mai"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Card>
      )}

    </div>
  );
}
