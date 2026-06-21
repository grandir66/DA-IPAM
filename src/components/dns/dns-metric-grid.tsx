"use client";

interface Metric {
  label: string;
  value: string;
  hint?: string;
  accent?: "good" | "warn" | "neutral";
}

export function DnsMetricGrid({ metrics }: { metrics: Metric[] }) {
  return (
    <div className={`grid gap-2 grid-cols-2 ${metrics.length >= 4 ? "sm:grid-cols-4" : ""}`}>
      {metrics.map((m) => (
        <div
          key={m.label}
          className={`rounded border p-2 text-sm ${
            m.accent === "good"
              ? "border-emerald-500/30 bg-emerald-500/5"
              : m.accent === "warn"
                ? "border-amber-500/30 bg-amber-500/5"
                : ""
          }`}
        >
          <div className="text-xs text-muted-foreground">{m.label}</div>
          <div className="font-mono font-medium">{m.value}</div>
          {m.hint && <div className="text-[10px] text-muted-foreground mt-0.5">{m.hint}</div>}
        </div>
      ))}
    </div>
  );
}
