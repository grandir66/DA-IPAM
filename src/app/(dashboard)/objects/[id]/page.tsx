"use client";

/**
 * Pagina unificata "Oggetto di rete" — `/objects/[hostId]`.
 *
 * Sostituisce le vecchie pagine separate /hosts/[id] e /devices/[id] che
 * mostravano viste parziali dello stesso oggetto fisico (stesso IP/MAC).
 * Qui tutte le info sono in un'unica vista con sezioni condizionate dallo
 * stato di evoluzione (rilevato → gestito come device → asset NIS2).
 *
 * Ordine sezioni (deciso 2026-05-22): priorità sicurezza.
 *   Identità · Rete · Vulnerabilità · Software · Asset NIS2 · Credenziali · Discovery · Cronologia
 */

import { useEffect, useState, useCallback, useMemo } from "react";
import dynamic from "next/dynamic";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatusBadge } from "@/components/shared/status-badge";
// v0.2.646 audit perf UI9: i dialog modali (Promote/LinkIps/EditDevice) e i
// componenti grafici pesanti (LatencyChart/UptimeTimeline/LibreNMSGraphs) sono
// caricati on-demand. Prima erano nel bundle iniziale anche se l'utente non li
// apriva mai → ~100-300KB JS evitati al mount.
const PromoteHostDialog = dynamic(() => import("@/components/devices/promote-host-dialog").then((m) => ({ default: m.PromoteHostDialog })), { ssr: false });
const LinkIpsDialog = dynamic(() => import("@/components/devices/link-ips-dialog").then((m) => ({ default: m.LinkIpsDialog })), { ssr: false });
const EditDeviceDialog = dynamic(() => import("@/components/devices/edit-device-dialog").then((m) => ({ default: m.EditDeviceDialog })), { ssr: false });
import { HostVulnerabilitiesCard } from "@/components/hosts/host-vulnerabilities-card";
import { DeviceSoftwareCard } from "@/components/hosts/host-software-card";
const UptimeTimeline = dynamic(() => import("@/components/shared/uptime-timeline").then((m) => ({ default: m.UptimeTimeline })), { ssr: false });
const LatencyChart = dynamic(() => import("@/app/(dashboard)/hosts/[id]/latency-chart").then((m) => ({ default: m.LatencyChart })), { ssr: false });
const LibreNMSDeviceGraphs = dynamic(() => import("@/components/integrations/librenms-device-graphs").then((m) => ({ default: m.LibreNMSDeviceGraphs })), { ssr: false });
import {
  ArrowLeft,
  RefreshCw,
  PackagePlus,
  Boxes,
  Wrench,
  Pencil,
  Shield,
  Network,
  Cpu,
  ScanSearch,
  HardDrive,
  Activity,
  KeyRound,
  Users,
  ServerCog,
  Disc,
  Cable,
  Route,
  Radio,
  Link2,
  Unlink,
  Table as TableIcon,
  Server,
  Layers,
} from "lucide-react";
import { toast } from "sonner";
import type { HostDetail, HostSnmpData, InventoryAsset, NetworkDevice, ArpEntry, MacPortEntry, SwitchPort } from "@/types";

/** Dati addizionali ritornati da GET /api/devices/[id] oltre al NetworkDevice base. */
interface DeviceExtras {
  /** L'API ritorna già parsato (campo proxmox_data); last_proxmox_scan_result viene nullificato. */
  proxmox_data?: ProxmoxScanViewModel | null;
  /** L'API ritorna già parsato (campo device_info); last_device_info_json viene rimosso. */
  device_info?: DeviceInfoJson | null;
  /** stp_info è già oggetto, non stringa. */
  stp_info?: StpInfo | null;
  arp_entries?: Array<ArpEntry & { hostname?: string | null; host_ip?: string | null; host_name?: string | null }>;
  mac_port_entries?: Array<MacPortEntry & { host_ip?: string | null; host_name?: string | null }>;
  switch_ports?: SwitchPort[];
  neighbors?: Array<{
    id?: number;
    interface_name?: string | null;
    neighbor_name?: string | null;
    neighbor_port?: string | null;
    neighbor_platform?: string | null;
    neighbor_address?: string | null;
    protocol?: string | null;
  }>;
  routes?: Array<{
    id?: number;
    destination?: string;
    gateway?: string | null;
    interface_name?: string | null;
    distance?: number | null;
    protocol?: string | null;
  }>;
  dhcp_leases?: Array<{
    id?: number;
    ip: string;
    mac: string;
    hostname?: string | null;
    status?: string | null;
    server?: string | null;
    expires_at?: string | null;
    lease_type?: string | null;
    updated_at?: string | null;
  }>;
}

type DeviceFull = NetworkDevice & DeviceExtras;
import { getClassificationLabel, DEVICE_CLASSIFICATIONS_ORDERED, sortClassificationsByDisplayLabel } from "@/lib/device-classifications";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// ─── Helpers ────────────────────────────────────────────────────────

/**
 * Parser sicuro per stringhe datetime SQLite/ISO.
 * SQLite `datetime('now')` ritorna "YYYY-MM-DD HH:MM:SS" senza timezone marker:
 * il browser lo interpreterebbe come LOCAL invece di UTC → orari shiftati.
 * Forziamo UTC se manca un marker esplicito.
 */
function parseUtcDate(s: string): Date {
  if (/Z$|[+-]\d{2}:?\d{2}$/.test(s)) return new Date(s);
  return new Date(s.replace(" ", "T") + "Z");
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return parseUtcDate(iso).toLocaleString("it-IT", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function parsePorts(jsonStr: string | null | undefined): string[] {
  if (!jsonStr) return [];
  try {
    const arr = JSON.parse(jsonStr);
    if (Array.isArray(arr)) return arr.map(String);
  } catch { /* ignore */ }
  return [];
}

/**
 * Subset esteso dei dati di `network_devices.last_device_info_json`.
 * Campi rilevati da audit Windows + Linux server (chiavi del DB reale).
 */
interface DeviceInfoJson {
  // OS / Identità
  hostname?: string;
  domain?: string;
  domain_role?: string;
  is_domain_controller?: boolean;
  is_server?: boolean;
  is_virtual?: boolean;
  virtualization?: string;
  os_name?: string;
  os_version?: string;
  os_build?: string;
  os_serial?: string;
  kernel_version?: string;
  architecture?: string;
  uptime_days?: number;
  uptime?: string;
  last_boot?: string;
  install_date?: string;
  registered_user?: string;
  organization?: string;
  load_average?: string;
  // Hardware
  manufacturer?: string;
  model?: string;
  system_type?: string;
  serial_number?: string;
  bios_manufacturer?: string;
  bios_version?: string;
  cpu_model?: string;
  cpu_manufacturer?: string;
  cpu_cores?: number;
  cpu_threads?: number;
  cpu_speed_mhz?: number;
  processor_count?: number;
  ram_total_gb?: number;
  ram_total_mb?: number;
  ram_free_mb?: number;
  gpu?: Array<{ name?: string; vram_mb?: number; driver?: string }> | string;
  memory_modules?: Array<{ size_gb?: number; speed_mhz?: number; manufacturer?: string; locator?: string }>;
  // Storage
  disks?: Array<{ device?: string; size_gb?: number; free_gb?: number; filesystem?: string; label?: string; mountpoint?: string }>;
  physical_disks?: Array<{ device?: string; model?: string; size_gb?: number; serial?: string; interface_type?: string; vendor?: string; rotational?: boolean }>;
  disk_total_gb?: number;
  disk_free_gb?: number;
  // Network adapters
  network_adapters?: Array<{ name?: string; ips?: string[] | string; mac?: string; mac_address?: string; dhcp?: boolean; speed_mbps?: number; status?: string }>;
  // Sicurezza Windows
  license_name?: string;
  license_status?: string;
  license_partial_key?: string;
  antivirus?: Array<{ name?: string; status?: string } | string>;
  firewall_active?: boolean;
  firewall_type?: string;
  firewall_rules_count?: number;
  // Aggiornamenti
  installed_hotfixes?: Array<{ id?: string; installed_on?: string }>;
  pending_updates_count?: number;
  // Servizi & ruoli
  server_roles?: string[];
  important_services?: Array<{ name?: string; display_name?: string; state?: string; start_mode?: string }>;
  // Linux processi
  listening_ports?: Array<{ protocol?: string; port?: number; process?: string }>;
  cron_jobs?: Array<{ user?: string; schedule?: string; command?: string }>;
  // Utenti
  local_users?: Array<{ name?: string; full_name?: string; disabled?: boolean }>;
  logged_on_users?: Array<{ username?: string; session_type?: string; logon_time?: string }>;
  // Software
  installed_software_count?: number;
  packages_count?: number;
  // F5.D: snapshot NAS Synology/QNAP (popolato da scan SNMP/SSH)
  nas_inventory?: {
    vendor: "synology" | "qnap";
    sources?: string[];
    snmp?: {
      temperature_c?: number | null;
      cpu_temperature_c?: number | null;
      system_status?: string | null;
      disks?: Array<{ slot?: string; model?: string; status?: string; smart_health?: string; capacity_gb?: number | null; temperature_c?: number | null; serial?: string }>;
      raids?: Array<{ name?: string; status?: string; free_gb?: number | null; total_gb?: number | null }>;
      volumes_snmp?: Array<{ name?: string; size_gb?: number | null; free_gb?: number | null; status?: string | null; raid_type?: string | null }>;
      storage_pools?: Array<{ name?: string; status?: string | null; total_gb?: number | null; used_gb?: number | null }>;
      ups?: { status?: string | null; battery_pct?: string | null };
      services?: Array<{ name?: string; state?: string | null }>;
    };
    ssh?: {
      cpu_model?: string | null;
      kernel?: string | null;
      mdstat_summary?: string;
      synology_shares_preview?: string;
      synology_packages_count?: number | null;
      qnap_qpkg_preview?: string;
    };
  };
  // Metadata
  scanned_at?: string;
}

function parseDeviceInfo(json: string | null | undefined): DeviceInfoJson | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    if (parsed && typeof parsed === "object") return parsed as DeviceInfoJson;
  } catch { /* ignore */ }
  return null;
}

/** STP info salvata in `network_devices.stp_info` come JSON. */
interface StpInfo {
  bridge_id?: string | null;
  root_bridge_id?: string | null;
  priority?: number | null;
  root_cost?: number | null;
  root_port?: string | null;
  hello_time_s?: number | null;
  forward_delay_s?: number | null;
  max_age_s?: number | null;
  is_root_bridge?: boolean;
  protocol?: "stp" | "rstp" | null;
}

function parseStpInfo(json: string | null | undefined): StpInfo | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    if (parsed && typeof parsed === "object") return parsed as StpInfo;
  } catch { /* ignore */ }
  return null;
}

/** Payload da `network_devices.last_proxmox_scan_result`. */
interface ProxmoxScanViewModel {
  hosts?: Array<{
    hostname: string;
    status: string;
    cpu_model?: string | null;
    cpu_total_cores?: number | null;
    cpu_sockets?: number | null;
    cpu_cores?: number | null;
    cpu_mhz?: number | null;
    memory_total_gb?: number | null;
    memory_used_gb?: number | null;
    memory_free_gb?: number | null;
    memory_usage_percent?: number | null;
    proxmox_version?: string | null;
    kernel_version?: string | null;
    uptime_human?: string | null;
    uptime_seconds?: number | null;
    rootfs_total_gb?: number | null;
    rootfs_used_gb?: number | null;
    hardware_serial?: string | null;
    hardware_model?: string | null;
    hardware_manufacturer?: string | null;
    subscription?: {
      status?: string;
      productname?: string;
      level?: string;
      key?: string;
      regdate?: string;
      nextduedate?: string;
      sockets?: number;
      serverid?: string;
    } | null;
    storage?: Array<{
      name: string;
      type?: string;
      status?: string;
      total_gb?: number;
      used_gb?: number;
      available_gb?: number;
      content?: string;
    }>;
    network_interfaces?: Array<{
      name: string;
      type?: string;
      state?: string;
      mac_address?: string | null;
      ip_addresses?: string | null;
      bridge?: string | null;
      speed_mbps?: number | null;
    }>;
  }>;
  vms?: Array<{
    node: string;
    vmid: number;
    name: string;
    type: string;
    status?: string;
    maxcpu: number;
    cores?: number;
    sockets?: number;
    memory_mb: number;
    maxmem?: number;
    disk_gb: number;
    maxdisk?: number;
    ip_addresses: string[];
    disks_details?: Array<{ id?: string; storage?: string; size?: string }>;
    networks_details?: Array<{ id?: string; model?: string; mac?: string; bridge?: string; vlan?: string }>;
    bios?: string;
    agent?: number;
  }>;
  scanned_at?: string;
  _truncated?: boolean;
  _total_vm_rows?: number;
}

function parseProxmoxScan(json: string | null | undefined): ProxmoxScanViewModel | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    if (parsed && typeof parsed === "object") return parsed as ProxmoxScanViewModel;
  } catch { /* ignore */ }
  return null;
}

function formatGb(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n >= 1024) return `${(n / 1024).toFixed(1)} TB`;
  return `${Math.round(n)} GB`;
}

interface InfoRowProps {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}

function InfoRow({ label, value, mono }: InfoRowProps) {
  const empty = value == null || value === "" || value === "—";
  return (
    <div className="min-w-0">
      <dt className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{label}</dt>
      <dd className={`text-sm mt-0.5 ${mono ? "font-mono" : ""} ${empty ? "text-muted-foreground/50" : ""}`}>
        {empty ? "—" : value}
      </dd>
    </div>
  );
}

interface SectionProps {
  icon: React.ReactNode;
  title: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
  /** id opzionale per ancore di scroll (es. dal badge header) */
  id?: string;
}

function Section({ icon, title, badge, children, id }: SectionProps) {
  return (
    <Card className="overflow-hidden" id={id}>
      <CardHeader className="bg-muted/30 border-b py-2.5 px-4">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <span className="text-primary">{icon}</span>
          <span>{title}</span>
          {badge}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4">{children}</CardContent>
    </Card>
  );
}

// ─── Page ───────────────────────────────────────────────────────────

export default function ObjectDetailPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const hostId = typeof params.id === "string" ? Number(params.id) : NaN;

  const [host, setHost] = useState<HostDetail | null>(null);
  const [device, setDevice] = useState<DeviceFull | null>(null);
  // F3.3: modale di promozione inline (no più redirect a /hosts/[id]?promote=1)
  const [promoteOpen, setPromoteOpen] = useState(false);
  // v0.2.599: modale edit device inline (no più redirect a /devices/[id], che era senza tab)
  const [editDeviceOpen, setEditDeviceOpen] = useState(false);
  // v0.2.600: test connessione (era solo su /devices/[id], ora /devices/[id] redirige qui)
  const [testingConnection, setTestingConnection] = useState(false);
  // v0.2.604: inventory_code + notes editabili inline nel tab Generale
  const [editableInventoryCode, setEditableInventoryCode] = useState("");
  const [editableNotes, setEditableNotes] = useState("");
  // v0.2.605: serial_number + classification editabili inline
  const [editableSerial, setEditableSerial] = useState("");
  const [editableClassification, setEditableClassification] = useState("");
  // v0.2.632: custom classifications per-tenant
  const [customClassifications, setCustomClassifications] = useState<Array<{ slug: string; label: string; parent_slug: string }>>([]);
  useEffect(() => {
    void fetch("/api/classifications/custom", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((data) => setCustomClassifications(data.items ?? []))
      .catch(() => { /* ignore */ });
  }, []);
  const customLabelMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of customClassifications) m.set(c.slug, c.label);
    return m;
  }, [customClassifications]);
  const effectiveClassificationLabel = useCallback((slug: string) => customLabelMap.get(slug) ?? getClassificationLabel(slug), [customLabelMap]);
  const effectiveClassificationSlugs = useMemo(
    () => [...DEVICE_CLASSIFICATIONS_ORDERED, ...customClassifications.map((c) => c.slug)],
    [customClassifications]
  );
  // Multi-IP link manuale (v0.2.594+)
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [clusterMembers, setClusterMembers] = useState<Array<{
    id: number;
    ip: string;
    hostname: string | null;
    vendor: string | null;
    status: "online" | "offline" | "unknown";
    network_name: string;
    inferred_os_family: string | null;
  }>>([]);
  const [unlinkingHostId, setUnlinkingHostId] = useState<number | null>(null);
  const [asset, setAsset] = useState<InventoryAsset | null>(null);
  const [librenms, setLibrenms] = useState<{
    configured: boolean;
    mapped?: boolean;
    librenmsDeviceId?: number;
    librenmsHostname?: string | null;
    lastSyncedAt?: string;
    device?: {
      status?: number | string;
      uptime_seconds?: number;
      os?: string;
      hardware?: string;
      sysname?: string;
      lastpolled?: string;
    } | null;
    librenmsUrl?: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchAll = useCallback(async () => {
    if (!Number.isFinite(hostId) || hostId <= 0) {
      router.push("/discovery");
      return;
    }
    // v0.2.635 audit B1: try/catch globale + toast per errori di rete; senza
    // questo, un fetch falliva silenzioso → loading=false ma host=null → render
    // pagina bianca senza messaggio. Ora l'utente vede l'errore di rete e può
    // tornare a /discovery oppure ricaricare.
    try {
      let hRes: Response;
      try {
        hRes = await fetch(`/api/hosts/${hostId}`);
      } catch (e) {
        toast.error(`Errore di rete nel caricamento host: ${e instanceof Error ? e.message : String(e)}`);
        return;
      }
      if (!hRes.ok) {
        toast.error(`Host ${hostId} non trovato`);
        router.push("/discovery");
        return;
      }
      const h = (await hRes.json()) as HostDetail;
      setHost(h);
      // v0.2.604/605: sincronizza i field editabili
      setEditableInventoryCode(h.inventory_code ?? "");
      setEditableNotes(h.notes ?? "");
      setEditableSerial(h.serial_number ?? "");
      setEditableClassification(h.classification && h.classification !== "unknown" ? h.classification : "");
      // v0.2.635 audit perf: i 3 fetch ausiliari (device + asset + librenms) sono
      // indipendenti tra loro e dall'host principale. Parallelizzo con allSettled
      // per ridurre la latency complessiva e tollerare fallimenti parziali.
      const auxResults = await Promise.allSettled([
        h.network_device?.id ? fetch(`/api/devices/${h.network_device.id}`) : Promise.resolve(null),
        fetch(`/api/inventory?host_id=${hostId}`),
        fetch(`/api/hosts/${hostId}/librenms`),
      ]);

      const [dRes, aRes, lnmsRes] = auxResults;

      if (dRes.status === "fulfilled" && dRes.value && dRes.value.ok) {
        try { setDevice((await dRes.value.json()) as DeviceFull); } catch { /* non critico */ }
      }
      if (aRes.status === "fulfilled" && aRes.value.ok) {
        try {
          const list = (await aRes.value.json()) as InventoryAsset[];
          if (Array.isArray(list) && list.length > 0) setAsset(list[0]);
        } catch { /* non critico */ }
      }
      if (lnmsRes.status === "fulfilled" && lnmsRes.value.ok) {
        try {
          const data = await lnmsRes.value.json();
          if (data) setLibrenms(data);
        } catch { /* non critico */ }
      }
    } catch (e) {
      // Catch difensivo per qualunque throw inaspettato lungo la catena.
      toast.error(`Errore caricamento dati host: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  }, [hostId, router]);

  useEffect(() => { void fetchAll(); }, [fetchAll]);

  // Carica gli host del cluster fisico (se esistono) — usato dalla sezione "IP collegati"
  const fetchClusterMembers = useCallback(async () => {
    if (!host?.physical_device_id) { setClusterMembers([]); return; }
    try {
      const r = await fetch(`/api/physical-devices/${host.physical_device_id}/hosts`, { cache: "no-store" });
      if (r.ok) {
        const data = await r.json() as { hosts: typeof clusterMembers };
        setClusterMembers(data.hosts ?? []);
      }
    } catch { /* non critico */ }
  }, [host?.physical_device_id]);

  useEffect(() => { void fetchClusterMembers(); }, [fetchClusterMembers]);

  // v0.2.607: runtime summary memoizzato. DEVE stare prima di qualsiasi early
  // return (loading / !host) per non violare le rules of hooks (React #310).
  const runtimeSummary = useMemo(() => {
    let tcpPorts: number[] = [];
    let udpPorts: number[] = [];
    try {
      if (host?.open_ports) {
        const parsed = JSON.parse(host.open_ports);
        if (Array.isArray(parsed)) {
          for (const p of parsed) {
            if (typeof p === "object" && p?.port) {
              if ((p.protocol ?? "tcp") === "tcp") tcpPorts.push(p.port);
              else if (p.protocol === "udp") udpPorts.push(p.port);
            } else if (typeof p === "number") tcpPorts.push(p);
          }
        } else if (typeof parsed === "object" && parsed !== null) {
          if (Array.isArray(parsed.tcp)) tcpPorts = parsed.tcp;
          if (Array.isArray(parsed.udp)) udpPorts = parsed.udp;
        }
      }
    } catch { /* ignore */ }
    const validatedCreds = (host?.host_credentials ?? []).filter((hc) => hc.validated === 1);
    return { tcpPorts, udpPorts, validatedCreds };
  }, [host?.open_ports, host?.host_credentials]);

  // v0.2.601: deep-link da menù tre-puntini / link esterni:
  //   ?edit=1     → auto-apri EditDeviceDialog (richiede device gestito)
  //   ?promote=1  → auto-apri PromoteHostDialog (richiede host non gestito)
  // Pulisce la query subito dopo per non rifarlo a ogni re-render.
  useEffect(() => {
    if (!host) return;
    const editFlag = searchParams?.get("edit");
    const promoteFlag = searchParams?.get("promote");
    if (editFlag === "1" && device && !editDeviceOpen) {
      setEditDeviceOpen(true);
      router.replace(`/objects/${host.id}`);
    } else if (promoteFlag === "1" && !device && !promoteOpen) {
      setPromoteOpen(true);
      router.replace(`/objects/${host.id}`);
    }
  }, [host?.id, device?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleUnlinkHost(targetHostId: number) {
    if (!confirm("Scollegare questo IP dal device fisico?")) return;
    setUnlinkingHostId(targetHostId);
    try {
      const r = await fetch("/api/physical-devices/unlink", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ host_id: targetHostId }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        toast.error(err.error || "Errore unlink");
        return;
      }
      toast.success("IP scollegato");
      void fetchAll();
      void fetchClusterMembers();
    } finally {
      setUnlinkingHostId(null);
    }
  }

  async function handleUpdateAll() {
    if (!host?.network_device?.id || !device) {
      toast.error("Promuovi prima l'host a device per eseguire 'Aggiorna tutto'");
      return;
    }
    setRefreshing(true);
    try {
      const qr = await fetch(`/api/devices/${device.id}/query`, { method: "POST" });
      const qd = (await qr.json()) as { id?: string; error?: string };
      if (!qr.ok) {
        toast.error(qd.error ?? "Errore avvio query");
        return;
      }
      if (qd.id) {
        // v0.2.636 audit B2: polling con max-attempts. Senza limite il setInterval
        // poteva girare per sempre se lo scan restava bloccato in 'running' —
        // il bottone "Refresh" restava in spinner indefinitamente.
        const POLL_INTERVAL_MS = 1500;
        const POLL_MAX_ATTEMPTS = 400; // ≈ 10 minuti
        await new Promise<void>((resolve) => {
          let attempts = 0;
          const poll = setInterval(async () => {
            attempts++;
            if (attempts >= POLL_MAX_ATTEMPTS) {
              clearInterval(poll);
              toast.error("Query timeout dopo 10 minuti");
              resolve();
              return;
            }
            try {
              const pr = await fetch(`/api/scans/progress/${qd.id}`);
              if (!pr.ok) return;
              const pd = (await pr.json()) as { status: string; phase?: string };
              if (pd.status === "completed" || pd.status === "failed") {
                clearInterval(poll);
                if (pd.status === "completed") toast.success(pd.phase ?? "Query OK");
                else toast.error(pd.phase ?? "Query fallita");
                resolve();
              }
            } catch { /* ignore: il prossimo tick riproverà fino al max */ }
          }, POLL_INTERVAL_MS);
        });
      }
      if (device.vendor === "windows" || device.vendor === "linux") {
        toast.info("Inventario software in corso...");
        const sr = await fetch(`/api/devices/${device.id}/software-scan`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        const sd = (await sr.json()) as { status?: string; appsCount?: number; errorMessage?: string };
        if (sr.ok && sd.status === "ok") {
          toast.success(`Software: ${sd.appsCount ?? 0} applicazioni`);
        } else {
          toast.error(sd.errorMessage ?? "Software scan fallito");
        }
      }
      await fetchAll();
    } finally {
      setRefreshing(false);
    }
  }

  // v0.2.604: salvataggio inline di inventory_code / notes dal tab Generale.
  async function saveHostField(patch: Record<string, unknown>) {
    if (!host) return;
    try {
      const res = await fetch(`/api/hosts/${host.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || "Errore salvataggio");
        return;
      }
      toast.success("Salvato", { duration: 1500 });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore di rete");
    }
  }

  async function handleTestConnection() {
    if (!device) return;
    setTestingConnection(true);
    try {
      const res = await fetch(`/api/devices/${device.id}/test`);
      const data = await res.json();
      if (data.success) {
        // /api/devices/[id]/test usa runDeviceConnectionTest che PROVA effettivamente
        // le credenziali (SSH/SNMP/WinRM/API). Esponiamo il risultato concreto.
        const msg = data.message
          || (data.proxmox_api_ok && data.proxmox_ssh_ok ? "Credenziali OK (API + SSH)"
            : data.proxmox_api_ok ? "Credenziali OK (solo API Proxmox)"
            : data.proxmox_ssh_ok ? "Credenziali OK (solo SSH)"
            : `Credenziali OK via ${device.protocol}`);
        toast.success(msg);
      } else {
        toast.error(data.error || `Credenziali rifiutate via ${device.protocol}`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore nel test credenziali");
    } finally {
      setTestingConnection(false);
    }
  }

  async function handleCreateAsset() {
    if (!host) return;
    try {
      const r = await fetch("/api/inventory/bulk-from-hosts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ host_ids: [host.id] }),
      });
      const data = (await r.json()) as { message?: string };
      if (r.ok) {
        toast.success(data.message ?? "Asset creato");
        await fetchAll();
      } else {
        toast.error("Errore creazione asset");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore");
    }
  }

  if (loading) {
    return (
      <div className="p-6 flex items-center gap-2 text-muted-foreground">
        <RefreshCw className="h-4 w-4 animate-spin" />
        Caricamento...
      </div>
    );
  }
  if (!host) return null;

  const displayName = host.custom_name || host.hostname || host.dns_reverse || host.ip;
  const classificationLabel = host.classification ? effectiveClassificationLabel(host.classification) : null;
  const isManaged = !!device;
  const isAsset = !!asset;
  const isWindowsOrLinux = device?.vendor === "windows" || device?.vendor === "linux";

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-4">
      {/* ─── Header sticky ─── */}
      <div className="sticky top-0 -mx-4 md:-mx-6 px-4 md:px-6 py-3 bg-background/95 backdrop-blur z-20 border-b">
        <div className="flex items-start gap-3">
          <Button variant="ghost" size="sm" onClick={() => router.back()} className="shrink-0 mt-0.5">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-2 flex-wrap">
              <h1 className="text-xl font-bold tracking-tight font-mono">{host.ip}</h1>
              <span className="text-base text-muted-foreground truncate">{displayName}</span>
              <StatusBadge status={host.status} />
              {/* v0.2.606: badge rapidi runtime cliccabili (scroll alla section) */}
              {runtimeSummary.validatedCreds.length > 0 && (
                <a href="#runtime-section" className="inline-flex">
                  <Badge variant="default" className="text-[10px] gap-1 cursor-pointer" title="Credenziali validate (clicca per dettagli)">
                    <KeyRound className="h-3 w-3" />
                    {runtimeSummary.validatedCreds.length}
                  </Badge>
                </a>
              )}
              {runtimeSummary.tcpPorts.length > 0 && (
                <a href="#runtime-section" className="inline-flex">
                  <Badge variant="outline" className="text-[10px] gap-1 cursor-pointer" title="Porte TCP aperte (clicca per dettagli)">
                    <Cable className="h-3 w-3" />
                    {runtimeSummary.tcpPorts.length} TCP
                  </Badge>
                </a>
              )}
            </div>
            <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
              <span className="inline-flex items-center gap-1.5">
                <Boxes className="h-3.5 w-3.5" aria-label="Rilevato in Discovery" />
                <span>Discovery</span>
              </span>
              <Wrench className={`h-3.5 w-3.5 ${isManaged ? "text-blue-600" : "text-muted-foreground/30"}`} />
              <span className={isManaged ? "" : "text-muted-foreground/40"}>
                {isManaged ? `Gestito · ${device?.name}` : "Non gestito"}
              </span>
              <PackagePlus className={`h-3.5 w-3.5 ${isAsset ? "text-emerald-600" : "text-muted-foreground/30"}`} />
              <span className={isAsset ? "" : "text-muted-foreground/40"}>
                {isAsset ? `Asset · ${asset?.asset_tag ?? asset?.id}` : "Nessun asset NIS2"}
              </span>
              {classificationLabel && (
                <>
                  <Separator orientation="vertical" className="h-3.5" />
                  <Badge variant="outline" className="text-[10px]">{classificationLabel}</Badge>
                </>
              )}
              {host.network_name && (
                <>
                  <Separator orientation="vertical" className="h-3.5" />
                  <span>{host.network_name} · {host.network_cidr}</span>
                </>
              )}
            </div>
          </div>
          <div className="flex gap-2 shrink-0">
            {isManaged && (
              <Button
                variant="outline"
                onClick={handleTestConnection}
                disabled={testingConnection || refreshing}
                title="Testa le credenziali registrate (SSH/SNMP/WinRM/API) effettuando autenticazione reale"
              >
                <KeyRound className={`h-4 w-4 mr-2 ${testingConnection ? "animate-pulse" : ""}`} />
                {testingConnection ? "Test..." : "Testa credenziali"}
              </Button>
            )}
            {isManaged && (
              <Button
                onClick={handleUpdateAll}
                disabled={refreshing || testingConnection}
                className="bg-primary hover:bg-primary/90"
                title="Test connessione → query SNMP/ARP → inventario software"
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? "animate-spin" : ""}`} />
                {refreshing ? "Aggiornamento..." : "Aggiorna tutto"}
              </Button>
            )}
            {!isAsset && host && (
              <Button variant="outline" onClick={handleCreateAsset}>
                <PackagePlus className="h-4 w-4 mr-2" />
                Crea asset NIS2
              </Button>
            )}
            {/* F3.3: bottone contestuale.
                - Host non gestito → "Promuovi a dispositivo" apre il <PromoteHostDialog> in-page
                  (modale inline, no più redirect a /hosts/[id]?promote=1).
                - Device gestito → "Modifica device" punta a /devices/[deviceId] dove esiste già
                  l'editor completo (credenziali/vendor/protocollo/scan_target). */}
            {isManaged && device ? (
              <Button variant="outline" onClick={() => setEditDeviceOpen(true)}>
                <Pencil className="h-4 w-4 mr-2" />
                Modifica device
              </Button>
            ) : (
              <Button variant="outline" onClick={() => setPromoteOpen(true)}>
                <PackagePlus className="h-4 w-4 mr-2" />
                Promuovi a dispositivo
              </Button>
            )}
          </div>
        </div>
      </div>

      <Tabs defaultValue="generale" className="space-y-4">
        <TabsList className="!h-10 p-1 gap-1 bg-muted border border-border flex-wrap">
          <TabsTrigger value="generale" className="px-3 py-1.5 text-sm">
            <Boxes className="h-4 w-4 mr-1.5" />
            Generale
          </TabsTrigger>
          <TabsTrigger value="sistema" className="px-3 py-1.5 text-sm">
            <ServerCog className="h-4 w-4 mr-1.5" />
            Sistema
          </TabsTrigger>
          <TabsTrigger value="network" className="px-3 py-1.5 text-sm">
            <Network className="h-4 w-4 mr-1.5" />
            Rete
          </TabsTrigger>
          <TabsTrigger value="vulnerabilita" className="px-3 py-1.5 text-sm">
            <Shield className="h-4 w-4 mr-1.5" />
            Vulnerabilità
          </TabsTrigger>
          <TabsTrigger value="software" className="px-3 py-1.5 text-sm">
            <HardDrive className="h-4 w-4 mr-1.5" />
            Software
          </TabsTrigger>
          <TabsTrigger value="asset" className="px-3 py-1.5 text-sm">
            <PackagePlus className="h-4 w-4 mr-1.5" />
            Asset & Credenziali
          </TabsTrigger>
          <TabsTrigger value="storico" className="px-3 py-1.5 text-sm">
            <Activity className="h-4 w-4 mr-1.5" />
            Storico
          </TabsTrigger>
        </TabsList>

        {/* ═══════════════ TAB: GENERALE ═══════════════ */}
        <TabsContent value="generale" className="space-y-4">

      {/* ─── v0.2.608: Stato runtime condensato — 3 righe invece di 8. */}
      <Section
        id="runtime-section"
        icon={<Activity className="h-4 w-4 text-emerald-600" />}
        title="Stato runtime"
        badge={
          <div className="flex items-center gap-1.5 ml-2 flex-wrap">
            {host.status === "online" && <Badge className="text-[10px] bg-emerald-100 text-emerald-800 hover:bg-emerald-100">Online</Badge>}
            {host.status === "offline" && <Badge variant="destructive" className="text-[10px]">Offline</Badge>}
            {host.last_response_time_ms != null && (
              <Badge variant="outline" className="text-[10px] font-mono">{host.last_response_time_ms} ms</Badge>
            )}
            <span className="text-[10px] text-muted-foreground ml-1">
              {host.last_seen ? `visto ${parseUtcDate(host.last_seen).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}` : ""}
              {host.first_seen ? ` · scoperto ${parseUtcDate(host.first_seen).toLocaleDateString("it-IT")}` : ""}
            </span>
          </div>
        }
      >
        <div className="space-y-2 text-xs">
          {/* Porte TCP/UDP in un'unica riga compatta */}
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-muted-foreground font-medium shrink-0 min-w-[80px]">TCP ({runtimeSummary.tcpPorts.length})</span>
            {runtimeSummary.tcpPorts.length === 0 ? (
              <span className="text-muted-foreground/60">—</span>
            ) : (
              <div className="flex flex-wrap gap-1">
                {runtimeSummary.tcpPorts.slice(0, 30).map((p) => (
                  <Badge key={`tcp-${p}`} variant="outline" className="text-[10px] font-mono px-1.5 py-0">{p}</Badge>
                ))}
                {runtimeSummary.tcpPorts.length > 30 && <span className="text-[10px] text-muted-foreground">+{runtimeSummary.tcpPorts.length - 30}</span>}
              </div>
            )}
          </div>
          {runtimeSummary.udpPorts.length > 0 && (
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="text-muted-foreground font-medium shrink-0 min-w-[80px]">UDP ({runtimeSummary.udpPorts.length})</span>
              <div className="flex flex-wrap gap-1">
                {runtimeSummary.udpPorts.slice(0, 20).map((p) => (
                  <Badge key={`udp-${p}`} variant="secondary" className="text-[10px] font-mono px-1.5 py-0">{p}</Badge>
                ))}
                {runtimeSummary.udpPorts.length > 20 && <span className="text-[10px] text-muted-foreground">+{runtimeSummary.udpPorts.length - 20}</span>}
              </div>
            </div>
          )}
          {/* Credenziali validate inline */}
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-muted-foreground font-medium shrink-0 min-w-[80px]">Cred. OK ({runtimeSummary.validatedCreds.length})</span>
            {runtimeSummary.validatedCreds.length === 0 ? (
              <span className="text-muted-foreground/60">—</span>
            ) : (
              <div className="flex flex-wrap gap-1">
                {runtimeSummary.validatedCreds.map((hc) => (
                  <Badge key={hc.id} variant="default" className="text-[10px] gap-0.5 px-1.5 py-0">
                    <KeyRound className="h-2.5 w-2.5" />
                    {hc.protocol_type}:{hc.port}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </div>
      </Section>

      {/* ─── 1. Identità ─── Tutti i campi anagrafici + inventory_code/note editabili */}
      <Section icon={<Cpu className="h-4 w-4" />} title="Identità">
        <dl className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <InfoRow label="Nome" value={host.custom_name ?? host.hostname ?? host.ip} />
          <InfoRow label="IP" value={host.ip} mono />
          <InfoRow label="MAC" value={host.mac} mono />
          <InfoRow label="Hostname" value={host.hostname} />
          <InfoRow label="DNS reverse" value={host.dns_reverse} />
          <InfoRow label="DNS forward" value={host.dns_forward} />
          <InfoRow label="Vendor (MAC OUI)" value={host.vendor} />
          <InfoRow label="Manufacturer" value={host.device_manufacturer} />
          <InfoRow label="Classificazione" value={classificationLabel} />
          <InfoRow label="Modello" value={device?.model ?? host.model} />
          <InfoRow label="Firmware/Versione" value={device?.firmware ?? host.firmware} />
          <InfoRow label="OS" value={device?.device_info?.os_name ?? host.os_info} />
          <InfoRow label="Kernel/Build" value={device?.device_info?.os_version ?? device?.device_info?.kernel_version ?? null} />
          <InfoRow label="Seriale" value={device?.serial_number ?? host.serial_number} mono />
          <InfoRow label="IP assignment" value={host.ip_assignment} />
          <InfoRow label="Uptime" value={device?.device_info?.uptime_days != null ? `${device.device_info.uptime_days} giorni` : (device?.device_info?.uptime ?? null)} />
        </dl>
        <Separator className="my-3" />
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-2">Campi editabili</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* v0.2.605: classificazione editabile inline */}
          <div className="space-y-1.5">
            <Label htmlFor="ed-classification" className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Classificazione</Label>
            <Select
              value={editableClassification || "unknown"}
              onValueChange={(v) => {
                const raw = v ?? "unknown";
                const next: string = raw === "unknown" ? "" : raw;
                setEditableClassification(next);
                void saveHostField({ classification: next || "unknown" });
              }}
            >
              <SelectTrigger id="ed-classification" className="text-sm">
                <SelectValue placeholder="Seleziona…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unknown">— Sconosciuta —</SelectItem>
                {[...effectiveClassificationSlugs].filter((c) => c !== "unknown").sort((a, b) => effectiveClassificationLabel(a).localeCompare(effectiveClassificationLabel(b), "it", { sensitivity: "base" })).map((c) => (
                  <SelectItem key={c} value={c}>{effectiveClassificationLabel(c)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {/* v0.2.605: seriale editabile (utile quando il device non lo espone via SNMP/WinRM) */}
          <div className="space-y-1.5">
            <Label htmlFor="ed-serial" className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Seriale</Label>
            <Input
              id="ed-serial"
              value={editableSerial}
              onChange={(e) => setEditableSerial(e.target.value)}
              onBlur={() => saveHostField({ serial_number: editableSerial || null })}
              placeholder="Inserisci manualmente se non rilevato"
              className="font-mono text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="inv-code" className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Numero inventario</Label>
            <Input
              id="inv-code"
              value={editableInventoryCode}
              onChange={(e) => setEditableInventoryCode(e.target.value)}
              onBlur={() => saveHostField({ inventory_code: editableInventoryCode || null })}
              placeholder="Es: INV-2026-001"
              className="font-mono text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="inv-notes" className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Note</Label>
            <Textarea
              id="inv-notes"
              value={editableNotes}
              onChange={(e) => setEditableNotes(e.target.value)}
              onBlur={() => saveHostField({ notes: editableNotes })}
              placeholder="Annotazioni libere su questo asset…"
              rows={2}
              className="text-sm"
            />
          </div>
        </div>
      </Section>

      {/* ─── 2. Hardware ─── CPU/RAM/dischi/NIC se device_info popolato */}
      {(() => {
        const di = device?.device_info ?? null;
        const hasHw = !!(di && (di.cpu_model || di.ram_total_gb || di.disks?.length || di.network_adapters?.length));
        if (!hasHw) return null;
        return (
          <Section icon={<Cpu className="h-4 w-4" />} title="Hardware">
            <dl className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <InfoRow label="CPU" value={di?.cpu_model ?? null} />
              <InfoRow label="Core / Thread" value={di?.cpu_cores != null ? `${di.cpu_cores}${di?.cpu_threads ? ` / ${di.cpu_threads}` : ""}` : null} />
              <InfoRow label="Freq. max" value={di?.cpu_speed_mhz ? `${di.cpu_speed_mhz} MHz` : null} />
              <InfoRow label="Processor count" value={di?.processor_count != null ? String(di.processor_count) : null} />
              <InfoRow label="RAM totale" value={di?.ram_total_gb != null ? `${di.ram_total_gb} GB` : (di?.ram_total_mb ? `${di.ram_total_mb} MB` : null)} />
              <InfoRow label="Disco totale" value={di?.disk_total_gb != null ? `${di.disk_total_gb} GB` : null} />
              <InfoRow label="Disco libero" value={di?.disk_free_gb != null ? `${di.disk_free_gb} GB` : null} />
              <InfoRow label="NIC count" value={di?.network_adapters?.length ? String(di.network_adapters.length) : null} />
            </dl>
            {di?.network_adapters && di.network_adapters.length > 0 && (
              <div className="mt-3 border-t border-border/50 pt-2">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5">Schede di rete</div>
                <div className="flex flex-wrap gap-2">
                  {di.network_adapters.slice(0, 8).map((a, i) => (
                    <Badge key={i} variant="outline" className="text-[10px] font-mono">
                      {(a.mac_address ?? a.mac ?? "?")} {a.name ? `· ${a.name}` : ""}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </Section>
        );
      })()}

      {/* ─── 2. Rete ─── */}
      <Section icon={<Network className="h-4 w-4" />} title="Rete">
        <dl className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <InfoRow label="Subnet" value={host.network_name ? `${host.network_name} (${host.network_cidr})` : null} />
          <InfoRow label="VLAN" value={host.switch_port?.vlan ? String(host.switch_port.vlan) : null} />
          <InfoRow
            label="Switch port"
            value={host.switch_port ? `${host.switch_port.device_name} · ${host.switch_port.port_name}` : null}
          />
          <InfoRow
            label="ARP source"
            value={host.arp_source ? `${host.arp_source.device_name} (${host.arp_source.device_vendor})` : null}
          />
        </dl>

        {/* Multihomed peers (host con stesso MAC su altre network) */}
        {(() => {
          const mh = (host as HostDetail & {
            multihomed?: { group_id: string; match_type: string; peers: Array<{ ip: string; network_name: string; host_id: number }> } | null;
          }).multihomed;
          if (!mh?.peers || mh.peers.length === 0) return null;
          return (
            <div className="mt-3 pt-3 border-t">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5">
                Multihomed ({mh.peers.length + 1} interfacce) · match {mh.match_type}
              </div>
              <div className="flex flex-wrap gap-2">
                {mh.peers.map((p) => (
                  <Link
                    key={p.host_id}
                    href={`/objects/${p.host_id}`}
                    className="inline-flex items-center gap-1.5 text-xs border rounded px-2 py-1 hover:bg-muted/50"
                  >
                    <span className="font-mono">{p.ip}</span>
                    <span className="text-muted-foreground">· {p.network_name}</span>
                  </Link>
                ))}
              </div>
            </div>
          );
        })()}
      </Section>

      {/* ─── LibreNMS (se configurato) ─── */}
      {librenms?.configured && (
        <Section icon={<Activity className="h-4 w-4" />} title="LibreNMS"
          badge={
            librenms.mapped
              ? <Badge variant="outline" className="ml-2 text-[10px] border-emerald-400 text-emerald-700 bg-emerald-50">mappato</Badge>
              : <Badge variant="outline" className="ml-2 text-[10px] text-muted-foreground">non mappato</Badge>
          }>
          {librenms.mapped && librenms.device ? (
            <>
              <dl className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <InfoRow label="Status" value={librenms.device.status === 1 || librenms.device.status === "1" ? "Online" : "Offline"} />
                <InfoRow label="LibreNMS ID" value={librenms.librenmsDeviceId != null ? String(librenms.librenmsDeviceId) : null} />
                <InfoRow label="Hostname" value={librenms.librenmsHostname ?? librenms.device.sysname ?? null} />
                <InfoRow label="OS" value={librenms.device.os ?? null} />
                <InfoRow label="Hardware" value={librenms.device.hardware ?? null} />
                <InfoRow label="Uptime" value={librenms.device.uptime_seconds ? `${Math.floor(librenms.device.uptime_seconds / 86400)} giorni` : null} />
                <InfoRow label="Ultimo poll" value={librenms.device.lastpolled ?? null} />
                <InfoRow label="Ultimo sync" value={librenms.lastSyncedAt ?? null} />
              </dl>
              {librenms.librenmsUrl && librenms.librenmsDeviceId && (
                <div className="mt-3">
                  <a
                    href={`${librenms.librenmsUrl}/device/device=${librenms.librenmsDeviceId}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-primary hover:underline inline-flex items-center gap-1"
                  >
                    Apri in LibreNMS <Activity className="h-3 w-3" />
                  </a>
                </div>
              )}
              {librenms.librenmsDeviceId && (
                <div className="mt-4">
                  <LibreNMSDeviceGraphs deviceId={librenms.librenmsDeviceId} />
                </div>
              )}
            </>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                LibreNMS configurato ma questo host non è ancora mappato — quindi nessun grafico disponibile.
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  if (!host) return;
                  try {
                    const r = await fetch("/api/integrations/librenms/host", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ host_id: host.id }),
                    });
                    const data = await r.json();
                    if (r.ok) {
                      toast.success(data.message || "Host aggiunto a LibreNMS — i grafici saranno disponibili dopo il primo polling.");
                      void fetchAll();
                    } else {
                      toast.error(data.error || "Errore aggiunta a LibreNMS");
                    }
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : "Errore di rete");
                  }
                }}
              >
                <Activity className="h-3.5 w-3.5 mr-1.5" />
                Aggiungi a LibreNMS
              </Button>
            </div>
          )}
        </Section>
      )}

        </TabsContent>

        {/* ═══════════════ TAB: SISTEMA ═══════════════ */}
        <TabsContent value="sistema" className="space-y-4">

      {/* ─── F5.A: Inventario base — SEMPRE visibile, anche senza device_info.
          Software di inventario: OS, SN, modello, tipologia sono indispensabili
          per OGNI device, anche per quelli "Altri/Indeterminato". Pesca da host
          (campi popolati da SNMP/ARP/scan) e dai suggerimenti F1 (inferred_*).
          device_info (quando presente, via WinRM/SSH/SNMP-rich) ha priorità
          come override per campi più dettagliati. */}
      <Section icon={<Boxes className="h-4 w-4" />} title="Inventario base">
        {(() => {
          const di = device?.device_info ?? null;
          const mfg = di?.manufacturer ?? host.device_manufacturer ?? null;
          const model = di?.model ?? host.model ?? null;
          const serial = di?.serial_number ?? host.serial_number ?? null;
          const firmware = di?.os_version ?? host.firmware ?? null;
          const osName = di?.os_name ?? host.os_info ?? null;
          const tipologia = host.inferred_device_type
            ?? (device?.device_type as string | undefined)
            ?? (host.classification && host.classification !== "unknown" ? host.classification : null);
          const vendor = host.inferred_vendor ?? device?.vendor ?? host.vendor ?? null;
          const osFamily = host.inferred_os_family ?? null;
          return (
            <dl className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-2">
              <InfoRow label="Tipologia" value={tipologia} />
              <InfoRow label="Vendor" value={vendor} />
              <InfoRow label="OS family" value={osFamily} />
              <InfoRow label="OS / Sistema" value={osName} />
              <InfoRow label="Modello" value={model} />
              <InfoRow label="Seriale" value={serial} mono />
              <InfoRow label="Firmware / Versione" value={firmware} />
              <InfoRow label="Manufacturer" value={mfg} />
              <InfoRow label="MAC" value={host.mac} mono />
              {host.inferred_at && (
                <InfoRow
                  label="Auto-classificazione"
                  value={`${host.inferred_confidence ?? 0}% · ${new Date(host.inferred_at).toLocaleDateString("it-IT")}`}
                />
              )}
            </dl>
          );
        })()}
      </Section>

      {/* ─── F5.B: Network device facts (SNMP) ───
          Visibile per router/switch/firewall (network gear) e per qualsiasi host
          con snmp_data popolato. Mostra i campi SNMP che il discovery cattura ma
          che oggi finivano solo nel raw JSON. Per Mikrotik/UniFi/HP/Cisco/Stormshield
          questo era il "buco principale" del tab Sistema. */}
      {(() => {
        let snmp: HostSnmpData | null = null;
        try { if (host.snmp_data) snmp = JSON.parse(host.snmp_data) as HostSnmpData; } catch { /* skip */ }
        const isNetworkGear = device?.device_type === "router" || device?.device_type === "switch" || device?.device_type === "firewall";
        if (!isNetworkGear && !snmp) return null;
        return (
          <Section icon={<Network className="h-4 w-4" />} title="Informazioni di rete (SNMP)">
            <dl className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-2">
              <InfoRow label="Sysname (SNMP)" value={device?.sysname ?? snmp?.sysName ?? null} />
              <InfoRow label="Sysdescr" value={device?.sysdescr ?? snmp?.sysDescr ?? null} />
              <InfoRow label="sysObjectID" value={snmp?.sysObjectID ?? null} mono />
              <InfoRow label="Uptime SNMP" value={snmp?.sysUpTime ?? null} />
              <InfoRow label="ARP entries" value={snmp?.arpEntryCount != null ? String(snmp.arpEntryCount) : null} />
              <InfoRow label="SNMP port" value={snmp?.port ? String(snmp.port) : null} />
              <InfoRow label="Part number" value={device?.part_number ?? snmp?.partNumber ?? null} />
              <InfoRow label="Ultima query device" value={device?.last_info_update ? parseUtcDate(device.last_info_update).toLocaleString("it-IT") : null} />
            </dl>
            {/* Hints vendor-specifici che il discovery cattura via OID custom */}
            {(snmp?.mikrotikIdentity || snmp?.unifiSummary || snmp?.ifDescrSummary || snmp?.hostResourcesSummary) && (
              <div className="mt-3 space-y-1.5 text-xs text-muted-foreground border-t border-border/50 pt-2">
                {snmp?.mikrotikIdentity && <p><span className="font-medium text-foreground">MikroTik:</span> {snmp.mikrotikIdentity}</p>}
                {snmp?.unifiSummary && <p><span className="font-medium text-foreground">UniFi:</span> {snmp.unifiSummary}</p>}
                {snmp?.ifDescrSummary && <p><span className="font-medium text-foreground">Interfacce:</span> {snmp.ifDescrSummary}</p>}
                {snmp?.hostResourcesSummary && <p><span className="font-medium text-foreground">Risorse:</span> {snmp.hostResourcesSummary}</p>}
              </div>
            )}
          </Section>
        );
      })()}

      {/* ─── F5.D: Storage NAS (Synology/QNAP) ───
          nas_inventory è popolato da scan SNMP + (opzionale) SSH. Mostra dischi
          con SMART status, RAID/pool, volumi, servizi, UPS — la cosa che oggi
          vivevano solo nel JSON raw senza essere visibili. */}
      {(() => {
        const nas = device?.device_info?.nas_inventory ?? null;
        if (!nas) return null;
        const snmp = nas.snmp;
        const ssh = nas.ssh;
        return (
          <Section icon={<HardDrive className="h-4 w-4" />} title={`Storage NAS — ${nas.vendor === "synology" ? "Synology" : "QNAP"}`}>
            <div className="space-y-3">
              <dl className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-2">
                <InfoRow label="Stato sistema" value={snmp?.system_status ?? null} />
                <InfoRow label="Temperatura sistema" value={snmp?.temperature_c != null ? `${snmp.temperature_c} °C` : null} />
                <InfoRow label="Temperatura CPU" value={snmp?.cpu_temperature_c != null ? `${snmp.cpu_temperature_c} °C` : null} />
                <InfoRow label="UPS" value={snmp?.ups?.status ? `${snmp.ups.status}${snmp.ups.battery_pct ? ` (${snmp.ups.battery_pct})` : ""}` : null} />
                <InfoRow label="CPU model" value={ssh?.cpu_model ?? null} />
                <InfoRow label="Kernel" value={ssh?.kernel ?? null} mono />
                <InfoRow label="Pacchetti installati" value={ssh?.synology_packages_count != null ? String(ssh.synology_packages_count) : null} />
                <InfoRow label="Fonti dati" value={nas.sources && nas.sources.length ? nas.sources.join(" + ") : null} />
              </dl>

              {/* Dischi fisici */}
              {snmp?.disks && snmp.disks.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5">Dischi ({snmp.disks.length})</div>
                  <div className="border rounded-md overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/50">
                        <tr>
                          <th className="text-left px-2 py-1.5 font-medium">Slot</th>
                          <th className="text-left px-2 py-1.5 font-medium">Modello</th>
                          <th className="text-left px-2 py-1.5 font-medium">Capacità</th>
                          <th className="text-left px-2 py-1.5 font-medium">Stato</th>
                          <th className="text-left px-2 py-1.5 font-medium">SMART</th>
                          <th className="text-left px-2 py-1.5 font-medium">Temp.</th>
                          <th className="text-left px-2 py-1.5 font-medium">Serial</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {snmp.disks.map((d, i) => (
                          <tr key={i} className="hover:bg-muted/30">
                            <td className="px-2 py-1.5 font-mono">{d.slot ?? "—"}</td>
                            <td className="px-2 py-1.5">{d.model ?? "—"}</td>
                            <td className="px-2 py-1.5">{d.capacity_gb != null ? `${d.capacity_gb} GB` : "—"}</td>
                            <td className="px-2 py-1.5">
                              {d.status ? <Badge variant={/ok|normal|active/i.test(d.status) ? "default" : "destructive"} className="text-[10px]">{d.status}</Badge> : "—"}
                            </td>
                            <td className="px-2 py-1.5">{d.smart_health ?? "—"}</td>
                            <td className="px-2 py-1.5">{d.temperature_c != null ? `${d.temperature_c} °C` : "—"}</td>
                            <td className="px-2 py-1.5 font-mono text-[10px]">{d.serial ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* RAID groups */}
              {snmp?.raids && snmp.raids.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5">RAID groups ({snmp.raids.length})</div>
                  <div className="border rounded-md divide-y">
                    {snmp.raids.map((r, i) => (
                      <div key={i} className="px-3 py-2 flex items-center justify-between text-sm">
                        <span className="font-medium">{r.name ?? `RAID #${i + 1}`}</span>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                          {r.status && (
                            <Badge variant={/ok|normal|active/i.test(r.status) ? "default" : "destructive"} className="text-[10px]">{r.status}</Badge>
                          )}
                          {r.total_gb != null && <span>{r.free_gb != null ? `${r.free_gb}/${r.total_gb} GB free` : `${r.total_gb} GB`}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Volumi / storage pools */}
              {snmp?.volumes_snmp && snmp.volumes_snmp.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5">Volumi ({snmp.volumes_snmp.length})</div>
                  <div className="border rounded-md divide-y">
                    {snmp.volumes_snmp.map((v, i) => (
                      <div key={i} className="px-3 py-2 flex items-center justify-between text-sm">
                        <span>{v.name ?? `Vol #${i + 1}`} {v.raid_type && <span className="text-xs text-muted-foreground">({v.raid_type})</span>}</span>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                          {v.status && <Badge variant={/ok|normal|active/i.test(v.status) ? "default" : "destructive"} className="text-[10px]">{v.status}</Badge>}
                          {v.size_gb != null && <span>{v.free_gb != null ? `${v.free_gb}/${v.size_gb} GB free` : `${v.size_gb} GB`}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Storage pools (QNAP) */}
              {snmp?.storage_pools && snmp.storage_pools.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5">Storage pool ({snmp.storage_pools.length})</div>
                  <div className="border rounded-md divide-y">
                    {snmp.storage_pools.map((p, i) => (
                      <div key={i} className="px-3 py-2 flex items-center justify-between text-sm">
                        <span>{p.name ?? `Pool #${i + 1}`}</span>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                          {p.status && <Badge variant={/ok|normal|active/i.test(p.status) ? "default" : "destructive"} className="text-[10px]">{p.status}</Badge>}
                          {p.total_gb != null && <span>{p.used_gb != null ? `${p.used_gb}/${p.total_gb} GB used` : `${p.total_gb} GB`}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Servizi SNMP NAS */}
              {snmp?.services && snmp.services.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5">Servizi NAS ({snmp.services.length})</div>
                  <div className="flex flex-wrap gap-1.5">
                    {snmp.services.map((s, i) => (
                      <Badge key={i} variant={s.state && /running|active|ok/i.test(s.state) ? "default" : "outline"} className="text-[10px]">
                        {s.name ?? "?"}{s.state ? `: ${s.state}` : ""}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* SSH previews (raw text) */}
              {(ssh?.synology_shares_preview || ssh?.qnap_qpkg_preview || ssh?.mdstat_summary) && (
                <div className="text-xs text-muted-foreground space-y-1 border-t border-border/50 pt-2">
                  {ssh?.mdstat_summary && <div><span className="font-medium text-foreground">mdstat:</span> <code className="text-[10px]">{ssh.mdstat_summary}</code></div>}
                  {ssh?.synology_shares_preview && <div><span className="font-medium text-foreground">Share Synology:</span> {ssh.synology_shares_preview}</div>}
                  {ssh?.qnap_qpkg_preview && <div><span className="font-medium text-foreground">QPKG:</span> {ssh.qnap_qpkg_preview}</div>}
                </div>
              )}
            </div>
          </Section>
        );
      })()}

      {/* ─── 3. Sistema operativo (Windows/Linux server) ─── */}
      {(() => {
        const di = device?.device_info ?? null;
        if (!di) return null;
        const hasOsContent = !!(
          di.hostname || di.os_name || di.os_version || di.domain ||
          di.kernel_version || di.uptime || di.uptime_days != null ||
          di.last_boot || di.registered_user
        );
        if (!hasOsContent) return null;
        return (
          <Section icon={<ServerCog className="h-4 w-4" />} title="Sistema operativo"
            badge={
              <span className="ml-2 inline-flex gap-1.5">
                {di.is_domain_controller && <Badge variant="outline" className="text-[10px] border-purple-400 text-purple-700 bg-purple-50">Domain Controller</Badge>}
                {di.is_server && !di.is_domain_controller && <Badge variant="outline" className="text-[10px]">Server</Badge>}
                {di.is_virtual && di.virtualization && <Badge variant="outline" className="text-[10px]">{di.virtualization}</Badge>}
              </span>
            }>
            <dl className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <InfoRow label="Hostname" value={di.hostname ?? null} />
              <InfoRow label="Dominio" value={di.domain ?? null} />
              <InfoRow label="OS" value={di.os_name ?? null} />
              <InfoRow label="Versione" value={di.os_version ?? null} />
              <InfoRow label="Build" value={di.os_build ?? null} />
              <InfoRow label="Kernel" value={di.kernel_version ?? null} />
              <InfoRow label="Architettura" value={di.architecture ?? null} />
              <InfoRow label="Domain role" value={di.domain_role ?? null} />
              <InfoRow label="Uptime" value={di.uptime ?? (di.uptime_days ? `${di.uptime_days} giorni` : null)} />
              <InfoRow label="Ultimo boot" value={di.last_boot ?? null} />
              <InfoRow label="Data install" value={di.install_date ?? null} />
              <InfoRow label="Load avg" value={di.load_average ?? null} />
              <InfoRow label="Utente registrato" value={di.registered_user ?? null} />
              <InfoRow label="Organizzazione" value={di.organization ?? null} />
            </dl>
          </Section>
        );
      })()}

      {/* ─── 3.1 Hardware ─── */}
      {(() => {
        const di = device?.device_info ?? null;
        if (!di) return null;
        const hasContent = !!(
          di.cpu_model || di.ram_total_gb != null || di.bios_version ||
          di.gpu || di.memory_modules?.length || di.physical_disks?.length ||
          di.manufacturer || di.model
        );
        if (!hasContent) return null;
        const gpuList = Array.isArray(di.gpu) ? di.gpu : (di.gpu ? [{ name: di.gpu }] : []);
        return (
          <Section icon={<Cpu className="h-4 w-4" />} title="Hardware">
            <dl className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
              <InfoRow label="Produttore" value={di.manufacturer ?? null} />
              <InfoRow label="Modello" value={di.model ?? null} />
              <InfoRow label="System type" value={di.system_type ?? null} />
              <InfoRow label="Serial" value={di.serial_number ?? null} mono />
              <InfoRow label="CPU" value={di.cpu_model ?? null} />
              <InfoRow label="CPU produttore" value={di.cpu_manufacturer ?? null} />
              <InfoRow label="Core / Thread" value={di.cpu_cores ? `${di.cpu_cores} core${di.cpu_threads ? ` / ${di.cpu_threads} thread` : ""}` : null} />
              <InfoRow label="Frequenza" value={di.cpu_speed_mhz ? `${di.cpu_speed_mhz} MHz` : null} />
              <InfoRow label="Processor count" value={di.processor_count != null ? String(di.processor_count) : null} />
              <InfoRow label="RAM" value={di.ram_total_gb ? `${di.ram_total_gb.toFixed(1)} GB` : null} />
              <InfoRow label="RAM libera" value={di.ram_free_mb != null ? `${(di.ram_free_mb / 1024).toFixed(1)} GB` : null} />
              <InfoRow label="BIOS" value={di.bios_manufacturer || di.bios_version ? `${di.bios_manufacturer ?? ""} ${di.bios_version ?? ""}`.trim() : null} />
            </dl>

            {/* GPU */}
            {gpuList.length > 0 && (
              <div className="mb-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5">GPU</div>
                <div className="flex flex-wrap gap-1.5">
                  {gpuList.map((g, i) => (
                    <Badge key={i} variant="outline" className="text-[10px]">
                      {g.name ?? "?"}
                      {g.vram_mb && ` · ${(g.vram_mb / 1024).toFixed(1)} GB`}
                      {g.driver && <span className="text-muted-foreground"> · {g.driver}</span>}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Memory modules */}
            {di.memory_modules && di.memory_modules.length > 0 && (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5">
                  Memory modules ({di.memory_modules.length})
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {di.memory_modules.map((m, i) => (
                    <Badge key={i} variant="outline" className="text-[10px] font-mono">
                      {m.locator ?? `Slot${i}`}: {m.size_gb ? `${m.size_gb} GB` : "?"}
                      {m.speed_mhz && ` @ ${m.speed_mhz} MHz`}
                      {m.manufacturer && <span className="text-muted-foreground"> · {m.manufacturer}</span>}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </Section>
        );
      })()}

      {/* ─── 3.2 Schede di rete del sistema ─── */}
      {(() => {
        const di = device?.device_info ?? null;
        const nics = di?.network_adapters ?? [];
        if (nics.length === 0) return null;
        return (
          <Section icon={<Network className="h-4 w-4" />} title="Schede di rete del sistema"
            badge={<Badge variant="outline" className="ml-2 text-[10px]">{nics.length}</Badge>}>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-[10px] uppercase tracking-wider text-muted-foreground border-b">
                  <tr>
                    <th className="text-left py-1.5 pr-3">Interfaccia</th>
                    <th className="text-left pr-3">MAC</th>
                    <th className="text-left pr-3">IP</th>
                    <th className="text-left pr-3">DHCP</th>
                    <th className="text-left pr-3">Speed</th>
                    <th className="text-left">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {nics.map((n, i) => {
                    const ips = Array.isArray(n.ips) ? n.ips.join(", ") : (n.ips ?? "");
                    const mac = n.mac ?? n.mac_address ?? "";
                    return (
                      <tr key={i} className="border-b border-border/30 last:border-0">
                        <td className="py-1 pr-3 font-mono">{n.name ?? "—"}</td>
                        <td className="pr-3 font-mono">{mac || "—"}</td>
                        <td className="pr-3 font-mono">{ips || "—"}</td>
                        <td className="pr-3">{n.dhcp === true ? <Badge variant="outline" className="text-[10px]">DHCP</Badge> : n.dhcp === false ? <Badge variant="outline" className="text-[10px]">Statico</Badge> : "—"}</td>
                        <td className="pr-3 font-mono text-[10px]">{n.speed_mbps ? `${n.speed_mbps} Mb/s` : "—"}</td>
                        <td>{n.status ?? "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Section>
        );
      })()}

      {/* ─── 3.3 Sicurezza e licenza (Windows) ─── */}
      {(() => {
        const di = device?.device_info ?? null;
        if (!di) return null;
        const hasContent = !!(
          di.license_status || di.license_name || di.antivirus ||
          di.firewall_active != null || di.firewall_type || di.server_roles?.length
        );
        if (!hasContent) return null;
        const avList: Array<{ name?: string; status?: string }> = Array.isArray(di.antivirus)
          ? di.antivirus.map((a) => typeof a === "string" ? { name: a } : a)
          : [];
        return (
          <Section icon={<Shield className="h-4 w-4" />} title="Sicurezza e licenza">
            <div className="space-y-3">
              {/* Licenza Windows */}
              {(di.license_status || di.license_name) && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5">Licenza</div>
                  <dl className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <InfoRow label="Status" value={di.license_status ?? null} />
                    <InfoRow label="Edition" value={di.license_name ?? null} />
                    <InfoRow label="Product key" value={di.license_partial_key ?? null} mono />
                    <InfoRow label="OS Serial" value={di.os_serial ?? null} mono />
                  </dl>
                </div>
              )}

              {/* Antivirus */}
              {avList.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5">Antivirus ({avList.length})</div>
                  <div className="flex flex-wrap gap-1.5">
                    {avList.map((a, i) => (
                      <Badge key={i} variant="outline" className="text-[10px]">
                        {a.name ?? "?"}{a.status && <span className="text-muted-foreground"> · {a.status}</span>}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* Firewall */}
              {(di.firewall_active != null || di.firewall_type) && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5">Firewall</div>
                  <div className="flex items-center gap-2 text-xs">
                    {di.firewall_active === true && <Badge variant="outline" className="text-[10px] border-emerald-400 text-emerald-700 bg-emerald-50">Attivo</Badge>}
                    {di.firewall_active === false && <Badge variant="outline" className="text-[10px] border-red-400 text-red-700 bg-red-50">Disattivo</Badge>}
                    {di.firewall_type && <span className="font-mono text-muted-foreground">{di.firewall_type}</span>}
                    {di.firewall_rules_count != null && <span className="text-muted-foreground">{di.firewall_rules_count} regole</span>}
                  </div>
                </div>
              )}

              {/* Server roles */}
              {di.server_roles && di.server_roles.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5">Server roles ({di.server_roles.length})</div>
                  <div className="flex flex-wrap gap-1.5">
                    {di.server_roles.map((r, i) => (
                      <Badge key={i} variant="outline" className="text-[10px] border-blue-400 text-blue-700 bg-blue-50">{r}</Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </Section>
        );
      })()}

      {/* ─── 3.4 Aggiornamenti Windows (hotfixes) ─── */}
      {(() => {
        const di = device?.device_info ?? null;
        const hf = di?.installed_hotfixes ?? [];
        if (hf.length === 0 && (di?.pending_updates_count ?? 0) === 0) return null;
        return (
          <Section icon={<Activity className="h-4 w-4" />} title="Aggiornamenti Windows"
            badge={
              <span className="ml-2 inline-flex gap-1.5">
                <Badge variant="outline" className="text-[10px]">{hf.length} installati</Badge>
                {(di?.pending_updates_count ?? 0) > 0 && (
                  <Badge variant="outline" className="text-[10px] border-amber-400 text-amber-700 bg-amber-50">{di?.pending_updates_count} pending</Badge>
                )}
              </span>
            }>
            {hf.length > 0 && (
              <div className="max-h-64 overflow-y-auto">
                <div className="flex flex-wrap gap-1.5">
                  {hf.slice(0, 50).map((h, i) => (
                    <Badge key={i} variant="outline" className="text-[10px] font-mono">
                      {h.id ?? "?"}{h.installed_on && <span className="text-muted-foreground"> · {h.installed_on}</span>}
                    </Badge>
                  ))}
                  {hf.length > 50 && <Badge variant="outline" className="text-[10px]">+{hf.length - 50} altri</Badge>}
                </div>
              </div>
            )}
          </Section>
        );
      })()}

      {/* ─── 3.5 Linux: listening ports + cron ─── */}
      {(() => {
        const di = device?.device_info ?? null;
        const lp = di?.listening_ports ?? [];
        const cj = di?.cron_jobs ?? [];
        if (lp.length === 0 && cj.length === 0) return null;
        return (
          <Section icon={<TableIcon className="h-4 w-4" />} title="Processi e schedulazioni">
            <div className="space-y-3">
              {lp.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5">
                    Porte in ascolto ({lp.length})
                  </div>
                  <div className="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto">
                    {lp.slice(0, 50).map((p, i) => (
                      <Badge key={i} variant="outline" className="text-[10px] font-mono">
                        {p.protocol ?? "?"}:{p.port ?? "?"}{p.process && <span className="text-muted-foreground"> · {p.process}</span>}
                      </Badge>
                    ))}
                    {lp.length > 50 && <Badge variant="outline" className="text-[10px]">+{lp.length - 50} altre</Badge>}
                  </div>
                </div>
              )}
              {cj.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5">
                    Cron jobs ({cj.length})
                  </div>
                  <div className="max-h-48 overflow-y-auto space-y-1">
                    {cj.slice(0, 15).map((c, i) => (
                      <div key={i} className="text-xs font-mono flex items-baseline gap-3">
                        <Badge variant="outline" className="text-[10px] shrink-0">{c.user ?? "?"}</Badge>
                        <span className="text-muted-foreground shrink-0">{c.schedule ?? ""}</span>
                        <span className="truncate" title={c.command ?? ""}>{c.command ?? ""}</span>
                      </div>
                    ))}
                    {cj.length > 15 && <p className="text-[10px] text-muted-foreground">+{cj.length - 15} altri</p>}
                  </div>
                </div>
              )}
            </div>
          </Section>
        );
      })()}

      {/* ─── 3.6 Storage / Filesystem (logici + fisici) ─── */}
      {(() => {
        const di = device?.device_info ?? null;
        if (!di) return null;
        const hasContent = !!(
          di.disks?.length || di.physical_disks?.length ||
          di.important_services?.length || di.local_users?.length || di.logged_on_users?.length
        );
        if (!hasContent) return null;
        return (
          <Section icon={<HardDrive className="h-4 w-4" />} title="Storage, servizi e utenti">
            <div className="space-y-4">
              {/* Dischi logici */}
              {di.disks && di.disks.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5 flex items-center gap-1.5">
                    <HardDrive className="h-3 w-3" /> Filesystem ({di.disks.length})
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {di.disks.map((d, i) => {
                      const usedPct = d.size_gb && d.free_gb != null
                        ? Math.round(((d.size_gb - d.free_gb) / d.size_gb) * 100)
                        : null;
                      return (
                        <div key={i} className="text-xs border rounded px-2 py-1.5 flex items-center justify-between gap-2">
                          <div className="font-mono truncate">
                            {d.device ?? "—"}
                            {d.label && <span className="text-muted-foreground"> · {d.label}</span>}
                          </div>
                          <div className="shrink-0 text-muted-foreground">
                            {formatGb(d.free_gb)} / {formatGb(d.size_gb)}
                            {usedPct != null && (
                              <span className={`ml-1 ${usedPct >= 90 ? "text-red-600 font-semibold" : usedPct >= 75 ? "text-amber-600" : ""}`}>
                                · {usedPct}% usato
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Dischi fisici */}
              {di.physical_disks && di.physical_disks.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5 flex items-center gap-1.5">
                    <Disc className="h-3 w-3" /> Dischi fisici ({di.physical_disks.length})
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {di.physical_disks.map((d, i) => (
                      <div key={i} className="text-xs border rounded px-2 py-1.5">
                        <div className="font-mono">{d.device ?? "—"}</div>
                        <div className="text-muted-foreground text-[11px] mt-0.5">
                          {d.model ?? "—"}{d.vendor && ` · ${d.vendor}`} · {formatGb(d.size_gb)}
                          {d.interface_type && ` · ${d.interface_type}`}
                          {d.serial && <span className="font-mono"> · {d.serial}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Servizi importanti */}
              {di.important_services && di.important_services.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5">
                    Servizi rilevanti ({di.important_services.length})
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {di.important_services.map((s, i) => {
                      const running = s.state?.toLowerCase() === "running";
                      return (
                        <Badge
                          key={i}
                          variant="outline"
                          className={`text-[10px] ${running ? "border-emerald-400 text-emerald-700 bg-emerald-50" : "text-muted-foreground"}`}
                          title={`${s.display_name ?? s.name ?? ""} · ${s.start_mode ?? ""}`}
                        >
                          {s.name ?? "?"} · {s.state ?? "?"}
                        </Badge>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Utenti locali */}
              {di.local_users && di.local_users.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5 flex items-center gap-1.5">
                    <Users className="h-3 w-3" /> Utenti locali ({di.local_users.length})
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {di.local_users.map((u, i) => (
                      <Badge
                        key={i}
                        variant="outline"
                        className={`text-[10px] ${u.disabled ? "text-muted-foreground line-through" : ""}`}
                        title={u.full_name ?? u.name ?? ""}
                      >
                        {u.name ?? "?"}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* Utenti loggati */}
              {di.logged_on_users && di.logged_on_users.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5 flex items-center gap-1.5">
                    <Users className="h-3 w-3 text-emerald-600" /> Utenti attualmente connessi ({di.logged_on_users.length})
                  </div>
                  <div className="space-y-1">
                    {di.logged_on_users.map((u, i) => (
                      <div key={i} className="text-xs flex items-center gap-3 font-mono">
                        <span className="font-medium">{u.username ?? "?"}</span>
                        {u.session_type && <Badge variant="outline" className="text-[10px]">{u.session_type}</Badge>}
                        {u.logon_time && <span className="text-muted-foreground">{u.logon_time}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </Section>
        );
      })()}

        </TabsContent>

        {/* ═══════════════ TAB: RETE AVANZATA ═══════════════ */}
        <TabsContent value="network" className="space-y-4">

      {/* ─── 3.0 IP collegati (cluster fisico) ─────────────────────────
          Espone l'aggregazione physical_device: tutti gli IP che il sistema
          (o l'utente, via "Collega altro IP") ha dichiarato appartenere allo
          stesso device fisico. Caso d'uso tipico: Proxmox con NIC su VLAN
          diverse (mgmt 40.1 + VM 16.1), router/firewall con gateway multipli.
      */}
      <Section icon={<Link2 className="h-4 w-4" />} title="IP collegati allo stesso device fisico">
        <div className="space-y-3">
          {host?.physical_device_id && clusterMembers.length > 0 ? (
            <>
              <div className="text-xs text-muted-foreground">
                Cluster fisico <span className="font-mono">#{host.physical_device_id}</span> · {clusterMembers.length} {clusterMembers.length === 1 ? "IP" : "IP"} aggregati
              </div>
              <div className="border rounded-md divide-y">
                {clusterMembers.map((m) => {
                  const isCurrent = m.id === host?.id;
                  return (
                    <div key={m.id} className="flex items-center gap-3 px-3 py-2 hover:bg-muted/30">
                      <div className="flex-1 min-w-0 flex items-center gap-2">
                        {isCurrent ? (
                          <span className="font-mono text-sm">{m.ip}</span>
                        ) : (
                          <Link href={`/objects/${m.id}`} className="font-mono text-sm hover:underline text-primary">{m.ip}</Link>
                        )}
                        {m.hostname && <span className="text-sm text-muted-foreground truncate">{m.hostname}</span>}
                        <span className="text-[10px] text-muted-foreground">· {m.network_name}</span>
                        {isCurrent && <Badge variant="secondary" className="text-[10px]">qui</Badge>}
                        <StatusBadge status={m.status} />
                      </div>
                      {!isCurrent && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleUnlinkHost(m.id)}
                          disabled={unlinkingHostId === m.id}
                          title="Scollega questo IP dal device fisico"
                        >
                          <Unlink className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Nessun altro IP aggregato. Se questo device ha più indirizzi (es. NIC su VLAN diverse, gateway multipli), collegali manualmente.
            </p>
          )}
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setLinkDialogOpen(true)} disabled={!host}>
              <Link2 className="h-3.5 w-3.5 mr-1.5" />
              Collega altro IP
            </Button>
            {host?.physical_device_id && clusterMembers.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => host?.id && handleUnlinkHost(host.id)}
                disabled={unlinkingHostId === host?.id}
              >
                <Unlink className="h-3.5 w-3.5 mr-1.5" />
                Esci dal cluster
              </Button>
            )}
          </div>
        </div>
      </Section>

      {/* ─── 3a. Proxmox (host + VM + subscription) ─── */}
      {(() => {
        const px = device?.proxmox_data ?? null;
        if (!px || (!px.hosts?.length && !px.vms?.length)) return null;
        return (
          <Section icon={<Server className="h-4 w-4" />} title="Proxmox VE"
            badge={px.scanned_at && (
              <span className="ml-2 text-[10px] text-muted-foreground">
                scan {new Date(px.scanned_at).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
              </span>
            )}>
            <Tabs defaultValue="px-host" className="space-y-3">
              <TabsList className="!h-9 p-0.5 gap-0.5">
                <TabsTrigger value="px-host" className="px-3 py-1 text-xs">
                  Host cluster {px.hosts?.length ? `(${px.hosts.length})` : ""}
                </TabsTrigger>
                <TabsTrigger value="px-vms" className="px-3 py-1 text-xs">
                  VM e Container {px._total_vm_rows ?? px.vms?.length ?? 0 > 0 ? `(${px._total_vm_rows ?? px.vms?.length})` : ""}
                </TabsTrigger>
              </TabsList>

              <TabsContent value="px-host" className="space-y-4">
              {/* Hosts cluster */}
              {px.hosts && px.hosts.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5">
                    Host del cluster ({px.hosts.length})
                  </div>
                  <div className="space-y-2">
                    {px.hosts.map((h, i) => {
                      const subStatus = h.subscription?.status?.toLowerCase();
                      const subActive = subStatus === "active" || subStatus === "active/valid";
                      return (
                        <div key={i} className="border rounded p-3">
                          <div className="flex items-baseline justify-between gap-3 mb-2 flex-wrap">
                            <div className="font-mono font-semibold text-sm">{h.hostname}</div>
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className={`text-[10px] ${h.status === "online" ? "border-emerald-400 text-emerald-700 bg-emerald-50" : "text-muted-foreground"}`}>
                                {h.status}
                              </Badge>
                              {h.proxmox_version && <Badge variant="outline" className="text-[10px]">PVE {h.proxmox_version}</Badge>}
                              {h.subscription?.productname && (
                                <Badge variant="outline" className={`text-[10px] ${subActive ? "border-emerald-400 text-emerald-700 bg-emerald-50" : "border-amber-400 text-amber-700 bg-amber-50"}`}>
                                  {h.subscription.productname}{h.subscription.level && ` (${h.subscription.level})`}
                                </Badge>
                              )}
                            </div>
                          </div>
                          <dl className="grid grid-cols-2 md:grid-cols-4 gap-3">
                            <InfoRow label="CPU" value={h.cpu_model ?? null} />
                            <InfoRow label="Core / Socket" value={h.cpu_total_cores ? `${h.cpu_total_cores} core${h.cpu_sockets ? ` · ${h.cpu_sockets} socket` : ""}${h.cpu_cores ? ` (${h.cpu_cores}/socket)` : ""}` : null} />
                            <InfoRow label="CPU MHz" value={h.cpu_mhz ? `${Math.round(h.cpu_mhz)} MHz` : null} />
                            <InfoRow label="RAM totale" value={h.memory_total_gb ? `${h.memory_total_gb.toFixed(1)} GB` : null} />
                            <InfoRow label="RAM usata" value={h.memory_used_gb != null ? `${h.memory_used_gb.toFixed(1)} GB${h.memory_usage_percent != null ? ` · ${Math.round(h.memory_usage_percent)}%` : ""}` : null} />
                            <InfoRow label="RAM libera" value={h.memory_free_gb != null ? `${h.memory_free_gb.toFixed(1)} GB` : null} />
                            <InfoRow label="Uptime" value={h.uptime_human ?? null} />
                            <InfoRow label="Kernel" value={h.kernel_version ?? null} />
                            <InfoRow
                              label="Root FS"
                              value={h.rootfs_total_gb ? `${formatGb(h.rootfs_used_gb)} / ${formatGb(h.rootfs_total_gb)}` : null}
                            />
                            <InfoRow label="Hardware" value={h.hardware_manufacturer || h.hardware_model ? `${h.hardware_manufacturer ?? ""} ${h.hardware_model ?? ""}`.trim() : null} />
                            <InfoRow label="Serial HW" value={h.hardware_serial ?? null} mono />
                          </dl>

                          {/* Subscription dettagliata */}
                          {h.subscription && (
                            <div className="mt-3 p-2 bg-muted/30 rounded">
                              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5">Subscription</div>
                              <dl className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                <InfoRow label="Status" value={h.subscription.status ?? null} />
                                <InfoRow label="Prodotto" value={h.subscription.productname ?? null} />
                                <InfoRow label="Level" value={h.subscription.level ?? null} />
                                <InfoRow label="Key" value={h.subscription.key ?? null} mono />
                                <InfoRow label="Registrata il" value={h.subscription.regdate ?? null} />
                                <InfoRow label="Scade il" value={h.subscription.nextduedate ?? null} />
                                <InfoRow label="Socket" value={h.subscription.sockets != null ? String(h.subscription.sockets) : null} />
                                <InfoRow label="Server ID" value={h.subscription.serverid ?? null} mono />
                              </dl>
                            </div>
                          )}

                          {/* Storage pools host */}
                          {h.storage && h.storage.length > 0 && (
                            <div className="mt-3">
                              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5 flex items-center gap-1.5">
                                <HardDrive className="h-3 w-3" />
                                Storage ({h.storage.length})
                              </div>
                              <div className="overflow-x-auto">
                                <table className="w-full text-xs">
                                  <thead className="text-[10px] uppercase tracking-wider text-muted-foreground border-b">
                                    <tr>
                                      <th className="text-left py-1.5 pr-3">Nome</th>
                                      <th className="text-left pr-3">Tipo</th>
                                      <th className="text-left pr-3">Contenuto</th>
                                      <th className="text-left pr-3">Usato</th>
                                      <th className="text-left pr-3">Disponibile</th>
                                      <th className="text-left">Totale</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {h.storage.map((s, j) => {
                                      const usedPct = s.total_gb && s.used_gb != null ? Math.round((s.used_gb / s.total_gb) * 100) : null;
                                      return (
                                        <tr key={j} className="border-b border-border/30 last:border-0">
                                          <td className="py-1 pr-3 font-mono">{s.name}</td>
                                          <td className="pr-3"><Badge variant="outline" className="text-[10px]">{s.type ?? "?"}</Badge></td>
                                          <td className="pr-3 text-[10px] text-muted-foreground">{s.content ?? "—"}</td>
                                          <td className="pr-3">
                                            {formatGb(s.used_gb)}
                                            {usedPct != null && (
                                              <span className={`ml-1 text-[10px] ${usedPct >= 90 ? "text-red-600 font-semibold" : usedPct >= 75 ? "text-amber-600" : "text-muted-foreground"}`}>
                                                ({usedPct}%)
                                              </span>
                                            )}
                                          </td>
                                          <td className="pr-3">{formatGb(s.available_gb)}</td>
                                          <td>{formatGb(s.total_gb)}</td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          )}

                          {/* Network interfaces host */}
                          {h.network_interfaces && h.network_interfaces.length > 0 && (
                            <div className="mt-3">
                              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5 flex items-center gap-1.5">
                                <Network className="h-3 w-3" />
                                Interfacce di rete ({h.network_interfaces.length})
                              </div>
                              <div className="overflow-x-auto">
                                <table className="w-full text-xs">
                                  <thead className="text-[10px] uppercase tracking-wider text-muted-foreground border-b">
                                    <tr>
                                      <th className="text-left py-1.5 pr-3">Nome</th>
                                      <th className="text-left pr-3">Tipo</th>
                                      <th className="text-left pr-3">Stato</th>
                                      <th className="text-left pr-3">MAC</th>
                                      <th className="text-left pr-3">IP</th>
                                      <th className="text-left pr-3">Bridge</th>
                                      <th className="text-left">Speed</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {h.network_interfaces.map((nic, j) => (
                                      <tr key={j} className="border-b border-border/30 last:border-0">
                                        <td className="py-1 pr-3 font-mono">{nic.name}</td>
                                        <td className="pr-3"><Badge variant="outline" className="text-[10px]">{nic.type ?? "?"}</Badge></td>
                                        <td className="pr-3">
                                          <Badge variant="outline" className={`text-[10px] ${nic.state === "up" ? "border-emerald-400 text-emerald-700 bg-emerald-50" : "text-muted-foreground"}`}>
                                            {nic.state ?? "?"}
                                          </Badge>
                                        </td>
                                        <td className="pr-3 font-mono">{nic.mac_address ?? "—"}</td>
                                        <td className="pr-3 font-mono">{nic.ip_addresses ?? "—"}</td>
                                        <td className="pr-3 font-mono">{nic.bridge ?? "—"}</td>
                                        <td>{nic.speed_mbps ? `${nic.speed_mbps} Mb/s` : "—"}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              </TabsContent>

              <TabsContent value="px-vms" className="space-y-4">
              {/* VM e CT */}
              {px.vms && px.vms.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5 flex items-center gap-1.5">
                    <Layers className="h-3 w-3" />
                    VM e Container ({px._total_vm_rows ?? px.vms.length})
                    {px._truncated && (
                      <span className="text-[10px] text-amber-600">· mostrate prime {px.vms.length}</span>
                    )}
                  </div>
                  <div className="overflow-x-auto max-h-[600px]">
                    <table className="w-full text-xs">
                      <thead className="text-[10px] uppercase tracking-wider text-muted-foreground border-b sticky top-0 bg-background">
                        <tr>
                          <th className="text-left py-1.5 pr-3">VMID</th>
                          <th className="text-left pr-3">Nome</th>
                          <th className="text-left pr-3">Tipo</th>
                          <th className="text-left pr-3">CPU</th>
                          <th className="text-left pr-3">RAM</th>
                          <th className="text-left pr-3">Dischi</th>
                          <th className="text-left pr-3">Reti</th>
                          <th className="text-left pr-3">BIOS</th>
                          <th className="text-left">IP</th>
                        </tr>
                      </thead>
                      <tbody>
                        {px.vms.map((vm) => {
                          const disksDetail = vm.disks_details?.filter((d) => d.id && d.size) ?? [];
                          const netsDetail = vm.networks_details ?? [];
                          return (
                            <tr key={`${vm.node}-${vm.vmid}`} className="border-b border-border/30 last:border-0 align-top">
                              <td className="py-1 pr-3 font-mono">{vm.vmid}</td>
                              <td className="pr-3 font-medium">
                                {vm.name}
                                <div className="text-[10px] text-muted-foreground font-normal">{vm.node}</div>
                              </td>
                              <td className="pr-3">
                                <Badge variant="outline" className="text-[10px] uppercase">{vm.type}</Badge>
                                {vm.status && (
                                  <Badge variant="outline" className={`ml-1 text-[10px] ${vm.status === "running" ? "border-emerald-400 text-emerald-700 bg-emerald-50" : "text-muted-foreground"}`}>
                                    {vm.status}
                                  </Badge>
                                )}
                                {vm.agent === 1 && (
                                  <Badge variant="outline" className="ml-1 text-[10px] border-blue-400 text-blue-700 bg-blue-50" title="QEMU guest agent attivo">agent</Badge>
                                )}
                              </td>
                              <td className="pr-3 font-mono">
                                {vm.maxcpu}
                                {vm.cores && vm.sockets && <div className="text-[10px] text-muted-foreground">{vm.sockets}s·{vm.cores}c</div>}
                              </td>
                              <td className="pr-3 font-mono">{vm.memory_mb ? `${(vm.memory_mb / 1024).toFixed(1)} GB` : "—"}</td>
                              <td className="pr-3">
                                {disksDetail.length > 0 ? (
                                  <div className="space-y-0.5">
                                    {disksDetail.map((d, j) => (
                                      <div key={j} className="text-[10px] font-mono">
                                        <span className="text-muted-foreground">{d.id}:</span> {d.size}
                                        {d.storage && d.storage !== "N/A" && <span className="text-muted-foreground"> @ {d.storage}</span>}
                                      </div>
                                    ))}
                                  </div>
                                ) : vm.disk_gb ? (
                                  <span className="font-mono">{vm.disk_gb} GB</span>
                                ) : "—"}
                              </td>
                              <td className="pr-3">
                                {netsDetail.length > 0 ? (
                                  <div className="space-y-0.5">
                                    {netsDetail.map((n, j) => (
                                      <div key={j} className="text-[10px] font-mono">
                                        <span className="text-muted-foreground">{n.id}:</span> {n.bridge ?? "?"}
                                        {n.vlan && <Badge variant="outline" className="ml-1 text-[9px] py-0">v{n.vlan}</Badge>}
                                        {n.mac && <span className="text-muted-foreground block">{n.mac}</span>}
                                      </div>
                                    ))}
                                  </div>
                                ) : "—"}
                              </td>
                              <td className="pr-3 text-[10px] font-mono">{vm.bios ?? "—"}</td>
                              <td className="font-mono text-[10px]">
                                {vm.ip_addresses && vm.ip_addresses.length > 0 ? vm.ip_addresses.join(", ") : "—"}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              </TabsContent>
            </Tabs>
          </Section>
        );
      })()}

      {/* ─── 3a-bis. Spanning Tree Protocol (STP) — solo switch ─── */}
      {(() => {
        const stp = device?.stp_info ?? null;
        if (!stp) return null;
        return (
          <Section icon={<Radio className="h-4 w-4" />} title="Spanning Tree Protocol"
            badge={
              <span className="ml-2 inline-flex gap-1.5">
                {stp.is_root_bridge && <Badge variant="outline" className="text-[10px] border-emerald-400 text-emerald-700 bg-emerald-50">ROOT BRIDGE</Badge>}
                {stp.protocol && <Badge variant="outline" className="text-[10px]">{stp.protocol.toUpperCase()}</Badge>}
              </span>
            }>
            <dl className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <InfoRow label="Bridge ID" value={stp.bridge_id ?? null} mono />
              <InfoRow label="Root Bridge ID" value={stp.root_bridge_id ?? null} mono />
              <InfoRow label="Priority" value={stp.priority != null ? String(stp.priority) : null} />
              <InfoRow label="Root cost" value={stp.root_cost != null ? String(stp.root_cost) : null} />
              <InfoRow label="Root port" value={stp.root_port ?? null} />
              <InfoRow label="Hello time" value={stp.hello_time_s != null ? `${stp.hello_time_s}s` : null} />
              <InfoRow label="Forward delay" value={stp.forward_delay_s != null ? `${stp.forward_delay_s}s` : null} />
              <InfoRow label="Max age" value={stp.max_age_s != null ? `${stp.max_age_s}s` : null} />
            </dl>
          </Section>
        );
      })()}

      {/* ─── 3b. Porte switch (solo per switch) ─── */}
      {device?.switch_ports && device.switch_ports.length > 0 && (
        <Section icon={<Cable className="h-4 w-4" />} title="Porte switch"
          badge={<Badge variant="outline" className="ml-2 text-[10px]">{device.switch_ports.length}</Badge>}>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-[10px] uppercase tracking-wider text-muted-foreground border-b">
                <tr><th className="text-left py-1.5 pr-3">Porta</th><th className="text-left pr-3">VLAN</th><th className="text-left pr-3">Status</th><th className="text-left">Host linkato</th></tr>
              </thead>
              <tbody>
                {device.switch_ports.slice(0, 100).map((p) => (
                  <tr key={p.id} className="border-b border-border/30 last:border-0">
                    <td className="py-1 pr-3 font-mono">{p.port_name}</td>
                    <td className="pr-3">{p.vlan ?? "—"}</td>
                    <td className="pr-3">
                      {p.status && (
                        <Badge variant="outline" className={`text-[10px] ${p.status === "up" ? "border-emerald-400 text-emerald-700 bg-emerald-50" : "text-muted-foreground"}`}>
                          {p.status}
                        </Badge>
                      )}
                      {p.speed && <span className="text-[10px] text-muted-foreground ml-1.5">{p.speed}</span>}
                    </td>
                    <td className="font-mono">{p.host_id ? <Link href={`/objects/${p.host_id}`} className="text-primary hover:underline">#{p.host_id}</Link> : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {device.switch_ports.length > 100 && (
              <p className="text-[10px] text-muted-foreground mt-2">Mostrate prime 100 di {device.switch_ports.length}</p>
            )}
          </div>
        </Section>
      )}

      {/* ─── 3c. MAC port table (switch) ─── */}
      {device?.mac_port_entries && device.mac_port_entries.length > 0 && (
        <Section icon={<TableIcon className="h-4 w-4" />} title="MAC table (switch)"
          badge={<Badge variant="outline" className="ml-2 text-[10px]">{device.mac_port_entries.length}</Badge>}>
          <div className="overflow-x-auto max-h-96">
            <table className="w-full text-xs">
              <thead className="text-[10px] uppercase tracking-wider text-muted-foreground border-b sticky top-0 bg-background">
                <tr>
                  <th className="text-left py-1.5 pr-3">MAC</th>
                  <th className="text-left pr-3">Porta</th>
                  <th className="text-left pr-3">VLAN</th>
                  <th className="text-left">Host collegato</th>
                </tr>
              </thead>
              <tbody>
                {device.mac_port_entries.slice(0, 200).map((m) => (
                  <tr key={m.id} className="border-b border-border/30 last:border-0">
                    <td className="py-1 pr-3 font-mono">{m.mac}</td>
                    <td className="pr-3 font-mono">{m.port_name}</td>
                    <td className="pr-3">{m.vlan ?? "—"}</td>
                    <td className="text-xs">
                      {m.host_ip || m.host_name ? (
                        <span>
                          <span className="font-mono">{m.host_ip ?? ""}</span>
                          {m.host_name && <span className="text-muted-foreground ml-1">· {m.host_name}</span>}
                        </span>
                      ) : (
                        <span className="text-muted-foreground/50">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {device.mac_port_entries.length > 200 && (
              <p className="text-[10px] text-muted-foreground mt-2">Mostrate prime 200 di {device.mac_port_entries.length}</p>
            )}
          </div>
        </Section>
      )}

      {/* ─── 3d. ARP table (router) ─── */}
      {device?.arp_entries && device.arp_entries.length > 0 && (
        <Section icon={<TableIcon className="h-4 w-4" />} title="ARP table (router)"
          badge={<Badge variant="outline" className="ml-2 text-[10px]">{device.arp_entries.length}</Badge>}>
          <div className="overflow-x-auto max-h-96">
            <table className="w-full text-xs">
              <thead className="text-[10px] uppercase tracking-wider text-muted-foreground border-b sticky top-0 bg-background">
                <tr><th className="text-left py-1.5 pr-3">IP</th><th className="text-left pr-3">MAC</th><th className="text-left pr-3">Interfaccia</th><th className="text-left">Hostname</th></tr>
              </thead>
              <tbody>
                {device.arp_entries.slice(0, 200).map((a) => (
                  <tr key={a.id} className="border-b border-border/30 last:border-0">
                    <td className="py-1 pr-3 font-mono">{a.ip ?? "—"}</td>
                    <td className="pr-3 font-mono">{a.mac}</td>
                    <td className="pr-3">{a.interface_name ?? "—"}</td>
                    <td>{a.hostname ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {device.arp_entries.length > 200 && (
              <p className="text-[10px] text-muted-foreground mt-2">Mostrate prime 200 di {device.arp_entries.length}</p>
            )}
          </div>
        </Section>
      )}

      {/* ─── 3e. Routing table (router) ─── */}
      {device?.routes && device.routes.length > 0 && (
        <Section icon={<Route className="h-4 w-4" />} title="Routing table"
          badge={<Badge variant="outline" className="ml-2 text-[10px]">{device.routes.length}</Badge>}>
          <div className="overflow-x-auto max-h-96">
            <table className="w-full text-xs">
              <thead className="text-[10px] uppercase tracking-wider text-muted-foreground border-b sticky top-0 bg-background">
                <tr><th className="text-left py-1.5 pr-3">Destinazione</th><th className="text-left pr-3">Gateway</th><th className="text-left pr-3">Interfaccia</th><th className="text-left pr-3">Protocollo</th><th className="text-left">Distanza</th></tr>
              </thead>
              <tbody>
                {device.routes.slice(0, 200).map((r, i) => (
                  <tr key={r.id ?? i} className="border-b border-border/30 last:border-0">
                    <td className="py-1 pr-3 font-mono">{r.destination ?? "—"}</td>
                    <td className="pr-3 font-mono">{r.gateway ?? "—"}</td>
                    <td className="pr-3">{r.interface_name ?? "—"}</td>
                    <td className="pr-3">{r.protocol ?? "—"}</td>
                    <td>{r.distance ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {device.routes.length > 200 && (
              <p className="text-[10px] text-muted-foreground mt-2">Mostrate prime 200 di {device.routes.length}</p>
            )}
          </div>
        </Section>
      )}

      {/* ─── 3e-bis. DHCP leases (router/firewall) ─── */}
      {device?.dhcp_leases && device.dhcp_leases.length > 0 && (
        <Section icon={<TableIcon className="h-4 w-4" />} title="DHCP leases"
          badge={<Badge variant="outline" className="ml-2 text-[10px]">{device.dhcp_leases.length}</Badge>}>
          <div className="overflow-x-auto max-h-96">
            <table className="w-full text-xs">
              <thead className="text-[10px] uppercase tracking-wider text-muted-foreground border-b sticky top-0 bg-background">
                <tr>
                  <th className="text-left py-1.5 pr-3">IP</th>
                  <th className="text-left pr-3">MAC</th>
                  <th className="text-left pr-3">Hostname</th>
                  <th className="text-left pr-3">Status</th>
                  <th className="text-left pr-3">Server</th>
                  <th className="text-left pr-3">Tipo</th>
                  <th className="text-left">Scade</th>
                </tr>
              </thead>
              <tbody>
                {device.dhcp_leases.slice(0, 200).map((l, i) => (
                  <tr key={l.id ?? i} className="border-b border-border/30 last:border-0">
                    <td className="py-1 pr-3 font-mono">{l.ip}</td>
                    <td className="pr-3 font-mono">{l.mac}</td>
                    <td className="pr-3">{l.hostname ?? "—"}</td>
                    <td className="pr-3">
                      {l.status && (
                        <Badge variant="outline" className={`text-[10px] ${l.status === "bound" || l.status === "active" ? "border-emerald-400 text-emerald-700 bg-emerald-50" : "text-muted-foreground"}`}>
                          {l.status}
                        </Badge>
                      )}
                    </td>
                    <td className="pr-3 text-[10px] text-muted-foreground">{l.server ?? "—"}</td>
                    <td className="pr-3 text-[10px]">{l.lease_type ?? "—"}</td>
                    <td className="text-[10px]">{l.expires_at ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {device.dhcp_leases.length > 200 && (
              <p className="text-[10px] text-muted-foreground mt-2">Mostrate prime 200 di {device.dhcp_leases.length}</p>
            )}
          </div>
        </Section>
      )}

      {/* ─── 3f. Neighbors LLDP/CDP ─── */}
      {device?.neighbors && device.neighbors.length > 0 && (
        <Section icon={<Radio className="h-4 w-4" />} title="Neighbors LLDP/CDP"
          badge={<Badge variant="outline" className="ml-2 text-[10px]">{device.neighbors.length}</Badge>}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {device.neighbors.map((n, i) => (
              <div key={n.id ?? i} className="text-xs border rounded px-2 py-1.5">
                <div className="font-mono font-medium">{n.neighbor_name ?? n.neighbor_address ?? "?"}</div>
                <div className="text-muted-foreground text-[11px] mt-0.5">
                  {n.interface_name && `Locale: ${n.interface_name}`}
                  {n.neighbor_port && ` → Remoto: ${n.neighbor_port}`}
                  {n.protocol && (
                    <Badge variant="outline" className="ml-1.5 text-[9px] py-0">{n.protocol}</Badge>
                  )}
                </div>
                {n.neighbor_platform && (
                  <div className="text-muted-foreground text-[11px] truncate" title={n.neighbor_platform}>
                    {n.neighbor_platform}
                  </div>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

        </TabsContent>

        {/* ═══════════════ TAB: SICUREZZA & ASSET ═══════════════ */}
        <TabsContent value="vulnerabilita" className="space-y-4">

      {/* ─── 4. Vulnerabilità (sempre, anche se vuoto) ─── */}
      <Section icon={<Shield className="h-4 w-4" />} title="Vulnerabilità">
        <HostVulnerabilitiesCard hostId={host.id} />
      </Section>

        </TabsContent>

        {/* ═══════════════ TAB: SOFTWARE ═══════════════ */}
        <TabsContent value="software" className="space-y-4">

      {/* ─── 4. Software inventory (solo se device + windows/linux) ─── */}
      {isManaged && isWindowsOrLinux && device && (
        <Section icon={<HardDrive className="h-4 w-4" />} title="Software installato">
          <DeviceSoftwareCard deviceId={device.id} osHint={device.vendor as "windows" | "linux"} />
        </Section>
      )}
      {isManaged && !isWindowsOrLinux && (
        <Section icon={<HardDrive className="h-4 w-4" />} title="Software installato">
          <p className="text-sm text-muted-foreground">
            Inventario software non applicabile per vendor <Badge variant="outline">{device?.vendor}</Badge>.
            Disponibile solo per device <Badge variant="outline">windows</Badge> o <Badge variant="outline">linux</Badge>.
          </p>
        </Section>
      )}
      {!isManaged && (host.classification === "server_windows" || host.classification === "server_linux" || host.classification === "workstation") && (
        <Section icon={<HardDrive className="h-4 w-4" />} title="Software installato">
          <p className="text-sm text-muted-foreground">
            Per scansionare il software, promuovi prima questo host a device gestito da Discovery
            (selezione → &quot;Aggiungi a dispositivi&quot;).
          </p>
        </Section>
      )}

        </TabsContent>

        {/* ═══════════════ TAB: ASSET & CREDENZIALI ═══════════════ */}
        <TabsContent value="asset" className="space-y-4">

      {/* ─── 5. Asset NIS2 (solo se asset linkato) ─── */}
      {isAsset && asset && (
        <Section icon={<PackagePlus className="h-4 w-4" />} title="Asset NIS2"
          badge={<Badge variant="outline" className="ml-2 text-[10px]">{asset.asset_tag ?? `#${asset.id}`}</Badge>}>
          <dl className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <InfoRow label="Categoria NIS2" value={asset.categoria_nis2 ?? null} />
            <InfoRow label="Criticità NIS2" value={asset.criticita_nis2 ?? null} />
            <InfoRow label="Categoria" value={asset.categoria ?? null} />
            <InfoRow label="Stato" value={asset.stato ?? null} />
            <InfoRow label="Sede" value={asset.sede ?? null} />
            <InfoRow label="Reparto" value={asset.reparto ?? null} />
            <InfoRow label="Posizione fisica" value={asset.posizione_fisica ?? null} />
            <InfoRow label="Asset tag" value={asset.asset_tag ?? null} mono />
          </dl>
          <div className="mt-3">
            <Button variant="link" size="sm" nativeButton={false} render={<Link href={`/inventory/${asset.id}`} />}>
              Apri dettaglio asset completo →
            </Button>
          </div>
        </Section>
      )}

      {/* ─── 6. Credenziali e gestione (solo se host promosso a device) ─── */}
      {isManaged && device && (
        <Section icon={<KeyRound className="h-4 w-4" />} title="Credenziali e gestione"
          badge={<Badge variant="outline" className="ml-2 text-[10px]">{device.protocol}</Badge>}>
          <dl className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-3">
            <InfoRow label="Device name" value={device.name} />
            <InfoRow label="Vendor" value={device.vendor} />
            <InfoRow label="Protocollo" value={device.protocol} />
            <InfoRow label="Porta" value={String(device.port)} mono />
            <InfoRow label="Scan target" value={device.scan_target ?? null} />
            <InfoRow label="Sysname (SNMP)" value={device.sysname} />
            <InfoRow label="Modello" value={device.model} />
            <InfoRow label="Firmware" value={device.firmware} />
          </dl>
          {host.host_credentials && host.host_credentials.length > 0 && (
            <>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-2">
                Credenziali validate
              </div>
              <div className="flex flex-wrap gap-2">
                {host.host_credentials.map((hc) => (
                  <Badge key={hc.id} variant="outline" className="font-mono text-xs">
                    {hc.credential_name} · {hc.protocol_type}:{hc.port}
                    {hc.validated === 1 && <span className="ml-1 text-emerald-600">✓</span>}
                  </Badge>
                ))}
              </div>
            </>
          )}
          <div className="mt-3">
            <Button variant="link" size="sm" nativeButton={false} render={<Link href={`/devices/${device.id}`} />}>
              Apri dettaglio device completo →
            </Button>
          </div>
        </Section>
      )}
      {!isManaged && (
        <Section icon={<KeyRound className="h-4 w-4" />} title="Credenziali e gestione">
          <p className="text-sm text-muted-foreground">
            Host non ancora promosso a device gestito.
            Da Discovery seleziona questo host → &quot;Aggiungi a dispositivi&quot; per assegnare credenziali e
            abilitare le scansioni di acquisizione dati.
          </p>
        </Section>
      )}

        </TabsContent>

        {/* ═══════════════ TAB: STORICO ═══════════════ */}
        <TabsContent value="storico" className="space-y-4">

      {/* ─── v0.2.604: Disponibilità (uptime + latenza) ─── spostata qui dal tab Generale.
          È un indicatore di stato storico, non un tool di monitoraggio: secondario. */}
      <Section icon={<Activity className="h-4 w-4" />} title="Disponibilità storica">
        <div className="space-y-4">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5">Uptime nel tempo</div>
            <UptimeTimeline hostId={host.id} />
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5">Latenza ICMP (ms)</div>
            <LatencyChart hostId={host.id} />
          </div>
        </div>
      </Section>

      {/* ─── 7. Discovery ─── */}
      <Section icon={<ScanSearch className="h-4 w-4" />} title="Discovery">
        <dl className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-3">
          <InfoRow label="First seen" value={formatDate(host.first_seen)} />
          <InfoRow label="Last seen" value={formatDate(host.last_seen)} />
          <InfoRow label="Known host" value={host.known_host ? "Sì" : "No"} />
          <InfoRow label="Response time" value={host.last_response_time_ms ? `${host.last_response_time_ms}ms` : null} />
        </dl>
        {(() => {
          const tcp = parsePorts(host.open_ports);
          return tcp.length > 0 ? (
            <>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-2">
                Porte aperte ({tcp.length})
              </div>
              <div className="flex flex-wrap gap-1.5">
                {tcp.slice(0, 50).map((p) => (
                  <Badge key={p} variant="outline" className="font-mono text-[10px]">{p}</Badge>
                ))}
                {tcp.length > 50 && (
                  <Badge variant="outline" className="text-[10px]">+{tcp.length - 50}</Badge>
                )}
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Nessuna porta aperta registrata.</p>
          );
        })()}
      </Section>

      {/* ─── 8. Cronologia ─── */}
      <Section icon={<Activity className="h-4 w-4" />} title="Cronologia scansioni">
        {host.recent_scans && host.recent_scans.length > 0 ? (
          <div className="space-y-1.5">
            {host.recent_scans.slice(0, 10).map((s) => (
              <div key={s.id} className="text-xs flex items-center gap-3 font-mono">
                <span className="text-muted-foreground">{formatDate(s.timestamp)}</span>
                <Badge variant="outline" className="text-[10px]">{s.scan_type}</Badge>
                <span className={s.status === "online" ? "text-emerald-600" : "text-muted-foreground"}>
                  {s.status}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Nessuna scansione registrata.</p>
        )}
      </Section>

        </TabsContent>
      </Tabs>

      {/* Spazio in fondo per scroll comodo */}
      <div className="h-8" />

      {/* F3.3: modale promozione inline — niente più redirect cross-pagina. */}
      {host && !isManaged && (
        <PromoteHostDialog
          host={host as HostDetail}
          open={promoteOpen}
          onOpenChange={setPromoteOpen}
          onCreated={() => { setPromoteOpen(false); fetchAll(); }}
        />
      )}

      {/* v0.2.594+: modale link manuale multi-IP allo stesso physical_device */}
      {host && (
        <LinkIpsDialog
          open={linkDialogOpen}
          onOpenChange={setLinkDialogOpen}
          anchorHostId={host.id}
          anchorHostLabel={host.hostname || host.ip}
          onLinked={() => { void fetchAll(); void fetchClusterMembers(); }}
        />
      )}

      {/* v0.2.599: modale edit device inline (sostituisce navigazione a /devices/[id]).
          /devices/[id] resta accessibile direct, ma il pulsante "Modifica device"
          della scheda asset ora apre questo dialog → niente più perdita dei tab. */}
      {device && (
        <EditDeviceDialog
          device={device}
          open={editDeviceOpen}
          onOpenChange={setEditDeviceOpen}
          onSaved={() => { setEditDeviceOpen(false); void fetchAll(); }}
        />
      )}

    </div>
  );
}
