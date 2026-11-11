import { CircleAlert, CircleCheck, TriangleAlert } from "lucide-react";
import { STILE_STATO } from "@/components/shared/stile-stato-modulo";
import type { StatoRiquadro } from "@/lib/cliente/registro";

/**
 * Tre forme diverse. Il colore è solo un rinforzo: il segno si legge anche senza tinta.
 * a posto → cerchio con spunta; attenzione → cerchio con punto; grave → triangolo.
 */
export function SegnoStato({ stato, aperti }: { stato: StatoRiquadro; aperti: number }) {
  if (stato === "a_posto") {
    return (
      <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[13px] font-semibold ${STILE_STATO.ok.classi}`}>
        <CircleCheck className="size-4 shrink-0" aria-hidden />
        a posto
      </span>
    );
  }
  if (stato === "attenzione") {
    return (
      <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[13px] font-semibold ${STILE_STATO.attenzione.classi}`}>
        <CircleAlert className="size-4 shrink-0" aria-hidden />
        {aperti}
      </span>
    );
  }
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[13px] font-semibold ${STILE_STATO.guasto.classi}`}>
      <TriangleAlert className="size-4 shrink-0" aria-hidden />
      {aperti}
    </span>
  );
}
