"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { LoadError } from "@/components/shared/load-error";
import { Pannello } from "@/components/shared/console";
import { fetchJson } from "@/lib/fetch-json";
import { formattaByte, scalaColonne } from "@/lib/traffico/frasi";
import type { AndamentoTraffico } from "@/lib/traffico/insieme";

const oraLocale = (utc: string): Date => new Date(`${utc.replace(" ", "T")}Z`);
const hhmm = (d: Date): string => d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
/** Il verso l'esterno si distingue per luminanza e per il tratteggio, non per la tinta. */
const TRATTEGGIO = "repeating-linear-gradient(135deg, #0D2537 0 2px, #EDEDED 2px 6px)";
/** Quanto è alta la cima della scala, in px: sopra resta il posto per il valore delle colonne tagliate. */
const ALTEZZA = 160;

/** Una colonna. Fuori scala arriva in cima, con un'interruzione e il valore vero scritto sopra. */
function Colonna({ byte, cima, esterno }: { byte: number; cima: number; esterno?: boolean }) {
  if (byte <= 0) return <div className="flex-1" />;
  const tagliata = byte > cima;
  return (
    <div
      className={esterno ? "relative min-w-0 flex-1 rounded-t-[2px] border border-b-0 border-[#0D2537]" : "relative min-w-0 flex-1 rounded-t-[2px] bg-[#0D2537] dark:bg-[#00A7E7]"}
      style={{ height: tagliata ? ALTEZZA : Math.max(3, (byte / cima) * ALTEZZA), ...(esterno ? { backgroundImage: TRATTEGGIO } : {}) }}
    >
      {tagliata && (
        <>
          <span aria-hidden className="absolute -inset-x-0.5 top-6 h-[5px] -skew-y-[14deg] bg-card" />
          <span className="absolute bottom-full left-1/2 z-10 mb-1 -translate-x-1/2 rounded bg-[#FFD400] px-1.5 font-mono text-[13px] font-semibold whitespace-nowrap text-[#0D2537]">{formattaByte(byte)}</span>
        </>
      )}
    </div>
  );
}

/** Il volume delle ultime 24 ore, due colonne per ora (interno ed esterno): tutta la rete, la rete scelta o un host. */
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
  const piena = punti.find((p) => p.byte === massimo);
  const { cima, tagliate } = scalaColonne(punti.flatMap((p) => [p.byte - p.byte_esterno, p.byte_esterno]));
  const fuori = punti.filter((p) => p.byte - p.byte_esterno > cima || p.byte_esterno > cima).length;
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
            <span>Ora più piena <strong className="font-mono">{formattaByte(massimo)}</strong>{piena ? ` alle ${hhmm(oraLocale(piena.ora))}` : ""}</span>
            <span className="ml-auto flex items-center gap-1.5"><span aria-hidden className="inline-block size-3.5 rounded-sm bg-[#0D2537] dark:bg-[#00A7E7]" />Fra host interni</span>
            <span className="flex items-center gap-1.5"><span aria-hidden className="inline-block size-3.5 rounded-sm border border-[#0D2537]" style={{ backgroundImage: TRATTEGGIO }} />Da o verso fuori</span>
          </div>
          <div className="flex gap-2">
            <div className="relative w-16 shrink-0 text-right font-mono text-[13px] text-muted-foreground" aria-hidden>
              {[1, 0.5, 0].map((q) => <span key={q} className="absolute right-0 translate-y-1/2 whitespace-nowrap" style={{ bottom: q * ALTEZZA }}>{q === 0 ? "0" : formattaByte(cima * q)}</span>)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="relative flex items-end gap-1 border-b" style={{ height: ALTEZZA + (tagliate ? 28 : 8) }} role="img" aria-label={`Volume per ora nelle ultime 24 ore, ${formattaByte(totale)} in tutto`}>
                {[1, 0.5].map((q) => <span key={q} aria-hidden className="absolute inset-x-0 border-t border-border/60" style={{ bottom: q * ALTEZZA }} />)}
                {punti.map((p) => {
                  const interno = p.byte - p.byte_esterno;
                  return (
                    <div
                      key={p.ora}
                      className="relative flex h-full min-w-0 flex-1 items-end gap-px"
                      title={`${hhmm(oraLocale(p.ora))}: ${formattaByte(interno)} fra host interni, ${formattaByte(p.byte_esterno)} da o verso fuori · ${p.pacchetti.toLocaleString("it-IT")} pacchetti · ${p.flussi.toLocaleString("it-IT")} connessioni`}
                    >
                      <Colonna byte={interno} cima={cima} />
                      <Colonna byte={p.byte_esterno} cima={cima} esterno />
                    </div>
                  );
                })}
              </div>
              <div className="mt-1 flex gap-1 font-mono text-[13px] text-muted-foreground" aria-hidden>
                {punti.map((p, i) => <span key={p.ora} className="min-w-0 flex-1 text-center">{i % 3 === 2 ? hhmm(oraLocale(p.ora)).slice(0, 2) : ""}</span>)}
              </div>
            </div>
          </div>
          {tagliate && <p className="mt-1.5 text-[13px] text-muted-foreground">{fuori === 1 ? "1 ora fuori scala" : `${fuori} ore fuori scala`}: la colonna tagliata porta scritto il suo valore.</p>}
        </div>
      )}
    </Pannello>
  );
}
