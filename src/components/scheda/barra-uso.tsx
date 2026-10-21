import { cn } from "@/lib/utils";

/**
 * Barra di utilizzo (CPU, RAM, spazio). Da `soglia` in su (85 di default) il riempimento diventa rosso scuro
 * e il testo porta ▲: lo stato si legge dalla luminanza e dal segno, non solo dal colore.
 */
export function BarraUso({ percento, etichetta, soglia = 85 }: { percento: number; etichetta?: string; soglia?: number }) {
  const p = Math.max(0, Math.min(100, Number.isFinite(percento) ? percento : 0));
  const alta = p >= soglia;
  return (
    <div className="flex min-w-0 items-center gap-2">
      <div
        role="progressbar"
        aria-valuenow={Math.round(p)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={etichetta}
        className="h-2.5 min-w-12 flex-1 overflow-hidden rounded-full bg-[#D0D8DC] dark:bg-[#33485A]"
      >
        <div className={cn("h-full rounded-full", alta ? "bg-[#8E1B20] dark:bg-[#E8625A]" : "bg-[#0D2537] dark:bg-[#E6EEF4]")} style={{ width: `${p}%` }} />
      </div>
      <span className={cn("shrink-0 text-[13px] tabular-nums", alta && "font-semibold text-[#8E1B20] dark:text-[#E8625A]")}>
        {alta && "▲ "}
        {etichetta ?? `${Math.round(p)}%`}
      </span>
    </div>
  );
}
