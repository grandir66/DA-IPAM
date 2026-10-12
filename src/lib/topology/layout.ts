import dagre from "dagre";
import type { TopologyGraph, SavedPosition, PositionedNode } from "@/lib/topology/types";

const NODE_W = 170;
const NODE_H = 72;

export function autoLayout(graph: TopologyGraph, saved: SavedPosition[]): PositionedNode[] {
  const savedById = new Map(saved.map((s) => [s.nodeId, s]));
  const out: PositionedNode[] = [];

  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "TB", nodesep: 60, ranksep: 90 });
  g.setDefaultEdgeLabel(() => ({}));
  const needLayout = graph.nodes.filter((n) => !savedById.has(n.id));
  for (const n of needLayout) g.setNode(n.id, { width: NODE_W, height: NODE_H });
  for (const e of graph.edges) {
    if (g.hasNode(e.source) && g.hasNode(e.target)) g.setEdge(e.source, e.target);
  }
  dagre.layout(g);

  for (const n of graph.nodes) {
    const s = savedById.get(n.id);
    if (s) {
      out.push({ nodeId: n.id, x: s.x, y: s.y, fromSaved: true });
      continue;
    }
    const p = g.node(n.id);
    out.push({ nodeId: n.id, x: p ? p.x - NODE_W / 2 : 0, y: p ? p.y - NODE_H / 2 : 0, fromSaved: false });
  }
  return out;
}
