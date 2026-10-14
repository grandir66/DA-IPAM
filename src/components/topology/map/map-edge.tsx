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
 */
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type Edge, type EdgeProps } from "@xyflow/react";
import { edgeLook, pathPoints, wavyPath } from "@/lib/topology/edge-look";
import type { MapLink } from "@/lib/topology/model-types";

export type MapEdgeData = {
  link: MapLink;
  /** La linea con cui il riquadro di arrivo è appeso al genitore. */
  inTree: boolean;
  /** Da che parte della verticale va l'etichetta (le porte del riquadro stanno dall'altra). */
  labelSide: "left" | "right";
};

const DOUBLE_GAP = 2.6;

export function MapEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data }: EdgeProps<Edge<MapEdgeData, "map">>) {
  const [path, labelX, labelY] = getSmoothStepPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, borderRadius: 0 });
  if (!data) return <BaseEdge id={id} path={path} />;
  const look = edgeLook(data.link, { inTree: data.inTree });
  const d = look.wavy ? wavyPath(pathPoints(path)) : path;
  const outer = look.double ? Math.max(look.width + DOUBLE_GAP, 4.2) : look.width;
  const stroke = look.grey ? "var(--muted-foreground)" : "var(--foreground)";
  const dash = look.dash ?? undefined;
  const cap = look.dash === "1.5 4" ? "round" : "butt";
  const at = data.inTree
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
          <div
            style={{ position: "absolute", transform: at }}
            title={look.tokens.join(" · ")}
            className="nodrag nopan pointer-events-none rounded-sm bg-card px-1 text-[13px] leading-4 whitespace-nowrap text-foreground"
          >
            {look.tokens.join(" · ")}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

/** Tipi di linea per React Flow: fuori dal componente, così non cambiano a ogni render. */
export const MAP_EDGE_TYPES = { map: MapEdge };
