"use client";
import { parseDbDate, FUSO_UTENTI } from "@/lib/db-date";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ChevronDown,
  ChevronRight,
  ShieldAlert,
  Search,
  Loader2,
  RotateCw,
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
import { LoadError } from "@/components/shared/load-error";
import { CveLink, EpssCell, ExploitBadges, SourcesBadges, type ExploitUi } from "@/components/shared/vuln-badges";
import { SEVERITY_STYLE, SEVERITIES, type Severity } from "@/lib/severity-style";
import { fetchJson } from "@/lib/fetch-json";
import { useEAdmin } from "@/hooks/use-e-admin";

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
  exploit: ExploitUi | null;
}

interface VulnHostRowUi {
  host_key: string;
  host_id: number | null;
  ip: string;
  hostname: string | null;
  network_name: string | null;
  os_family: string | null;
  top_severity: Severity;
  counts: Record<Severity, number>;
  vuln_count: number;
  kev_count: number;
  edb_count: number;
  epss_max: number | null;
  sources: string[];
  latest_scanned_at: string;
}

interface VulnDiHostUi {
  key: string;
  cve_id: string | null;
  severity: Severity;
  cvss_score: number | null;
  package_label: string | null;
  ports: string[];
  sources: string[];
  scanned_at: string;
  exploit: ExploitUi | null;
}

interface ApiResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  severity_rollup: Record<Severity, number>;
  exploit_errore: string | null;
}

interface StatoFonteUi {
  fonte: "kev" | "exploitdb" | "epss";
  scaricato_at: string | null;
  righe: number;
  tentato_at: string | null;
  errore: string | null;
}

interface StatoFeedUi {
  fonti: StatoFonteUi[];
  acceso: boolean;
  in_corso: boolean;
}

type Vista = "cve" | "host";
type FiltroExploit = "kev" | "edb";

const PAGE_SIZE = 50;
const SOURCE_FILTERS = ["Edge", "Wazuh"] as const;
type OsFamily = "Windows" | "Linux" | "Apple" | "Unknown";
const OS_FILTERS: OsFamily[] = ["Windows", "Linux", "Apple", "Unknown"];
const EXPLOIT_FILTERS: Array<{ id: FiltroExploit; label: string }> = [
  { id: "kev", label: "Sfruttate" },
  { id: "edb", label: "Con exploit pubblico" },
];
const NOME_FONTE: Record<StatoFonteUi["fonte"], string> = { kev: "CISA KEV", exploitdb: "Exploit-DB", epss: "EPSS" };

function formatDate(ts: string | null): string {
  if (!ts) return "—";
  try {
    return parseDbDate(ts).toLocaleDateString("it-IT");
  } catch {
    return ts;
  }
}

/** «22/10 alle 06:00», in ora italiana (il DB scrive UTC). */
function formatQuando(ts: string): string {
  const d = parseDbDate(ts);
  if (Number.isNaN(d.getTime())) return ts;
  const giorno = d.toLocaleDateString("it-IT", { timeZone: FUSO_UTENTI, day: "2-digit", month: "2-digit" });
  const ora = d.toLocaleTimeString("it-IT", { timeZone: FUSO_UTENTI, hour: "2-digit", minute: "2-digit" });
  return `${giorno} alle ${ora}`;
}

function leggiVistaDaUrl(): Vista {
  if (typeof window === "undefined") return "cve";
  return new URLSearchParams(window.location.search).get("vista") === "host" ? "host" : "cve";
}

export function VulnerabilitiesListClient() {
  const [vista, setVista] = useState<Vista>("cve");
  const [dataCve, setDataCve] = useState<AggregatedVulnUi[]>([]);
  const [dataHost, setDataHost] = useState<VulnHostRowUi[]>([]);
  const [total, setTotal] = useState(0);
  const [rollup, setRollup] = useState<Record<Severity, number>>({ Critical: 0, High: 0, Medium: 0, Low: 0 });
  const [exploitErrore, setExploitErrore] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ricarica, setRicarica] = useState(0);

  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [severityFilter, setSeverityFilter] = useState<Set<Severity>>(new Set());
  const [sourceFilter, setSourceFilter] = useState<Set<string>>(new Set());
  const [osFilter, setOsFilter] = useState<Set<OsFamily>>(new Set());
  const [exploitFilter, setExploitFilter] = useState<Set<FiltroExploit>>(new Set());
  const [onlyWithCve, setOnlyWithCve] = useState(false);
  // Di base solo l'ultima scansione di ogni rete; le precedenti col pulsante (Riccardo, 27/10/2026).
  const [precedenti, setPrecedenti] = useState(false);

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
    if (exploitFilter.size > 0) sp.set("exploit", [...exploitFilter].join(","));
    if (onlyWithCve) sp.set("hasCve", "true");
    if (precedenti) sp.set("precedenti", "1");
    return sp.toString();
  }, [page, sortBy, sortDir, search, severityFilter, sourceFilter, osFilter, exploitFilter, onlyWithCve, precedenti]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const url = vista === "host" ? `/api/vulnerabilities/per-host?${params}` : `/api/vulnerabilities?${params}`;
    void (async () => {
      const r = await fetchJson<ApiResponse<AggregatedVulnUi | VulnHostRowUi>>(url);
      if (cancelled) return;
      if (!r.ok) {
        setError(r.message);
      } else {
        if (vista === "host") setDataHost(r.data.data as VulnHostRowUi[]);
        else setDataCve(r.data.data as AggregatedVulnUi[]);
        setTotal(r.data.total);
        setTotalPages(r.data.totalPages);
        setRollup(r.data.severity_rollup);
        setExploitErrore(r.data.exploit_errore);
        setExpanded(new Set());
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [params, vista, ricarica]);

  // URL preset (es. ?search=Firefox, ?vista=host) — letto solo al primo mount
  useEffect(() => {
    if (typeof window === "undefined") return;
    const sp = new URLSearchParams(window.location.search);
    const s = sp.get("search");
    if (s) {
      setSearchInput(s);
      setSearch(s);
    }
    setVista(leggiVistaDaUrl());
  }, []);

  const cambiaVista = (v: Vista) => {
    if (v === vista) return;
    setVista(v);
    setSortBy("severity");
    setSortDir("desc");
    setPage(1);
    setExpanded(new Set());
    try {
      const url = new URL(window.location.href);
      if (v === "host") url.searchParams.set("vista", "host");
      else url.searchParams.delete("vista");
      window.history.replaceState(null, "", url.toString());
    } catch {
      /* l'URL è solo una comodità */
    }
  };

  const onSort = useCallback(
    (columnId: string) => {
      if (columnId === sortBy) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      } else {
        setSortBy(columnId);
        setSortDir(columnId === "ip" ? "asc" : "desc");
      }
      setPage(1);
    },
    [sortBy],
  );

  function alterna<T>(set: (f: (prev: Set<T>) => Set<T>) => void, v: T) {
    set((prev) => {
      const next = new Set(prev);
      if (next.has(v)) next.delete(v);
      else next.add(v);
      return next;
    });
    setPage(1);
  }

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
    const r = await fetchJson<{ hosts: VulnHostRef[] }>(`/api/vulnerabilities/${encodeURIComponent(key)}/hosts`);
    setDialogHosts(r.ok ? r.data.hosts : []);
    setDialogLoading(false);
  };

  const resetFilters = () => {
    setSearchInput("");
    setSearch("");
    setSeverityFilter(new Set());
    setSourceFilter(new Set());
    setOsFilter(new Set());
    setExploitFilter(new Set());
    setOnlyWithCve(false);
    setPage(1);
  };

  const hasFilters =
    search || severityFilter.size > 0 || sourceFilter.size > 0 || osFilter.size > 0 || exploitFilter.size > 0 || onlyWithCve;
  const righe = vista === "host" ? dataHost.length : dataCve.length;
  const colonne = vista === "host" ? 13 : 10;

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className="text-2xl font-semibold flex items-center gap-2">
              <ShieldAlert className="h-6 w-6 text-orange-500" />
              Vulnerabilità
            </h1>
            <div role="group" aria-label="Raggruppa le vulnerabilità" className="inline-flex rounded-lg border border-foreground/70 overflow-hidden">
              {(["cve", "host"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={vista === v}
                  onClick={() => cambiaVista(v)}
                  className={`h-8 px-3 text-sm ${vista === v ? "bg-foreground text-background font-medium" : "bg-card hover:bg-muted"}`}
                >
                  {v === "cve" ? "Per vulnerabilità" : "Per host"}
                </button>
              ))}
            </div>
            {/* Paginazione nella riga del titolo (Riccardo, 20/10): sotto la tabella occupava spazio. */}
            {!loading && total > 0 && (
              <Pagination inTesta page={page} totalPages={totalPages} onPageChange={setPage} pageSize={PAGE_SIZE} total={total} />
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            {vista === "host"
              ? "Gli host con vulnerabilità rilevate da edge-scan e Wazuh, con l'elenco completo per host."
              : "Tutte le CVE rilevate da edge-scan e Wazuh, aggregate per CVE con elenco host affetti."}
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
                placeholder="Cerca host, IP, CVE, pacchetto…"
                aria-label="Cerca"
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
                    onClick={() => alterna(setSeverityFilter, sev)}
                  >
                    {sev}
                  </Button>
                );
              })}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground uppercase">Sorgenti:</span>
              {SOURCE_FILTERS.map((src) => (
                <Button
                  key={src}
                  type="button"
                  size="sm"
                  variant={sourceFilter.has(src) ? "default" : "outline"}
                  onClick={() => alterna(setSourceFilter, src)}
                >
                  {src}
                </Button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground uppercase">OS:</span>
              {OS_FILTERS.map((os) => (
                <Button
                  key={os}
                  type="button"
                  size="sm"
                  variant={osFilter.has(os) ? "default" : "outline"}
                  onClick={() => alterna(setOsFilter, os)}
                >
                  {os}
                </Button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground uppercase">Exploit:</span>
              {EXPLOIT_FILTERS.map((f) => (
                <Button
                  key={f.id}
                  type="button"
                  size="sm"
                  variant={exploitFilter.has(f.id) ? "default" : "outline"}
                  onClick={() => alterna(setExploitFilter, f.id)}
                >
                  {f.label}
                </Button>
              ))}
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
            <Button
              type="button"
              size="sm"
              variant={precedenti ? "default" : "outline"}
              aria-pressed={precedenti}
              onClick={() => { setPrecedenti((v) => !v); setPage(1); }}
            >
              {precedenti ? "Solo l'ultima scansione" : "Mostra anche le scansioni precedenti"}
            </Button>
            {hasFilters && (
              <Button type="button" variant="ghost" size="sm" onClick={resetFilters}>
                Reset
              </Button>
            )}
          </div>
          <StatoFeedExploit errorePagina={exploitErrore} onAggiornato={() => setRicarica((n) => n + 1)} />
        </CardContent>
      </Card>

      {error ? (
        <LoadError what="le vulnerabilità" message={error} onRetry={() => setRicarica((n) => n + 1)} />
      ) : (
        <Card>
          <CardContent className="pt-4">
            <div className="overflow-x-auto">
              <Table fissa riserva={52}>
                <TableHeader>
                  {vista === "host" ? (
                    <TableRow>
                      <SortableTableHead columnId="" sortColumn={sortBy} sortDirection={sortDir} onSort={() => {}} className="w-8">{""}</SortableTableHead>
                      <SortableTableHead columnId="host" sortColumn={sortBy} sortDirection={sortDir} onSort={() => {}}>Host</SortableTableHead>
                      <SortableTableHead columnId="ip" sortColumn={sortBy} sortDirection={sortDir} onSort={onSort}>IP</SortableTableHead>
                      <SortableTableHead columnId="rete" sortColumn={sortBy} sortDirection={sortDir} onSort={() => {}}>Rete</SortableTableHead>
                      <SortableTableHead columnId="os" sortColumn={sortBy} sortDirection={sortDir} onSort={() => {}}>OS</SortableTableHead>
                      <SortableTableHead columnId="severity" sortColumn={sortBy} sortDirection={sortDir} onSort={onSort} className="text-center">Crit.</SortableTableHead>
                      <SortableTableHead columnId="high" sortColumn={sortBy} sortDirection={sortDir} onSort={() => {}} className="text-center">High</SortableTableHead>
                      <SortableTableHead columnId="medium" sortColumn={sortBy} sortDirection={sortDir} onSort={() => {}} className="text-center">Med.</SortableTableHead>
                      <SortableTableHead columnId="low" sortColumn={sortBy} sortDirection={sortDir} onSort={() => {}} className="text-center">Low</SortableTableHead>
                      <SortableTableHead columnId="exploit" sortColumn={sortBy} sortDirection={sortDir} onSort={onSort}>Exploit</SortableTableHead>
                      <SortableTableHead columnId="epss" sortColumn={sortBy} sortDirection={sortDir} onSort={() => {}}>EPSS max</SortableTableHead>
                      <SortableTableHead columnId="sources" sortColumn={sortBy} sortDirection={sortDir} onSort={() => {}}>Fonti</SortableTableHead>
                      <SortableTableHead columnId="latest_scanned_at" sortColumn={sortBy} sortDirection={sortDir} onSort={onSort}>Ultimo</SortableTableHead>
                    </TableRow>
                  ) : (
                    <TableRow>
                      <SortableTableHead columnId="" sortColumn={sortBy} sortDirection={sortDir} onSort={() => {}} className="w-8">{""}</SortableTableHead>
                      <SortableTableHead columnId="cve_id" sortColumn={sortBy} sortDirection={sortDir} onSort={onSort}>CVE</SortableTableHead>
                      <SortableTableHead columnId="severity" sortColumn={sortBy} sortDirection={sortDir} onSort={onSort}>Severità</SortableTableHead>
                      <SortableTableHead columnId="cvss" sortColumn={sortBy} sortDirection={sortDir} onSort={onSort}>CVSS</SortableTableHead>
                      <SortableTableHead columnId="package" sortColumn={sortBy} sortDirection={sortDir} onSort={() => {}}>Pacchetto / NVT</SortableTableHead>
                      <SortableTableHead columnId="exploit" sortColumn={sortBy} sortDirection={sortDir} onSort={onSort}>Exploit</SortableTableHead>
                      <SortableTableHead columnId="epss" sortColumn={sortBy} sortDirection={sortDir} onSort={() => {}}>EPSS</SortableTableHead>
                      <SortableTableHead columnId="sources" sortColumn={sortBy} sortDirection={sortDir} onSort={() => {}}>Sorgenti</SortableTableHead>
                      <SortableTableHead columnId="host_count" sortColumn={sortBy} sortDirection={sortDir} onSort={onSort} className="text-right">Host</SortableTableHead>
                      <SortableTableHead columnId="latest_scanned_at" sortColumn={sortBy} sortDirection={sortDir} onSort={onSort}>Ultimo</SortableTableHead>
                    </TableRow>
                  )}
                </TableHeader>
                <TableBody>
                  {loading && (
                    <TableRow>
                      <TableCell colSpan={colonne} className="text-center py-10 text-muted-foreground">
                        <Loader2 className="inline h-4 w-4 animate-spin mr-2" /> Caricamento…
                      </TableCell>
                    </TableRow>
                  )}
                  {!loading && righe === 0 && (
                    <TableRow>
                      <TableCell colSpan={colonne} className="text-center py-10 text-muted-foreground">
                        {hasFilters ? (
                          "Nessuna vulnerabilità trovata con questi filtri."
                        ) : (
                          <>
                            Nessuna vulnerabilità archiviata. Configura lo Scanner-Edge o Wazuh in{" "}
                            <Link href="/settings?tab=moduli" className="underline underline-offset-2 hover:text-foreground">
                              Impostazioni → Moduli
                            </Link>
                            .
                          </>
                        )}
                      </TableCell>
                    </TableRow>
                  )}
                  {!loading && vista === "cve" && dataCve.map((row) => (
                    <RowGroup
                      key={row.key}
                      row={row}
                      isOpen={expanded.has(row.key)}
                      onToggle={() => toggleExpand(row.key)}
                      onOpenDrillDown={openDrillDown}
                    />
                  ))}
                  {!loading && vista === "host" && dataHost.map((row) => (
                    <HostRow
                      key={row.host_key}
                      row={row}
                      isOpen={expanded.has(row.host_key)}
                      onToggle={() => toggleExpand(row.host_key)}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

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

/**
 * Una riga, sotto i filtri: quando sono arrivati i dati sugli exploit, da quali fonti, e
 * l'errore se una fonte non risponde. «Aggiorna ora» solo per gli admin.
 */
function StatoFeedExploit({ errorePagina, onAggiornato }: { errorePagina: string | null; onAggiornato: () => void }) {
  const admin = useEAdmin();
  const [stato, setStato] = useState<StatoFeedUi | null>(null);
  const [erroreStato, setErroreStato] = useState<string | null>(null);
  const [inCorso, setInCorso] = useState(false);

  const carica = useCallback(async () => {
    const r = await fetchJson<StatoFeedUi>("/api/vulnerabilities/exploit-feed");
    if (r.ok) {
      setStato(r.data);
      setErroreStato(null);
    } else setErroreStato(r.message);
  }, []);
  useEffect(() => {
    void carica();
  }, [carica]);

  const aggiorna = async () => {
    setInCorso(true);
    const r = await fetchJson<StatoFeedUi>("/api/vulnerabilities/exploit-feed", { method: "POST" });
    setInCorso(false);
    if (r.ok) {
      setStato(r.data);
      setErroreStato(null);
      onAggiornato();
    } else setErroreStato(r.message);
  };

  const guasti = stato?.fonti.filter((f) => f.errore) ?? [];
  const mai = stato ? stato.fonti.every((f) => !f.scaricato_at) : false;
  const ultimi = stato?.fonti.map((f) => f.scaricato_at).filter((x): x is string => !!x).sort() ?? [];
  const piuVecchio = ultimi[0];

  let testo: string;
  if (errorePagina) testo = `Exploit: ${errorePagina}`;
  else if (erroreStato) testo = `Stato dei dati sugli exploit non letto: ${erroreStato}`;
  else if (!stato) testo = "Dati sugli exploit…";
  else if (mai) testo = "Dati sugli exploit non ancora scaricati: le colonne Exploit ed EPSS restano vuote";
  else testo = `Dati sugli exploit aggiornati il ${formatQuando(piuVecchio!)} · CISA KEV · Exploit-DB · EPSS`;
  const attenzione = !!errorePagina || !!erroreStato || mai || guasti.length > 0;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted-foreground">
      <span className={attenzione ? "text-amber-800 dark:text-amber-300" : ""}>{attenzione ? "▲ " : ""}{testo}</span>
      {guasti.map((f) => (
        <span key={f.fonte} className="text-amber-800 dark:text-amber-300" title={f.errore ?? ""}>
          ▲ {NOME_FONTE[f.fonte]} non aggiornato{f.tentato_at ? ` (tentativo del ${formatQuando(f.tentato_at)})` : ""}: {f.errore}
        </span>
      ))}
      {stato && !stato.acceso && <span>· scaricamento giornaliero spento in Opzioni</span>}
      {admin && (
        <Button type="button" variant="outline" size="sm" className="h-7 text-xs" disabled={inCorso || stato?.in_corso} onClick={() => void aggiorna()}>
          {inCorso ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <RotateCw className="h-3.5 w-3.5 mr-1" />}
          {inCorso ? "Scaricamento…" : "Aggiorna ora"}
        </Button>
      )}
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
        <TableCell className="max-w-[16rem] 2xl:max-w-[28rem] truncate" title={row.package_label ?? ""}>
          {row.package_label ?? <span className="text-muted-foreground">—</span>}
        </TableCell>
        <TableCell><ExploitBadges exploit={row.exploit} /></TableCell>
        <TableCell><EpssCell epss={row.exploit?.epss} /></TableCell>
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
          <TableCell colSpan={10} className="bg-muted/20 p-0">
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

function ConteggioSeverita({ sev, n }: { sev: Severity; n: number }) {
  if (n === 0) return <span className="text-muted-foreground">–</span>;
  return <Badge className={`min-w-[1.75rem] justify-center tabular-nums ${SEVERITY_STYLE[sev]}`}>{n}</Badge>;
}

function HostRow({ row, isOpen, onToggle }: { row: VulnHostRowUi; isOpen: boolean; onToggle: () => void }) {
  return (
    <>
      <TableRow className={`cursor-pointer hover:bg-muted/40 ${isOpen ? "bg-primary/10" : ""}`} onClick={onToggle}>
        <TableCell className="w-8">
          {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </TableCell>
        <TableCell className="font-medium">
          {row.host_id != null ? (
            <Link href={`/hosts/${row.host_id}`} className="hover:underline" onClick={(e) => e.stopPropagation()}>
              {row.hostname || `host #${row.host_id}`}
            </Link>
          ) : (
            <span className="text-muted-foreground" title="IP trovato dallo scanner ma non agganciato a un host dell'inventario">
              (senza match)
            </span>
          )}
        </TableCell>
        <TableCell className="font-mono text-xs">{row.ip || "—"}</TableCell>
        <TableCell className="text-muted-foreground">{row.network_name ?? "—"}</TableCell>
        <TableCell>{row.os_family ?? "—"}</TableCell>
        {(["Critical", "High", "Medium", "Low"] as const).map((sev) => (
          <TableCell key={sev} className="text-center"><ConteggioSeverita sev={sev} n={row.counts[sev]} /></TableCell>
        ))}
        <TableCell>
          {row.kev_count === 0 && row.edb_count === 0 ? (
            <span className="text-xs text-muted-foreground">—</span>
          ) : (
            <div className="flex flex-wrap gap-1">
              {row.kev_count > 0 && (
                <span className="inline-flex items-center gap-1 h-[22px] px-2 rounded-md text-[13px] font-semibold whitespace-nowrap bg-red-950 text-white ring-1 ring-red-300/60">
                  <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true"><path d="M6 1 11 10H1z" fill="currentColor" /></svg>
                  {row.kev_count} {row.kev_count === 1 ? "sfruttata" : "sfruttate"}
                </span>
              )}
              {row.edb_count > 0 && (
                <span className="inline-flex items-center gap-1 h-[22px] px-2 rounded-md text-[13px] font-semibold whitespace-nowrap bg-white text-red-950 border-2 border-red-950">
                  <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true"><rect x="2" y="2" width="8" height="8" fill="none" stroke="currentColor" strokeWidth="2" /></svg>
                  {row.edb_count} con exploit
                </span>
              )}
            </div>
          )}
        </TableCell>
        <TableCell><EpssCell epss={row.epss_max} /></TableCell>
        <TableCell><SourcesBadges sources={row.sources} /></TableCell>
        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{formatDate(row.latest_scanned_at)}</TableCell>
      </TableRow>
      {isOpen && (
        <TableRow>
          <TableCell colSpan={13} className="bg-muted/20 p-0">
            <DettaglioHost row={row} />
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

/** Un host Windows con Wazuh arriva a migliaia di CVE (4.420 sul cliente A, 22/10): se ne disegnano 200 alla volta. */
const DETTAGLIO_PRIMI = 200;

function DettaglioHost({ row }: { row: VulnHostRowUi }) {
  const [vulns, setVulns] = useState<VulnDiHostUi[] | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [tutte, setTutte] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const r = await fetchJson<{ vulns: VulnDiHostUi[] }>(
        `/api/vulnerabilities/per-host/dettaglio?host=${encodeURIComponent(row.host_key)}`,
      );
      if (cancelled) return;
      if (r.ok) setVulns(r.data.vulns);
      else setErrore(r.message);
    })();
    return () => {
      cancelled = true;
    };
  }, [row.host_key]);

  const nome = row.hostname || row.ip;
  return (
    <div className="p-3 space-y-2">
      {errore ? (
        <p className="text-sm text-destructive">Impossibile caricare le vulnerabilità di {nome}: {errore}</p>
      ) : !vulns ? (
        <p className="text-sm text-muted-foreground"><Loader2 className="inline h-4 w-4 animate-spin mr-2" />Caricamento…</p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            Tutte le {vulns.length} vulnerabilità di {nome}, le sfruttate in cima (i filtri qui non valgono)
          </p>
          <div className="overflow-x-auto rounded-md border border-border/60 bg-card">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground">
                <tr>
                  <th className="text-left py-1.5 px-2">CVE</th>
                  <th className="text-left py-1.5 px-2">Severità</th>
                  <th className="text-left py-1.5 px-2">CVSS</th>
                  <th className="text-left py-1.5 px-2">Pacchetto / NVT</th>
                  <th className="text-left py-1.5 px-2">Porta</th>
                  <th className="text-left py-1.5 px-2">Exploit</th>
                  <th className="text-left py-1.5 px-2">EPSS</th>
                  <th className="text-left py-1.5 px-2">Fonte</th>
                  <th className="text-left py-1.5 px-2">Rilevato</th>
                </tr>
              </thead>
              <tbody>
                {(tutte ? vulns : vulns.slice(0, DETTAGLIO_PRIMI)).map((v) => (
                  <tr key={v.key} className="border-t border-border/40">
                    <td className="py-1 px-2"><CveLink cve={v.cve_id} /></td>
                    <td className="py-1 px-2"><Badge className={`text-[10px] px-1.5 py-0 ${SEVERITY_STYLE[v.severity]}`}>{v.severity}</Badge></td>
                    <td className="py-1 px-2 font-mono">{v.cvss_score?.toFixed(1) ?? "—"}</td>
                    <td className="py-1 px-2 max-w-[26rem] truncate" title={v.package_label ?? ""}>{v.package_label ?? "—"}</td>
                    <td className="py-1 px-2 font-mono whitespace-nowrap" title={v.ports.join(", ")}>
                      {v.ports.length === 0 ? "—" : v.ports.length === 1 ? v.ports[0] : `${v.ports.length} porte`}
                    </td>
                    <td className="py-1 px-2"><ExploitBadges exploit={v.exploit} compatto /></td>
                    <td className="py-1 px-2"><EpssCell epss={v.exploit?.epss} /></td>
                    <td className="py-1 px-2"><SourcesBadges sources={v.sources} /></td>
                    <td className="py-1 px-2 text-muted-foreground whitespace-nowrap">{formatDate(v.scanned_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!tutte && vulns.length > DETTAGLIO_PRIMI && (
            <div className="text-center">
              <Button type="button" size="sm" variant="outline" onClick={() => setTutte(true)}>
                Mostra tutte ({vulns.length})
              </Button>
            </div>
          )}
          {row.host_id != null && (
            <div className="text-right">
              <Link href={`/hosts/${row.host_id}`} className="text-xs underline underline-offset-2 hover:text-foreground">
                Apri la scheda dell&apos;host →
              </Link>
            </div>
          )}
        </>
      )}
    </div>
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
