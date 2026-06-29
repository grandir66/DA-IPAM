"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Link2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface UnmatchedNode {
  nodeId: string;
  name: string;
  rname: string;
  ip: string | null;
  osdesc: string | null;
  matchStatus: "matched" | "unmatched" | "manual";
}

export function MeshCentralUnmatched({ onBound }: { onBound?: () => void }) {
  const [nodes, setNodes] = useState<UnmatchedNode[]>([]);
  const [hostIdInput, setHostIdInput] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [bindBusy, setBindBusy] = useState<string | null>(null);

  const fetchNodes = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/integrations/meshcentral/nodes", { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = (await r.json()) as { nodes?: UnmatchedNode[] };
      setNodes((data.nodes ?? []).filter((n) => n.matchStatus === "unmatched"));
    } catch {
      toast.error("Errore nel recupero dei nodi MeshCentral");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchNodes();
  }, [fetchNodes]);

  const handleBind = async (nodeId: string) => {
    const raw = hostIdInput[nodeId]?.trim();
    const hostId = Number(raw);
    if (!raw || !Number.isInteger(hostId) || hostId <= 0) {
      toast.error("Inserisci un host id valido");
      return;
    }
    setBindBusy(nodeId);
    try {
      const r = await fetch("/api/integrations/meshcentral/bind", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nodeId, hostId }),
      });
      const data = (await r.json()) as { error?: string };
      if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
      toast.success(`Nodo associato a oggetto #${hostId}`);
      setHostIdInput((m) => ({ ...m, [nodeId]: "" }));
      await fetchNodes();
      onBound?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore associazione");
    } finally {
      setBindBusy(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium text-muted-foreground">
          Nodi non associati ({nodes.length})
        </div>
        <Button variant="outline" size="sm" disabled={loading} onClick={() => void fetchNodes()}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        </Button>
      </div>

      {nodes.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nessun nodo da associare.</p>
      ) : (
        <div className="rounded-md border overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left p-2">Nodo</th>
                <th className="text-left p-2">IP</th>
                <th className="text-left p-2">OS</th>
                <th className="text-left p-2">Associa a oggetto</th>
              </tr>
            </thead>
            <tbody>
              {nodes.map((n) => (
                <tr key={n.nodeId} className="border-t">
                  <td className="p-2">{n.rname || n.name}</td>
                  <td className="p-2 font-mono">{n.ip ?? "—"}</td>
                  <td className="p-2">{n.osdesc ?? "—"}</td>
                  <td className="p-2">
                    <div className="flex items-center gap-2">
                      <Input
                        className="h-8 w-24"
                        placeholder="host id"
                        value={hostIdInput[n.nodeId] ?? ""}
                        onChange={(e) => setHostIdInput((m) => ({ ...m, [n.nodeId]: e.target.value }))}
                      />
                      <Button size="sm" disabled={bindBusy === n.nodeId} onClick={() => void handleBind(n.nodeId)}>
                        {bindBusy === n.nodeId ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                        ) : (
                          <Link2 className="h-3.5 w-3.5 mr-1" />
                        )}
                        Associa
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
