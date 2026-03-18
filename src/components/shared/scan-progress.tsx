"use client";

import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import type { ScanProgress as ScanProgressType } from "@/types";

interface ScanProgressProps {
  progress: ScanProgressType;
  onClose?: () => void;
}

export function ScanProgress({ progress, onClose }: ScanProgressProps) {
  const pct = progress.total > 0 ? Math.round((progress.scanned / progress.total) * 100) : 0;
  const [elapsed, setElapsed] = useState(0);
  const logEndRef = useRef<HTMLDivElement>(null);
  const isFinished = progress.status === "completed" || progress.status === "failed";

  useEffect(() => {
    const start = new Date(progress.started_at).getTime();
    const timer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [progress.started_at]);

  // Auto-scroll del log
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [progress.logs?.length]);

  const formatElapsed = (s: number) => {
    const min = Math.floor(s / 60);
    const sec = s % 60;
    return min > 0 ? `${min}m ${sec}s` : `${sec}s`;
  };

  const hasLogs = progress.logs && progress.logs.length > 0;

  return (
    <>
      {/* Overlay */}
      <div className="fixed inset-0 z-40 bg-black/50" />

      {/* Modale */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-background border rounded-lg shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-3 border-b">
            <div>
              <h3 className="text-sm font-semibold">
                Scansione {progress.scan_type.toUpperCase()}
                {isFinished
                  ? progress.status === "completed" ? " — completata" : " — fallita"
                  : " in corso"}
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                {progress.phase}
                {progress.found > 0 && ` — ${progress.found} host trovati`}
                {" · "}{formatElapsed(elapsed)}
              </p>
            </div>
            {isFinished && onClose && (
              <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8">
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>

          {/* Barra progresso */}
          <div className="px-5 py-3 border-b">
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  isFinished
                    ? progress.status === "completed" ? "bg-green-500" : "bg-red-500"
                    : pct > 0 ? "bg-primary" : "bg-primary/50 animate-pulse"
                }`}
                style={{ width: pct > 0 || isFinished ? `${Math.max(pct, isFinished ? 100 : 0)}%` : "100%" }}
              />
            </div>
            {pct > 0 && (
              <div className="text-xs text-muted-foreground mt-1 text-right">
                {progress.scanned}/{progress.total} ({pct}%)
              </div>
            )}
          </div>

          {/* Log */}
          <div className="flex-1 overflow-y-auto px-5 py-3 min-h-[120px]">
            {hasLogs ? (
              <div className="font-mono text-[11px] leading-relaxed space-y-0.5">
                {progress.logs!.map((line, i) => (
                  <div
                    key={i}
                    className={
                      line.includes("✓") ? "text-green-600 dark:text-green-400" :
                      line.includes("✗") ? "text-red-500 dark:text-red-400" :
                      "text-muted-foreground"
                    }
                  >
                    {line}
                  </div>
                ))}
                <div ref={logEndRef} />
              </div>
            ) : (
              <p className="text-xs text-muted-foreground text-center py-4">
                {isFinished ? "Nessun log disponibile" : "In attesa dei risultati..."}
              </p>
            )}
          </div>

          {/* Footer con pulsante chiusura */}
          {isFinished && onClose && (
            <div className="px-5 py-3 border-t flex justify-end">
              <Button size="sm" onClick={onClose}>
                Chiudi
              </Button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
