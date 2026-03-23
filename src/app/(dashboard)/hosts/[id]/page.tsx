"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogScrollableArea,
  DialogTitle,
  DIALOG_PANEL_COMPACT_CLASS,
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
import { formatPortsDisplay } from "@/lib/utils";
import {
  DEVICE_CLASSIFICATIONS_ORDERED,
  getClassificationLabel,
  sortClassificationsByDisplayLabel,
} from "@/lib/device-classifications";
import { UptimeTimeline } from "@/components/shared/uptime-timeline";
import { Switch } from "@/components/ui/switch";
import { ArrowLeft, Save, Router, Cable, Trash2, Server, ChevronRight, ScanSearch, PlusCircle, Wifi, Key } from "lucide-react";
import { toast } from "sonner";
import type { DeviceFingerprintSnapshot, HostDetail, HostSnmpData } from "@/types";
import { getDefaultNetworkDeviceVendorOptions } from "@/lib/network-device-vendor-options";
import { LatencyChart } from "./latency-chart";

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
  { value: "ssh", label: "SSH" },
  { value: "snmp_v2", label: "SNMP v2" },
  { value: "snmp_v3", label: "SNMP v3" },
  { value: "api", label: "API REST" },
  { value: "winrm", label: "WinRM" },
].sort((a, b) => a.label.localeCompare(b.label, "it", { sensitivity: "base" }));

const CREATE_DEVICE_TYPE_OPTIONS = [
  { value: "router", label: "Router / Firewall" },
  { value: "switch", label: "Switch" },
  { value: "hypervisor", label: "Hypervisor / Server" },
].sort((a, b) => a.label.localeCompare(b.label, "it", { sensitivity: "base" }));

export default function HostDetailPage() {
  const params = useParams();
  const router = useRouter();
  const [host, setHost] = useState<HostDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    custom_name: "",
    classification: "",
    inventory_code: "",
    notes: "",
    known_host: 0 as 0 | 1,
    monitor_ports: "",
  });
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [createDeviceOpen, setCreateDeviceOpen] = useState(false);
  const [creatingDevice, setCreatingDevice] = useState(false);
  const [credentialList, setCredentialList] = useState<{ id: number; name: string; credential_type: string }[]>([]);
  const [detectDraft, setDetectDraft] = useState<Record<string, string>>({});
  const [savingDetectCreds, setSavingDetectCreds] = useState(false);
  const [deviceForm, setDeviceForm] = useState({
    name: "", vendor: "other", protocol: "ssh",
    device_type: "hypervisor" as "router" | "switch" | "hypervisor",
    classification: "", port: 22,
    model: "", serial_number: "", firmware: "",
    sysname: "", sysdescr: "", community_string: "",
  });

  const fetchHost = useCallback(async () => {
    const id = params.id;
    if (!id || typeof id !== "string" || !/^\d+$/.test(id)) {
      setLoading(false);
      router.push("/devices");
      return;
    }
    const res = await fetch(`/api/hosts/${id}`);
    if (!res.ok) {
      router.push("/devices");
      return;
    }
    const data = await res.json();
    if (data?.error || !data?.id) {
      setLoading(false);
      router.push("/devices");
      return;
    }
    setHost(data);
    // Parse monitor_ports JSON array to comma-separated string for display
    let monitorPortsStr = "";
    if (data.monitor_ports) {
      try {
        const arr = JSON.parse(data.monitor_ports);
        if (Array.isArray(arr)) monitorPortsStr = arr.join(", ");
      } catch { /* ignore */ }
    }
    setForm({
      custom_name: data.custom_name || "",
      classification: data.classification || "",
      inventory_code: data.inventory_code || "",
      notes: data.notes || "",
      known_host: (data.known_host ?? 0) ? 1 : 0,
      monitor_ports: monitorPortsStr,
    });
    setLoading(false);
  }, [params.id, router]);

  useEffect(() => {
    fetchHost();
  }, [fetchHost]);

  useEffect(() => {
    fetch("/api/credentials")
      .then((r) => (r.ok ? r.json() : []))
      .then(setCredentialList)
      .catch(() => setCredentialList([]));
  }, []);

  useEffect(() => {
    if (!host) return;
    const roles = ["windows", "linux", "ssh", "snmp"] as const;
    const d: Record<string, string> = {};
    for (const role of roles) {
      const row = host.detect_credentials?.find((x) => x.role === role);
      d[role] = row ? String(row.credential_id) : "none";
    }
    setDetectDraft(d);
  }, [host]);

  async function handleSave() {
    setSaving(true);
    const { known_host, monitor_ports, ...rest } = form;
    // Convert comma-separated ports to JSON array
    let monitorPortsJson: string | null = null;
    if (monitor_ports.trim()) {
      const ports = monitor_ports
        .split(",")
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => !isNaN(n) && n >= 1 && n <= 65535);
      if (ports.length > 0) {
        monitorPortsJson = JSON.stringify(ports);
      }
    }
    const res = await fetch(`/api/hosts/${params.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...rest, known_host, monitor_ports: monitorPortsJson }),
    });

    if (res.ok) {
      toast.success("Host aggiornato");
      fetchHost();
    } else {
      toast.error("Errore nell'aggiornamento");
    }
    setSaving(false);
  }

  function credentialsForDetectRole(role: string) {
    return credentialList
      .filter((c) => {
        if (role === "windows") return c.credential_type === "windows";
        if (role === "linux") return c.credential_type === "linux";
        if (role === "ssh") return c.credential_type === "ssh";
        if (role === "snmp") return c.credential_type === "snmp";
        return false;
      })
      .sort((a, b) => a.name.localeCompare(b.name, "it", { sensitivity: "base" }));
  }

  async function handleSaveDetectCredentials() {
    if (!host) return;
    setSavingDetectCreds(true);
    try {
      const detect_credentials: Record<string, number | null> = {};
      for (const role of ["windows", "linux", "ssh", "snmp"] as const) {
        const v = detectDraft[role];
        detect_credentials[role] = v && v !== "none" ? Number(v) : null;
      }
      const res = await fetch(`/api/hosts/${params.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ detect_credentials }),
      });
      if (res.ok) {
        toast.success("Credenziali per protocollo salvate");
        fetchHost();
      } else {
        const data = await res.json();
        toast.error(data.error || "Errore nel salvataggio");
      }
    } finally {
      setSavingDetectCreds(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    const res = await fetch(`/api/hosts/${params.id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("Host eliminato");
      router.push(`/networks/${host!.network_id}`);
    } else {
      const data = await res.json();
      toast.error(data.error || "Errore nell'eliminazione");
    }
    setDeleting(false);
    setDeleteOpen(false);
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
      vendor,
      protocol,
      device_type,
      classification: host.classification !== "unknown" ? host.classification : "",
      port: protocol === "snmp_v2" ? 161 : 22,
      model: snmp?.model || host.model || "",
      serial_number: snmp?.serialNumber || host.serial_number || "",
      firmware: snmp?.firmware || host.firmware || "",
      sysname: snmp?.sysName || host.hostname || "",
      sysdescr: snmp?.sysDescr || host.os_info || "",
      community_string: snmp?.community || "",
    });
    setCreateDeviceOpen(true);
  }

  async function handleCreateDevice(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!host) return;
    setCreatingDevice(true);
    const body = {
      name: deviceForm.name,
      host: host.ip,
      device_type: deviceForm.device_type,
      vendor: deviceForm.vendor,
      protocol: deviceForm.protocol,
      port: deviceForm.port,
      classification: deviceForm.classification || undefined,
      model: deviceForm.model || undefined,
      serial_number: deviceForm.serial_number || undefined,
      firmware: deviceForm.firmware || undefined,
      sysname: deviceForm.sysname || undefined,
      sysdescr: deviceForm.sysdescr || undefined,
      community_string: deviceForm.community_string || undefined,
    };
    const res = await fetch("/api/devices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      toast.success("Dispositivo creato");
      setCreateDeviceOpen(false);
      fetchHost();
    } else {
      const data = await res.json();
      toast.error(data.error || "Errore nella creazione");
    }
    setCreatingDevice(false);
  }

  if (loading || !host) {
    return <div className="text-muted-foreground">Caricamento...</div>;
  }

  let parsedSnmpData: HostSnmpData | null = null;
  try { if (host.snmp_data) parsedSnmpData = JSON.parse(host.snmp_data) as HostSnmpData; } catch { /* ignore */ }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Link href={`/networks/${host.network_id}`}>
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold tracking-tight font-mono">{host.ip}</h1>
            <StatusBadge status={host.status} />
          </div>
          <p className="text-muted-foreground mt-1">
            Rete: <Link href={`/networks/${host.network_id}`} className="text-primary hover:underline">{host.network_name}</Link>
            {" "}<span className="font-mono text-xs">({host.network_cidr})</span>
          </p>
        </div>
        <Button variant="destructive" size="sm" onClick={() => setDeleteOpen(true)}>
          <Trash2 className="h-4 w-4 mr-2" />
          Elimina host
        </Button>
      </div>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Eliminare host?</DialogTitle>
            <DialogDescription>
              L&apos;host <span className="font-mono font-medium">{host.ip}</span> verrà rimosso definitivamente.
              Storico scansioni e dati associati saranno eliminati.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)} disabled={deleting}>
              Annulla
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? "Eliminazione..." : "Elimina"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* Info Card */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Informazioni di Rete</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <InfoRow label="IP" value={host.ip} mono />
            <InfoRow label="MAC" value={host.mac || "—"} mono />
            <InfoRow label="Vendor" value={host.vendor || "—"} />
            <InfoRow label="Hostname" value={host.hostname || "—"} />
            <InfoRow label="DNS Forward" value={host.dns_forward || "—"} mono />
            <InfoRow label="DNS Reverse" value={host.dns_reverse || "—"} mono />
            {host.os_info && <InfoRow label="Sistema Operativo" value={host.os_info} />}
            <Separator />
            <InfoRow label="Primo Rilevamento" value={host.first_seen ? new Date(host.first_seen).toLocaleString("it-IT") : "—"} />
            <InfoRow label="Ultimo Contatto" value={host.last_seen ? new Date(host.last_seen).toLocaleString("it-IT") : "—"} />
          </CardContent>
        </Card>

        {/* Edit Card */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Campi Personalizzati</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between rounded-lg border p-4">
              <div>
                <Label>Host conosciuto</Label>
                <p className="text-xs text-muted-foreground">Marca come dispositivo verificato</p>
              </div>
              <Switch
                checked={form.known_host === 1}
                onCheckedChange={(v) => setForm((f) => ({ ...f, known_host: v ? 1 : 0 }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Nome</Label>
              <Input
                value={form.custom_name}
                onChange={(e) => setForm({ ...form, custom_name: e.target.value })}
                placeholder="Server Web Principale"
              />
            </div>
            <div className="space-y-2">
              <Label>Classificazione</Label>
              <Select
                value={form.classification || "__empty__"}
                onValueChange={(v) => setForm({ ...form, classification: v === "__empty__" ? "" : (v ?? "") })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Seleziona classificazione..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__empty__">— Nessuna —</SelectItem>
                  {HOST_CLASSIFICATION_OPTIONS_SORTED.map((c) => (
                    <SelectItem key={c} value={c}>
                      {getClassificationLabel(c)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Codice Inventario</Label>
              <Input
                value={form.inventory_code}
                onChange={(e) => setForm({ ...form, inventory_code: e.target.value })}
                placeholder="INV-2024-001"
              />
            </div>
            <div className="space-y-2">
              <Label>Note</Label>
              <Textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Note aggiuntive..."
                rows={3}
              />
            </div>
            <div className="space-y-2">
              <Label>Porte di monitoraggio TCP</Label>
              <Input
                value={form.monitor_ports}
                onChange={(e) => setForm({ ...form, monitor_ports: e.target.value })}
                placeholder="22, 80, 443, 3389..."
              />
              <p className="text-xs text-muted-foreground">
                Porte separate da virgola. Verranno controllate nei check periodici.
              </p>
            </div>
            <Button onClick={handleSave} disabled={saving} className="w-full">
              <Save className="h-4 w-4 mr-2" />
              {saving ? "Salvataggio..." : "Salva Modifiche"}
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Key className="h-4 w-4" />
            Credenziali per protocollo (archivio)
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Per ogni protocollo usato nelle scansioni puoi forzare una credenziale dall&apos;archivio: da quel momento le acquisizioni useranno solo quella per quel ruolo.
            Lascia &quot;Nessuna&quot; per provare la catena definita sulla subnet / Impostazioni.
          </p>
          {host.scan_types_used && host.scan_types_used.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <span className="text-xs text-muted-foreground">Tipi di scansione già eseguiti su questo host:</span>
              {host.scan_types_used.map((t) => (
                <Badge key={t} variant="secondary" className="text-xs font-mono">
                  {t}
                </Badge>
              ))}
            </div>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {(
              [
                ["windows", "Windows (WinRM)"],
                ["linux", "Linux (SSH / raccolta)"],
                ["ssh", "SSH dedicato"],
                ["snmp", "SNMP"],
              ] as const
            ).map(([role, label]) => (
              <div key={role} className="space-y-1.5">
                <Label className="text-xs">{label}</Label>
                <Select
                  value={detectDraft[role] ?? "none"}
                  onValueChange={(v) => v && setDetectDraft((d) => ({ ...d, [role]: v }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Nessuna" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Nessuna (catena automatica)</SelectItem>
                    {credentialsForDetectRole(role).map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {host.detect_credentials?.find((x) => x.role === role) && (
                  <p className="text-xs text-muted-foreground">
                    Attuale:{" "}
                    <span className="font-medium text-foreground">
                      {host.detect_credentials.find((x) => x.role === role)?.credential_name}
                    </span>
                  </p>
                )}
              </div>
            ))}
          </div>
          <Button
            type="button"
            variant="secondary"
            onClick={handleSaveDetectCredentials}
            disabled={savingDetectCreds}
            className="w-full sm:w-auto"
          >
            <Key className="h-4 w-4 mr-2" />
            {savingDetectCreds ? "Salvataggio..." : "Salva credenziali forzate"}
          </Button>
        </CardContent>
      </Card>

      {/* Device fingerprint (discovery nmap/snmp) */}
      <FingerprintCard detectionJson={host.detection_json} />

      {/* Open Ports */}
      {host.open_ports && (() => {
        try {
          const ports = JSON.parse(host.open_ports) as { port: number; protocol?: string }[];
          if (ports.length === 0) return null;
          const sorted = [...ports].sort((a, b) => a.port - b.port);
          return (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Porte Aperte ({ports.length})</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="font-mono text-sm flex flex-wrap gap-x-2 gap-y-1">
                  {sorted.map((p) => (
                    <span
                      key={`${p.port}-${p.protocol || "tcp"}`}
                      className={p.protocol === "udp" ? "text-primary" : ""}
                      title={p.protocol === "udp" ? "UDP" : "TCP"}
                    >
                      {p.port}{p.protocol === "udp" ? "/u" : ""}
                    </span>
                  ))}
                </p>
              </CardContent>
            </Card>
          );
        } catch { return null; }
      })()}

      {/* Dati SNMP raccolti durante scan */}
      {parsedSnmpData && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Wifi className="h-4 w-4 text-primary" />
              Dati SNMP
              <Badge variant="outline" className="text-xs font-normal ml-auto">
                community: {parsedSnmpData.community} · porta {parsedSnmpData.port}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
              {parsedSnmpData.sysName && <InfoRow label="sysName" value={parsedSnmpData.sysName} mono />}
              {parsedSnmpData.sysObjectID && <InfoRow label="sysObjectID" value={parsedSnmpData.sysObjectID} mono />}
              {parsedSnmpData.model && <InfoRow label="Modello" value={parsedSnmpData.model} />}
              {parsedSnmpData.serialNumber && <InfoRow label="Seriale" value={parsedSnmpData.serialNumber} mono />}
              {parsedSnmpData.partNumber && <InfoRow label="Part Number" value={parsedSnmpData.partNumber} mono />}
              {parsedSnmpData.firmware && <InfoRow label="Firmware" value={parsedSnmpData.firmware} mono />}
              {parsedSnmpData.manufacturer && <InfoRow label="Produttore" value={parsedSnmpData.manufacturer} />}
              {parsedSnmpData.sysUpTime && <InfoRow label="Uptime" value={parsedSnmpData.sysUpTime} mono />}
              {parsedSnmpData.arpEntryCount != null && <InfoRow label="Voci ARP" value={String(parsedSnmpData.arpEntryCount)} />}
            </div>
            {parsedSnmpData.sysDescr && (
              <div className="mt-2">
                <p className="text-xs text-muted-foreground mb-1">sysDescr</p>
                <p className="rounded-md bg-muted/80 px-2 py-1.5 font-mono text-xs break-words whitespace-pre-wrap leading-relaxed">
                  {parsedSnmpData.sysDescr}
                </p>
              </div>
            )}
            {parsedSnmpData.ifDescrSummary && (
              <div className="mt-1">
                <p className="text-xs text-muted-foreground mb-1">Interfacce</p>
                <p className="rounded-md bg-muted/80 px-2 py-1.5 font-mono text-xs break-words whitespace-pre-wrap leading-relaxed">
                  {parsedSnmpData.ifDescrSummary}
                </p>
              </div>
            )}
            {parsedSnmpData.hostResourcesSummary && (
              <div className="mt-1">
                <p className="text-xs text-muted-foreground mb-1">Risorse host</p>
                <p className="rounded-md bg-muted/80 px-2 py-1.5 font-mono text-xs break-words whitespace-pre-wrap leading-relaxed">
                  {parsedSnmpData.hostResourcesSummary}
                </p>
              </div>
            )}
            <p className="text-xs text-muted-foreground mt-2">
              Rilevato: {new Date(parsedSnmpData.collected_at).toLocaleString("it-IT")}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Dispositivo gestito (stesso IP) */}
      {host.network_device ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Server className="h-4 w-4" />
              Dispositivo gestito
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Questo host corrisponde a un dispositivo configurato per acquisizione dati (WINRM, SSH, SNMP, ecc.)
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between rounded-lg border p-4">
              <div>
                <p className="font-medium">{host.custom_name || host.hostname || host.network_device.sysname || (host.network_device.name !== host.ip ? host.network_device.name : null) || "—"}</p>
                <p className="text-sm text-muted-foreground capitalize">
                  {host.network_device.vendor} · {host.network_device.protocol.toUpperCase()}
                </p>
              </div>
              <Link href={`/devices/${host.network_device.id}`}>
                <Button variant="outline" size="sm" className="gap-2">
                  Dettagli dispositivo
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Server className="h-4 w-4 text-muted-foreground" />
              Nessun dispositivo gestito
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Crea un dispositivo gestito per abilitare acquisizione dati via SSH, SNMP o API.
            </p>
          </CardHeader>
          <CardContent>
            <Button variant="outline" size="sm" className="gap-2" onClick={openCreateDevice}>
              <PlusCircle className="h-4 w-4" />
              Crea dispositivo{parsedSnmpData ? " (dati SNMP disponibili)" : ""}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Dialog: Crea dispositivo da host */}
      <Dialog open={createDeviceOpen} onOpenChange={setCreateDeviceOpen}>
        <DialogContent className={DIALOG_PANEL_COMPACT_CLASS}>
          <DialogHeader className="shrink-0 border-b border-border/50 px-4 pt-4 pb-3">
            <DialogTitle>Crea dispositivo gestito — {host.ip}</DialogTitle>
            <DialogDescription>
              Campi pre-compilati da dati SNMP/scan. Modifica dove necessario prima di salvare.
            </DialogDescription>
          </DialogHeader>
          <DialogScrollableArea className="px-4 py-3">
          <form onSubmit={handleCreateDevice} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Nome</Label>
                <Input required value={deviceForm.name} onChange={(e) => setDeviceForm((f) => ({ ...f, name: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">IP / Host</Label>
                <Input value={host.ip} readOnly className="bg-muted" />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Tipo dispositivo</Label>
                <Select value={deviceForm.device_type} onValueChange={(v) => setDeviceForm((f) => ({ ...f, device_type: v as "router" | "switch" | "hypervisor" }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CREATE_DEVICE_TYPE_OPTIONS.map((t) => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Vendor</Label>
                <Select value={deviceForm.vendor} onValueChange={(v) => setDeviceForm((f) => ({ ...f, vendor: v ?? "other" }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {getDefaultNetworkDeviceVendorOptions().map((v) => (
                      <SelectItem key={v.value} value={v.value}>{v.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Protocollo</Label>
                <Select value={deviceForm.protocol} onValueChange={(v) => setDeviceForm((f) => ({ ...f, protocol: v ?? "ssh", port: v === "snmp_v2" || v === "snmp_v3" ? 161 : v === "winrm" ? 5985 : 22 }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CREATE_DEVICE_PROTOCOL_OPTIONS.map((p) => (
                      <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Porta connessione</Label>
                <Input type="number" value={deviceForm.port} onChange={(e) => setDeviceForm((f) => ({ ...f, port: Number(e.target.value) }))} min={1} max={65535} />
              </div>
              {(deviceForm.protocol === "snmp_v2" || deviceForm.protocol === "snmp_v3") && (
                <div className="space-y-1">
                  <Label className="text-xs">Community SNMP</Label>
                  <Input value={deviceForm.community_string} onChange={(e) => setDeviceForm((f) => ({ ...f, community_string: e.target.value }))} placeholder="public" />
                </div>
              )}
              <div className="space-y-1">
                <Label className="text-xs">Classificazione</Label>
                <Select value={deviceForm.classification || ""} onValueChange={(v) => setDeviceForm((f) => ({ ...f, classification: v ?? "" }))}>
                  <SelectTrigger><SelectValue placeholder="Seleziona" /></SelectTrigger>
                  <SelectContent>
                    {CREATE_DEVICE_CLASSIFICATION_OPTIONS.map((c) => (
                      <SelectItem key={c} value={c}>{getClassificationLabel(c)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Separator />
            <p className="text-xs text-muted-foreground font-medium">Dati inventario (da SNMP)</p>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Modello</Label>
                <Input value={deviceForm.model} onChange={(e) => setDeviceForm((f) => ({ ...f, model: e.target.value }))} placeholder="—" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Seriale</Label>
                <Input value={deviceForm.serial_number} onChange={(e) => setDeviceForm((f) => ({ ...f, serial_number: e.target.value }))} placeholder="—" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Firmware</Label>
                <Input value={deviceForm.firmware} onChange={(e) => setDeviceForm((f) => ({ ...f, firmware: e.target.value }))} placeholder="—" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">sysName</Label>
                <Input value={deviceForm.sysname} onChange={(e) => setDeviceForm((f) => ({ ...f, sysname: e.target.value }))} placeholder="—" />
              </div>
              <div className="space-y-1 col-span-1">
                <Label className="text-xs">sysDescr</Label>
                <Textarea rows={2} className="text-xs font-mono resize-none" value={deviceForm.sysdescr} onChange={(e) => setDeviceForm((f) => ({ ...f, sysdescr: e.target.value }))} placeholder="—" />
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateDeviceOpen(false)}>Annulla</Button>
              <Button type="submit" disabled={creatingDevice}>
                {creatingDevice ? "Creazione…" : "Crea dispositivo"}
              </Button>
            </DialogFooter>
          </form>
          </DialogScrollableArea>
        </DialogContent>
      </Dialog>

      {/* Network Connection Info */}
      {(host.arp_source || host.switch_port) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Connessione di Rete</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {host.arp_source && (
              <div className="flex items-center gap-3">
                <Router className="h-4 w-4 text-primary" />
                <span className="text-sm">
                  MAC acquisito da: <span className="font-medium">{host.arp_source.device_name}</span>
                  {" "}({host.arp_source.device_vendor})
                  {" — "}ultima query: {new Date(host.arp_source.last_query).toLocaleString("it-IT")}
                </span>
              </div>
            )}
            {host.switch_port && (
              <div className="flex items-center gap-3">
                <Cable className="h-4 w-4 text-primary" />
                <span className="text-sm">
                  Collegato a: <span className="font-medium">{host.switch_port.device_name}</span>
                  {" "}({host.switch_port.device_vendor})
                  {" → "}Porta <span className="font-mono font-medium">{host.switch_port.port_name}</span>
                  {host.switch_port.vlan && ` — VLAN ${host.switch_port.vlan}`}
                </span>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Latency Chart */}
      <LatencyChart hostId={host.id} />

      {/* Uptime Timeline */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Timeline Uptime</CardTitle>
        </CardHeader>
        <CardContent>
          <UptimeTimeline hostId={host.id} />
        </CardContent>
      </Card>

      {/* Scan History */}
      {host.recent_scans.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Storico Scansioni</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Stato</TableHead>
                  <TableHead>Porte Aperte</TableHead>
                  <TableHead>Durata</TableHead>
                  <TableHead>Data</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {host.recent_scans.map((scan) => (
                  <TableRow key={scan.id}>
                    <TableCell><Badge variant="outline">{scan.scan_type}</Badge></TableCell>
                    <TableCell>{scan.status}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {formatPortsDisplay(scan.ports_open)}
                    </TableCell>
                    <TableCell>{scan.duration_ms ? `${scan.duration_ms}ms` : "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(scan.timestamp).toLocaleString("it-IT")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={mono ? "font-mono" : ""}>{value}</span>
    </div>
  );
}

function parseDetectionJson(json: string | null): DeviceFingerprintSnapshot | null {
  if (!json?.trim()) return null;
  try {
    const o = JSON.parse(json) as unknown;
    if (typeof o !== "object" || o === null) return null;
    return o as DeviceFingerprintSnapshot;
  } catch {
    return null;
  }
}

function FingerprintCard({ detectionJson }: { detectionJson: string | null }) {
  const fp = parseDetectionJson(detectionJson);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <ScanSearch className="h-4 w-4 text-primary" />
          Rilevamento automatico
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Dati da scan <strong>nmap</strong> o <strong>snmp</strong> sulla subnet (TTL, firme porte, banner, SNMP).
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {!fp ? (
          <p className="text-sm text-muted-foreground">
            Nessun dato di rilevamento disponibile. Eseguire una scansione che includa il rilevamento porte/SNMP sulla rete dell&apos;host.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              {fp.final_device ? (
                <Badge variant="default" className="text-sm">
                  {fp.final_device}
                  {fp.final_confidence != null && fp.final_confidence > 0 && (
                    <span className="ml-2 font-normal opacity-90">
                      {(fp.final_confidence * 100).toFixed(0)}% confidenza
                    </span>
                  )}
                </Badge>
              ) : (
                <span className="text-sm text-muted-foreground">Tipo dispositivo non determinato</span>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
              {fp.os_hint && <InfoRow label="OS (hint TTL)" value={fp.os_hint} />}
              {fp.ttl != null && <InfoRow label="TTL ICMP" value={String(fp.ttl)} mono />}
            </div>
            {fp.detection_sources?.length ? (
              <div>
                <p className="text-xs text-muted-foreground mb-1">Fonti</p>
                <div className="flex flex-wrap gap-1">
                  {fp.detection_sources.map((s) => (
                    <Badge key={s} variant="outline" className="text-xs font-normal">
                      {s}
                    </Badge>
                  ))}
                </div>
              </div>
            ) : null}
            {fp.matches && fp.matches.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">Match firme porte</p>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[40%]">Profilo</TableHead>
                      <TableHead className="w-[15%]">Score</TableHead>
                      <TableHead>Porte</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {fp.matches.slice(0, 3).map((m) => (
                      <TableRow key={m.name}>
                        <TableCell className="font-medium">{m.name}</TableCell>
                        <TableCell className="font-mono text-xs">{(m.confidence * 100).toFixed(0)}%</TableCell>
                        <TableCell className="font-mono text-xs">
                          {m.matched_ports?.length ? m.matched_ports.join(", ") : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            {(fp.banner_http || fp.banner_ssh || fp.snmp_sysdescr) && (
              <div className="space-y-2 text-sm">
                {fp.banner_http && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-0.5">HTTP / titolo</p>
                    <p className="rounded-md bg-muted/80 px-2 py-1.5 font-mono text-xs break-words whitespace-pre-wrap">
                      {fp.banner_http}
                    </p>
                  </div>
                )}
                {fp.banner_ssh && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-0.5">SSH banner</p>
                    <p className="rounded-md bg-muted/80 px-2 py-1.5 font-mono text-xs break-all">{fp.banner_ssh}</p>
                  </div>
                )}
                {fp.snmp_sysdescr && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-0.5">SNMP sysDescr</p>
                    <p className="rounded-md bg-muted/80 px-2 py-1.5 font-mono text-xs break-words">{fp.snmp_sysdescr}</p>
                  </div>
                )}
                {fp.snmp_vendor_oid && (
                  <InfoRow label="SNMP sysObjectID" value={fp.snmp_vendor_oid} mono />
                )}
              </div>
            )}
            {fp.generated_at && (
              <p className="text-xs text-muted-foreground">
                Generato: {new Date(fp.generated_at).toLocaleString("it-IT")}
              </p>
            )}
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground">JSON grezzo</summary>
              <pre className="mt-2 max-h-48 overflow-auto rounded-md bg-muted p-2 font-mono text-[11px] leading-relaxed">
                {JSON.stringify(fp, null, 2)}
              </pre>
            </details>
          </>
        )}
      </CardContent>
    </Card>
  );
}
