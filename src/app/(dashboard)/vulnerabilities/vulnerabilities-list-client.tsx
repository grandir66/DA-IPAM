"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ChevronDown,
  ChevronRight,
  ShieldAlert,
  Search,
  Loader2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
import { CveLink, SourcesBadges } from "@/components/shared/vuln-badges";
import { SEVERITY_STYLE, SEVERITIES, type Severity } from "@/lib/severity-style";

interface VulnHostRef {
  host_id: number | null;
  ip: string;
  hostname: string | null;
  network_id: number | null;
  network_name: string | null;
  severity: string;
  cvss_score: number | null;
  source: string;
  package_label: string | null;
  scanned_at: string;
}

interface AggregatedVulnUi {
  key: string;
  cve_id: string | null;
  nvt_oid: string | null;
  severity: Severity;
  cvss_score: number | null;
  package_label: string | null;
  sources: string[];
  host_count: number;
  orphan_count: number;
  hosts_preview: VulnHostRef[];
  latest_scanned_at: string;
}

interface ApiResponse {
  data: AggregatedVulnUi[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  severity_rollup: { Critical: number; High: number; Medium: number; Low: number };
}

const PAGE_SIZE = 50;
const SOURCE_FILTERS = ["Edge", "Wazuh"] as const;
type OsFamily = "Windows" | "Linux" | "Apple" | "Unknown";
const OS_FILTERS: OsFamily[] = ["Windows", "Linux", "Apple", "Unknown"];

function formatDate(ts: string | null): string {
  if (!ts) return "—";
  try {
    return new Date(ts).toLocaleDateString("it-IT");
  } catch {
    return ts;
  }
}

export function VulnerabilitiesListClient() {
  const [data, setData] = useState<AggregatedVulnUi[]>([]);
  const [total, setTotal] = useState(0);
  const [rollup, setRollup] = useState({ Critical: 0, High: 0, Medium: 0, Low: 0 });
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [severityFilter, setSeverityFilter] = useState<Set<Severity>>(new Set());
  const [sourceFilter, setSourceFilter] = useState<Set<string>>(new Set());
  const [osFilter, setOsFilter] = useState<Set<OsFamily>>(new Set());
  const [onlyWithCve, setOnlyWithCve] = useState(false);

  const [sortBy, setSortBy] = useState("severity");
  const [sortDir, setSortDir] = useState<SortDirection>("desc");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogKey, setDialogKey] = useState<string | null>(null);
  const [dialogHosts, setDialogHosts] = useState<VulnHostRef[]>([]);
  const [dialogLoading, setDialogLoading] = useState(false);

  // search input → debounce 300ms
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
    if (severityFilter.size > 0) sp.set("severity", [...severityFilter].join(","));
    if (sourceFilter.size > 0) sp.set("sources", [...sourceFilter].join(","));
    if (osFilter.size > 0) sp.set("os", [...osFilter].join(","));
    if (onlyWithCve) sp.set("hasCve", "true");
    return sp.toString();
  }, [page, sortBy, sortDir, search, severityFilter, sourceFilter, osFilter, onlyWithCve]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/vulnerabilities?${params}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<ApiResponse>;
      })
      .then((res) => {
        if (cancelled) return;
        setData(res.data);
        setTotal(res.total);
        setTotalPages(res.totalPages);
        setRollup(res.severity_rollup);
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

  // URL search preset (es. ?search=Firefox) — letto solo al primo mount
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
      if (columnId === sortBy) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      } else {
        setSortBy(columnId);
        setSortDir("desc");
      }
      setPage(1);
    },
    [sortBy],
  );

  const toggleSeverity = (sev: Severity) => {
    setSeverityFilter((prev) => {
      const next = new Set(prev);
      if (next.has(sev)) next.delete(sev);
      else next.add(sev);
      return next;
    });
    setPage(1);
  };

  const toggleSource = (src: string) => {
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
      const r = await fetch(`/api/vulnerabilities/${encodeURIComponent(key)}/hosts`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as { hosts: VulnHostRef[] };
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
    setSeverityFilter(new Set());
    setSourceFilter(new Set());
    setOsFilter(new Set());
    setOnlyWithCve(false);
    setPage(1);
  };

  const hasFilters = search || severityFilter.size > 0 || sourceFilter.size > 0 || osFilter.size > 0 || onlyWithCve;

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <ShieldAlert className="h-6 w-6 text-orange-500" />
            Vulnerabilità
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Tutte le CVE rilevate da edge-scan e Wazuh, aggregate per CVE con elenco host affetti.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {(["Critical", "High", "Medium", "Low"] as Severity[]).map((sev) => (
            <Badge key={sev} className={SEVERITY_STYLE[sev]}>
              {sev}: {rollup[sev]}
            </Badge>
          ))}
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
                placeholder="Cerca CVE, pacchetto, NVT OID…"
                className="pl-8"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground uppercase">Severità:</span>
              {SEVERITIES.map((sev) => {
                const active = severityFilter.has(sev);
                return (
                  <Button
                    key={sev}
                    type="button"
                    size="sm"
                    variant={active ? "default" : "outline"}
                    className={active ? SEVERITY_STYLE[sev] : ""}
                    onClick={() => toggleSeverity(sev)}
                  >
                    {sev}
                  </Button>
                );
              })}
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
              <span className="text-xs font-medium text-muted-foreground uppercase">OS:</span>
              {OS_FILTERS.map((os) => {
                const active = osFilter.has(os);
                return (
                  <Button
                    key={os}
                    type="button"
                    size="sm"
                    variant={active ? "default" : "outline"}
                    onClick={() => {
                      setOsFilter((prev) => {
                        const next = new Set(prev);
                        if (next.has(os)) next.delete(os);
                        else next.add(os);
                        return next;
                      });
                      setPage(1);
                    }}
                  >
                    {os}
                  </Button>
                );
              })}
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="only-cve"
                checked={onlyWithCve}
                onCheckedChange={(v) => {
                  setOnlyWithCve(Boolean(v));
                  setPage(1);
                }}
              />
              <Label htmlFor="only-cve" className="text-sm">Solo con CVE</Label>
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
          {error && (
            <div className="p-4 text-sm text-destructive">{error}</div>
          )}
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <SortableTableHead columnId="" sortColumn={sortBy} sortDirection={sortDir} onSort={() => {}} className="w-8" >{""}</SortableTableHead>
                  <SortableTableHead columnId="cve_id" sortColumn={sortBy} sortDirection={sortDir} onSort={onSort}>CVE</SortableTableHead>
                  <SortableTableHead columnId="severity" sortColumn={sortBy} sortDirection={sortDir} onSort={onSort}>Severità</SortableTableHead>
                  <SortableTableHead columnId="cvss" sortColumn={sortBy} sortDirection={sortDir} onSort={onSort}>CVSS</SortableTableHead>
                  <SortableTableHead columnId="package" sortColumn={sortBy} sortDirection={sortDir} onSort={() => {}}>Pacchetto / NVT</SortableTableHead>
                  <SortableTableHead columnId="sources" sortColumn={sortBy} sortDirection={sortDir} onSort={() => {}}>Sorgenti</SortableTableHead>
                  <SortableTableHead columnId="host_count" sortColumn={sortBy} sortDirection={sortDir} onSort={onSort} className="text-right">Host</SortableTableHead>
                  <SortableTableHead columnId="latest_scanned_at" sortColumn={sortBy} sortDirection={sortDir} onSort={onSort}>Ultimo</SortableTableHead>
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
                        ? "Nessuna vulnerabilità trovata con questi filtri."
                        : "Nessuna vulnerabilità archiviata. Configura scanner-edge o Wazuh in Impostazioni → Integrazioni."}
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
            <DialogTitle>Host affetti — {dialogKey}</DialogTitle>
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
  row: AggregatedVulnUi;
  isOpen: boolean;
  onToggle: () => void;
  onOpenDrillDown: (key: string) => void;
}) {
  return (
    <>
      <TableRow className="cursor-pointer hover:bg-muted/40" onClick={onToggle}>
        <TableCell className="w-8">
          {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </TableCell>
        <TableCell><CveLink cve={row.cve_id} /></TableCell>
        <TableCell><Badge className={SEVERITY_STYLE[row.severity]}>{row.severity}</Badge></TableCell>
        <TableCell className="font-mono text-xs">{row.cvss_score?.toFixed(1) ?? "—"}</TableCell>
        <TableCell className="max-w-[28rem] truncate" title={row.package_label ?? ""}>
          {row.package_label ?? <span className="text-muted-foreground">—</span>}
        </TableCell>
        <TableCell><SourcesBadges sources={row.sources} /></TableCell>
        <TableCell className="text-right tabular-nums">
          {row.host_count}
          {row.orphan_count > 0 && (
            <span className="ml-1 text-[10px] text-muted-foreground">(+{row.orphan_count} senza match)</span>
          )}
        </TableCell>
        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
          {formatDate(row.latest_scanned_at)}
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

function HostsTable({ hosts, compact = false }: { hosts: VulnHostRef[]; compact?: boolean }) {
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
            <th className="text-left py-1 pr-3">Severità</th>
            <th className="text-left py-1 pr-3">CVSS</th>
            <th className="text-left py-1 pr-3">Fonte</th>
            <th className="text-left py-1 pr-3">Rilevato</th>
          </tr>
        </thead>
        <tbody>
          {hosts.map((h, i) => (
            <tr key={`${h.host_id ?? "ip:" + h.ip}-${h.source}-${i}`} className="border-t border-border/40">
              <td className="py-1 pr-3">
                {h.host_id != null ? (
                  <Link href={`/hosts/${h.host_id}`} className="hover:underline">
                    {h.hostname ?? `host #${h.host_id}`}
                  </Link>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
              <td className="py-1 pr-3 font-mono">{h.ip || "—"}</td>
              <td className="py-1 pr-3 text-muted-foreground">{h.network_name ?? "—"}</td>
              <td className="py-1 pr-3"><Badge className={`text-[10px] px-1.5 py-0 ${SEVERITY_STYLE[h.severity] ?? ""}`}>{h.severity}</Badge></td>
              <td className="py-1 pr-3 font-mono">{h.cvss_score?.toFixed(1) ?? "—"}</td>
              <td className="py-1 pr-3"><SourcesBadges sources={[h.source]} /></td>
              <td className="py-1 pr-3 text-muted-foreground whitespace-nowrap">{formatDate(h.scanned_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
