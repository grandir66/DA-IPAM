"use client";

/**
 * Badge degli esiti della finestra «Rendi apparato» (tappa 3, 21/10): segno e parola sempre,
 * mai solo il colore (Riccardo è daltonico). Colori dai token degli stati (`STILE_STATO`).
 */
import { Loader2 } from "lucide-react";
import { STILE_STATO, type ToniStato } from "@/components/shared/stile-stato-modulo";
import { cn } from "@/lib/utils";
import { dataBreve, quandoBreve } from "@/lib/devices/rendi-apparato";

export type StatoEsito = "non_provata" | "in_corso" | "riuscita" | "rifiutata" | "fermata" | "esclusa";

export interface EsitoCredenziale {
  stato: StatoEsito;
  /** ISO UTC (o data del database) dell'ultimo tentativo. */
  quando?: string | null;
  /** Motivo del rifiuto, per il suggerimento al passaggio del mouse. */
  dettaglio?: string | null;
  /** Nome della credenziale, per «✕ «nome» esclusa». */
  nome?: string | null;
  /** Tentativi veri fatti (per «Fermata: 3 tentativi»). */
  tentativi?: number;
}

const TONO: Record<StatoEsito, ToniStato> = {
  riuscita: "ok",
  rifiutata: "guasto",
  esclusa: "guasto",
  fermata: "attenzione",
  non_provata: "da_verificare",
  in_corso: "grigio",
};

export function testoEsito(e: EsitoCredenziale): string {
  switch (e.stato) {
    case "riuscita": {
      const q = quandoBreve(e.quando);
      return q ? `✓ Riuscita · ${q}` : "✓ Riuscita";
    }
    case "rifiutata": {
      const q = quandoBreve(e.quando);
      return q ? `✕ Rifiutata · ${q}` : "✕ Rifiutata";
    }
    case "esclusa": {
      const d = dataBreve(e.quando);
      return `✕ ${e.nome ? `«${e.nome}» ` : ""}esclusa: rifiutata${d ? ` il ${d}` : ""}`;
    }
    case "fermata":
      return e.tentativi ? `▲ Fermata: ${e.tentativi} tentativi` : "▲ Fermata (tetto di 3)";
    case "in_corso":
      return "In corso…";
    default:
      return "● Non provata";
  }
}

export function BadgeEsito({ esito, className }: { esito: EsitoCredenziale; className?: string }) {
  return (
    <span
      title={esito.dettaglio ?? undefined}
      className={cn(
        "inline-flex min-h-[26px] items-center gap-1.5 rounded-md border-2 px-2.5 py-0.5 text-[13px] font-semibold leading-tight",
        STILE_STATO[TONO[esito.stato]].classi,
        className,
      )}
    >
      {esito.stato === "in_corso" && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
      {testoEsito(esito)}
    </span>
  );
}

/** Avviso semplice (porta fuori standard, senza credenziale provata): ▲ su giallo. */
export function BadgeAvviso({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex min-h-[26px] items-center gap-1.5 rounded-md border-2 px-2.5 py-0.5 text-[13px] font-semibold leading-tight",
        STILE_STATO.attenzione.classi,
        className,
      )}
    >
      ▲ {children}
    </span>
  );
}

export function BadgeNeutro({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex min-h-[26px] items-center gap-1.5 rounded-md border-2 px-2.5 py-0.5 text-[13px] font-semibold leading-tight",
        STILE_STATO.da_verificare.classi,
        className,
      )}
    >
      ● {children}
    </span>
  );
}
