/** Il quadrato di una porta (spec tavola §4 punto 4): il segno del tipo, il numero corto, il bordo rosso con «!» se è dubbia. */
import type { TipoPorta } from "@/lib/topology/tavola/tipi";
import { STILE_PORTA } from "./stile-tavola";

export const LATO = 24;

export function SegnoPorta({ x, y, tipo, dubbio, numero, lato = LATO }: { x: number; y: number; tipo: TipoPorta; dubbio: boolean; numero?: string; lato?: number }) {
  const s = STILE_PORTA[tipo];
  return (
    <g>
      <rect x={x} y={y} width={lato} height={lato} rx={3} fill={s.fill} stroke={s.stroke} strokeWidth={s.strokeWidth} strokeDasharray={s.dash} />
      {s.righe && <rect x={x + 1} y={y + 1} width={lato - 2} height={lato - 2} rx={2} fill="url(#tavola-righe)" />}
      {s.doppio && <rect x={x + 3} y={y + 3} width={lato - 6} height={lato - 6} rx={2} fill="none" stroke={s.stroke} strokeWidth={1.2} />}
      {dubbio && <rect x={x - 1.5} y={y - 1.5} width={lato + 3} height={lato + 3} rx={4} fill="none" stroke="var(--destructive)" strokeWidth={2.2} />}
      {numero !== undefined && (
        <text x={x + lato / 2} y={y + lato / 2 + 4.5} textAnchor="middle" fontSize={numero.length > 2 ? 10.5 : 13} fontWeight={600}
          fontFamily="var(--font-mono)" fill={s.testo} style={{ pointerEvents: "none" }}>{numero}</text>
      )}
      {dubbio && (
        <g style={{ pointerEvents: "none" }}>
          <circle cx={x + lato} cy={y} r={6.5} fill="var(--destructive)" />
          <text x={x + lato} y={y + 4} textAnchor="middle" fontSize={11} fontWeight={700} fill="#FFFFFF">!</text>
        </g>
      )}
    </g>
  );
}

/** Le definizioni comuni dell'SVG: il tratteggio diagonale dei «più MAC». */
export function DefinizioniTavola() {
  return (
    <defs>
      <pattern id="tavola-righe" width={5} height={5} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <line x1={0} y1={0} x2={0} y2={5} stroke="var(--foreground)" strokeWidth={1.4} />
      </pattern>
    </defs>
  );
}
