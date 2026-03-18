"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { Activity, Clock, TrendingUp, ArrowUp, RefreshCw } from "lucide-react";

interface LatencyPoint {
  time: string;
  response_time_ms: number | null;
  status: string;
}

interface LatencyStats {
  uptime: number;
  avgLatency: number | null;
  maxLatency: number | null;
  lastCheck: string | null;
  totalChecks: number;
  onlineChecks: number;
}

const TIME_RANGES = [
  { label: "1h", hours: 1 },
  { label: "6h", hours: 6 },
  { label: "24h", hours: 24 },
  { label: "7g", hours: 168 },
] as const;

function computeStats(data: LatencyPoint[]): LatencyStats {
  if (data.length === 0) {
    return { uptime: 0, avgLatency: null, maxLatency: null, lastCheck: null, totalChecks: 0, onlineChecks: 0 };
  }

  const onlinePoints = data.filter((d) => d.status === "online");
  const latencies = onlinePoints
    .map((d) => d.response_time_ms)
    .filter((v): v is number => v !== null && v > 0);

  return {
    uptime: data.length > 0 ? (onlinePoints.length / data.length) * 100 : 0,
    avgLatency: latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : null,
    maxLatency: latencies.length > 0 ? Math.max(...latencies) : null,
    lastCheck: data[data.length - 1]?.time ?? null,
    totalChecks: data.length,
    onlineChecks: onlinePoints.length,
  };
}

function formatTime(timeStr: string, hours: number): string {
  const d = new Date(timeStr + "Z");
  if (hours <= 6) {
    return d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
  }
  if (hours <= 24) {
    return d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: { value: number | null; payload: LatencyPoint }[];
  label?: string;
}

function CustomTooltip({ active, payload }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0].payload;
  const d = new Date(point.time + "Z");

  return (
    <div className="bg-popover border border-border rounded-md px-3 py-2 shadow-md text-sm">
      <p className="text-muted-foreground text-xs">
        {d.toLocaleString("it-IT")}
      </p>
      <p className="font-medium">
        {point.status === "online" ? (
          <span className="text-success">
            Online{point.response_time_ms !== null ? ` - ${Math.round(point.response_time_ms)}ms` : ""}
          </span>
        ) : (
          <span className="text-destructive">Offline</span>
        )}
      </p>
    </div>
  );
}

export function LatencyChart({ hostId }: { hostId: number }) {
  const [data, setData] = useState<LatencyPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [hours, setHours] = useState(24);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/hosts/${hostId}/latency?hours=${hours}`);
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } catch {
      // silently fail
    }
    setLoading(false);
  }, [hostId, hours]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const stats = computeStats(data);

  // Transform data for the chart: offline points show as 0 latency with a marker
  const chartData = data.map((d) => ({
    ...d,
    latency: d.status === "online" ? (d.response_time_ms ?? 0) : 0,
    offline: d.status === "offline" ? 1 : 0,
  }));

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            Monitoraggio Latenza
          </CardTitle>
          <div className="flex items-center gap-1">
            {TIME_RANGES.map((range) => (
              <Button
                key={range.hours}
                variant={hours === range.hours ? "default" : "outline"}
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => setHours(range.hours)}
              >
                {range.label}
              </Button>
            ))}
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2"
              onClick={fetchData}
              disabled={loading}
            >
              <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Stats Summary */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatBox
            icon={<TrendingUp className="h-3.5 w-3.5" />}
            label="Uptime"
            value={`${stats.uptime.toFixed(1)}%`}
            color={stats.uptime >= 99 ? "text-success" : stats.uptime >= 95 ? "text-warning" : "text-destructive"}
          />
          <StatBox
            icon={<Clock className="h-3.5 w-3.5" />}
            label="Latenza media"
            value={stats.avgLatency !== null ? `${Math.round(stats.avgLatency)}ms` : "—"}
            color="text-primary"
          />
          <StatBox
            icon={<ArrowUp className="h-3.5 w-3.5" />}
            label="Latenza max"
            value={stats.maxLatency !== null ? `${Math.round(stats.maxLatency)}ms` : "—"}
            color="text-muted-foreground"
          />
          <StatBox
            icon={<Activity className="h-3.5 w-3.5" />}
            label="Controlli"
            value={`${stats.onlineChecks}/${stats.totalChecks}`}
            color="text-muted-foreground"
          />
        </div>

        {/* Chart */}
        {loading ? (
          <div className="h-[200px] flex items-center justify-center text-muted-foreground text-sm">
            Caricamento...
          </div>
        ) : chartData.length === 0 ? (
          <div className="h-[200px] flex items-center justify-center text-muted-foreground text-sm">
            Nessun dato disponibile per il periodo selezionato
          </div>
        ) : (
          <div className="h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="latencyGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--color-primary)" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="var(--color-primary)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="time"
                  tickFormatter={(v: string) => formatTime(v, hours)}
                  tick={{ fontSize: 11 }}
                  stroke="var(--color-muted-foreground)"
                  tickLine={false}
                  axisLine={false}
                  interval="preserveStartEnd"
                  minTickGap={40}
                />
                <YAxis
                  tick={{ fontSize: 11 }}
                  stroke="var(--color-muted-foreground)"
                  tickLine={false}
                  axisLine={false}
                  width={45}
                  tickFormatter={(v: number) => `${v}ms`}
                />
                <Tooltip content={<CustomTooltip />} />
                {stats.avgLatency !== null && (
                  <ReferenceLine
                    y={stats.avgLatency}
                    stroke="var(--color-muted-foreground)"
                    strokeDasharray="3 3"
                    strokeOpacity={0.5}
                  />
                )}
                <Area
                  type="monotone"
                  dataKey="latency"
                  stroke="var(--color-primary)"
                  fill="url(#latencyGradient)"
                  strokeWidth={1.5}
                  dot={false}
                  activeDot={{ r: 3, strokeWidth: 0 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}

        {stats.lastCheck && (
          <p className="text-xs text-muted-foreground text-right">
            Ultimo controllo: {new Date(stats.lastCheck + "Z").toLocaleString("it-IT")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function StatBox({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string; color: string }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-center gap-1.5 text-muted-foreground mb-1">
        {icon}
        <span className="text-xs">{label}</span>
      </div>
      <p className={`text-lg font-bold ${color}`}>{value}</p>
    </div>
  );
}
