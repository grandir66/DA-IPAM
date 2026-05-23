"use client";

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
  health_pct: number;
}

type Period = "24h" | "7d" | "30d";

/**
 * Stato host nel tempo: stacked area online/offline/unknown + linea Health%.
 * Health% usa un asse Y secondario (destra) per non collassare contro i conteggi.
 */
export function StatusOverTimeChart() {
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
              className={`px-3 py-1 text-xs rounded-md transition-colors ${
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
          <div className="flex items-center gap-3 text-xs">
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-success" />
              <span className="text-muted-foreground">Online</span>
              <span className="font-mono font-semibold">{latest.online}</span>
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-destructive" />
              <span className="text-muted-foreground">Offline</span>
              <span className="font-mono font-semibold">{latest.offline}</span>
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-muted-foreground/40" />
              <span className="text-muted-foreground">Sconosciuti</span>
              <span className="font-mono font-semibold">{latest.unknown}</span>
            </span>
            <span className="inline-flex items-center gap-1 ml-2 pl-2 border-l border-border">
              <span className="text-muted-foreground">Health</span>
              <span className="font-mono font-semibold text-primary">{latest.health_pct}%</span>
            </span>
          </div>
        )}
      </div>

      {data.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm">
          {loading ? "Caricamento…" : "Nessun dato disponibile. I dati appariranno dopo le prime scansioni."}
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="gOnline" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="hsl(var(--success))" stopOpacity={0.55} />
                <stop offset="95%" stopColor="hsl(var(--success))" stopOpacity={0.1} />
              </linearGradient>
              <linearGradient id="gOffline" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="hsl(var(--destructive))" stopOpacity={0.55} />
                <stop offset="95%" stopColor="hsl(var(--destructive))" stopOpacity={0.1} />
              </linearGradient>
              <linearGradient id="gUnknown" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="hsl(var(--muted-foreground))" stopOpacity={0.35} />
                <stop offset="95%" stopColor="hsl(var(--muted-foreground))" stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis
              dataKey="time"
              tickFormatter={(t: string) => {
                const d = new Date(t);
                return period === "24h"
                  ? d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })
                  : d.toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" });
              }}
              stroke="hsl(var(--muted-foreground))"
              fontSize={11}
            />
            <YAxis yAxisId="counts" stroke="hsl(var(--muted-foreground))" fontSize={11} allowDecimals={false} />
            <YAxis
              yAxisId="pct"
              orientation="right"
              stroke="hsl(var(--primary))"
              fontSize={11}
              domain={[0, 100]}
              tickFormatter={(v: number) => `${v}%`}
              width={36}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: "8px",
                fontSize: "12px",
              }}
              labelFormatter={(t) => (typeof t === "string" ? new Date(t).toLocaleString("it-IT") : String(t ?? ""))}
              formatter={(v, name) => {
                const val = typeof v === "number" ? v : Number(v ?? 0);
                return name === "Health %" ? [`${val}%`, name as string] : [val, name as string];
              }}
            />
            <Legend wrapperStyle={{ fontSize: "11px", paddingTop: "8px" }} iconSize={10} />
            <Area
              yAxisId="counts"
              type="monotone"
              dataKey="online"
              name="Online"
              stackId="1"
              stroke="hsl(var(--success))"
              fill="url(#gOnline)"
              strokeWidth={1.5}
            />
            <Area
              yAxisId="counts"
              type="monotone"
              dataKey="offline"
              name="Offline"
              stackId="1"
              stroke="hsl(var(--destructive))"
              fill="url(#gOffline)"
              strokeWidth={1.5}
            />
            <Area
              yAxisId="counts"
              type="monotone"
              dataKey="unknown"
              name="Sconosciuti"
              stackId="1"
              stroke="hsl(var(--muted-foreground))"
              fill="url(#gUnknown)"
              strokeWidth={1}
            />
            <Line
              yAxisId="pct"
              type="monotone"
              dataKey="health_pct"
              name="Health %"
              stroke="hsl(var(--primary))"
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
