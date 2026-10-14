"use client";

/**
 * Il disegno della mappa: React Flow con i nodi FISSI nelle coordinate di
 * layoutTree. Le linee (map-edge.tsx) sono ad angolo retto con lo stile della
 * spec §11.4; le ridondanze (collegamenti fuori dall'albero) si vedono con
 * «Ridondanze». Un admin può spostare un riquadro: al rilascio si salva il
 * ritocco (lo calcola il chiamante con la firma), e trascinare il pallino sul
 * bordo di un riquadro fino a un altro apre «Collega a…».
 * Le linee si disegnano da `tree.links` (copie della vista con principale e
 * ridondanza), non da `model.links`. Il tasto destro su un oggetto, su una VM o
 * su una linea apre il menu (spec §11.2): il contenuto lo dà il chiamante.
 */
import "@xyflow/react/dist/style.css";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ConnectionMode, ReactFlow, useReactFlow, type Edge, type Node, type NodeChange, type OnConnectEnd } from "@xyflow/react";
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from "@/components/ui/context-menu";
import { ATT_MAX, ATT_ROW, type LayoutResult } from "@/lib/topology/tree-layout";
import type { MapLink } from "@/lib/topology/model-types";
import type { TreeResult } from "@/lib/topology/tree";
import { vmChipText } from "@/lib/topology/vm-nodes";
import { MAP_EDGE_TYPES, type MapEdgeData } from "./map-edge";
import { HANDLE_IN, HANDLE_OUT, MAP_NODE_TYPES } from "./map-node";
import type { ModelData } from "./use-topology-data";

const TREE_EDGE = { stroke: "var(--foreground)", strokeWidth: 1.8 };

/** Le porte viste dal genitore: «porta sua → porta mia» per il figlio `child`. */
export function portsFrom(l: MapLink, child: string): { parentPort: string; childPort: string } {
  return l.a === child ? { parentPort: l.bPort, childPort: l.aPort } : { parentPort: l.aPort, childPort: l.bPort };
}

/** Su cosa si è premuto il tasto destro. */
export type MenuTarget = { kind: "node"; id: string } | { kind: "edge"; link: MapLink } | { kind: "vm"; vmId: string };

interface Props {
  model: ModelData;
  tree: TreeResult;
  layout: LayoutResult;
  selected: string | null;
  showExtra: boolean;
  /** Solo admin: i riquadri si spostano e il ritocco si salva. */
  draggable: boolean;
  plus: ReadonlyMap<string, number>;
  starts: ReadonlySet<string>;
  promoteIds: ReadonlySet<string>;
  /** Dove centrare la vista quando `centerKey` cambia (la testa o la prima partenza). */
  centerOn: string | null;
  centerKey: number;
  onSelect: (id: string | null) => void;
  onMove: (nodeId: string, x: number, y: number) => void;
  /** Il contenuto del menu del tasto destro; `close` lo chiude (dopo un'azione che apre un dialogo). */
  renderMenu: (t: MenuTarget, close: () => void) => ReactNode;
  /** Solo admin: il pallino «Collega a…» sui riquadri. */
  connectable: boolean;
  /** Pallino trascinato da `from` e rilasciato su `to`. */
  onConnect: (from: string, to: string) => void;
  /** «Collega a…» dal menu: il prossimo clic su un oggetto è l'arrivo. */
  picking: boolean;
  onPick: (id: string) => void;
  /** Hypervisor: «N VM, M accese» e se sono mostrate. */
  vmInfo: ReadonlyMap<string, { label: string; open: boolean }>;
  onToggleVms: (id: string) => void;
}

/** L'oggetto sotto il punto di rilascio del pallino: il riquadro (anche se non si è centrata una maniglia). */
function nodeUnder(e: MouseEvent | TouchEvent): string | null {
  const pt = "changedTouches" in e ? e.changedTouches[0] : e;
  if (!pt) return null;
  const el = document.elementFromPoint(pt.clientX, pt.clientY)?.closest(".react-flow__node");
  return el?.getAttribute("data-id") ?? null;
}

export function MapCanvas(p: Props) {
  const { model, tree, layout } = p;
  const rf = useReactFlow();
  const wrapRef = useRef<HTMLDivElement>(null);
  const centeredRef = useRef<number | null>(null);
  const [drag, setDrag] = useState<{ id: string; x: number; y: number } | null>(null);
  // Il bersaglio lo fissano i gestori di React Flow (sull'elemento interno) prima che
  // il ContextMenuTrigger (sul contenitore) chieda di aprire: sul vuoto non si apre.
  const targetRef = useRef<MenuTarget | null>(null);
  const [menu, setMenu] = useState<MenuTarget | null>(null);

  const { connectable, vmInfo, onToggleVms } = p;
  const baseNodes = useMemo((): Node[] => {
    const byId = new Map(model.nodes.map((n) => [n.id, n]));
    const out: Node[] = [];
    for (const g of layout.apGroups) {
      out.push({
        id: `apg:${g.parent}`, type: "apGroup", position: { x: g.x, y: g.y }, width: g.w, height: g.h,
        data: { count: g.count, w: g.w, h: g.h }, draggable: false, selectable: false, zIndex: 0,
      });
    }
    for (const ln of layout.nodes.values()) {
      const n = byId.get(ln.id);
      if (!n) continue;
      const via = tree.via.get(ln.id);
      const ports = via ? portsFrom(via, ln.id) : null;
      if (ln.role === "attached") {
        out.push({
          id: ln.id, type: "attached", position: { x: ln.x, y: ln.y }, width: ln.w, height: ln.h, draggable: false, zIndex: 2,
          data: { node: n, port: ports?.parentPort || null, selected: p.selected === ln.id },
        });
        continue;
      }
      const cls = n.type === "switch" || n.type === "access_point";
      out.push({
        id: ln.id, type: "box", position: { x: ln.x, y: ln.y }, width: ln.w, height: ln.h,
        draggable: p.draggable && ln.role === "box", zIndex: 1,
        data: {
          node: n, role: ln.role, w: ln.w, h: ln.h, status: model.status[ln.id] ?? "unknown",
          clients: cls ? (model.clientCount[ln.id] ?? 0) : null,
          promote: p.promoteIds.has(ln.id),
          plus: p.plus.get(ln.id) ?? 0,
          start: p.starts.has(ln.id),
          selected: p.selected === ln.id,
          portLabel: ports && ln.role === "box" ? `${ports.parentPort || "?"} → ${ports.childPort || "?"}` : null,
          daysUnseen: via?.stale ? (via.daysUnseen ?? 0) : null,
          attached: (tree.children.get(ln.id) ?? []).some((k) => layout.nodes.get(k)?.role === "attached"),
          connectable: connectable && ln.role === "box",
          vms: vmInfo.get(ln.id) ?? null,
          onToggleVms: vmInfo.has(ln.id) ? () => onToggleVms(ln.id) : null,
        },
      });
    }
    const vmById = new Map(model.vms.map((v) => [v.id, v]));
    for (const c of layout.vmChips) {
      const v = vmById.get(c.vmId);
      if (!v) continue;
      out.push({
        id: `vmc:${c.vmId}`, type: "vm", position: { x: c.x, y: c.y }, width: c.w, height: c.h, draggable: false, zIndex: 3,
        data: { vm: v, text: vmChipText(v, c.w), w: c.w, h: c.h, selected: p.selected === v.id || (v.nodeId !== null && p.selected === v.nodeId) },
      });
    }
    for (const [parent, more] of layout.moreAttached) {
      const b = layout.nodes.get(parent);
      if (!b) continue;
      out.push({
        id: `more:${parent}`, type: "more", position: { x: b.x + b.w + 14, y: b.y + ATT_MAX * ATT_ROW },
        data: { n: more }, draggable: false, selectable: false, zIndex: 2,
      });
    }
    return out;
  }, [model, tree, layout, p.selected, p.draggable, p.plus, p.starts, p.promoteIds, connectable, vmInfo, onToggleVms]);

  const nodes = useMemo(
    () => (drag ? baseNodes.map((n) => (n.id === drag.id ? { ...n, position: { x: drag.x, y: drag.y } } : n)) : baseNodes),
    [baseNodes, drag],
  );

  const edges = useMemo((): Edge[] => {
    const out: Edge[] = [];
    const apEdge = new Set<string>();
    for (const [child, link] of tree.via) {
      const ln = layout.nodes.get(child);
      if (!ln || !ln.parent || ln.role === "attached") continue;
      if (ln.role === "ap") {
        if (apEdge.has(ln.parent)) continue;
        apEdge.add(ln.parent);
        out.push({ id: `t:apg:${ln.parent}`, source: ln.parent, target: `apg:${ln.parent}`, sourceHandle: HANDLE_OUT, targetHandle: HANDLE_IN, type: "step", style: TREE_EDGE, selectable: false, focusable: false });
        continue;
      }
      // L'etichetta della linea va dalla parte opposta alle porte scritte sopra il riquadro (a sinistra col «+N»).
      const data: MapEdgeData = { link, inTree: true, labelSide: p.plus.has(child) ? "right" : "left" };
      out.push({
        id: `t:${child}`, source: ln.parent, target: child, sourceHandle: HANDLE_OUT, targetHandle: HANDLE_IN, type: "map",
        selectable: false, focusable: false, data,
      });
    }
    if (p.showExtra) {
      for (const l of tree.links) {
        if (!l.redundant) continue;
        const a = layout.nodes.get(l.a), b = layout.nodes.get(l.b);
        if (!a || !b || a.role === "attached" || b.role === "attached") continue;
        // Dall'alto in basso: la linea scende dal riquadro più in alto.
        const [s, t] = a.y <= b.y ? [l.a, l.b] : [l.b, l.a];
        const data: MapEdgeData = { link: l, inTree: false, labelSide: "left" };
        out.push({ id: `x:${l.id}`, source: s, target: t, sourceHandle: HANDLE_OUT, targetHandle: HANDLE_IN, type: "map", selectable: false, focusable: false, data });
      }
    }
    return out;
  }, [tree, layout, p.showExtra, p.plus]);

  // Centra (zoom 100 %) sulla testa o sulla prima partenza quando cambia modo o mappa.
  const { centerOn, centerKey } = p;
  useEffect(() => {
    if (centeredRef.current === centerKey || !centerOn || !rf.viewportInitialized) return;
    const n = layout.nodes.get(centerOn);
    const el = wrapRef.current;
    if (!n || !el) return;
    centeredRef.current = centerKey;
    void rf.setViewport({ x: el.clientWidth / 2 - (n.x + n.w / 2), y: 10, zoom: 1 });
  }, [centerKey, centerOn, layout, rf]);

  const onConnectEnd: OnConnectEnd = (e, state) => {
    const from = state.fromNode?.id;
    const to = state.toNode?.id ?? nodeUnder(e);
    if (from && to && to !== from && layout.nodes.get(to)) p.onConnect(from, to);
  };

  function onNodesChange(changes: NodeChange[]) {
    for (const c of changes) if (c.type === "position" && c.position && c.dragging) setDrag({ id: c.id, x: c.position.x, y: c.position.y });
  }

  return (
    <ContextMenu open={menu !== null} onOpenChange={(o) => setMenu(o ? targetRef.current : null)}>
    <ContextMenuTrigger ref={wrapRef} className="h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={MAP_NODE_TYPES}
        edgeTypes={MAP_EDGE_TYPES}
        onNodesChange={onNodesChange}
        onNodeDragStop={(_e, node) => {
          setDrag(null);
          const ln = layout.nodes.get(node.id);
          if (!ln || (Math.abs(node.position.x - ln.x) < 1 && Math.abs(node.position.y - ln.y) < 1)) return;
          p.onMove(node.id, Math.round(node.position.x), Math.round(node.position.y));
        }}
        onNodeClick={(_e, node) => {
          if (node.type === "vm") {
            const v = (node.data as { vm: { id: string; nodeId: string | null } }).vm;
            p.onSelect(v.nodeId ?? v.id);
            return;
          }
          if (node.type !== "box" && node.type !== "attached") return;
          if (p.picking) p.onPick(node.id);
          else p.onSelect(node.id);
        }}
        onPaneClick={() => p.onSelect(null)}
        // Un gestore del clic rende la linea «attiva» per React Flow (altrimenti niente tasto destro):
        // il clic su una linea apre i dettagli dell'oggetto di arrivo, che la descrivono.
        onEdgeClick={(_e, edge) => {
          if ((edge.data as { link?: MapLink } | undefined)?.link) p.onSelect(edge.target);
        }}
        onNodeContextMenu={(_e, node) => {
          targetRef.current =
            node.type === "box" || node.type === "attached" ? { kind: "node", id: node.id }
              : node.type === "vm" ? { kind: "vm", vmId: (node.data as { vm: { id: string } }).vm.id }
                : null;
        }}
        onEdgeContextMenu={(_e, edge) => {
          const link = (edge.data as { link?: MapLink } | undefined)?.link;
          targetRef.current = link ? { kind: "edge", link } : null;
        }}
        onPaneContextMenu={() => { targetRef.current = null; }}
        nodesDraggable={p.draggable}
        nodesConnectable={p.connectable}
        connectionMode={ConnectionMode.Loose}
        onConnectEnd={onConnectEnd}
        zoomOnDoubleClick={false}
        onlyRenderVisibleElements
        minZoom={0.1}
        maxZoom={2}
        defaultViewport={{ x: 0, y: 0, zoom: 1 }}
      />
    </ContextMenuTrigger>
    <ContextMenuContent>{menu && p.renderMenu(menu, () => setMenu(null))}</ContextMenuContent>
    </ContextMenu>
  );
}
