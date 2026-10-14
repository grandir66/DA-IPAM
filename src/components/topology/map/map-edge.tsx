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
 */
import { Fragment } from "react";
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type Edge, type EdgeProps } from "@xyflow/react";
import { edgeLook, pathPoints, wavyPath } from "@/lib/topology/edge-look";
import { LR_TRUNK, lrLabelMaxWidth } from "@/lib/topology/map-screen";
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
};

const DOUBLE_GAP = 2.6;

export function MapEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data }: EdgeProps<Edge<MapEdgeData, "map">>) {
  const trunk = data?.orientation === "lr" && data.inTree;
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, borderRadius: 0,
    ...(trunk ? { centerX: sourceX + LR_TRUNK, offset: LR_TRUNK } : {}),
  });
  if (!data) return <BaseEdge id={id} path={path} />;
  if (!data.link) return <BaseEdge id={id} path={path} style={TREE_EDGE} />;
  const look = edgeLook(data.link, { inTree: data.inTree });
  const d = look.wavy ? wavyPath(pathPoints(path)) : path;
  const outer = look.double ? Math.max(look.width + DOUBLE_GAP, 4.2) : look.width;
  const stroke = look.grey ? "var(--muted-foreground)" : "var(--foreground)";
  const dash = look.dash ?? undefined;
  const cap = look.dash === "1.5 4" ? "round" : "butt";
  const at = trunk
    ? `translate(${targetX - 4}px, ${targetY - 1}px) translate(-100%, -100%)`
    : data.inTree
      ? `translate(${targetX}px, ${labelY}px) translate(${data.labelSide === "left" ? "calc(-100% - 4px)" : "4px"}, calc(-100% - 1px))`
      : `translate(${labelX}px, ${labelY}px) translate(-50%, -50%)`;
  return (
    <>
      <BaseEdge id={id} path={d} interactionWidth={18} style={{ stroke, strokeWidth: outer, strokeDasharray: dash, strokeLinecap: cap, fill: "none" }} />
      {look.double && (
        // Il tratto interno color fondo divide la linea in due: due tracciati paralleli sottili.
        <path d={d} style={{ stroke: "var(--card)", strokeWidth: outer - DOUBLE_GAP, strokeDasharray: dash, fill: "none", pointerEvents: "none" }} />
      )}
      {look.tokens.length > 0 && (
        <EdgeLabelRenderer>
          {trunk ? (
            <div
              style={{ position: "absolute", transform: at, maxWidth: lrLabelMaxWidth(sourceX, targetX) }}
              title={look.tokens.join(" · ")}
              className="nodrag nopan pointer-events-none w-max rounded-sm bg-card px-1 text-right text-[13px] leading-4 text-foreground"
            >
              {/* Va a capo solo fra una parola e l'altra: «⚡ 7 W» non si spezza. */}
              {look.tokens.map((t, i) => {
                const last = i === look.tokens.length - 1;
                // Lo spazio sta fuori dal pezzo che non si spezza: è lì che si può andare a capo.
                return <Fragment key={i}><span className="whitespace-nowrap">{last ? t : `${t} ·`}</span>{last ? null : " "}</Fragment>;
              })}
            </div>
          ) : (
            <div
              style={{ position: "absolute", transform: at }}
              title={look.tokens.join(" · ")}
              className="nodrag nopan pointer-events-none rounded-sm bg-card px-1 text-[13px] leading-4 whitespace-nowrap text-foreground"
            >
              {look.tokens.join(" · ")}
            </div>
          )}
        </EdgeLabelRenderer>
      )}
    </>
  );
}

/** Verticale: dal fondo del riquadro giù fino alla riga dell'attaccato, poi dentro da sinistra (un trattino a squadra). */
export function AttEdge({ id, sourceX, sourceY, targetX, targetY }: EdgeProps) {
  return <BaseEdge id={id} path={`M${sourceX} ${sourceY} V${targetY} H${targetX}`} style={{ stroke: "var(--muted-foreground)", strokeWidth: 1, fill: "none" }} />;
}

/** Tipi di linea per React Flow: fuori dal componente, così non cambiano a ogni render. */
export const MAP_EDGE_TYPES = { map: MapEdge, att: AttEdge };
