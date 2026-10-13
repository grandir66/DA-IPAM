"use client";

/**
 * I riquadri della mappa (nodi React Flow a posizione fissa, calcolata da
 * layoutTree). Lo stato si legge senza il colore: giù = bordo rosso pieno e
 * «▲ giù», avviso = «◆ avviso», sconosciuto = «?». Testo misurato con
 * nodeWidth/fitLabel; il nome intero sta nel title.
 */
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { cn } from "@/lib/utils";
import { fitLabel } from "@/lib/topology/tree-layout";
import type { MapNode } from "@/lib/topology/model-types";
import type { TopologyStatus } from "@/lib/topology/types";
import { TopoIcon, typeLabel } from "./topology-icons";

export type BoxData = {
  node: MapNode;
  role: "box" | "ap";
  w: number;
  h: number;
  status: TopologyStatus;
  /** Client visti sulle porte (solo switch e AP), null se non si mostra. */
  clients: number | null;
  promote: boolean;
  /** Passo passo: apparati collegati non ancora nella mappa. */
  plus: number;
  start: boolean;
  selected: boolean;
  /** «porta del genitore → porta mia», sopra il riquadro. */
  portLabel: string | null;
  daysUnseen: number | null;
  /** Ha attaccati nella fascia a destra: un trattino li lega al riquadro. */
  attached: boolean;
};
export type AttachedData = { node: MapNode; port: string | null; selected: boolean };
export type ApGroupData = { count: number; w: number; h: number };
export type MoreData = { n: number };

const HIDDEN_HANDLE = "!pointer-events-none !opacity-0 !min-h-0 !min-w-0 !h-px !w-px !border-0";

function Handles() {
  return (
    <>
      <Handle type="target" position={Position.Top} isConnectable={false} className={HIDDEN_HANDLE} />
      <Handle type="source" position={Position.Bottom} isConnectable={false} className={HIDDEN_HANDLE} />
    </>
  );
}

const STATO: Record<TopologyStatus, string | null> = { ok: null, warning: "◆ avviso", fail: "▲ giù", unknown: "?" };
/** Lo stato in parole per il title (il «?» nel riquadro da solo non dice niente). */
const STATO_PAROLE: Record<TopologyStatus, string> = { ok: "raggiungibile", warning: "avviso", fail: "giù", unknown: "sconosciuto (nessun segnale)" };

function BoxNode({ data }: NodeProps<Node<BoxData, "box">>) {
  const { node: n, w, h, status } = data;
  const giu = status === "fail";
  const second = data.promote
    ? "host · da promuovere"
    : [n.mgmtIp ?? typeLabel(n.type), data.clients ? `${data.clients} client` : null].filter(Boolean).join(" · ");
  const stato = STATO[status];
  const title = [n.name, n.mgmtIp, typeLabel(n.type), `stato: ${STATO_PAROLE[status]}`].filter(Boolean).join(" · ");
  return (
    <div
      title={title}
      style={{ width: w, height: h }}
      className={cn(
        "relative flex cursor-pointer items-center gap-1.5 rounded-md bg-card px-1.5 text-foreground",
        giu ? "border-[2.5px] border-destructive" : data.promote ? "border-[1.5px] border-dashed border-foreground" : "border-[1.5px] border-foreground",
        data.selected && "ring-[3px] ring-primary ring-offset-1",
      )}
    >
      <Handles />
      <TopoIcon type={n.type} size={26} className="shrink-0" />
      <div className="min-w-0 flex-1 leading-4">
        {/* Col «+N» in alto a destra il nome si ferma prima: lo copriva (Task 12). */}
        <div className={cn("truncate text-[13px] font-semibold", giu && "text-destructive", data.plus > 0 && "pr-6")}>{fitLabel(n.name, w)}</div>
        <div className="truncate text-[13px] text-muted-foreground">
          {stato && <span className={cn("mr-1 font-semibold", giu ? "text-destructive" : "text-foreground")}>{stato}</span>}
          {second}
        </div>
      </div>
      {data.attached && <span className="absolute top-[9px] left-full w-[10px] border-t border-muted-foreground" />}
      {data.plus > 0 && (
        <span
          title={`${data.plus} apparati collegati non ancora nella mappa`}
          className="absolute -top-2.5 -right-1 rounded-full border border-foreground bg-accent px-1.5 text-[13px] leading-[18px] font-bold text-accent-foreground"
        >
          +{data.plus}
        </span>
      )}
      {data.start && (
        <span className="absolute -top-[19px] left-0 text-[13px] leading-4 font-semibold whitespace-nowrap text-foreground">▶ partenza</span>
      )}
      {/* Le porte sopra il riquadro, a destra della linea; col «+N» in alto a
          destra vanno a sinistra della linea, dove c'è la metà intera invece di
          50 px («bridge/…», Task 12). */}
      {data.portLabel && (
        <span
          title={data.portLabel}
          style={{ maxWidth: w / 2 - 4 }}
          className={cn(
            "absolute -top-[19px] truncate text-[13px] leading-4 whitespace-nowrap",
            data.plus > 0 ? "right-1/2 mr-1 text-right" : "left-1/2 ml-1",
            data.daysUnseen !== null ? "text-muted-foreground italic" : "text-muted-foreground",
          )}
        >
          {data.portLabel}
          {data.daysUnseen !== null && ` · non visto da ${data.daysUnseen} g`}
        </span>
      )}
    </div>
  );
}

function AttachedNode({ data }: NodeProps<Node<AttachedData, "attached">>) {
  const n = data.node;
  return (
    <div
      title={[n.name, n.mgmtIp, typeLabel(n.type), data.port ? `porta ${data.port}` : null].filter(Boolean).join(" · ")}
      className={cn(
        "flex h-[18px] w-[160px] cursor-pointer items-center gap-1 rounded-sm border border-muted-foreground bg-muted px-0.5 text-foreground",
        data.selected && "ring-2 ring-primary",
      )}
    >
      <TopoIcon type={n.type} size={16} className="shrink-0" />
      <span className="truncate text-[13px] leading-4">{n.name}</span>
    </div>
  );
}

function ApGroupNode({ data }: NodeProps<Node<ApGroupData, "apGroup">>) {
  return (
    <div style={{ width: data.w, height: data.h }} className="rounded-md border border-border bg-muted/40">
      <Handles />
      <span className="pl-1.5 text-[13px] leading-[18px] text-muted-foreground">{data.count} AP</span>
    </div>
  );
}

function MoreNode({ data }: NodeProps<Node<MoreData, "more">>) {
  return <span className="text-[13px] leading-4 whitespace-nowrap text-muted-foreground">+ altri {data.n}</span>;
}

/** Tipi di nodo per React Flow: fuori dal componente, così non cambiano a ogni render. */
export const MAP_NODE_TYPES = { box: BoxNode, attached: AttachedNode, apGroup: ApGroupNode, more: MoreNode };
