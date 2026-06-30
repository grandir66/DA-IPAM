"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Loader2,
  PackageOpen,
  CheckCircle2,
  AlertTriangle,
  ServerCog,
  Trash2,
  Shield,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { IntegrationCard } from "./integration-card";
import { ScannerEdgeCard } from "./scanner-edge-card";
import { WazuhCard } from "./wazuh-card";
import { InventoryAgentCard } from "./inventory-agent-card";
import { MeshCentralCard } from "./meshcentral-card";
import { Nis2ToggleCard } from "./nis2-toggle-card";
import { ModuleJsonImport } from "./module-json-import";
import { IntegrationViewer } from "@/components/integrations/integration-viewer";
import { CredentialsVaultPanel } from "./credentials-vault-panel";
import type { InstallJob } from "@/lib/integrations/types";
import type { ModuleKey } from "@/lib/modules/registry";

interface FeatureEntry {
  key: string;
  title: string;
  description: string;
  status: "installed" | "not_installed";
  enabledAt: string | null;
  enabledBy: number | null;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("it-IT");
  } catch {
    return iso;
  }
}

/** Header di sezione modulo con anchor + mini import JSON dedicato. */
function ModuleSection({
  id,
  moduleKey,
  title,
  children,
}: {
  id: string;
  moduleKey?: ModuleKey;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          {title}
        </h3>
        {moduleKey && <ModuleJsonImport presetModule={moduleKey} size="sm" />}
      </div>
      {children}
    </section>
  );
}

export function ModulesTab({ isAdmin }: { isAdmin: boolean }) {
  // ── Deep-link scroll (#module-<key> con fallback #int-<x>) ──────────
  useEffect(() => {
    if (typeof window === "undefined") return;
    const hash = window.location.hash;
    if (!hash || (!hash.startsWith("#module-") && !hash.startsWith("#int-"))) return;
    const targetId = hash.slice(1);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const el =
          document.getElementById(targetId) ??
          document.getElementById(targetId.replace(/^int-/, "module-")) ??
          document.getElementById(targetId.replace(/^module-/, "int-"));
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "start" });
          el.classList.add("ring-2", "ring-primary", "ring-offset-2");
          setTimeout(
            () => el.classList.remove("ring-2", "ring-primary", "ring-offset-2"),
            2200,
          );
        }
      });
    });
  }, []);

  // ── Docker availability (per le integrazioni Docker-managed) ───────
  const [dockerAvailable, setDockerAvailable] = useState<boolean | null>(null);
  const [installingDocker, setInstallingDocker] = useState(false);
  const [dockerInstallJob, setDockerInstallJob] = useState<InstallJob | null>(null);
  const dockerPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const checkDocker = useCallback(() => {
    fetch("/api/integrations/docker-status")
      .then((r) => r.json())
      .then((d: { available: boolean }) => setDockerAvailable(d.available))
      .catch(() => setDockerAvailable(false));
  }, []);

  useEffect(() => {
    checkDocker();
    return () => {
      if (dockerPollRef.current) clearInterval(dockerPollRef.current);
    };
  }, [checkDocker]);

  const handleInstallDocker = async () => {
    setInstallingDocker(true);
    setDockerInstallJob(null);
    try {
      const res = await fetch("/api/integrations/install-docker", { method: "POST" });
      const data = (await res.json()) as { jobId?: string; error?: string };
      if (!res.ok || !data.jobId) {
        toast.error(data.error ?? "Errore avvio installazione Docker");
        setInstallingDocker(false);
        return;
      }
      const jobId = data.jobId;
      if (dockerPollRef.current) clearInterval(dockerPollRef.current);
      dockerPollRef.current = setInterval(async () => {
        try {
          const r = await fetch(`/api/integrations/install-progress/${jobId}`);
          if (!r.ok) return;
          const job = (await r.json()) as InstallJob;
          setDockerInstallJob(job);
          if (job.phase === "done" || job.phase === "error") {
            clearInterval(dockerPollRef.current!);
            setInstallingDocker(false);
            if (job.phase === "done") {
              toast.success("Docker installato — ricarica la pagina");
              checkDocker();
            } else {
              toast.error(`Errore installazione Docker: ${job.error ?? "sconosciuto"}`);
            }
          }
        } catch {
          /* ignore */
        }
      }, 1500);
    } catch {
      toast.error("Errore di rete");
      setInstallingDocker(false);
    }
  };

  // ── Patch Management (feature install/uninstall) ───────────────────
  const [features, setFeatures] = useState<FeatureEntry[]>([]);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [uninstallDialog, setUninstallDialog] = useState<{
    open: boolean;
    feature: FeatureEntry | null;
    dropData: boolean;
  }>({ open: false, feature: null, dropData: false });

  const fetchFeatures = useCallback(async () => {
    try {
      const r = await fetch("/api/features", { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = (await r.json()) as { features: FeatureEntry[] };
      setFeatures(data.features ?? []);
    } catch {
      toast.error("Errore nel recupero dei moduli opzionali");
    }
  }, []);

  useEffect(() => {
    void fetchFeatures();
  }, [fetchFeatures]);

  const patch = features.find((f) => f.key === "patch_management");
  const inventoryAgent = features.find((f) => f.key === "inventory_agent");
  const meshcentral = features.find((f) => f.key === "meshcentral");

  const handleInstallPatch = async () => {
    setBusyKey("patch_management");
    try {
      const r = await fetch("/api/features/patch_management/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!r.ok) {
        const err = (await r.json().catch(() => null)) as { error?: string } | null;
        throw new Error(err?.error ?? `HTTP ${r.status}`);
      }
      toast.success("Modulo Patch Management installato");
      await fetchFeatures();
    } catch (e) {
      toast.error(`Installazione fallita: ${e instanceof Error ? e.message : "errore"}`);
    } finally {
      setBusyKey(null);
    }
  };

  const handleInstallInventoryAgent = async () => {
    setBusyKey("inventory_agent");
    try {
      const r = await fetch("/api/features/inventory_agent/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!r.ok) {
        const err = (await r.json().catch(() => null)) as { error?: string } | null;
        throw new Error(err?.error ?? `HTTP ${r.status}`);
      }
      toast.success("Modulo Inventory Agent installato");
      await fetchFeatures();
    } catch (e) {
      toast.error(`Installazione fallita: ${e instanceof Error ? e.message : "errore"}`);
    } finally {
      setBusyKey(null);
    }
  };

  const handleInstallMesh = async () => {
    setBusyKey("meshcentral");
    try {
      const r = await fetch("/api/features/meshcentral/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!r.ok) {
        const err = (await r.json().catch(() => null)) as { error?: string } | null;
        throw new Error(err?.error ?? `HTTP ${r.status}`);
      }
      toast.success("Modulo MeshCentral installato");
      await fetchFeatures();
    } catch (e) {
      toast.error(`Installazione fallita: ${e instanceof Error ? e.message : "errore"}`);
    } finally {
      setBusyKey(null);
    }
  };

  const handleUninstallConfirm = async () => {
    const feature = uninstallDialog.feature;
    if (!feature) return;
    setBusyKey(feature.key);
    try {
      const r = await fetch(`/api/features/${feature.key}/uninstall`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dropData: uninstallDialog.dropData }),
      });
      if (!r.ok) {
        const err = (await r.json().catch(() => null)) as { error?: string } | null;
        throw new Error(err?.error ?? `HTTP ${r.status}`);
      }
      toast.success(`Modulo "${feature.title}" disinstallato`);
      setUninstallDialog({ open: false, feature: null, dropData: false });
      await fetchFeatures();
    } catch (e) {
      toast.error(`Disinstallazione fallita: ${e instanceof Error ? e.message : "errore"}`);
    } finally {
      setBusyKey(null);
    }
  };

  const patchInstalled = patch?.status === "installed";
  const patchBusy = busyKey === "patch_management";
  const inventoryInstalled = inventoryAgent?.status === "installed";
  const inventoryBusy = busyKey === "inventory_agent";
  const meshInstalled = meshcentral?.status === "installed";
  const meshBusy = busyKey === "meshcentral";

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <PackageOpen className="h-5 w-5" />
            Moduli
          </h2>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Configurazione unica dei moduli dell&apos;appliance. Importa il JSON generato
            dall&apos;installer di un modulo per configurarlo in un colpo solo, oppure usa
            le form qui sotto. I moduli nativi (edge, patch, network) si gestiscono dentro
            DA-IPAM; LibreNMS, Graylog e Wazuh aprono la dashboard esterna.
          </p>
        </div>
        <div className="shrink-0">
          <ModuleJsonImport />
        </div>
      </div>

      {/* ════ Moduli nativi ════ */}
      <ModuleSection id="module-edge" moduleKey="edge" title="Scanner-Edge — Vulnerability Assessment">
        <ScannerEdgeCard />
      </ModuleSection>

      <ModuleSection
        id="module-patch_management"
        moduleKey="patch_management"
        title="Patch Management"
      >
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle className="flex items-center gap-2">
                  {patch?.title ?? "Patch Management CVE-driven"}
                  {patchInstalled ? (
                    <Badge variant="default" className="bg-emerald-600">
                      <CheckCircle2 className="h-3 w-3 mr-1" />
                      Installato
                    </Badge>
                  ) : (
                    <Badge variant="secondary">Non installato</Badge>
                  )}
                </CardTitle>
                <CardDescription className="mt-1">
                  {patch?.description ??
                    "Patching Windows guidato dal rischio CVE (Chocolatey via WinRM)."}
                </CardDescription>
              </div>
              <div className="shrink-0">
                {patchInstalled ? (
                  <Button
                    variant="outline"
                    disabled={patchBusy}
                    onClick={() =>
                      patch &&
                      setUninstallDialog({ open: true, feature: patch, dropData: false })
                    }
                  >
                    {patchBusy && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                    Disinstalla…
                  </Button>
                ) : (
                  <Button disabled={patchBusy || !isAdmin} onClick={handleInstallPatch}>
                    {patchBusy && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                    Installa modulo
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>
          {patchInstalled && (
            <CardContent className="text-xs text-muted-foreground">
              Installato il {formatDate(patch?.enabledAt ?? null)}
              {patch?.enabledBy != null && <> da user #{patch.enabledBy}</>}
            </CardContent>
          )}
        </Card>
      </ModuleSection>

      <ModuleSection
        id="module-inventory_agent"
        title="Inventory Agent"
      >
        <InventoryAgentCard
          isAdmin={isAdmin}
          installed={inventoryInstalled}
          installBusy={inventoryBusy}
          onInstall={handleInstallInventoryAgent}
          onUninstall={() =>
            inventoryAgent &&
            setUninstallDialog({ open: true, feature: inventoryAgent, dropData: false })
          }
        />
      </ModuleSection>

      <ModuleSection
        id="module-meshcentral"
        title="MeshCentral — Controllo remoto"
      >
        <MeshCentralCard
          isAdmin={isAdmin}
          installed={meshInstalled}
          installBusy={meshBusy}
          onInstall={handleInstallMesh}
          onUninstall={() =>
            meshcentral &&
            setUninstallDialog({ open: true, feature: meshcentral, dropData: false })
          }
        />
      </ModuleSection>

      <ModuleSection id="module-nis2_inventory" title="Inventario NIS2">
        <Nis2ToggleCard isAdmin={isAdmin} />
      </ModuleSection>

      <ModuleSection
        id="module-network_services"
        moduleKey="network_services"
        title="Network Services — DNS / DHCP / AdGuard / Unbound"
      >
        <NetServicesConfigCard isAdmin={isAdmin} />
      </ModuleSection>

      <Separator />

      {/* ════ Integrazioni a dashboard esterna ════ */}
      <div>
        <h3 className="text-base font-semibold">Integrazioni esterne</h3>
        <p className="text-xs text-muted-foreground mt-1">
          Monitoring e log management con dashboard propria. Configura la connessione qui;
          l&apos;accesso avviene dalla Launchpad.
        </p>
      </div>

      {dockerAvailable === false && (
        <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/20 px-4 py-3 text-sm text-amber-900 dark:text-amber-300 space-y-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <span className="font-medium">Docker non trovato su questo host.</span>
          </div>
          <div className="flex items-center gap-3">
            <Button
              size="sm"
              onClick={handleInstallDocker}
              disabled={installingDocker || !isAdmin}
              className="bg-amber-600 hover:bg-amber-700 text-white"
            >
              {installingDocker ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                  Installazione in corso...
                </>
              ) : (
                "Installa Docker automaticamente"
              )}
            </Button>
            <span className="text-xs text-amber-700 dark:text-amber-400">
              Oppure installa manualmente e ricarica la pagina
            </span>
          </div>
          {dockerInstallJob && (
            <div className="rounded-md bg-black/90 text-green-400 font-mono text-xs p-3 max-h-36 overflow-y-auto space-y-0.5">
              <div className="flex items-center gap-2 mb-1 text-white/60">
                {dockerInstallJob.phase !== "done" &&
                  dockerInstallJob.phase !== "error" && (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  )}
                <span className="capitalize">{dockerInstallJob.phase}</span>
              </div>
              {dockerInstallJob.log.map((line, i) => (
                <div key={i}>{line}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {dockerAvailable === true && (
        <div className="flex items-start gap-2 rounded-md border border-green-300 bg-green-50 dark:bg-green-950/20 px-4 py-3 text-sm text-green-800 dark:text-green-300">
          <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0 text-green-500" />
          <span>Docker disponibile — l&apos;installazione automatizzata è abilitata.</span>
        </div>
      )}

      <ModuleSection id="module-librenms" moduleKey="librenms" title="LibreNMS">
        <IntegrationCard
          component="librenms"
          title="LibreNMS"
          description="Monitoring SNMP e metriche di rete. I grafici device sono embeddati in DA-IPAM; la dashboard completa si apre dal Launchpad o da qui."
          dockerAvailable={dockerAvailable ?? false}
          showSyncButton
        />
      </ModuleSection>

      <ModuleSection id="module-graylog" moduleKey="graylog" title="Graylog">
        <IntegrationCard
          component="graylog"
          title="Graylog"
          description="Log management completo (Windows/Linux/network)."
          dockerAvailable={dockerAvailable ?? false}
        />
      </ModuleSection>

      <ModuleSection id="module-wazuh" moduleKey="wazuh" title="Wazuh SIEM">
        <WazuhCard />
      </ModuleSection>

      <Separator />

      {/* ════ Integrazioni secondarie ════ */}
      <div>
        <h3 className="text-sm font-semibold text-muted-foreground">
          Integrazioni secondarie
        </h3>
      </div>
      <section id="module-loki" className="scroll-mt-24">
        <div id="int-loki" />
        <IntegrationCard
          component="loki"
          title="Grafana Loki"
          description="Log management leggero (~512MB RAM). Raccolta syslog da device di rete e Linux."
          dockerAvailable={dockerAvailable ?? false}
        />
      </section>

      <IntegrationViewer />

      <CredentialsVaultPanel isAdmin={isAdmin} />

      <Dialog
        open={uninstallDialog.open}
        onOpenChange={(open) => {
          if (!open) setUninstallDialog({ open: false, feature: null, dropData: false });
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Disinstalla modulo?</DialogTitle>
            <DialogDescription>
              La voce di menu sparirà e gli endpoint del modulo torneranno 404. I dati
              storici restano nel DB tenant (salvo richiesta esplicita).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <label className="flex items-start gap-2 text-sm cursor-pointer">
              <Checkbox
                checked={uninstallDialog.dropData}
                onCheckedChange={(v) =>
                  setUninstallDialog((prev) => ({ ...prev, dropData: v === true }))
                }
              />
              <span>
                Elimina anche i dati storici del modulo
                <span className="block text-xs text-muted-foreground">
                  (richiede F1 — al momento il flag viene accettato ma non droppa).
                </span>
              </span>
            </label>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() =>
                setUninstallDialog({ open: false, feature: null, dropData: false })
              }
            >
              Annulla
            </Button>
            <Button
              variant="destructive"
              disabled={busyKey !== null}
              onClick={handleUninstallConfirm}
            >
              {busyKey !== null && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Disinstalla
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Config compatta Network Services (riusa /api/network-services/setup). */
function NetServicesConfigCard({ isAdmin }: { isAdmin: boolean }) {
  const router = useRouter();
  const [state, setState] = useState<{
    installed: boolean;
    configured: boolean;
    apiUrl: string;
    hasToken: boolean;
  } | null>(null);
  const [apiUrl, setApiUrl] = useState("https://192.168.99.52:8443");
  const [apiToken, setApiToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);

  const load = useCallback(() => {
    fetch("/api/network-services/setup")
      .then((r) => (r.ok ? r.json() : null))
      .then(
        (d: { installed: boolean; configured: boolean; apiUrl: string; hasToken: boolean } | null) => {
          if (d) {
            setState(d);
            if (d.apiUrl) setApiUrl(d.apiUrl);
          } else {
            setState({ installed: false, configured: false, apiUrl: "", hasToken: false });
          }
        },
      )
      .catch(() =>
        setState({ installed: false, configured: false, apiUrl: "", hasToken: false }),
      );
  }, []);

  useEffect(() => load(), [load]);

  async function testConnection() {
    setTesting(true);
    try {
      const r = await fetch("/api/network-services/test-connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiUrl, apiToken: apiToken || undefined }),
      });
      const d = (await r.json()) as { ok: boolean; error?: string; message?: string };
      if (d.ok) toast.success(d.message ?? "Bridge raggiungibile");
      else toast.error(d.error ?? "Test fallito");
    } catch (e) {
      toast.error(`Errore: ${e instanceof Error ? e.message : "rete"}`);
    } finally {
      setTesting(false);
    }
  }

  async function install() {
    if (!apiUrl || !apiToken) {
      toast.error("Inserisci URL e token");
      return;
    }
    setBusy(true);
    try {
      const r = await fetch("/api/network-services/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiUrl, apiToken }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error ?? r.statusText);
      toast.success(d.message ?? "Modulo installato");
      setApiToken("");
      load();
      router.refresh();
    } catch (e) {
      toast.error(`Install fallita: ${e instanceof Error ? e.message : "errore"}`);
    } finally {
      setBusy(false);
    }
  }

  async function uninstall() {
    if (!confirm("Disinstallare il modulo Network Services? La config verrà rimossa.")) return;
    setBusy(true);
    try {
      const r = await fetch("/api/network-services/setup", { method: "DELETE" });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error ?? r.statusText);
      toast.success(d.message ?? "Modulo disinstallato");
      load();
      router.refresh();
    } catch (e) {
      toast.error(`Disinstall fallita: ${e instanceof Error ? e.message : "errore"}`);
    } finally {
      setBusy(false);
    }
  }

  const configured = state?.configured ?? false;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <ServerCog className="h-4 w-4" />
              Network Services bridge
              {configured ? (
                <Badge variant="default" className="bg-emerald-600">
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  Configurato
                </Badge>
              ) : (
                <Badge variant="secondary">Non configurato</Badge>
              )}
            </CardTitle>
            <CardDescription className="mt-1">
              Bridge FastAPI (Unbound/AdGuard/PowerDNS/Kea). Gestione DNS/DHCP nativa in{" "}
              <a className="underline" href="/network-services">
                /network-services
              </a>
              .
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!isAdmin ? (
          <p className="text-sm text-muted-foreground">
            Solo un amministratore può configurare questo modulo.
          </p>
        ) : configured ? (
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm text-muted-foreground">
              Bridge corrente: <code>{state?.apiUrl}</code>
            </p>
            <Button variant="destructive" size="sm" disabled={busy} onClick={uninstall}>
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Trash2 className="h-4 w-4 mr-2" />
              )}
              Disinstalla
            </Button>
          </div>
        ) : (
          <>
            <div className="space-y-2">
              <Label htmlFor="ns-url">URL bridge (HTTPS)</Label>
              <Input
                id="ns-url"
                type="url"
                placeholder="https://192.168.99.52:8443"
                value={apiUrl}
                onChange={(e) => setApiUrl(e.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ns-token">Bearer token</Label>
              <Input
                id="ns-token"
                type="password"
                placeholder="token bridge"
                value={apiToken}
                onChange={(e) => setApiToken(e.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={testConnection} disabled={testing || !apiUrl}>
                {testing ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Shield className="h-4 w-4 mr-2" />
                )}
                Test connessione
              </Button>
              <Button onClick={install} disabled={busy || !apiUrl || !apiToken}>
                {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Installa modulo
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
