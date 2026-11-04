import { Check, Minus, X } from "lucide-react";
import type { ReactNode } from "react";
import type { VoceLegenda } from "@/components/shared/console";
import type { SegnoStato } from "@/lib/credentials/motivi-accesso";
import { cn } from "@/lib/utils";

/**
 * Lo stato di un diritto o di un accesso: Sì, No, Non provato (piano accesso Windows, Task 8-9).
 *
 * Doppio segnale, fondo E icona, distinguibili per luminanza e per forma (Riccardo è daltonico, mai la sola tinta):
 *  - Sì: fondo chiaro con bordo verde e spunta;
 *  - No: fondo pieno scuro con croce;
 *  - Non provato: solo bordo tratteggiato, fondo vuoto, trattino.
 * Verde e rosso da soli non bastano a distinguerli: il chiaro contro il pieno fa 13:1, e le icone hanno forme diverse.
 */
const CLASSI: Record<SegnoStato, string> = {
  si: "border-[#1F7A4D] bg-[#D6EBDF] text-[#0D2537] dark:bg-[#1F7A4D]/35 dark:text-foreground",
  no: "border-[#8E1B20] bg-[#8E1B20] text-white dark:border-[#E8625A] dark:bg-[#E8625A] dark:text-[#0D2537]",
  non_provato: "border-dashed border-muted-foreground/70 bg-transparent text-muted-foreground",
};

const ICONE: Record<SegnoStato, typeof Check> = { si: Check, no: X, non_provato: Minus };

export function Segno({ segno, children, title }: { segno: SegnoStato; children: ReactNode; title?: string }) {
  const Icona = ICONE[segno];
  return (
    <span
      title={title}
      className={cn("inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[13px] font-semibold whitespace-nowrap", CLASSI[segno])}
    >
      <Icona aria-hidden className="size-3.5 shrink-0" strokeWidth={3} />
      {children}
    </span>
  );
}

/** Legenda dei tre segni: le stesse classi delle celle. */
export const VOCI_LEGENDA_SEGNI: VoceLegenda[] = [
  { classe: CLASSI.si, testo: "Sì: provato e funziona" },
  { classe: CLASSI.no, testo: "No: provato e non funziona" },
  { classe: CLASSI.non_provato, testo: "Non provato: nessun esito" },
];
