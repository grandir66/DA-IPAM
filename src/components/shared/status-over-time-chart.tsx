"use client";
import { parseDbDate } from "@/lib/db-date";

import { useEffect, useState } from "react";
import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

interface Point {
  time: string;
  online: number;
  offline: number;
  unknown: number;
  total: number;
  health_pct: number | null;
}

type Period = "24h" | "7d" | "30d";


/** Offline a righe (Riccardo, 20/10): stessa trama delle barre delle subnet. */
const TRAMA_OFFLINE = "repeating-linear-gradient(135deg, var(--host-offline) 0 2px, transparent 2px 4px)";
/**
 * Stato host nel tempo: stacked area online/offline/unknown + linea Health%.
 * Health% usa un asse Y secondario (destra) per non collassare contro i conteggi.
 */
/** `altezza`: la dashboard in una schermata (20/10) lo vuole più basso; di default 280. */
export function StatusOverTimeChart({ altezza = 280 }: { altezza?: number } = {}) {
  const [data, setData] = useState<Point[]>([]);
  const [period, setPeriod] = useState<Period>("24h");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const hours = period === "24h" ? 24 : period === "7d" ? 168 : 720;
    setLoading(true);
    fetch(`/api/status/chart-detailed?hours=${hours}`)
      .then((r) => r.json())
      .then((rows: Point[]) => setData(Array.isArray(rows) ? rows : []))
      .catch(() => setData([]))
      .finally(() => setLoading(false));
  }, [period]);

  const latest = data.length > 0 ? data[data.length - 1] : null;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="flex gap-1">
          {(["24h", "7d", "30d"] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1 text-[13px] rounded-md transition-colors ${
                period === p
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              {p}
            </button>
          ))}
        </div>
        {latest && (
          <div className="flex items-center gap-3 text-[13px]">
            <span className="inline-flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-sm bg-[var(--host-online)]" />
              <span className="text-muted-foreground">Online</span>
              <span className="font-mono font-semibold">{latest.online}</span>
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: TRAMA_OFFLINE }} />
              <span className="text-muted-foreground">Offline</span>
              <span className="font-mono font-semibold">{latest.offline}</span>
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-sm bg-[var(--host-sconosciuto)]" />
              <span className="text-muted-foreground">Sconosciuti</span>
              <span className="font-mono font-semibold">{latest.unknown}</span>
            </span>
            <span className="inline-flex items-center gap-1 ml-2 pl-2 border-l border-border" title="Host controllati nelle ultime 24 ore. La Health in alto conta anche gli offline visti negli ultimi 7 giorni.">
              <span className="text-muted-foreground">Uptime 24 h</span>
              <span className="font-mono font-semibold text-primary">{latest.health_pct === null ? "—" : `${latest.health_pct}%`}</span>
            </span>
          </div>
        )}
      </div>

      {data.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm">
          {loading ? "Caricamento…" : "Nessun dato disponibile. I dati appariranno dopo le prime scansioni."}
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={altezza}>
          <ComposedChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="gOnline" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--host-online)" stopOpacity={0.7} />
                <stop offset="95%" stopColor="var(--host-online)" stopOpacity={0.45} />
              </linearGradient>
              {/* Offline a righe diagonali: si riconosce dalla forma, non solo dal colore. */}
              <pattern id="gOffline" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width="6" height="6" fill="var(--card)" />
                <rect width="3" height="6" fill="var(--host-offline)" />
              </pattern>
              <linearGradient id="gUnknown" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--host-sconosciuto)" stopOpacity={0.9} />
                <stop offset="95%" stopColor="var(--host-sconosciuto)" stopOpacity={0.6} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis
              dataKey="time"
              tickFormatter={(t: string) => {
                const d = parseDbDate(t);
                return period === "24h"
                  ? d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })
                  : d.toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" });
              }}
              stroke="var(--muted-foreground)"
              fontSize={13}
            />
            <YAxis yAxisId="counts" stroke="var(--muted-foreground)" fontSize={13} allowDecimals={false} />
            <YAxis
              yAxisId="pct"
              orientation="right"
              stroke="var(--primary)"
              fontSize={13}
              domain={[0, 100]}
              tickFormatter={(v: number) => `${v}%`}
              width={36}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "var(--card)",
                border: "1px solid var(--border)",
                borderRadius: "8px",
                fontSize: "13px",
              }}
              labelFormatter={(t) => (typeof t === "string" ? parseDbDate(t).toLocaleString("it-IT") : String(t ?? ""))}
              formatter={(v, name) => {
                const val = typeof v === "number" ? v : Number(v ?? 0);
                return name === "Uptime %" ? [`${val}%`, name as string] : [val, name as string];
              }}
            />
            {/* Scritte della legenda nel colore del testo, non della serie: «Sconosciuti» in grigio
                chiaro su bianco non si leggeva (Riccardo, 20/10). */}
            <Legend
              wrapperStyle={{ fontSize: "13px", paddingTop: "8px" }}
              iconSize={10}
              formatter={(v) => <span style={{ color: "var(--foreground)" }}>{String(v)}</span>}
            />
            <Area
              yAxisId="counts"
              type="monotone"
              dataKey="online"
              name="Online"
              stackId="1"
              stroke="var(--host-online)"
              fill="url(#gOnline)"
              strokeWidth={1.5}
            />
            <Area
              yAxisId="counts"
              type="monotone"
              dataKey="offline"
              name="Offline"
              stackId="1"
              stroke="var(--host-offline)"
              fill="url(#gOffline)"
              strokeWidth={1.5}
            />
            <Area
              yAxisId="counts"
              type="monotone"
              dataKey="unknown"
              name="Sconosciuti"
              stackId="1"
              stroke="var(--host-sconosciuto)"
              fill="url(#gUnknown)"
              strokeWidth={1}
            />
            <Line
              yAxisId="pct"
              type="monotone"
              dataKey="health_pct"
              name="Uptime %"
              stroke="var(--primary)"
              strokeWidth={2}
              dot={false}
              strokeDasharray="4 2"
            />
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
