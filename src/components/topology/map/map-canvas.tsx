"use client";

/**
 * Il disegno della mappa: React Flow con i nodi FISSI nelle coordinate di
 * layoutTree. Le linee (map-edge.tsx) sono ad angolo retto con lo stile della
 * spec §11.4. Le ridondanze (collegamenti fuori dall'albero) sono a richiesta
 * (spec §12.5): il riquadro dice «⇄ N», il clic su un riquadro disegna le sue,
 * «Mostra ridondanze» tutte (visibleEdges). Verticale (spec §12.2): linee da
 * destra a sinistra, tratto dal fondo verso gli attaccati, la rotellina scorre
 * (Ctrl o il pizzico per lo zoom). Un admin può spostare un riquadro: al rilascio si salva il
 * ritocco (lo calcola il chiamante con la firma), e trascinare il pallino sul
 * bordo di un riquadro fino a un altro apre «Collega a…».
 * Le linee si disegnano da `tree.links` (copie della vista con principale e
 * ridondanza), non da `model.links`. Le ridondanze e i figli spostati a mano
 * dall'altra parte escono dal lato più vicino (`latiVicini`, spec §13.10.1); le
 * linee dell'albero restano a tronco. Il tasto destro su un oggetto, su una VM o
 * su una linea apre il menu (spec §11.2): il contenuto lo dà il chiamante.
 */
import "@xyflow/react/dist/style.css";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ConnectionMode, ReactFlow, useReactFlow, type Edge, type Node, type NodeChange, type OnConnectEnd } from "@xyflow/react";
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from "@/components/ui/context-menu";
import { isUncensusedVmId } from "@/lib/topology/map-menus";
import {
  centerViewport, drawableLinks, labelBoxes, latiVicini, lineHandles, lineaAlbero, maniglieLati, moreAttachedAt, ostacoli, redundancyCounts, redundantEnds,
  rettangoli, visibleEdges, type Rect,
} from "@/lib/topology/map-screen";
import type { LayoutResult } from "@/lib/topology/tree-layout";
import type { MapLink } from "@/lib/topology/model-types";
import type { TreeResult } from "@/lib/topology/tree";
import { vmChipText } from "@/lib/topology/vm-nodes";
import { MAP_EDGE_TYPES, TREE_EDGE, type MapEdgeData } from "./map-edge";
import { HANDLE_ATT, HANDLE_IN_LR, MAP_NODE_TYPES } from "./map-node";
import type { ModelData } from "./use-topology-data";

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
  /** «Mostra ridondanze»: tutte disegnate; altrimenti solo quelle del riquadro scelto. */
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
  const o = layout.orientation;
  // Le ridondanze che si possono disegnare: fra due riquadri della disposizione (gli attaccati sono righe di un elenco).
  const drawable = useMemo(() => drawableLinks(tree.links, layout.nodes), [tree, layout]);
  const redCount = useMemo(() => redundancyCounts(drawable), [drawable]);

  // T3 (spec §13.10.3): il nome di un oggetto per le parole delle linee («la porta p di A è giù»), e i dati dei riquadri nuovi.
  const nomeDi = useMemo(() => {
    const nomi = new Map(model.nodes.map((n) => [n.id, n.name]));
    return (id: string): string => nomi.get(id) ?? id;
  }, [model.nodes]);
  const segmenti = useMemo(() => new Map((model.cavi?.segmenti ?? []).map((s) => [s.id, s])), [model.cavi]);
  const anomalie = useMemo(() => new Set((model.cavi?.anomalie ?? []).map((a) => a.nodo)), [model.cavi]);

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
          // Il pallino non c'è su una VM non censita: non si collega a mano (revisione finale I-1).
          connectable: connectable && ln.role === "box" && !isUncensusedVmId(ln.id) && n.kind !== "segmento",
          vms: vmInfo.get(ln.id) ?? null,
          onToggleVms: vmInfo.has(ln.id) ? () => onToggleVms(ln.id) : null,
          orientation: o,
          redundant: redCount.get(ln.id) ?? 0,
          redundantShown: p.showExtra || p.selected === ln.id,
          daSistemare: model.classiMappa?.[ln.id] === "da_sistemare",
          // Solo con la mappa nuova (model.cavi): il segmento ha il suo riquadro, l'anomalia il suo testo al posto della seconda riga.
          ...(n.kind === "segmento" ? { segmento: { altri: segmenti.get(ln.id)?.altriApparati ?? 0 } } : {}),
          ...(anomalie.has(ln.id) ? { anomalia: "⚠ core sotto accesso" } : {}),
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
        id: `more:${parent}`, type: "more", position: moreAttachedAt(o, b),
        data: { n: more }, draggable: false, selectable: false, zIndex: 2,
      });
    }
    return out;
  }, [model, tree, layout, o, redCount, segmenti, anomalie, p.showExtra, p.selected, p.draggable, p.plus, p.starts, p.promoteIds, connectable, vmInfo, onToggleVms]);

  const nodes = useMemo(
    () => (drag ? baseNodes.map((n) => (n.id === drag.id ? { ...n, position: { x: drag.x, y: drag.y } } : n)) : baseNodes),
    [baseNodes, drag],
  );

  // I riquadri della disposizione (anche i gruppi degli AP): gli ostacoli di ogni linea sul lato più vicino (spec §13.10.1).
  const riquadri = useMemo(() => rettangoli(layout), [layout]);

  const edges = useMemo((): Edge[] => {
    const out: Edge[] = [];
    const h = lineHandles(o);
    const apEdge = new Set<string>();
    // I riquadri su cui la parola di una linea non deve finire (Task 5): si calcolano alla prima linea che li chiede.
    let avoid: Rect[] | null = null;
    for (const [child, link] of tree.via) {
      const ln = layout.nodes.get(child);
      if (!ln || !ln.parent || ln.role === "attached") continue;
      if (ln.role === "ap") {
        if (apEdge.has(ln.parent)) continue;
        apEdge.add(ln.parent);
        // In verticale anche questa passa dal tronco vicino al genitore, come le altre dei figli.
        const apData: MapEdgeData = { link: null, inTree: true, labelSide: "left", orientation: o };
        out.push({
          id: `t:apg:${ln.parent}`, source: ln.parent, target: `apg:${ln.parent}`, sourceHandle: h.source, targetHandle: h.target,
          ...(o === "lr" ? { type: "map", data: apData } : { type: "step", style: TREE_EDGE }), selectable: false, focusable: false,
        });
        continue;
      }
      const padre = layout.nodes.get(ln.parent);
      const la = padre ? lineaAlbero(o, padre, ln, ostacoli(riquadri, [ln.parent, child])) : { tronco: true as const };
      if (la.tronco) {
        // L'etichetta della linea va dalla parte opposta alle porte scritte sopra il riquadro (a sinistra col «+N»).
        const data: MapEdgeData = { link, inTree: true, labelSide: p.plus.has(child) ? "right" : "left", orientation: o, nomeDi };
        out.push({
          id: `t:${child}`, source: ln.parent, target: child, sourceHandle: h.source, targetHandle: h.target, type: "map",
          selectable: false, focusable: false, data,
        });
      } else {
        // Un figlio spostato a mano dall'altra parte (spec §13.10.1): sul lato più vicino, senza giri.
        const m = maniglieLati(la.lati);
        avoid ??= labelBoxes(layout.nodes.values(), layout.apGroups);
        const data: MapEdgeData = { link, inTree: true, labelSide: "left", orientation: o, avoid, lati: la.lati, nomeDi };
        out.push({
          id: `t:${child}`, source: ln.parent, target: child, sourceHandle: m.source, targetHandle: m.target, type: "map",
          selectable: false, focusable: false, data,
        });
      }
    }
    // Verticale: gli attaccati sono un elenco sotto il riquadro, legato dal fondo (in orizzontale c'è il trattino nel riquadro).
    if (o === "lr") {
      for (const ln of layout.nodes.values()) {
        if (ln.role !== "attached" || !ln.parent) continue;
        out.push({ id: `a:${ln.id}`, source: ln.parent, target: ln.id, sourceHandle: HANDLE_ATT, targetHandle: HANDLE_IN_LR, type: "att", selectable: false, focusable: false });
      }
    }
    // Ridondanze a richiesta (spec §12.5): tutte con «Mostra ridondanze», altrimenti solo quelle del riquadro scelto.
    // La parola «ridondanza» si scrive dove non copre un riquadro (Task 5): servono i riquadri da evitare.
    for (const l of visibleEdges(drawable, { showAll: p.showExtra, selected: p.selected })) {
      if (!l.redundant) continue;
      avoid ??= labelBoxes(layout.nodes.values(), layout.apGroups);
      // Il verso (chi è l'origine) resta quello di sempre: orizzontale dal riquadro più in alto, verticale dal più a sinistra.
      const [s, t] = redundantEnds(o, layout.nodes.get(l.a)!, layout.nodes.get(l.b)!);
      // Spec §13.10.1: dal lato più vicino, mai dal lato opposto (prima dal destro del riquadro più a sinistra al sinistro
      // dell'altro: fra due riquadri della stessa colonna la linea faceva il giro).
      const lati = latiVicini(layout.nodes.get(s)!, layout.nodes.get(t)!, o, ostacoli(riquadri, [s, t]));
      const m = maniglieLati(lati);
      const data: MapEdgeData = { link: l, inTree: false, labelSide: "left", orientation: o, avoid, lati, nomeDi };
      out.push({ id: `x:${l.id}`, source: s, target: t, sourceHandle: m.source, targetHandle: m.target, type: "map", selectable: false, focusable: false, data });
    }
    return out;
  }, [tree, layout, o, drawable, riquadri, nomeDi, p.showExtra, p.selected, p.plus]);

  // Centra (zoom 100 %) sulla testa o sulla prima partenza quando cambia modo o mappa.
  const { centerOn, centerKey } = p;
  useEffect(() => {
    if (centeredRef.current === centerKey || !centerOn || !rf.viewportInitialized) return;
    const n = layout.nodes.get(centerOn);
    const el = wrapRef.current;
    if (!n || !el) return;
    centeredRef.current = centerKey;
    void rf.setViewport(centerViewport(layout.orientation, n, { width: el.clientWidth, height: el.clientHeight }));
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
        // Verticale (spec §12.2): la mappa è alta, la rotellina scorre; lo zoom con Ctrl (o ⌘) e il pizzico.
        {...(o === "lr" ? { panOnScroll: true, zoomOnScroll: false, zoomOnPinch: true, zoomActivationKeyCode: ["Control", "Meta"] } : {})}
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
