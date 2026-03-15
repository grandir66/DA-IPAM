"use client";

import { useEffect, useState } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface StatusEntry {
  status: "online" | "offline";
  checked_at: string;
}

export function UptimeTimeline({ hostId }: { hostId: number }) {
  const [entries, setEntries] = useState<StatusEntry[]>([]);

  useEffect(() => {
    fetch(`/api/hosts/${hostId}/status-history`)
      .then((r) => r.json())
      .then((data) => setEntries(data.slice(0, 96))) // Last 96 entries (4 days at 1h interval)
      .catch(() => setEntries([]));
  }, [hostId]);

  if (entries.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        Nessuno storico di stato disponibile.
      </p>
    );
  }

  // Reverse so oldest is on the left
  const reversed = [...entries].reverse();

  return (
    <div>
      <div className="flex gap-0.5">
        {reversed.map((entry, i) => (
          <Tooltip key={i}>
            <TooltipTrigger
              render={
                <div
                  className={`h-6 flex-1 min-w-[3px] rounded-sm transition-colors ${
                    entry.status === "online"
                      ? "bg-success hover:bg-success/80"
                      : "bg-destructive hover:bg-destructive/80"
                  }`}
                />
              }
            />
            <TooltipContent side="top" className="text-xs">
              <p className="font-medium capitalize">{entry.status}</p>
              <p className="text-muted-foreground">
                {new Date(entry.checked_at).toLocaleString("it-IT")}
              </p>
            </TooltipContent>
          </Tooltip>
        ))}
      </div>
      <div className="flex justify-between mt-1 text-[10px] text-muted-foreground">
        <span>{reversed.length > 0 ? new Date(reversed[0].checked_at).toLocaleDateString("it-IT") : ""}</span>
        <span>Adesso</span>
      </div>
    </div>
  );
}
