"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";

type Range = "1h" | "24h" | "7d" | "30d";

const RANGE_FROM: Record<Range, string> = {
  "1h": "-1h",
  "24h": "-1d",
  "7d": "-7d",
  "30d": "-30d",
};

interface GraphSpec {
  type: string;
  label: string;
}

/**
 * Etichette italiane per i tipi LibreNMS più comuni. Per i tipi non mappati
 * usiamo il `desc` raw dall'API. La lista di tipi disponibili viene FETCHATA
 * da `/api/integrations/librenms/graph-list` perché dipende dal vendor/OS del
 * device: un router ha device_bits/processor/mempool, un host Windows magari
 * solo ping_perf + uptime, ecc.
 */
const TYPE_LABELS: Record<string, string> = {
  device_bits: "Traffico (bits/s)",
  device_processor: "CPU",
  device_mempool: "Memoria",
  device_ping_perf: "Ping (latenza + loss)",
  device_icmp_perf: "Ping ICMP",
  device_uptime: "Uptime",
  device_poller_perf: "Poller (durata polling)",
  device_availability: "Disponibilità",
  device_hr_processes: "Processi attivi",
  device_hr_users: "Utenti loggati",
  device_netstat_tcp: "TCP statistiche",
  device_netstat_udp: "UDP statistiche",
  device_netstat_ip: "IP statistiche",
  device_netstat_icmp: "ICMP statistiche",
  device_netstat_snmp: "SNMP statistiche",
  device_storage: "Storage",
  device_temperature: "Temperatura",
  device_voltage: "Voltaggio",
  device_current: "Corrente",
  device_fanspeed: "Velocità ventole",
};

/** Priorità di display: i grafici più "leggibili" in cima. */
const TYPE_PRIORITY: string[] = [
  "device_bits",
  "device_processor",
  "device_mempool",
  "device_ping_perf",
  "device_icmp_perf",
  "device_uptime",
  "device_availability",
  "device_temperature",
];

/**
 * Grafici "sempre da tentare" perché LibreNMS spesso non li elenca nella
 * risposta di `/devices/{id}/graphs` anche quando il device ha i dati (CPU/RAM/
 * traffico aggregato). Li passiamo come tentativo: se LibreNMS ritorna 404
 * il componente <LibreNMSGraph> mostra "non disponibile" e amen, altrimenti
 * appaiono.
 */
const ALWAYS_PROBE: string[] = [
  "device_processor",
  "device_mempool",
  "device_bits",
  "device_ping_perf",
];

interface Props {
  deviceId: number;
  /** Limita il numero di grafici renderizzati (default 6 più rilevanti). */
  limit?: number;
}

/**
 * Mostra i grafici LibreNMS per il device. Fetch dinamico della lista disponibili
 * (un Windows host non ha gli stessi grafici di un router Mikrotik) e rendering
 * delle PNG via `/api/integrations/librenms/graph`.
 */
export function LibreNMSDeviceGraphs({ deviceId, limit = 6 }: Props) {
  const [range, setRange] = useState<Range>("24h");
  const [reloadKey, setReloadKey] = useState(0);
  const [availableGraphs, setAvailableGraphs] = useState<GraphSpec[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const ranges: Range[] = useMemo(() => ["1h", "24h", "7d", "30d"], []);

  useEffect(() => {
    setAvailableGraphs(null);
    setLoadError(null);
    fetch(`/api/integrations/librenms/graph-list?device_id=${deviceId}`, { cache: "no-store" })
      .then(async (r) => {
        const data = await r.json().catch(() => ({ graphs: [] as Array<{ name: string; desc?: string }> }));
        if (!r.ok) {
          setLoadError(data?.error || `HTTP ${r.status}`);
          // Anche se il list endpoint fallisce, tentiamo i comuni
          setAvailableGraphs(ALWAYS_PROBE.map((t) => ({ type: t, label: TYPE_LABELS[t] ?? t })));
          return;
        }
        const list = (data.graphs ?? []) as Array<{ name: string; desc?: string }>;
        // v0.2.625: merge ALWAYS_PROBE + lista dinamica.
        // La lista LibreNMS è spesso incompleta (omette CPU/RAM/traffic anche se i
        // grafici esistono): forziamo i tipi base sempre, gli altri si aggiungono.
        const known = new Set<string>(ALWAYS_PROBE);
        const merged: Array<{ name: string; desc?: string }> = ALWAYS_PROBE.map((t) => ({ name: t, desc: TYPE_LABELS[t] }));
        for (const g of list) {
          if (!known.has(g.name)) {
            merged.push(g);
            known.add(g.name);
          }
        }
        // Ordino per priorità
        const prioMap = new Map<string, number>();
        TYPE_PRIORITY.forEach((t, i) => prioMap.set(t, i));
        merged.sort((a, b) => {
          const pa = prioMap.has(a.name) ? prioMap.get(a.name)! : 100;
          const pb = prioMap.has(b.name) ? prioMap.get(b.name)! : 100;
          return pa - pb;
        });
        setAvailableGraphs(merged.slice(0, limit).map((g) => ({
          type: g.name,
          label: TYPE_LABELS[g.name] ?? g.desc ?? g.name,
        })));
      })
      .catch((e) => {
        setLoadError(e instanceof Error ? e.message : String(e));
        // Fallback: prova comunque i comuni
        setAvailableGraphs(ALWAYS_PROBE.map((t) => ({ type: t, label: TYPE_LABELS[t] ?? t })));
      });
  }, [deviceId, limit]);

  if (availableGraphs === null) {
    return (
      <div className="flex items-center justify-center py-6 text-xs text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin mr-2" />
        Caricamento grafici disponibili…
      </div>
    );
  }

  if (availableGraphs.length === 0) {
    return (
      <p className="text-xs text-muted-foreground py-4 text-center">
        {loadError
          ? `Impossibile leggere la lista grafici LibreNMS: ${loadError}`
          : "Nessun grafico disponibile per questo device. LibreNMS non ha ancora pollato dati metriche (richiede SNMP attivo + alcuni cicli di polling)."}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="inline-flex rounded-md border border-border overflow-hidden text-xs">
          {ranges.map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`px-3 py-1.5 transition-colors ${
                range === r
                  ? "bg-primary text-primary-foreground"
                  : "bg-background hover:bg-muted text-muted-foreground"
              }`}
            >
              {r}
            </button>
          ))}
        </div>
        <button
          onClick={() => setReloadKey((k) => k + 1)}
          className="text-xs text-muted-foreground hover:text-foreground"
          title="Ricarica grafici"
        >
          Ricarica
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {availableGraphs.map((g) => (
          <LibreNMSGraph
            key={`${g.type}-${range}-${reloadKey}`}
            deviceId={deviceId}
            type={g.type}
            label={g.label}
            from={RANGE_FROM[range]}
          />
        ))}
      </div>
    </div>
  );
}

interface GraphProps {
  deviceId: number;
  type: string;
  label: string;
  from: string;
}

function LibreNMSGraph({ deviceId, type, label, from }: GraphProps) {
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const src = `/api/integrations/librenms/graph?device_id=${deviceId}&type=${encodeURIComponent(type)}&from=${encodeURIComponent(from)}&to=now&width=1200&height=250`;

  // v0.2.625: i grafici non disponibili (404 da LibreNMS) sono nascosti
  // completamente — non ha senso vedere placeholder vuoti per tipi che il
  // device non supporta. Resta solo lo spinner finché carica.
  if (state === "error") return null;

  return (
    <div className="rounded-md border border-border bg-muted/20">
      <div className="px-3 py-1.5 border-b border-border text-xs font-medium text-muted-foreground">
        {label}
      </div>
      <div className="relative min-h-[120px] flex items-center justify-center">
        {state === "loading" && (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground absolute" />
        )}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={label}
          className={`w-full ${state === "ok" ? "" : "opacity-0 h-0"}`}
          onLoad={() => setState("ok")}
          onError={() => setState("error")}
        />
      </div>
    </div>
  );
}
