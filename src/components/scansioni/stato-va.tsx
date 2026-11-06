import { cn } from "@/lib/utils";
import type { TonoStato } from "@/lib/vuln/proposta/testi-esito";

/** Stato con segno e fondo pieno, mai la sola tinta. */
export function Stato({ tono, children }: { tono: TonoStato; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-[13px] font-semibold",
        tono === "ok" && "border-foreground bg-card text-foreground",
        tono === "in_corso" && "border-[#0D2537] bg-[#0D2537] text-white",
        tono === "avviso" && "border-[#0D2537] bg-[#FFD400] text-[#0D2537]",
        tono === "spento" && "border-muted-foreground bg-muted text-foreground",
        tono === "errore" && "border-[#8E1B20] bg-[#8E1B20] text-white",
      )}
    >
      {children}
    </span>
  );
}
