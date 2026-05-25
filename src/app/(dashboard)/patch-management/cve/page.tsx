"use client";

/**
 * Patch Management — Lista CVE (F6 PR1, spostata da `/patch-management` in F15).
 *
 * Client Component: fetch `/api/patch/cve` → tabella shadcn con filtri
 * (severity, search testuale client-side, "solo con fix"), paginazione
 * 50/pagina, riga cliccabile verso drill-down `/patch-management/cve/[cveId]`
 * (F7).
 *
 * In F12 la home `/patch-management` è diventata l'hub asset-first
 * (tab Device / Software). Questa pagina rimane per chi vuole filtrare per CVE.
 *
 * Contratto backend (camelCase):
 *   { items: [{ cveId, cvssScore, severity, title, hostCount, fixAvailable }],
 *     limit, offset }
 *
 * Se modulo non installato → 404 dal backend → toast informativo + lista vuota.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  AlertCircle,
  ArrowLeft,
  History,
  Loader2,
  PackageSearch,
  RefreshCw,
  Search,
  ShieldCheck,
  ShieldQuestion,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
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

interface CveListItem {
  cveId: string;
  cvssScore: number | null;
  severity: string | null;
  title: string | null;
  hostCount: number;
  fixAvailable: boolean;
}

interface CveListResponse {
  items: CveListItem[];
  limit: number;
  offset: number;
}

type SeverityFilter = "all" | "critical" | "high" | "medium" | "low";

const PAGE_SIZE = 50;

function severityVariant(
  sev: string | null
): "default" | "destructive" | "secondary" | "outline" {
  if (!sev) return "outline";
  const s = sev.toLowerCase();
  if (s === "critical" || s === "high") return "destructive";
  if (s === "medium") return "default";
  return "secondary";
}

function severityLabel(sev: string | null): string {
  if (!sev) return "—";
  const s = sev.toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export default function PatchManagementPage() {
  const [items, setItems] = useState<CveListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [moduleMissing, setModuleMissing] = useState(false);

  // Filtri server-side
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("all");
  const [onlyWithFix, setOnlyWithFix] = useState(false);

  // Filtro client-side
  const [searchQuery, setSearchQuery] = useState("");

  // Paginazione
  const [offset, setOffset] = useState(0);

  const fetchCves = useCallback(async () => {
    setLoading(true);
    setError(null);
    setModuleMissing(false);
    try {
      const params = new URLSearchParams();
      if (severityFilter !== "all") params.set("severity", severityFilter);
      if (onlyWithFix) params.set("hasMatch", "true");
      params.set("limit", String(PAGE_SIZE));
      params.set("offset", String(offset));

      const res = await fetch(`/api/patch/cve?${params.toString()}`, {
        cache: "no-store",
      });

      if (res.status === 404) {
        setModuleMissing(true);
        setItems([]);
        toast.error(
          "Modulo Patch Management non installato. Vai a Impostazioni → Moduli per installarlo."
        );
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as CveListResponse;
      setItems(data.items ?? []);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Errore caricamento CVE";
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [severityFilter, onlyWithFix, offset]);

  useEffect(() => {
    void fetchCves();
  }, [fetchCves]);

  // Reset offset quando cambiano i filtri server-side
  useEffect(() => {
    setOffset(0);
  }, [severityFilter, onlyWithFix]);

  // Filtro client-side su cveId + title
  const filteredItems = items.filter((item) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      item.cveId.toLowerCase().includes(q) ||
      (item.title ?? "").toLowerCase().includes(q)
    );
  });

  const pageIndex = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-1">
          <Link
            href="/patch-management"
            className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Patch Management
          </Link>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <PackageSearch className="h-6 w-6" />
            CVE rilevate
          </h1>
          <p className="text-sm text-muted-foreground">
            CVE rilevate sugli host con software inventory popolato (Wazuh +
            Scanner-Edge). Click su una riga per il dettaglio.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-sm text-muted-foreground">
            {filteredItems.length} CVE • pagina {pageIndex}
          </div>
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={<Link href="/patch-management/history" />}
          >
            <History className="h-4 w-4 mr-2" />
            Storico operazioni
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void fetchCves()}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            Aggiorna
          </Button>
        </div>
      </div>

      {/* Filtri */}
      <Card>
        <CardContent className="pt-6 flex flex-wrap items-center gap-3">
          <div className="relative max-w-sm flex-1 min-w-[220px]">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Cerca CVE o titolo..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8"
            />
          </div>

          <Select
            value={severityFilter}
            onValueChange={(v) => setSeverityFilter(v as SeverityFilter)}
          >
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Severity" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tutte le severità</SelectItem>
              <SelectItem value="critical">Critical</SelectItem>
              <SelectItem value="high">High</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="low">Low</SelectItem>
            </SelectContent>
          </Select>

          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <Checkbox
              checked={onlyWithFix}
              onCheckedChange={(v) => setOnlyWithFix(v === true)}
            />
            Solo con fix disponibile
          </label>
        </CardContent>
      </Card>

      {/* Stato modulo non installato */}
      {moduleMissing && !loading && (
        <Card>
          <CardContent className="py-6 text-sm flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-amber-600" />
            <span>
              Modulo Patch Management non installato per questo tenant. Vai a{" "}
              <Link
                href="/settings/features"
                className="underline font-medium"
              >
                Impostazioni → Moduli
              </Link>{" "}
              per attivarlo.
            </span>
          </CardContent>
        </Card>
      )}

      {/* Errore generico */}
      {error && !moduleMissing && (
        <Card>
          <CardContent className="py-6 text-sm flex items-center gap-2 text-destructive">
            <AlertCircle className="h-4 w-4" />
            Errore: {error}
          </CardContent>
        </Card>
      )}

      {/* Loading */}
      {loading && !moduleMissing && (
        <Card>
          <CardContent className="py-6 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Caricamento CVE...
          </CardContent>
        </Card>
      )}

      {/* Empty state (modulo installato, nessuna CVE) */}
      {!loading && !error && !moduleMissing && filteredItems.length === 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <ShieldQuestion className="h-4 w-4" />
              Nessuna CVE trovata
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-2">
            <p>
              Verifica che almeno un host abbia <code>software_inventory</code>{" "}
              popolato e che ci sia almeno una vulnerability rilevata da Wazuh
              o Scanner-Edge.
            </p>
            <p>
              Suggerimenti:
            </p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Esegui uno scan software inventory dalla pagina host.</li>
              <li>Verifica connettività Wazuh / Scanner-Edge.</li>
              <li>Rimuovi i filtri attivi e riprova.</li>
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Tabella */}
      {!loading && !error && !moduleMissing && filteredItems.length > 0 && (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">CVSS</TableHead>
                <TableHead className="w-28">Severity</TableHead>
                <TableHead className="w-40">CVE ID</TableHead>
                <TableHead>Titolo</TableHead>
                <TableHead className="w-20 text-right">Host</TableHead>
                <TableHead className="w-24 text-center">Fix</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredItems.map((item) => (
                <TableRow
                  key={item.cveId}
                  className="hover:bg-muted/50 cursor-pointer"
                >
                  <TableCell>
                    <Badge variant={severityVariant(item.severity)}>
                      {item.cvssScore !== null
                        ? item.cvssScore.toFixed(1)
                        : "—"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <span className="text-sm">
                      {severityLabel(item.severity)}
                    </span>
                  </TableCell>
                  <TableCell className="font-mono text-sm">
                    <Link
                      href={`/patch-management/cve/${encodeURIComponent(item.cveId)}`}
                      className="hover:underline text-primary"
                    >
                      {item.cveId}
                    </Link>
                  </TableCell>
                  <TableCell className="max-w-md truncate">
                    <Link
                      href={`/patch-management/cve/${encodeURIComponent(item.cveId)}`}
                      className="hover:underline"
                      title={item.title ?? undefined}
                    >
                      {item.title ?? "—"}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {item.hostCount}
                  </TableCell>
                  <TableCell className="text-center">
                    {item.fixAvailable ? (
                      <Badge
                        variant="default"
                        className="bg-emerald-600 hover:bg-emerald-700"
                      >
                        <ShieldCheck className="h-3 w-3 mr-1" />
                        Sì
                      </Badge>
                    ) : (
                      <Badge variant="outline" title="Nessun mapping fix">
                        <ShieldQuestion className="h-3 w-3 mr-1" />
                        N/D
                      </Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {/* Paginazione (visibile solo se non in errore/empty) */}
      {!moduleMissing && !error && (
        <div className="flex items-center justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            disabled={offset === 0 || loading}
          >
            Precedente
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setOffset(offset + PAGE_SIZE)}
            disabled={items.length < PAGE_SIZE || loading}
          >
            Successiva
          </Button>
        </div>
      )}
    </div>
  );
}
