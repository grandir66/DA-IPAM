"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
import { ArrowLeft, Play, Scan, Download, LayoutGrid, List, Pencil, RefreshCw, CheckCircle2, Network as NetworkIcon, Cpu, ExternalLink, X, Plus, Monitor, Server, Terminal } from "lucide-react";
import { toast } from "sonner";
import type { Network, Host, NetworkDevice, ScanProgress as ScanProgressType } from "@/types";

type HostWithDevice = Host & { device_id?: number; device?: { id: number; name: string; sysname: string | null; vendor: string; protocol: string } };
import { DEVICE_CLASSIFICATIONS_ORDERED, getClassificationLabel } from "@/lib/device-classifications";
import { CredentialAssignmentFields } from "@/components/shared/credential-assignment-fields";

const REFRESH_INTERVALS = [
  { value: 0, label: "Off" },
  { value: 30, label: "30s" },
  { value: 60, label: "1m" },
  { value: 120, label: "2m" },
  { value: 300, label: "5m" },
] as const;

interface NmapProfile {
  id: number;
  name: string;
  description: string;
  args: string;
  is_default: number;
}

interface NetworkDetailClientProps {
  network: Network;
  initialHosts: (Host & { device_id?: number })[];
  routerId: number | null;
  routers: NetworkDevice[];
  nmapProfiles: NmapProfile[];
}

export function NetworkDetailClient({
  network: initialNetwork,
  initialHosts,
  routerId: initialRouterId,
  routers,
  nmapProfiles,
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
  const [selectedProfileId, setSelectedProfileId] = useState<string>(
    nmapProfiles.length > 1
      ? String(nmapProfiles[1].id)
      : nmapProfiles.length > 0
        ? String(nmapProfiles[0].id)
        : ""
  );
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

  useEffect(() => {
    fetch("/api/credentials")
      .then((r) => (r.ok ? r.json() : []))
      .then(setAddDeviceCredentials)
      .catch(() => setAddDeviceCredentials([]));
  }, []);

  const refreshHosts = useCallback(async () => {
    try {
      const res = await fetch(`/api/networks/${network.id}`, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setHosts(data.hosts ?? []);
        setNetwork((n) => ({ ...n, ...data }));
        setRouterId(data.router_id ?? null);
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
              body: JSON.stringify({ network_id: network.id, scan_type: "ping" }),
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

  async function triggerScan(scanType: "ping" | "snmp" | "nmap" | "windows" | "ssh") {
    const body: Record<string, unknown> = {
      network_id: network.id,
      scan_type: scanType,
    };
    if (scanType === "nmap" && selectedProfileId) {
      body.nmap_profile_id = Number(selectedProfileId);
    }

    const res = await fetch("/api/scans/trigger", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      toast.error("Errore nell'avvio della scansione");
      return;
    }

    const labels: Record<string, string> = { ping: "Ping", snmp: "SNMP", nmap: "Nmap", windows: "Windows", ssh: "Linux (SSH)" };
    const data = await res.json();
    toast.success(`Scansione ${labels[scanType]} avviata`);
    setScanning(data.progress);

    if (scanIntervalRef.current) clearInterval(scanIntervalRef.current);
    const interval = setInterval(async () => {
      try {
        const progressRes = await fetch(`/api/scans/progress/${data.id}`);
        if (progressRes.ok) {
          const progress = await progressRes.json();
          setScanning(progress);
          if (progress.status === "completed" || progress.status === "failed") {
            clearInterval(interval);
            scanIntervalRef.current = null;
            // Il modale resta aperto — l'utente chiude con il pulsante
            refreshHosts();
            router.refresh();
          }
        }
      } catch {
        clearInterval(interval);
        scanIntervalRef.current = null;
        setScanning(null);
      }
    }, 1000);
    scanIntervalRef.current = interval;
  }

  async function triggerArpPoll() {
    setArpPolling(true);
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60000);
      const res = await fetch("/api/scans/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ network_id: network.id, scan_type: "arp_poll" }),
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
    setDnsResolving(true);
    try {
      const res = await fetch("/api/scans/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ network_id: network.id, scan_type: "dns" }),
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
    setDhcpPolling(true);
    try {
      const res = await fetch("/api/scans/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ network_id: network.id, scan_type: "dhcp" }),
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
      {/* Header */}
      <div className="flex items-center gap-2 flex-wrap">
        <Link href="/networks">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight">{network.name}</h1>
            <Badge variant="secondary" className="font-mono text-sm">{network.cidr}</Badge>
          </div>
          {network.description && (
            <p className="text-muted-foreground mt-1">{network.description}</p>
          )}
        </div>
        <div className="flex gap-1 flex-wrap items-center">
          {/* Gruppo 1: Scoperta host */}
          <div className="flex gap-1 items-center border-r border-border/50 pr-2 mr-1">
            <span className="text-[10px] uppercase text-muted-foreground mr-0.5 hidden lg:inline">Scoperta</span>
            <Button size="sm" variant="outline" onClick={() => triggerScan("ping")} disabled={!!scanning} title="ICMP ping — scoperta rapida host online">
              <Play className="h-3.5 w-3.5 mr-1" />
              Ping
            </Button>
            {nmapProfiles.length > 0 && (
              <>
                <select
                  className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                  value={selectedProfileId}
                  onChange={(e) => setSelectedProfileId(e.target.value)}
                >
                  {nmapProfiles.map((p) => (
                    <option key={p.id} value={String(p.id)}>{p.name}</option>
                  ))}
                </select>
                <Button size="sm" variant="outline" onClick={() => triggerScan("nmap")} disabled={!!scanning || !selectedProfileId} title="Host discovery + porte TCP/UDP + servizi">
                  <Scan className="h-3.5 w-3.5 mr-1" />
                  Nmap
                </Button>
              </>
            )}
          </div>

          {/* Gruppo 2: Arricchimento dati */}
          <div className="flex gap-1 items-center border-r border-border/50 pr-2 mr-1">
            <span className="text-[10px] uppercase text-muted-foreground mr-0.5 hidden lg:inline">Dati</span>
            <Button size="sm" variant="outline" onClick={triggerArpPoll} disabled={arpPolling || !!scanning} title="MAC address dal router via ARP table">
              <NetworkIcon className="h-3.5 w-3.5 mr-1" />
              {arpPolling ? "ARP..." : "ARP"}
            </Button>
            <Button size="sm" variant="outline" onClick={triggerDhcpPoll} disabled={!canDhcp || dhcpPolling || !!scanning} title={canDhcp ? "Hostname e MAC dai lease DHCP" : "Richiede router MikroTik SSH"}>
              {dhcpPolling ? "DHCP..." : "DHCP"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => triggerScan("snmp")} disabled={!!scanning} title="SNMP query — raccolta sysName, sysDescr, sysObjectID, serial, model">
              <Cpu className="h-3.5 w-3.5 mr-1" />
              SNMP
            </Button>
            <Button size="sm" variant="outline" onClick={() => { triggerDnsResolve(); }} disabled={dnsResolving || !!scanning} title="Reverse + forward DNS per tutti gli host">
              {dnsResolving ? "DNS..." : "DNS"}
            </Button>
          </div>

          {/* Gruppo 3: Raccolta info sistema */}
          <div className="flex gap-1 items-center border-r border-border/50 pr-2 mr-1">
            <span className="text-[10px] uppercase text-muted-foreground mr-0.5 hidden lg:inline">Sistema</span>
            <Button size="sm" variant="outline" onClick={() => triggerScan("windows")} disabled={!!scanning} title="WinRM/WMI su host online — richiede credenziali Windows">
              <Monitor className="h-3.5 w-3.5 mr-1" />
              Windows
            </Button>
            <Button size="sm" variant="outline" onClick={() => triggerScan("ssh")} disabled={!!scanning} title="SSH su host online — richiede credenziali Linux">
              <Terminal className="h-3.5 w-3.5 mr-1" />
              Linux
            </Button>
          </div>

          {/* Gruppo 4: Azioni generali */}
          <div className="flex gap-1 items-center">
            <Button size="sm" variant="secondary" onClick={() => triggerRefresh(false)} disabled={refreshing || !!scanning} title="Ricalcola classificazioni (rispetta impostazioni manuali)">
              <RefreshCw className={`h-3.5 w-3.5 mr-1 ${refreshing ? "animate-spin" : ""}`} />
              {refreshing ? "..." : "Ricalcola"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => triggerRefresh(true)} disabled={refreshing || !!scanning} title="Forza ricalcolo — sovrascrive anche classificazioni manuali" className="text-orange-600 border-orange-300 hover:bg-orange-50 dark:text-orange-400 dark:border-orange-700 dark:hover:bg-orange-950">
              Forza
            </Button>
            <Button variant="ghost" size="sm" onClick={() => refreshHosts()} title="Aggiorna visualizzazione">
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </div>
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
                <Button type="submit" className="w-full" disabled={saving}>
                  {saving ? "Salvataggio..." : "Salva"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>
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

      {/* Auto-refresh */}
      <div className="flex flex-wrap items-center gap-2 p-2 rounded-md border bg-muted/30">
        <div className="flex items-center gap-2">
          <Label htmlFor="auto-refresh" className="text-sm whitespace-nowrap">Auto-refresh</Label>
          <select
            id="auto-refresh"
            value={autoRefreshInterval}
            onChange={(e) => setAutoRefreshInterval(Number(e.target.value))}
            className="h-8 rounded-md border border-input bg-background px-2 text-sm"
          >
            {REFRESH_INTERVALS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        {autoRefreshInterval > 0 && (
          <div className="flex items-center gap-2">
            <Switch
              id="auto-scan"
              checked={autoScanPing}
              onCheckedChange={setAutoScanPing}
            />
            <Label htmlFor="auto-scan" className="text-sm">Scansione ping periodica</Label>
          </div>
        )}
      </div>

      {/* View toggle */}
      <div className="flex items-center gap-2">
        <Button
          variant={view === "grid" ? "secondary" : "ghost"}
          size="sm"
          onClick={() => setView("grid")}
        >
          <LayoutGrid className="h-4 w-4 mr-1.5" />
          Griglia IP
        </Button>
        <Button
          variant={view === "list" ? "secondary" : "ghost"}
          size="sm"
          onClick={() => setView("list")}
        >
          <List className="h-4 w-4 mr-1.5" />
          Lista
        </Button>
      </div>

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

      {/* List view */}
      {view === "list" && selectedHostIds.size > 0 && (
        <Card size="sm">
          <CardContent className="py-3 flex items-center justify-between gap-4">
            <CardDescription>
              {selectedHostIds.size} host selezionati
            </CardDescription>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setBulkAddOpen(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Aggiungi dispositivo
              </Button>
              <Button variant="ghost" size="icon" onClick={clearHostSelection}>
                <X className="h-4 w-4" />
              </Button>
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
                  <TableCell colSpan={14} className="text-center text-muted-foreground py-8">
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
