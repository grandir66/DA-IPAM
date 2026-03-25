"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Search,
  RefreshCw,
  Router,
  Cable,
  Wifi,
  HardDrive,
  Database,
  Laptop,
  Monitor,
  Server,
  Phone,
  Camera,
  Printer,
  Shield,
  Cpu,
  Box,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  X,
  ExternalLink,
  Trash2,
  Filter,
  CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";
import { StatusBadge } from "@/components/shared/status-badge";
import { Pagination } from "@/components/shared/pagination";
import { SkeletonTable } from "@/components/shared/skeleton-table";
import { getClassificationLabel } from "@/lib/device-classifications";
import { PRODUCT_PROFILE_LABELS, type ProductProfileId } from "@/lib/device-product-profiles";
import type { NetworkDevice, Host } from "@/types";
import {
  formatAcquisitionBadgeDate,
  isNetworkDeviceAcquisitionComplete,
  networkDeviceAcquisitionAt,
} from "@/lib/network-device-acquisition";

type DeviceOrHost = 
  | (NetworkDevice & { source: "device"; host_status?: string })
  | (Host & { source: "host"; device_id?: number });

interface ClassificationCount {
  classification: string;
  count: number;
}

const CLASSIFICATION_ICONS: Record<string, typeof Router> = {
  router: Router,
  switch: Cable,
  firewall: Shield,
  access_point: Wifi,
  server: Server,
  workstation: Monitor,
  notebook: Laptop,
  vm: Box,
  storage: Database,
  hypervisor: HardDrive,
  stampante: Printer,
  telecamera: Camera,
  voip: Phone,
  iot: Cpu,
  unknown: Server,
};

type SortField = "name" | "ip" | "classification" | "vendor" | "profile" | "mac" | "status";
type SortDirection = "asc" | "desc";

export default function DevicesUnifiedPage() {
  const router = useRouter();
  const [items, setItems] = useState<DeviceOrHost[]>([]);
  const [loading, setLoading] = useState(true);
  const [counts, setCounts] = useState<ClassificationCount[]>([]);

  // Filtri
  const [search, setSearch] = useState("");
  const [classificationFilter, setClassificationFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [vendorFilter, setVendorFilter] = useState<string>("all");
  const [productProfileFilter, setProductProfileFilter] = useState<string>("all");

  // Ordinamento
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  // Paginazione
  const [page, setPage] = useState(1);
  const pageSize = 50;

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      // Solo network_devices: gli host IPAM restano in Reti / scheda host. Unire tutti gli host
      // qui faceva esplodere la lista e apriva /hosts/[id] invece del dettaglio dispositivo.
      const devicesRes = await fetch("/api/devices");
      const devices: NetworkDevice[] = devicesRes.ok ? await devicesRes.json() : [];

      const combined: DeviceOrHost[] = devices.map((d) => ({
        ...d,
        source: "device" as const,
      }));

      setItems(combined);

      const countMap = new Map<string, number>();
      for (const item of combined) {
        const cls = item.classification || "unknown";
        countMap.set(cls, (countMap.get(cls) || 0) + 1);
      }
      setCounts(
        Array.from(countMap.entries())
          .map(([classification, count]) => ({ classification, count }))
          .sort((a, b) => b.count - a.count)
      );
    } catch {
      toast.error("Errore nel caricamento dispositivi");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const vendors = useMemo(() => {
    const set = new Set<string>();
    for (const item of items) {
      if (item.vendor) set.add(item.vendor);
    }
    return Array.from(set).sort();
  }, [items]);

  const productProfilesInList = useMemo(() => {
    const set = new Set<string>();
    for (const item of items) {
      if (item.source === "device" && item.product_profile) set.add(item.product_profile);
    }
    return Array.from(set).sort((a, b) => {
      const la = PRODUCT_PROFILE_LABELS[a as ProductProfileId] ?? a;
      const lb = PRODUCT_PROFILE_LABELS[b as ProductProfileId] ?? b;
      return la.localeCompare(lb, "it");
    });
  }, [items]);

  const filteredItems = useMemo(() => {
    let result = items;

    if (search.trim()) {
      const s = search.toLowerCase();
      result = result.filter((item) => {
        const name = item.source === "device" ? item.name : (item.hostname || item.custom_name || "");
        const ip = item.source === "device" ? item.host : item.ip;
        const profileLabel =
          item.source === "device" && item.product_profile
            ? (PRODUCT_PROFILE_LABELS[item.product_profile as ProductProfileId] ?? item.product_profile).toLowerCase()
            : "";
        return (
          name.toLowerCase().includes(s) ||
          ip.toLowerCase().includes(s) ||
          (item.vendor?.toLowerCase().includes(s)) ||
          (item.classification?.toLowerCase().includes(s)) ||
          profileLabel.includes(s) ||
          (item.source === "device" && item.product_profile?.toLowerCase().includes(s))
        );
      });
    }

    if (classificationFilter !== "all") {
      result = result.filter((item) => item.classification === classificationFilter);
    }

    if (statusFilter !== "all") {
      result = result.filter((item) => {
        if (item.source === "device") {
          return statusFilter === "online" ? item.enabled : !item.enabled;
        }
        return item.status === statusFilter;
      });
    }

    if (vendorFilter !== "all") {
      result = result.filter((item) => item.vendor === vendorFilter);
    }

    if (productProfileFilter !== "all") {
      result = result.filter(
        (item) => item.source === "device" && item.product_profile === productProfileFilter
      );
    }

    return result;
  }, [items, search, classificationFilter, statusFilter, vendorFilter, productProfileFilter]);

  const sortedItems = useMemo(() => {
    const sorted = [...filteredItems].sort((a, b) => {
      let aVal: string | number = "";
      let bVal: string | number = "";

      switch (sortField) {
        case "name":
          aVal = a.source === "device" ? a.name : (a.hostname || a.custom_name || a.ip);
          bVal = b.source === "device" ? b.name : (b.hostname || b.custom_name || b.ip);
          break;
        case "ip":
          aVal = a.source === "device" ? a.host : a.ip;
          bVal = b.source === "device" ? b.host : b.ip;
          const aParts = aVal.split(".").map(Number);
          const bParts = bVal.split(".").map(Number);
          for (let i = 0; i < 4; i++) {
            if (aParts[i] !== bParts[i]) {
              return sortDirection === "asc" ? aParts[i] - bParts[i] : bParts[i] - aParts[i];
            }
          }
          return 0;
        case "classification":
          aVal = a.classification || "zzz";
          bVal = b.classification || "zzz";
          break;
        case "vendor":
          aVal = a.vendor || "zzz";
          bVal = b.vendor || "zzz";
          break;
        case "profile":
          aVal =
            a.source === "device" && a.product_profile
              ? PRODUCT_PROFILE_LABELS[a.product_profile as ProductProfileId] ?? a.product_profile
              : "zzz";
          bVal =
            b.source === "device" && b.product_profile
              ? PRODUCT_PROFILE_LABELS[b.product_profile as ProductProfileId] ?? b.product_profile
              : "zzz";
          break;
        case "mac":
          aVal = a.source === "host" ? (a.mac ?? "").toLowerCase() : "zzz";
          bVal = b.source === "host" ? (b.mac ?? "").toLowerCase() : "zzz";
          break;
        case "status":
          if (a.source === "device" && b.source === "device") {
            aVal = a.enabled ? 0 : 1;
            bVal = b.enabled ? 0 : 1;
          } else {
            aVal = a.source === "host" ? (a.status === "online" ? 0 : 1) : 0;
            bVal = b.source === "host" ? (b.status === "online" ? 0 : 1) : 0;
          }
          break;
      }

      if (typeof aVal === "string" && typeof bVal === "string") {
        return sortDirection === "asc" 
          ? aVal.localeCompare(bVal, "it") 
          : bVal.localeCompare(aVal, "it");
      }
      return sortDirection === "asc" ? (aVal as number) - (bVal as number) : (bVal as number) - (aVal as number);
    });

    return sorted;
  }, [filteredItems, sortField, sortDirection]);

  const paginatedItems = useMemo(() => {
    const start = (page - 1) * pageSize;
    return sortedItems.slice(start, start + pageSize);
  }, [sortedItems, page]);

  const totalPages = Math.ceil(sortedItems.length / pageSize);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ArrowUpDown className="h-3 w-3 ml-1 opacity-50" />;
    return sortDirection === "asc" 
      ? <ArrowUp className="h-3 w-3 ml-1" /> 
      : <ArrowDown className="h-3 w-3 ml-1" />;
  };

  const clearFilters = () => {
    setSearch("");
    setClassificationFilter("all");
    setStatusFilter("all");
    setVendorFilter("all");
    setProductProfileFilter("all");
    setPage(1);
  };

  const hasFilters =
    search ||
    classificationFilter !== "all" ||
    statusFilter !== "all" ||
    vendorFilter !== "all" ||
    productProfileFilter !== "all";

  const handleDelete = async (item: DeviceOrHost) => {
    if (item.source !== "device") return;
    if (!confirm(`Eliminare il dispositivo "${item.name}"?`)) return;
    const res = await fetch(`/api/devices/${item.id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("Dispositivo eliminato");
      fetchData();
    }
  };

  const navigateToItem = (item: DeviceOrHost) => {
    if (item.source === "device") {
      router.push(`/devices/${item.id}`);
    } else {
      router.push(`/hosts/${item.id}`);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dispositivi</h1>
          <p className="text-muted-foreground">
            {sortedItems.length} dispositivi {hasFilters && `(filtrati da ${items.length})`}
          </p>
        </div>
        <Button onClick={fetchData} variant="outline" className="gap-2">
          <RefreshCw className="h-4 w-4" />
          Aggiorna
        </Button>
      </div>

      {/* Contatori per classificazione */}
      {counts.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <Badge
            variant={classificationFilter === "all" ? "default" : "outline"}
            className="cursor-pointer hover:bg-primary/80 transition-colors"
            onClick={() => { setClassificationFilter("all"); setPage(1); }}
          >
            Tutti ({items.length})
          </Badge>
          {counts.slice(0, 12).map((c) => {
            const Icon = CLASSIFICATION_ICONS[c.classification] || Server;
            return (
              <Badge
                key={c.classification}
                variant={classificationFilter === c.classification ? "default" : "outline"}
                className="cursor-pointer hover:bg-primary/80 transition-colors gap-1"
                onClick={() => { setClassificationFilter(c.classification); setPage(1); }}
              >
                <Icon className="h-3 w-3" />
                {getClassificationLabel(c.classification)} ({c.count})
              </Badge>
            );
          })}
        </div>
      )}

      {/* Filtri */}
      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Filter className="h-4 w-4" />
            Filtri e ricerca
          </CardTitle>
        </CardHeader>
        <CardContent className="pb-4">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Cerca per nome, IP, vendor, profilo prodotto, classificazione..."
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                className="pl-9"
              />
            </div>
            <Select value={statusFilter} onValueChange={(v) => { if (v) { setStatusFilter(v); setPage(1); } }}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Stato" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tutti gli stati</SelectItem>
                <SelectItem value="online">Online</SelectItem>
                <SelectItem value="offline">Offline</SelectItem>
              </SelectContent>
            </Select>
            <Select value={vendorFilter} onValueChange={(v) => { if (v) { setVendorFilter(v); setPage(1); } }}>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="Vendor" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tutti i vendor</SelectItem>
                {vendors.map((v) => (
                  <SelectItem key={v} value={v} className="capitalize">{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {productProfilesInList.length > 0 && (
              <Select value={productProfileFilter} onValueChange={(v) => { if (v) { setProductProfileFilter(v); setPage(1); } }}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder="Profilo prodotto" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tutti i profili</SelectItem>
                  {productProfilesInList.map((pid) => (
                    <SelectItem key={pid} value={pid}>
                      {PRODUCT_PROFILE_LABELS[pid as ProductProfileId] ?? pid}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {hasFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters} className="gap-1">
                <X className="h-4 w-4" />
                Reset
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Tabella */}
      <Card>
        {loading ? (
          <CardContent className="p-0">
            <SkeletonTable columns={9} rows={15} />
          </CardContent>
        ) : paginatedItems.length === 0 ? (
          <CardContent className="py-12 text-center">
            <Server className="h-12 w-12 mx-auto text-muted-foreground/40 mb-4" />
            <p className="text-muted-foreground">
              {hasFilters ? "Nessun dispositivo corrisponde ai filtri" : "Nessun dispositivo trovato"}
            </p>
          </CardContent>
        ) : (
          <TooltipProvider>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead 
                    className="cursor-pointer hover:bg-muted/50 select-none"
                    onClick={() => handleSort("classification")}
                  >
                    <span className="flex items-center">Tipo <SortIcon field="classification" /></span>
                  </TableHead>
                  <TableHead 
                    className="cursor-pointer hover:bg-muted/50 select-none"
                    onClick={() => handleSort("name")}
                  >
                    <span className="flex items-center">Nome <SortIcon field="name" /></span>
                  </TableHead>
                  <TableHead 
                    className="cursor-pointer hover:bg-muted/50 select-none"
                    onClick={() => handleSort("ip")}
                  >
                    <span className="flex items-center">IP <SortIcon field="ip" /></span>
                  </TableHead>
                  <TableHead 
                    className="cursor-pointer hover:bg-muted/50 select-none"
                    onClick={() => handleSort("vendor")}
                  >
                    <span className="flex items-center">Vendor <SortIcon field="vendor" /></span>
                  </TableHead>
                  <TableHead 
                    className="cursor-pointer hover:bg-muted/50 select-none"
                    onClick={() => handleSort("profile")}
                  >
                    <span className="flex items-center">Profilo <SortIcon field="profile" /></span>
                  </TableHead>
                  <TableHead className="w-[120px] whitespace-nowrap">Acquisizione</TableHead>
                  <TableHead 
                    className="cursor-pointer hover:bg-muted/50 select-none"
                    onClick={() => handleSort("mac")}
                  >
                    <span className="flex items-center">MAC <SortIcon field="mac" /></span>
                  </TableHead>
                  <TableHead 
                    className="cursor-pointer hover:bg-muted/50 select-none"
                    onClick={() => handleSort("status")}
                  >
                    <span className="flex items-center">Stato <SortIcon field="status" /></span>
                  </TableHead>
                  <TableHead className="w-24">Azioni</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedItems.map((item) => {
                  const key = item.source === "device" ? `d-${item.id}` : `h-${item.id}`;
                  const name = item.source === "device" ? item.name : (item.hostname || item.custom_name || "—");
                  const ip = item.source === "device" ? item.host : item.ip;
                  const mac = item.source === "device" ? null : item.mac;
                  const classification = item.classification || "unknown";
                  const Icon = CLASSIFICATION_ICONS[classification] || Server;
                  const status = item.source === "device" 
                    ? (item.enabled ? "online" : "offline") 
                    : (item.status || "unknown");
                  const acquisitionAt =
                    item.source === "device" ? networkDeviceAcquisitionAt(item) : null;
                  const showAcquisitionBadge =
                    item.source === "device" &&
                    isNetworkDeviceAcquisitionComplete(item) &&
                    !!acquisitionAt;

                  return (
                    <TableRow
                      key={key}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => navigateToItem(item)}
                    >
                      <TableCell>
                        <Tooltip>
                          <TooltipTrigger render={<Badge variant="outline" className="gap-1 font-normal" />}>
                            <Icon className="h-3 w-3" />
                            {getClassificationLabel(classification)}
                          </TooltipTrigger>
                          <TooltipContent>
                            {item.source === "device" ? "Dispositivo configurato" : "Host rilevato"}
                          </TooltipContent>
                        </Tooltip>
                      </TableCell>
                      <TableCell className="font-medium">{name}</TableCell>
                      <TableCell className="font-mono text-sm">{ip}</TableCell>
                      <TableCell className="capitalize text-sm">{item.vendor || "—"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {item.source === "device" && item.product_profile
                          ? PRODUCT_PROFILE_LABELS[item.product_profile as ProductProfileId] ?? item.product_profile
                          : "—"}
                      </TableCell>
                      <TableCell className="align-middle">
                        {showAcquisitionBadge && acquisitionAt ? (
                          <Tooltip>
                            <TooltipTrigger
                              render={
                                <Badge
                                  variant="secondary"
                                  className="font-mono text-[10px] px-1.5 py-0 gap-1 max-w-[118px] truncate font-normal"
                                />
                              }
                            >
                              <CheckCircle2 className="h-3 w-3 shrink-0 text-primary" aria-hidden />
                              {formatAcquisitionBadgeDate(acquisitionAt)}
                            </TooltipTrigger>
                            <TooltipContent side="top" className="max-w-xs">
                              Acquisizione completata — {acquisitionAt}
                            </TooltipContent>
                          </Tooltip>
                        ) : null}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {mac || "—"}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={status} />
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => navigateToItem(item)}
                            title="Dettagli"
                          >
                            <ExternalLink className="h-4 w-4" />
                          </Button>
                          {item.source === "device" && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive/60 hover:text-destructive"
                              onClick={() => handleDelete(item)}
                              title="Elimina"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TooltipProvider>
        )}
      </Card>

      {totalPages > 1 && (
        <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
      )}
    </div>
  );
}
