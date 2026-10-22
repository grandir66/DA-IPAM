import Link from "next/link";
import { STILE_STATO, type ToniStato } from "@/components/shared/stile-stato-modulo";

/**
 * Card di Sicurezza della dashboard (Riccardo, 20/10): bianca, striscia a sinistra a tinta
 * piena del token e simbolo accanto al titolo. Niente fondi pastello: rosa e verde tenue
 * hanno la stessa luminanza e Riccardo è daltonico. Una fonte non configurata è grigia
 * col bordo tratteggiato, non «zero». Al passaggio del mouse cambia il fondo, non il bordo:
 * `hover:border-…` copriva il colore della striscia (revisione del 20/10).
 */
const STRISCIA: Record<ToniStato, string> = {
  ok: "border-l-[#1F7A4D] dark:border-l-[#5ED3A0]",
  attenzione: "border-l-[#FFD400]",
  guasto: "border-l-[#8E1B20] dark:border-l-[#E8625A]",
  da_verificare: "border-l-[#5B6B77] dark:border-l-[#A9BECC]",
  grigio: "border-l-slate-400 border-dashed",
};

/** Il simbolo prende il colore del token; il giallo su bianco non si legge e passa al navy. */
const SEGNO: Record<ToniStato, string> = {
  ok: "text-[#1F7A4D] dark:text-[#5ED3A0]",
  attenzione: "text-[#0D2537] dark:text-[#FFD400]",
  guasto: "text-[#8E1B20] dark:text-[#E8625A]",
  da_verificare: "text-[#5B6B77] dark:text-[#A9BECC]",
  grigio: "text-muted-foreground",
};

export function CardSicurezza({ tono, titolo, valore, nota, href, title }: {
  tono: ToniStato;
  titolo: string;
  valore: string;
  nota?: string;
  href: string;
  title?: string;
}) {
  const grigio = tono === "grigio";
  return (
    <Link
      href={href}
      title={title}
      className={`flex flex-col justify-center min-w-0 rounded-md border border-l-[6px] bg-card px-3 py-1.5 hover:bg-muted/40 transition-colors ${STRISCIA[tono]}`}
    >
      <span className="flex items-center gap-1.5 text-[13px] leading-tight text-muted-foreground truncate">
        <span aria-hidden className={`font-bold ${SEGNO[tono]}`}>{STILE_STATO[tono].segno}</span>
        <span className="truncate">{titolo}</span>
      </span>
      <span className={`truncate leading-tight ${grigio ? "text-[13px] text-muted-foreground" : "text-xl font-bold"}`}>{valore}</span>
      {nota && <span className="text-[13px] leading-tight text-muted-foreground truncate">{nota}</span>}
    </Link>
  );
}
