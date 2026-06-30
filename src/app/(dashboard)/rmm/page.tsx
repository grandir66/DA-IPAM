"use client";

/**
 * RMM — Controllo remoto (MeshCentral).
 * Lista nodi MeshCentral del tenant con launch-out per i nodi mappati a un host,
 * manual-bind per gli unmatched, e link alla console MeshCentral.
 */
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, MonitorSmartphone, RefreshCw, ExternalLink, Settings } from "lucide-react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MeshCentralUnmatched } from "@/components/integrations/meshcentral-unmatched";

interface MeshConfigPublic {
  present: boolean;
  serverUrl: string;
  meshId: string;
}

interface MeshNodeRow {
  node_id: string;
  host_id: number | null;
  name: string | null;
  rname: string | null;
  primary_ip: string | null;
  osdesc: string | null;
  conn: number;
  match_status: string | null;
  host_hostname: string | null;
}

export default function RmmPage() {
  const [cfg, setCfg] = useState<MeshConfigPublic | null>(null);
  const [nodes, setNodes] = useState<MeshNodeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [launchBusy, setLaunchBusy] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [cr, nr] = await Promise.all([
        fetch("/api/integrations/meshcentral/config", { cache: "no-store" }),
        fetch("/api/integrations/meshcentral/nodes", { cache: "no-store" }),
      ]);
      setCfg(cr.ok ? ((await cr.json()) as MeshConfigPublic) : null);
      setNodes(nr.ok ? (((await nr.json()) as { nodes?: MeshNodeRow[] }).nodes ?? []) : []);
    } catch {
      toast.error("Errore nel recupero dello stato RMM");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function startRemote(hostId: number) {
    if (launchBusy) return;
    setLaunchBusy(hostId);
    const win = window.open("", "_blank", "noopener,noreferrer");
    try {
      const r = await fetch(`/api/integrations/meshcentral/host/${hostId}/remote-session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ viewmode: 11 }),
      });
      const data = (await r.json().catch(() => ({}))) as { url?: string };
      if (!r.ok || !data.url) {
        if (win) win.close();
        toast.error("Avvio sessione remota fallito");
        return;
      }
      if (win) {
        win.opener = null;
        win.location.href = data.url;
      } else {
        toast("Popup bloccato — apri manualmente", {
          action: { label: "Apri", onClick: () => window.open(data.url, "_blank", "noopener,noreferrer") },
        });
      }
    } catch {
      if (win) win.close();
      toast.error("Errore di rete");
    } finally {
      setLaunchBusy(null);
    }
  }

  const matched = nodes.filter((n) => n.host_id != null);

  return (
    <div className="space-y-6 p-1">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <MonitorSmartphone className="h-6 w-6" />
            Controllo remoto (RMM)
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Sessioni remote sugli endpoint via MeshCentral. Le sessioni si aprono già autenticate (SSO).
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={loading} onClick={() => void load()}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
          {cfg?.present && cfg.serverUrl && (
            <a href={cfg.serverUrl} target="_blank" rel="noopener noreferrer">
              <Button variant="outline" size="sm">
                <ExternalLink className="h-4 w-4 mr-1" /> Console MeshCentral
              </Button>
            </a>
          )}
        </div>
      </div>

      {!cfg?.present ? (
        <Card>
          <CardContent className="py-8 text-center space-y-3">
            <p className="text-sm text-muted-foreground">
              Modulo MeshCentral non configurato per questo tenant.
            </p>
            <Link href="/settings">
              <Button variant="outline" size="sm">
                <Settings className="h-4 w-4 mr-1" /> Vai a Impostazioni → Moduli
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Endpoint gestiti ({matched.length})</CardTitle>
            </CardHeader>
            <CardContent>
              {matched.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nessun endpoint mappato. Installa l&apos;agente MeshCentral sugli endpoint
                  (Impostazioni → Moduli → MeshCentral → scarica script) oppure associa i nodi qui sotto.
                </p>
              ) : (
                <div className="rounded-md border overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-xs">
                      <tr>
                        <th className="text-left p-2">Endpoint</th>
                        <th className="text-left p-2">IP</th>
                        <th className="text-left p-2">OS</th>
                        <th className="text-left p-2">Stato</th>
                        <th className="text-right p-2">Azione</th>
                      </tr>
                    </thead>
                    <tbody>
                      {matched.map((n) => {
                        const online = (n.conn & 1) === 1;
                        return (
                          <tr key={n.node_id} className="border-t">
                            <td className="p-2">{n.host_hostname || n.rname || n.name || "—"}</td>
                            <td className="p-2 font-mono text-xs">{n.primary_ip ?? "—"}</td>
                            <td className="p-2 text-xs">{n.osdesc ?? "—"}</td>
                            <td className="p-2">
                              <Badge variant="outline" className={online ? "text-emerald-600" : "text-amber-600"}>
                                {online ? "online" : "offline"}
                              </Badge>
                            </td>
                            <td className="p-2 text-right">
                              <Button
                                size="sm"
                                disabled={launchBusy === n.host_id || !online}
                                onClick={() => n.host_id != null && void startRemote(n.host_id)}
                              >
                                {launchBusy === n.host_id ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                                ) : (
                                  <MonitorSmartphone className="h-3.5 w-3.5 mr-1" />
                                )}
                                Controllo remoto
                              </Button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Nodi da associare</CardTitle>
            </CardHeader>
            <CardContent>
              <MeshCentralUnmatched onBound={() => void load()} />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
