"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, RefreshCw, Router, Cable, Wifi, HardDrive, Database, Laptop, Monitor, Server, Phone, Camera, Printer, Shield, Cpu, ChevronRight, Package, Box } from "lucide-react";
import { toast } from "sonner";
import type { NetworkDevice } from "@/types";

export default function DevicesPage() {
  const router = useRouter();
  const [devices, setDevices] = useState<NetworkDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deviceType, setDeviceType] = useState<"router" | "switch">("router");
  const [vendor, setVendor] = useState<string>("mikrotik");
  const [protocol, setProtocol] = useState<string>("ssh");
  const [querying, setQuerying] = useState<number | null>(null);
  const [syncing, setSyncing] = useState(false);

  const fetchDevices = useCallback(async () => {
    const res = await fetch("/api/devices");
    setDevices(await res.json());
    setLoading(false);
  }, []);

  useEffect(() => { fetchDevices(); }, [fetchDevices]);

  useEffect(() => {
    if (deviceType === "router") {
      setVendor("mikrotik");
    } else {
      setVendor("cisco");
    }
  }, [deviceType]);

  async function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const body: Record<string, unknown> = {
      device_type: deviceType,
      vendor,
      protocol,
    };
    formData.forEach((val, key) => {
      if (val && key !== "device_type") {
        body[key] = key === "port" ? Number(val) || undefined : val;
      }
    });

    const res = await fetch("/api/devices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const data = await res.json();
      toast.error(data.error || "Errore nella creazione");
      return;
    }

    toast.success(deviceType === "router" ? "Router aggiunto" : "Switch aggiunto");
    setDialogOpen(false);
    fetchDevices();
  }

  async function handleQuery(id: number) {
    setQuerying(id);
    const res = await fetch(`/api/devices/${id}/query`, { method: "POST" });
    const data = await res.json();
    if (res.ok) {
      toast.success(data.message);
    } else {
      toast.error(data.error || "Errore nella query");
    }
    setQuerying(null);
  }

  async function handleSyncToInventory() {
    setSyncing(true);
    try {
      const res = await fetch("/api/inventory/sync-devices", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        toast.success(data.message);
      } else {
        toast.error(data.error ?? "Errore nella sincronizzazione");
      }
    } catch {
      toast.error("Errore nella sincronizzazione");
    } finally {
      setSyncing(false);
    }
  }

  async function handleDelete(id: number, name: string) {
    if (!confirm(`Eliminare il dispositivo "${name}"?`)) return;
    const res = await fetch(`/api/devices/${id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("Dispositivo eliminato");
      fetchDevices();
    }
  }

  const deviceCategories = [
    { href: "/devices/workstation", label: "PC", icon: Monitor },
    { href: "/devices/notebook", label: "Notebook", icon: Laptop },
    { href: "/devices/vm", label: "VM", icon: Box },
    { href: "/devices/server", label: "Server", icon: Server },
    { href: "/devices/access_point", label: "Access Point", icon: Wifi },
    { href: "/devices/switch", label: "Switch", icon: Cable },
    { href: "/devices/router", label: "Router", icon: Router },
    { href: "/devices/firewall", label: "Firewall", icon: Shield },
    { href: "/devices/storage", label: "Storage", icon: Database },
    { href: "/devices/hypervisor", label: "Hypervisor", icon: HardDrive },
    { href: "/devices/iot", label: "IoT", icon: Cpu },
    { href: "/devices/stampante", label: "Stampanti", icon: Printer },
    { href: "/devices/telecamera", label: "Telecamere", icon: Camera },
    { href: "/devices/voip", label: "Telefoni", icon: Phone },
  ] as const;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Tipologie di dispositivi</CardTitle>
          <CardDescription>
            Clicca su una categoria per visualizzare i dispositivi assegnati
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
            {deviceCategories.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg border bg-card hover:bg-accent/50 hover:border-primary/30 transition-colors text-sm font-medium"
              >
                <item.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="truncate">{item.label}</span>
                <ChevronRight className="h-3.5 w-3.5 shrink-0 ml-auto text-muted-foreground/60" />
              </Link>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Tutti i dispositivi</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Router e switch per acquisizione ARP e MAC table
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={handleSyncToInventory}
            disabled={syncing || devices.length === 0}
            className="gap-2"
          >
            <Package className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? "Sincronizzazione..." : "Aggiungi a inventario"}
          </Button>
          <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) setDeviceType("router"); }}>
            <DialogTrigger render={<Button />}>
              <Plus className="h-4 w-4 mr-2" />Aggiungi dispositivo
            </DialogTrigger>
          <DialogContent className="sm:max-w-4xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Nuovo dispositivo</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="space-y-2">
                <Label>Tipo</Label>
                <Select value={deviceType} onValueChange={(v) => setDeviceType(v as "router" | "switch")}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="router">
                      <span className="flex items-center gap-2">
                        <Router className="h-4 w-4" /> Router
                      </span>
                    </SelectItem>
                    <SelectItem value="switch">
                      <span className="flex items-center gap-2">
                        <Cable className="h-4 w-4" /> Switch
                      </span>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Nome</Label>
                  <Input name="name" required placeholder={deviceType === "router" ? "Router Core" : "Switch Core"} />
                </div>
                <div className="space-y-2">
                  <Label>IP</Label>
                  <Input name="host" required placeholder="192.168.1.1" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Vendor</Label>
                  <Select value={vendor} onValueChange={(v) => setVendor(v ?? "")}>
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
                <div className="space-y-2">
                  <Label>Protocollo</Label>
                  <Select value={protocol} onValueChange={(v) => setProtocol(v ?? "")}>
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
                    placeholder={protocol === "ssh" ? "22" : protocol.startsWith("snmp") ? "161" : "443"}
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
              <Button type="submit" className="w-full">
                Aggiungi {deviceType === "router" ? "Router" : "Switch"}
              </Button>
            </form>
          </DialogContent>
          </Dialog>
        </div>
      </div>

      {loading ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">Caricamento...</CardContent></Card>
      ) : devices.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Router className="h-12 w-12 mx-auto text-muted-foreground/40 mb-4" />
            <p className="text-muted-foreground">Nessun dispositivo configurato</p>
            <p className="text-sm text-muted-foreground/70 mt-2">Clicca &quot;Aggiungi dispositivo&quot; per iniziare</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tipo</TableHead>
                <TableHead>Classificazione</TableHead>
                <TableHead>Nome</TableHead>
                <TableHead>IP</TableHead>
                <TableHead>Vendor</TableHead>
                <TableHead>Protocollo</TableHead>
                <TableHead>Stato</TableHead>
                <TableHead className="w-28">Azioni</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {devices.map((dev) => (
                <TableRow
                  key={dev.id}
                  className="cursor-pointer"
                  onClick={() => router.push(`/devices/${dev.id}`)}
                >
                  <TableCell>
                    {dev.device_type === "router" ? (
                      <Badge variant="default" className="gap-1">
                        <Router className="h-3 w-3" /> Router
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="gap-1">
                        <Cable className="h-3 w-3" /> Switch
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="font-normal capitalize">
                      {(dev as { classification?: string | null }).classification?.replace(/_/g, " ") ?? dev.device_type}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-medium">{dev.name}</TableCell>
                  <TableCell className="font-mono">{dev.host}</TableCell>
                  <TableCell className="capitalize">{dev.vendor}</TableCell>
                  <TableCell className="uppercase text-xs">{dev.protocol}</TableCell>
                  <TableCell>
                    <Badge variant={dev.enabled ? "outline" : "secondary"}>
                      {dev.enabled ? "Attivo" : "Disabilitato"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => handleQuery(dev.id)}
                        disabled={querying === dev.id}
                        title="Query"
                      >
                        <RefreshCw className={`h-4 w-4 ${querying === dev.id ? "animate-spin" : ""}`} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive/60 hover:text-destructive"
                        onClick={() => handleDelete(dev.id, dev.name)}
                        title="Elimina"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
