import { cn } from "@/lib/utils";
import { STILE_STATO } from "@/components/shared/stile-stato-modulo";

type Tono = keyof typeof STILE_STATO;

/**
 * Pastiglia a tinta piena con segno + parola (✓ ▲ ✕ ●), come nella tavola della scansione automatica (J2-J4).
 * Lo stato si distingue per luminanza e per il segno, non solo per il colore (Riccardo è daltonico).
 */
export function PastigliaStato({ tono, children, className, title, senzaSegno }: {
  tono: Tono; children: React.ReactNode; className?: string; title?: string;
  /** Il segno lo scrive chi chiama, nel testo (riassunto misto «✓ 2/3 · ▲ 1 parziale»). */
  senzaSegno?: boolean;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex min-h-[24px] items-center gap-1 whitespace-nowrap rounded-md border-2 px-2 py-0.5 text-[13px] font-semibold leading-tight",
        STILE_STATO[tono].classi,
        className,
      )}
    >
      {senzaSegno ? children : <>{STILE_STATO[tono].segno} {children}</>}
    </span>
  );
}
