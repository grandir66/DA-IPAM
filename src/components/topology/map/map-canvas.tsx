"use client";

/**
 * Il disegno della mappa: React Flow con i nodi FISSI nelle coordinate di
 * layoutTree. Gli archi dell'albero sono ad angolo retto (`step`); un
 * collegamento vecchio è grigio tratteggiato. I collegamenti fuori dall'albero
 * si vedono solo con «Collegamenti in più». Un admin può spostare un riquadro:
 * al rilascio si salva il ritocco (lo calcola il chiamante con la firma).
 * Gli archi si disegnano da `tree.links` (copie della vista con principale e
 * ridondanza), non da `model.links`. Il tasto destro su un oggetto o su una
 * linea apre il menu (spec §11.2): il contenuto lo dà il chiamante.
 */
import "@xyflow/react/dist/style.css";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ReactFlow, useReactFlow, type Edge, type Node, type NodeChange } from "@xyflow/react";
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from "@/components/ui/context-menu";
import { ATT_MAX, ATT_ROW, type LayoutResult } from "@/lib/topology/tree-layout";
import type { MapLink } from "@/lib/topology/model-types";
import type { TreeResult } from "@/lib/topology/tree";
import { MAP_NODE_TYPES } from "./map-node";
import type { ModelData } from "./use-topology-data";

const TREE_EDGE = { stroke: "var(--foreground)", strokeWidth: 1.8 };
const STALE_EDGE = { stroke: "var(--muted-foreground)", strokeWidth: 1.4, strokeDasharray: "6 4" };
const EXTRA_EDGE = { stroke: "var(--primary)", strokeWidth: 1.2, strokeDasharray: "3 4", opacity: 0.8 };

/** Le porte viste dal genitore: «porta sua → porta mia» per il figlio `child`. */
export function portsFrom(l: MapLink, child: string): { parentPort: string; childPort: string } {
  return l.a === child ? { parentPort: l.bPort, childPort: l.aPort } : { parentPort: l.aPort, childPort: l.bPort };
}

/** Su cosa si è premuto il tasto destro. */
export type MenuTarget = { kind: "node"; id: string } | { kind: "edge"; link: MapLink };

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
        },
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
  }, [model, tree, layout, p.selected, p.draggable, p.plus, p.starts, p.promoteIds]);

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
        out.push({ id: `t:apg:${ln.parent}`, source: ln.parent, target: `apg:${ln.parent}`, type: "step", style: TREE_EDGE, selectable: false, focusable: false });
        continue;
      }
      out.push({
        id: `t:${child}`, source: ln.parent, target: child, type: "step",
        style: link.stale ? STALE_EDGE : TREE_EDGE, selectable: false, focusable: false, data: { link },
      });
    }
    if (p.showExtra) {
      for (const l of tree.links) {
        if (!l.redundant) continue;
        const a = layout.nodes.get(l.a), b = layout.nodes.get(l.b);
        if (!a || !b || a.role === "attached" || b.role === "attached") continue;
        out.push({ id: `x:${l.id}`, source: l.a, target: l.b, type: "straight", style: EXTRA_EDGE, selectable: false, focusable: false, data: { link: l } });
      }
    }
    return out;
  }, [tree, layout, p.showExtra]);

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
        onNodesChange={onNodesChange}
        onNodeDragStop={(_e, node) => {
          setDrag(null);
          const ln = layout.nodes.get(node.id);
          if (!ln || (Math.abs(node.position.x - ln.x) < 1 && Math.abs(node.position.y - ln.y) < 1)) return;
          p.onMove(node.id, Math.round(node.position.x), Math.round(node.position.y));
        }}
        onNodeClick={(_e, node) => {
          if (node.type === "box" || node.type === "attached") p.onSelect(node.id);
        }}
        onPaneClick={() => p.onSelect(null)}
        // Un gestore del clic rende la linea «attiva» per React Flow (altrimenti niente tasto destro):
        // il clic su una linea apre i dettagli dell'oggetto di arrivo, che la descrivono.
        onEdgeClick={(_e, edge) => {
          if ((edge.data as { link?: MapLink } | undefined)?.link) p.onSelect(edge.target);
        }}
        onNodeContextMenu={(_e, node) => {
          targetRef.current = node.type === "box" || node.type === "attached" ? { kind: "node", id: node.id } : null;
        }}
        onEdgeContextMenu={(_e, edge) => {
          const link = (edge.data as { link?: MapLink } | undefined)?.link;
          targetRef.current = link ? { kind: "edge", link } : null;
        }}
        onPaneContextMenu={() => { targetRef.current = null; }}
        nodesDraggable={p.draggable}
        nodesConnectable={false}
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
