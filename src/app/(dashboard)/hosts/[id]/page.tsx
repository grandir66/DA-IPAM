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
  DialogTitle,
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
import { DEVICE_CLASSIFICATIONS_ORDERED, getClassificationLabel } from "@/lib/device-classifications";
import { UptimeTimeline } from "@/components/shared/uptime-timeline";
import { Switch } from "@/components/ui/switch";
import { ArrowLeft, Save, Router, Cable, Trash2, Server, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import type { HostDetail } from "@/types";
import { LatencyChart } from "./latency-chart";

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

  const fetchHost = useCallback(async () => {
    const res = await fetch(`/api/hosts/${params.id}`);
    if (!res.ok) {
      router.push("/");
      return;
    }
    const data = await res.json();
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

  if (loading || !host) {
    return <div className="text-muted-foreground">Caricamento...</div>;
  }

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
                  {DEVICE_CLASSIFICATIONS_ORDERED.map((c) => (
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

      {/* Dispositivo gestito (stesso IP) */}
      {host.network_device && (
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
      )}

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
