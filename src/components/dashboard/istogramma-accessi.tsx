"use client";

import { useState } from "react";

/**
 * Accessi falliti nel tempo (Riccardo, 20/10): istogramma snello con la media tratteggiata
 * e il picco scritto sopra la sua barra. Una serie sola: navy, niente legenda (il titolo la
 * nomina). Di norma i conteggi sono quelli veri dell'indexer; se l'indexer non risponde è la
 * stima dei gruppi d'allarme ripartiti sulla durata, e lo si dice accanto al totale.
 */
const numero = (n: number) => Math.round(n).toLocaleString("it-IT");

export function IstogrammaAccessi({ ore, giorni, fonte, motivo }: {
  ore: { ora: string; falliti: number }[] | null;
  giorni: { giorno: string; falliti: number }[] | null;
  fonte: "indexer" | "stima";
  /** Perché si usa la stima (indexer non configurato o non raggiungibile). */
  motivo?: string;
}) {
  const [vista, setVista] = useState<"24h" | "14g">("24h");
  if (!ore || !giorni) return <p className="text-[13px] text-muted-foreground py-2">Wazuh non configurato: nessun dato sugli accessi.</p>;
  const punti =
    vista === "24h"
      ? ore.map((o, i) => ({ etichetta: i % 3 === 2 || i === ore.length - 1 ? o.ora : "", dettaglio: `ore ${o.ora}`, n: o.falliti }))
      : giorni.map((g, i) => ({ etichetta: i % 2 === 1 ? g.giorno.slice(8, 10) : "", dettaglio: `${g.giorno.slice(8, 10)}/${g.giorno.slice(5, 7)}`, n: g.falliti }));
  const max = Math.max(1, ...punti.map((p) => p.n));
  const totale = punti.reduce((s, p) => s + p.n, 0);
  const media = totale / punti.length;
  const iPicco = punti.reduce((best, p, i) => (p.n > punti[best].n ? i : best), 0);
  const unita = vista === "24h" ? "all'ora" : "al giorno";
  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-[13px] text-muted-foreground">
          {numero(totale)} in {vista === "24h" ? "24 ore" : "14 giorni"}
          {fonte === "stima" && (
            <span className="ml-1 rounded border border-dashed px-1" title={`${motivo ? `${motivo[0].toUpperCase()}${motivo.slice(1)}: ` : ""}ogni gruppo d'allarme è ripartito sul periodo in cui è rimasto aperto, i picchi non si vedono.`}>stima</span>
          )}
        </span>
        <div className="inline-flex rounded-md border text-[13px]" role="group" aria-label="Periodo">
          {(["24h", "14g"] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={vista === v}
              onClick={() => setVista(v)}
              className={`px-2 py-0.5 ${vista === v ? "bg-[#0D2537] text-white dark:bg-[#A9BECC] dark:text-[#0D2537]" : "text-muted-foreground hover:text-foreground"}`}
            >
              {v === "24h" ? "24 ore" : "14 giorni"}
            </button>
          ))}
        </div>
      </div>
      {/* Area del grafico: barre, media e picco sulla stessa scala; 20 px in alto per il picco. */}
      <div className="relative flex-1 min-h-[80px] mt-5 border-b border-[#D0D8DC] dark:border-[#4A6070]">
        <div className="absolute inset-0 flex items-end gap-[2px]">
          {punti.map((p, i) => {
            const h = p.n > 0 ? Math.max(2, (p.n / max) * 100) : 0;
            return (
              <div key={i} className="relative flex-1 flex justify-center h-full items-end" title={`${p.dettaglio}: ${numero(p.n)} accessi falliti`}>
                <div className="w-full max-w-[14px] rounded-t-[2px] bg-[#0D2537] dark:bg-[#A9BECC]" style={{ height: `${h}%` }} />
                {i === iPicco && p.n > 0 && (
                  <span className="absolute text-[13px] font-bold leading-none whitespace-nowrap" style={{ bottom: `calc(${h}% + 3px)` }}>
                    {numero(p.n)}
                  </span>
                )}
              </div>
            );
          })}
        </div>
        <div
          className="absolute left-0 right-0 border-t border-dashed border-[#4A6070] dark:border-[#A9BECC] pointer-events-none"
          style={{ bottom: `${(media / max) * 100}%` }}
        >
          <span className="absolute left-0 bottom-0.5 text-[13px] leading-none bg-card/90 px-1 text-muted-foreground">media {numero(media)} {unita}</span>
        </div>
      </div>
      <div className="flex gap-[2px]" aria-hidden>
        {punti.map((p, i) => (
          <span key={i} className="flex-1 text-center text-[13px] text-muted-foreground leading-none pt-0.5 h-4 overflow-visible whitespace-nowrap">{p.etichetta}</span>
        ))}
      </div>
    </div>
  );
}
