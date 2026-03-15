"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { IpGrid } from "@/components/shared/ip-grid";
import { ScanProgress } from "@/components/shared/scan-progress";
import { ArrowLeft, Play, Scan, Download, LayoutGrid, List, Pencil, RefreshCw, CheckCircle2, Network as NetworkIcon, ExternalLink, Router, Cable, MoreHorizontal } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import type { Network, Host, NetworkDevice, ScanProgress as ScanProgressType } from "@/types";
import { DEVICE_CLASSIFICATIONS } from "@/lib/device-classifications";

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
  initialHosts: Host[];
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
  const [hosts, setHosts] = useState<Host[]>(initialHosts);
  const [scanning, setScanning] = useState<ScanProgressType | null>(null);
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
  const [hostEditOpen, setHostEditOpen] = useState(false);
  const [hostEditId, setHostEditId] = useState<number | null>(null);
  const [hostEditForm, setHostEditForm] = useState({
    custom_name: "",
    classification: "",
    inventory_code: "",
    notes: "",
    known_host: 0 as 0 | 1,
  });
  const [addDeviceOpen, setAddDeviceOpen] = useState(false);
  const [addDeviceHost, setAddDeviceHost] = useState<Host | null>(null);
  const [addDeviceType, setAddDeviceType] = useState<"router" | "switch">("router");
  const [addDeviceVendor, setAddDeviceVendor] = useState("mikrotik");
  const [addDeviceProtocol, setAddDeviceProtocol] = useState("ssh");
  const [addDeviceSaving, setAddDeviceSaving] = useState(false);

  const refreshHosts = useCallback(async () => {
    try {
      const res = await fetch(`/api/networks/${network.id}`);
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

  async function saveHostField(hostId: number, field: "custom_name" | "notes" | "classification" | "known_host", value: string | number) {
    try {
      const payload = field === "known_host" ? { known_host: value as 0 | 1 } : { [field]: value };
      const res = await fetch(`/api/hosts/${hostId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const updated = await res.json();
        setHosts((prev) => prev.map((h) => (h.id === hostId ? (updated as Host) : h)));
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
    if (filterClassification && h.classification !== filterClassification) return false;
    if (filterKnownOnly && !h.known_host) return false;
    return true;
  });

  const classifications = [...new Set(hosts.map((h) => h.classification).filter(Boolean))].sort();

  function openHostEdit(host: Host) {
    setHostEditId(host.id);
    setHostEditForm({
      custom_name: host.custom_name || "",
      classification: host.classification || "",
      inventory_code: host.inventory_code || "",
      notes: host.notes || "",
      known_host: (host.known_host ?? 0) ? 1 : 0,
    });
    setHostEditOpen(true);
  }

  function openAddDevice(host: Host, deviceType: "router" | "switch") {
    setAddDeviceHost(host);
    setAddDeviceType(deviceType);
    setAddDeviceVendor(deviceType === "router" ? "mikrotik" : "cisco");
    setAddDeviceProtocol("ssh");
    setAddDeviceOpen(true);
  }

  async function handleAddDevice(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!addDeviceHost) return;
    setAddDeviceSaving(true);
    const form = e.currentTarget;
    const formData = new FormData(form);
    const body: Record<string, unknown> = {
      device_type: addDeviceType,
      name: formData.get("name") || addDeviceHost.custom_name || addDeviceHost.hostname || addDeviceHost.ip,
      host: addDeviceHost.ip,
      vendor: addDeviceVendor,
      protocol: addDeviceProtocol,
    };
    formData.forEach((val, key) => {
      if (val && !["device_type", "name", "host", "vendor", "protocol"].includes(key)) {
        body[key] = key === "port" ? Number(val) || undefined : val;
      }
    });
    try {
      const res = await fetch("/api/devices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        toast.success(addDeviceType === "router" ? "Router aggiunto" : "Switch aggiunto");
        setAddDeviceOpen(false);
        setAddDeviceHost(null);
      } else {
        const data = await res.json();
        toast.error(data.error || "Errore nella creazione");
      }
    } catch {
      toast.error("Errore nella creazione");
    }
    setAddDeviceSaving(false);
  }

  async function saveHostEdit() {
    if (!hostEditId) return;
    try {
      const res = await fetch(`/api/hosts/${hostEditId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(hostEditForm),
      });
      if (res.ok) {
        const updated = await res.json();
        setHosts((prev) => prev.map((h) => (h.id === hostEditId ? (updated as Host) : h)));
        toast.success("Host aggiornato");
        setHostEditOpen(false);
        setHostEditId(null);
        router.refresh();
      } else {
        toast.error("Errore nell'aggiornamento");
      }
    } catch {
      toast.error("Errore nell'aggiornamento");
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

  async function triggerScan(scanType: "ping" | "nmap") {
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

    const data = await res.json();
    toast.success(`Scansione ${scanType} avviata`);
    setScanning(data.progress);

    const interval = setInterval(async () => {
      try {
        const progressRes = await fetch(`/api/scans/progress/${data.id}`);
        if (progressRes.ok) {
          const progress = await progressRes.json();
          setScanning(progress);
          if (progress.status === "completed" || progress.status === "failed") {
            clearInterval(interval);
            setScanning(null);
            if (progress.status === "completed") {
              toast.success(`Scansione completata: ${progress.found} host trovati`);
            } else {
              toast.error(`Scansione fallita: ${progress.error}`);
            }
            refreshHosts();
            router.refresh();
          }
        }
      } catch {
        clearInterval(interval);
        setScanning(null);
      }
    }, 2000);
  }

  async function triggerArpPoll() {
    setArpPolling(true);
    try {
      const res = await fetch("/api/scans/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ network_id: network.id, scan_type: "arp_poll" }),
      });
      if (res.ok) {
        toast.success("MAC recuperati dai router");
        await refreshHosts();
      } else {
        const data = await res.json();
        toast.error(data.error || "Errore nel recupero MAC");
      }
    } catch {
      toast.error("Errore nel recupero MAC");
    } finally {
      setArpPolling(false);
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
        <div className="flex gap-1.5 flex-wrap">
          <Button size="sm" onClick={() => triggerScan("ping")} disabled={!!scanning}>
            <Play className="h-4 w-4 mr-2" />
            Ping Scan
          </Button>
          {nmapProfiles.length > 0 && (
            <div className="flex items-center gap-1">
              <select
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                value={selectedProfileId}
                onChange={(e) => setSelectedProfileId(e.target.value)}
              >
                {nmapProfiles.map((p) => (
                  <option key={p.id} value={String(p.id)}>
                    {p.name}
                  </option>
                ))}
              </select>
              <Button variant="secondary" size="sm" onClick={() => triggerScan("nmap")} disabled={!!scanning || !selectedProfileId}>
                <Scan className="h-4 w-4 mr-2" />
                Nmap
              </Button>
            </div>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={triggerArpPoll}
            disabled={arpPolling || !!scanning}
            title="MAC da ARP; se router MikroTik: anche hostname dai lease DHCP"
          >
            <NetworkIcon className="h-4 w-4 mr-2" />
            {arpPolling ? "Recupero..." : "Recupera MAC"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={triggerDhcpPoll}
            disabled={!canDhcp || dhcpPolling || !!scanning}
            title={canDhcp ? "Hostname e MAC dai lease DHCP del router MikroTik" : "Configura un router MikroTik con SSH per questa rete"}
          >
            {dhcpPolling ? "Recupero..." : "Recupera da DHCP"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => refreshHosts()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Aggiorna
          </Button>
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
            <DialogContent className="max-w-lg">
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
                    <Input id="edit-snmp" name="snmp_community" defaultValue={network.snmp_community || ""} placeholder="es. public, domarcsnmp" className="font-mono" />
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
      {scanning && <ScanProgress progress={scanning} />}

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
                className="h-8 rounded-md border border-input bg-background px-2 text-sm min-w-[120px]"
              >
                <option value="">Tutte</option>
                {classifications.map((c) => (
                  <option key={c} value={c}>{c}</option>
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
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">Dettagli</TableHead>
                <TableHead>IP</TableHead>
                <TableHead>Stato</TableHead>
                <TableHead>Conosciuto</TableHead>
                <TableHead>Nome</TableHead>
                <TableHead>Classificazione</TableHead>
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
                  <TableCell colSpan={12} className="text-center text-muted-foreground py-8">
                    {hosts.length === 0
                      ? "Nessun host trovato. Avvia una scansione per scoprire i dispositivi."
                      : "Nessun host corrisponde ai filtri."}
                  </TableCell>
                </TableRow>
              ) : (
                filteredHosts.map((host) => (
                  <TableRow key={host.id}>
                    <TableCell onClick={(e) => e.stopPropagation()} className="flex gap-1 items-center">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => openHostEdit(host)}
                        title="Modifica dettagli"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8" render={<Link href={`/hosts/${host.id}`} title="Dettagli host" />}>
                        <ExternalLink className="h-4 w-4" />
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger render={<Button variant="ghost" size="icon" className="h-8 w-8" title="Aggiungi come dispositivo" />}>
                          <MoreHorizontal className="h-4 w-4" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start">
                          <DropdownMenuItem onClick={() => openAddDevice(host, "router")}>
                            <Router className="h-4 w-4 mr-2" />
                            Aggiungi come Router
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => openAddDevice(host, "switch")}>
                            <Cable className="h-4 w-4 mr-2" />
                            Aggiungi come Switch
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
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
                        <span className="flex items-center gap-1 truncate max-w-[140px]" title={host.custom_name || host.hostname || undefined}>
                          {host.known_host ? (
                             <span title="Host conosciuto"><CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-primary" /></span>
                          ) : null}
                          {host.custom_name || host.hostname || "—"}
                        </span>
                      )}
                    </TableCell>
                    <TableCell
                      className="min-w-[100px] cursor-text"
                      onClick={(e) => { e.stopPropagation(); if (!(e.target as HTMLElement).closest("input")) { setEditingHostId(host.id); setEditingField("classification"); } }}
                    >
                      {editingHostId === host.id && editingField === "classification" ? (
                        <Input
                          autoFocus
                          list="classification-list"
                          defaultValue={host.classification || ""}
                          className="h-8 text-sm"
                          onBlur={(e) => saveHostField(host.id, "classification", e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") e.currentTarget.blur();
                            else if (e.key === "Escape") { setEditingHostId(null); setEditingField(null); }
                          }}
                          onClick={(e) => e.stopPropagation()}
                        />
                      ) : (
                        <Badge variant="outline">{host.classification}</Badge>
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
                    <TableCell className="text-muted-foreground text-sm">{host.hostname || "—"}</TableCell>
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
          <datalist id="classification-list">
            {DEVICE_CLASSIFICATIONS.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Card>
      )}

      {/* Host Edit Dialog */}
      <Dialog open={hostEditOpen} onOpenChange={(open) => { setHostEditOpen(open); if (!open) setHostEditId(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Modifica host</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => { e.preventDefault(); saveHostEdit(); }}
            className="space-y-4"
          >
            <div className="flex items-center justify-between rounded-lg border p-4">
              <div>
                <Label>Host conosciuto</Label>
                <p className="text-xs text-muted-foreground">Monitoraggio continuo dell&apos;IP</p>
              </div>
              <Switch
                checked={hostEditForm.known_host === 1}
                onCheckedChange={(v) => setHostEditForm((f) => ({ ...f, known_host: v ? 1 : 0 }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Nome</Label>
              <Input
                value={hostEditForm.custom_name}
                onChange={(e) => setHostEditForm((f) => ({ ...f, custom_name: e.target.value }))}
                placeholder="Nome personalizzato"
              />
            </div>
            <div className="space-y-2">
              <Label>Classificazione</Label>
              <Input
                list="host-edit-classification-list"
                value={hostEditForm.classification}
                onChange={(e) => setHostEditForm((f) => ({ ...f, classification: e.target.value }))}
                placeholder="Seleziona o digita..."
              />
              <datalist id="host-edit-classification-list">
                {DEVICE_CLASSIFICATIONS.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
            <div className="space-y-2">
              <Label>Codice inventario</Label>
              <Input
                value={hostEditForm.inventory_code}
                onChange={(e) => setHostEditForm((f) => ({ ...f, inventory_code: e.target.value }))}
                placeholder="INV-2024-001"
              />
            </div>
            <div className="space-y-2">
              <Label>Note</Label>
              <Textarea
                value={hostEditForm.notes}
                onChange={(e) => setHostEditForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="Note aggiuntive..."
                rows={3}
              />
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => setHostEditOpen(false)}>
                Annulla
              </Button>
              <Button type="submit">
                Salva
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Aggiungi come Router/Switch */}
      <Dialog open={addDeviceOpen} onOpenChange={(open) => { setAddDeviceOpen(open); if (!open) setAddDeviceHost(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              Aggiungi come {addDeviceType === "router" ? "Router" : "Switch"}
            </DialogTitle>
          </DialogHeader>
          {addDeviceHost && (
            <form onSubmit={handleAddDevice} className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Crea un dispositivo da <span className="font-mono font-medium">{addDeviceHost.ip}</span>
                {addDeviceHost.custom_name || addDeviceHost.hostname ? ` (${addDeviceHost.custom_name || addDeviceHost.hostname})` : ""}
              </p>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Nome</Label>
                  <Input
                    name="name"
                    defaultValue={addDeviceHost.custom_name || addDeviceHost.hostname || addDeviceHost.ip}
                    placeholder={addDeviceType === "router" ? "Router Core" : "Switch Core"}
                  />
                </div>
                <div className="space-y-2">
                  <Label>IP</Label>
                  <Input value={addDeviceHost.ip} disabled className="bg-muted" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Vendor</Label>
                  <Select value={addDeviceVendor} onValueChange={setAddDeviceVendor}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="mikrotik">MikroTik</SelectItem>
                      <SelectItem value="ubiquiti">Ubiquiti</SelectItem>
                      <SelectItem value="cisco">Cisco</SelectItem>
                      <SelectItem value="hp">HP / Aruba</SelectItem>
                      <SelectItem value="omada">TP-Link Omada</SelectItem>
                      <SelectItem value="other">Altro</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Protocollo</Label>
                  <Select value={addDeviceProtocol} onValueChange={setAddDeviceProtocol}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ssh">SSH</SelectItem>
                      <SelectItem value="snmp_v2">SNMP v2</SelectItem>
                      <SelectItem value="snmp_v3">SNMP v3</SelectItem>
                      <SelectItem value="api">API REST</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Porta</Label>
                  <Input
                    name="port"
                    type="number"
                    placeholder={addDeviceProtocol === "ssh" ? "22" : addDeviceProtocol.startsWith("snmp") ? "161" : "443"}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Username</Label>
                  <Input name="username" placeholder="admin" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Password</Label>
                  <Input name="password" type="password" />
                </div>
                <div className="space-y-2">
                  <Label>Community String (SNMP)</Label>
                  <Input name="community_string" placeholder="public" />
                </div>
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={() => setAddDeviceOpen(false)}>
                  Annulla
                </Button>
                <Button type="submit" disabled={addDeviceSaving}>
                  {addDeviceSaving ? "Creazione..." : `Aggiungi ${addDeviceType === "router" ? "Router" : "Switch"}`}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
