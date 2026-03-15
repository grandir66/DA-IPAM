"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { ArrowLeft, RefreshCw, Zap, ZapOff, Cable, Minus, Pencil } from "lucide-react";
import { toast } from "sonner";
import type { NetworkDevice, ArpEntry, MacPortEntry, SwitchPort } from "@/types";

interface DeviceDetail extends NetworkDevice {
  arp_entries: (ArpEntry & { host_ip?: string; host_name?: string })[];
  mac_port_entries: (MacPortEntry & { host_ip?: string; host_name?: string })[];
  switch_ports: SwitchPort[];
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
        <TooltipTrigger asChild>
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
        </TooltipTrigger>
        <TooltipContent>
          <p className="capitalize">{status}{watts ? ` — ${watts}W` : ""}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export default function DeviceDetailPage() {
  const params = useParams();
  const router = useRouter();
  const [device, setDevice] = useState<DeviceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [querying, setQuerying] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editVendor, setEditVendor] = useState("");
  const [editProtocol, setEditProtocol] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  useEffect(() => {
    if (device) {
      setEditVendor(device.vendor);
      setEditProtocol(device.protocol);
    }
  }, [device]);

  const fetchDevice = useCallback(async () => {
    const res = await fetch(`/api/devices/${params.id}`);
    if (!res.ok) { router.push("/devices"); return; }
    setDevice(await res.json());
    setLoading(false);
  }, [params.id, router]);

  useEffect(() => { fetchDevice(); }, [fetchDevice]);

  async function handleQuery() {
    setQuerying(true);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120_000); // 2 min
    try {
      const res = await fetch(`/api/devices/${params.id}/query`, {
        method: "POST",
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      const data = await res.json();
      if (res.ok) {
        toast.success(data.message);
        fetchDevice();
      } else {
        toast.error(data.error);
      }
    } catch (err) {
      clearTimeout(timeoutId);
      if (err instanceof Error && err.name === "AbortError") {
        toast.error("Timeout: la scansione ha superato i 2 minuti. Verifica connettività del dispositivo.");
      } else {
        toast.error(err instanceof Error ? err.message : "Errore nella scansione");
      }
    } finally {
      setQuerying(false);
    }
  }

  async function handleEdit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!device) return;
    setEditSaving(true);
    const form = e.currentTarget;
    const formData = new FormData(form);
    const body: Record<string, unknown> = { vendor: editVendor, protocol: editProtocol };
    formData.forEach((val, key) => {
      if (key === "password" || key === "community_string") {
        if (val && String(val).trim()) body[key] = val;
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

  if (loading || !device) return <div className="text-muted-foreground">Caricamento...</div>;

  const upPorts = device.switch_ports?.filter(p => p.status === "up").length || 0;
  const totalPorts = device.switch_ports?.length || 0;
  const trunkPorts = device.switch_ports?.filter(p => p.is_trunk).length || 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <Link href={device.device_type === "router" ? "/routers" : "/switches"}>
          <Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button>
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold">{device.name}</h1>
            <Badge variant={device.device_type === "router" ? "default" : "secondary"}>
              {device.device_type}
            </Badge>
            <Badge variant="outline" className="capitalize">{device.vendor}</Badge>
          </div>
          <p className="text-muted-foreground font-mono text-sm mt-0.5">{device.host}:{device.port} ({device.protocol})</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
            <Pencil className="h-4 w-4 mr-2" />
            Modifica
          </Button>
          <Button onClick={handleQuery} disabled={querying} size="sm">
            <RefreshCw className={`h-4 w-4 mr-2 ${querying ? "animate-spin" : ""}`} />
            {querying ? "Acquisizione..." : "Aggiorna Dati"}
          </Button>
        </div>
      </div>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Modifica {device.device_type === "router" ? "Router" : "Switch"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleEdit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Nome</Label>
                <Input name="name" required defaultValue={device.name} placeholder="Router Core" />
              </div>
              <div className="space-y-2">
                <Label>IP</Label>
                <Input name="host" required defaultValue={device.host} placeholder="192.168.1.1" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Vendor</Label>
                <Select value={editVendor} onValueChange={setEditVendor}>
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
                <Select value={editProtocol} onValueChange={setEditProtocol}>
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
                <Input name="port" type="number" defaultValue={device.port} placeholder="22" />
              </div>
              <div className="space-y-2">
                <Label>Username</Label>
                <Input name="username" defaultValue={device.username || ""} placeholder="admin" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Password SSH</Label>
                <Input name="password" type="password" placeholder="Lascia vuoto per non modificare" />
              </div>
              <div className="space-y-2">
                <Label>Community SNMP</Label>
                <Input name="community_string" type="password" placeholder="Lascia vuoto per non modificare" />
              </div>
            </div>
            <Button type="submit" className="w-full" disabled={editSaving}>
              {editSaving ? "Salvataggio..." : "Salva modifiche"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      {(device.device_type === "switch" || totalPorts > 0) && (
        <div className="flex gap-4 text-sm">
          <div className="flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-500" />
            <span className="text-muted-foreground">{upPorts} up</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-zinc-300" />
            <span className="text-muted-foreground">{totalPorts - upPorts} down</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Cable className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-muted-foreground">{trunkPorts} trunk</span>
          </div>
        </div>
      )}

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
                        <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                          Nessuna entry. Clicca &quot;Aggiorna Dati&quot; per acquisire la tabella ARP.
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
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-8"></TableHead>
                        <TableHead>Porta</TableHead>
                        <TableHead>Stato</TableHead>
                        <TableHead>Velocità</TableHead>
                        <TableHead>VLAN</TableHead>
                        <TableHead>PoE</TableHead>
                        <TableHead>Dispositivo collegato</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(!device.switch_ports || device.switch_ports.length === 0) ? (
                        <TableRow>
                          <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                            Nessuna porta rilevata. Clicca &quot;Aggiorna Dati&quot; per acquisire lo schema.
                          </TableCell>
                        </TableRow>
                      ) : device.switch_ports.map((port) => (
                        <TableRow key={port.id} className={port.status === "disabled" ? "opacity-40" : ""}>
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
                          <TableCell>
                            <PoeBadge status={port.poe_status} powerMw={port.poe_power_mw} />
                          </TableCell>
                          <TableCell>
                            {port.is_trunk ? (
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Badge variant="outline" className="text-[10px]">
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
                                  </TooltipTrigger>
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
                          <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                            Nessuna entry. Clicca &quot;Aggiorna Dati&quot; per acquisire la MAC table.
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
    </div>
  );
}
