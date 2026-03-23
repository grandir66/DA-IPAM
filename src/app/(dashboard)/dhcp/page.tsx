"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
import {
  RefreshCw,
  Search,
  Server,
  Router,
  Database,
} from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";
import { Pagination } from "@/components/shared/pagination";
import { SkeletonTable } from "@/components/shared/skeleton-table";

interface DhcpLease {
  id: number;
  source_type: string;
  source_device_id: number | null;
  source_name: string | null;
  server_name: string | null;
  scope_id: string | null;
  scope_name: string | null;
  ip_address: string;
  mac_address: string;
  hostname: string | null;
  status: string | null;
  lease_start: string | null;
  lease_expires: string | null;
  description: string | null;
  dynamic_lease: number | null;
  host_id: number | null;
  network_id: number | null;
  last_synced: string;
  host_hostname?: string | null;
  network_name?: string | null;
  network_cidr?: string | null;
  device_name?: string | null;
}

interface DhcpSource {
  id: number;
  name: string;
  host: string;
  vendor: string;
  type: string;
}

interface DhcpStats {
  total: number;
  bySource: Record<string, number>;
  byNetwork: Array<{ network_id: number; network_name: string; count: number }>;
}

const SOURCE_TYPE_LABELS: Record<string, { label: string; color: string }> = {
  mikrotik: { label: "MikroTik", color: "bg-blue-500" },
  windows: { label: "Windows DHCP", color: "bg-purple-500" },
  cisco: { label: "Cisco", color: "bg-green-500" },
  other: { label: "Altro", color: "bg-gray-500" },
};

export default function DhcpPage() {
  const [leases, setLeases] = useState<DhcpLease[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncingDevice, setSyncingDevice] = useState<number | null>(null);

  const [sources, setSources] = useState<DhcpSource[]>([]);
  const [stats, setStats] = useState<DhcpStats | null>(null);

  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [total, setTotal] = useState(0);
  const [searchTerm, setSearchTerm] = useState("");
  const [sourceTypeFilter, setSourceTypeFilter] = useState<string>("all");
  const [sourceDeviceFilter, setSourceDeviceFilter] = useState<string>("all");

  const fetchLeases = useCallback(async () => {
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      });
      if (searchTerm) params.set("search", searchTerm);
      if (sourceTypeFilter !== "all") params.set("sourceType", sourceTypeFilter);
      if (sourceDeviceFilter !== "all") params.set("sourceDeviceId", sourceDeviceFilter);

      const res = await fetch(`/api/dhcp-leases?${params}`);
      if (!res.ok) throw new Error("Errore caricamento");
      const data = await res.json();
      setLeases(data.leases || []);
      setTotal(data.total || 0);
    } catch {
      toast.error("Impossibile caricare i lease DHCP");
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, searchTerm, sourceTypeFilter, sourceDeviceFilter]);

  const fetchSources = useCallback(async () => {
    try {
      const res = await fetch("/api/dhcp-leases?action=sources");
      if (res.ok) {
        const data = await res.json();
        setSources(data.sources || []);
      }
    } catch { /* ignore */ }
  }, []);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch("/api/dhcp-leases?action=stats");
      if (res.ok) {
        const data = await res.json();
        setStats(data);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    fetchLeases();
  }, [fetchLeases]);

  useEffect(() => {
    fetchSources();
    fetchStats();
  }, [fetchSources, fetchStats]);

  const handleSyncAll = async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/dhcp-leases?action=sync-all", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(`Sync completato: ${data.inserted} nuovi, ${data.updated} aggiornati`);
      fetchLeases();
      fetchStats();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Errore sync");
    } finally {
      setSyncing(false);
    }
  };

  const handleSyncDevice = async (deviceId: number) => {
    setSyncingDevice(deviceId);
    try {
      const res = await fetch("/api/dhcp-leases?action=sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(`${data.deviceName}: ${data.inserted} nuovi, ${data.updated} aggiornati`);
      fetchLeases();
      fetchStats();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Errore sync");
    } finally {
      setSyncingDevice(null);
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    fetchLeases();
  };

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Tabella DHCP</h1>
          <p className="text-muted-foreground">Lease DHCP acquisiti da router e server</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={handleSyncAll} disabled={syncing || sources.length === 0}>
            <RefreshCw className={`h-4 w-4 mr-2 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? "Sincronizzazione..." : "Sincronizza tutti"}
          </Button>
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2">
                <Database className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="text-2xl font-bold">{stats.total}</p>
                  <p className="text-xs text-muted-foreground">Lease totali</p>
                </div>
              </div>
            </CardContent>
          </Card>
          {Object.entries(stats.bySource).map(([type, count]) => (
            <Card key={type}>
              <CardContent className="pt-6">
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${SOURCE_TYPE_LABELS[type]?.color || "bg-gray-400"}`} />
                  <div>
                    <p className="text-2xl font-bold">{count}</p>
                    <p className="text-xs text-muted-foreground">{SOURCE_TYPE_LABELS[type]?.label || type}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Sources - Router MikroTik */}
      {sources.length > 0 && (
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Router className="h-4 w-4" />
              Sorgenti DHCP ({sources.length})
            </CardTitle>
            <CardDescription>Router configurati per acquisizione lease DHCP</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Host</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead className="w-32">Azioni</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sources.map((source) => (
                  <TableRow key={source.id}>
                    <TableCell className="font-medium">
                      <Link href={`/devices/${source.id}`} className="hover:underline text-primary">
                        {source.name}
                      </Link>
                    </TableCell>
                    <TableCell className="font-mono text-sm">{source.host}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{SOURCE_TYPE_LABELS[source.type]?.label || source.type}</Badge>
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleSyncDevice(source.id)}
                        disabled={syncingDevice === source.id}
                      >
                        <RefreshCw className={`h-3 w-3 mr-1 ${syncingDevice === source.id ? "animate-spin" : ""}`} />
                        Sync
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Filtri */}
      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-base">Lease DHCP</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-4 mb-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Cerca per IP, MAC o hostname..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={sourceTypeFilter} onValueChange={(v) => v && setSourceTypeFilter(v)}>
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder="Sorgente" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tutte le fonti</SelectItem>
                <SelectItem value="mikrotik">MikroTik</SelectItem>
                <SelectItem value="windows">Windows</SelectItem>
                <SelectItem value="cisco">Cisco</SelectItem>
                <SelectItem value="other">Altro</SelectItem>
              </SelectContent>
            </Select>
            <Select value={sourceDeviceFilter} onValueChange={(v) => v && setSourceDeviceFilter(v)}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Device" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tutti i device</SelectItem>
                {sources.map((s) => (
                  <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="submit" variant="secondary">
              <Search className="h-4 w-4 mr-1" />
              Cerca
            </Button>
          </form>

          {loading ? (
            <SkeletonTable columns={8} rows={10} />
          ) : leases.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Server className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p className="text-lg">Nessun lease DHCP trovato</p>
              <p className="text-sm mt-1">Clicca &quot;Sincronizza tutti&quot; per acquisire i lease dai router</p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>IP</TableHead>
                      <TableHead>MAC</TableHead>
                      <TableHead className="w-14">Tipo</TableHead>
                      <TableHead>Hostname</TableHead>
                      <TableHead>Sorgente</TableHead>
                      <TableHead>Rete</TableHead>
                      <TableHead>Stato</TableHead>
                      <TableHead>Ultimo sync</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {leases.map((lease) => (
                      <TableRow key={lease.id}>
                        <TableCell className="font-mono">
                          {lease.host_id ? (
                            <Link href={`/hosts/${lease.host_id}`} className="text-primary hover:underline">
                              {lease.ip_address}
                            </Link>
                          ) : (
                            lease.ip_address
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-xs">{lease.mac_address}</TableCell>
                        <TableCell>
                          {lease.dynamic_lease === 1 ? (
                            <Badge variant="outline" className="text-[10px] font-mono px-1.5 py-0">DYN</Badge>
                          ) : lease.dynamic_lease === 0 ? (
                            <Badge variant="outline" className="text-[10px] font-mono px-1.5 py-0">STAT</Badge>
                          ) : null}
                        </TableCell>
                        <TableCell>{lease.hostname || <span className="text-muted-foreground">—</span>}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <div className={`w-2 h-2 rounded-full ${SOURCE_TYPE_LABELS[lease.source_type]?.color || "bg-gray-400"}`} />
                            <span className="text-sm">{lease.device_name || lease.source_name || "—"}</span>
                          </div>
                          {lease.server_name && (
                            <p className="text-xs text-muted-foreground">{lease.server_name}</p>
                          )}
                        </TableCell>
                        <TableCell>
                          {lease.network_name ? (
                            <Link href={`/networks/${lease.network_id}`} className="text-primary hover:underline text-sm">
                              {lease.network_name}
                            </Link>
                          ) : (
                            <span className="text-muted-foreground text-sm">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {lease.status && (
                            <Badge variant={lease.status === "bound" ? "default" : "secondary"} className="text-xs">
                              {lease.status}
                            </Badge>
                          )}
                          {lease.lease_expires && (
                            <p className="text-xs text-muted-foreground mt-0.5">{lease.lease_expires}</p>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {new Date(lease.last_synced).toLocaleString("it-IT")}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {totalPages > 1 && (
                <div className="mt-4">
                  <Pagination
                    page={page}
                    totalPages={totalPages}
                    onPageChange={setPage}
                  />
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
