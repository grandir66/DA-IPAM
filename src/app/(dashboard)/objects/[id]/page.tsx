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

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { StatusBadge } from "@/components/shared/status-badge";
import { HostVulnerabilitiesCard } from "@/components/hosts/host-vulnerabilities-card";
import { DeviceSoftwareCard } from "@/components/hosts/host-software-card";
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
  Table as TableIcon,
  Server,
  Layers,
} from "lucide-react";
import { toast } from "sonner";
import type { HostDetail, InventoryAsset, NetworkDevice, ArpEntry, MacPortEntry, SwitchPort } from "@/types";

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
}

type DeviceFull = NetworkDevice & DeviceExtras;
import { getClassificationLabel } from "@/lib/device-classifications";

// ─── Helpers ────────────────────────────────────────────────────────

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("it-IT", {
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
 * Subset dei dati di `network_devices.last_device_info_json` rilevanti per la
 * pagina oggetto: utenti, servizi, dischi (logici + fisici).
 */
interface DeviceInfoJson {
  disks?: Array<{ device?: string; size_gb?: number; free_gb?: number; filesystem?: string; label?: string }>;
  physical_disks?: Array<{ device?: string; model?: string; size_gb?: number; serial?: string; interface_type?: string; vendor?: string }>;
  important_services?: Array<{ name?: string; display_name?: string; state?: string; start_mode?: string }>;
  local_users?: Array<{ name?: string; full_name?: string; disabled?: boolean }>;
  logged_on_users?: Array<{ username?: string; session_type?: string; logon_time?: string }>;
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
}

function Section({ icon, title, badge, children }: SectionProps) {
  return (
    <Card className="overflow-hidden">
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
  const hostId = typeof params.id === "string" ? Number(params.id) : NaN;

  const [host, setHost] = useState<HostDetail | null>(null);
  const [device, setDevice] = useState<DeviceFull | null>(null);
  const [asset, setAsset] = useState<InventoryAsset | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchAll = useCallback(async () => {
    if (!Number.isFinite(hostId) || hostId <= 0) {
      router.push("/discovery");
      return;
    }
    try {
      const hRes = await fetch(`/api/hosts/${hostId}`);
      if (!hRes.ok) {
        toast.error(`Host ${hostId} non trovato`);
        router.push("/discovery");
        return;
      }
      const h = (await hRes.json()) as HostDetail;
      setHost(h);
      // Device linkato (per IP)
      if (h.network_device?.id) {
        const dRes = await fetch(`/api/devices/${h.network_device.id}`);
        if (dRes.ok) setDevice((await dRes.json()) as DeviceFull);
      }
      // Asset linkato (per host_id)
      const aRes = await fetch(`/api/inventory?host_id=${hostId}`);
      if (aRes.ok) {
        const list = (await aRes.json()) as InventoryAsset[];
        if (Array.isArray(list) && list.length > 0) setAsset(list[0]);
      }
    } finally {
      setLoading(false);
    }
  }, [hostId, router]);

  useEffect(() => { void fetchAll(); }, [fetchAll]);

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
        // attende polling completion
        await new Promise<void>((resolve) => {
          const poll = setInterval(async () => {
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
            } catch { /* ignore */ }
          }, 1500);
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
  const classificationLabel = host.classification ? getClassificationLabel(host.classification) : null;
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
                onClick={handleUpdateAll}
                disabled={refreshing}
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
            <Button variant="outline" nativeButton={false} render={<Link href={`/hosts/${host.id}`} />}>
              <Pencil className="h-4 w-4 mr-2" />
              Modifica
            </Button>
          </div>
        </div>
      </div>

      {/* ─── 1. Identità ─── */}
      <Section icon={<Cpu className="h-4 w-4" />} title="Identità">
        <dl className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <InfoRow label="IP" value={host.ip} mono />
          <InfoRow label="MAC" value={host.mac} mono />
          <InfoRow label="Hostname" value={host.hostname} />
          <InfoRow label="DNS reverse" value={host.dns_reverse} />
          <InfoRow label="Vendor (MAC OUI)" value={host.vendor} />
          <InfoRow label="Manufacturer" value={host.device_manufacturer} />
          <InfoRow label="OS" value={host.os_info} />
          <InfoRow label="Classification" value={classificationLabel} />
          {host.model && <InfoRow label="Modello" value={host.model} />}
          {host.serial_number && <InfoRow label="Seriale" value={host.serial_number} mono />}
          {host.firmware && <InfoRow label="Firmware" value={host.firmware} />}
          {host.ip_assignment && <InfoRow label="IP assignment" value={host.ip_assignment} />}
        </dl>
      </Section>

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
      </Section>

      {/* ─── 3. Hardware e sistema (solo se device gestito ha dati JSON) ─── */}
      {(() => {
        const di = device?.device_info ?? null;
        if (!di) return null;
        const hasContent = !!(
          di.disks?.length || di.physical_disks?.length ||
          di.important_services?.length || di.local_users?.length || di.logged_on_users?.length
        );
        if (!hasContent) return null;
        return (
          <Section icon={<ServerCog className="h-4 w-4" />} title="Hardware e sistema">
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
            <div className="space-y-4">
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
            </div>
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

      {/* ─── 4. Vulnerabilità (sempre, anche se vuoto) ─── */}
      <Section icon={<Shield className="h-4 w-4" />} title="Vulnerabilità">
        <HostVulnerabilitiesCard hostId={host.id} />
      </Section>

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

      {/* Spazio in fondo per scroll comodo */}
      <div className="h-8" />

    </div>
  );
}
