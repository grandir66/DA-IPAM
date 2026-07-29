"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { RefreshCw, Check, Siren, Pause, Play } from "lucide-react";
import { WazuhHealthBand } from "@/components/integrations/wazuh-health-band";
import { splitCategories } from "@/lib/integrations/wazuh-alerts-stats";
import {
  AlertsComposition,
  AlertsOverTime,
  DiagnosticStrip,
  RankedTable,
  SYSTEM_CHOICES,
  WINDOW_CHOICES,
  StatTile,
  TargetedAccounts,
  seriesColor,
  type CategorySlice,
  type RankedEntry,
  type SeriesRow,
  type TargetedAccount,
} from "./alert-charts";

/** Ogni quanto la pagina si riallinea da sola. */
const AUTO_REFRESH_MS = 60_000;

interface AlertCategoryDto {
  id: string;
  labelIt: string;
  diagnostic: boolean;
}

interface AlertEventDto {
  id: number;
  category: string;
  diagnostic: number;
  rule_id: string | null;
  rule_level: number;
  rule_description: string | null;
  agent_name: string | null;
  event_id: string | null;
  target_user: string | null;
  source_ip: string | null;
  occurrence_count: number;
  first_seen_at: string;
  last_seen_at: string;
  acknowledged: number;
  acknowledged_by: string | null;
}

interface AlertsResponse {
  categories: AlertCategoryDto[];
  openByCategory: Record<string, number>;
  events: AlertEventDto[];
}

interface StatsWindowDto {
  id: string;
  labelIt: string;
  hours: number;
}

interface StatsResponse {
  windows: StatsWindowDto[];
  systems: { id: string; labelIt: string }[];
  system: string | null;
  window: string;
  interval: string;
  openTotal: number;
  syncState: { lastRunAt: string | null; lastError: string | null };
  unavailable?: string;
  stats: {
    totals: { alerts: number; agents: number; rules: number };
    byCategory: CategorySlice[];
    series: SeriesRow[];
    topAccounts: TargetedAccount[];
    byTarget: RankedEntry[];
    bySource: RankedEntry[];
  } | null;
}

function levelBadgeClass(level: number): string {
  if (level >= 12) return "bg-red-100 text-red-800 border-red-200";
  if (level >= 10) return "bg-orange-100 text-orange-800 border-orange-200";
  return "bg-amber-100 text-amber-800 border-amber-200";
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("it-IT");
}

export function SecurityAlertsClient() {
  const [data, setData] = useState<AlertsResponse | null>(null);
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [category, setCategory] = useState<string | null>(null);
  const [onlyOpen, setOnlyOpen] = useState(true);
  const [windowId, setWindowId] = useState("24h");
  const [system, setSystem] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  // Contatore per <WazuhHealthBand>: incrementato dallo stesso ciclo di
  // aggiornamento a 60s usato per gli alert, nessun setInterval aggiuntivo.
  const [refreshTick, setRefreshTick] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const load = useCallback(
    async (opts?: { silent?: boolean }) => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      if (!opts?.silent) setLoading(true);
      try {
        const qs = new URLSearchParams();
        if (category) qs.set("category", category);
        if (onlyOpen) qs.set("onlyOpen", "1");
        const [listRes, statsRes] = await Promise.all([
          fetch(`/api/integrations/wazuh/alerts?${qs}`, { signal: ac.signal }),
          fetch(
            `/api/integrations/wazuh/alerts/stats?window=${windowId}` +
              (system ? `&system=${system}` : ""),
            { signal: ac.signal },
          ),
        ]);
        if (!listRes.ok) throw new Error(`HTTP ${listRes.status}`);
        setData((await listRes.json()) as AlertsResponse);
        if (statsRes.ok) setStats((await statsRes.json()) as StatsResponse);
        setLastRefresh(new Date());
      } catch (e) {
        if ((e as Error).name !== "AbortError" && !opts?.silent) {
          toast.error(`Errore nel caricamento: ${(e as Error).message}`);
        }
      } finally {
        if (!opts?.silent) setLoading(false);
      }
    },
    [category, onlyOpen, windowId, system],
  );

  useEffect(() => {
    void load();
    return () => abortRef.current?.abort();
  }, [load]);

  // Aggiornamento automatico. Il job lato server gira ogni 15 minuti: qui si
  // ricarica più spesso perché la presa in carico di un collega deve comparire
  // senza che nessuno prema nulla.
  useEffect(() => {
    if (!autoRefresh) return;
    timerRef.current = setInterval(() => {
      void load({ silent: true });
      setRefreshTick((t) => t + 1);
    }, AUTO_REFRESH_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
    };
  }, [autoRefresh, load]);

  async function handleSync() {
    setSyncing(true);
    try {
      const res = await fetch("/api/integrations/wazuh/alerts", { method: "POST" });
      const body = (await res.json()) as {
        error?: string;
        skipped?: boolean;
        reason?: string;
        fetched?: number;
        opened?: number;
      };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      if (body.skipped) toast.warning(`Poll saltato: ${body.reason}`);
      else
        toast.success(
          `${body.fetched ?? 0} alert letti, ${body.opened ?? 0} nuovi eventi aperti`,
        );
      await load();
      setRefreshTick((t) => t + 1);
    } catch (e) {
      toast.error(`Errore: ${(e as Error).message}`);
    } finally {
      setSyncing(false);
    }
  }

  async function handleAck(id: number) {
    try {
      const res = await fetch(`/api/integrations/wazuh/alerts/${id}`, { method: "POST" });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      toast.success("Evento preso in carico");
      await load();
    } catch (e) {
      toast.error(`Errore: ${(e as Error).message}`);
    }
  }

  const categories = data?.categories ?? [];
  const openCounts = data?.openByCategory ?? {};
  const events = data?.events ?? [];
  const windows = WINDOW_CHOICES;
  const totals = stats?.stats?.totals;
  const byCategory = stats?.stats?.byCategory ?? [];
  // I grafici rispondono a "mi stanno attaccando?": le nostre sonde e la salute
  // della raccolta fanno volumi che annegherebbero gli attacchi veri, quindi
  // restano contate ma fuori dallo stack.
  const split = splitCategories(byCategory);
  const noAttacksNote =
    split.diagnosticTotal > 0
      ? `Nessun attacco nella finestra selezionata. Le ${split.diagnosticTotal} rilevazioni presenti sono attività nostre o di servizio, elencate qui sotto.`
      : undefined;
  const series = stats?.stats?.series ?? [];
  const topAccounts = stats?.stats?.topAccounts ?? [];
  const byTarget = stats?.stats?.byTarget ?? [];
  const bySource = stats?.stats?.bySource ?? [];
  const systems = SYSTEM_CHOICES;

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Siren className="h-6 w-6" />
            Alert sicurezza
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Selezione curata degli alert Wazuh. Alert ripetuti dallo stesso agent
            sulla stessa regola sono raggruppati in un unico evento.
          </p>
        </div>
        <Button onClick={handleSync} disabled={syncing}>
          <RefreshCw className={`mr-2 h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
          {syncing ? "Aggiornamento…" : "Aggiorna ora"}
        </Button>
      </div>

      <WazuhHealthBand refreshKey={refreshTick} />

      {stats?.unavailable ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Grafici non disponibili: {stats.unavailable}. La tabella degli eventi resta
          consultabile.
        </div>
      ) : null}
      {stats?.syncState.lastError ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          Ultimo poll fallito: {stats.syncState.lastError}
        </div>
      ) : null}

      {/* Controlli in una riga sola, sopra i grafici */}
      <div className="flex flex-wrap items-center gap-2">
        {windows.map((w) => (
          <Button
            key={w.id}
            variant={windowId === w.id ? "default" : "outline"}
            size="sm"
            onClick={() => setWindowId(w.id)}
          >
            {w.labelIt}
          </Button>
        ))}
        <span className="mx-1 h-5 w-px bg-border" aria-hidden />
        <Button
          variant={system === null ? "default" : "outline"}
          size="sm"
          onClick={() => setSystem(null)}
        >
          Tutti i sistemi
        </Button>
        {systems.map((sy) => (
          <Button
            key={sy.id}
            variant={system === sy.id ? "default" : "outline"}
            size="sm"
            onClick={() => setSystem(sy.id)}
          >
            {sy.labelIt}
          </Button>
        ))}
        <span className="mx-1 h-5 w-px bg-border" aria-hidden />
        <Button
          variant={onlyOpen ? "default" : "outline"}
          size="sm"
          onClick={() => setOnlyOpen((v) => !v)}
        >
          {onlyOpen ? "Solo aperti" : "Tutti gli stati"}
        </Button>
        <div className="ml-auto flex items-center gap-2">
          {lastRefresh ? (
            <span className="text-xs text-muted-foreground">
              aggiornato {lastRefresh.toLocaleTimeString("it-IT")}
            </span>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAutoRefresh((v) => !v)}
            title={
              autoRefresh
                ? "Aggiornamento automatico attivo (ogni minuto)"
                : "Aggiornamento automatico in pausa"
            }
          >
            {autoRefresh ? (
              <>
                <Pause className="mr-1 h-3 w-3" /> Auto
              </>
            ) : (
              <>
                <Play className="mr-1 h-3 w-3" /> Auto
              </>
            )}
          </Button>
        </div>
      </div>

      {/* KPI: i numeri di testa, non un grafico a una barra */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Alert nel periodo"
          value={split.attackTotal}
          hint={
            split.diagnosticTotal > 0
              ? `${windows.find((w) => w.id === windowId)?.labelIt} · ${split.diagnosticTotal} non ostili esclusi`
              : windows.find((w) => w.id === windowId)?.labelIt
          }
        />
        <StatTile
          label="Eventi aperti"
          value={stats?.openTotal ?? 0}
          hint="da prendere in carico"
        />
        <StatTile label="Agent coinvolti" value={totals?.agents ?? 0} />
        <StatTile label="Regole distinte" value={totals?.rules ?? 0} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Distribuzione nel tempo</CardTitle>
          </CardHeader>
          <CardContent>
            <AlertsOverTime
              series={series}
              categories={split.attacks}
              interval={stats?.interval ?? "1h"}
              emptyNote={noAttacksNote}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Composizione</CardTitle>
          </CardHeader>
          <CardContent>
            <AlertsComposition categories={split.attacks} emptyNote={noAttacksNote} />
          </CardContent>
        </Card>
      </div>

      <DiagnosticStrip categories={split.diagnostic} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Dove avviene</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-3 text-xs text-muted-foreground">
              Host su cui il tentativo fallito viene registrato: la destinazione
              della violazione.
            </p>
            <RankedTable
              entries={byTarget}
              keyHeader="Destinazione"
              detailHeader="Account più colpito"
              emptyLabel="Nessuna destinazione da segnalare. L'attività originata dalle reti e dagli account dichiarati come nostri è esclusa da questa classifica."
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Da dove parte</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-3 text-xs text-muted-foreground">
              Origine della richiesta: IP pubblici o interni e postazioni di
              provenienza.
            </p>
            <RankedTable
              entries={bySource}
              keyHeader="Origine della richiesta"
              detailHeader="Account provato"
              emptyLabel="Nessuna origine da segnalare. L'attività originata dalle reti e dagli account dichiarati come nostri è esclusa da questa classifica."
            />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Account bersagliati</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-xs text-muted-foreground">
            Chi subisce i tentativi di accesso falliti e da dove partono, su tutte
            le sorgenti che Wazuh raccoglie: Windows, Microsoft 365 e Linux. Gli
            account che finiscono con &quot;$&quot; sono account computer, non persone.
            I nostri account di servizio sono esclusi.
          </p>
          <TargetedAccounts accounts={topAccounts} />
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant={category === null ? "default" : "outline"}
          size="sm"
          onClick={() => setCategory(null)}
        >
          Tutte
        </Button>
        {categories.map((c) => (
          <Button
            key={c.id}
            variant={category === c.id ? "default" : "outline"}
            size="sm"
            onClick={() => setCategory(c.id)}
          >
            <span
              className="mr-2 inline-block h-2 w-2 rounded-sm"
              style={{ background: seriesColor(c.id) }}
              aria-hidden
            />
            {c.labelIt}
            {openCounts[c.id] ? (
              <Badge className="ml-2 bg-slate-200 text-slate-800">{openCounts[c.id]}</Badge>
            ) : null}
          </Button>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {loading ? "Caricamento…" : `${events.length} eventi`}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!loading && events.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Nessun evento. Se l&apos;integrazione Wazuh è appena stata configurata,
              usa &quot;Aggiorna ora&quot; per il primo poll.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Liv.</TableHead>
                    <TableHead>Regola</TableHead>
                    <TableHead>Agent</TableHead>
                    <TableHead>Dettagli</TableHead>
                    <TableHead className="text-right">Occorrenze</TableHead>
                    <TableHead>Ultimo</TableHead>
                    <TableHead className="text-right">Azione</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {events.map((e) => (
                    <TableRow key={e.id} className={e.acknowledged ? "opacity-60" : ""}>
                      <TableCell>
                        <Badge className={levelBadgeClass(e.rule_level)}>
                          {e.rule_level}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-sm">
                        <div className="flex items-center gap-2 font-medium">
                          <span
                            className="inline-block h-2 w-2 shrink-0 rounded-sm"
                            style={{ background: seriesColor(e.category) }}
                            aria-hidden
                          />
                          {e.rule_description ?? "—"}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {categories.find((c) => c.id === e.category)?.labelIt ??
                            e.category}
                          {e.diagnostic ? " · diagnostica" : ""}
                          {e.rule_id ? ` · rule ${e.rule_id}` : ""}
                        </div>
                      </TableCell>
                      <TableCell>{e.agent_name ?? "—"}</TableCell>
                      <TableCell className="text-xs">
                        {e.event_id ? <div>Event ID {e.event_id}</div> : null}
                        {e.target_user ? <div>Utente: {e.target_user}</div> : null}
                        {e.source_ip ? <div>IP: {e.source_ip}</div> : null}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {e.occurrence_count}
                      </TableCell>
                      <TableCell className="text-xs">{formatDate(e.last_seen_at)}</TableCell>
                      <TableCell className="text-right">
                        {e.acknowledged ? (
                          <span className="text-xs text-muted-foreground">
                            preso in carico
                            {e.acknowledged_by ? ` da ${e.acknowledged_by}` : ""}
                          </span>
                        ) : (
                          <Button size="sm" variant="outline" onClick={() => handleAck(e.id)}>
                            <Check className="mr-1 h-3 w-3" />
                            Prendi in carico
                          </Button>
                        )}
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
