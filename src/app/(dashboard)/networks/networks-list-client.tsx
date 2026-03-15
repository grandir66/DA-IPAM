"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Network } from "lucide-react";
import { toast } from "sonner";
import type { NetworkWithStats } from "@/types";

interface NetworksListClientProps {
  initialNetworks: NetworkWithStats[];
}

export function NetworksListClient({ initialNetworks }: NetworksListClientProps) {
  const router = useRouter();
  const [networks, setNetworks] = useState<NetworkWithStats[]>(initialNetworks);
  const [dialogOpen, setDialogOpen] = useState(false);

  const refreshNetworks = useCallback(async () => {
    try {
      const res = await fetch("/api/networks");
      if (res.ok) {
        const data = await res.json();
        setNetworks(data);
      }
    } catch {
      toast.error("Impossibile aggiornare l'elenco");
    }
  }, []);

  async function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const body = {
      cidr: formData.get("cidr"),
      name: formData.get("name"),
      description: formData.get("description"),
      gateway: formData.get("gateway") || undefined,
      vlan_id: formData.get("vlan_id") ? Number(formData.get("vlan_id")) : undefined,
      location: formData.get("location") || undefined,
    };

    const res = await fetch("/api/networks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const data = await res.json();
      toast.error(data.error || "Errore nella creazione");
      return;
    }

    toast.success("Rete creata con successo");
    setDialogOpen(false);
    refreshNetworks();
  }

  async function handleDelete(id: number, name: string) {
    if (!confirm(`Eliminare la rete "${name}" e tutti gli host associati?`)) return;

    const res = await fetch(`/api/networks/${id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("Rete eliminata");
      refreshNetworks();
    } else {
      toast.error("Errore nell'eliminazione");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Reti</h1>
          <p className="text-muted-foreground text-sm mt-0.5">Gestisci le reti monitorate</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger render={<Button />}>
            <Plus className="h-4 w-4 mr-2" />
            Aggiungi Rete
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Nuova Rete</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Nome</Label>
                  <Input id="name" name="name" required placeholder="LAN Ufficio" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="cidr">CIDR</Label>
                  <Input id="cidr" name="cidr" required placeholder="192.168.1.0/24" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="gateway">Gateway</Label>
                  <Input id="gateway" name="gateway" placeholder="192.168.1.1" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="vlan_id">VLAN ID</Label>
                  <Input id="vlan_id" name="vlan_id" type="number" placeholder="100" />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="location">Posizione</Label>
                <Input id="location" name="location" placeholder="Sede principale" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="description">Descrizione</Label>
                <Textarea id="description" name="description" placeholder="Descrizione opzionale..." />
              </div>
              <Button type="submit" className="w-full">Crea Rete</Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {networks.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Network className="h-12 w-12 mx-auto text-muted-foreground/40 mb-4" />
            <p className="text-muted-foreground">Nessuna rete configurata</p>
            <p className="text-sm text-muted-foreground mt-1">Clicca &quot;Aggiungi Rete&quot; per iniziare</p>
          </CardContent>
        </Card>
      ) : (
        <Card size="sm" className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>CIDR</TableHead>
                <TableHead>VLAN</TableHead>
                <TableHead>Posizione</TableHead>
                <TableHead className="text-center">Host</TableHead>
                <TableHead className="text-center">Online</TableHead>
                <TableHead className="text-center">Offline</TableHead>
                <TableHead>Ultima Scansione</TableHead>
                <TableHead className="w-12"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {networks.map((net) => (
                <TableRow
                  key={net.id}
                  className="cursor-pointer"
                  onClick={() => router.push(`/networks/${net.id}`)}
                >
                  <TableCell className="font-medium">{net.name}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="font-mono">{net.cidr}</Badge>
                  </TableCell>
                  <TableCell>{net.vlan_id ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{net.location || "—"}</TableCell>
                  <TableCell className="text-center">{net.total_hosts}</TableCell>
                  <TableCell className="text-center text-success font-medium">{net.online_count}</TableCell>
                  <TableCell className="text-center text-destructive font-medium">{net.offline_count}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {net.last_scan ? new Date(net.last_scan).toLocaleString("it-IT") : "Mai"}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive/60 hover:text-destructive"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(net.id, net.name);
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
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
