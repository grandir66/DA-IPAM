"use client";

/**
 * Copia-valore accanto a un identificativo (IP, MAC, impronta): un'icona che copia il testo
 * negli appunti e mostra la spunta per un attimo. Dall'idea di Nety — in uno strumento di rete
 * un IP si copia spesso per incollarlo altrove. `valore` è ciò che si copia; i figli (se ci
 * sono) sono ciò che si mostra, altrimenti si mostra il valore stesso.
 */
import { useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

export function BottoneCopia({ valore, titolo, children, className }: { valore: string; titolo?: string; children?: ReactNode; className?: string }) {
  const [copiato, setCopiato] = useState(false);
  async function copia() {
    try {
      await navigator.clipboard.writeText(valore);
      setCopiato(true);
      setTimeout(() => setCopiato(false), 1200);
    } catch {
      // Appunti non disponibili (contesto non sicuro): si ignora, niente spunta.
    }
  }
  return (
    <span className={cn("group inline-flex items-center gap-1", className)}>
      {children ?? <span className="font-mono">{valore}</span>}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          void copia();
        }}
        title={copiato ? "Copiato" : titolo ?? `Copia ${valore}`}
        aria-label={titolo ?? `Copia ${valore}`}
        className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 group-hover:opacity-100"
      >
        {copiato ? <Check className="size-3.5 text-[#1F7A4D]" /> : <Copy className="size-3.5" />}
      </button>
    </span>
  );
}
