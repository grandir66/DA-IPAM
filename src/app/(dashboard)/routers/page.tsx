"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
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
import { Plus, Trash2, RefreshCw, Router, Pencil } from "lucide-react";
import { toast } from "sonner";
import type { NetworkDevice } from "@/types";

export default function RoutersPage() {
  const router = useRouter();
  const [devices, setDevices] = useState<NetworkDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingDevice, setEditingDevice] = useState<NetworkDevice | null>(null);
  const [editVendor, setEditVendor] = useState<string>("mikrotik");
  const [editProtocol, setEditProtocol] = useState<string>("ssh");
  const [querying, setQuerying] = useState<number | null>(null);

  useEffect(() => {
    if (editingDevice) {
      setEditVendor(editingDevice.vendor);
      setEditProtocol(editingDevice.protocol);
    }
  }, [editingDevice]);

  const fetchDevices = useCallback(async () => {
    const res = await fetch("/api/devices?type=router");
    setDevices(await res.json());
    setLoading(false);
  }, []);

  useEffect(() => { fetchDevices(); }, [fetchDevices]);

  async function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const body: Record<string, unknown> = { device_type: "router" };
    formData.forEach((val, key) => {
      if (val && key !== "device_type") body[key] = val;
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

    toast.success("Router aggiunto");
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

  async function handleDelete(id: number, name: string) {
    if (!confirm(`Eliminare il router "${name}"?`)) return;
    const res = await fetch(`/api/devices/${id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("Router eliminato");
      fetchDevices();
    }
  }

  async function handleUpdate(e: React.FormEvent<HTMLFormElement>) {
    if (!editingDevice) return;
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const body: Record<string, unknown> = {
      vendor: editVendor,
      protocol: editProtocol,
    };
    formData.forEach((val, key) => {
      if (key === "password" || key === "community_string") {
        if (val && String(val).trim()) body[key] = val;
      } else if (val && key !== "device_type") {
        body[key] = key === "port" ? Number(val) || undefined : val;
      }
    });

    const res = await fetch(`/api/devices/${editingDevice.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const data = await res.json();
      toast.error(data.error || "Errore nell'aggiornamento");
      return;
    }

    toast.success("Router aggiornato");
    setEditDialogOpen(false);
    setEditingDevice(null);
    fetchDevices();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Router</h1>
          <p className="text-muted-foreground mt-1">Dispositivi per acquisizione tabella ARP</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger render={<Button />}>
            <Plus className="h-4 w-4 mr-2" />Aggiungi Router
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Nuovo Router</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Nome</Label>
                  <Input name="name" required placeholder="Router Core" />
                </div>
                <div className="space-y-2">
                  <Label>IP</Label>
                  <Input name="host" required placeholder="192.168.1.1" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Vendor</Label>
                  <Select name="vendor" defaultValue="mikrotik">
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
                  <Select name="protocol" defaultValue="ssh">
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
                  <Input name="port" type="number" placeholder="22" />
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
              <Button type="submit" className="w-full">Aggiungi Router</Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {loading ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">Caricamento...</CardContent></Card>
      ) : devices.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Router className="h-12 w-12 mx-auto text-muted-foreground/40 mb-4" />
            <p className="text-muted-foreground">Nessun router configurato</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>IP</TableHead>
                <TableHead>Vendor</TableHead>
                <TableHead>Protocollo</TableHead>
                <TableHead>Stato</TableHead>
                <TableHead className="w-24">Azioni</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {devices.map((dev) => (
                <TableRow key={dev.id} className="cursor-pointer" onClick={() => router.push(`/devices/${dev.id}`)}>
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
                        onClick={() => { setEditingDevice(dev); setEditDialogOpen(true); }}
                        title="Modifica"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => handleQuery(dev.id)}
                        disabled={querying === dev.id}
                        title="Query ARP"
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

      <Dialog open={editDialogOpen} onOpenChange={(open) => { setEditDialogOpen(open); if (!open) setEditingDevice(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Modifica Router</DialogTitle>
          </DialogHeader>
          {editingDevice && (
            <form onSubmit={handleUpdate} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Nome</Label>
                  <Input name="name" required defaultValue={editingDevice.name} placeholder="Router Core" />
                </div>
                <div className="space-y-2">
                  <Label>IP</Label>
                  <Input name="host" required defaultValue={editingDevice.host} placeholder="192.168.1.1" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Vendor</Label>
                  <Select value={editVendor} onValueChange={(v) => setEditVendor(v ?? "")}>
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
                  <Select value={editProtocol} onValueChange={(v) => setEditProtocol(v ?? "")}>
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
                  <Input name="port" type="number" defaultValue={editingDevice.port} placeholder="22" />
                </div>
                <div className="space-y-2">
                  <Label>Username</Label>
                  <Input name="username" defaultValue={editingDevice.username || ""} placeholder="admin" />
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
              <Button type="submit" className="w-full">Salva modifiche</Button>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
