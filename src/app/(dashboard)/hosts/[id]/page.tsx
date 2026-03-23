"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader,
  DialogScrollableArea, DialogTitle, DIALOG_PANEL_COMPACT_CLASS,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { StatusBadge } from "@/components/shared/status-badge";
import { formatPortsDisplay } from "@/lib/utils";
import {
  DEVICE_CLASSIFICATIONS_ORDERED, getClassificationLabel, sortClassificationsByDisplayLabel,
} from "@/lib/device-classifications";
import { UptimeTimeline } from "@/components/shared/uptime-timeline";
import { Switch } from "@/components/ui/switch";
import { DeviceCredentialsTable } from "@/components/shared/device-credentials-table";
import {
  ArrowLeft, Save, Router, Cable, Trash2, Server, ChevronRight,
  ScanSearch, PlusCircle, Wifi, Cpu, HardDrive, Monitor, Globe, Activity,
} from "lucide-react";
import { toast } from "sonner";
import type { DeviceFingerprintSnapshot, HostDetail, HostSnmpData } from "@/types";
import { getDefaultNetworkDeviceVendorOptions } from "@/lib/network-device-vendor-options";
import { LatencyChart } from "./latency-chart";

// ─── Helpers ────────────────────────────────────────────────────────

const VENDOR_FROM_MANUFACTURER: Record<string, string> = {
  proxmox: "proxmox", vmware: "vmware",
  mikrotik: "mikrotik", ubiquiti: "ubiquiti", cisco: "cisco",
  juniper: "other", huawei: "other",
  hpe: "hp", "hp ": "hp", aruba: "hp",
  synology: "synology", qnap: "qnap",
  windows: "windows", linux: "linux",
};

function inferVendorFromManufacturer(m: string | null): string {
  if (!m) return "other";
  const lower = m.toLowerCase();
  for (const [key, val] of Object.entries(VENDOR_FROM_MANUFACTURER)) {
    if (lower.includes(key)) return val;
  }
  return "other";
}

function inferDeviceTypeFromClassification(c: string): "router" | "switch" | "hypervisor" {
  if (c === "router" || c === "firewall") return "router";
  if (c === "switch") return "switch";
  return "hypervisor";
}

function inferProtocolFromSnmp(snmp: HostSnmpData | null): string {
  return snmp ? "snmp_v2" : "ssh";
}

const HOST_CLASSIFICATION_OPTIONS_SORTED = sortClassificationsByDisplayLabel(DEVICE_CLASSIFICATIONS_ORDERED);
const CREATE_DEVICE_CLASSIFICATION_OPTIONS = sortClassificationsByDisplayLabel(
  DEVICE_CLASSIFICATIONS_ORDERED.filter((c) => c !== "unknown")
);
const CREATE_DEVICE_PROTOCOL_OPTIONS = [
  { value: "ssh", label: "SSH" }, { value: "snmp_v2", label: "SNMP v2" },
  { value: "snmp_v3", label: "SNMP v3" }, { value: "api", label: "API REST" },
  { value: "winrm", label: "WinRM" },
].sort((a, b) => a.label.localeCompare(b.label, "it", { sensitivity: "base" }));
const CREATE_DEVICE_TYPE_OPTIONS = [
  { value: "router", label: "Router / Firewall" },
  { value: "switch", label: "Switch" },
  { value: "hypervisor", label: "Hypervisor / Server" },
].sort((a, b) => a.label.localeCompare(b.label, "it", { sensitivity: "base" }));

function InfoItem({ label, value, mono, badge, alwaysShow }: { label: string; value: string | null | undefined; mono?: boolean; badge?: boolean; alwaysShow?: boolean }) {
  if (!value && !alwaysShow) return null;
  const display = value || "—";
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-muted-foreground uppercase tracking-wider">{label}</dt>
      {badge ? (
        <dd className="mt-0.5"><Badge variant="secondary" className="text-xs">{display}</Badge></dd>
      ) : (
        <dd className={`text-sm mt-0.5 truncate ${mono ? "font-mono" : ""} ${!value ? "text-muted-foreground" : ""}`} title={display}>{display}</dd>
      )}
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────

export default function HostDetailPage() {
  const params = useParams();
  const router = useRouter();
  const [host, setHost] = useState<HostDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    custom_name: "", classification: "", inventory_code: "",
    notes: "", known_host: 0 as 0 | 1, monitor_ports: "",
  });
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [createDeviceOpen, setCreateDeviceOpen] = useState(false);
  const [creatingDevice, setCreatingDevice] = useState(false);
  const [deviceForm, setDeviceForm] = useState({
    name: "", vendor: "other", protocol: "ssh",
    device_type: "hypervisor" as "router" | "switch" | "hypervisor",
    classification: "", port: 22,
    model: "", serial_number: "", firmware: "",
    sysname: "", sysdescr: "", community_string: "",
  });

  const fetchHost = useCallback(async () => {
    const id = params.id;
    if (!id || typeof id !== "string" || !/^\d+$/.test(id)) { setLoading(false); router.push("/devices"); return; }
    const res = await fetch(`/api/hosts/${id}`);
    if (!res.ok) { router.push("/devices"); return; }
    const data = await res.json();
    if (data?.error || !data?.id) { setLoading(false); router.push("/devices"); return; }
    setHost(data);
    let monitorPortsStr = "";
    if (data.monitor_ports) {
      try { const arr = JSON.parse(data.monitor_ports); if (Array.isArray(arr)) monitorPortsStr = arr.join(", "); } catch { /* ignore */ }
    }
    setForm({
      custom_name: data.custom_name || "", classification: data.classification || "",
      inventory_code: data.inventory_code || "", notes: data.notes || "",
      known_host: (data.known_host ?? 0) ? 1 : 0, monitor_ports: monitorPortsStr,
    });
    setLoading(false);
  }, [params.id, router]);

  useEffect(() => { fetchHost(); }, [fetchHost]);

  async function handleSave() {
    setSaving(true);
    const { known_host, monitor_ports, ...rest } = form;
    let monitorPortsJson: string | null = null;
    if (monitor_ports.trim()) {
      const ports = monitor_ports.split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n) && n >= 1 && n <= 65535);
      if (ports.length > 0) monitorPortsJson = JSON.stringify(ports);
    }
    const res = await fetch(`/api/hosts/${params.id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...rest, known_host, monitor_ports: monitorPortsJson }),
    });
    if (res.ok) { toast.success("Host aggiornato"); fetchHost(); }
    else toast.error("Errore nell'aggiornamento");
    setSaving(false);
  }

  async function handleDelete() {
    setDeleting(true);
    const res = await fetch(`/api/hosts/${params.id}`, { method: "DELETE" });
    if (res.ok) { toast.success("Host eliminato"); router.push(`/networks/${host!.network_id}`); }
    else { const data = await res.json(); toast.error(data.error || "Errore"); }
    setDeleting(false); setDeleteOpen(false);
  }

  function openCreateDevice() {
    if (!host) return;
    let snmp: HostSnmpData | null = null;
    try { if (host.snmp_data) snmp = JSON.parse(host.snmp_data) as HostSnmpData; } catch { /* ignore */ }
    const vendor = inferVendorFromManufacturer(snmp?.manufacturer ?? host.device_manufacturer ?? null);
    const protocol = inferProtocolFromSnmp(snmp);
    const device_type = inferDeviceTypeFromClassification(host.classification);
    setDeviceForm({
      name: snmp?.sysName || host.custom_name || host.hostname || host.ip,
      vendor, protocol, device_type,
      classification: host.classification !== "unknown" ? host.classification : "",
      port: protocol === "snmp_v2" ? 161 : 22,
      model: snmp?.model || host.model || "", serial_number: snmp?.serialNumber || host.serial_number || "",
      firmware: snmp?.firmware || host.firmware || "", sysname: snmp?.sysName || host.hostname || "",
      sysdescr: snmp?.sysDescr || host.os_info || "", community_string: snmp?.community || "",
    });
    setCreateDeviceOpen(true);
  }

  async function handleCreateDevice(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!host) return;
    setCreatingDevice(true);
    const body = {
      name: deviceForm.name, host: host.ip, device_type: deviceForm.device_type,
      vendor: deviceForm.vendor, protocol: deviceForm.protocol, port: deviceForm.port,
      classification: deviceForm.classification || undefined,
      model: deviceForm.model || undefined, serial_number: deviceForm.serial_number || undefined,
      firmware: deviceForm.firmware || undefined, sysname: deviceForm.sysname || undefined,
      sysdescr: deviceForm.sysdescr || undefined, community_string: deviceForm.community_string || undefined,
    };
    const res = await fetch("/api/devices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (res.ok) { toast.success("Dispositivo creato"); setCreateDeviceOpen(false); fetchHost(); }
    else { const data = await res.json(); toast.error(data.error || "Errore"); }
    setCreatingDevice(false);
  }

  if (loading || !host) return <div className="text-muted-foreground">Caricamento...</div>;

  let snmp: HostSnmpData | null = null;
  try { if (host.snmp_data) snmp = JSON.parse(host.snmp_data) as HostSnmpData; } catch { /* ignore */ }
  let fp: DeviceFingerprintSnapshot | null = null;
  try { if (host.detection_json) fp = JSON.parse(host.detection_json) as DeviceFingerprintSnapshot; } catch { /* ignore */ }

  let parsedPorts: { port: number; protocol?: string; service?: string; version?: string }[] = [];
  try { if (host.open_ports) parsedPorts = JSON.parse(host.open_ports); } catch { /* ignore */ }
  parsedPorts.sort((a, b) => a.port - b.port);

  // Campi unificati: prende il meglio tra host.*, snmp.*, fp.*
  const displayName = host.custom_name || host.hostname || snmp?.sysName || host.ip;
  const displayModel = host.model || snmp?.model || null;
  const displaySerial = host.serial_number || snmp?.serialNumber || null;
  const displayFirmware = host.firmware || snmp?.firmware || null;
  const displayManufacturer = host.device_manufacturer || snmp?.manufacturer || null;
  const displayOs = host.os_info || snmp?.sysDescr || null;

  return (
    <div className="space-y-4">
      {/* ════════════════ HEADER ════════════════ */}
      <div className="flex items-start gap-3">
        <Link href={`/networks/${host.network_id}`}>
          <Button variant="ghost" size="icon" className="mt-1"><ArrowLeft className="h-4 w-4" /></Button>
        </Link>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-xl font-bold tracking-tight font-mono">{host.ip}</h1>
            <StatusBadge status={host.status} />
            {host.known_host === 1 && <Badge variant="secondary" className="text-xs">Conosciuto</Badge>}
            {fp?.final_device && (
              <Badge variant="outline" className="text-xs">
                {fp.final_device}
                {fp.final_confidence != null && ` ${(fp.final_confidence * 100).toFixed(0)}%`}
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">
            {displayName !== host.ip && <span className="font-medium text-foreground mr-2">{displayName}</span>}
            <Link href={`/networks/${host.network_id}`} className="text-primary hover:underline">{host.network_name}</Link>
            {" "}<span className="font-mono text-xs">({host.network_cidr})</span>
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {host.network_device ? (
            <Link href={`/devices/${host.network_device.id}`}>
              <Button variant="outline" size="sm" className="gap-1.5">
                <Server className="h-3.5 w-3.5" />Dispositivo<ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </Link>
          ) : (
            <Button variant="outline" size="sm" className="gap-1.5" onClick={openCreateDevice}>
              <PlusCircle className="h-3.5 w-3.5" />Crea dispositivo
            </Button>
          )}
          <Button variant="destructive" size="sm" onClick={() => setDeleteOpen(true)}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* ════════════════ IDENTITA + HARDWARE ════════════════ */}
      <Card>
        <CardContent className="pt-5">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-x-6 gap-y-3">
            <InfoItem label="MAC" value={host.mac} mono />
            <InfoItem label="Vendor MAC" value={host.vendor} />
            <InfoItem label="Hostname" value={host.hostname} />
            <InfoItem label="DNS Reverse" value={host.dns_reverse} mono />
            <InfoItem label="DNS Forward" value={host.dns_forward} mono />
            <InfoItem label="Classificazione" value={host.classification !== "unknown" ? getClassificationLabel(host.classification) : null} badge />
          </div>
          <Separator className="my-3" />
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-x-6 gap-y-3">
            <InfoItem label="Produttore" value={displayManufacturer} alwaysShow />
            <InfoItem label="Modello" value={displayModel} alwaysShow />
            <InfoItem label="Seriale" value={displaySerial} mono alwaysShow />
            <InfoItem label="Firmware" value={displayFirmware} mono alwaysShow />
            <InfoItem label="Sistema Operativo" value={displayOs} alwaysShow />
            {fp?.os_hint && <InfoItem label="OS (TTL)" value={fp.os_hint} />}
          </div>
          {(snmp?.sysUpTime || snmp?.hostResourcesSummary || snmp?.ifDescrSummary) && (
            <>
              <Separator className="my-3" />
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-x-6 gap-y-3">
                {snmp.sysUpTime && <InfoItem label="Uptime" value={snmp.sysUpTime} mono />}
                {snmp.arpEntryCount != null && <InfoItem label="Voci ARP" value={String(snmp.arpEntryCount)} />}
                {snmp.sysObjectID && <InfoItem label="sysObjectID" value={snmp.sysObjectID} mono />}
              </div>
              {snmp.hostResourcesSummary && (
                <div className="mt-2">
                  <dt className="text-[11px] text-muted-foreground uppercase tracking-wider mb-0.5">Risorse (SNMP)</dt>
                  <dd className="rounded-md bg-muted/60 px-2 py-1 font-mono text-xs break-words whitespace-pre-wrap">{snmp.hostResourcesSummary}</dd>
                </div>
              )}
              {snmp.ifDescrSummary && (
                <div className="mt-2">
                  <dt className="text-[11px] text-muted-foreground uppercase tracking-wider mb-0.5">Interfacce (SNMP)</dt>
                  <dd className="rounded-md bg-muted/60 px-2 py-1 font-mono text-xs break-words whitespace-pre-wrap">{snmp.ifDescrSummary}</dd>
                </div>
              )}
            </>
          )}
          <Separator className="my-3" />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-2">
            <InfoItem label="Primo rilevamento" value={host.first_seen ? new Date(host.first_seen).toLocaleString("it-IT") : null} />
            <InfoItem label="Ultimo contatto" value={host.last_seen ? new Date(host.last_seen).toLocaleString("it-IT") : null} />
            {snmp && <InfoItem label="SNMP raccolto" value={new Date(snmp.collected_at).toLocaleString("it-IT")} />}
            {fp?.generated_at && <InfoItem label="Fingerprint" value={new Date(fp.generated_at).toLocaleString("it-IT")} />}
          </div>
        </CardContent>
      </Card>

      {/* ════════════════ PORTE APERTE + CONNESSIONE RETE ════════════════ */}
      {(parsedPorts.length > 0 || host.arp_source || host.switch_port) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {parsedPorts.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2"><Globe className="h-3.5 w-3.5" />Porte aperte ({parsedPorts.length})</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-1">
                  {parsedPorts.map((p) => (
                    <Badge key={`${p.port}-${p.protocol || "tcp"}`} variant={p.protocol === "udp" ? "default" : "secondary"} className="text-[11px] font-mono gap-1">
                      {p.port}{p.protocol === "udp" ? "/UDP" : ""}
                      {p.service && <span className="font-normal text-muted-foreground">({p.service})</span>}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
          {(host.arp_source || host.switch_port) && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2"><Cable className="h-3.5 w-3.5" />Connessione di rete</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {host.arp_source && (
                  <div className="flex items-center gap-2 text-sm">
                    <Router className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span>ARP da <span className="font-medium">{host.arp_source.device_name}</span> ({host.arp_source.device_vendor})</span>
                  </div>
                )}
                {host.switch_port && (
                  <div className="flex items-center gap-2 text-sm">
                    <Cable className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span>
                      <span className="font-medium">{host.switch_port.device_name}</span> porta{" "}
                      <span className="font-mono font-medium">{host.switch_port.port_name}</span>
                      {host.switch_port.vlan && <> VLAN {host.switch_port.vlan}</>}
                    </span>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* ════════════════ CREDENZIALI (tabella come devices) ════════════════ */}
      {host.network_device && (
        <DeviceCredentialsTable deviceId={host.network_device.id} />
      )}

      {/* ════════════════ RILEVAMENTO AUTOMATICO (fingerprint compatto) ════════════════ */}
      {fp && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <ScanSearch className="h-3.5 w-3.5" />Rilevamento automatico
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex flex-wrap gap-2 items-center">
              {fp.detection_sources?.map((s) => (
                <Badge key={s} variant="outline" className="text-[10px]">{s}</Badge>
              ))}
              {fp.ttl != null && <span className="text-xs text-muted-foreground">TTL: {fp.ttl}</span>}
            </div>
            {fp.matches && fp.matches.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {fp.matches.slice(0, 5).map((m) => (
                  <Badge key={m.name} variant="secondary" className="text-[10px] gap-1">
                    {m.name} <span className="opacity-70">{(m.confidence * 100).toFixed(0)}%</span>
                  </Badge>
                ))}
              </div>
            )}
            {(fp.banner_ssh || fp.banner_http) && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {fp.banner_ssh && (
                  <div>
                    <dt className="text-[10px] text-muted-foreground">SSH</dt>
                    <dd className="rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[11px] truncate" title={fp.banner_ssh}>{fp.banner_ssh}</dd>
                  </div>
                )}
                {fp.banner_http && (
                  <div>
                    <dt className="text-[10px] text-muted-foreground">HTTP</dt>
                    <dd className="rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[11px] truncate" title={fp.banner_http}>{fp.banner_http}</dd>
                  </div>
                )}
              </div>
            )}
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Dati grezzi</summary>
              <pre className="mt-1 max-h-32 overflow-auto rounded bg-muted p-2 font-mono text-[10px]">{JSON.stringify(fp, null, 2)}</pre>
            </details>
          </CardContent>
        </Card>
      )}

      {/* ════════════════ CAMPI PERSONALIZZATI ════════════════ */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2"><Monitor className="h-3.5 w-3.5" />Gestione host</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Nome personalizzato</Label>
              <Input value={form.custom_name} onChange={(e) => setForm({ ...form, custom_name: e.target.value })} placeholder="Server Web" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Classificazione</Label>
              <Select value={form.classification || "__empty__"} onValueChange={(v) => setForm({ ...form, classification: v === "__empty__" ? "" : (v ?? "") })}>
                <SelectTrigger><SelectValue placeholder="Seleziona..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__empty__">— Nessuna —</SelectItem>
                  {HOST_CLASSIFICATION_OPTIONS_SORTED.map((c) => (
                    <SelectItem key={c} value={c}>{getClassificationLabel(c)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Codice inventario</Label>
              <Input value={form.inventory_code} onChange={(e) => setForm({ ...form, inventory_code: e.target.value })} placeholder="INV-2024-001" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Porte monitoraggio</Label>
              <Input value={form.monitor_ports} onChange={(e) => setForm({ ...form, monitor_ports: e.target.value })} placeholder="22, 80, 443" />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Note</Label>
              <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Note aggiuntive..." rows={2} />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <Label className="text-sm">Host conosciuto</Label>
                <p className="text-xs text-muted-foreground">Dispositivo verificato e monitorato</p>
              </div>
              <Switch checked={form.known_host === 1} onCheckedChange={(v) => setForm((f) => ({ ...f, known_host: v ? 1 : 0 }))} />
            </div>
          </div>
          <Button onClick={handleSave} disabled={saving} size="sm">
            <Save className="h-3.5 w-3.5 mr-1.5" />{saving ? "Salvataggio..." : "Salva modifiche"}
          </Button>
        </CardContent>
      </Card>

      {/* ════════════════ LATENZA + UPTIME ════════════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <LatencyChart hostId={host.id} />
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2"><Activity className="h-3.5 w-3.5" />Uptime</CardTitle>
          </CardHeader>
          <CardContent>
            <UptimeTimeline hostId={host.id} />
          </CardContent>
        </Card>
      </div>

      {/* ════════════════ STORICO SCANSIONI ════════════════ */}
      {host.recent_scans.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Storico scansioni ({host.recent_scans.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Stato</TableHead>
                  <TableHead>Porte</TableHead>
                  <TableHead>Durata</TableHead>
                  <TableHead>Data</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {host.recent_scans.slice(0, 20).map((scan) => (
                  <TableRow key={scan.id}>
                    <TableCell><Badge variant="outline" className="text-xs">{scan.scan_type}</Badge></TableCell>
                    <TableCell className="text-xs">{scan.status}</TableCell>
                    <TableCell className="font-mono text-xs">{formatPortsDisplay(scan.ports_open)}</TableCell>
                    <TableCell className="text-xs">{scan.duration_ms ? `${scan.duration_ms}ms` : "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{new Date(scan.timestamp).toLocaleString("it-IT")}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {host.recent_scans.length > 20 && (
              <p className="text-xs text-muted-foreground text-center py-2">Mostrate 20 di {host.recent_scans.length} scansioni</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* ════════════════ DIALOGS ════════════════ */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Eliminare host?</DialogTitle>
            <DialogDescription>L&apos;host <span className="font-mono font-medium">{host.ip}</span> verra rimosso definitivamente.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)} disabled={deleting}>Annulla</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>{deleting ? "Eliminazione..." : "Elimina"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={createDeviceOpen} onOpenChange={setCreateDeviceOpen}>
        <DialogContent className={DIALOG_PANEL_COMPACT_CLASS}>
          <DialogHeader className="shrink-0 border-b border-border/50 px-4 pt-4 pb-3">
            <DialogTitle>Crea dispositivo gestito — {host.ip}</DialogTitle>
            <DialogDescription>Campi pre-compilati da dati SNMP/scan.</DialogDescription>
          </DialogHeader>
          <DialogScrollableArea className="px-4 py-3">
          <form onSubmit={handleCreateDevice} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label className="text-xs">Nome</Label><Input required value={deviceForm.name} onChange={(e) => setDeviceForm((f) => ({ ...f, name: e.target.value }))} /></div>
              <div className="space-y-1"><Label className="text-xs">IP</Label><Input value={host.ip} readOnly className="bg-muted" /></div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1"><Label className="text-xs">Tipo</Label>
                <Select value={deviceForm.device_type} onValueChange={(v) => setDeviceForm((f) => ({ ...f, device_type: v as "router" | "switch" | "hypervisor" }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{CREATE_DEVICE_TYPE_OPTIONS.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1"><Label className="text-xs">Vendor</Label>
                <Select value={deviceForm.vendor} onValueChange={(v) => setDeviceForm((f) => ({ ...f, vendor: v ?? "other" }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{getDefaultNetworkDeviceVendorOptions().map((v) => <SelectItem key={v.value} value={v.value}>{v.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1"><Label className="text-xs">Protocollo</Label>
                <Select value={deviceForm.protocol} onValueChange={(v) => setDeviceForm((f) => ({ ...f, protocol: v ?? "ssh", port: v === "snmp_v2" || v === "snmp_v3" ? 161 : v === "winrm" ? 5985 : 22 }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{CREATE_DEVICE_PROTOCOL_OPTIONS.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1"><Label className="text-xs">Porta</Label><Input type="number" value={deviceForm.port} onChange={(e) => setDeviceForm((f) => ({ ...f, port: Number(e.target.value) }))} /></div>
              {(deviceForm.protocol === "snmp_v2" || deviceForm.protocol === "snmp_v3") && (
                <div className="space-y-1"><Label className="text-xs">Community</Label><Input value={deviceForm.community_string} onChange={(e) => setDeviceForm((f) => ({ ...f, community_string: e.target.value }))} placeholder="public" /></div>
              )}
              <div className="space-y-1"><Label className="text-xs">Classificazione</Label>
                <Select value={deviceForm.classification || ""} onValueChange={(v) => setDeviceForm((f) => ({ ...f, classification: v ?? "" }))}>
                  <SelectTrigger><SelectValue placeholder="Seleziona" /></SelectTrigger>
                  <SelectContent>{CREATE_DEVICE_CLASSIFICATION_OPTIONS.map((c) => <SelectItem key={c} value={c}>{getClassificationLabel(c)}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <Separator />
            <p className="text-xs text-muted-foreground font-medium">Dati inventario</p>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1"><Label className="text-xs">Modello</Label><Input value={deviceForm.model} onChange={(e) => setDeviceForm((f) => ({ ...f, model: e.target.value }))} /></div>
              <div className="space-y-1"><Label className="text-xs">Seriale</Label><Input value={deviceForm.serial_number} onChange={(e) => setDeviceForm((f) => ({ ...f, serial_number: e.target.value }))} /></div>
              <div className="space-y-1"><Label className="text-xs">Firmware</Label><Input value={deviceForm.firmware} onChange={(e) => setDeviceForm((f) => ({ ...f, firmware: e.target.value }))} /></div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateDeviceOpen(false)}>Annulla</Button>
              <Button type="submit" disabled={creatingDevice}>{creatingDevice ? "Creazione..." : "Crea dispositivo"}</Button>
            </DialogFooter>
          </form>
          </DialogScrollableArea>
        </DialogContent>
      </Dialog>
    </div>
  );
}
