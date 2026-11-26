/** La legenda in una riga (spec tavola §4 punto 2): un quadratino per tipo col suo nome, il segno «da verificare», i cavi. */
import { ORDINE_TIPI, NOME_TIPO, STILE_CAVO } from "./stile-tavola";
import { DefinizioniTavola, SegnoPorta } from "./porta-svg";

export function LegendaTavola() {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border bg-card px-4 py-2 text-[13px]">
      {ORDINE_TIPI.map((t) => (
        <span key={t} className="flex items-center gap-2">
          <svg width={56} height={24} aria-hidden>
            <DefinizioniTavola />
            <SegnoPorta x={2} y={3} tipo={t} dubbio={false} lato={18} />
            <line x1={26} y1={12} x2={54} y2={12} stroke={STILE_CAVO[t].stroke} strokeWidth={STILE_CAVO[t].width} strokeDasharray={STILE_CAVO[t].dash} />
          </svg>
          {NOME_TIPO[t]}
        </span>
      ))}
      <span className="flex items-center gap-2 border-l pl-4">
        <svg width={28} height={26} aria-hidden>
          <SegnoPorta x={3} y={6} tipo="attiva" dubbio lato={18} />
        </svg>
        Da verificare (non visto di recente, porte diverse o porta giù)
      </span>
    </div>
  );
}
