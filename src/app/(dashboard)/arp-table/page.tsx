"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
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
import { ListOrdered, Search, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { MacIpMapping } from "@/types";
import type { Network } from "@/types";
import { useClientTableSort } from "@/hooks/use-table-sort";
import { SortableTableHead } from "@/components/shared/sortable-table-head";

const SOURCE_LABELS: Record<string, string> = {
  arp: "ARP",
  dhcp: "DHCP",
  host: "Host",
  switch: "Switch",
};

export default function ArpTablePage() {
  const [mappings, setMappings] = useState<MacIpMapping[]>([]);
  const [networks, setNetworks] = useState<Network[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [networkId, setNetworkId] = useState<string>("");
  const [source, setSource] = useState<string>("");

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (networkId) params.set("network_id", networkId);
      if (source) params.set("source", source);
      if (q.trim()) params.set("q", q.trim());
      params.set("limit", "500");
      const res = await fetch(`/api/mac-ip-mapping?${params}`);
      if (res.ok) {
        const data = await res.json();
        setMappings(data);
      }
    } catch {
      setMappings([]);
    } finally {
      setLoading(false);
    }
  }, [networkId, source, q]);

  useEffect(() => {
    fetch("/api/networks")
      .then((r) => (r.ok ? r.json() : []))
      .then(setNetworks)
      .catch(() => setNetworks([]));
  }, []);

  useEffect(() => {
    const t = setTimeout(fetchData, q ? 300 : 0);
    return () => clearTimeout(t);
  }, [fetchData, q]);

  const formatDate = (dateStr: string) =>
    new Date(dateStr).toLocaleString("it-IT", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  const sortAccessors = useMemo(
    () => ({
      mac_display: (m: MacIpMapping) => m.mac_display,
      ip: (m: MacIpMapping) => m.ip,
      source: (m: MacIpMapping) => m.source,
      network_name: (m: MacIpMapping) => m.network_name ?? "",
      hostname: (m: MacIpMapping) => m.hostname ?? "",
      vendor: (m: MacIpMapping) => m.vendor ?? "",
      last_seen: (m: MacIpMapping) => new Date(m.last_seen).getTime(),
      previous_ip: (m: MacIpMapping) => m.previous_ip ?? "",
    }),
    []
  );

  const { sortedRows: sortedMappings, sortColumn, sortDirection, onSort } = useClientTableSort(
    mappings,
    sortAccessors,
    "last_seen",
    "desc"
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Tabella ARP cumulativa</h1>
        <p className="text-muted-foreground mt-1">
          Mapping MAC–IP da router, switch, DHCP e host. Aggiornata automaticamente quando un MAC cambia indirizzo.
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <ListOrdered className="h-5 w-5" />
              Mapping MAC–IP
            </CardTitle>
            <div className="flex flex-wrap gap-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Cerca MAC, IP o hostname..."
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  className="pl-8 w-48 sm:w-56"
                />
              </div>
              <Select value={networkId} onValueChange={(v) => setNetworkId(v ?? "")}>
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="Tutte le reti" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Tutte le reti</SelectItem>
                  {networks.map((n) => (
                    <SelectItem key={n.id} value={String(n.id)}>
                      {n.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={source} onValueChange={(v) => setSource(v ?? "")}>
                <SelectTrigger className="w-32">
                  <SelectValue placeholder="Sorgente" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Tutte</SelectItem>
                  {Object.entries(SOURCE_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="outline" size="icon" onClick={fetchData} disabled={loading}>
                <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="py-12 text-center text-muted-foreground">Caricamento...</div>
          ) : mappings.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              Nessun mapping trovato. I dati vengono popolati da ARP, DHCP e scansioni host.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortableTableHead columnId="mac_display" sortColumn={sortColumn} sortDirection={sortDirection} onSort={onSort}>
                      MAC
                    </SortableTableHead>
                    <SortableTableHead columnId="ip" sortColumn={sortColumn} sortDirection={sortDirection} onSort={onSort}>
                      IP
                    </SortableTableHead>
                    <SortableTableHead columnId="source" sortColumn={sortColumn} sortDirection={sortDirection} onSort={onSort}>
                      Sorgente
                    </SortableTableHead>
                    <SortableTableHead columnId="network_name" sortColumn={sortColumn} sortDirection={sortDirection} onSort={onSort}>
                      Rete
                    </SortableTableHead>
                    <SortableTableHead columnId="hostname" sortColumn={sortColumn} sortDirection={sortDirection} onSort={onSort}>
                      Hostname
                    </SortableTableHead>
                    <SortableTableHead columnId="vendor" sortColumn={sortColumn} sortDirection={sortDirection} onSort={onSort}>
                      Vendor
                    </SortableTableHead>
                    <SortableTableHead columnId="last_seen" sortColumn={sortColumn} sortDirection={sortDirection} onSort={onSort}>
                      Ultimo visto
                    </SortableTableHead>
                    <SortableTableHead columnId="previous_ip" sortColumn={sortColumn} sortDirection={sortDirection} onSort={onSort}>
                      IP precedente
                    </SortableTableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedMappings.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell className="font-mono text-sm">{m.mac_display}</TableCell>
                      <TableCell className="font-mono text-sm">{m.ip}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{SOURCE_LABELS[m.source] ?? m.source}</Badge>
                      </TableCell>
                      <TableCell className="text-sm">{m.network_name ?? "—"}</TableCell>
                      <TableCell className="font-medium">{m.hostname ?? "—"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{m.vendor ?? "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{formatDate(m.last_seen)}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {m.previous_ip ?? "—"}
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
