"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Package, Search, Pencil, ExternalLink, RefreshCw, Download, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import type { InventoryAsset } from "@/types";

const CATEGORIE: (InventoryAsset["categoria"])[] = [
  "Desktop", "Laptop", "Server", "Switch", "Firewall", "NAS", "Stampante",
  "VM", "Licenza", "Access Point", "Router", "Other",
];
const STATI: (InventoryAsset["stato"])[] = [
  "Attivo", "In magazzino", "In riparazione", "Dismesso", "Rubato",
];

export default function InventoryPage() {
  const [assets, setAssets] = useState<(InventoryAsset & { network_device_name?: string; host_ip?: string })[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [categoria, setCategoria] = useState<string>("");
  const [stato, setStato] = useState<string>("");
  const [syncingDevices, setSyncingDevices] = useState(false);
  const [syncingHosts, setSyncingHosts] = useState(false);

  const fetchAssets = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      if (categoria) params.set("categoria", categoria);
      if (stato) params.set("stato", stato);
      params.set("limit", "200");
      const res = await fetch(`/api/inventory?${params}`, { cache: "no-store" });
      if (res.ok) setAssets(await res.json());
      else setAssets([]);
    } catch {
      setAssets([]);
    } finally {
      setLoading(false);
    }
  }, [q, categoria, stato]);

  useEffect(() => {
    const t = setTimeout(fetchAssets, q ? 300 : 0);
    return () => clearTimeout(t);
  }, [fetchAssets, q]);

  const formatDate = (d: string | null) => d ? new Date(d).toLocaleDateString("it-IT") : "—";

  async function handleSyncDevices() {
    setSyncingDevices(true);
    try {
      const res = await fetch("/api/inventory/sync-devices", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        if (data.created > 0 || data.updated > 0) fetchAssets();
        toast.success(data.message);
      } else {
        toast.error(data.error ?? "Errore nella sincronizzazione");
      }
    } catch {
      toast.error("Errore nella sincronizzazione");
    } finally {
      setSyncingDevices(false);
    }
  }

  async function handleSyncHosts() {
    setSyncingHosts(true);
    try {
      const res = await fetch("/api/inventory/sync-hosts", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        if (data.created > 0 || data.updated > 0) fetchAssets();
        toast.success(data.message);
      } else {
        toast.error(data.error ?? "Errore nella sincronizzazione");
      }
    } catch {
      toast.error("Errore nella sincronizzazione");
    } finally {
      setSyncingHosts(false);
    }
  }

  function handleExport() {
    const params = new URLSearchParams();
    if (categoria) params.set("categoria", categoria);
    if (stato) params.set("stato", stato);
    params.set("limit", "2000");
    window.open(`/api/inventory/export?${params}`, "_blank");
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Inventario asset</h1>
        <p className="text-muted-foreground mt-1">
          Gestione dati di inventario per device di rete e host. Molti campi sono opzionali.
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Package className="h-5 w-5" />
              Elenco asset
            </CardTitle>
            <div className="flex flex-wrap gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button variant="outline" disabled={syncingDevices || syncingHosts} className="gap-2">
                      <RefreshCw className={`h-4 w-4 ${(syncingDevices || syncingHosts) ? "animate-spin" : ""}`} />
                      Sincronizza
                      <ChevronDown className="h-4 w-4" />
                    </Button>
                  }
                />
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={handleSyncDevices} disabled={syncingDevices}>
                    {syncingDevices ? "Sincronizzazione..." : "Da dispositivi di rete"}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleSyncHosts} disabled={syncingHosts}>
                    {syncingHosts ? "Sincronizzazione..." : "Da host"}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button variant="outline" size="icon" onClick={handleExport} title="Esporta CSV">
                <Download className="h-4 w-4" />
              </Button>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Cerca asset tag, S/N, hostname..."
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  className="pl-8 w-48 sm:w-56"
                />
              </div>
              <Select value={categoria} onValueChange={(v) => setCategoria(v ?? "")}>
                <SelectTrigger className="w-36">
                  <SelectValue placeholder="Categoria" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Tutte</SelectItem>
                  {CATEGORIE.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={stato} onValueChange={(v) => setStato(v ?? "")}>
                <SelectTrigger className="w-36">
                  <SelectValue placeholder="Stato" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Tutti</SelectItem>
                  {STATI.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="outline" size="icon" onClick={fetchAssets} disabled={loading}>
                <Search className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="py-12 text-center text-muted-foreground">Caricamento...</div>
          ) : assets.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              Nessun asset in inventario. Collega un asset da una scheda device o host.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Asset Tag</TableHead>
                    <TableHead>S/N</TableHead>
                    <TableHead>Prodotto</TableHead>
                    <TableHead>Categoria</TableHead>
                    <TableHead>Collegato a</TableHead>
                    <TableHead>Stato</TableHead>
                    <TableHead>Fine garanzia</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {assets.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="font-medium">{a.asset_tag ?? "—"}</TableCell>
                      <TableCell className="font-mono text-sm">{a.serial_number ?? "—"}</TableCell>
                      <TableCell>{a.nome_prodotto ?? a.marca ?? "—"}</TableCell>
                      <TableCell>
                        {a.categoria ? <Badge variant="outline">{a.categoria}</Badge> : "—"}
                      </TableCell>
                      <TableCell>
                        {a.network_device_id ? (
                          <Link href={`/devices/${a.network_device_id}`} className="text-primary hover:underline flex items-center gap-1">
                            {a.network_device_name ?? `Device #${a.network_device_id}`}
                            <ExternalLink className="h-3 w-3" />
                          </Link>
                        ) : a.host_id ? (
                          <Link href={`/hosts/${a.host_id}`} className="text-primary hover:underline flex items-center gap-1">
                            {a.host_ip ?? `Host #${a.host_id}`}
                            <ExternalLink className="h-3 w-3" />
                          </Link>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell>
                        {a.stato ? <Badge variant={a.stato === "Attivo" ? "default" : "secondary"}>{a.stato}</Badge> : "—"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{formatDate(a.fine_garanzia)}</TableCell>
                      <TableCell>
                        <Link href={`/inventory/${a.id}`}>
                          <Button variant="ghost" size="icon"><Pencil className="h-4 w-4" /></Button>
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
