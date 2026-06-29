"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, CheckCircle2, RefreshCw, MonitorSmartphone, Save, Download } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MeshCentralUnmatched } from "@/components/integrations/meshcentral-unmatched";

interface MeshConfigPublic {
  present: boolean;
  serverUrl: string;
  domain: string;
  meshId: string;
  serviceUser: string;
}

interface MeshNodeRow {
  nodeId: string;
  name: string;
  rname: string;
  ip: string | null;
  osdesc: string | null;
  conn: number;
  matchStatus: "matched" | "unmatched" | "manual";
  hostId: number | null;
}

type Platform = "windows" | "linux" | "macos";

const EMPTY: MeshConfigPublic = { present: false, serverUrl: "", domain: "", meshId: "", serviceUser: "" };

export function MeshCentralCard({
  isAdmin,
  installed,
  onInstall,
  onUninstall,
  installBusy,
}: {
  isAdmin: boolean;
  installed: boolean;
  onInstall: () => Promise<void>;
  onUninstall: () => void;
  installBusy: boolean;
}) {
  const [cfg, setCfg] = useState<MeshConfigPublic>(EMPTY);
  const [loginTokenKey, setLoginTokenKey] = useState("");
  const [adminUser, setAdminUser] = useState("");
  const [adminPass, setAdminPass] = useState("");
  const [nodes, setNodes] = useState<MeshNodeRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [scriptBusy, setScriptBusy] = useState<Platform | null>(null);

  const fetchState = useCallback(async () => {
    if (!installed) {
      setCfg(EMPTY);
      setNodes([]);
      return;
    }
    setLoading(true);
    try {
      const r = await fetch("/api/integrations/meshcentral/config", { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = (await r.json()) as MeshConfigPublic;
      setCfg({ ...EMPTY, ...data });
      const nr = await fetch("/api/integrations/meshcentral/nodes", { cache: "no-store" });
      if (nr.ok) {
        const nd = (await nr.json()) as { nodes?: MeshNodeRow[] };
        setNodes(nd.nodes ?? []);
      }
    } catch {
      toast.error("Errore nel recupero stato MeshCentral");
    } finally {
      setLoading(false);
    }
  }, [installed]);

  useEffect(() => {
    void fetchState();
  }, [fetchState]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const r = await fetch("/api/integrations/meshcentral/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serverUrl: cfg.serverUrl,
          domain: cfg.domain,
          meshId: cfg.meshId,
          serviceUser: cfg.serviceUser,
          loginTokenKey,
          adminUser,
          adminPass,
        }),
      });
      const data = (await r.json()) as { error?: string };
      if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
      // I segreti non si ripopolano: svuota i campi sensibili.
      setLoginTokenKey("");
      setAdminPass("");
      toast.success("Configurazione MeshCentral salvata");
      await fetchState();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore salvataggio");
    } finally {
      setSaving(false);
    }
  };

  const handleDownloadScript = async (platform: Platform) => {
    setScriptBusy(platform);
    try {
      const r = await fetch("/api/integrations/meshcentral/install-script", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform }),
      });
      if (!r.ok) {
        const err = (await r.json().catch(() => null)) as { error?: string } | null;
        throw new Error(err?.error ?? `HTTP ${r.status}`);
      }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download =
        platform === "windows"
          ? "meshagent-install.ps1"
          : platform === "macos"
            ? "meshagent-install-macos.sh"
            : "meshagent-install.sh";
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Script scaricato");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore download script");
    } finally {
      setScriptBusy(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <MonitorSmartphone className="h-5 w-5" />
              MeshCentral (controllo remoto)
              {installed ? (
                <Badge variant="default" className="bg-emerald-600">
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  Installato
                </Badge>
              ) : (
                <Badge variant="secondary">Non installato</Badge>
              )}
            </CardTitle>
            <CardDescription className="mt-1 max-w-2xl">
              Controllo remoto degli endpoint via MeshCentral co-locato sull&apos;appliance. Configura URL,
              MeshID e service account; il login token e le credenziali admin sono cifrate at-rest e mai mostrate.
            </CardDescription>
          </div>
          <div className="shrink-0 flex gap-2">
            {installed ? (
              <>
                <Button variant="outline" size="sm" disabled={loading} onClick={() => void fetchState()}>
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                </Button>
                <Button variant="outline" disabled={installBusy} onClick={onUninstall}>
                  Disinstalla…
                </Button>
              </>
            ) : (
              <Button disabled={installBusy || !isAdmin} onClick={() => void onInstall()}>
                {installBusy && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Installa modulo
              </Button>
            )}
          </div>
        </div>
      </CardHeader>

      {installed && (
        <CardContent className="space-y-6">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="mc-url" className="text-xs">Server URL</Label>
              <Input id="mc-url" value={cfg.serverUrl} disabled={!isAdmin}
                onChange={(e) => setCfg((c) => ({ ...c, serverUrl: e.target.value }))}
                placeholder="https://mesh.cliente.local" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="mc-domain" className="text-xs">Domain</Label>
              <Input id="mc-domain" value={cfg.domain} disabled={!isAdmin}
                onChange={(e) => setCfg((c) => ({ ...c, domain: e.target.value }))}
                placeholder="(default vuoto)" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="mc-mesh" className="text-xs">MeshID (device group)</Label>
              <Input id="mc-mesh" value={cfg.meshId} disabled={!isAdmin}
                onChange={(e) => setCfg((c) => ({ ...c, meshId: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="mc-svc" className="text-xs">Service user</Label>
              <Input id="mc-svc" value={cfg.serviceUser} disabled={!isAdmin}
                onChange={(e) => setCfg((c) => ({ ...c, serviceUser: e.target.value }))}
                placeholder="svc-daipam" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="mc-key" className="text-xs">Login token key (160-hex)</Label>
              <Input id="mc-key" type="password" value={loginTokenKey} disabled={!isAdmin}
                onChange={(e) => setLoginTokenKey(e.target.value)}
                placeholder={cfg.present ? "•••• (configurata, lascia vuoto per non cambiare)" : ""} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="mc-au" className="text-xs">Admin user</Label>
              <Input id="mc-au" value={adminUser} disabled={!isAdmin}
                onChange={(e) => setAdminUser(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="mc-ap" className="text-xs">Admin password</Label>
              <Input id="mc-ap" type="password" value={adminPass} disabled={!isAdmin}
                onChange={(e) => setAdminPass(e.target.value)}
                placeholder={cfg.present ? "•••• (configurata)" : ""} />
            </div>
          </div>

          {isAdmin && (
            <Button onClick={() => void handleSave()} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
              Salva configurazione
            </Button>
          )}

          <Tabs defaultValue="linux">
            <TabsList className="h-8">
              <TabsTrigger value="linux" className="text-xs">Linux</TabsTrigger>
              <TabsTrigger value="windows" className="text-xs">Windows</TabsTrigger>
              <TabsTrigger value="macos" className="text-xs">macOS</TabsTrigger>
            </TabsList>
            {(["linux", "windows", "macos"] as const).map((p) => (
              <TabsContent key={p} value={p} className="space-y-2 mt-3">
                <p className="text-xs text-muted-foreground">
                  Script di installazione MeshAgent (generico + .msh del device group). Richiede MeshID configurato.
                </p>
                <Button size="sm" disabled={scriptBusy === p || !cfg.meshId}
                  onClick={() => void handleDownloadScript(p)}>
                  {scriptBusy === p ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Download className="h-3.5 w-3.5 mr-1" />}
                  Scarica script {p}
                </Button>
              </TabsContent>
            ))}
          </Tabs>

          {nodes.length > 0 && (
            <div>
              <div className="text-xs font-medium text-muted-foreground mb-1">
                Nodi MeshCentral ({nodes.length})
              </div>
              <div className="rounded-md border overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left p-2">Nome</th>
                      <th className="text-left p-2">IP</th>
                      <th className="text-left p-2">OS</th>
                      <th className="text-left p-2">Online</th>
                      <th className="text-left p-2">Match</th>
                    </tr>
                  </thead>
                  <tbody>
                    {nodes.map((n) => (
                      <tr key={n.nodeId} className="border-t">
                        <td className="p-2">{n.rname || n.name}</td>
                        <td className="p-2 font-mono">{n.ip ?? "—"}</td>
                        <td className="p-2">{n.osdesc ?? "—"}</td>
                        <td className="p-2">{(n.conn & 1) === 1 ? "sì" : "no"}</td>
                        <td className="p-2">
                          <Badge variant="outline" className="text-[10px]">{n.matchStatus}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {/* Manual-bind: associa nodi unmatched a un host (C6). */}
          <MeshCentralUnmatched onBound={() => void fetchState()} />
        </CardContent>
      )}
    </Card>
  );
}
