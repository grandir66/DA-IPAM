"use client";

import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface StatusBadgeProps {
  status: "online" | "offline" | "unknown";
  className?: string;
  /** ISO timestamp dell'ultima volta che l'host ha risposto a un probe. */
  lastSeen?: string | null;
  /** Soglia (ore) oltre la quale uno stato online è considerato stale. Default 24h. */
  staleAfterHours?: number;
}

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

export function StatusBadge({ status, className, lastSeen, staleAfterHours = 24 }: StatusBadgeProps) {
  const stale =
    status === "online" &&
    !!lastSeen &&
    Date.now() - Date.parse(lastSeen) > staleAfterHours * 3600 * 1000;

  const label =
    status === "online"
      ? stale
        ? "Online (stale)"
        : "Online"
      : status === "offline"
        ? "Offline"
        : "Sconosciuto";

  const badge = (
    <Badge
      variant="outline"
      className={cn(
        "gap-1.5 font-medium",
        status === "online" && !stale && "border-success/30 bg-success/10 text-success",
        status === "online" && stale && "border-amber-400/40 bg-amber-400/10 text-amber-700 dark:text-amber-400",
        status === "offline" && "border-destructive/30 bg-destructive/10 text-destructive",
        status === "unknown" && "border-muted-foreground/30 bg-muted text-muted-foreground",
        className
      )}
    >
      <span
        className={cn(
          "h-2 w-2 rounded-full",
          status === "online" && !stale && "bg-success animate-pulse",
          status === "online" && stale && "bg-amber-500",
          status === "offline" && "bg-destructive",
          status === "unknown" && "bg-muted-foreground"
        )}
      />
      {label}
      {lastSeen && (
        <span className="text-[10px] opacity-70 font-normal">· {formatRelative(lastSeen)}</span>
      )}
    </Badge>
  );

  if (!lastSeen) return badge;

  const absolute = (() => {
    try {
      return new Date(lastSeen).toLocaleString("it-IT");
    } catch {
      return lastSeen;
    }
  })();

  return (
    <TooltipProvider delay={150}>
      <Tooltip>
        <TooltipTrigger render={<span className="inline-block">{badge}</span>} />
        <TooltipContent>
          <div className="text-xs">
            <div className="font-medium">Ultimo contatto</div>
            <div className="opacity-80">{absolute}</div>
            {stale && (
              <div className="mt-1 text-amber-300">
                Stato online ma nessuna risposta da oltre {staleAfterHours}h
              </div>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
