import { Check, CircleDot, Lock, Minus, ShieldAlert, X } from "lucide-react";
import type { ReactNode } from "react";
import type { FormaSegno, SegnoStato } from "@/lib/credentials/motivi-accesso";
import { cn } from "@/lib/utils";

/**
 * Lo stato di un diritto o di un accesso: Sì, In parte, No, Non provato (piano accesso Windows, Task 8-9).
 *
 * Doppio segnale, fondo E icona, distinguibili per luminanza e per forma (Riccardo è daltonico, mai la sola tinta):
 *  - Sì: fondo chiaro con bordo verde e spunta;
 *  - Attenzione (In parte, Firewall): fondo ambra di luminanza media, a metà fra il chiaro del Sì e il pieno del No;
 *  - No: fondo pieno scuro con croce, o col lucchetto per i diritti negati;
 *  - Non provato: solo bordo tratteggiato, fondo vuoto, trattino.
 * Verde e rosso da soli non bastano a distinguerli: il chiaro contro il pieno fa 13:1, e le icone hanno forme diverse.
 */
const CLASSI: Record<SegnoStato, string> = {
  si: "border-[#1F7A4D] bg-[#D6EBDF] text-[#0D2537] dark:bg-[#1F7A4D]/35 dark:text-foreground",
  attenzione: "border-[#8A5A00] bg-[#F5B83D] text-[#0D2537] dark:border-[#F5B83D] dark:text-[#0D2537]",
  no: "border-[#8E1B20] bg-[#8E1B20] text-white dark:border-[#E8625A] dark:bg-[#E8625A] dark:text-[#0D2537]",
  non_provato: "border-dashed border-muted-foreground/70 bg-transparent text-muted-foreground",
};

const ICONE: Record<FormaSegno, typeof Check> = { spunta: Check, meta: CircleDot, scudo: ShieldAlert, lucchetto: Lock, croce: X, trattino: Minus };

const FORMA_DI_SERIE: Record<SegnoStato, FormaSegno> = { si: "spunta", attenzione: "meta", no: "croce", non_provato: "trattino" };

export function Segno({ segno, forma, children, title }: { segno: SegnoStato; forma?: FormaSegno; children: ReactNode; title?: string }) {
  const Icona = ICONE[forma ?? FORMA_DI_SERIE[segno]];
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

const VOCI_LEGENDA: ReadonlyArray<{ segno: SegnoStato; forma?: FormaSegno; parola: string; testo: string }> = [
  { segno: "si", parola: "Sì", testo: "provato e funziona" },
  { segno: "attenzione", parola: "In parte", testo: "entra su alcuni host, su altri mancano i diritti" },
  { segno: "attenzione", forma: "scudo", parola: "Firewall", testo: "nessuna risposta: la rete, non la voce" },
  { segno: "no", parola: "No", testo: "provato e non funziona" },
  { segno: "no", forma: "lucchetto", parola: "Negato", testo: "password giusta, mancano i diritti" },
  { segno: "non_provato", parola: "Non provato", testo: "nessun esito" },
];

/** Legenda dei segni: gli stessi segni delle celle, con la loro forma, non un quadratino di colore. */
export function LegendaSegni() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px] text-muted-foreground">
      {VOCI_LEGENDA.map((v) => (
        <span key={v.parola} className="flex items-center gap-1.5">
          <Segno segno={v.segno} forma={v.forma}>{v.parola}</Segno>
          {v.testo}
        </span>
      ))}
    </div>
  );
}
