"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, Activity } from "lucide-react";

interface Change {
  host_id: number;
  ip: string;
  hostname: string | null;
  from_status: string | null;
  to_status: string;
  changed_at: string;
}

/**
 * Feed cronologico delle ultime transizioni di stato dei host monitorati
 * (online↔offline). Polling ogni 30s. Mostra max 8 righe.
 */
export function StatusChangeFeed() {
  const [items, setItems] = useState<Change[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = () => {
      fetch("/api/status/changes?limit=8&hours=24")
        .then((r) => r.json())
        .then((rows: Change[]) => setItems(Array.isArray(rows) ? rows : []))
        .catch(() => setItems([]))
        .finally(() => setLoading(false));
    };
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);

  if (loading && items.length === 0) {
    return <p className="text-xs text-muted-foreground py-4 text-center">Caricamento…</p>;
  }
  if (items.length === 0) {
    return (
      <p className="text-xs text-muted-foreground py-4 text-center">
        Nessun cambio di stato nelle ultime 24h.
      </p>
    );
  }

  return (
    <div className="divide-y divide-border -mx-2">
      {items.map((c, i) => {
        const wentDown = c.to_status === "offline";
        return (
          <Link
            key={`${c.host_id}-${c.changed_at}-${i}`}
            href={`/hosts/${c.host_id}`}
            className="flex items-center gap-2 px-2 py-2 text-sm hover:bg-muted/50 transition-colors"
          >
            {wentDown ? (
              <ArrowDownRight className="h-3.5 w-3.5 text-destructive shrink-0" />
            ) : (
              <ArrowUpRight className="h-3.5 w-3.5 text-success shrink-0" />
            )}
            <span className="font-mono text-xs">{c.ip}</span>
            {c.hostname && (
              <span className="text-xs text-muted-foreground truncate">{c.hostname}</span>
            )}
            <span className={`ml-auto text-[11px] font-medium ${wentDown ? "text-destructive" : "text-success"}`}>
              {c.from_status ?? "?"} → {c.to_status}
            </span>
            <span className="text-[11px] text-muted-foreground whitespace-nowrap">
              {timeAgo(c.changed_at)}
            </span>
          </Link>
        );
      })}
    </div>
  );
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s fa`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m fa`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h fa`;
  const d = Math.floor(h / 24);
  return `${d}g fa`;
}

/** Header con icona — opzionale per il consumer */
export function StatusChangeFeedHeader() {
  return (
    <span className="text-base flex items-center gap-2">
      <Activity className="h-4 w-4 text-primary" />
      Transizioni recenti
    </span>
  );
}
