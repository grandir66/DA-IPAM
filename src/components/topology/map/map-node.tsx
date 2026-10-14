"use client";

/**
 * I riquadri della mappa (nodi React Flow a posizione fissa, calcolata da
 * layoutTree). Lo stato si legge senza il colore: giù = bordo rosso pieno e
 * «▲ giù», avviso = «◆ avviso», sconosciuto = «?». Testo misurato con
 * nodeWidth/fitLabel; il nome intero sta nel title. Fase 2b: un pallino sul
 * bordo destro (admin, al passaggio del mouse) si trascina fino a un altro
 * oggetto per «Collega a…»; l'hypervisor dice «N VM, M accese ▸» e, espanso,
 * tiene in sé le etichette delle VM (nodi `vm` sopra il suo riquadro).
 * Mappa verticale (spec §12.2): le linee entrano da sinistra ed escono da destra
 * (maniglie `sx`/`dx`), verso gli attaccati elencati sotto il riquadro parte un
 * tratto dal fondo (`fondo`); le maniglie dell'orizzontale (`su`/`giu`) restano.
 * Ridondanze a richiesta (spec §12.5): «⇄ N» nel riquadro, pieno quando sono
 * disegnate (fondo e bordo scuri, testo in grassetto: non solo il colore).
 */
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { cn } from "@/lib/utils";
import { HANDLE_ATT, HANDLE_IN, HANDLE_IN_LR, HANDLE_OUT, HANDLE_OUT_LR } from "@/lib/topology/map-screen";
import { ATT_INDENT, BOX_H, fitLabel } from "@/lib/topology/tree-layout";
import { isRunning } from "@/lib/topology/vm-nodes";
import type { MapNode, MapOrientation, MapVm } from "@/lib/topology/model-types";
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
  /** Admin: il pallino per «Collega a…». */
  connectable: boolean;
  /** Hypervisor con VM: «N VM, M accese» e se sono mostrate. */
  vms: { label: string; open: boolean } | null;
  onToggleVms: (() => void) | null;
  orientation: MapOrientation;
  /** «⇄ N»: le ridondanze di questo oggetto (spec §12.5), 0 = nessuna. */
  redundant: number;
  /** Le sue ridondanze sono disegnate (riquadro scelto o «Mostra ridondanze»). */
  redundantShown: boolean;
};
export type VmData = { vm: MapVm; text: string; w: number; h: number; selected: boolean };
export type AttachedData = { node: MapNode; port: string | null; selected: boolean };
export type ApGroupData = { count: number; w: number; h: number };
export type MoreData = { n: number };

const HIDDEN_HANDLE = "!pointer-events-none !opacity-0 !min-h-0 !min-w-0 !h-px !w-px !border-0";

/** Le linee si agganciano qui (id fissi, in map-screen.ts: il pallino di «Collega a…» è un'altra maniglia). */
export { HANDLE_ATT, HANDLE_IN, HANDLE_IN_LR, HANDLE_OUT, HANDLE_OUT_LR };

/** Le maniglie dei due orientamenti ci sono sempre: quale si usa lo dice la linea (map-canvas). */
function Handles({ att = false }: { att?: boolean }) {
  return (
    <>
      <Handle id={HANDLE_IN} type="target" position={Position.Top} isConnectable={false} className={HIDDEN_HANDLE} />
      <Handle id={HANDLE_OUT} type="source" position={Position.Bottom} isConnectable={false} className={HIDDEN_HANDLE} />
      <Handle id={HANDLE_IN_LR} type="target" position={Position.Left} isConnectable={false} className={HIDDEN_HANDLE} />
      <Handle id={HANDLE_OUT_LR} type="source" position={Position.Right} isConnectable={false} className={HIDDEN_HANDLE} />
      {/* Verso gli attaccati (verticale): dal fondo, a metà del rientro con cui sono elencati. */}
      {att && <Handle id={HANDLE_ATT} type="source" position={Position.Bottom} isConnectable={false} className={HIDDEN_HANDLE} style={{ left: ATT_INDENT / 2 }} />}
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
  const lr = data.orientation === "lr";
  const red = data.redundant;
  return (
    <div
      title={title}
      style={{ width: w, height: h }}
      className={cn(
        "group relative cursor-pointer rounded-md bg-card text-foreground",
        giu ? "border-[2.5px] border-destructive" : data.promote ? "border-[1.5px] border-dashed border-foreground" : "border-[1.5px] border-foreground",
        data.selected && "ring-[3px] ring-primary ring-offset-1",
      )}
    >
      <Handles att={lr && data.attached} />
      {data.connectable && (
        <Handle
          id="collega"
          type="source"
          position={Position.Right}
          title="Trascina fino a un altro oggetto per collegarli a mano"
          className="!size-3.5 !border-2 !border-card !bg-foreground opacity-0 transition-opacity group-hover:opacity-100"
        />
      )}
      {/* L'intestazione resta alta come un riquadro normale: sotto, nell'hypervisor espanso, stanno le VM. */}
      <div className="flex items-center gap-1.5 px-1.5" style={{ height: Math.min(h, BOX_H) - 3 }}>
        <TopoIcon type={n.type} size={26} className="shrink-0" />
        <div className="min-w-0 flex-1 leading-4">
          {/* Col «+N» in alto a destra il nome si ferma prima: lo copriva (Task 12). */}
          <div className={cn("flex min-w-0 items-center gap-1", data.plus > 0 && "pr-6")}>
            <div className={cn("min-w-0 flex-1 truncate text-[13px] font-semibold", giu && "text-destructive")}>{fitLabel(n.name, red > 0 ? w - 40 : w)}</div>
            {red > 0 && (
              <span
                title={data.redundantShown
                  ? `${red} ${red === 1 ? "cavo" : "cavi"} di ridondanza, disegnati sulla mappa`
                  : `${red} ${red === 1 ? "cavo" : "cavi"} di ridondanza: fai clic sul riquadro per vederli, o «Mostra ridondanze»`}
                className={cn(
                  "shrink-0 rounded-sm border border-foreground px-1 text-[13px] leading-4",
                  data.redundantShown ? "bg-foreground font-semibold text-background" : "bg-card text-foreground",
                )}
              >
                ⇄ {red}
              </span>
            )}
          </div>
          {data.vms && data.onToggleVms ? (
            <button
              type="button"
              className="nodrag block max-w-full truncate text-left text-[13px] underline-offset-2 hover:underline"
              title={data.vms.open ? "Nascondi le VM" : "Mostra le VM dentro il riquadro"}
              onClick={(e) => { e.stopPropagation(); data.onToggleVms?.(); }}
            >
              {stato && <span className={cn("mr-1 font-semibold", giu ? "text-destructive" : "text-foreground")}>{stato}</span>}
              {data.vms.label} {data.vms.open ? "▾" : "▸"}
            </button>
          ) : (
            <div className="truncate text-[13px] text-muted-foreground">
              {stato && <span className={cn("mr-1 font-semibold", giu ? "text-destructive" : "text-foreground")}>{stato}</span>}
              {second}
            </div>
          )}
        </div>
      </div>
      {data.attached && !lr && <span className="absolute top-[9px] left-full w-[10px] border-t border-muted-foreground" />}
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
          50 px («bridge/…», Task 12). In verticale la linea entra da sinistra:
          le porte stanno sopra il riquadro da sinistra, prima del «+N», dentro
          i 18 px fra un fratello e l'altro. */}
      {data.portLabel && (
        <span
          title={data.portLabel}
          style={{ maxWidth: lr ? w - (data.plus > 0 ? 34 : 6) : w / 2 - 4 }}
          className={cn(
            "absolute truncate text-[13px] leading-4 whitespace-nowrap",
            lr ? "-top-[18px] left-1" : data.plus > 0 ? "-top-[19px] right-1/2 mr-1 text-right" : "-top-[19px] left-1/2 ml-1",
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
      <Handle id={HANDLE_IN_LR} type="target" position={Position.Left} isConnectable={false} className={HIDDEN_HANDLE} />
      <TopoIcon type={n.type} size={16} className="shrink-0" />
      <span className="truncate text-[13px] leading-4">{n.name}</span>
    </div>
  );
}

/** Una VM dentro l'hypervisor espanso: ▶ accesa (bordo pieno) / ■ spenta (bordo tratteggiato), nome e IP se ci sta. */
function VmNode({ data }: NodeProps<Node<VmData, "vm">>) {
  const v = data.vm;
  const on = isRunning(v.status);
  return (
    <div
      title={[v.name, on ? "accesa" : `spenta (${v.status || "stato non letto"})`, ...v.ips, v.nodeId ? "è un oggetto censito" : null].filter(Boolean).join(" · ")}
      style={{ width: data.w, height: data.h }}
      className={cn(
        "flex cursor-pointer items-center rounded-sm bg-muted px-1 text-[13px] leading-4 whitespace-nowrap text-foreground",
        on ? "border border-foreground" : "border border-dashed border-muted-foreground",
        data.selected && "ring-2 ring-primary",
      )}
    >
      {data.text}
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
export const MAP_NODE_TYPES = { box: BoxNode, attached: AttachedNode, apGroup: ApGroupNode, more: MoreNode, vm: VmNode };
