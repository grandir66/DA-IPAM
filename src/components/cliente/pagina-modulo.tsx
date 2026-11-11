import Link from "next/link";
import type { ReactNode } from "react";

/** Cornice delle pagine interne: si torna alla casa, poi il titolo. */
export function PaginaModulo({
  titolo,
  contesto,
  children,
}: {
  titolo: string;
  contesto?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline gap-3">
        <Link href="/cliente" className="nascosto-stampa text-sm text-cian-testo hover:underline">
          ← La tua rete
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">{titolo}</h1>
        {contesto && <p className="text-[13px] text-muted-foreground">{contesto}</p>}
      </div>
      {children}
    </div>
  );
}
