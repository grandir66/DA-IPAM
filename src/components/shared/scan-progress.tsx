"use client";

import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import type { ScanProgress as ScanProgressType } from "@/types";

interface ScanProgressProps {
  progress: ScanProgressType;
}

export function ScanProgress({ progress }: ScanProgressProps) {
  const pct = progress.total > 0 ? Math.round((progress.scanned / progress.total) * 100) : 0;
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const start = new Date(progress.started_at).getTime();
    const timer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [progress.started_at]);

  const formatElapsed = (s: number) => {
    const min = Math.floor(s / 60);
    const sec = s % 60;
    return min > 0 ? `${min}m ${sec}s` : `${sec}s`;
  };

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardContent className="pt-4 pb-3">
        <div className="flex items-center justify-between text-sm mb-1">
          <span className="font-medium">
            Scansione {progress.scan_type.toUpperCase()} in corso
          </span>
          <span className="text-muted-foreground text-xs">
            {formatElapsed(elapsed)}
          </span>
        </div>
        <div className="text-xs text-muted-foreground mb-2">
          {progress.phase}
          {progress.found > 0 && ` — ${progress.found} host trovati`}
        </div>
        <div className="h-2 rounded-full bg-muted overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              pct > 0 ? "bg-primary" : "bg-primary/50 animate-pulse"
            }`}
            style={{ width: pct > 0 ? `${pct}%` : "100%" }}
          />
        </div>
        {pct > 0 && (
          <div className="text-xs text-muted-foreground mt-1 text-right">
            {progress.scanned}/{progress.total} ({pct}%)
          </div>
        )}
      </CardContent>
    </Card>
  );
}
