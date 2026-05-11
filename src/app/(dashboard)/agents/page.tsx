"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ServerCog, PlugZap, CheckCircle2, XCircle, RotateCcw, Settings2 } from "lucide-react";
import { toast } from "sonner";

interface AgentListEntry {
  tenant_id: number;
  codice_cliente: string;
  ragione_sociale: string;
  agent_mode: "local" | "remote";
  agent_hostname: string | null;
  agent_port: number;
  agent_version: string | null;
  agent_last_seen_at: string | null;
  has_token: boolean;
}

type TestResult =
  | { ok: true; latency_ms: number; label: string; scopes: string[]; tenant_code: string }
  | { ok: false; latency_ms: number; error_code: string; error_message: string };

type RowState =
  | { status: "idle" }
  | { status: "testing" }
  | { status: "done"; result: TestResult };

const formatLastSeen = (iso: string | null): string => {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("it-IT");
  } catch {
    return iso;
  }
};

export default function AgentsOverviewPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const role = (session?.user as { role?: string } | undefined)?.role;
  const canEdit = role === "admin" || role === "superadmin";

  const [agents, setAgents] = useState<AgentListEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [rowState, setRowState] = useState<Record<number, RowState>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/agents");
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Errore" }));
        toast.error(err.error || "Impossibile caricare la lista agenti");
        return;
      }
      const data = (await res.json()) as AgentListEntry[];
      setAgents(data);
      setRowState({});
    } catch (e) {
      console.error(e);
      toast.error("Errore di rete nel caricamento agenti");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const testOne = async (tenantId: number): Promise<void> => {
    setRowState((s) => ({ ...s, [tenantId]: { status: "testing" } }));
    try {
      const res = await fetch(`/api/tenants/${tenantId}/agent/test`, { method: "POST" });
      const data = (await res.json()) as TestResult | { error?: string };
      if ("error" in data && data.error) {
        setRowState((s) => ({
          ...s,
          [tenantId]: {
            status: "done",
            result: { ok: false, latency_ms: 0, error_code: "http_error", error_message: data.error! },
          },
        }));
        return;
      }
      setRowState((s) => ({ ...s, [tenantId]: { status: "done", result: data as TestResult } }));
    } catch (e) {
      const msg = (e as Error).message;
      setRowState((s) => ({
        ...s,
        [tenantId]: {
          status: "done",
          result: { ok: false, latency_ms: 0, error_code: "network_error", error_message: msg },
        },
      }));
    }
  };

  const testAll = async () => {
    await Promise.allSettled(agents.map((a) => testOne(a.tenant_id)));
  };

  const renderStatus = (entry: AgentListEntry): React.ReactNode => {
    const rs = rowState[entry.tenant_id];
    if (!rs || rs.status === "idle") {
      if (!entry.has_token) {
        return <Badge variant="secondary">no token</Badge>;
      }
      if (!entry.agent_hostname) {
        return <Badge variant="secondary">no hostname</Badge>;
      }
      return <Badge variant="outline">non testato</Badge>;
    }
    if (rs.status === "testing") {
      return <Badge variant="outline">testing…</Badge>;
    }
    const r = rs.result;
    if (r.ok) {
      return (
        <Badge variant="default" className="bg-green-600 hover:bg-green-700">
          <CheckCircle2 className="h-3 w-3 mr-1" />
          online · {r.latency_ms} ms
        </Badge>
      );
    }
    return (
      <Badge variant="destructive" title={r.error_message}>
        <XCircle className="h-3 w-3 mr-1" />
        {r.error_code}
      </Badge>
    );
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <ServerCog className="h-6 w-6" />
            Agenti remoti
          </h1>
          <p className="text-sm text-muted-foreground">
            Stato live degli agenti Python via Tailscale. Il test esegue GET <code>/whoami</code>
            sull&apos;agente del tenant.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={load} disabled={loading} title="Ricarica lista">
            <RotateCcw className="h-4 w-4 mr-1.5" />
            Ricarica
          </Button>
          <Button onClick={testAll} disabled={loading || agents.length === 0}>
            <PlugZap className="h-4 w-4 mr-1.5" />
            Testa tutti
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Tenants con agent_mode = remote</CardTitle>
          <CardDescription>
            I tenant in modalità <code>local</code> non sono mostrati: per loro le scansioni girano
            sull&apos;hub stesso.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-muted-foreground">Caricamento…</p>
          ) : agents.length === 0 ? (
            <p className="text-muted-foreground">
              Nessun tenant configurato in modalità <code>remote</code>. Vai su un tenant e attiva
              l&apos;agente da <em>Configura agente remoto</em>.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Codice</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Hostname:porta</TableHead>
                  <TableHead>Versione</TableHead>
                  <TableHead>Ultimo heartbeat</TableHead>
                  <TableHead>Stato</TableHead>
                  <TableHead className="text-right">Azioni</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {agents.map((a) => (
                  <TableRow key={a.tenant_id}>
                    <TableCell className="font-mono">{a.codice_cliente}</TableCell>
                    <TableCell>{a.ragione_sociale}</TableCell>
                    <TableCell className="font-mono text-sm">
                      {a.agent_hostname ? `${a.agent_hostname}:${a.agent_port}` : "—"}
                    </TableCell>
                    <TableCell className="font-mono text-sm">{a.agent_version ?? "—"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatLastSeen(a.agent_last_seen_at)}
                    </TableCell>
                    <TableCell>{renderStatus(a)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex gap-2 justify-end">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={!a.has_token || !a.agent_hostname || rowState[a.tenant_id]?.status === "testing"}
                          onClick={() => testOne(a.tenant_id)}
                        >
                          <PlugZap className="h-3.5 w-3.5 mr-1.5" />
                          Test
                        </Button>
                        {canEdit && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => router.push(`/tenants/${a.tenant_id}/agent`)}
                            title="Configura agente"
                          >
                            <Settings2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
