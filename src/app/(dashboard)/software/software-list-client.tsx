"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ChevronDown,
  ChevronRight,
  Package,
  Search,
  Loader2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SortableTableHead, type SortDirection } from "@/components/shared/sortable-table-head";
import { Pagination } from "@/components/shared/pagination";
import { SourcesBadges } from "@/components/shared/vuln-badges";

type SoftwareSource = "Wazuh" | "Probe";

interface SoftwareHostRef {
  host_id: number;
  ip: string;
  hostname: string | null;
  network_id: number | null;
  network_name: string | null;
  sources: SoftwareSource[];
  publisher: string | null;
  install_date: string | null;
  scanned_at: string | null;
}

interface AggregatedSoftwareUi {
  key: string;
  name: string;
  version: string | null;
  publisher: string | null;
  sources: SoftwareSource[];
  host_count: number;
  hosts_preview: SoftwareHostRef[];
  vuln_count: number;
  latest_seen_at: string | null;
}

interface ApiResponse {
  data: AggregatedSoftwareUi[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

const PAGE_SIZE = 50;
const SOURCE_FILTERS: SoftwareSource[] = ["Wazuh", "Probe"];

function formatDate(ts: string | null): string {
  if (!ts) return "—";
  try {
    return new Date(ts).toLocaleDateString("it-IT");
  } catch {
    return ts;
  }
}

export function SoftwareListClient() {
  const [data, setData] = useState<AggregatedSoftwareUi[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [sourceFilter, setSourceFilter] = useState<Set<SoftwareSource>>(new Set());
  const [onlyWithVulns, setOnlyWithVulns] = useState(false);

  const [sortBy, setSortBy] = useState("host_count");
  const [sortDir, setSortDir] = useState<SortDirection>("desc");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogKey, setDialogKey] = useState<string | null>(null);
  const [dialogHosts, setDialogHosts] = useState<SoftwareHostRef[]>([]);
  const [dialogLoading, setDialogLoading] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchInput]);

  const params = useMemo(() => {
    const sp = new URLSearchParams();
    sp.set("page", String(page));
    sp.set("pageSize", String(PAGE_SIZE));
    sp.set("sortBy", sortBy);
    sp.set("sortDir", sortDir);
    if (search) sp.set("search", search);
    if (sourceFilter.size > 0) sp.set("sources", [...sourceFilter].join(","));
    if (onlyWithVulns) sp.set("hasVulns", "true");
    return sp.toString();
  }, [page, sortBy, sortDir, search, sourceFilter, onlyWithVulns]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/software?${params}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<ApiResponse>;
      })
      .then((res) => {
        if (cancelled) return;
        setData(res.data);
        setTotal(res.total);
        setTotalPages(res.totalPages);
        setExpanded(new Set());
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : String(e);
        setError(`Errore nel caricamento: ${msg}`);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [params]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const sp = new URLSearchParams(window.location.search);
    const s = sp.get("search");
    if (s) {
      setSearchInput(s);
      setSearch(s);
    }
  }, []);

  const onSort = useCallback(
    (columnId: string) => {
      if (columnId === sortBy) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      else {
        setSortBy(columnId);
        setSortDir("desc");
      }
      setPage(1);
    },
    [sortBy],
  );

  const toggleSource = (src: SoftwareSource) => {
    setSourceFilter((prev) => {
      const next = new Set(prev);
      if (next.has(src)) next.delete(src);
      else next.add(src);
      return next;
    });
    setPage(1);
  };

  const toggleExpand = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const openDrillDown = async (key: string) => {
    setDialogKey(key);
    setDialogOpen(true);
    setDialogHosts([]);
    setDialogLoading(true);
    try {
      const r = await fetch(`/api/software/${encodeURIComponent(key)}/hosts`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as { hosts: SoftwareHostRef[] };
      setDialogHosts(j.hosts);
    } catch {
      setDialogHosts([]);
    } finally {
      setDialogLoading(false);
    }
  };

  const resetFilters = () => {
    setSearchInput("");
    setSearch("");
    setSourceFilter(new Set());
    setOnlyWithVulns(false);
    setPage(1);
  };

  const hasFilters = search || sourceFilter.size > 0 || onlyWithVulns;

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Package className="h-6 w-6 text-sky-500" />
            Software
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Tutti i software rilevati nel parco macchine, deduplicati per nome+versione, con elenco host.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filtri</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[220px] max-w-md">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Cerca nome o publisher…"
                className="pl-8"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground uppercase">Sorgenti:</span>
              {SOURCE_FILTERS.map((src) => {
                const active = sourceFilter.has(src);
                return (
                  <Button
                    key={src}
                    type="button"
                    size="sm"
                    variant={active ? "default" : "outline"}
                    onClick={() => toggleSource(src)}
                  >
                    {src}
                  </Button>
                );
              })}
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="only-vulns"
                checked={onlyWithVulns}
                onCheckedChange={(v) => {
                  setOnlyWithVulns(Boolean(v));
                  setPage(1);
                }}
              />
              <Label htmlFor="only-vulns" className="text-sm">Solo con vulnerabilità</Label>
            </div>
            {hasFilters && (
              <Button type="button" variant="ghost" size="sm" onClick={resetFilters}>
                Reset
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4">
          {error && <div className="p-4 text-sm text-destructive">{error}</div>}
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <SortableTableHead columnId="" sortColumn={sortBy} sortDirection={sortDir} onSort={() => {}} className="w-8">{""}</SortableTableHead>
                  <SortableTableHead columnId="name" sortColumn={sortBy} sortDirection={sortDir} onSort={onSort}>Nome</SortableTableHead>
                  <SortableTableHead columnId="version" sortColumn={sortBy} sortDirection={sortDir} onSort={() => {}}>Versione</SortableTableHead>
                  <SortableTableHead columnId="publisher" sortColumn={sortBy} sortDirection={sortDir} onSort={() => {}}>Publisher</SortableTableHead>
                  <SortableTableHead columnId="sources" sortColumn={sortBy} sortDirection={sortDir} onSort={() => {}}>Sorgenti</SortableTableHead>
                  <SortableTableHead columnId="host_count" sortColumn={sortBy} sortDirection={sortDir} onSort={onSort} className="text-right">Host</SortableTableHead>
                  <SortableTableHead columnId="vuln_count" sortColumn={sortBy} sortDirection={sortDir} onSort={onSort} className="text-right">CVE</SortableTableHead>
                  <SortableTableHead columnId="latest_seen_at" sortColumn={sortBy} sortDirection={sortDir} onSort={onSort}>Ultimo visto</SortableTableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-10 text-muted-foreground">
                      <Loader2 className="inline h-4 w-4 animate-spin mr-2" /> Caricamento…
                    </TableCell>
                  </TableRow>
                )}
                {!loading && data.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-10 text-muted-foreground">
                      {hasFilters
                        ? "Nessun software trovato con questi filtri."
                        : "Nessun software inventariato. Esegui scan probe (Windows/Linux) o configura Wazuh."}
                    </TableCell>
                  </TableRow>
                )}
                {!loading && data.map((row) => {
                  const isOpen = expanded.has(row.key);
                  return (
                    <RowGroup
                      key={row.key}
                      row={row}
                      isOpen={isOpen}
                      onToggle={() => toggleExpand(row.key)}
                      onOpenDrillDown={openDrillDown}
                    />
                  );
                })}
              </TableBody>
            </Table>
          </div>
          {!loading && total > 0 && (
            <div className="flex items-center justify-between gap-3 pt-3 text-sm text-muted-foreground">
              <span>
                Mostrando {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} di {total}
              </span>
            </div>
          )}
          <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Host con — {dialogKey}</DialogTitle>
          </DialogHeader>
          {dialogLoading ? (
            <div className="text-center py-10 text-muted-foreground">
              <Loader2 className="inline h-4 w-4 animate-spin mr-2" /> Caricamento…
            </div>
          ) : (
            <HostsTable hosts={dialogHosts} />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RowGroup({
  row,
  isOpen,
  onToggle,
  onOpenDrillDown,
}: {
  row: AggregatedSoftwareUi;
  isOpen: boolean;
  onToggle: () => void;
  onOpenDrillDown: (key: string) => void;
}) {
  const vulnLink = `/vulnerabilities?search=${encodeURIComponent(row.name)}`;
  return (
    <>
      <TableRow className="cursor-pointer hover:bg-muted/40" onClick={onToggle}>
        <TableCell className="w-8">
          {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </TableCell>
        <TableCell className="max-w-[20rem] truncate font-medium" title={row.name}>{row.name}</TableCell>
        <TableCell className="font-mono text-xs">{row.version ?? "—"}</TableCell>
        <TableCell className="text-sm text-muted-foreground max-w-[14rem] truncate" title={row.publisher ?? ""}>
          {row.publisher ?? "—"}
        </TableCell>
        <TableCell><SourcesBadges sources={row.sources} /></TableCell>
        <TableCell className="text-right tabular-nums">{row.host_count}</TableCell>
        <TableCell className="text-right tabular-nums">
          {row.vuln_count > 0 ? (
            <Link
              href={vulnLink}
              onClick={(e) => e.stopPropagation()}
              className="text-red-600 dark:text-red-400 hover:underline font-medium"
            >
              {row.vuln_count}
            </Link>
          ) : (
            <span className="text-muted-foreground">0</span>
          )}
        </TableCell>
        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
          {formatDate(row.latest_seen_at)}
        </TableCell>
      </TableRow>
      {isOpen && (
        <TableRow>
          <TableCell colSpan={8} className="bg-muted/20 p-0">
            <div className="p-3">
              <HostsTable hosts={row.hosts_preview} compact />
              {row.host_count > row.hosts_preview.length && (
                <div className="mt-2 text-right">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenDrillDown(row.key);
                    }}
                  >
                    Vedi tutti gli host ({row.host_count})
                  </Button>
                </div>
              )}
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

function HostsTable({ hosts, compact = false }: { hosts: SoftwareHostRef[]; compact?: boolean }) {
  if (hosts.length === 0) {
    return <p className="text-sm text-muted-foreground p-3">Nessun host nei dati.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className={compact ? "w-full text-xs" : "w-full text-sm"}>
        <thead className="text-muted-foreground">
          <tr>
            <th className="text-left py-1 pr-3">Host</th>
            <th className="text-left py-1 pr-3">IP</th>
            <th className="text-left py-1 pr-3">Network</th>
            <th className="text-left py-1 pr-3">Publisher</th>
            <th className="text-left py-1 pr-3">Fonti</th>
            <th className="text-left py-1 pr-3">Installato</th>
            <th className="text-left py-1 pr-3">Visto</th>
          </tr>
        </thead>
        <tbody>
          {hosts.map((h) => (
            <tr key={h.host_id} className="border-t border-border/40">
              <td className="py-1 pr-3">
                <Link href={`/hosts/${h.host_id}`} className="hover:underline">
                  {h.hostname ?? `host #${h.host_id}`}
                </Link>
              </td>
              <td className="py-1 pr-3 font-mono">{h.ip || "—"}</td>
              <td className="py-1 pr-3 text-muted-foreground">{h.network_name ?? "—"}</td>
              <td className="py-1 pr-3 text-muted-foreground max-w-[12rem] truncate" title={h.publisher ?? ""}>{h.publisher ?? "—"}</td>
              <td className="py-1 pr-3"><SourcesBadges sources={h.sources} /></td>
              <td className="py-1 pr-3 text-muted-foreground whitespace-nowrap">{formatDate(h.install_date)}</td>
              <td className="py-1 pr-3 text-muted-foreground whitespace-nowrap">{formatDate(h.scanned_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

