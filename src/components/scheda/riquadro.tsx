import type { ReactNode } from "react";

/**
 * Riquadro della scheda apparato: titolo (≥13 px), azione a destra, contenuto. `vuoto` = non si rende:
 * un riquadro senza dati non diventa una card di «—» (una fonte assente si dice nella riga delle fonti).
 */
export function Riquadro({ titolo, azione, children, vuoto }: { titolo: string; azione?: ReactNode; children: ReactNode; vuoto?: boolean }) {
  if (vuoto) return null;
  return (
    <section className="min-w-0 overflow-hidden rounded-xl border bg-card shadow-sm">
      <header className="flex items-center justify-between gap-2 border-b bg-muted/30 px-4 py-2">
        <h3 className="text-[13px] font-bold uppercase tracking-wider text-[#0D2537] dark:text-foreground">{titolo}</h3>
        {azione}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}
