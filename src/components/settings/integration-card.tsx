"use client";

import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Play, Square, RotateCcw, Trash2, CheckCircle2, XCircle, Loader2, ExternalLink, Wifi, WifiOff, RefreshCw, Eye, EyeOff, Terminal } from "lucide-react";
import type { IntegrationComponent, IntegrationMode, ComponentConfig, InstallJob, ContainerStatus } from "@/lib/integrations/types";

interface Props {
  component: IntegrationComponent;
  title: string;
  description: string;
  dockerAvailable: boolean;
  /** Mostra bottone "Sincronizza inventario" (solo LibreNMS) */
  showSyncButton?: boolean;
}

interface ApiState {
  config: ComponentConfig;
  containerStatus: ContainerStatus | null;
}

export function IntegrationCard({ component, title, description, dockerAvailable, showSyncButton }: Props) {
  const [state, setState] = useState<ApiState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [reachable, setReachable] = useState<boolean | null>(null);

  const [localConfig, setLocalConfig] = useState<ComponentConfig>({
    mode: "disabled",
    url: "",
    apiToken: "",
    containerName: `da-${component}`,
    username: "admin",
    password: "",
  });

  const [adminPassword, setAdminPassword] = useState("admin");
  const [showAdminPassword, setShowAdminPassword] = useState(false);
  const [installUrl, setInstallUrl] = useState("");
  const [containerLogs, setContainerLogs] = useState<string | null>(null);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const logsRef = useRef<HTMLDivElement>(null);
  const [activeJob, setActiveJob] = useState<InstallJob | null>(null);
  const [installing, setInstalling] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncResult, setLastSyncResult] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = async () => {
    try {
      const res = await fetch(`/api/integrations/${component}`);
      if (!res.ok) return;
      const data = (await res.json()) as ApiState;
      setState(data);
      setLocalConfig({ ...data.config });
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startJobPolling = (jobId: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/integrations/install-progress/${jobId}`);
        if (!res.ok) return;
        const job = (await res.json()) as InstallJob;
        setActiveJob(job);
        if (job.phase === "done" || job.phase === "error") {
          clearInterval(pollRef.current!);
          setInstalling(false);
          if (job.phase === "done") {
            toast.success(`${title} installato correttamente`);
            await load();
          } else {
            toast.error(`Errore installazione: ${job.error ?? "sconosciuto"}`);
          }
        }
      } catch {
        // ignore
      }
    }, 1500);
  };

  const handleInstall = async () => {
    if (!confirm(`Avviare l'installazione Docker di ${title}? Potrebbe richiedere alcuni minuti.`)) return;
    setInstalling(true);
    setActiveJob(null);
    try {
      const res = await fetch(`/api/integrations/${component}/install`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adminPassword, serverUrl: installUrl || undefined }),
      });
      const data = (await res.json()) as { jobId?: string; error?: string };
      if (!res.ok || !data.jobId) {
        toast.error(data.error ?? "Errore avvio installazione");
        setInstalling(false);
        return;
      }
      startJobPolling(data.jobId);
    } catch {
      toast.error("Errore di rete");
      setInstalling(false);
    }
  };

  const handleAction = async (action: "start" | "stop" | "restart" | "remove" | "remove-all") => {
    if (action === "remove" && !confirm(`Rimuovere il container Docker di ${title}?`)) return;
    if (action === "remove-all" && !confirm(`Eliminare tutti i container Docker di ${title} (incluse dipendenze come database e cache)? I dati non saranno conservati.`)) return;
    try {
      const res = await fetch(`/api/integrations/${component}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (res.ok) {
        toast.success(action === "remove-all" ? "Container eliminati — pronto per una nuova installazione" : `Azione '${action}' eseguita`);
        if (action === "remove-all") {
          // Reset config locale: mode rimane managed ma url/token vengono svuotati
          setLocalConfig((c) => ({ ...c, url: "", apiToken: "" }));
        }
        await load();
      } else {
        toast.error(data.error ?? "Errore");
      }
    } catch {
      toast.error("Errore di rete");
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/integrations/${component}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(localConfig),
      });
      if (res.ok) {
        toast.success("Configurazione salvata");
        await load();
        setReachable(null);
      } else {
        const d = (await res.json()) as { error?: string };
        toast.error(d.error ?? "Errore");
      }
    } catch {
      toast.error("Errore di rete");
    } finally {
      setSaving(false);
    }
  };

  const handleSyncInventory = async () => {
    setSyncing(true);
    setLastSyncResult(null);
    try {
      const res = await fetch("/api/integrations/librenms/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = (await res.json()) as Array<{ networkId: number; added: number; updated: number; skipped: number; errors: string[] }>;
      if (!res.ok) {
        const errData = data as unknown as { error?: string };
        toast.error((errData as { error?: string }).error ?? "Errore sync");
        return;
      }
      const results = Array.isArray(data) ? data : [data];
      const added = results.reduce((s, r) => s + (r.added ?? 0), 0);
      const updated = results.reduce((s, r) => s + (r.updated ?? 0), 0);
      const errors = results.flatMap((r) => r.errors ?? []);
      const msg = `Sync completato: ${added} aggiunti, ${updated} aggiornati${errors.length > 0 ? `, ${errors.length} errori` : ""}`;
      setLastSyncResult(msg);
      if (errors.length > 0) toast.error(msg);
      else toast.success(msg);
    } catch {
      toast.error("Errore di rete durante la sincronizzazione");
    } finally {
      setSyncing(false);
    }
  };

  const handleShowLogs = async () => {
    setLoadingLogs(true);
    try {
      const res = await fetch(`/api/integrations/${component}/logs?lines=200`);
      const d = (await res.json()) as { logs?: string };
      setContainerLogs(d.logs ?? "(nessun output)");
      setTimeout(() => { logsRef.current?.scrollTo(0, logsRef.current.scrollHeight); }, 50);
    } catch {
      setContainerLogs("Errore durante il recupero dei log.");
    } finally {
      setLoadingLogs(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setReachable(null);
    try {
      const res = await fetch(`/api/integrations/${component}/test-connection`);
      const d = (await res.json()) as { reachable: boolean; error?: string };
      setReachable(d.reachable);
      if (d.reachable) toast.success("Connessione riuscita");
      else toast.error(`Non raggiungibile${d.error ? ": " + d.error : ""}`);
    } catch {
      setReachable(false);
      toast.error("Errore di rete");
    } finally {
      setTesting(false);
    }
  };

  const containerRunning = state?.containerStatus?.running ?? false;
  const isManaged = localConfig.mode === "managed";
  const isExternal = localConfig.mode === "external";
  const isDisabled = localConfig.mode === "disabled";

  if (loading) {
    return (
      <Card>
        <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
        <CardContent><Loader2 className="h-4 w-4 animate-spin" /></CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              {title}
              {!isDisabled && (
                reachable === true
                  ? <Wifi className="h-4 w-4 text-green-500" />
                  : reachable === false
                    ? <WifiOff className="h-4 w-4 text-red-500" />
                    : null
              )}
            </CardTitle>
            <CardDescription className="mt-1">{description}</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {isManaged && containerRunning && (
              <Badge variant="default" className="bg-green-500 text-white">In esecuzione</Badge>
            )}
            {isManaged && !containerRunning && state?.containerStatus !== null && (
              <Badge variant="secondary">Fermo</Badge>
            )}
            {isExternal && <Badge variant="outline">Esterno</Badge>}
            {isDisabled && <Badge variant="secondary">Disabilitato</Badge>}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Modalità */}
        <div className="grid grid-cols-3 gap-3">
          <div>
            <Label className="text-xs text-muted-foreground">Modalità</Label>
            <Select
              value={localConfig.mode}
              onValueChange={(v) => setLocalConfig((c) => ({ ...c, mode: v as IntegrationMode }))}
            >
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="disabled">Disabilitato</SelectItem>
                <SelectItem value="managed" disabled={!dockerAvailable}>
                  Docker locale{!dockerAvailable ? " (Docker non disponibile)" : ""}
                </SelectItem>
                <SelectItem value="external">Istanza esterna</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {!isDisabled && (
            <div className="col-span-2">
              <Label className="text-xs text-muted-foreground">
                URL{isManaged ? <span className="ml-1 text-muted-foreground/60">(auto)</span> : ""}
              </Label>
              <Input
                className="mt-1"
                placeholder="http://localhost:8090"
                value={localConfig.url}
                readOnly={isManaged}
                disabled={isManaged && !!localConfig.url}
                onChange={(e) => setLocalConfig((c) => ({ ...c, url: e.target.value }))}
              />
            </div>
          )}
        </div>

        {!isDisabled && (
          <>
            {/* API Token — solo per modalità external; in managed è auto-configurato */}
            {isExternal ? (
              <div>
                <Label className="text-xs text-muted-foreground">API Token</Label>
                <Input
                  className="mt-1"
                  type="password"
                  placeholder="Token o chiave API"
                  value={localConfig.apiToken}
                  onChange={(e) => setLocalConfig((c) => ({ ...c, apiToken: e.target.value }))}
                />
              </div>
            ) : isManaged && localConfig.apiToken ? (
              <div className="flex items-center gap-2 text-xs text-green-600 dark:text-green-400">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                API token configurato automaticamente
              </div>
            ) : null}

            {/* Graylog extra fields — solo external */}
            {component === "graylog" && isExternal && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs text-muted-foreground">Username</Label>
                  <Input
                    className="mt-1"
                    value={localConfig.username ?? ""}
                    onChange={(e) => setLocalConfig((c) => ({ ...c, username: e.target.value }))}
                  />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Password</Label>
                  <Input
                    className="mt-1"
                    type="password"
                    value={localConfig.password ?? ""}
                    onChange={(e) => setLocalConfig((c) => ({ ...c, password: e.target.value }))}
                  />
                </div>
              </div>
            )}

            {/* Container name (managed) */}
            {isManaged && (
              <div>
                <Label className="text-xs text-muted-foreground">Nome container Docker</Label>
                <Input
                  className="mt-1"
                  value={localConfig.containerName ?? ""}
                  onChange={(e) => setLocalConfig((c) => ({ ...c, containerName: e.target.value }))}
                />
              </div>
            )}

            {/* URL di accesso per il prossimo install (managed, librenms/graylog) */}
            {isManaged && !containerRunning && !localConfig.apiToken && (component === "librenms" || component === "graylog") && (
              <div>
                <Label className="text-xs text-muted-foreground">
                  URL di accesso <span className="text-muted-foreground/60">(rilevato automaticamente se vuoto)</span>
                </Label>
                <Input
                  className="mt-1 font-mono text-xs"
                  placeholder={component === "librenms" ? "http://192.168.x.x:8090" : "http://192.168.x.x:9000"}
                  value={installUrl}
                  onChange={(e) => setInstallUrl(e.target.value)}
                />
              </div>
            )}

            {/* Password admin (managed, librenms o graylog) — impostata prima dell'installazione */}
            {isManaged && (component === "librenms" || component === "graylog") && (
              <div>
                <Label className="text-xs text-muted-foreground">
                  Password admin{localConfig.adminPassword ? <span className="ml-1 text-green-600 dark:text-green-400">(impostata)</span> : <span className="ml-1 text-muted-foreground/60">(usata al prossimo install)</span>}
                </Label>
                <div className="relative mt-1">
                  <Input
                    type={showAdminPassword ? "text" : "password"}
                    value={localConfig.adminPassword ?? adminPassword}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (localConfig.adminPassword) {
                        setLocalConfig((c) => ({ ...c, adminPassword: v }));
                      } else {
                        setAdminPassword(v);
                      }
                    }}
                    placeholder="min. 6 caratteri"
                    className="pr-8"
                  />
                  <button
                    type="button"
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    onClick={() => setShowAdminPassword((v) => !v)}
                  >
                    {showAdminPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {/* Log installazione */}
        {activeJob && (
          <div className="rounded-md bg-black/90 text-green-400 font-mono text-xs p-3 max-h-40 overflow-y-auto space-y-0.5">
            <div className="flex items-center gap-2 mb-2 text-white/60">
              {(activeJob.phase !== "done" && activeJob.phase !== "error") && (
                <Loader2 className="h-3 w-3 animate-spin" />
              )}
              {activeJob.phase === "done" && <CheckCircle2 className="h-3 w-3 text-green-400" />}
              {activeJob.phase === "error" && <XCircle className="h-3 w-3 text-red-400" />}
              <span className="capitalize">{activeJob.phase}</span>
            </div>
            {activeJob.log.map((line, i) => (
              <div key={i}>{line}</div>
            ))}
          </div>
        )}

        {/* Log container Docker */}
        {containerLogs !== null && (
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground font-medium">Log container</span>
              <button
                type="button"
                className="text-xs text-muted-foreground hover:text-foreground"
                onClick={() => setContainerLogs(null)}
              >
                Chiudi
              </button>
            </div>
            <div
              ref={logsRef}
              className="rounded-md bg-black/90 text-green-400 font-mono text-[10px] p-3 max-h-60 overflow-y-auto whitespace-pre-wrap break-all"
            >
              {containerLogs}
            </div>
          </div>
        )}

        {/* Ultimo risultato sync */}
        {lastSyncResult && (
          <p className="text-xs text-muted-foreground pt-1">{lastSyncResult}</p>
        )}

        {/* Azioni */}
        <div className="flex flex-wrap gap-2 pt-1">
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
            Salva
          </Button>

          {!isDisabled && (
            <Button size="sm" variant="outline" onClick={handleTest} disabled={testing}>
              {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
              Test connessione
            </Button>
          )}

          {isManaged && containerRunning && (
            <Button size="sm" variant="outline" onClick={handleShowLogs} disabled={loadingLogs}>
              {loadingLogs ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Terminal className="h-3.5 w-3.5 mr-1" />}
              Log
            </Button>
          )}

          {isManaged && dockerAvailable && !installing && !containerRunning && (
            <Button size="sm" variant="outline" onClick={handleInstall}>
              Installa / Reinstalla
            </Button>
          )}

          {isManaged && installing && (
            <Button size="sm" variant="outline" disabled>
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
              Installazione in corso...
            </Button>
          )}

          {isManaged && containerRunning && (
            <>
              <Button size="sm" variant="outline" onClick={() => handleAction("stop")}>
                <Square className="h-3.5 w-3.5 mr-1" />
                Stop
              </Button>
              <Button size="sm" variant="outline" onClick={() => handleAction("restart")}>
                <RotateCcw className="h-3.5 w-3.5 mr-1" />
                Restart
              </Button>
            </>
          )}

          {isManaged && !containerRunning && state?.containerStatus !== null && !installing && (
            <Button size="sm" variant="outline" onClick={() => handleAction("start")}>
              <Play className="h-3.5 w-3.5 mr-1" />
              Avvia
            </Button>
          )}

          {isManaged && !installing && (
            <>
              {state?.containerStatus !== null && (
                <Button size="sm" variant="ghost" className="text-red-400 hover:text-red-500" onClick={() => handleAction("remove")}>
                  <Trash2 className="h-3.5 w-3.5 mr-1" />
                  Rimuovi container
                </Button>
              )}
              <Button size="sm" variant="ghost" className="text-red-600 hover:text-red-700 font-medium" onClick={() => handleAction("remove-all")}>
                <Trash2 className="h-3.5 w-3.5 mr-1" />
                Elimina tutto e ricrea
              </Button>
            </>
          )}

          {showSyncButton && !isDisabled && (
            <Button size="sm" variant="outline" onClick={handleSyncInventory} disabled={syncing}>
              {syncing
                ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                : <RefreshCw className="h-3.5 w-3.5 mr-1" />}
              Sincronizza inventario
            </Button>
          )}

          {!isDisabled && localConfig.url && (
            <a
              href={localConfig.url}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Apri
            </a>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
