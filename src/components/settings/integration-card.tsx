"use client";

import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Play, Square, RotateCcw, Trash2, CheckCircle2, XCircle, Loader2, ExternalLink, Wifi, WifiOff, RefreshCw, Eye, EyeOff, Terminal, AlertTriangle } from "lucide-react";
import type { ContainerIntegrationComponent, IntegrationMode, ComponentConfig, ContainerStatus } from "@/lib/integrations/types";
import { fetchJson } from "@/lib/fetch-json";
import { LoadError } from "@/components/shared/load-error";
import { useJobPolling } from "@/hooks/use-job-polling";
import type { PassoPolling } from "@/lib/integrations/polling-job";
import { containerRemovalConfirmText } from "@/lib/modules/uninstall-copy";
import type { ConfigIntegrazioneVista } from "@/lib/permessi/politica";
import {
  ETICHETTA_APPLIANCE,
  mostraConversione,
  vistaScheda,
  vociModalita,
} from "@/lib/integrations/scheda-integrazione";
import { CONFERMA_CONVERSIONE_LIBRENMS } from "@/lib/integrations/librenms-modo";

interface Props {
  /** Solo i componenti installati come container: UniFi ha la sua pagina (Controller di rete). */
  component: ContainerIntegrationComponent;
  title: string;
  description: string;
  dockerAvailable: boolean;
  /** Mostra bottone "Sincronizza inventario" (solo LibreNMS) */
  showSyncButton?: boolean;
}

interface ApiState {
  /** Per chi non è admin i segreti arrivano vuoti, con i flag «impostato». */
  config: ConfigIntegrazioneVista;
  containerStatus: ContainerStatus | null;
  browserUrl?: string;
  /** LibreNMS messo in Docker dall'installatore dell'appliance (contenitore appliance-librenms). */
  installatoDallAppliance?: boolean;
}

export function IntegrationCard({ component, title, description, dockerAvailable, showSyncButton }: Props) {
  const [state, setState] = useState<ApiState | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
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

  // Password per il PROSSIMO install (separata da localConfig che riflette l'installazione salvata)
  const [installAdminPassword, setInstallAdminPassword] = useState("admin");
  const [showAdminPassword, setShowAdminPassword] = useState(false);
  const [installUrl, setInstallUrl] = useState("");
  const [containerLogs, setContainerLogs] = useState<string | null>(null);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const logsRef = useRef<HTMLDivElement>(null);
  const [installing, setInstalling] = useState(false);
  const [browserUrl, setBrowserUrl] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [converting, setConverting] = useState(false);
  const [lastSyncResult, setLastSyncResult] = useState<string | null>(null);

  const load = async () => {
    const r = await fetchJson<ApiState>(`/api/integrations/${component}`);
    setLoading(false);
    if (!r.ok) {
      // Mai la scheda «Disabilitato» al posto di un errore: si dice cosa non va.
      setLoadError(r.message);
      return;
    }
    const data = r.data;
    setLoadError(null);
    setState(data);
    setLocalConfig({
      ...data.config,
      uiUrl: data.config.uiUrl || data.config.browserUrl || data.browserUrl || "",
    });
    setBrowserUrl(data.config.browserUrl ?? data.browserUrl ?? "");
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onFineJob = (passo: PassoPolling) => {
    setInstalling(false);
    if (passo.esito === "finito" && passo.job) {
      if (passo.job.phase === "done") {
        toast.success(`${title} installato correttamente`);
        void load();
      } else {
        toast.error(`Errore installazione: ${passo.job.error ?? "sconosciuto"}`);
      }
      return;
    }
    // Fermo senza esito: il messaggio resta anche accanto al log.
    if (passo.messaggio) toast.error(passo.messaggio);
    if (passo.esito === "esito_sconosciuto") void load();
  };
  const { job: activeJob, avviso: jobAvviso, attivo: jobAttivo, avvia: startJobPolling } = useJobPolling(onFineJob);

  const handleInstall = async () => {
    if (!confirm(`Avviare l'installazione Docker di ${title}? Potrebbe richiedere alcuni minuti.`)) return;
    setInstalling(true);
    try {
      const r = await fetchJson<{ jobId?: string }>(`/api/integrations/${component}/install`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adminPassword: installAdminPassword, serverUrl: installUrl || undefined }),
      });
      if (!r.ok || !r.data.jobId) {
        toast.error(r.ok ? "Errore avvio installazione" : r.message);
        setInstalling(false);
        return;
      }
      startJobPolling(r.data.jobId);
    } catch {
      toast.error("Errore di rete");
      setInstalling(false);
    }
  };

  const handleAction = async (action: "start" | "stop" | "restart" | "remove" | "remove-all") => {
    // MOD-19: la conferma dice cosa si perde (testi in lib/modules/uninstall-copy).
    if (
      (action === "remove" || action === "remove-all") &&
      !confirm(containerRemovalConfirmText(component, title, action))
    ) {
      return;
    }
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

  // Passo 5: «Istanza esterna» → «Installato dall'appliance», solo su richiesta
  // esplicita e dopo la conferma; nessuna riga si converte da sola.
  const handleConverti = async () => {
    if (!confirm(CONFERMA_CONVERSIONE_LIBRENMS)) return;
    setConverting(true);
    try {
      const res = await fetch("/api/integrations/librenms/converti", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conferma: true }),
      });
      const d = (await res.json().catch(() => null)) as { error?: string } | null;
      if (res.ok) {
        toast.success("LibreNMS convertito in «Installato dall'appliance»");
        await load();
      } else {
        toast.error(`Conversione non riuscita: ${d?.error ?? `errore ${res.status}`}`);
      }
    } catch {
      toast.error("Errore di rete");
    } finally {
      setConverting(false);
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

  const handleShowLogs = async (source: "docker" | "app" = "docker") => {
    setLoadingLogs(true);
    try {
      const res = await fetch(`/api/integrations/${component}/logs?lines=200&source=${source}`);
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
  // Il valore c'è per l'admin; per chi non lo vede resta il flag «impostato».
  const apiTokenImpostato = !!localConfig.apiToken || !!state?.config.apiTokenSet;
  const adminPasswordImpostata = !!localConfig.adminPassword || !!state?.config.adminPasswordSet;
  const isExternal = localConfig.mode === "external";
  const isAppliance = localConfig.mode === "appliance";
  // URL e token si scrivono a mano per un'istanza esterna e per quella dell'appliance.
  const tokenAMano = isExternal || isAppliance;
  const isDisabled = localConfig.mode === "disabled";
  const vista = vistaScheda({
    dallAppliance: state?.installatoDallAppliance === true,
    dockerAvailable,
    managed: isManaged,
    installing,
    containerRunning,
  });
  const modoSalvato = state?.config.mode ?? null;
  const voci = vociModalita(component, modoSalvato, vista);
  const proponiConversione = mostraConversione(component, modoSalvato);

  if (loading) {
    return (
      <Card id={`int-${component}`} data-integration-anchor={component} className="scroll-mt-20">
        <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
        <CardContent><Loader2 className="h-4 w-4 animate-spin" /></CardContent>
      </Card>
    );
  }

  if (loadError && !state) {
    return (
      <div id={`int-${component}`} data-integration-anchor={component} className="scroll-mt-20">
        <LoadError
          what={`la configurazione di ${title}`}
          message={loadError}
          onRetry={() => { setLoading(true); void load(); }}
        />
      </div>
    );
  }

  return (
    <Card id={`int-${component}`} data-integration-anchor={component} className="scroll-mt-20">
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
            {isExternal && <Badge variant="outline">{vista.badgeEsterno}</Badge>}
            {isAppliance && <Badge variant="outline">{ETICHETTA_APPLIANCE}</Badge>}
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
              items={voci.map((v) => ({ value: v.value, label: v.label }))}
              onValueChange={(v) => setLocalConfig((c) => ({ ...c, mode: v as IntegrationMode }))}
            >
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {voci.map((v) => (
                  <SelectItem key={v.value} value={v.value} disabled={v.disabled}>
                    {v.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {!isDisabled && (
            <>
              <div className="col-span-2">
                <Label className="text-xs text-muted-foreground">
                  URL API (backend)
                  {isManaged ? <span className="ml-1 text-muted-foreground/60">(auto)</span> : null}
                </Label>
                <Input
                  className="mt-1 font-mono text-xs"
                  placeholder="http://127.0.0.1:8000"
                  value={localConfig.url}
                  readOnly={isManaged}
                  disabled={isManaged && !!localConfig.url}
                  onChange={(e) => setLocalConfig((c) => ({ ...c, url: e.target.value }))}
                />
                <p className="text-[10px] text-muted-foreground mt-1">
                  Solo per sync server-side. Non aprire dal browser se è loopback o hostname Docker.
                </p>
              </div>
              <div className="col-span-2">
                <Label className="text-xs text-muted-foreground">URL dashboard (browser)</Label>
                <Input
                  className="mt-1 font-mono text-xs"
                  placeholder="https://192.168.x.y:7443"
                  value={localConfig.uiUrl ?? ""}
                  onChange={(e) => setLocalConfig((c) => ({ ...c, uiUrl: e.target.value }))}
                />
                <p className="text-[10px] text-muted-foreground mt-1">
                  Link per Apri / Launchpad. Se vuoto, viene derivato da env o proxy IPAM.
                </p>
              </div>
            </>
          )}
        </div>

        {!isDisabled && (
          <>
            {/* API Token — external e appliance; in managed è auto-configurato */}
            {tokenAMano ? (
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
            ) : isManaged && apiTokenImpostato ? (
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
            {isManaged && !containerRunning && !apiTokenImpostato && (component === "librenms" || component === "graylog") && (
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

            {/* Password admin (managed, librenms o graylog) */}
            {isManaged && (component === "librenms" || component === "graylog") && (
              <div>
                <Label className="text-xs text-muted-foreground">
                  Password admin — prossimo install
                  {adminPasswordImpostata && (
                    <span className="ml-2 text-green-600 dark:text-green-400">
                      {localConfig.adminPassword ? `(attuale: ${localConfig.adminPassword})` : "(impostata)"}
                    </span>
                  )}
                </Label>
                <div className="relative mt-1">
                  <Input
                    type={showAdminPassword ? "text" : "password"}
                    value={installAdminPassword}
                    onChange={(e) => setInstallAdminPassword(e.target.value)}
                    placeholder="vuota = generata (min. 6 caratteri)"
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

        {/* Ricaricamento fallito con dati vecchi a schermo: lo si dice. */}
        {loadError && state && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>Dati non aggiornati: {loadError}</span>
          </div>
        )}

        {/* Avanzamento non leggibile o controllo fermo: mai una rotellina muta. */}
        {jobAvviso && (
          <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/20 px-3 py-2 text-xs text-amber-900 dark:text-amber-300">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>{jobAvviso}</span>
          </div>
        )}

        {/* Passo 5: LibreNMS è solo locale; una riga «external» si converte solo da qui. */}
        {proponiConversione && (
          <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/20 px-3 py-2 text-sm text-amber-900 dark:text-amber-300 space-y-2">
            <p>
              Questa configurazione è «Istanza esterna», una modalità che per LibreNMS non si
              sceglie più: LibreNMS è solo locale. Continua a funzionare com&apos;è; se è il
              LibreNMS installato dall&apos;appliance, convertila.
            </p>
            <Button size="sm" variant="outline" onClick={() => void handleConverti()} disabled={converting}>
              {converting ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
              Converti in «{ETICHETTA_APPLIANCE}»…
            </Button>
          </div>
        )}

        {/* Log installazione */}
        {activeJob && (
          <div className="rounded-md bg-black/90 text-green-400 font-mono text-xs p-3 max-h-40 overflow-y-auto space-y-0.5">
            <div className="flex items-center gap-2 mb-2 text-white/60">
              {(activeJob.phase !== "done" && activeJob.phase !== "error") && (
                jobAttivo
                  ? <Loader2 className="h-3 w-3 animate-spin" />
                  : <AlertTriangle className="h-3 w-3 text-amber-400" />
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
            <>
              <Button size="sm" variant="outline" onClick={() => handleShowLogs("docker")} disabled={loadingLogs}>
                {loadingLogs ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Terminal className="h-3.5 w-3.5 mr-1" />}
                Log container
              </Button>
              {component === "librenms" && (
                <Button size="sm" variant="outline" onClick={() => handleShowLogs("app")} disabled={loadingLogs}>
                  {loadingLogs ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Terminal className="h-3.5 w-3.5 mr-1" />}
                  librenms.log
                </Button>
              )}
            </>
          )}

          {vista.mostraInstalla && (
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

          {!isDisabled && (browserUrl || localConfig.uiUrl) && (
            <a
              href={localConfig.uiUrl || browserUrl}
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
