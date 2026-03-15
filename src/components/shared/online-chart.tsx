"use client";

import { useEffect, useState } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface DataPoint {
  time: string;
  online: number;
  offline: number;
}

export function OnlineChart() {
  const [data, setData] = useState<DataPoint[]>([]);
  const [period, setPeriod] = useState<"24h" | "7d" | "30d">("24h");

  useEffect(() => {
    const hours = period === "24h" ? 24 : period === "7d" ? 168 : 720;
    fetch(`/api/status/chart?hours=${hours}`)
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData([]));
  }, [period]);

  if (data.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground text-sm">
        Nessun dato disponibile. I dati appariranno dopo le prime scansioni.
      </div>
    );
  }

  return (
    <div>
      <div className="flex gap-1 mb-4">
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
      <ResponsiveContainer width="100%" height={240}>
        <AreaChart data={data}>
          <defs>
            <linearGradient id="colorOnline" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="hsl(var(--success))" stopOpacity={0.3} />
              <stop offset="95%" stopColor="hsl(var(--success))" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="colorOffline" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="hsl(var(--destructive))" stopOpacity={0.3} />
              <stop offset="95%" stopColor="hsl(var(--destructive))" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis
            dataKey="time"
            tickFormatter={(t) => {
              const d = new Date(t);
              return period === "24h"
                ? d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })
                : d.toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" });
            }}
            stroke="hsl(var(--muted-foreground))"
            fontSize={11}
          />
          <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} />
          <Tooltip
            contentStyle={{
              backgroundColor: "hsl(var(--card))",
              border: "1px solid hsl(var(--border))",
              borderRadius: "8px",
              fontSize: "12px",
            }}
            labelFormatter={(t) => new Date(t).toLocaleString("it-IT")}
          />
          <Area
            type="monotone"
            dataKey="online"
            stroke="hsl(var(--success))"
            fill="url(#colorOnline)"
            strokeWidth={2}
            name="Online"
          />
          <Area
            type="monotone"
            dataKey="offline"
            stroke="hsl(var(--destructive))"
            fill="url(#colorOffline)"
            strokeWidth={2}
            name="Offline"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
