"use client";

import { cn } from "@/lib/utils";
import type { TabId } from "@/lib/scheda/tipo-scheda";

/** Una misura della striscia. `attenzione`: fondo, bordo e ▲ cambiano insieme (si vede anche senza distinguere i colori). `tab`: il clic porta lì. */
export type Casella = { etichetta: string; valore: string; sotto?: string; attenzione?: boolean; tab?: TabId };

/**
 * Striscia dei numeri in cima alla Panoramica: al massimo sei caselle, quelle senza dato non si passano.
 * Senza caselle non rende niente.
 */
export function StrisciaNumeri({ caselle, onApriTab }: { caselle: Casella[]; onApriTab: (t: TabId) => void }) {
  const visibili = caselle.slice(0, 6);
  if (visibili.length === 0) return null;
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      {visibili.map((c) => {
        const corpo = (
          <>
            <span className="block text-[13px] font-semibold text-muted-foreground">{c.etichetta}</span>
            <span className="mt-0.5 block text-2xl font-semibold leading-tight text-[#0D2537] dark:text-foreground">
              {c.attenzione && <span aria-hidden>▲ </span>}
              {c.valore}
            </span>
            {c.sotto && <span className="mt-0.5 block text-[13px] text-muted-foreground">{c.sotto}</span>}
          </>
        );
        const classi = cn(
          "min-w-0 rounded-xl border-2 px-4 py-3 text-left",
          c.attenzione ? "border-[#C9A800] bg-[#FFF4B8] dark:bg-[#4A3F00]" : "border-border bg-card",
        );
        return c.tab ? (
          <button key={c.etichetta} type="button" onClick={() => onApriTab(c.tab as TabId)} className={cn(classi, "transition-colors hover:bg-muted/50")}>
            {corpo}
          </button>
        ) : (
          <div key={c.etichetta} className={classi}>{corpo}</div>
        );
      })}
    </div>
  );
}
