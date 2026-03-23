"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
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
  DialogScrollableArea,
  DialogTitle,
  DIALOG_PANEL_COMPACT_CLASS,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ArrowLeft, RefreshCw, Zap, ZapOff, Cable, Minus, Pencil, Key, Server, Wifi, Database, Activity, Radio, Package, ExternalLink, Plus, Monitor, Cpu, HardDrive, Shield, Users, Clock, Award, Layers, Info, Download } from "lucide-react";

import { toast } from "sonner";
import { getClassificationLabel } from "@/lib/device-classifications";
import {
  CredentialAssignmentFields,
  getPrimaryCredentialLabels,
} from "@/components/shared/credential-assignment-fields";
import { DeviceFormFields } from "@/components/shared/device-form-fields";
import { DeviceCredentialsTable } from "@/components/shared/device-credentials-table";
import {
  inferProductProfileFromLegacy,
  PRODUCT_PROFILE_LABELS,
  vendorSubtypeFromProductProfile,
  type ProductProfileId,
} from "@/lib/device-product-profiles";
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
  // Linux-specific
  kernel_version?: string | null;
  uptime?: string | null;
  load_average?: string | null;
  virtualization?: string | null;
  is_virtual?: boolean;
  ram_free_mb?: number | null;
  physical_disks?: Array<{ device: string; model?: string; size_gb?: number; serial?: string; interface_type?: string; vendor?: string; rotational?: boolean }>;
  packages_count?: number | null;
  // Linux: porte, firewall, cron
  listening_ports?: Array<{ port: number; protocol: string; process?: string; bind_address?: string }>;
  firewall_active?: boolean;
  firewall_type?: string | null;
  firewall_rules_count?: number | null;
  cron_jobs?: Array<{ user: string; schedule: string; command: string }>;
  // MikroTik firewall counts
  firewall_filter_count?: number | null;
  firewall_nat_count?: number | null;
  firewall_mangle_count?: number | null;
  domain_joined?: boolean;
  last_logged_on_user?: string | null;
  logged_on_users?: Array<{ username: string; session_type?: string; logon_time?: string }>;
  user_profiles?: Array<{
    username: string; sid?: string; profile_path?: string; loaded?: boolean; last_use?: string;
    ad_display_name?: string; ad_email?: string; ad_department?: string; ad_title?: string; ad_enabled?: boolean; ad_last_logon?: string;
  }>;
  /** Synology / QNAP (SNMP + SSH) */
  nas_inventory?: {
    vendor?: string;
    sources?: string[];
    snmp?: {
      temperature_c?: number | null;
      cpu_temperature_c?: number | null;
      disks?: Array<{
        index?: string;
        model?: string;
        status?: string;
        temperature_c?: number | null;
        type?: string;
        id?: string;
        serial?: string;
        capacity_gb?: number | null;
        slot?: string;
        smart_health?: string;
      }>;
      raids?: Array<{ name?: string; status?: string; free_gb?: number | null; total_gb?: number | null }>;
      volumes_snmp?: Array<{
        name?: string;
        size_gb?: number | null;
        free_gb?: number | null;
        status?: string | null;
        raid_type?: string | null;
      }>;
      storage_pools?: Array<{ name?: string; status?: string | null; total_gb?: number | null; used_gb?: number | null }>;
      volume_io?: Array<{ name?: string; read_bps?: string | null; write_bps?: string | null }>;
      ups?: { status?: string | null; battery_pct?: string | null };
      services?: Array<{ name?: string; state?: string | null }>;
      qts5_pool_rows?: number;
    };
    ssh?: {
      mdstat_summary?: string;
      cpu_model?: string | null;
      kernel?: string | null;
      synology_shares_preview?: string;
      synology_packages_count?: number | null;
      synology_storage_lines?: string;
      synology_temperature_lines?: string;
      qnap_raid_info_preview?: string;
      qnap_storage_cfg_preview?: string;
      qnap_qpkg_preview?: string;
    };
  };
}

interface NeighborRow {
  id: number;
  device_id: number;
  local_port: string;
  remote_device_name: string;
  remote_port: string;
  protocol: string;
  remote_ip: string | null;
  remote_mac: string | null;
  remote_platform: string | null;
  timestamp: string;
}

interface RouteRow {
  id: number;
  device_id: number;
  destination: string;
  gateway: string | null;
  interface_name: string | null;
  protocol: string;
  metric: number | null;
  distance: number | null;
  active: number;
  timestamp: string;
}

interface DeviceDetail extends Omit<NetworkDevice, "stp_info" | "last_device_info_json"> {
  arp_entries: (ArpEntry & { host_ip?: string; host_name?: string })[];
  mac_port_entries: (MacPortEntry & { host_ip?: string; host_name?: string })[];
  switch_ports: SwitchPort[];
  stp_info: StpInfo | null;
  device_info: DeviceInfo | null;
  neighbors?: NeighborRow[];
  routes?: RouteRow[];
  dhcp_leases?: DhcpLeaseRow[];
}

interface DhcpLeaseRow {
  id: number;
  ip_address: string;
  mac_address: string;
  hostname: string | null;
  status: string | null;
  server_name: string | null;
  lease_expires: string | null;
  dynamic_lease: number | null;
  last_synced: string;
}

/** Payload da `last_proxmox_scan_result` (eventualmente troncato dall'API GET). */
interface ProxmoxScanViewModel {
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
  vms?: Array<{
    node: string;
    vmid: number;
    name: string;
    type: string;
    maxcpu: number;
    memory_mb: number;
    disk_gb: number;
    ip_addresses: string[];
  }>;
  scanned_at?: string;
  avvisi?: string[];
  _truncated?: boolean;
  _total_vm_rows?: number;
}

const PROXMOX_VM_RENDER_CAP = 450;

interface MikrotikDhcpLease {
  ip: string;
  mac: string;
  hostname: string | null;
  status?: string;
  server?: string;
  expiresAfter?: string;
  lastSeen?: string;
  comment?: string;
}

interface MikrotikDhcpServer {
  name: string;
  interface: string;
  addressPool: string;
  disabled: boolean;
}

interface MikrotikDhcpPool {
  name: string;
  ranges: string;
  nextPool?: string;
}

interface MikrotikConfig {
  exportFull: string;
  exportCompact?: string;
  systemInfo?: {
    identity?: string;
    version?: string;
    boardName?: string;
    serialNumber?: string;
    uptime?: string;
  };
}

interface MikrotikData {
  config: MikrotikConfig | null;
  leases: MikrotikDhcpLease[];
  servers: MikrotikDhcpServer[];
  pools: MikrotikDhcpPool[];
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

type DeviceCredentialRowInput = Pick<
  NetworkDevice,
  | "protocol"
  | "port"
  | "credential_id"
  | "snmp_credential_id"
  | "username"
  | "community_string"
  | "device_type"
>;

/** Righe tabella credenziali: un protocollo per riga (principale + SNMP aggiuntivo se applicabile). */
function buildDeviceCredentialRows(
  device: DeviceCredentialRowInput,
  creds: Credential[]
): { key: string; protocolLabel: string; archiveLabel: string; note: string }[] {
  const nameOf = (id: number | null | undefined) =>
    id ? creds.find((c) => c.id === id)?.name ?? `ID ${id}` : null;
  const cn = nameOf(device.credential_id);
  const sn = nameOf(device.snmp_credential_id);
  const rows: { key: string; protocolLabel: string; archiveLabel: string; note: string }[] = [];

  if (device.protocol === "snmp_v2" || device.protocol === "snmp_v3") {
    rows.push({
      key: "snmp-main",
      protocolLabel: `${device.protocol.toUpperCase()} — gestione dispositivo`,
      archiveLabel: sn || cn || (device.community_string ? "Community inline" : "—"),
      note: `Porta ${device.port}`,
    });
    return rows;
  }

  const primaryTitle =
    device.protocol === "ssh"
      ? "SSH — shell / comandi"
      : device.protocol === "winrm"
        ? "WinRM — Windows Management"
        : device.protocol === "api"
          ? "API REST"
          : String(device.protocol);

  rows.push({
    key: "primary",
    protocolLabel: primaryTitle,
    archiveLabel: cn || (device.username ? "Credenziali inline (utente/password)" : "—"),
    note: `Porta ${device.port}`,
  });

  const showSnmp =
    !!device.snmp_credential_id ||
    !!device.community_string ||
    device.device_type === "router" ||
    device.device_type === "switch";

  if (showSnmp) {
    rows.push({
      key: "snmp-sup",
      protocolLabel: "SNMP — walk, porte, LLDP, spanning tree",
      archiveLabel: sn || (device.community_string ? "Community inline" : "—"),
      note: "Opzionale, oltre all’accesso principale",
    });
  }

  return rows;
}

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
  const [editProductProfile, setEditProductProfile] = useState<string | null>(null);
  const [editClassification, setEditClassification] = useState<string>("");
  const [editSaving, setEditSaving] = useState(false);

  // MikroTik
  const [mikrotikData, setMikrotikData] = useState<MikrotikData | null>(null);
  const [mikrotikLoading, setMikrotikLoading] = useState(false);
  const [mikrotikImporting, setMikrotikImporting] = useState(false);
  const [showMikrotikConfig, setShowMikrotikConfig] = useState(false);

  useEffect(() => {
    if (device) {
      setEditVendor(device.vendor);
      setEditProtocol(device.protocol);
      setEditVendorSubtype(device.vendor_subtype ?? null);
      setEditCredentialId(device.credential_id != null ? String(device.credential_id) : null);
      setEditSnmpCredentialId(device.snmp_credential_id != null ? String(device.snmp_credential_id) : null);
      setEditScanTarget((device as { scan_target?: string | null }).scan_target ?? null);
      setEditClassification((device as { classification?: string | null }).classification ?? "");
      setEditProductProfile(
        device.product_profile ?? inferProductProfileFromLegacy(device.vendor, device.device_type, device.vendor_subtype, device.scan_target)
      );
    }
  }, [device]);

  useEffect(() => {
    fetch("/api/credentials")
      .then((r) => r.ok ? r.json() : [])
      .then(setCredentials)
      .catch(() => setCredentials([]));
  }, []);

  const fetchDevice = useCallback(async () => {
    const id = params.id;
    if (!id || typeof id !== "string" || !/^\d+$/.test(id)) {
      setLoading(false);
      router.push("/devices");
      return;
    }
    try {
      const res = await fetch(`/api/devices/${id}`, { cache: "no-store" });
      if (!res.ok) {
        router.push("/devices");
        return;
      }
      const data = await res.json();
      if (data?.error || !data?.id) {
        toast.error("Dati dispositivo non validi");
        router.push("/devices");
        return;
      }
      setDevice({
        ...data,
        arp_entries: Array.isArray(data.arp_entries) ? data.arp_entries : [],
        mac_port_entries: Array.isArray(data.mac_port_entries) ? data.mac_port_entries : [],
        switch_ports: Array.isArray(data.switch_ports) ? data.switch_ports : [],
      });
    } catch {
      toast.error("Impossibile caricare il dispositivo");
      router.push("/devices");
    } finally {
      setLoading(false);
    }
  }, [params.id, router]);

  useEffect(() => {
    void fetchDevice();
  }, [fetchDevice]);

  const proxmoxScanData = useMemo((): ProxmoxScanViewModel | null => {
    if (!device) return null;
    const pd = (device as unknown as { proxmox_data?: ProxmoxScanViewModel | null }).proxmox_data;
    if (pd && typeof pd === "object") return pd;
    return null;
  }, [device]);

  const isMikrotik = device?.vendor === "mikrotik" && device?.protocol === "ssh";

  const fetchMikrotikData = useCallback(async () => {
    if (!device || !isMikrotik) return;
    setMikrotikLoading(true);
    try {
      const res = await fetch(`/api/devices/${params.id}/mikrotik?action=all`);
      if (!res.ok) throw new Error("Errore caricamento dati MikroTik");
      const data = await res.json();
      setMikrotikData(data);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Errore MikroTik");
    } finally {
      setMikrotikLoading(false);
    }
  }, [device, isMikrotik, params.id]);

  const handleImportDhcpLeases = async (selectedLeases?: MikrotikDhcpLease[]) => {
    if (!mikrotikData) return;
    const leases = selectedLeases || mikrotikData.leases;
    if (leases.length === 0) {
      toast.info("Nessun lease da importare");
      return;
    }
    setMikrotikImporting(true);
    try {
      const res = await fetch(`/api/devices/${params.id}/mikrotik?action=import-dhcp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leases, overwriteHostname: false }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(`Importati: ${data.imported}, Aggiornati: ${data.updated}, Saltati: ${data.skipped}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Errore importazione");
    } finally {
      setMikrotikImporting(false);
    }
  };

  const downloadConfig = () => {
    if (!mikrotikData?.config?.exportFull) return;
    const blob = new Blob([mikrotikData.config.exportFull], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `mikrotik-${device?.name || params.id}-config.rsc`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Configurazione scaricata");
  };

  async function handleQuery() {
    if (!device) return;
    const target = (device as { scan_target?: string | null }).scan_target;
    if (target === "vmware") {
      toast.info("Scansione VMware non ancora implementata (API vCenter). Usa SSH sul singolo ESXi se configurato come dispositivo Linux.");
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

  const credentialRows = useMemo(
    () => (device ? buildDeviceCredentialRows(device, credentials) : []),
    [device, credentials]
  );
  const primaryCredLabels = useMemo(() => getPrimaryCredentialLabels(editProtocol), [editProtocol]);

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
    if (editProductProfile) body.product_profile = editProductProfile;
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

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-4">
          <Link href={device.device_type === "router" ? "/devices/router" : device.device_type === "switch" ? "/devices/switch" : "/devices"}>
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
              {device.product_profile && (
                <Badge variant="outline" className="text-xs font-normal">
                  {PRODUCT_PROFILE_LABELS[device.product_profile as ProductProfileId] ?? device.product_profile}
                </Badge>
              )}
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
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Ultimo aggiornamento</p>
              <p className="text-sm font-medium mt-0.5">
                {lastRefresh ? new Date(lastRefresh).toLocaleString("it-IT") : <span className="text-muted-foreground">Mai</span>}
              </p>
            </div>
          </div>

          <div className="mt-5 pt-4 border-t border-border">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-2">
              <Key className="h-3.5 w-3.5" />
              Credenziali archivio per protocollo
            </p>
            <p className="text-xs text-muted-foreground mb-3">
              Ogni riga indica quale credenziale viene usata per quel tipo di accesso. Modifica da &quot;Modifica&quot; in alto.
            </p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[40%]">Protocollo / ambito</TableHead>
                  <TableHead>Credenziale archivio</TableHead>
                  <TableHead className="w-[28%]">Nota</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {credentialRows.map((row) => (
                  <TableRow key={row.key}>
                    <TableCell className="font-medium text-sm">{row.protocolLabel}</TableCell>
                    <TableCell>
                      <span className="flex items-center gap-1.5 text-sm">
                        {row.archiveLabel !== "—" && !row.archiveLabel.includes("inline") && (
                          <Key className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        )}
                        {row.archiveLabel}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{row.note}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Inventario asset */}
      <DeviceInventoryCard deviceId={device.id} onRefresh={fetchDevice} />

      {/* Dati tecnici acquisiti (persistenti) */}
      {device.device_info && (() => {
        const di = device.device_info;
        const isNas = !!(di.nas_inventory || di.manufacturer === "Synology" || di.manufacturer === "QNAP");
        const isLinux = !!(di.kernel_version || di.load_average || di.virtualization != null || di.packages_count != null);
        const isWin = !isLinux && !isNas && !!(di.os_name || di.hostname || di.cpu_model || di.domain);
        const hasDetailedInfo = isLinux || isWin;
        const nasSnmpEmpty =
          isNas &&
          !(
            di.nas_inventory?.snmp?.disks?.length ||
            di.nas_inventory?.snmp?.raids?.length ||
            di.nas_inventory?.snmp?.volumes_snmp?.length ||
            di.nas_inventory?.snmp?.storage_pools?.length ||
            di.nas_inventory?.snmp?.volume_io?.length ||
            di.nas_inventory?.snmp?.services?.length ||
            di.nas_inventory?.snmp?.ups != null ||
            di.nas_inventory?.snmp?.temperature_c != null
          );
        return (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Database className="h-4 w-4" />
                {isNas ? "Storage (SNMP + SSH)" : isLinux ? "Dati sistema Linux (SSH)" : isWin ? "Dati sistema Windows (WMI)" : "Dati tecnici acquisiti"}
              </CardTitle>
              {di.scanned_at && (
                <span className="text-xs text-muted-foreground">
                  Acquisiti il {new Date(di.scanned_at).toLocaleString("it-IT")}
                </span>
              )}
            </div>
            {isNas && nasSnmpEmpty && (
              <p className="text-xs text-muted-foreground px-6 -mt-2 pb-1">
                Nessun dato dai MIB SNMP: configura la community (o credenziale SNMP v2/v3) sul dispositivo o in archivio credenziali, poi riesegui la query. Con solo SSH vengono comunque tentati i walk sulla porta 161 con community di default se il NAS risponde.
              </p>
            )}
          </CardHeader>
          <CardContent className="space-y-5">
            {/* === SISTEMA OPERATIVO === */}
            {(di.os_name || di.hostname || di.uptime_days != null || di.uptime || di.kernel_version) && (
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5 mb-2"><Monitor className="h-3.5 w-3.5" /> Sistema operativo</h4>
              <dl className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 text-sm">
                {di.hostname && <div><dt className="text-xs text-muted-foreground">Hostname</dt><dd className="font-mono font-medium">{di.hostname}</dd></div>}
                {(di.domain || di.domain_joined) && <div><dt className="text-xs text-muted-foreground">Dominio</dt><dd className="font-mono flex items-center gap-1">{di.domain ?? "—"}{di.domain_joined && <Badge variant="secondary" className="text-[10px] ml-1">AD</Badge>}</dd></div>}
                {di.os_name && <div className="col-span-2"><dt className="text-xs text-muted-foreground">Sistema operativo</dt><dd>{di.os_name}</dd></div>}
                {di.os_version && <div><dt className="text-xs text-muted-foreground">Versione</dt><dd className="font-mono">{di.os_version}</dd></div>}
                {di.os_build && <div><dt className="text-xs text-muted-foreground">Build</dt><dd className="font-mono">{di.os_build}</dd></div>}
                {di.kernel_version && <div className="col-span-2"><dt className="text-xs text-muted-foreground">Kernel</dt><dd className="font-mono text-xs">{di.kernel_version}</dd></div>}
                {di.architecture && <div><dt className="text-xs text-muted-foreground">Architettura</dt><dd>{di.architecture}</dd></div>}
                {di.is_virtual != null && <div><dt className="text-xs text-muted-foreground">Tipo</dt><dd><Badge variant={di.is_virtual ? "secondary" : "outline"} className="text-xs">{di.is_virtual ? (di.virtualization ?? "Virtuale") : "Fisico"}</Badge></dd></div>}
                {di.domain_role && <div><dt className="text-xs text-muted-foreground">Ruolo</dt><dd><Badge variant="outline" className="text-xs">{di.domain_role}</Badge></dd></div>}
                {di.uptime_days != null && <div><dt className="text-xs text-muted-foreground flex items-center gap-1"><Clock className="h-3 w-3" /> Uptime</dt><dd className="font-semibold">{di.uptime_days} giorni</dd></div>}
                {!di.uptime_days && di.uptime && <div className="col-span-2"><dt className="text-xs text-muted-foreground flex items-center gap-1"><Clock className="h-3 w-3" /> Uptime</dt><dd className="text-xs">{di.uptime}</dd></div>}
                {di.last_boot && <div className="col-span-2"><dt className="text-xs text-muted-foreground">Ultimo avvio</dt><dd className="text-xs font-mono">{(() => { try { return new Date(di.last_boot!).toLocaleString("it-IT"); } catch { return di.last_boot; } })()}</dd></div>}
                {di.load_average && <div className="col-span-2"><dt className="text-xs text-muted-foreground">Load average</dt><dd className="font-mono text-xs">{di.load_average}</dd></div>}
                {di.install_date && <div><dt className="text-xs text-muted-foreground">Data installazione</dt><dd className="text-xs">{(() => { try { return new Date(di.install_date!).toLocaleDateString("it-IT"); } catch { return di.install_date; } })()}</dd></div>}
                {di.registered_user && <div><dt className="text-xs text-muted-foreground">Utente registrato</dt><dd>{di.registered_user}</dd></div>}
                {di.organization && <div><dt className="text-xs text-muted-foreground">Organizzazione</dt><dd>{di.organization}</dd></div>}
              </dl>
            </div>
            )}

            {/* === HARDWARE === (modello/seriale anche senza CPU/RAM — es. NAS) */}
            {(di.cpu_model || di.ram_total_gb || di.manufacturer || di.model || di.serial_number) && (
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5 mb-2"><Cpu className="h-3.5 w-3.5" /> Hardware</h4>
              <dl className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 text-sm">
                {di.manufacturer && <div><dt className="text-xs text-muted-foreground">Produttore</dt><dd>{di.manufacturer}</dd></div>}
                {di.model && <div><dt className="text-xs text-muted-foreground">Modello</dt><dd>{di.model}</dd></div>}
                {di.serial_number && <div><dt className="text-xs text-muted-foreground">Serial Number</dt><dd className="font-mono text-xs">{di.serial_number}</dd></div>}
                {di.system_type && <div><dt className="text-xs text-muted-foreground">Tipo sistema</dt><dd className="text-xs">{di.system_type}</dd></div>}
                {di.cpu_model && <div className="col-span-2"><dt className="text-xs text-muted-foreground">CPU{di.cpu_manufacturer ? ` (${di.cpu_manufacturer})` : ""}</dt><dd className="text-xs">{di.cpu_model}</dd></div>}
                {di.cpu_cores && <div><dt className="text-xs text-muted-foreground">Core / Thread</dt><dd>{di.cpu_cores}{di.cpu_threads ? ` / ${di.cpu_threads}` : ""}{di.processor_count && di.processor_count > 1 ? ` × ${di.processor_count} socket` : ""}</dd></div>}
                {di.cpu_speed_mhz && <div><dt className="text-xs text-muted-foreground">Frequenza</dt><dd>{(di.cpu_speed_mhz / 1000).toFixed(2)} GHz</dd></div>}
                {di.ram_total_gb && <div><dt className="text-xs text-muted-foreground">RAM totale</dt><dd className="font-semibold">{di.ram_total_gb} GB{di.ram_free_mb != null ? <span className="text-muted-foreground font-normal text-xs ml-1">({Math.round(di.ram_free_mb / 1024 * 10) / 10} GB liberi)</span> : null}</dd></div>}
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

            {/* === NAS: inventario SNMP (RAID / dischi MIB) + sintesi mdstat === */}
            {di.nas_inventory?.snmp && (di.nas_inventory.snmp.disks?.length || di.nas_inventory.snmp.raids?.length || di.nas_inventory.snmp.volumes_snmp?.length || di.nas_inventory.snmp.storage_pools?.length || di.nas_inventory.snmp.volume_io?.length || di.nas_inventory.snmp.services?.length || di.nas_inventory.snmp.ups != null || di.nas_inventory.snmp.temperature_c != null || di.nas_inventory.snmp.cpu_temperature_c != null || (di.nas_inventory.snmp.qts5_pool_rows != null && di.nas_inventory.snmp.qts5_pool_rows > 0)) ? (
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5 mb-2"><Layers className="h-3.5 w-3.5" /> Storage — SNMP</h4>
              {(di.nas_inventory.snmp.temperature_c != null || di.nas_inventory.snmp.cpu_temperature_c != null) && (
                <p className="text-xs text-muted-foreground mb-2">
                  {di.nas_inventory.snmp.temperature_c != null && <span>Temperatura sistema: {di.nas_inventory.snmp.temperature_c} °C</span>}
                  {di.nas_inventory.snmp.temperature_c != null && di.nas_inventory.snmp.cpu_temperature_c != null ? " · " : null}
                  {di.nas_inventory.snmp.cpu_temperature_c != null && <span>CPU: {di.nas_inventory.snmp.cpu_temperature_c} °C</span>}
                </p>
              )}
              {di.nas_inventory.snmp.ups && (di.nas_inventory.snmp.ups.status != null || di.nas_inventory.snmp.ups.battery_pct != null) && (
                <p className="text-xs text-muted-foreground mb-2">
                  UPS: {di.nas_inventory.snmp.ups.status ?? "—"}
                  {di.nas_inventory.snmp.ups.battery_pct != null ? ` — batteria ${di.nas_inventory.snmp.ups.battery_pct}%` : ""}
                </p>
              )}
              {di.nas_inventory.snmp.disks && di.nas_inventory.snmp.disks.length > 0 && (
                <div className="mb-3">
                  <dt className="text-xs text-muted-foreground mb-1">Dischi (MIB)</dt>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {di.nas_inventory.snmp.disks.map((d, i) => (
                      <div key={i} className="border rounded-md p-2 text-xs space-y-0.5">
                        {d.model && <div className="font-medium">{d.model}</div>}
                        <div className="flex flex-wrap gap-1 font-mono text-[10px] text-muted-foreground">
                          {d.id && <span>{d.id}</span>}
                          {d.serial && <span className="truncate max-w-[140px]" title={d.serial}>S/N {d.serial}</span>}
                          {d.capacity_gb != null && <span>{d.capacity_gb} GB</span>}
                          {d.status && <Badge variant="outline" className="text-[10px]">{d.status}</Badge>}
                          {d.smart_health && <span>SMART {d.smart_health}</span>}
                          {d.temperature_c != null && <span>{d.temperature_c}°C</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {di.nas_inventory.snmp.storage_pools && di.nas_inventory.snmp.storage_pools.length > 0 && (
                <div className="mb-3">
                  <dt className="text-xs text-muted-foreground mb-1">Storage pool (SNMP)</dt>
                  <div className="space-y-1">
                    {di.nas_inventory.snmp.storage_pools.map((p, i) => (
                      <div key={i} className="border rounded-md p-2 text-xs flex flex-wrap gap-2 justify-between">
                        <span className="font-medium">{p.name ?? `Pool ${i + 1}`}</span>
                        {p.status && <Badge variant="secondary" className="text-[10px]">{p.status}</Badge>}
                        <span className="text-muted-foreground">
                          {p.used_gb != null ? `${p.used_gb} GB usati` : ""}
                          {p.total_gb != null ? ` / ${p.total_gb} GB` : ""}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {di.nas_inventory.snmp.raids && di.nas_inventory.snmp.raids.length > 0 && (
                <div className="mb-3">
                  <dt className="text-xs text-muted-foreground mb-1">RAID / md (SNMP)</dt>
                  <div className="space-y-1">
                    {di.nas_inventory.snmp.raids.map((r, i) => (
                      <div key={i} className="border rounded-md p-2 text-xs flex flex-wrap gap-2 justify-between">
                        <span className="font-medium">{r.name ?? `Gruppo ${i + 1}`}</span>
                        {r.status && <Badge variant="secondary" className="text-[10px]">{r.status}</Badge>}
                        {(r.total_gb != null || r.free_gb != null) && (
                          <span className="text-muted-foreground">{r.free_gb != null ? `${r.free_gb} GB liberi` : ""}{r.total_gb != null ? ` / ${r.total_gb} GB` : ""}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {di.nas_inventory.snmp.volume_io && di.nas_inventory.snmp.volume_io.length > 0 && (
                <div className="mb-3">
                  <dt className="text-xs text-muted-foreground mb-1">I/O volumi (SNMP)</dt>
                  <div className="space-y-1 text-[10px] font-mono">
                    {di.nas_inventory.snmp.volume_io.map((io, i) => (
                      <div key={i} className="border rounded-md p-2">
                        <span className="font-medium text-xs">{io.name}</span>
                        {io.read_bps != null && <span className="ml-2 text-muted-foreground">read {io.read_bps} B/s</span>}
                        {io.write_bps != null && <span className="ml-2 text-muted-foreground">write {io.write_bps} B/s</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {di.nas_inventory.snmp.services && di.nas_inventory.snmp.services.length > 0 && (
                <div className="mb-3">
                  <dt className="text-xs text-muted-foreground mb-1">Servizi (SNMP)</dt>
                  <div className="flex flex-wrap gap-1">
                    {di.nas_inventory.snmp.services.map((s, i) => (
                      <Badge key={i} variant="outline" className="text-[10px]">{s.name}{s.state != null ? ` (${s.state})` : ""}</Badge>
                    ))}
                  </div>
                </div>
              )}
              {di.nas_inventory.snmp.volumes_snmp && di.nas_inventory.snmp.volumes_snmp.length > 0 && (
                <div className="mb-3">
                  <dt className="text-xs text-muted-foreground mb-1">Volumi (SNMP)</dt>
                  <div className="flex flex-wrap gap-2">
                    {di.nas_inventory.snmp.volumes_snmp.map((v, i) => (
                      <Badge key={i} variant="outline" className="text-xs">
                        {v.name}
                        {v.size_gb != null ? ` — ${v.size_gb} GB` : ""}
                        {v.free_gb != null ? `, liberi ${v.free_gb} GB` : ""}
                        {v.raid_type ? ` (${v.raid_type})` : ""}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              {di.nas_inventory.snmp.qts5_pool_rows != null && di.nas_inventory.snmp.qts5_pool_rows > 0 && (
                <p className="text-xs text-muted-foreground mb-2">QNAP: rilevati dati MIB QTS 5.x (pool estesi, {di.nas_inventory.snmp.qts5_pool_rows} varbind)</p>
              )}
            </div>
            ) : null}

            {(di.nas_inventory?.ssh?.mdstat_summary || di.nas_inventory?.ssh?.synology_shares_preview || di.nas_inventory?.ssh?.synology_storage_lines || di.nas_inventory?.ssh?.synology_temperature_lines || di.nas_inventory?.ssh?.qnap_raid_info_preview || di.nas_inventory?.ssh?.qnap_storage_cfg_preview || di.nas_inventory?.ssh?.qnap_qpkg_preview) ? (
            <div className="space-y-3">
              {di.nas_inventory?.ssh?.mdstat_summary ? (
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5 mb-2"><Layers className="h-3.5 w-3.5" /> RAID (kernel)</h4>
                <pre className="text-[10px] font-mono bg-muted/50 rounded-md p-2 overflow-x-auto whitespace-pre-wrap">{di.nas_inventory.ssh.mdstat_summary}</pre>
              </div>
              ) : null}
              {di.nas_inventory?.ssh?.synology_shares_preview ? (
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Cartelle condivise (SSH)</h4>
                <pre className="text-[10px] font-mono bg-muted/50 rounded-md p-2 overflow-x-auto whitespace-pre-wrap max-h-40">{di.nas_inventory.ssh.synology_shares_preview}</pre>
              </div>
              ) : null}
              {di.nas_inventory?.ssh?.synology_packages_count != null ? (
                <p className="text-xs text-muted-foreground">Pacchetti DSM (prime righe): ~{di.nas_inventory.ssh.synology_packages_count} righe</p>
              ) : null}
              {di.nas_inventory?.ssh?.synology_storage_lines ? (
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Pool / volumi (SSH)</h4>
                <pre className="text-[10px] font-mono bg-muted/50 rounded-md p-2 overflow-x-auto whitespace-pre-wrap max-h-36">{di.nas_inventory.ssh.synology_storage_lines}</pre>
              </div>
              ) : null}
              {di.nas_inventory?.ssh?.synology_temperature_lines ? (
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Temperature (SSH)</h4>
                <pre className="text-[10px] font-mono bg-muted/50 rounded-md p-2 overflow-x-auto whitespace-pre-wrap max-h-28">{di.nas_inventory.ssh.synology_temperature_lines}</pre>
              </div>
              ) : null}
              {di.nas_inventory?.ssh?.qnap_raid_info_preview ? (
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">RAID (SSH)</h4>
                <pre className="text-[10px] font-mono bg-muted/50 rounded-md p-2 overflow-x-auto whitespace-pre-wrap max-h-36">{di.nas_inventory.ssh.qnap_raid_info_preview}</pre>
              </div>
              ) : null}
              {di.nas_inventory?.ssh?.qnap_storage_cfg_preview ? (
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Storage (getcfg)</h4>
                <pre className="text-[10px] font-mono bg-muted/50 rounded-md p-2 overflow-x-auto whitespace-pre-wrap max-h-32">{di.nas_inventory.ssh.qnap_storage_cfg_preview}</pre>
              </div>
              ) : null}
              {di.nas_inventory?.ssh?.qnap_qpkg_preview ? (
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">QPKG (prime voci)</h4>
                <pre className="text-[10px] font-mono bg-muted/50 rounded-md p-2 overflow-x-auto whitespace-pre-wrap max-h-28">{di.nas_inventory.ssh.qnap_qpkg_preview}</pre>
              </div>
              ) : null}
            </div>
            ) : null}

            {/* === DISCHI FISICI === */}
            {di.physical_disks && di.physical_disks.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5 mb-2"><HardDrive className="h-3.5 w-3.5" /> Dischi fisici</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                {di.physical_disks.map((d, i) => (
                  <div key={i} className="border rounded-md p-2 text-xs space-y-0.5">
                    <div className="font-mono font-semibold text-[11px]">{d.device}</div>
                    {d.model && <div className="font-medium">{d.model}</div>}
                    <div className="flex flex-wrap gap-1 mt-1">
                      {d.size_gb != null && <Badge variant="secondary" className="text-[10px]">{d.size_gb} GB</Badge>}
                      {d.interface_type && <Badge variant="outline" className="text-[10px]">{d.interface_type}</Badge>}
                      {d.rotational != null && <Badge variant="outline" className="text-[10px]">{d.rotational ? "HDD" : "SSD"}</Badge>}
                    </div>
                    {d.vendor && <div className="text-muted-foreground">{d.vendor}</div>}
                    {d.serial && <div className="font-mono text-muted-foreground text-[10px]">{d.serial}</div>}
                  </div>
                ))}
              </div>
            </div>
            )}

            {/* === VOLUMI / FILESYSTEM === */}
            {di.disks && di.disks.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5 mb-2"><HardDrive className="h-3.5 w-3.5" /> {di.physical_disks ? "Volumi / Filesystem" : "Dischi"} {di.disk_total_gb ? <span className="font-normal">— {di.disk_total_gb} GB totali, {di.disk_free_gb} GB liberi</span> : null}</h4>
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

            {/* === RETE E FIREWALL (Linux + MikroTik) === */}
            {(di.listening_ports || di.firewall_active !== undefined || di.firewall_filter_count !== undefined || di.firewall_filter_count !== null) && (
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5 mb-2"><Shield className="h-3.5 w-3.5" /> Firewall e porte</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Stato firewall Linux */}
                {di.firewall_active !== undefined && (
                  <div>
                    <dt className="text-xs text-muted-foreground mb-1">Firewall</dt>
                    <dd className="text-sm flex items-center gap-2">
                      <Badge variant={di.firewall_active ? "default" : "secondary"}>
                        {di.firewall_active ? "Attivo" : "Inattivo"}
                      </Badge>
                      {di.firewall_type && <span className="text-xs text-muted-foreground">{di.firewall_type}</span>}
                      {di.firewall_rules_count != null && <span className="text-xs text-muted-foreground">({di.firewall_rules_count} regole)</span>}
                    </dd>
                  </div>
                )}
                {/* MikroTik firewall counts */}
                {(di.firewall_filter_count != null || di.firewall_nat_count != null || di.firewall_mangle_count != null) && (
                  <div>
                    <dt className="text-xs text-muted-foreground mb-1">Regole firewall</dt>
                    <div className="flex flex-wrap gap-1.5">
                      {di.firewall_filter_count != null && <Badge variant="outline" className="text-xs">Filter: {di.firewall_filter_count}</Badge>}
                      {di.firewall_nat_count != null && <Badge variant="outline" className="text-xs">NAT: {di.firewall_nat_count}</Badge>}
                      {di.firewall_mangle_count != null && <Badge variant="outline" className="text-xs">Mangle: {di.firewall_mangle_count}</Badge>}
                    </div>
                  </div>
                )}
                {/* Porte in ascolto */}
                {di.listening_ports && di.listening_ports.length > 0 && (
                  <div className="sm:col-span-2">
                    <dt className="text-xs text-muted-foreground mb-1">Porte in ascolto ({di.listening_ports.length})</dt>
                    <div className="flex flex-wrap gap-1">
                      {di.listening_ports.slice(0, 30).map((p, i) => (
                        <Badge key={i} variant="secondary" className="text-[10px] font-mono gap-1">
                          {p.protocol.toUpperCase()}:{p.port}
                          {p.process && <span className="text-muted-foreground">({p.process})</span>}
                        </Badge>
                      ))}
                      {di.listening_ports.length > 30 && <Badge variant="outline" className="text-[10px]">+{di.listening_ports.length - 30}</Badge>}
                    </div>
                  </div>
                )}
              </div>
            </div>
            )}

            {/* === CRON JOBS (Linux) === */}
            {di.cron_jobs && di.cron_jobs.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5 mb-2"><Clock className="h-3.5 w-3.5" /> Cron Jobs ({di.cron_jobs.length})</h4>
              <div className="space-y-1">
                {di.cron_jobs.slice(0, 15).map((j, i) => (
                  <div key={i} className="text-xs flex items-center gap-2 font-mono">
                    <Badge variant="outline" className="text-[10px] shrink-0">{j.user}</Badge>
                    <span className="text-muted-foreground shrink-0">{j.schedule}</span>
                    <span className="truncate">{j.command}</span>
                  </div>
                ))}
                {di.cron_jobs.length > 15 && <p className="text-xs text-muted-foreground">+{di.cron_jobs.length - 15} altri</p>}
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

            {/* === UTENTI / SESSIONI (solo Windows) === */}
            {isWin && (di.last_logged_on_user || (di.logged_on_users && di.logged_on_users.length > 0) || (di.user_profiles && di.user_profiles.length > 0)) && (
            <div className="space-y-3">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5"><Users className="h-3.5 w-3.5" /> Utenti</h4>

              {/* Ultimo utente loggato */}
              {di.last_logged_on_user && (
                <div className="flex items-center gap-2 text-sm">
                  <Clock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="text-muted-foreground text-xs">Ultimo accesso:</span>
                  <span className="font-mono font-medium text-xs">{di.last_logged_on_user}</span>
                </div>
              )}

              {/* Sessioni attive */}
              {di.logged_on_users && di.logged_on_users.length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1.5">Sessioni attive ({di.logged_on_users.length})</p>
                  <div className="flex flex-wrap gap-2">
                    {di.logged_on_users.map((u, i) => (
                      <div key={i} className="border rounded-md px-2 py-1 text-xs flex items-center gap-1.5 bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800">
                        <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-500" />
                        <span className="font-mono font-medium">{u.username}</span>
                        {u.session_type && <Badge variant="secondary" className="text-[10px] py-0">{u.session_type}</Badge>}
                        {u.logon_time && <span className="text-muted-foreground">{new Date(u.logon_time).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" })}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Profili utente */}
              {di.user_profiles && di.user_profiles.length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1.5">Profili sul sistema ({di.user_profiles.length})</p>
                  <div className="space-y-1.5">
                    {di.user_profiles.map((p, i) => (
                      <div key={i} className={`border rounded-md p-2 text-xs ${p.loaded ? "border-green-200 dark:border-green-800" : ""}`}>
                        <div className="flex items-start justify-between gap-2 flex-wrap">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {p.loaded && <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-500 shrink-0" />}
                            <span className="font-mono font-semibold">{p.ad_display_name || p.username}</span>
                            {p.ad_display_name && p.username && p.ad_display_name !== p.username && (
                              <span className="font-mono text-muted-foreground">({p.username})</span>
                            )}
                            {p.ad_enabled === false && <Badge variant="destructive" className="text-[10px] py-0">Disabilitato</Badge>}
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {p.ad_department && <Badge variant="outline" className="text-[10px] py-0">{p.ad_department}</Badge>}
                            {p.ad_title && <Badge variant="outline" className="text-[10px] py-0">{p.ad_title}</Badge>}
                            {p.last_use && <span className="text-muted-foreground text-[10px]">Ultimo uso: {new Date(p.last_use).toLocaleDateString("it-IT")}</span>}
                          </div>
                        </div>
                        {p.ad_email && <div className="text-muted-foreground mt-0.5">{p.ad_email}</div>}
                        {p.ad_last_logon && <div className="text-muted-foreground text-[10px]">Ultimo login AD: {new Date(p.ad_last_logon).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" })}</div>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            )}

            {/* === SOFTWARE / PACCHETTI === */}
            {((di.key_software && di.key_software.length > 0) || (di.installed_software_count != null && di.installed_software_count > 0) || (di.packages_count != null && di.packages_count > 0)) && (
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5 mb-2"><Package className="h-3.5 w-3.5" /> {isLinux ? "Pacchetti" : "Software"} {di.installed_software_count ? `(${di.installed_software_count} installati)` : di.packages_count ? `(${di.packages_count} pacchetti)` : ""}</h4>
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

            {/* Fallback per device SNMP/generico: mostra campi base */}
            {!hasDetailedInfo && (
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
      {proxmoxScanData && (proxmoxScanData.hosts?.length || proxmoxScanData.vms?.length) && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Server className="h-5 w-5" />
              Dati Proxmox
            </CardTitle>
            <CardDescription>
              Scan del {proxmoxScanData.scanned_at ? new Date(proxmoxScanData.scanned_at).toLocaleString("it-IT") : "—"}
              {proxmoxScanData._truncated && (
                <span className="ml-2 text-amber-600">
                  (mostrate {proxmoxScanData.vms?.length ?? 0} di {proxmoxScanData._total_vm_rows} VM)
                </span>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="hosts">
              <TabsList>
                <TabsTrigger value="hosts">Host ({proxmoxScanData.hosts?.length ?? 0})</TabsTrigger>
                <TabsTrigger value="vms">VM e CT ({proxmoxScanData._total_vm_rows ?? proxmoxScanData.vms?.length ?? 0})</TabsTrigger>
                <TabsTrigger value="details">Hardware e licenza</TabsTrigger>
              </TabsList>
              <TabsContent value="hosts" className="mt-4">
                {(proxmoxScanData.hosts?.length ?? 0) > 0 ? (
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
                      {proxmoxScanData.hosts!.map((h, i) => (
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
                {(proxmoxScanData.hosts?.length ?? 0) > 0 ? (
                  <div className="space-y-6">
                    {proxmoxScanData.hosts!.map((h, i) => (
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
                {(proxmoxScanData.vms?.length ?? 0) > 0 ? (
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
                      {proxmoxScanData.vms!.slice(0, PROXMOX_VM_RENDER_CAP).map((vm) => (
                        <TableRow key={`${vm.node}-${vm.vmid}-${vm.type}`}>
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
      )}

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
        <DialogContent className={DIALOG_PANEL_COMPACT_CLASS}>
          <DialogHeader className="shrink-0 space-y-1 border-b border-border/50 px-4 pt-4 pb-3">
            <DialogTitle>Modifica {getClassificationLabel(device.classification ?? "") || device.device_type}</DialogTitle>
            <CardDescription className="text-xs leading-snug">
              Identificazione, profilo marca, protocollo e credenziali. Il vendor seleziona i comandi di acquisizione.
            </CardDescription>
          </DialogHeader>
          <DialogScrollableArea className="px-4 py-3">
          <form onSubmit={handleEdit} className="space-y-4">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Identificazione</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Nome</Label>
                  <Input name="name" required defaultValue={device.name} placeholder="Router Core" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">IP</Label>
                  <Input
                    name="host"
                    required
                    defaultValue={device.host}
                    placeholder={
                      (device.device_type === "hypervisor" || (device as { scan_target?: string }).scan_target === "proxmox")
                        ? "192.168.40.1 oppure 192.168.40.1,2,3,4,5"
                        : "192.168.1.1"
                    }
                  />
                </div>
                {((device.device_type === "hypervisor") || (device as { scan_target?: string }).scan_target === "proxmox") && (
                  <p className="text-xs text-muted-foreground col-span-2 -mt-1">
                    Scan Proxmox: su ogni IP si usano API (8006) e SSH (porta dispositivo); più nodi stesso /24 con virgole dopo il primo IP.
                  </p>
                )}
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
            <DeviceFormFields
              mode="edit"
              credentials={credentials}
              idPrefix="device-detail-edit"
              showIdentificazione={false}
              showProfilo={true}
              showCredenziali={false}
              classification={editClassification}
              vendor={editVendor}
              vendorSubtype={editVendorSubtype}
              protocol={editProtocol}
              scanTarget={editScanTarget}
              productProfile={editProductProfile}
              onClassificationChange={setEditClassification}
              onVendorChange={(v) => {
                setEditVendor(v ?? "");
                if (v !== "hp") setEditVendorSubtype(null);
              }}
              onVendorSubtypeChange={setEditVendorSubtype}
              onProtocolChange={setEditProtocol}
              onScanTargetChange={setEditScanTarget}
              onProductProfileChange={(v) => {
                setEditProductProfile(v);
                setEditVendorSubtype(vendorSubtypeFromProductProfile(v as ProductProfileId));
              }}
            />
            <DeviceCredentialsTable deviceId={device.id} />
            <Button type="submit" className="w-full" disabled={editSaving}>
              {editSaving ? "Salvataggio..." : "Salva modifiche"}
            </Button>
          </form>
          </DialogScrollableArea>
        </DialogContent>
      </Dialog>

      <DeviceCredentialsTable deviceId={device.id} />

      <Tabs defaultValue={isMikrotik ? "mikrotik" : device.device_type === "router" && totalPorts === 0 ? "arp" : "ports"}>
        <TabsList>
          {isMikrotik && <TabsTrigger value="mikrotik">MikroTik</TabsTrigger>}
          {device.device_type === "router" && <TabsTrigger value="arp">Tabella ARP</TabsTrigger>}
          {totalPorts > 0 && <TabsTrigger value="ports">Schema Porte ({totalPorts})</TabsTrigger>}
          {device.device_type === "switch" && <TabsTrigger value="mac">MAC Table ({device.mac_port_entries?.length ?? 0})</TabsTrigger>}
          {(device.neighbors?.length ?? 0) > 0 && <TabsTrigger value="neighbors">Neighbors ({device.neighbors!.length})</TabsTrigger>}
          {(device.routes?.length ?? 0) > 0 && <TabsTrigger value="routing">Routing ({device.routes!.length})</TabsTrigger>}
          {(device.dhcp_leases?.length ?? 0) > 0 && <TabsTrigger value="dhcp">DHCP ({device.dhcp_leases!.length})</TabsTrigger>}
        </TabsList>

        {/* Tab MikroTik */}
        {isMikrotik && (
          <TabsContent value="mikrotik" className="mt-4 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold">Dati MikroTik</h3>
                <p className="text-sm text-muted-foreground">Configurazione, DHCP leases e pool</p>
              </div>
              <Button onClick={fetchMikrotikData} disabled={mikrotikLoading}>
                <RefreshCw className={`h-4 w-4 mr-2 ${mikrotikLoading ? "animate-spin" : ""}`} />
                {mikrotikLoading ? "Caricamento..." : "Carica dati"}
              </Button>
            </div>

            {!mikrotikData && !mikrotikLoading && (
              <Card>
                <CardContent className="py-8 text-center text-muted-foreground">
                  Clicca &quot;Carica dati&quot; per ottenere configurazione e DHCP dal MikroTik
                </CardContent>
              </Card>
            )}

            {mikrotikData && (
              <>
                {/* System Info */}
                {mikrotikData.config?.systemInfo && (
                  <Card>
                    <CardHeader className="py-3">
                      <CardTitle className="text-base flex items-center gap-2">
                        <Server className="h-4 w-4" />
                        Informazioni Sistema
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
                        {mikrotikData.config.systemInfo.identity && (
                          <div>
                            <p className="text-xs text-muted-foreground uppercase">Identity</p>
                            <p className="font-medium">{mikrotikData.config.systemInfo.identity}</p>
                          </div>
                        )}
                        {mikrotikData.config.systemInfo.boardName && (
                          <div>
                            <p className="text-xs text-muted-foreground uppercase">Modello</p>
                            <p className="font-medium">{mikrotikData.config.systemInfo.boardName}</p>
                          </div>
                        )}
                        {mikrotikData.config.systemInfo.version && (
                          <div>
                            <p className="text-xs text-muted-foreground uppercase">RouterOS</p>
                            <p className="font-medium">{mikrotikData.config.systemInfo.version}</p>
                          </div>
                        )}
                        {mikrotikData.config.systemInfo.serialNumber && (
                          <div>
                            <p className="text-xs text-muted-foreground uppercase">Seriale</p>
                            <p className="font-mono text-sm">{mikrotikData.config.systemInfo.serialNumber}</p>
                          </div>
                        )}
                        {mikrotikData.config.systemInfo.uptime && (
                          <div>
                            <p className="text-xs text-muted-foreground uppercase">Uptime</p>
                            <p className="font-medium">{mikrotikData.config.systemInfo.uptime}</p>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Config */}
                <Card>
                  <CardHeader className="py-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base">Configurazione</CardTitle>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={() => setShowMikrotikConfig(!showMikrotikConfig)}>
                          {showMikrotikConfig ? "Nascondi" : "Mostra"}
                        </Button>
                        <Button variant="outline" size="sm" onClick={downloadConfig} disabled={!mikrotikData.config?.exportFull}>
                          <Download className="h-4 w-4 mr-1" />
                          Scarica .rsc
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  {showMikrotikConfig && mikrotikData.config?.exportFull && (
                    <CardContent className="p-0">
                      <pre className="text-xs font-mono bg-muted p-4 overflow-auto max-h-[400px] whitespace-pre-wrap">
                        {mikrotikData.config.exportFull}
                      </pre>
                    </CardContent>
                  )}
                </Card>

                {/* DHCP Servers */}
                {mikrotikData.servers.length > 0 && (
                  <Card>
                    <CardHeader className="py-3">
                      <CardTitle className="text-base">Server DHCP ({mikrotikData.servers.length})</CardTitle>
                    </CardHeader>
                    <CardContent className="p-0">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Nome</TableHead>
                            <TableHead>Interfaccia</TableHead>
                            <TableHead>Pool</TableHead>
                            <TableHead>Stato</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {mikrotikData.servers.map((server, i) => (
                            <TableRow key={i}>
                              <TableCell className="font-medium">{server.name}</TableCell>
                              <TableCell className="font-mono text-sm">{server.interface}</TableCell>
                              <TableCell className="font-mono text-sm">{server.addressPool}</TableCell>
                              <TableCell>
                                <Badge variant={server.disabled ? "secondary" : "default"}>
                                  {server.disabled ? "Disabilitato" : "Attivo"}
                                </Badge>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>
                )}

                {/* DHCP Pools */}
                {mikrotikData.pools.length > 0 && (
                  <Card>
                    <CardHeader className="py-3">
                      <CardTitle className="text-base">Pool IP ({mikrotikData.pools.length})</CardTitle>
                    </CardHeader>
                    <CardContent className="p-0">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Nome</TableHead>
                            <TableHead>Range</TableHead>
                            <TableHead>Next Pool</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {mikrotikData.pools.map((pool, i) => (
                            <TableRow key={i}>
                              <TableCell className="font-medium">{pool.name}</TableCell>
                              <TableCell className="font-mono text-sm">{pool.ranges}</TableCell>
                              <TableCell className="font-mono text-sm text-muted-foreground">{pool.nextPool || "—"}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>
                )}

                {/* DHCP Leases */}
                <Card>
                  <CardHeader className="py-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="text-base">DHCP Leases ({mikrotikData.leases.length})</CardTitle>
                        <CardDescription>Client con lease DHCP attivi o recenti</CardDescription>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleImportDhcpLeases()}
                        disabled={mikrotikImporting || mikrotikData.leases.length === 0}
                      >
                        <Database className="h-4 w-4 mr-1" />
                        {mikrotikImporting ? "Importazione..." : "Importa in IPAM"}
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="p-0">
                    {mikrotikData.leases.length === 0 ? (
                      <div className="py-8 text-center text-muted-foreground">Nessun lease DHCP trovato</div>
                    ) : (
                      <div className="overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>IP</TableHead>
                              <TableHead>MAC</TableHead>
                              <TableHead>Hostname</TableHead>
                              <TableHead>Server</TableHead>
                              <TableHead>Stato</TableHead>
                              <TableHead>Scade tra</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {mikrotikData.leases.map((lease, i) => (
                              <TableRow key={i}>
                                <TableCell className="font-mono">{lease.ip}</TableCell>
                                <TableCell className="font-mono text-xs">{lease.mac}</TableCell>
                                <TableCell>{lease.hostname || <span className="text-muted-foreground">—</span>}</TableCell>
                                <TableCell className="text-sm">{lease.server || "—"}</TableCell>
                                <TableCell>
                                  <Badge variant={lease.status === "bound" ? "default" : "secondary"} className="text-xs">
                                    {lease.status || "unknown"}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-xs text-muted-foreground">{lease.expiresAfter || "—"}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </>
            )}
          </TabsContent>
        )}

        {device.device_type === "router" && (
          <TabsContent value="arp" className="mt-4">
            <Card>
              <CardHeader className="py-3">
                <CardTitle className="text-base">
                  ARP Entries ({device.arp_entries?.length ?? 0})
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
                    {(device.arp_entries?.length ?? 0) === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5}>
                          <EmptyState
                            icon={Database}
                            title="Nessuna entry ARP"
                            description="Clicca 'Aggiorna Dati' per acquisire la tabella ARP dal router."
                          />
                        </TableCell>
                      </TableRow>
                    ) : (device.arp_entries ?? []).map((entry) => (
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

        {/* Tab Neighbors LLDP/CDP/MNDP */}
        {(device.neighbors?.length ?? 0) > 0 && (
          <TabsContent value="neighbors" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Radio className="h-4 w-4" />
                  Neighbors LLDP/CDP/MNDP
                </CardTitle>
                <CardDescription>Dispositivi adiacenti rilevati via protocolli di discovery</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Porta Locale</TableHead>
                      <TableHead>Dispositivo Remoto</TableHead>
                      <TableHead>Porta Remota</TableHead>
                      <TableHead>Protocollo</TableHead>
                      <TableHead>IP Remoto</TableHead>
                      <TableHead>Piattaforma</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {device.neighbors!.map((n) => (
                      <TableRow key={n.id}>
                        <TableCell className="font-mono text-sm">{n.local_port}</TableCell>
                        <TableCell className="font-medium">{n.remote_device_name || "—"}</TableCell>
                        <TableCell className="font-mono text-sm">{n.remote_port || "—"}</TableCell>
                        <TableCell>
                          <Badge variant={n.protocol === "lldp" ? "default" : n.protocol === "cdp" ? "secondary" : "outline"}>
                            {n.protocol.toUpperCase()}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{n.remote_ip || "—"}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{n.remote_platform || "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {/* Tab Routing Table */}
        {(device.routes?.length ?? 0) > 0 && (
          <TabsContent value="routing" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Activity className="h-4 w-4" />
                  Tabella di Routing
                </CardTitle>
                <CardDescription>Route attive e statiche raccolte dal dispositivo</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Destinazione</TableHead>
                      <TableHead>Gateway</TableHead>
                      <TableHead>Interfaccia</TableHead>
                      <TableHead>Protocollo</TableHead>
                      <TableHead>Distanza</TableHead>
                      <TableHead>Metrica</TableHead>
                      <TableHead>Stato</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {device.routes!.map((r) => (
                      <TableRow key={r.id} className={r.active ? "" : "opacity-50"}>
                        <TableCell className="font-mono text-sm font-medium">{r.destination}</TableCell>
                        <TableCell className="font-mono text-sm">{r.gateway || "—"}</TableCell>
                        <TableCell className="font-mono text-xs">{r.interface_name || "—"}</TableCell>
                        <TableCell>
                          <Badge variant={
                            r.protocol === "connected" ? "default" :
                            r.protocol === "static" ? "secondary" :
                            "outline"
                          }>
                            {r.protocol}
                          </Badge>
                        </TableCell>
                        <TableCell>{r.distance ?? "—"}</TableCell>
                        <TableCell>{r.metric ?? "—"}</TableCell>
                        <TableCell>
                          <Badge variant={r.active ? "default" : "destructive"}>
                            {r.active ? "attiva" : "inattiva"}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {/* Tab DHCP Leases */}
        {(device.dhcp_leases?.length ?? 0) > 0 && (
          <TabsContent value="dhcp" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  DHCP Leases
                </CardTitle>
                <CardDescription>Lease DHCP raccolti dal dispositivo</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>IP</TableHead>
                      <TableHead>MAC</TableHead>
                      <TableHead>Hostname</TableHead>
                      <TableHead>Stato</TableHead>
                      <TableHead>Server</TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead>Scadenza</TableHead>
                      <TableHead>Aggiornato</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {device.dhcp_leases!.map((l) => (
                      <TableRow key={l.id}>
                        <TableCell className="font-mono text-sm">{l.ip_address}</TableCell>
                        <TableCell className="font-mono text-xs">{l.mac_address}</TableCell>
                        <TableCell className="text-sm">{l.hostname || "—"}</TableCell>
                        <TableCell>
                          {l.status && (
                            <Badge variant={l.status === "bound" ? "default" : "secondary"} className="text-xs">
                              {l.status}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-xs">{l.server_name || "—"}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">
                            {l.dynamic_lease === 1 ? "Dinamico" : l.dynamic_lease === 0 ? "Statico" : "—"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{l.lease_expires || "—"}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {new Date(l.last_synced).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" })}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
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
