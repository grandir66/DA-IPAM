"use client";

import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** Stati derivati visualizzati nel badge. Dietro le quinte il DB conosce solo
 *  online/offline/unknown; le sotto-categorie offline (unreachable, transient,
 *  lost) e il flag stale si computano a display time da `last_seen` + interval
 *  cron della subnet. */
export type DerivedHostState =
  | "online"
  | "online_stale"
  | "offline_recent"
  | "unreachable"
  | "transient"
  | "lost"
  | "unknown";

interface StatusBadgeProps {
  status: "online" | "offline" | "unknown";
  className?: string;
  /** ISO timestamp dell'ultima volta che l'host ha risposto a un probe. */
  lastSeen?: string | null;
  /** Soglia (ore) oltre la quale un host online è considerato stale. Default 24h. */
  staleAfterHours?: number;
  /** Frequenza minima dello scan attivo sulla rete dell'host, in minuti.
   *  Usata per calcolare la soglia "unreachable = 4 cicli". Default 30 min. */
  scanIntervalMinutes?: number | null;
}

const MS_PER_HOUR = 3600 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;

function formatRelative(iso: string): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return iso;
  const diffSec = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (diffSec < 60) return `${diffSec}s fa`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m fa`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 48) return `${diffHr}h fa`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay}g fa`;
  const diffMon = Math.floor(diffDay / 30);
  return diffMon < 12 ? `${diffMon}mese fa` : `${Math.floor(diffMon / 12)}anni fa`;
}

function deriveState(
  status: StatusBadgeProps["status"],
  lastSeen: string | null | undefined,
  staleAfterHours: number,
  scanIntervalMinutes: number | null | undefined,
): DerivedHostState {
  if (status === "unknown") return "unknown";
  if (!lastSeen) return status === "online" ? "online" : "offline_recent";
  const ageMs = Math.max(0, Date.now() - Date.parse(lastSeen));
  if (status === "online") {
    return ageMs > staleAfterHours * MS_PER_HOUR ? "online_stale" : "online";
  }
  // status === "offline"
  if (ageMs >= 7 * MS_PER_DAY) return "lost";
  if (ageMs >= MS_PER_DAY) return "transient";
  const interval = scanIntervalMinutes && scanIntervalMinutes > 0 ? scanIntervalMinutes : 30;
  const unreachableMs = 4 * interval * 60 * 1000;
  if (ageMs >= unreachableMs) return "unreachable";
  return "offline_recent";
}

const STATE_META: Record<DerivedHostState, {
  label: string;
  badgeClass: string;
  dotClass: string;
  tooltip: string;
}> = {
  online: {
    label: "Online",
    badgeClass: "border-success/30 bg-success/10 text-success",
    dotClass: "bg-success animate-pulse",
    tooltip: "Risponde ai probe (ICMP o TCP).",
  },
  online_stale: {
    label: "Online (stale)",
    badgeClass: "border-amber-400/40 bg-amber-400/10 text-amber-700 dark:text-amber-400",
    dotClass: "bg-amber-500",
    tooltip: "Marcato online ma ultima risposta vecchia. Da ri-verificare.",
  },
  offline_recent: {
    label: "Offline",
    badgeClass: "border-destructive/30 bg-destructive/10 text-destructive",
    dotClass: "bg-destructive",
    tooltip: "Non ha risposto all'ultimo scan. Potrebbe essere un down transitorio.",
  },
  unreachable: {
    label: "Unreachable",
    badgeClass: "border-orange-500/40 bg-orange-500/10 text-orange-700 dark:text-orange-400",
    dotClass: "bg-orange-500",
    tooltip: "Down da 4+ cicli consecutivi: verifica alimentazione/rete.",
  },
  transient: {
    label: "Transient",
    badgeClass: "border-yellow-600/40 bg-yellow-600/10 text-yellow-800 dark:text-yellow-500",
    dotClass: "bg-yellow-600",
    tooltip: "Down da oltre 24h. Probabile spegnimento programmato o lungo down.",
  },
  lost: {
    label: "Lost",
    badgeClass: "border-zinc-600/40 bg-zinc-600/10 text-zinc-700 dark:text-zinc-400",
    dotClass: "bg-zinc-600",
    tooltip: "Down da oltre 7 giorni. Candidato a cleanup/rimozione.",
  },
  unknown: {
    label: "Sconosciuto",
    badgeClass: "border-muted-foreground/30 bg-muted text-muted-foreground",
    dotClass: "bg-muted-foreground",
    tooltip: "Mai probato attivamente.",
  },
};

export function StatusBadge({ status, className, lastSeen, staleAfterHours = 24, scanIntervalMinutes }: StatusBadgeProps) {
  const derived = deriveState(status, lastSeen, staleAfterHours, scanIntervalMinutes);
  const meta = STATE_META[derived];

  const badge = (
    <Badge
      variant="outline"
      className={cn("gap-1.5 font-medium", meta.badgeClass, className)}
    >
      <span className={cn("h-2 w-2 rounded-full", meta.dotClass)} />
      {meta.label}
      {lastSeen && (
        <span className="text-[10px] opacity-70 font-normal">· {formatRelative(lastSeen)}</span>
      )}
    </Badge>
  );

  if (!lastSeen && derived === "unknown") return badge;

  const absolute = lastSeen
    ? (() => {
        try { return new Date(lastSeen).toLocaleString("it-IT"); } catch { return lastSeen; }
      })()
    : null;

  return (
    <TooltipProvider delay={150}>
      <Tooltip>
        <TooltipTrigger render={<span className="inline-block">{badge}</span>} />
        <TooltipContent>
          <div className="text-xs space-y-1">
            <div className="font-medium">{meta.label}</div>
            <div className="opacity-80">{meta.tooltip}</div>
            {absolute && (
              <div className="opacity-60 pt-1 border-t border-background/20">
                Ultimo contatto: {absolute}
              </div>
            )}
            {scanIntervalMinutes && (
              <div className="opacity-60">
                Soglia unreachable: {4 * scanIntervalMinutes} min (4× scan {scanIntervalMinutes}m)
              </div>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
