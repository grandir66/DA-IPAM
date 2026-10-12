"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { ReactFlow, Background, Controls, type Node, type Edge, useNodesState, useEdgesState } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { toast } from "sonner";
import { StatusNode } from "./status-node";
import { autoLayout } from "@/lib/topology/layout";
import type { TopologyGraph, SavedPosition, TopologyStatus } from "@/lib/topology/types";

const nodeTypes = { status: StatusNode };

export function TopologyClient() {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges] = useEdgesState<Edge>([]);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const toFlow = useCallback(
    (graph: TopologyGraph, positions: SavedPosition[]) => {
      const pos = autoLayout(graph, positions);
      const posById = new Map(pos.map((p) => [p.nodeId, p]));
      const fnodes: Node[] = graph.nodes.map((n) => ({
        id: n.id,
        type: "status",
        position: { x: posById.get(n.id)?.x ?? 0, y: posById.get(n.id)?.y ?? 0 },
        data: { label: n.name, type: n.type, status: n.status, mgmtIp: n.mgmtIp },
      }));
      const fedges: Edge[] = graph.edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        label: e.sourcePort && e.targetPort ? `${e.sourcePort}↔${e.targetPort}` : undefined,
      }));
      setNodes(fnodes);
      setEdges(fedges);
    },
    [setNodes, setEdges],
  );

  const load = useCallback(
    async (refreshStatusOnly = false) => {
      const res = await fetch("/api/topology?view=default");
      if (!res.ok) {
        toast.error("Errore nel caricamento topologia");
        return;
      }
      const { graph, positions } = (await res.json()) as { graph: TopologyGraph; positions: SavedPosition[] };
      if (refreshStatusOnly) {
        const statusById = new Map<string, TopologyStatus>(graph.nodes.map((n) => [n.id, n.status]));
        setNodes((cur) =>
          cur.map((n) => ({ ...n, data: { ...n.data, status: statusById.get(n.id) ?? "unknown" } })),
        );
      } else {
        toFlow(graph, positions);
      }
    },
    [toFlow, setNodes],
  );

  useEffect(() => {
    void load(false);
    pollRef.current = setInterval(() => void load(true), 30_000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [load]);

  const persist = useCallback((ns: Node[]) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const positions: SavedPosition[] = ns.map((n) => ({
        nodeId: n.id,
        x: n.position.x,
        y: n.position.y,
        pinned: true,
      }));
      void fetch("/api/topology/positions", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ view: "default", positions }),
      });
    }, 600);
  }, []);

  const onNodeDragStop = useCallback(() => {
    setNodes((cur) => {
      persist(cur);
      return cur;
    });
  }, [persist, setNodes]);

  const flowNodeTypes = useMemo(() => nodeTypes, []);

  return (
    <div className="h-[75vh] w-full rounded-md border">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={flowNodeTypes}
        onNodesChange={onNodesChange}
        onNodeDragStop={onNodeDragStop}
        fitView
      >
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}
