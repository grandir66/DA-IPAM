"use client";
import { parseDbDate } from "@/lib/db-date";
import { LoadError } from "@/components/shared/load-error";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
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
import { STILE_STATO, type ToniStato } from "@/components/shared/stile-stato-modulo";
import { splitCategories } from "@/lib/integrations/wazuh-alerts-stats";
import {
  AlertsOverTime,
  DiagnosticStrip,
  RankedTable,
  SYSTEM_CHOICES,
  WINDOW_CHOICES,
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

const ALERTS_LIMIT = 200;

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

/** Stato della lettura di un domain controller (fonte «dc», senza Wazuh). */
interface LetturaDcDto {
  dc: string;
  lettoIl: string | null;
  esito: "ok" | "errore" | null;
  errore: string | null;
  persiIl: string | null;
  persi: number;
}

interface StatsResponse {
  /** Da dove vengono grafici e classifiche: l'indexer di Wazuh o i domain controller letti via WinRM. */
  fonte?: "wazuh" | "dc";
  letture?: LetturaDcDto[];
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

function formatDate(iso: string): string {
  const d = parseDbDate(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("it-IT");
}

export function SecurityAlertsClient() {
  const [data, setData] = useState<AlertsResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [stats, setStats] = useState<StatsResponse | null>(null);
  // Le statistiche che non arrivano si dicono, non si lasciano a «non ancora lette» (revisione del 20/10).
  const [statsError, setStatsError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [category, setCategory] = useState<string | null>(null);
  const [onlyOpen, setOnlyOpen] = useState(true);
  const [windowId, setWindowId] = useState("24h");
  const [system, setSystem] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [classifica, setClassifica] = useState<Classifica>("account");
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
        // Finestra e sistema filtrano anche l'elenco, non solo i grafici (UI-11).
        qs.set("window", windowId);
        if (system) qs.set("system", system);
        // Una riga in più per sapere se la lista è troncata.
        qs.set("limit", String(ALERTS_LIMIT + 1));
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
        setLoadError(null);
        if (statsRes.ok) {
          setStats((await statsRes.json()) as StatsResponse);
          setStatsError(null);
        } else {
          setStats(null);
          setStatsError(`errore HTTP ${statsRes.status} nel leggere le statistiche`);
        }
        setLastRefresh(new Date());
      } catch (e) {
        if ((e as Error).name !== "AbortError" && !opts?.silent) {
          // Senza dati non si mostra «Nessun evento» (UI-7): si mostra l'errore.
          setLoadError((e as Error).message);
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
  const allEvents = data?.events ?? [];
  const truncated = allEvents.length > ALERTS_LIMIT;
  const events = truncated ? allEvents.slice(0, ALERTS_LIMIT) : allEvents;
  const windows = WINDOW_CHOICES;
  const windowLabel = windows.find((w) => w.id === windowId)?.labelIt ?? windowId;
  const systemLabel = system ? (stats?.systems.find((sy) => sy.id === system)?.labelIt ?? system) : null;
  // Aperti fuori dal periodo: senza questa cifra un evento vecchio non preso in carico
  // sparirebbe dall'elenco senza dirlo.
  const openTotal = category
    ? (openCounts[category] ?? 0)
    : Object.values(openCounts).reduce((a, b) => a + b, 0);
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

  // Una schermata a 1920 (Riccardo, 20/10): testata e filtri in alto, la coda degli eventi
  // da prendere in carico a sinistra, l'analisi a destra. Le spiegazioni stanno nei `title`.
  const statsAssenti = !stats?.stats;
  const motivoAssenti = statsError ?? stats?.unavailable ?? "statistiche dell'indexer non ancora lette";
  // Senza Wazuh i dati vengono dal registro Sicurezza dei DC (29/10): la pagina lo dice e chiama le cose col loro nome.
  const daDc = stats?.fonte === "dc";
  return (
    <div className="flex flex-col gap-2 lg:h-[calc(100dvh-1.5rem)]">
      {/* ── Testata: titolo, stato di Wazuh, aggiornamento ───────────── */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 shrink-0">
        <h1
          className="flex items-center gap-2 text-xl font-bold tracking-tight mr-1"
          title="Selezione curata degli alert Wazuh. Alert ripetuti dallo stesso agent sulla stessa regola sono raggruppati in un unico evento."
        >
          <Siren className="h-5 w-5" />
          Alert sicurezza
        </h1>
        {daDc ? <FonteDc letture={stats?.letture ?? []} /> : <WazuhHealthBand refreshKey={refreshTick} compatta />}
        <div className="ml-auto flex items-center gap-2">
          {lastRefresh ? (
            <span className="text-[13px] text-muted-foreground">
              aggiornato {lastRefresh.toLocaleTimeString("it-IT")}
            </span>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAutoRefresh((v) => !v)}
            title={autoRefresh ? "Aggiornamento automatico attivo (ogni minuto)" : "Aggiornamento automatico in pausa"}
          >
            {autoRefresh ? <Pause className="mr-1 h-3 w-3" /> : <Play className="mr-1 h-3 w-3" />}
            Auto
          </Button>
          <Button size="sm" onClick={handleSync} disabled={syncing}>
            <RefreshCw className={`mr-2 h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? "Aggiornamento…" : "Aggiorna ora"}
          </Button>
        </div>
      </div>

      {/* ── Filtri in una riga: periodo, sistema, categoria, stato ────── */}
      <div className="flex flex-wrap items-center gap-1.5 shrink-0">
        {windows.map((w) => (
          <Button key={w.id} variant={windowId === w.id ? "default" : "outline"} size="sm" onClick={() => setWindowId(w.id)}>
            {w.labelIt}
          </Button>
        ))}
        <span className="mx-1 h-5 w-px bg-border" aria-hidden />
        <Button variant={system === null ? "default" : "outline"} size="sm" onClick={() => setSystem(null)}>
          Tutti i sistemi
        </Button>
        {systems.map((sy) => (
          <Button key={sy.id} variant={system === sy.id ? "default" : "outline"} size="sm" onClick={() => setSystem(sy.id)}>
            {sy.labelIt}
          </Button>
        ))}
        <span className="mx-1 h-5 w-px bg-border" aria-hidden />
        <Button variant={onlyOpen ? "default" : "outline"} size="sm" onClick={() => setOnlyOpen((v) => !v)}>
          {onlyOpen ? "Solo aperti" : "Tutti gli stati"}
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 shrink-0">
        <Button variant={category === null ? "default" : "outline"} size="sm" onClick={() => setCategory(null)}>
          Tutte le categorie
        </Button>
        {categories.map((c) => (
          <Button key={c.id} variant={category === c.id ? "default" : "outline"} size="sm" onClick={() => setCategory(c.id)}>
            <span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm" style={{ background: seriesColor(c.id) }} aria-hidden />
            {c.labelIt}
            {openCounts[c.id] ? <span className="ml-1.5 font-bold tabular-nums">{openCounts[c.id]}</span> : null}
          </Button>
        ))}
      </div>

      {/* ── Numeri di testa e avvisi, in una riga ─────────────────────── */}
      <div className="flex flex-wrap items-stretch gap-2 shrink-0">
        <Numero
          titolo="Alert nel periodo"
          valore={statsAssenti ? "—" : numero(split.attackTotal)}
          title={statsAssenti ? `Non disponibile: ${motivoAssenti}` : split.diagnosticTotal > 0 ? `${windowLabel} · ${split.diagnosticTotal} non ostili esclusi` : windowLabel}
        />
        <Numero titolo="Eventi aperti" valore={stats ? numero(stats.openTotal) : "—"} title="Da prendere in carico" />
        <Numero titolo={daDc ? "DC coinvolti" : "Agent coinvolti"} valore={statsAssenti ? "—" : numero(totals?.agents ?? 0)} title={statsAssenti ? `Non disponibile: ${motivoAssenti}` : undefined} />
        <Numero titolo={daDc ? "Tipi di evento" : "Regole distinte"} valore={statsAssenti ? "—" : numero(totals?.rules ?? 0)} title={statsAssenti ? `Non disponibile: ${motivoAssenti}` : undefined} />
        {stats?.unavailable ? (
          <span className={`self-center rounded-md border px-2 py-1 text-[13px] ${STILE_STATO.attenzione.classi}`}>
            {STILE_STATO.attenzione.segno} Grafici non disponibili: {stats.unavailable}
          </span>
        ) : null}
        {stats?.syncState.lastError ? (
          <span className={`self-center rounded-md border px-2 py-1 text-[13px] ${STILE_STATO.guasto.classi}`}>
            {STILE_STATO.guasto.segno} {daDc ? "Lettura non riuscita" : "Ultimo poll fallito"}: {stats.syncState.lastError}
          </span>
        ) : null}
      </div>

      {/* ── Corpo: coda a sinistra, analisi a destra ──────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)] gap-2 lg:flex-1 lg:min-h-0">
        <Card size="sm" className="lg:min-h-0 data-[size=sm]:gap-1">
          <CardHeader>
            <CardTitle className="text-sm">
              {loading ? "Caricamento…" : truncated ? `Primi ${ALERTS_LIMIT} eventi` : `${events.length} eventi`}
              {!loading && (
                <span className="ml-2 text-[13px] font-normal text-muted-foreground">
                  visti in: {windowLabel.toLowerCase()}
                  {systemLabel ? ` · ${systemLabel}` : ""}
                  {onlyOpen && openTotal > events.length ? ` · ${openTotal} aperti in tutto` : ""}
                  {truncated ? " · i più recenti: scegli una categoria per gli altri" : ""}
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="lg:flex-1 lg:min-h-0">
            {!loading && loadError && !data ? (
              <LoadError what="gli allarmi di sicurezza" message={loadError} onRetry={() => void load()} />
            ) : !loading && events.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                {daDc
                  ? "Nessun evento dai domain controller in questo periodo."
                  : "Nessun evento in questo periodo. Se l'integrazione Wazuh è appena stata configurata, usa «Aggiorna ora» per il primo poll."}
              </p>
            ) : (
              <Table fissa riserva={16}>
                <TableHeader>
                  <TableRow>
                    <TableHead title="Livello della regola Wazuh: ✕ 12 e oltre, ▲ 10-11, ● sotto 10">Liv.</TableHead>
                    <TableHead>Regola</TableHead>
                    <TableHead>{daDc ? "DC" : "Agent"}</TableHead>
                    <TableHead>Dettagli</TableHead>
                    <TableHead className="text-right">Occorrenze</TableHead>
                    <TableHead>Ultimo</TableHead>
                    <TableHead className="text-right">Azione</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {events.map((e) => {
                    const lv = STILE_STATO[tonoLivello(e.rule_level)];
                    return (
                      <TableRow key={e.id} className={e.acknowledged ? "opacity-60" : ""}>
                        <TableCell>
                          <span className={`inline-flex items-center gap-0.5 rounded border px-1.5 text-[13px] font-semibold tabular-nums ${lv.classi}`}>
                            <span aria-hidden>{lv.segno}</span>
                            {e.rule_level}
                          </span>
                        </TableCell>
                        <TableCell className="max-w-sm whitespace-normal">
                          <div className="flex items-center gap-2 font-medium">
                            <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: seriesColor(e.category) }} aria-hidden />
                            {e.rule_description ?? "—"}
                          </div>
                          <div className="text-[13px] text-muted-foreground">
                            {categories.find((c) => c.id === e.category)?.labelIt ?? e.category}
                            {e.diagnostic ? " · diagnostica" : ""}
                            {e.rule_id ? ` · rule ${e.rule_id}` : ""}
                          </div>
                        </TableCell>
                        <TableCell>{e.agent_name ?? "—"}</TableCell>
                        <TableCell className="text-[13px] whitespace-normal">
                          {e.event_id ? <div>Event ID {e.event_id}</div> : null}
                          {e.target_user ? <div>Utente: {e.target_user}</div> : null}
                          {e.source_ip ? <div>IP: {e.source_ip}</div> : null}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{numero(e.occurrence_count)}</TableCell>
                        <TableCell className="text-[13px]">{formatDate(e.last_seen_at)}</TableCell>
                        <TableCell className="text-right">
                          {e.acknowledged ? (
                            <span className="text-[13px] text-muted-foreground">
                              preso in carico{e.acknowledged_by ? ` da ${e.acknowledged_by}` : ""}
                            </span>
                          ) : (
                            <Button size="sm" variant="outline" onClick={() => handleAck(e.id)}>
                              <Check className="mr-1 h-3 w-3" />
                              Prendi in carico
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <div className="flex flex-col gap-2 lg:min-h-0">
          <Card size="sm" className="shrink-0 data-[size=sm]:gap-1">
            <CardHeader>
              <CardTitle className="text-sm" title="Alert ostili per categoria nel periodo scelto. Le nostre sonde e la salute della raccolta restano fuori: sono elencate in fondo alla colonna.">
                Nel tempo
              </CardTitle>
            </CardHeader>
            <CardContent>
              {statsAssenti ? (
                <p className="py-6 text-center text-[13px] text-muted-foreground">Non disponibile: {motivoAssenti}.</p>
              ) : (
                <AlertsOverTime series={series} categories={split.attacks} interval={stats?.interval ?? "1h"} emptyNote={noAttacksNote} altezza={230} />
              )}
            </CardContent>
          </Card>
          <Card size="sm" className="lg:flex-1 lg:min-h-0 data-[size=sm]:gap-1">
            <CardHeader>
              <div className="inline-flex w-fit rounded-md border text-[13px]" role="group" aria-label="Classifiche">
                {CLASSIFICHE.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    aria-pressed={classifica === c.id}
                    title={c.spiegazione}
                    onClick={() => setClassifica(c.id)}
                    className={`px-2.5 py-1 ${classifica === c.id ? "bg-[#0D2537] text-white dark:bg-[#A9BECC] dark:text-[#0D2537]" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    {c.etichetta}
                  </button>
                ))}
              </div>
            </CardHeader>
            <CardContent className="lg:flex-1 lg:min-h-0 lg:overflow-auto">
              {statsAssenti ? (
                <p className="py-6 text-center text-[13px] text-muted-foreground">Non disponibile: {motivoAssenti}.</p>
              ) : classifica === "account" ? (
                <TargetedAccounts accounts={topAccounts} />
              ) : classifica === "destinazioni" ? (
                <RankedTable
                  entries={byTarget}
                  keyHeader="Destinazione"
                  detailHeader="Account più colpito"
                  emptyLabel="Nessuna destinazione da segnalare. L'attività originata dalle reti e dagli account dichiarati come nostri è esclusa da questa classifica."
                />
              ) : (
                <RankedTable
                  entries={bySource}
                  keyHeader="Origine della richiesta"
                  detailHeader="Account provato"
                  emptyLabel="Nessuna origine da segnalare. L'attività originata dalle reti e dagli account dichiarati come nostri è esclusa da questa classifica."
                />
              )}
            </CardContent>
          </Card>
          <div className="shrink-0">
            <DiagnosticStrip categories={split.diagnostic} />
          </div>
        </div>
      </div>
    </div>
  );
}

const numero = (n: number) => n.toLocaleString("it-IT");

/** Livello della regola Wazuh nei toni dei token (niente pastello, Riccardo è daltonico). */
function tonoLivello(level: number): ToniStato {
  if (level >= 12) return "guasto";
  if (level >= 10) return "attenzione";
  return "da_verificare";
}

type Classifica = "account" | "destinazioni" | "origini";

const CLASSIFICHE: { id: Classifica; etichetta: string; spiegazione: string }[] = [
  {
    id: "account",
    etichetta: "Account bersagliati",
    spiegazione: "Chi subisce i tentativi di accesso falliti e da dove partono, su tutte le sorgenti di Wazuh: Windows, Microsoft 365 e Linux. Gli account che finiscono con \"$\" sono account computer, non persone. I nostri account di servizio sono esclusi.",
  },
  {
    id: "destinazioni",
    etichetta: "Dove avviene",
    spiegazione: "Host su cui il tentativo fallito viene registrato: la destinazione della violazione.",
  },
  {
    id: "origini",
    etichetta: "Da dove parte",
    spiegazione: "Origine della richiesta: IP pubblici o interni e postazioni di provenienza.",
  },
];

/** Numero di testa: card bassa come gli indicatori della dashboard. */
function Numero({ titolo, valore, title }: { titolo: string; valore: string; title?: string }) {
  return (
    <span className="flex flex-col justify-center rounded-md border bg-card px-3 py-1 leading-tight" title={title}>
      <span className="text-[13px] text-muted-foreground">{titolo}</span>
      <span className="text-xl font-bold leading-none tabular-nums">{valore}</span>
    </span>
  );
}

/**
 * Testata quando i dati vengono dai DC: quali DC si leggono, quando, e cosa non va. Un registro
 * girato prima della lettura si dice: vuol dire eventi persi, e il rimedio è ingrandirlo sul DC.
 */
function FonteDc({ letture }: { letture: LetturaDcDto[] }) {
  const guasti = letture.filter((l) => l.esito === "errore");
  const persi = letture.filter((l) => l.persi > 0);
  const tono: ToniStato = guasti.length ? "guasto" : persi.length ? "attenzione" : "ok";
  const st = STILE_STATO[tono];
  const ultima = letture.map((l) => l.lettoIl).filter((x): x is string => !!x).sort().at(-1);
  const titolo = [
    "Registro Sicurezza dei domain controller letto via WinRM ogni 5 minuti, senza Wazuh.",
    ...letture.map((l) => `${l.dc}: ${l.esito === "errore" ? `errore: ${l.errore ?? "—"}` : `letto ${l.lettoIl ? formatDate(l.lettoIl) : "mai"}`}`),
    ...persi.map((l) => `${l.dc}: circa ${l.persi} record persi il ${l.persiIl ? formatDate(l.persiIl) : "—"}: il registro Sicurezza gira prima della lettura, va ingrandito.`),
  ].join("\n");
  return (
    <span className={`rounded-md border px-2 py-1 text-[13px] ${st.classi}`} title={titolo}>
      {st.segno} Fonte: {letture.length} domain controller
      {ultima ? ` · letti ${formatDate(ultima)}` : ""}
      {guasti.length ? ` · ${guasti.length} non letti` : ""}
      {persi.length ? " · eventi persi: registro troppo piccolo" : ""}
    </span>
  );
}
