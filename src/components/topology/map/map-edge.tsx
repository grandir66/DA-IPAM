"use client";

/**
 * La linea della mappa (spec §11.4): un tracciato ad angolo retto
 * (getSmoothStepPath, raggio 0) con lo stile che dice edgeLook: spessore dalla
 * velocità, ondulata per il wireless, doppia per la ridondanza, grigia
 * tratteggiata se non vista, puntinata se a mano e non confermata, e le parole
 * («1G · ⚡ 7 W · ✎ ✓ · ★») in un'etichetta a 13 px. L'etichetta di una linea
 * dell'albero sta sopra il tratto orizzontale, accanto alla verticale del
 * figlio, dalla parte opposta alle porte scritte sopra il riquadro: così non
 * copre né i riquadri né le altre scritte. Quella di una ridondanza sta a metà.
 *
 * In verticale (spec §12.2) la linea esce da destra ed entra da sinistra; il
 * tronco dei figli corre a LR_TRUNK px dal genitore, così il tratto che entra
 * nel figlio è lungo e porta l'etichetta, sopra il tratto e accanto al figlio,
 * larga al massimo lo spazio fra tronco e figlio (oltre va a capo fra una parola
 * e l'altra): non copre né il tronco né i riquadri. `AttEdge` è il tratto dal
 * fondo del riquadro verso gli attaccati elencati sotto.
 * Sul lato più vicino (`data.lati`, spec §13.10.1: ridondanze e figli spostati a
 * mano dall'altra parte) il tracciato è quello di `percorsoDaPunti`, lo stesso
 * della stampa, e la parola sta vicino alla metà del percorso vero.
 */
import { Fragment } from "react";
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type Edge, type EdgeProps } from "@xyflow/react";
import { edgeLook, pathPoints, pezzoNelloSpazio, wavyPath, type Pt as Punto } from "@/lib/topology/edge-look";
import { LR_TRUNK, lrLabelMaxWidth, percorsoDaPunti, redundantLabelAt, type Lato, type Pt, type Rect } from "@/lib/topology/map-screen";
import { pointsPath } from "@/lib/topology/print-draw";
import { CHAR_W } from "@/lib/topology/tree-layout-consts";
import type { MapLink, MapOrientation } from "@/lib/topology/model-types";

/** Il tratto dell'albero senza un collegamento proprio (verso il gruppo degli AP). */
export const TREE_EDGE = { stroke: "var(--foreground)", strokeWidth: 1.8 };

export type MapEdgeData = {
  /** null: linea dell'albero verso il gruppo degli AP (nessuna parola). */
  link: MapLink | null;
  /** La linea con cui il riquadro di arrivo è appeso al genitore. */
  inTree: boolean;
  /** Da che parte della verticale va l'etichetta (le porte del riquadro stanno dall'altra). */
  labelSide: "left" | "right";
  orientation: MapOrientation;
  /** Ridondanza: i riquadri su cui la sua parola non deve finire (Task 5). */
  avoid?: readonly Rect[] | null;
  /** Il lato più vicino (spec §13.10.1): la linea esce dal lato `da` ed entra da `a`. Assente: le linee di oggi. */
  lati?: { da: Lato; a: Lato };
  /** Il nome di un oggetto, per le parole che lo nominano («la porta p di A è giù», «oltre ‹radio›»): T3, spec §13.10.3. */
  nomeDi?: (id: string) => string;
  /**
   * Il nodo scelto evidenzia i suoi collegamenti (T3, §13.10.3, Riccardo 16/10): «su» = ha il nodo scelto a un capo, colore del
   * marchio a piena intensità; «giu» = tutti gli altri, opacità 0,25 con le loro parole. Tratteggio e spessore non cambiano.
   * Assente = nessuna selezione, o mappa di prima: la linea è quella di sempre.
   */
  evidenza?: "su" | "giu";
};

/** Il fattore di opacità delle linee non evidenziate: forma e parole restano, ma quasi bianche (si distingue senza colore). */
export const OPACITA_ATTENUATA = 0.25;

const DOUBLE_GAP = 2.6;

export function MapEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data }: EdgeProps<Edge<MapEdgeData, "map">>) {
  const trunk = data?.orientation === "lr" && data.inTree && !data.lati;
  const [smooth, labelX, labelY] = getSmoothStepPath({
    sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, borderRadius: 0,
    ...(trunk ? { centerX: sourceX + LR_TRUNK, offset: LR_TRUNK } : {}),
  });
  // Sul lato scelto il percorso è quello di `percorsoDaPunti`, lo stesso della stampa e della misura (I31).
  const punti = data?.lati ? percorsoDaPunti({ x: sourceX, y: sourceY }, data.lati.da, { x: targetX, y: targetY }, data.lati.a) : null;
  const path = punti ? pointsPath(punti) : smooth;
  if (!data) return <BaseEdge id={id} path={path} />;
  if (!data.link) return <BaseEdge id={id} path={path} style={stileAlbero(data.evidenza)} />;
  const look = edgeLook(data.link, { inTree: data.inTree, nomeDi: data.nomeDi });
  const d = look.wavy ? wavyPath(punti ?? pathPoints(path)) : path;
  const outer = look.double ? Math.max(look.width + DOUBLE_GAP, 4.2) : look.width;
  // Grigio solo per «non visto»; «cavo giù» è scuro pieno (look.nero), mai il grigio.
  const stroke = data.evidenza === "su" ? "var(--primary)" : look.grey && !look.nero ? "var(--muted-foreground)" : "var(--foreground)";
  const attenuata = data.evidenza === "giu";
  const classeParole = attenuata ? "opacity-25 " : "";
  // Mappa nuova: un pezzo che non sta nello spazio della linea dell'albero si accorcia con «…» (I32), intero nel title.
  const pezzi = data.link.cavo && trunk ? look.tokens.map((t) => (t.startsWith("⚡") ? t : pezzoNelloSpazio(t, Math.floor((lrLabelMaxWidth(sourceX, targetX) - 8) / CHAR_W)))) : look.tokens;
  const dash = look.dash ?? undefined;
  const cap = look.dash === "1.5 4" ? "round" : "butt";
  const at = trunk
    ? `translate(${targetX - 4}px, ${targetY - 1}px) translate(-100%, -100%)`
    : data.inTree && !data.lati
      ? `translate(${targetX}px, ${labelY}px) translate(${data.labelSide === "left" ? "calc(-100% - 4px)" : "4px"}, calc(-100% - 1px))`
      : redundantAt(path, look.tokens, data.avoid, labelX, labelY, punti);
  return (
    <>
      {/* Attenuata come un gruppo solo: il tratto interno color fondo della doppia linea copre ancora l'esterno prima di sbiadire. */}
      <g style={attenuata ? { opacity: OPACITA_ATTENUATA } : undefined}>
        <BaseEdge id={id} path={d} interactionWidth={18} style={{ stroke, strokeWidth: outer, strokeDasharray: dash, strokeLinecap: cap, fill: "none" }} />
        {look.double && (
          // Il tratto interno color fondo divide la linea in due: due tracciati paralleli sottili.
          <path d={d} style={{ stroke: "var(--card)", strokeWidth: outer - DOUBLE_GAP, strokeDasharray: dash, fill: "none", pointerEvents: "none" }} />
        )}
      </g>
      {look.centro && (
        <EdgeLabelRenderer>
          <div
            style={{ position: "absolute", transform: `translate(${mezzo(punti ?? pathPoints(path)).x}px, ${mezzo(punti ?? pathPoints(path)).y}px) translate(-50%, -50%)` }}
            title={look.tokens.join(" · ")}
            className={`${classeParole}nodrag nopan pointer-events-none rounded-sm bg-card px-1 text-[13px] leading-4 font-semibold text-foreground`}
          >
            {look.centro}
          </div>
        </EdgeLabelRenderer>
      )}
      {look.tokens.length > 0 && (
        <EdgeLabelRenderer>
          {trunk ? (
            <div
              style={{ position: "absolute", transform: at, maxWidth: lrLabelMaxWidth(sourceX, targetX) }}
              title={look.tokens.join(" · ")}
              className={`${classeParole}nodrag nopan pointer-events-none w-max rounded-sm bg-card px-1 text-right text-[13px] leading-4 text-foreground`}
            >
              {/* Va a capo solo fra una parola e l'altra: «⚡ 7 W» non si spezza. */}
              {pezzi.map((t, i) => {
                const last = i === pezzi.length - 1;
                // Lo spazio sta fuori dal pezzo che non si spezza: è lì che si può andare a capo.
                return <Fragment key={i}><span className="whitespace-nowrap">{last ? t : `${t} ·`}</span>{last ? null : " "}</Fragment>;
              })}
            </div>
          ) : (
            <div
              style={{ position: "absolute", transform: at }}
              title={look.tokens.join(" · ")}
              className={`${classeParole}nodrag nopan pointer-events-none rounded-sm bg-card px-1 text-[13px] leading-4 whitespace-nowrap text-foreground`}
            >
              {look.tokens.join(" · ")}
            </div>
          )}
        </EdgeLabelRenderer>
      )}
    </>
  );
}

/** Lo stile del tratto dell'albero verso il gruppo degli AP (nessuna parola), con l'evidenza della selezione. */
export function stileAlbero(evidenza: "su" | "giu" | undefined): { stroke: string; strokeWidth: number; opacity?: number } {
  if (evidenza === "su") return { ...TREE_EDGE, stroke: "var(--primary)" };
  return evidenza === "giu" ? { ...TREE_EDGE, opacity: OPACITA_ATTENUATA } : TREE_EDGE;
}

/** Il punto a metà della lunghezza di una spezzata: dove sta il «⋯» di una contrazione. */
function mezzo(punti: readonly Punto[]): Punto {
  let tot = 0;
  for (let i = 1; i < punti.length; i++) tot += Math.hypot(punti[i].x - punti[i - 1].x, punti[i].y - punti[i - 1].y);
  let resto = tot / 2;
  for (let i = 1; i < punti.length; i++) {
    const a = punti[i - 1], b = punti[i], len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len > 0 && resto <= len) return { x: a.x + ((b.x - a.x) * resto) / len, y: a.y + ((b.y - a.y) * resto) / len };
    resto -= len;
  }
  return punti[punti.length - 1] ?? { x: 0, y: 0 };
}

/**
 * La parola di una ridondanza (o di un figlio spostato a mano dall'altra parte): vicino alla metà, ma fuori dai riquadri
 * (si leggeva «…nza» sotto il gruppo degli AP). Sul lato scelto (spec §13.10.1) i punti sono quelli del percorso vero.
 */
function redundantAt(path: string, tokens: readonly string[], avoid: readonly Rect[] | null | undefined, midX: number, midY: number, punti: Pt[] | null): string {
  const size = { w: tokens.join(" · ").length * CHAR_W + 8, h: 16 };
  // Sul lato scelto la parola sta vicino alla metà del percorso vero, fuori dai riquadri (anche dalla riga delle porte).
  const p = punti ? redundantLabelAt(punti, size, avoid ?? []) : avoid?.length ? redundantLabelAt(pathPoints(path), size, avoid) : { x: midX, y: midY };
  return `translate(${p.x}px, ${p.y}px) translate(-50%, -50%)`;
}

/** Verticale: dal fondo del riquadro giù fino alla riga dell'attaccato, poi dentro da sinistra (un trattino a squadra). */
export function AttEdge({ id, sourceX, sourceY, targetX, targetY }: EdgeProps) {
  return <BaseEdge id={id} path={`M${sourceX} ${sourceY} V${targetY} H${targetX}`} style={{ stroke: "var(--muted-foreground)", strokeWidth: 1, fill: "none" }} />;
}

/** Tipi di linea per React Flow: fuori dal componente, così non cambiano a ogni render. */
export const MAP_EDGE_TYPES = { map: MapEdge, att: AttEdge };
