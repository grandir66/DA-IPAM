"use client";
import { parseDbDate } from "@/lib/db-date";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { TesseraNumero } from "@/components/shared/console";
import { usePuoFermare } from "@/components/shared/giri-context";
import { PastigliaStato } from "@/components/jobs/pastiglia-stato";
import { etichettaGiro } from "@/lib/scanner/giri";
import { X } from "lucide-react";
import type { ScanProgress as ScanProgressType } from "@/types";

interface ScanProgressProps {
  progress: ScanProgressType;
  onClose: () => void;
  onFerma: () => void;
}

/**
 * Avanzamento di un giro, in un pannello in basso a destra, sul modello Nety «scan in corso»
 * reinterpretato in stile Domarc (docs/STILE-UI.md). Mostra SOLO i dati che il motore espone
 * (fase, avanzamento scanned/total, host trovati, log, stop): niente contatori inventati, niente
 * pausa (il motore ha solo lo stop). Non blocca la pagina e si chiude quando si vuole (Riccardo,
 * 05/11): il giro gira sul server e si ritrova da «In esecuzione» nel menu.
 * Gli stati si distinguono per FORMA, non solo per colore (Riccardo è daltonico): ● giallo pulsante
 * «in corso», ◼ «fermata», ✓ «completata», ✕ «fallita».
 */
export function ScanProgress({ progress, onClose, onFerma }: ScanProgressProps) {
  const puoFermare = usePuoFermare();
  const pct = progress.total > 0 ? Math.round((progress.scanned / progress.total) * 100) : null;
  const [elapsed, setElapsed] = useState(0);
  const logEndRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isFinished = progress.status === "completed" || progress.status === "failed";

  useEffect(() => {
    if (isFinished) {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }
    const start = parseDbDate(progress.started_at).getTime();
    const tick = () => setElapsed(Math.floor((Date.now() - start) / 1000));
    tick();
    timerRef.current = setInterval(tick, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [progress.started_at, isFinished]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [progress.logs?.length]);

  const hasLogs = !!progress.logs && progress.logs.length > 0;
  const nLog = progress.logs?.length ?? 0;

  return (
    <section
      aria-label="Avanzamento della scansione"
      className="fixed bottom-3 right-3 z-30 flex max-h-[72vh] w-[min(40rem,calc(100vw-1.5rem))] flex-col rounded-xl border bg-card shadow-xl"
    >
      {/* Intestazione: titolo + stato (segno) + meta + azioni */}
      <header className="flex items-start justify-between gap-2 border-b px-3.5 py-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-sm font-semibold">{etichettaGiro(progress.scan_type)}</h3>
            <BadgeStato progress={progress} />
          </div>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px] text-muted-foreground">
            {progress.etichetta && (
              <span className="truncate">
                su{" "}
                {progress.link ? (
                  <Link href={progress.link} className="font-medium text-cian-testo underline-offset-2 hover:underline">
                    {progress.etichetta}
                  </Link>
                ) : (
                  <span className="font-medium text-foreground">{progress.etichetta}</span>
                )}
              </span>
            )}
            <span className="font-mono">avviato {parseDbDate(progress.started_at).toLocaleTimeString("it-IT")}</span>
            {!isFinished && <span className="font-mono">in corso da {formatElapsed(elapsed)}</span>}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {!isFinished && puoFermare && progress.fermabile && (
            <Button variant="outline" size="sm" onClick={onFerma} disabled={progress.fermando}>
              {progress.fermando ? "Arresto…" : "Ferma"}
            </Button>
          )}
          <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8" aria-label="Chiudi il pannello" title="Chiudi: il giro continua">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3.5">
        {/* Fase corrente */}
        <div className="rounded-lg border bg-muted/30 p-3">
          <p className="text-[13px] font-bold uppercase tracking-wider text-cian-testo">Fase corrente</p>
          <div className="mt-1 flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate text-sm font-semibold">
              {progress.fermando ? "Arresto in corso…" : isFinished ? statoTesto(progress) : progress.phase}
            </span>
            {pct != null && !isFinished && <span className="shrink-0 font-mono text-2xl font-bold tabular-nums">{pct}%</span>}
          </div>
          {pct != null && !isFinished && (
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-[#FFD400] transition-all"
                style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
              />
            </div>
          )}
          {isFinished && progress.error && !progress.fermato && (
            <p className="mt-1 text-[13px] text-muted-foreground">{progress.error}</p>
          )}
        </div>

        {/* Tessere: solo i dati veri */}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <TesseraNumero titolo="Host trovati" valore={progress.found} />
          {progress.total > 0 && <TesseraNumero titolo="Esaminati" valore={progress.scanned} />}
          {progress.total > 0 && <TesseraNumero titolo="Totale" valore={progress.total} />}
        </div>

        {/* Log */}
        <div className="rounded-lg border">
          <div className="border-b px-3 py-2 text-[13px] font-bold uppercase tracking-wider text-cian-testo">
            Log
            <span className="ml-2 rounded-md bg-muted px-1.5 py-0.5 font-mono text-[13px] font-normal normal-case text-muted-foreground">
              {nLog} righe
            </span>
          </div>
          <div className="max-h-56 overflow-y-auto px-3 py-2">
            {hasLogs ? (
              <div className="space-y-0.5 font-mono text-[13px] leading-relaxed">
                {progress.logs!.map((line, i) => {
                  const classe = eErrore(line)
                    ? "text-destructive font-medium"
                    : line.includes("✓")
                      ? "text-foreground"
                      : "text-muted-foreground";
                  return (
                    <div key={i} className={classe}>
                      {line}
                    </div>
                  );
                })}
                <div ref={logEndRef} />
              </div>
            ) : (
              <p className="py-4 text-center text-[13px] text-muted-foreground">
                {isFinished ? "Nessun log disponibile" : "In attesa dei risultati…"}
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

/** Stato del giro come badge: ogni stato ha una FORMA diversa, non solo un colore (daltonico). */
function BadgeStato({ progress }: { progress: ScanProgressType }) {
  if (progress.status === "completed") return <PastigliaStato tono="ok">Completata</PastigliaStato>;
  if (progress.status === "failed") {
    // Lo stop dell'utente arriva come «failed» + fermato: è una fermata, non un guasto.
    return progress.fermato ? (
      <PastigliaStato tono="da_verificare" senzaSegno>
        <span aria-hidden>◼</span> Fermata
      </PastigliaStato>
    ) : (
      <PastigliaStato tono="guasto">Fallita</PastigliaStato>
    );
  }
  // In corso: pallino giallo pulsante — forma (animata) distinta dal ◼ della «fermata».
  return (
    <span className="inline-flex min-h-[24px] items-center gap-1.5 rounded-md border-2 border-[#C9A800] bg-[#FFD400]/15 px-2 py-0.5 text-[13px] font-semibold leading-tight text-[#0D2537] dark:text-[#FFD400]">
      <span aria-hidden className="inline-block h-2 w-2 animate-pulse rounded-full bg-[#FFD400] ring-1 ring-[#C9A800]" />
      In corso
    </span>
  );
}

function statoTesto(p: ScanProgressType): string {
  if (p.status === "completed") return p.phase || "Completata";
  if (p.fermato) return "Fermata dall'utente";
  return p.error || p.phase || "Fallita";
}

function formatElapsed(s: number): string {
  const min = Math.floor(s / 60);
  const sec = s % 60;
  return min > 0 ? `${min}m ${sec}s` : `${sec}s`;
}

/** Riga di errore: solo dai marcatori che il motore mette davvero, niente euristiche larghe. */
function eErrore(line: string): boolean {
  return line.includes("✗") || line.includes("[ERRORE]") || line.includes("[STOP]");
}
