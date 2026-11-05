"use client";
import { parseDbDate } from "@/lib/db-date";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { InCorso } from "@/components/shared/console";
import { PastigliaStato } from "@/components/jobs/pastiglia-stato";
import { etichettaGiro } from "@/lib/scanner/giri";
import { X } from "lucide-react";
import type { ScanProgress as ScanProgressType } from "@/types";

interface ScanProgressProps {
  progress: ScanProgressType;
  onClose: () => void;
}

/**
 * Avanzamento di un giro, in un pannello in basso a destra. Non blocca la pagina e si chiude quando si
 * vuole (Riccardo, 05/11): il giro gira sul server e si ritrova da «In esecuzione» nel menu.
 */
export function ScanProgress({ progress, onClose }: ScanProgressProps) {
  const pct = progress.total > 0 ? Math.round((progress.scanned / progress.total) * 100) : 0;
  const [elapsed, setElapsed] = useState(0);
  const logEndRef = useRef<HTMLDivElement>(null);
  const isFinished = progress.status === "completed" || progress.status === "failed";

  useEffect(() => {
    if (isFinished) return;
    const start = parseDbDate(progress.started_at).getTime();
    const timer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [progress.started_at, isFinished]);

  // Auto-scroll del log
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [progress.logs?.length]);

  const formatElapsed = (s: number) => {
    const min = Math.floor(s / 60);
    const sec = s % 60;
    return min > 0 ? `${min}m ${sec}s` : `${sec}s`;
  };

  const hasLogs = progress.logs && progress.logs.length > 0;
  const dettaglio = [
    progress.total > 0 ? `${progress.scanned}/${progress.total}` : null,
    progress.found > 0 ? `${progress.found} host trovati` : null,
    elapsed > 0 ? formatElapsed(elapsed) : null,
  ].filter(Boolean).join(" · ");

  return (
    <section
      aria-label="Avanzamento della scansione"
      className="fixed bottom-3 right-3 z-30 flex max-h-[55vh] w-[min(34rem,calc(100vw-1.5rem))] flex-col rounded-xl border bg-card shadow-xl"
    >
      <header className="flex items-center justify-between gap-2 border-b px-3.5 py-2.5">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold">{etichettaGiro(progress.scan_type)}</h3>
          {progress.etichetta && (
            <p className="truncate text-[13px] text-muted-foreground">
              {progress.link ? (
                <Link href={progress.link} className="underline-offset-2 hover:underline">{progress.etichetta}</Link>
              ) : progress.etichetta}
            </p>
          )}
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8 shrink-0" aria-label="Chiudi il pannello" title="Chiudi: il giro continua">
          <X className="h-4 w-4" />
        </Button>
      </header>

      <div className="border-b p-3">
        {isFinished ? (
          <div className="flex flex-wrap items-center gap-2 text-[13px]">
            <PastigliaStato tono={progress.status === "completed" ? "ok" : "guasto"}>
              {progress.status === "completed" ? "Completata" : "Fallita"}
            </PastigliaStato>
            <span className="min-w-0 text-muted-foreground">{progress.error ?? progress.phase}</span>
          </div>
        ) : (
          <InCorso titolo={progress.phase} percentuale={pct > 0 ? pct : undefined} dettaglio={dettaglio || undefined} />
        )}
      </div>

      <div className="min-h-[96px] flex-1 overflow-y-auto px-3.5 py-2.5">
        {hasLogs ? (
          <div className="space-y-0.5 font-mono text-[13px] leading-relaxed">
            {progress.logs!.map((line, i) => (
              <div key={i} className={line.includes("✗") ? "text-destructive" : line.includes("✓") ? "text-foreground" : "text-muted-foreground"}>
                {line}
              </div>
            ))}
            <div ref={logEndRef} />
          </div>
        ) : (
          <p className="py-4 text-center text-[13px] text-muted-foreground">
            {isFinished ? "Nessun log disponibile" : "In attesa dei risultati..."}
          </p>
        )}
      </div>
    </section>
  );
}
