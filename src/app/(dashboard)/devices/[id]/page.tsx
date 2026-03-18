"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { DeviceListByClassification } from "../device-list-by-classification";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ArrowLeft, RefreshCw, Zap, ZapOff, Cable, Minus, Pencil, Key, Server, Wifi, Database, Activity, Radio, Package, ExternalLink, Plus, Monitor, Cpu, HardDrive, Shield, Users, Clock, Award, Layers, Info } from "lucide-react";

function Tip({ text }: { text: string }) {
  return (
    <span className="relative group/tip inline-flex ml-1 cursor-help">
      <Info className="h-3 w-3 text-muted-foreground" />
      <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1 text-xs bg-popover text-popover-foreground border rounded shadow-md max-w-[220px] whitespace-normal opacity-0 pointer-events-none group-hover/tip:opacity-100 group-hover/tip:pointer-events-auto transition-opacity z-50">
        {text}
      </span>
    </span>
  );
}
import { toast } from "sonner";
import { getClassificationLabel, DEVICE_CLASSIFICATIONS_ORDERED } from "@/lib/device-classifications";
import { CredentialAssignmentFields } from "@/components/shared/credential-assignment-fields";
import type { NetworkDevice, ArpEntry, MacPortEntry, SwitchPort } from "@/types";

interface Credential {
  id: number;
  name: string;
  credential_type: string;
}

interface StpInfo {
  bridge_id: string | null;
  root_bridge_id: string | null;
  priority: number | null;
  root_cost: number | null;
  root_port: string | null;
  hello_time_s: number | null;
  forward_delay_s: number | null;
  max_age_s: number | null;
  is_root_bridge: boolean;
  protocol: "stp" | "rstp" | null;
}

interface DeviceInfo {
  sysname: string | null;
  sysdescr: string | null;
  model: string | null;
  firmware: string | null;
  serial_number: string | null;
  part_number: string | null;
  scanned_at?: string;
  // Campi Windows estesi
  os_name?: string | null;
  os_version?: string | null;
  os_build?: string | null;
  architecture?: string | null;
  hostname?: string | null;
  domain?: string | null;
  manufacturer?: string | null;
  system_type?: string | null;
  domain_role?: string | null;
  is_server?: boolean;
  is_domain_controller?: boolean;
  os_serial?: string | null;
  registered_user?: string | null;
  organization?: string | null;
  install_date?: string | null;
  last_boot?: string | null;
  uptime_days?: number | null;
  // HW
  cpu_model?: string | null;
  cpu_manufacturer?: string | null;
  cpu_cores?: number | null;
  cpu_threads?: number | null;
  cpu_speed_mhz?: number | null;
  processor_count?: number | null;
  ram_total_gb?: number | null;
  ram_total_mb?: number | null;
  disk_total_gb?: number | null;
  disk_free_gb?: number | null;
  disks?: Array<{ device: string; size_gb?: number; free_gb?: number; filesystem?: string; label?: string }>;
  memory_modules?: Array<{ size_gb?: number; speed_mhz?: number; manufacturer?: string }>;
  gpu?: Array<{ name: string; driver_version?: string; ram_gb?: number }>;
  bios_version?: string | null;
  bios_manufacturer?: string | null;
  // Rete
  network_adapters?: Array<{ name: string; mac?: string; ips?: string[]; dhcp?: boolean }>;
  // Licenza
  license_status?: string | null;
  license_name?: string | null;
  license_partial_key?: string | null;
  // Servizi e ruoli
  server_roles?: string[];
  important_services?: Array<{ name: string; display_name: string; state: string; start_mode: string }>;
  // Utenti e sicurezza
  local_users?: Array<{ name: string; full_name?: string; disabled?: boolean }>;
  antivirus?: Array<{ name: string; state?: string }>;
  // Aggiornamenti
  installed_hotfixes?: Array<{ id: string; description?: string; installed_on?: string }>;
  // Software
  installed_software_count?: number | null;
  key_software?: Array<{ name: string; version?: string; publisher?: string }>;
}

interface DeviceDetail extends Omit<NetworkDevice, "stp_info" | "last_device_info_json"> {
  arp_entries: (ArpEntry & { host_ip?: string; host_name?: string })[];
  mac_port_entries: (MacPortEntry & { host_ip?: string; host_name?: string })[];
  switch_ports: SwitchPort[];
  stp_info: StpInfo | null;
  device_info: DeviceInfo | null;
}

function PortStatusDot({ status }: { status: string | null }) {
  const color =
    status === "up" ? "bg-emerald-500" :
    status === "down" ? "bg-zinc-300 dark:bg-zinc-600" :
    status === "disabled" ? "bg-red-400" :
    "bg-zinc-300";
  return <span className={`inline-block w-2.5 h-2.5 rounded-full ${color}`} />;
}

function PoeBadge({ status, powerMw }: { status: string | null; powerMw: number | null }) {
  if (!status) return <Minus className="h-3.5 w-3.5 text-muted-foreground/40" />;
  const isDelivering = status === "delivering";
  const watts = powerMw ? (powerMw / 1000).toFixed(1) : null;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          render={
            <span className="inline-flex items-center gap-1">
              {isDelivering ? (
                <Zap className="h-3.5 w-3.5 text-amber-500" />
              ) : (
                <ZapOff className="h-3.5 w-3.5 text-muted-foreground/40" />
              )}
              {isDelivering && watts && (
                <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">{watts}W</span>
              )}
            </span>
          }
        />
        <TooltipContent>
          <p className="capitalize">{status}{watts ? ` — ${watts}W` : ""}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function EmptyState({ icon: Icon, title, description }: { icon: React.ElementType; title: string; description: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
      <div className="rounded-full bg-muted/50 p-4 mb-4">
        <Icon className="h-10 w-10 text-muted-foreground/60" />
      </div>
      <p className="font-medium text-foreground">{title}</p>
      <p className="text-sm text-muted-foreground mt-1 max-w-sm">{description}</p>
    </div>
  );
}

function DeviceInventoryCard({ deviceId, onRefresh }: { deviceId: number; onRefresh: () => void }) {
  const [asset, setAsset] = useState<{ id: number; asset_tag: string | null; serial_number: string | null; stato: string | null; fine_garanzia: string | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    fetch(`/api/inventory?network_device_id=${deviceId}&limit=1`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((arr) => setAsset(arr[0] ?? null))
      .finally(() => setLoading(false));
  }, [deviceId]);

  async function handleCreateAsset() {
    setCreating(true);
    try {
      const res = await fetch("/api/inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ network_device_id: deviceId }),
      });
      if (res.ok) {
        const created = await res.json();
        setAsset(created);
        onRefresh();
        toast.success("Asset inventario creato");
      } else {
        const data = await res.json();
        toast.error(data.error ?? "Errore");
      }
    } catch {
      toast.error("Errore nella creazione");
    } finally {
      setCreating(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Package className="h-4 w-4" />
            Inventario asset
          </CardTitle>
          {asset ? (
            <Link href={`/inventory/${asset.id}`}>
              <Button variant="outline" size="sm">
                <Pencil className="h-3.5 w-3.5 mr-1" />
                Modifica
                <ExternalLink className="h-3 w-3 ml-1" />
              </Button>
            </Link>
          ) : (
            <Button variant="outline" size="sm" onClick={handleCreateAsset} disabled={creating}>
              <Plus className="h-3.5 w-3.5 mr-1" />
              {creating ? "Creazione..." : "Collega asset"}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-muted-foreground">Caricamento...</p>
        ) : asset ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {asset.asset_tag && (
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Asset Tag</p>
                <p className="text-sm font-medium mt-0.5">{asset.asset_tag}</p>
              </div>
            )}
            {asset.serial_number && (
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">S/N</p>
                <p className="font-mono text-sm font-medium mt-0.5">{asset.serial_number}</p>
              </div>
            )}
            {asset.stato && (
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Stato</p>
                <p className="text-sm font-medium mt-0.5">{asset.stato}</p>
              </div>
            )}
            {asset.fine_garanzia && (
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Fine garanzia</p>
                <p className="text-sm font-medium mt-0.5">{new Date(asset.fine_garanzia).toLocaleDateString("it-IT")}</p>
              </div>
            )}
            {!asset.asset_tag && !asset.serial_number && !asset.stato && !asset.fine_garanzia && (
              <p className="text-sm text-muted-foreground col-span-2">Asset collegato. Compila i campi in Inventario.</p>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Nessun asset collegato. Clicca &quot;Collega asset&quot; per creare una scheda inventario.</p>
        )}
      </CardContent>
    </Card>
  );
}

function getPortTypeIcon(portName: string, isTrunk: boolean) {
  if (isTrunk) return <Cable className="h-4 w-4 text-primary" />;
  if (/^(xge|ge|gig|10g|sfp)/i.test(portName)) return <Wifi className="h-4 w-4 text-muted-foreground" />;
  if (/^(vlan|br|bridge)/i.test(portName)) return <Database className="h-4 w-4 text-muted-foreground" />;
  return <Activity className="h-4 w-4 text-muted-foreground" />;
}

const CLASSIFICATION_SLUGS = ["access_point", "firewall", "hypervisor", "iot", "notebook", "router", "server", "stampante", "storage", "switch", "telecamera", "voip", "vm", "workstation"];

export default function DevicePage() {
  const params = useParams();
  const slug = params.id as string;
  if (CLASSIFICATION_SLUGS.includes(slug) || slug === "hypervisor") {
    return <DeviceListByClassification classification={slug} />;
  }
  if (!/^\d+$/.test(slug)) {
    return <div className="text-muted-foreground py-8">Pagina non trovata</div>;
  }
  return <DeviceDetailPage />;
}

function DeviceDetailPage() {
  const params = useParams();
  const router = useRouter();
  const [device, setDevice] = useState<DeviceDetail | null>(null);
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [loading, setLoading] = useState(true);
  const [querying, setQuerying] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editVendor, setEditVendor] = useState("");
  const [editVendorSubtype, setEditVendorSubtype] = useState<string | null>(null);
  const [editProtocol, setEditProtocol] = useState("");
  const [editCredentialId, setEditCredentialId] = useState<string | null>(null);
  const [editSnmpCredentialId, setEditSnmpCredentialId] = useState<string | null>(null);
  const [editScanTarget, setEditScanTarget] = useState<string | null>(null);
  const [editClassification, setEditClassification] = useState<string>("");
  const [editSaving, setEditSaving] = useState(false);

  useEffect(() => {
    if (device) {
      setEditVendor(device.vendor);
      setEditProtocol(device.protocol);
      setEditVendorSubtype(device.vendor_subtype ?? null);
      setEditCredentialId(device.credential_id != null ? String(device.credential_id) : null);
      setEditSnmpCredentialId(device.snmp_credential_id != null ? String(device.snmp_credential_id) : null);
      setEditScanTarget((device as { scan_target?: string | null }).scan_target ?? null);
      setEditClassification((device as { classification?: string | null }).classification ?? "");
    }
  }, [device]);

  useEffect(() => {
    fetch("/api/credentials")
      .then((r) => r.ok ? r.json() : [])
      .then(setCredentials)
      .catch(() => setCredentials([]));
  }, []);

  const fetchDevice = useCallback(async () => {
    const res = await fetch(`/api/devices/${params.id}`, { cache: "no-store" });
    if (!res.ok) { router.push("/devices"); return; }
    setDevice(await res.json());
    setLoading(false);
  }, [params.id, router]);

  useEffect(() => { fetchDevice(); }, [fetchDevice]);

  async function handleQuery() {
    if (!device) return;
    const target = (device as { scan_target?: string | null }).scan_target;
    if (target === "vmware" || target === "linux") {
      toast.info("Scansione " + target + " non ancora implementata");
      return;
    }
    const isWinrm = target === "windows" || device.protocol === "winrm" || device.vendor === "windows";
    const useProxmox = target === "proxmox" || (device.device_type === "hypervisor" && !target);
    const endpoint = useProxmox
      ? `/api/devices/${params.id}/proxmox-scan`
      : isWinrm
        ? `/api/devices/${params.id}/query`
        : `/api/devices/${params.id}/query`;

    setQuerying(true);
    const controller = new AbortController();
    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
      setQuerying(false);
      toast.error("Timeout: la scansione ha superato i 2 minuti. Verifica connettività del dispositivo.");
    }, 120_000);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (timedOut) return;
      const data = await res.json();
      if (res.ok) {
        const msg = useProxmox ? "Scan Proxmox completato" : data.message;
        toast.success(msg);
        fetchDevice();
      } else {
        toast.error(data.error);
      }
    } catch (err) {
      clearTimeout(timeoutId);
      if (timedOut) return;
      toast.error(err instanceof Error ? err.message : "Errore nella scansione");
    } finally {
      if (!timedOut) setQuerying(false);
    }
  }

  async function handleTestConnection() {
    if (!device) return;
    setTestingConnection(true);
    try {
      const res = await fetch(`/api/devices/${device.id}/test`);
      const data = await res.json();
      if (data.success) {
        toast.success("Connessione riuscita");
      } else {
        toast.error(data.error || "Connessione fallita");
      }
    } catch {
      toast.error("Errore nel test di connessione");
    } finally {
      setTestingConnection(false);
    }
  }

  async function handleEdit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!device) return;
    setEditSaving(true);
    const form = e.currentTarget;
    const formData = new FormData(form);
    const body: Record<string, unknown> = {
      vendor: editVendor,
      protocol: editProtocol,
      vendor_subtype: editVendorSubtype || null,
      credential_id: editCredentialId && editCredentialId !== "none" ? Number(editCredentialId) : null,
      snmp_credential_id: editSnmpCredentialId && editSnmpCredentialId !== "none" ? Number(editSnmpCredentialId) : null,
      scan_target: editScanTarget || null,
    };
    if (editClassification) body.classification = editClassification;
    formData.forEach((val, key) => {
      if (key === "password" || key === "community_string") {
        if (val && String(val).trim()) body[key] = val;
      } else if (key === "api_url") {
        body.api_url = (val && String(val).trim()) || null;
      } else if (val && key !== "device_type") {
        body[key] = key === "port" ? Number(val) || undefined : val;
      }
    });
    try {
      const res = await fetch(`/api/devices/${device.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        toast.success("Dispositivo aggiornato");
        setEditOpen(false);
        fetchDevice();
      } else {
        const data = await res.json();
        toast.error(data.error || "Errore nell'aggiornamento");
      }
    } catch {
      toast.error("Errore nell'aggiornamento");
    }
    setEditSaving(false);
  }

  if (loading || !device) return <div className="text-muted-foreground py-8">Caricamento...</div>;

  const upPorts = device.switch_ports?.filter(p => p.status === "up").length || 0;
  const totalPorts = device.switch_ports?.length || 0;
  const trunkPorts = device.switch_ports?.filter(p => p.is_trunk).length || 0;

  const lastRefresh = [
    ...(device.arp_entries || []).map((e) => e.timestamp),
    ...(device.mac_port_entries || []).map((e) => e.timestamp),
    ...(device.switch_ports || []).map((p) => p.timestamp),
    ...(device.last_info_update ? [device.last_info_update] : []),
  ].filter(Boolean).sort().pop();

  const neighborGroups = (device.switch_ports || [])
    .filter((p) => p.trunk_neighbor_name || p.trunk_neighbor_port)
    .reduce<Map<string, { name: string; port: string; ports: SwitchPort[] }>>((acc, p) => {
      const key = `${p.trunk_neighbor_name || "Unknown"}|${p.trunk_neighbor_port || ""}`;
      const existing = acc.get(key);
      if (existing) {
        existing.ports.push(p);
      } else {
        acc.set(key, {
          name: p.trunk_neighbor_name || "Unknown",
          port: p.trunk_neighbor_port || "",
          ports: [p],
        });
      }
      return acc;
    }, new Map());

  const credentialName = device.credential_id && credentials.find((c) => c.id === device.credential_id)?.name;
  const snmpCredentialName = device.snmp_credential_id && credentials.find((c) => c.id === device.snmp_credential_id)?.name;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-4">
          <Link href={device.device_type === "router" ? "/devices/router" : "/devices/switch"}>
            <Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button>
          </Link>
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-bold tracking-tight">{device.name}</h1>
              <Badge variant={device.device_type === "router" ? "default" : "secondary"} className="capitalize">
                {device.device_type}
              </Badge>
              {device.classification && (
                <Badge variant="outline" className="capitalize">
                  {device.classification.replace(/_/g, " ")}
                </Badge>
              )}
              <Badge variant="outline" className="capitalize">{device.vendor}</Badge>
              {device.vendor_subtype && (
                <Badge variant="outline" className="text-xs">{device.vendor_subtype}</Badge>
              )}
            </div>
            <p className="text-muted-foreground font-mono text-sm mt-1">{device.host}:{device.port} ({device.protocol})</p>
          </div>
        </div>
        <div className="flex gap-2 shrink-0 flex-wrap">
          <Button
            variant="outline"
            onClick={handleTestConnection}
            disabled={testingConnection || querying}
            title="Verifica connettività"
          >
            <Radio className={`h-4 w-4 mr-2 ${testingConnection ? "animate-pulse" : ""}`} />
            {testingConnection ? "Test..." : "Test connessione"}
          </Button>
          <Button variant="outline" onClick={() => setEditOpen(true)}>
            <Pencil className="h-4 w-4 mr-2" />
            Modifica
          </Button>
          <Button onClick={handleQuery} disabled={querying} className="bg-primary hover:bg-primary/90">
            <RefreshCw className={`h-4 w-4 mr-2 ${querying ? "animate-spin" : ""}`} />
            {querying ? "Acquisizione..." : "Aggiorna Dati"}
          </Button>
        </div>
      </div>

      {/* Device Info Card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Server className="h-4 w-4" />
            Informazioni dispositivo
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {(device.sysname || device.model) && (
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Modello / Nome</p>
                <p className="text-sm font-medium mt-0.5">{device.sysname || device.model || "—"}</p>
              </div>
            )}
            {device.sysdescr && (
              <div className="col-span-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Descrizione</p>
                <p className="text-sm font-medium mt-0.5 line-clamp-2" title={device.sysdescr}>{device.sysdescr}</p>
              </div>
            )}
            {device.serial_number && (
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Serial Number</p>
                <p className="font-mono text-sm font-medium mt-0.5">{device.serial_number}</p>
              </div>
            )}
            {device.part_number && (
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Part Number</p>
                <p className="font-mono text-sm font-medium mt-0.5">{device.part_number}</p>
              </div>
            )}
            {device.firmware && (
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Firmware</p>
                <p className="text-sm font-medium mt-0.5">{device.firmware}</p>
              </div>
            )}
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Indirizzo IP</p>
              <p className="font-mono text-sm font-medium mt-0.5">{device.host}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Porta</p>
              <p className="font-mono text-sm font-medium mt-0.5">{device.port}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Protocollo</p>
              <p className="text-sm font-medium mt-0.5 uppercase">{device.protocol}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Credenziale SSH</p>
              <p className="text-sm font-medium mt-0.5 flex items-center gap-1">
                {credentialName ? (
                  <><Key className="h-3.5 w-3.5" />{credentialName}</>
                ) : device.username ? (
                  "Inline"
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Credenziale SNMP</p>
              <p className="text-sm font-medium mt-0.5 flex items-center gap-1">
                {snmpCredentialName ? (
                  <><Key className="h-3.5 w-3.5" />{snmpCredentialName}</>
                ) : device.community_string ? (
                  "Community inline"
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Ultimo aggiornamento</p>
              <p className="text-sm font-medium mt-0.5">
                {lastRefresh ? new Date(lastRefresh).toLocaleString("it-IT") : <span className="text-muted-foreground">Mai</span>}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Inventario asset */}
      <DeviceInventoryCard deviceId={device.id} onRefresh={fetchDevice} />

      {/* Dati tecnici acquisiti (persistenti) */}
      {device.device_info && (() => {
        const di = device.device_info;
        const isWin = !!(di.os_name || di.hostname || di.cpu_model || di.domain);
        return (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Database className="h-4 w-4" />
                {isWin ? "Dati sistema Windows (WMI)" : "Dati tecnici acquisiti"}
              </CardTitle>
              {di.scanned_at && (
                <span className="text-xs text-muted-foreground">
                  Acquisiti il {new Date(di.scanned_at).toLocaleString("it-IT")}
                </span>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* === SISTEMA OPERATIVO === */}
            {(di.os_name || di.hostname || di.uptime_days != null) && (
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5 mb-2"><Monitor className="h-3.5 w-3.5" /> Sistema operativo</h4>
              <dl className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 text-sm">
                {di.hostname && <div><dt className="text-xs text-muted-foreground">Hostname</dt><dd className="font-mono font-medium">{di.hostname}</dd></div>}
                {di.domain && <div><dt className="text-xs text-muted-foreground">Dominio</dt><dd className="font-mono">{di.domain}</dd></div>}
                {di.os_name && <div className="col-span-2"><dt className="text-xs text-muted-foreground">Sistema operativo</dt><dd>{di.os_name}</dd></div>}
                {di.os_version && <div><dt className="text-xs text-muted-foreground">Versione</dt><dd className="font-mono">{di.os_version}</dd></div>}
                {di.os_build && <div><dt className="text-xs text-muted-foreground">Build</dt><dd className="font-mono">{di.os_build}</dd></div>}
                {di.architecture && <div><dt className="text-xs text-muted-foreground">Architettura</dt><dd>{di.architecture}</dd></div>}
                {di.domain_role && <div><dt className="text-xs text-muted-foreground">Ruolo</dt><dd><Badge variant="outline" className="text-xs">{di.domain_role}</Badge></dd></div>}
                {di.uptime_days != null && <div><dt className="text-xs text-muted-foreground flex items-center gap-1"><Clock className="h-3 w-3" /> Uptime</dt><dd className="font-semibold">{di.uptime_days} giorni</dd></div>}
                {di.install_date && <div><dt className="text-xs text-muted-foreground">Data installazione</dt><dd className="text-xs">{(() => { try { return new Date(di.install_date).toLocaleDateString("it-IT"); } catch { return di.install_date; } })()}</dd></div>}
                {di.registered_user && <div><dt className="text-xs text-muted-foreground">Utente registrato</dt><dd>{di.registered_user}</dd></div>}
                {di.organization && <div><dt className="text-xs text-muted-foreground">Organizzazione</dt><dd>{di.organization}</dd></div>}
              </dl>
            </div>
            )}

            {/* === HARDWARE === */}
            {(di.cpu_model || di.ram_total_gb || di.manufacturer) && (
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5 mb-2"><Cpu className="h-3.5 w-3.5" /> Hardware</h4>
              <dl className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 text-sm">
                {di.manufacturer && <div><dt className="text-xs text-muted-foreground">Produttore</dt><dd>{di.manufacturer}</dd></div>}
                {di.model && <div><dt className="text-xs text-muted-foreground">Modello</dt><dd>{di.model}</dd></div>}
                {di.serial_number && <div><dt className="text-xs text-muted-foreground">Serial Number</dt><dd className="font-mono text-xs">{di.serial_number}</dd></div>}
                {di.system_type && <div><dt className="text-xs text-muted-foreground">Tipo sistema</dt><dd className="text-xs">{di.system_type}</dd></div>}
                {di.cpu_model && <div className="col-span-2"><dt className="text-xs text-muted-foreground">CPU</dt><dd className="text-xs">{di.cpu_model}</dd></div>}
                {di.cpu_cores && <div><dt className="text-xs text-muted-foreground">Core / Thread</dt><dd>{di.cpu_cores}{di.cpu_threads ? ` / ${di.cpu_threads}` : ""}</dd></div>}
                {di.cpu_speed_mhz && <div><dt className="text-xs text-muted-foreground">Frequenza</dt><dd>{(di.cpu_speed_mhz / 1000).toFixed(1)} GHz</dd></div>}
                {di.ram_total_gb && <div><dt className="text-xs text-muted-foreground">RAM totale</dt><dd className="font-semibold">{di.ram_total_gb} GB</dd></div>}
                {di.bios_version && <div><dt className="text-xs text-muted-foreground">BIOS</dt><dd className="text-xs">{di.bios_manufacturer ? `${di.bios_manufacturer} ` : ""}{di.bios_version}</dd></div>}
              </dl>
              {di.gpu && di.gpu.length > 0 && (
                <div className="mt-2">
                  <dt className="text-xs text-muted-foreground mb-1">GPU</dt>
                  {di.gpu.map((g, i) => <dd key={i} className="text-sm">{g.name}{g.ram_gb ? ` (${g.ram_gb} GB)` : ""}{g.driver_version ? ` — driver ${g.driver_version}` : ""}</dd>)}
                </div>
              )}
              {di.memory_modules && di.memory_modules.length > 0 && (
                <div className="mt-2">
                  <dt className="text-xs text-muted-foreground mb-1">Moduli memoria</dt>
                  <div className="flex flex-wrap gap-2">{di.memory_modules.map((m, i) => <Badge key={i} variant="secondary" className="text-xs">{m.size_gb} GB{m.speed_mhz ? ` ${m.speed_mhz} MHz` : ""}{m.manufacturer ? ` (${m.manufacturer})` : ""}</Badge>)}</div>
                </div>
              )}
            </div>
            )}

            {/* === DISCHI === */}
            {di.disks && di.disks.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5 mb-2"><HardDrive className="h-3.5 w-3.5" /> Dischi {di.disk_total_gb ? <span className="font-normal">— {di.disk_total_gb} GB totali, {di.disk_free_gb} GB liberi</span> : null}</h4>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                {di.disks.map((d, i) => {
                  const pct = d.size_gb && d.free_gb ? Math.round(((d.size_gb - d.free_gb) / d.size_gb) * 100) : null;
                  return (
                    <div key={i} className="border rounded-md p-2 text-xs">
                      <div className="font-mono font-semibold">{d.device} {d.label ? `(${d.label})` : ""}</div>
                      <div className="text-muted-foreground">{d.filesystem} — {d.size_gb} GB</div>
                      {pct != null && (
                        <div className="mt-1">
                          <div className="h-1.5 bg-muted rounded-full overflow-hidden"><div className={`h-full rounded-full ${pct > 90 ? "bg-red-500" : pct > 75 ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${pct}%` }} /></div>
                          <div className="flex justify-between mt-0.5"><span>{d.free_gb} GB liberi</span><span>{pct}%</span></div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
            )}

            {/* === RETE === */}
            {di.network_adapters && di.network_adapters.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5 mb-2"><Wifi className="h-3.5 w-3.5" /> Schede di rete</h4>
              <div className="space-y-1.5">
                {di.network_adapters.map((a, i) => (
                  <div key={i} className="border rounded-md p-2 text-xs flex items-start justify-between gap-2">
                    <div>
                      <div className="font-medium">{a.name}</div>
                      {a.ips && <div className="font-mono text-muted-foreground">{a.ips.filter(ip => !ip.includes(":")).join(", ")}</div>}
                      {a.mac && <div className="font-mono text-muted-foreground">{a.mac}</div>}
                    </div>
                    <Badge variant={a.dhcp ? "secondary" : "outline"} className="text-[10px] shrink-0">{a.dhcp ? "DHCP" : "Statico"}</Badge>
                  </div>
                ))}
              </div>
            </div>
            )}

            {/* === LICENZA === */}
            {(di.license_status || di.os_serial) && (
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5 mb-2"><Award className="h-3.5 w-3.5" /> Licenza</h4>
              <dl className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 text-sm">
                {di.license_status && <div><dt className="text-xs text-muted-foreground">Stato</dt><dd><Badge variant={di.license_status === "Licensed" ? "default" : "destructive"} className="text-xs">{di.license_status}</Badge></dd></div>}
                {di.license_name && <div className="col-span-2"><dt className="text-xs text-muted-foreground">Edizione</dt><dd className="text-xs">{di.license_name}</dd></div>}
                {di.license_partial_key && <div><dt className="text-xs text-muted-foreground">Product Key (parziale)</dt><dd className="font-mono">XXXXX-XXXXX-XXXXX-XXXXX-{di.license_partial_key}</dd></div>}
                {di.os_serial && <div><dt className="text-xs text-muted-foreground">OS Serial</dt><dd className="font-mono text-xs">{di.os_serial}</dd></div>}
              </dl>
            </div>
            )}

            {/* === SERVIZI E RUOLI === */}
            {(di.server_roles || di.important_services) && (
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5 mb-2"><Layers className="h-3.5 w-3.5" /> Servizi e ruoli</h4>
              {di.server_roles && di.server_roles.length > 0 && (
                <div className="mb-2">
                  <dt className="text-xs text-muted-foreground mb-1">Ruoli server</dt>
                  <div className="flex flex-wrap gap-1">{di.server_roles.map((r, i) => <Badge key={i} variant="outline" className="text-xs">{r}</Badge>)}</div>
                </div>
              )}
              {di.important_services && di.important_services.length > 0 && (
                <div>
                  <dt className="text-xs text-muted-foreground mb-1">Servizi principali attivi</dt>
                  <div className="flex flex-wrap gap-1">{di.important_services.map((s, i) => <Badge key={i} variant="secondary" className="text-xs gap-1"><Activity className="h-2.5 w-2.5 text-emerald-500" />{s.display_name}</Badge>)}</div>
                </div>
              )}
            </div>
            )}

            {/* === SICUREZZA === */}
            {(di.antivirus || di.local_users) && (
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5 mb-2"><Shield className="h-3.5 w-3.5" /> Sicurezza e utenti</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {di.antivirus && di.antivirus.length > 0 && (
                  <div><dt className="text-xs text-muted-foreground mb-1">Antivirus</dt>{di.antivirus.map((a, i) => <dd key={i} className="text-sm">{a.name}</dd>)}</div>
                )}
                {di.local_users && di.local_users.length > 0 && (
                  <div><dt className="text-xs text-muted-foreground mb-1">Utenti locali</dt><div className="flex flex-wrap gap-1">{di.local_users.map((u, i) => <Badge key={i} variant={u.disabled ? "secondary" : "outline"} className={`text-xs ${u.disabled ? "opacity-50 line-through" : ""}`}><Users className="h-2.5 w-2.5 mr-0.5" />{u.name}</Badge>)}</div></div>
                )}
              </div>
            </div>
            )}

            {/* === AGGIORNAMENTI === */}
            {di.installed_hotfixes && di.installed_hotfixes.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5 mb-2"><RefreshCw className="h-3.5 w-3.5" /> Aggiornamenti ({di.installed_hotfixes.length} hotfix)</h4>
              <div className="flex flex-wrap gap-1">
                {di.installed_hotfixes.slice(0, 20).map((h, i) => (
                  <Badge key={i} variant="secondary" className="text-[10px] font-mono">{h.id}{h.installed_on ? ` (${h.installed_on})` : ""}</Badge>
                ))}
                {di.installed_hotfixes.length > 20 && <Badge variant="outline" className="text-[10px]">+{di.installed_hotfixes.length - 20} altri</Badge>}
              </div>
            </div>
            )}

            {/* === SOFTWARE === */}
            {((di.key_software && di.key_software.length > 0) || (di.installed_software_count != null && di.installed_software_count > 0)) && (
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5 mb-2"><Package className="h-3.5 w-3.5" /> Software {di.installed_software_count ? `(${di.installed_software_count} installati)` : ""}</h4>
              {di.key_software && di.key_software.length > 0 && (
                <div className="space-y-1">
                  {di.key_software.map((s, i) => (
                    <div key={i} className="text-xs flex items-baseline gap-2">
                      <span className="font-medium">{s.name}</span>
                      {s.version && <span className="text-muted-foreground font-mono">{s.version}</span>}
                      {s.publisher && <span className="text-muted-foreground">— {s.publisher}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
            )}

            {/* Fallback per device non-Windows: mostra campi base SNMP */}
            {!isWin && (
            <dl className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 text-sm">
              {di.sysname && <div><dt className="text-xs font-medium text-muted-foreground uppercase tracking-wider">sysName</dt><dd className="font-mono mt-0.5">{di.sysname}</dd></div>}
              {di.model && <div><dt className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Model</dt><dd className="mt-0.5">{di.model}</dd></div>}
              {di.serial_number && <div><dt className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Serial Number</dt><dd className="font-mono mt-0.5">{di.serial_number}</dd></div>}
              {di.part_number && <div><dt className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Part Number</dt><dd className="font-mono mt-0.5">{di.part_number}</dd></div>}
              {di.firmware && <div><dt className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Firmware</dt><dd className="mt-0.5">{di.firmware}</dd></div>}
              {di.sysdescr && <div className="col-span-full"><dt className="text-xs font-medium text-muted-foreground uppercase tracking-wider">sysDescr</dt><dd className="font-mono text-xs mt-0.5 break-all">{di.sysdescr}</dd></div>}
            </dl>
            )}
          </CardContent>
        </Card>
        );
      })()}

      {/* Dati Proxmox (host e VM) */}
      {((device.device_type === "hypervisor") || (device as { scan_target?: string }).scan_target === "proxmox") && (() => {
        const resultJson = (device as { last_proxmox_scan_result?: string | null }).last_proxmox_scan_result;
        if (!resultJson) return null;
        try {
          const data = JSON.parse(resultJson) as {
            hosts?: Array<{
              hostname: string;
              status: string;
              cpu_model?: string | null;
              cpu_mhz?: number | null;
              cpu_sockets?: number | null;
              cpu_cores?: number | null;
              cpu_total_cores?: number | null;
              memory_total_gb?: number | null;
              memory_usage_percent?: number | null;
              proxmox_version?: string | null;
              kernel_version?: string | null;
              uptime_human?: string | null;
              rootfs_total_gb?: number | null;
              rootfs_used_gb?: number | null;
              subscription?: { status?: string; productname?: string; key?: string; level?: string; nextduedate?: string; regdate?: string; serverid?: string; sockets?: number } | null;
              hardware_serial?: string | null;
              hardware_model?: string | null;
              hardware_manufacturer?: string | null;
            }>;
            vms?: unknown[];
            scanned_at?: string;
          };
          const hosts = data.hosts ?? [];
          const vms = data.vms ?? [];
          if (hosts.length === 0 && vms.length === 0) return null;
          return (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Server className="h-5 w-5" />
                  Dati Proxmox
                </CardTitle>
                <CardDescription>
                  Scan del {data.scanned_at ? new Date(data.scanned_at).toLocaleString("it-IT") : "—"}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Tabs defaultValue="hosts">
                  <TabsList>
                    <TabsTrigger value="hosts">Host ({hosts.length})</TabsTrigger>
                    <TabsTrigger value="vms">VM e CT ({vms.length})</TabsTrigger>
                    <TabsTrigger value="details">Hardware e licenza</TabsTrigger>
                  </TabsList>
                  <TabsContent value="hosts" className="mt-4">
                    {hosts.length > 0 ? (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Hostname</TableHead>
                            <TableHead>Stato</TableHead>
                            <TableHead>CPU</TableHead>
                            <TableHead>RAM</TableHead>
                            <TableHead>Versione</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {hosts.map((h, i) => (
                            <TableRow key={i}>
                              <TableCell className="font-medium">{h.hostname}</TableCell>
                              <TableCell><Badge variant={h.status === "online" ? "default" : "secondary"}>{h.status}</Badge></TableCell>
                              <TableCell>{h.cpu_total_cores ?? "—"} core{h.cpu_model ? ` (${h.cpu_model})` : ""}</TableCell>
                              <TableCell>
                                {h.memory_total_gb != null ? `${h.memory_total_gb.toFixed(1)} GiB` : "—"}
                                {h.memory_usage_percent != null && ` (${h.memory_usage_percent}%)`}
                              </TableCell>
                              <TableCell className="text-sm">{h.proxmox_version ?? "—"}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    ) : (
                      <p className="text-muted-foreground py-4">Nessun host estratto.</p>
                    )}
                  </TabsContent>
                  <TabsContent value="details" className="mt-4">
                    {hosts.length > 0 ? (
                      <div className="space-y-6">
                        {hosts.map((h, i) => (
                          <div key={i} className="rounded-lg border p-4 space-y-4">
                            <h4 className="font-medium">{h.hostname}</h4>
                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 text-sm">
                              <div>
                                <p className="text-xs text-muted-foreground uppercase">CPU</p>
                                <p className="font-medium">{h.cpu_model ?? "—"}</p>
                                {(h.cpu_mhz ?? h.cpu_sockets ?? h.cpu_cores) && (
                                  <p className="text-xs text-muted-foreground">
                                    {[h.cpu_mhz && `${h.cpu_mhz} MHz`, h.cpu_sockets && `${h.cpu_sockets} socket`, h.cpu_cores && `${h.cpu_cores} core`].filter(Boolean).join(" · ")}
                                  </p>
                                )}
                              </div>
                              <div>
                                <p className="text-xs text-muted-foreground uppercase">Kernel</p>
                                <p className="font-medium">{h.kernel_version ?? "—"}</p>
                              </div>
                              <div>
                                <p className="text-xs text-muted-foreground uppercase">Uptime</p>
                                <p className="font-medium">{h.uptime_human ?? "—"}</p>
                              </div>
                              <div>
                                <p className="text-xs text-muted-foreground uppercase">Root FS</p>
                                <p className="font-medium">
                                  {h.rootfs_used_gb != null && h.rootfs_total_gb != null
                                    ? `${h.rootfs_used_gb.toFixed(1)} / ${h.rootfs_total_gb.toFixed(1)} GiB`
                                    : "—"}
                                </p>
                              </div>
                              {h.hardware_manufacturer && (
                                <div>
                                  <p className="text-xs text-muted-foreground uppercase">Produttore</p>
                                  <p className="font-medium">{h.hardware_manufacturer}</p>
                                </div>
                              )}
                              {h.hardware_model && (
                                <div>
                                  <p className="text-xs text-muted-foreground uppercase">Modello</p>
                                  <p className="font-medium">{h.hardware_model}</p>
                                </div>
                              )}
                              {h.hardware_serial && (
                                <div>
                                  <p className="text-xs text-muted-foreground uppercase">Seriale</p>
                                  <p className="font-mono text-xs">{h.hardware_serial}</p>
                                </div>
                              )}
                              {h.subscription && (
                                <>
                                  <div>
                                    <p className="text-xs text-muted-foreground uppercase">Licenza</p>
                                    <p className="font-medium">
                                      <Badge variant={h.subscription.status === "active" ? "default" : "secondary"}>
                                        {h.subscription.status || "—"}
                                      </Badge>
                                    </p>
                                  </div>
                                  {h.subscription.productname && (
                                    <div>
                                      <p className="text-xs text-muted-foreground uppercase">Prodotto</p>
                                      <p className="font-medium">{h.subscription.productname}</p>
                                    </div>
                                  )}
                                  {h.subscription.level && (
                                    <div>
                                      <p className="text-xs text-muted-foreground uppercase">Livello</p>
                                      <p className="font-medium">{h.subscription.level}</p>
                                    </div>
                                  )}
                                  {h.subscription.key && (
                                    <div className="col-span-2">
                                      <p className="text-xs text-muted-foreground uppercase">Codice licenza</p>
                                      <p className="font-mono text-xs break-all">{h.subscription.key}</p>
                                    </div>
                                  )}
                                  {h.subscription.nextduedate && (
                                    <div>
                                      <p className="text-xs text-muted-foreground uppercase">Scadenza</p>
                                      <p className="font-medium">{h.subscription.nextduedate}</p>
                                    </div>
                                  )}
                                  {h.subscription.serverid && (
                                    <div>
                                      <p className="text-xs text-muted-foreground uppercase">Server ID</p>
                                      <p className="font-mono text-xs">{h.subscription.serverid}</p>
                                    </div>
                                  )}
                                </>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-muted-foreground py-4">Nessun host. Esegui uno scan per acquisire i dati.</p>
                    )}
                  </TabsContent>
                  <TabsContent value="vms" className="mt-4">
                    {vms.length > 0 ? (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Nome</TableHead>
                            <TableHead>Tipo</TableHead>
                            <TableHead>Nodo</TableHead>
                            <TableHead>vCPU</TableHead>
                            <TableHead>RAM</TableHead>
                            <TableHead>Storage</TableHead>
                            <TableHead>IP</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {(vms as { node: string; vmid: number; name: string; type: string; maxcpu: number; memory_mb: number; disk_gb: number; ip_addresses: string[] }[]).map((vm) => (
                            <TableRow key={`${vm.node}-${vm.vmid}`}>
                              <TableCell className="font-medium">{vm.name}</TableCell>
                              <TableCell><Badge variant="outline">{vm.type.toUpperCase()}</Badge></TableCell>
                              <TableCell>{vm.node}</TableCell>
                              <TableCell>{vm.maxcpu}</TableCell>
                              <TableCell>{Math.round(vm.memory_mb / 1024)} GiB</TableCell>
                              <TableCell>{vm.disk_gb.toFixed(1)} GiB</TableCell>
                              <TableCell className="font-mono text-xs">{vm.ip_addresses?.length ? vm.ip_addresses.join(", ") : "—"}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    ) : (
                      <p className="text-muted-foreground py-4">Nessuna VM/CT in esecuzione.</p>
                    )}
                  </TabsContent>
                </Tabs>
                <p className="text-sm text-muted-foreground mt-4">
                  Vai a Dispositivi → Hypervisor per abbinare le VM all&apos;inventario tramite il pulsante Link.
                </p>
              </CardContent>
            </Card>
          );
        } catch {
          return null;
        }
      })()}

      {device.device_type === "switch" && device.stp_info && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle className="text-base">Spanning Tree Protocol (STP)</CardTitle>
              <div className="flex items-center gap-2">
                {device.stp_info.is_root_bridge && (
                  <Badge className="bg-emerald-600 hover:bg-emerald-600">ROOT BRIDGE</Badge>
                )}
                {device.stp_info.protocol === "rstp" && (
                  <Badge variant="secondary">RSTP</Badge>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-4">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Bridge ID</p>
                <p className="font-mono text-sm font-medium mt-0.5">{device.stp_info.bridge_id ?? "—"}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Root Bridge ID</p>
                <p className="font-mono text-sm font-medium mt-0.5">{device.stp_info.root_bridge_id ?? "—"}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Priority</p>
                <p className="font-mono text-sm font-medium mt-0.5">{device.stp_info.priority ?? "—"}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Root Cost</p>
                <p className="font-mono text-sm font-medium mt-0.5">{device.stp_info.root_cost ?? "—"}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Root Port</p>
                <p className="font-mono text-sm font-medium mt-0.5">{device.stp_info.root_port ?? "—"}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Hello Time</p>
                <p className="font-mono text-sm font-medium mt-0.5">{device.stp_info.hello_time_s != null ? `${device.stp_info.hello_time_s} s` : "—"}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Forward Delay</p>
                <p className="font-mono text-sm font-medium mt-0.5">{device.stp_info.forward_delay_s != null ? `${device.stp_info.forward_delay_s} s` : "—"}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Max Age</p>
                <p className="font-mono text-sm font-medium mt-0.5">{device.stp_info.max_age_s != null ? `${device.stp_info.max_age_s} s` : "—"}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-4xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Modifica {getClassificationLabel(device.classification ?? "") || device.device_type}</DialogTitle>
            <CardDescription>
              Modifica identificazione, gruppo, profilo e credenziali. Il profilo vendor determina i comandi usati per acquisire i dati.
            </CardDescription>
          </DialogHeader>
          <form onSubmit={handleEdit} className="space-y-5">
            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground">Identificazione</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Nome</Label>
                  <Input name="name" required defaultValue={device.name} placeholder="Router Core" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">IP</Label>
                  <Input name="host" required defaultValue={device.host} placeholder="192.168.1.1" />
                </div>
                {((device.device_type === "hypervisor") || (device as { scan_target?: string }).scan_target === "proxmox") && (
                  <div className="space-y-2 col-span-2">
                    <Label htmlFor="api_url">URL API Proxmox</Label>
                    <Input
                      id="api_url"
                      name="api_url"
                      defaultValue={device.api_url ?? ""}
                      placeholder="Opzionale: https://ip:8006 o http://ip:8006 (usa http:// se errore SSL)"
                      className="font-mono"
                    />
                    <p className="text-xs text-muted-foreground">
                      Se vuoto usa IP + porta. Per errore &quot;wrong version number&quot; prova <code className="bg-muted px-1 rounded">http://</code> invece di https.
                    </p>
                  </div>
                )}
              </div>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground">Gruppo e profilo</p>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs flex items-center">Classificazione<Tip text="Categoria in cui appare nella lista dispositivi (es. Router, Switch, Storage)." /></Label>
                  <Select value={editClassification} onValueChange={(v) => setEditClassification(v ?? "")}>
                    <SelectTrigger><SelectValue placeholder="Seleziona" /></SelectTrigger>
                    <SelectContent>
                      {DEVICE_CLASSIFICATIONS_ORDERED.filter((c) => c !== "unknown").map((c) => (
                        <SelectItem key={c} value={c}>{getClassificationLabel(c)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs flex items-center">Vendor<Tip text="Profilo che determina i comandi SSH/SNMP usati (es. MikroTik, Cisco, HP ProCurve)." /></Label>
                  <Select value={editVendor} onValueChange={(v) => { setEditVendor(v ?? ""); if (v !== "hp") setEditVendorSubtype(null); }}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="mikrotik">MikroTik</SelectItem>
                      <SelectItem value="ubiquiti">Ubiquiti</SelectItem>
                      <SelectItem value="cisco">Cisco</SelectItem>
                      <SelectItem value="hp">HP / Aruba</SelectItem>
                      <SelectItem value="omada">TP-Link Omada</SelectItem>
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
                {editVendor === "hp" && (
                  <div className="space-y-1">
                    <Label className="text-xs">Sottotipo HP</Label>
                    <Select value={editVendorSubtype ?? "none"} onValueChange={(v) => setEditVendorSubtype(v === "none" ? null : v)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Generico</SelectItem>
                        <SelectItem value="procurve">ProCurve / Aruba</SelectItem>
                        <SelectItem value="comware">Comware</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div className="space-y-1">
                  <Label className="text-xs flex items-center">Protocollo<Tip text="Come connettersi: SSH per comandi, SNMP per porte/LLDP, WinRM per Windows." /></Label>
                  <Select value={editProtocol} onValueChange={(v) => setEditProtocol(v ?? "")}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ssh">SSH</SelectItem>
                      <SelectItem value="snmp_v2">SNMP v2</SelectItem>
                      <SelectItem value="snmp_v3">SNMP v3</SelectItem>
                      <SelectItem value="api">API REST</SelectItem>
                      <SelectItem value="winrm">WinRM (Windows)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs flex items-center">Tipo scansione<Tip text="Forza il tipo di scan. Automatico = rilevato da vendor/protocollo." /></Label>
                  <Select value={editScanTarget ?? "none"} onValueChange={(v) => setEditScanTarget(v === "none" ? null : v)}>
                    <SelectTrigger><SelectValue placeholder="Automatico" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Automatico</SelectItem>
                      <SelectItem value="proxmox">Proxmox</SelectItem>
                      <SelectItem value="vmware">VMware</SelectItem>
                      <SelectItem value="windows">Windows</SelectItem>
                      <SelectItem value="linux">Linux</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
            <CredentialAssignmentFields
              credentials={credentials}
              credentialId={editCredentialId}
              snmpCredentialId={editSnmpCredentialId}
              onCredentialIdChange={(v) => setEditCredentialId(v)}
              onSnmpCredentialIdChange={(v) => setEditSnmpCredentialId(v)}
              credentialPlaceholder="Nessuna (credenziali inline)"
              showInlineCreds={editProtocol === "ssh" || editProtocol === "api" || editProtocol === "winrm"}
              inlineUsername={device.username || ""}
              showPortAndCommunity
              portDefaultValue={device.port ?? 22}
              idPrefix="device-detail-edit"
              testButton={
                <Button type="button" variant="outline" size="sm" onClick={handleTestConnection} disabled={testingConnection}>
                  <Radio className={`h-4 w-4 mr-2 ${testingConnection ? "animate-pulse" : ""}`} />
                  {testingConnection ? "Test in corso…" : "Testa credenziali"}
                </Button>
              }
            />
            <Button type="submit" className="w-full" disabled={editSaving}>
              {editSaving ? "Salvataggio..." : "Salva modifiche"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <Tabs defaultValue={device.device_type === "router" && totalPorts === 0 ? "arp" : "ports"}>
        <TabsList>
          {device.device_type === "router" && <TabsTrigger value="arp">Tabella ARP</TabsTrigger>}
          {totalPorts > 0 && <TabsTrigger value="ports">Schema Porte ({totalPorts})</TabsTrigger>}
          {device.device_type === "switch" && <TabsTrigger value="mac">MAC Table ({device.mac_port_entries.length})</TabsTrigger>}
        </TabsList>

        {device.device_type === "router" && (
          <TabsContent value="arp" className="mt-4">
            <Card>
              <CardHeader className="py-3">
                <CardTitle className="text-base">
                  ARP Entries ({device.arp_entries.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>IP</TableHead>
                      <TableHead>MAC</TableHead>
                      <TableHead>Interfaccia</TableHead>
                      <TableHead>Host Associato</TableHead>
                      <TableHead>Timestamp</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {device.arp_entries.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5}>
                          <EmptyState
                            icon={Database}
                            title="Nessuna entry ARP"
                            description="Clicca 'Aggiorna Dati' per acquisire la tabella ARP dal router."
                          />
                        </TableCell>
                      </TableRow>
                    ) : device.arp_entries.map((entry) => (
                      <TableRow key={entry.id}>
                        <TableCell className="font-mono">{entry.ip || "—"}</TableCell>
                        <TableCell className="font-mono text-xs">{entry.mac}</TableCell>
                        <TableCell>{entry.interface_name || "—"}</TableCell>
                        <TableCell>
                          {entry.host_id ? (
                            <Link href={`/hosts/${entry.host_id}`} className="text-primary hover:underline">
                              {entry.host_name || entry.host_ip || `Host #${entry.host_id}`}
                            </Link>
                          ) : "—"}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {new Date(entry.timestamp).toLocaleString("it-IT")}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {(totalPorts > 0 || device.device_type === "switch") && (
          <>
            <TabsContent value="ports" className="mt-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Schema porte ({totalPorts})</CardTitle>
                  <CardDescription>
                    {upPorts} up · {totalPorts - upPorts} down · {trunkPorts} trunk
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10"></TableHead>
                        <TableHead className="w-10"></TableHead>
                        <TableHead>Porta</TableHead>
                        <TableHead>Stato</TableHead>
                        <TableHead>Velocità</TableHead>
                        <TableHead>VLAN</TableHead>
                        <TableHead className="whitespace-nowrap">STP</TableHead>
                        <TableHead>PoE</TableHead>
                        <TableHead>Neighbor / Dispositivo collegato</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(!device.switch_ports || device.switch_ports.length === 0) ? (
                        <TableRow>
                          <TableCell colSpan={9}>
                            <EmptyState
                              icon={Cable}
                              title="Nessuna porta rilevata"
                              description="Clicca 'Aggiorna Dati' per acquisire lo schema porte, LLDP/CDP e Spanning Tree."
                            />
                          </TableCell>
                        </TableRow>
                      ) : device.switch_ports.map((port) => (
                        <TableRow key={port.id} className={`${port.status === "disabled" ? "opacity-40" : ""} ${port.status === "up" ? "" : "bg-muted/30"}`}>
                          <TableCell className="text-center" title={port.is_trunk ? "Trunk/LAG" : "Porta fisica"}>
                            {getPortTypeIcon(port.port_name, port.is_trunk === 1)}
                          </TableCell>
                          <TableCell><PortStatusDot status={port.status} /></TableCell>
                          <TableCell className="font-mono text-sm font-medium">{port.port_name}</TableCell>
                          <TableCell>
                            <Badge
                              variant={port.status === "up" ? "default" : "secondary"}
                              className="text-[10px] px-1.5 py-0"
                            >
                              {port.status || "—"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {port.speed || "—"}
                            {port.duplex && port.duplex !== "unknown" && ` / ${port.duplex}`}
                          </TableCell>
                          <TableCell>
                            {port.vlan != null ? (
                              <span className="font-mono text-xs">{port.vlan}</span>
                            ) : "—"}
                          </TableCell>
                          <TableCell className="whitespace-nowrap">
                            {port.stp_state ? (
                              <Badge variant="outline" className="text-[10px] capitalize" title="Spanning Tree">
                                {port.stp_state}
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <PoeBadge status={port.poe_status} powerMw={port.poe_power_mw} />
                          </TableCell>
                          <TableCell>
                            {port.is_trunk ? (
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger
                                    render={
                                      <Badge variant="outline" className="text-[10px] cursor-help">
                                      <Cable className="h-3 w-3 mr-1" />
                                      {(port.trunk_neighbor_name || port.trunk_neighbor_port)
                                        ? [port.trunk_neighbor_name, port.trunk_neighbor_port].filter(Boolean).join(" — ")
                                        : port.trunk_primary_name
                                          ? (port.trunk_primary_device_id ? (
                                            <Link href={`/devices/${port.trunk_primary_device_id}`} className="hover:underline">
                                              → {port.trunk_primary_name}
                                            </Link>
                                          ) : `→ ${port.trunk_primary_name}`)
                                          : `Trunk (${port.mac_count} MAC)`}
                                      </Badge>
                                    }
                                  />
                                  <TooltipContent>
                                    <p>
                                      {(port.trunk_neighbor_name || port.trunk_neighbor_port)
                                        ? `Apparato collegato: ${[port.trunk_neighbor_name, port.trunk_neighbor_port].filter(Boolean).join(" / ")} (LLDP/CDP)`
                                        : port.trunk_primary_name
                                          ? `Peer principale: ${port.trunk_primary_name} (da ARP / dispositivi registrati)`
                                          : `${port.mac_count} MAC address — porta trunk / uplink`}
                                    </p>
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            ) : port.mac_count === 1 && port.single_mac ? (
                              <div className="flex flex-col">
                                <span className="font-mono text-xs">{port.single_mac}</span>
                                {(port.single_mac_hostname || port.single_mac_ip) && (
                                  port.host_id ? (
                                    <Link href={`/hosts/${port.host_id}`} className="text-xs text-primary hover:underline">
                                      {port.single_mac_hostname || port.single_mac_ip}
                                      {port.single_mac_vendor && ` (${port.single_mac_vendor})`}
                                    </Link>
                                  ) : (
                                    <span className="text-xs text-muted-foreground">
                                      {port.single_mac_hostname || port.single_mac_ip}
                                      {port.single_mac_vendor && ` (${port.single_mac_vendor})`}
                                    </span>
                                  )
                                )}
                              </div>
                            ) : port.status === "up" ? (
                              <span className="text-xs text-muted-foreground">Nessun MAC</span>
                            ) : (
                              <span className="text-xs text-muted-foreground/40">—</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="mac" className="mt-4">
              <Card>
                <CardHeader className="py-3">
                  <CardTitle className="text-base">
                    MAC Address Table ({device.mac_port_entries.length})
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Porta</TableHead>
                        <TableHead>MAC</TableHead>
                        <TableHead>VLAN</TableHead>
                        <TableHead>Stato Porta</TableHead>
                        <TableHead>Host Associato</TableHead>
                        <TableHead>Timestamp</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {device.mac_port_entries.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={6} className="p-0">
                            <EmptyState
                              icon={Database}
                              title="Nessuna entry MAC"
                              description="Clicca 'Aggiorna Dati' per acquisire la MAC table dal dispositivo."
                            />
                          </TableCell>
                        </TableRow>
                      ) : device.mac_port_entries.map((entry) => (
                        <TableRow key={entry.id}>
                          <TableCell className="font-mono font-medium">{entry.port_name}</TableCell>
                          <TableCell className="font-mono text-xs">{entry.mac}</TableCell>
                          <TableCell>{entry.vlan || "—"}</TableCell>
                          <TableCell>
                            {entry.port_status && (
                              <Badge variant={entry.port_status === "up" ? "default" : "secondary"}>
                                {entry.port_status}
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell>
                            {entry.host_ip ? (
                              <span className="text-primary">
                                {entry.host_name || entry.host_ip}
                              </span>
                            ) : "—"}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {new Date(entry.timestamp).toLocaleString("it-IT")}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>
          </>
        )}

      </Tabs>

      {neighborGroups.size > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Cable className="h-4 w-4" />
              Neighbor LLDP/CDP ({neighborGroups.size})
            </CardTitle>
            <CardDescription>Dispositivi collegati rilevati via LLDP o CDP</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {Array.from(neighborGroups.values()).map((group, idx) => (
                <div key={idx} className="rounded-lg border bg-muted/30 p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <h4 className="font-medium">{group.name}</h4>
                      {group.port && (
                        <p className="text-sm text-muted-foreground font-mono mt-0.5">Porta remota: {group.port}</p>
                      )}
                    </div>
                    <Badge variant="secondary">{group.ports.length} link</Badge>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {group.ports.map((p) => (
                      <Badge key={p.id} variant="outline" className="font-mono text-xs">
                        {p.port_name} → {p.status || "—"}
                        {p.stp_state && ` · STP: ${p.stp_state}`}
                      </Badge>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
