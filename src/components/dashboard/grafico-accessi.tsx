"use client";

import { useState } from "react";

/**
 * Accessi falliti nel tempo (Riccardo, 20/10): di default le ultime 24 ore ora per ora,
 * poi i 14 giorni. Barre in rosso Domarc, account bloccati segnati sopra in giallo.
 * Approssimato: gli alert di Wazuh sono raggruppati e ogni gruppo è ripartito sul
 * periodo in cui è rimasto aperto (lib/security/kpi-dashboard.ts).
 */
interface Punto { etichetta: string; dettaglio: string; falliti: number; bloccati: number }

const numero = (n: number) => n.toLocaleString("it-IT");

export function GraficoAccessi({
  ore,
  giorni,
}: {
  ore: { ora: string; falliti: number; bloccati: number }[] | null;
  giorni: { giorno: string; falliti: number; bloccati: number }[] | null;
}) {
  const [vista, setVista] = useState<"24h" | "14g">("24h");
  if (!ore || !giorni) return <p className="text-sm text-muted-foreground py-2">Wazuh non configurato: nessun dato sugli accessi.</p>;
  const punti: Punto[] =
    vista === "24h"
      ? ore.map((o, i) => ({ etichetta: i % 3 === 2 || i === ore.length - 1 ? o.ora : "", dettaglio: `ore ${o.ora}`, falliti: o.falliti, bloccati: o.bloccati }))
      : giorni.map((g) => ({ etichetta: g.giorno.slice(8, 10), dettaglio: `${g.giorno.slice(8, 10)}/${g.giorno.slice(5, 7)}`, falliti: g.falliti, bloccati: g.bloccati }));
  const max = Math.max(1, ...punti.map((p) => p.falliti));
  const totale = punti.reduce((n, p) => n + p.falliti, 0);
  return (
    <>
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-[11px] text-muted-foreground">
          {numero(totale)} in {vista === "24h" ? "24 ore" : "14 giorni"} · massimo {numero(max)} {vista === "24h" ? "in un'ora" : "in un giorno"}
        </span>
        <div className="inline-flex rounded-md border text-[11px]" role="group" aria-label="Periodo">
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
      <div className="flex items-end gap-0.5 flex-1 min-h-[90px]">
        {punti.map((p, i) => (
          <div key={i} className="flex-1 flex flex-col items-center justify-end h-full gap-0.5"
            title={`${p.dettaglio}: ${numero(p.falliti)} accessi falliti${p.bloccati ? `, ${p.bloccati} account bloccati` : ""}`}>
            {p.bloccati > 0 && (
              <span className="text-[10px] font-bold leading-none rounded px-0.5 bg-[#FFD400] text-[#0D2537]">▲{p.bloccati}</span>
            )}
            <div
              className="w-full rounded-sm bg-[#8E1B20] dark:bg-[#E8625A]"
              style={{ height: `${Math.max(p.falliti > 0 ? 3 : 1, (p.falliti / max) * 100)}%`, opacity: p.falliti > 0 ? 1 : 0.25 }}
            />
            <span className="text-[10px] text-muted-foreground leading-none h-3">{p.etichetta}</span>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground mt-1">
        ▲ account bloccati. Approssimato: ogni gruppo d&apos;allarme è ripartito sul periodo in cui è rimasto aperto.
      </p>
    </>
  );
}
