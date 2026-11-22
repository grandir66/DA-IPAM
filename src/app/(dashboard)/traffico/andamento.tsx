"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { LoadError } from "@/components/shared/load-error";
import { Pannello } from "@/components/shared/console";
import { fetchJson } from "@/lib/fetch-json";
import { formattaByte } from "@/lib/traffico/frasi";
import type { AndamentoTraffico } from "@/lib/traffico/insieme";

const oraLocale = (utc: string): Date => new Date(`${utc.replace(" ", "T")}Z`);
const hhmm = (d: Date): string => d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
/** Il verso l'esterno si distingue per luminanza e per il tratteggio, non per la tinta. */
const TRATTEGGIO = "repeating-linear-gradient(135deg, #0D2537 0 2px, #EDEDED 2px 6px)";

/** Il volume delle ultime 24 ore, una barra per ora: tutta la rete, la rete scelta o un host. */
export function Andamento({ rete, host, descrizione, onTogliHost }: { rete: string | null; host: string | null; descrizione: string; onTogliHost: () => void }) {
  const [dati, setDati] = useState<AndamentoTraffico | null>(null);
  const [errore, setErrore] = useState<string | null>(null);

  const carica = useCallback(async () => {
    const q = new URLSearchParams();
    if (host) q.set("host", host);
    else if (rete) q.set("rete", rete);
    const r = await fetchJson<AndamentoTraffico>(`/api/traffico/andamento?${q.toString()}`, { cache: "no-store" });
    if (r.ok) {
      setDati(r.data);
      setErrore(null);
    } else setErrore(r.message);
  }, [rete, host]);

  useEffect(() => { void carica(); }, [carica]);

  const punti = dati?.punti ?? [];
  const massimo = Math.max(0, ...punti.map((p) => p.byte));
  const totale = punti.reduce((s, p) => s + p.byte, 0);
  const giovane = dati?.prima_ora && punti.length > 0 && dati.prima_ora > punti[0].ora ? hhmm(oraLocale(dati.prima_ora)) : null;

  return (
    <Pannello
      titolo="Andamento, ultime 24 ore"
      sottotitolo={`${descrizione}: volume per ora${giovane ? `. Dati dalle ${giovane}` : ""}.`}
      azioni={host ? <Button size="sm" variant="outline" onClick={onTogliHost}>Torna a tutta la rete</Button> : undefined}
    >
      {errore !== null ? (
        <LoadError what="l'andamento" message={errore} onRetry={() => void carica()} />
      ) : dati === null ? (
        <p className="text-sm text-muted-foreground" role="status">Carico l&apos;andamento…</p>
      ) : massimo === 0 ? (
        <p className="text-sm text-muted-foreground">Nessun traffico contato nelle ultime 24 ore{giovane ? `: il conto per ora è partito alle ${giovane}` : ""}.</p>
      ) : (
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-[13px]">
            <span>In 24 ore <strong className="font-mono">{formattaByte(totale)}</strong></span>
            <span>Ora più piena <strong className="font-mono">{formattaByte(massimo)}</strong></span>
            <span className="ml-auto flex items-center gap-1.5"><span aria-hidden className="inline-block size-3.5 rounded-sm bg-[#0D2537] dark:bg-[#00A7E7]" />Fra host interni</span>
            <span className="flex items-center gap-1.5"><span aria-hidden className="inline-block size-3.5 rounded-sm border border-[#0D2537]" style={{ backgroundImage: TRATTEGGIO }} />Da o verso fuori</span>
          </div>
          <div className="flex h-32 items-end gap-1 border-b" role="img" aria-label={`Volume per ora nelle ultime 24 ore, ${formattaByte(totale)} in tutto`}>
            {punti.map((p) => {
              const inizio = oraLocale(p.ora);
              const interno = p.byte - p.byte_esterno;
              return (
                <div
                  key={p.ora}
                  className="flex h-full min-w-0 flex-1 flex-col justify-end"
                  title={`${hhmm(inizio)}: ${formattaByte(p.byte)}, di cui ${formattaByte(p.byte_esterno)} da o verso fuori · ${p.pacchetti.toLocaleString("it-IT")} pacchetti · ${p.flussi.toLocaleString("it-IT")} connessioni`}
                >
                  {p.byte_esterno > 0 && <div className="border border-b-0 border-[#0D2537]" style={{ height: `${(p.byte_esterno / massimo) * 100}%`, minHeight: 3, backgroundImage: TRATTEGGIO }} />}
                  {interno > 0 && <div className="bg-[#0D2537] dark:bg-[#00A7E7]" style={{ height: `${(interno / massimo) * 100}%`, minHeight: 2 }} />}
                </div>
              );
            })}
          </div>
          <div className="mt-1 flex gap-1 font-mono text-[13px] text-muted-foreground" aria-hidden>
            {punti.map((p, i) => <span key={p.ora} className="min-w-0 flex-1 text-center">{i % 3 === 2 ? hhmm(oraLocale(p.ora)).slice(0, 2) : ""}</span>)}
          </div>
        </div>
      )}
    </Pannello>
  );
}
