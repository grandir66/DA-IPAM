"use client";
import { parseDbDate } from "@/lib/db-date";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import Link from "next/link";
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
  ArrowLeft,
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
import { MeshCentralInstallDialog } from "./meshcentral-install-dialog";
import { Nis2ToggleCard } from "./nis2-toggle-card";
import { ZabbixLetturaCard } from "./zabbix-lettura-card";
import { ModuleJsonImport } from "./module-json-import";
import { IntegrationViewer } from "@/components/integrations/integration-viewer";
import { VerificaModulo } from "@/components/integrations/apertura-browser";
import { ElencoModuli } from "@/components/settings/elenco-moduli";
import { InterruttoreSenzaAgente } from "@/components/settings/interruttore-senza-agente";
import { CredentialsVaultPanel } from "./credentials-vault-panel";
import { fetchJson } from "@/lib/fetch-json";
import { LoadError } from "@/components/shared/load-error";
import { useJobPolling } from "@/hooks/use-job-polling";
import type { PassoPolling } from "@/lib/integrations/polling-job";
import type { ModuleKey } from "@/lib/modules/registry";
import { ETICHETTA_OPZIONE, OFFERTA_MODULO, OFFERTA_PANNELLO_ZABBIX } from "@/lib/modules/offerta";
import {
  UNINSTALL_COPY,
  isUninstallableFeature,
  netServicesUninstallConfirmText,
  NET_SERVICES_ENV_NOTE,
} from "@/lib/modules/uninstall-copy";

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
    return parseDbDate(iso).toLocaleString("it-IT");
  } catch {
    return iso;
  }
}

/**
 * Analisi del 19/10 (F10, approvato da Riccardo): la scheda Moduli mostrava insieme
 * configurazione, installazione, salute, certificati e vault di tutti i moduli (49
 * pulsanti). Ora la scheda è un elenco (`ElencoModuli`) e ogni modulo ha la sua pagina
 * `/settings/moduli/<chiave>`, che monta questo stesso componente con `solo`: ogni
 * sezione si mostra solo nella pagina del suo modulo.
 */
const SoloModulo = createContext<string | undefined>(undefined);

/** Le pagine con Docker in vista: le integrazioni a dashboard esterna. */
const CON_DOCKER = new Set(["librenms", "graylog", "wazuh", "loki"]);

/** Header di sezione modulo con anchor + mini import JSON dedicato. */
function ModuleSection({
  id,
  moduleKey,
  offertaDi,
  opzioneFuoriCatalogo,
  title,
  children,
}: {
  id: string;
  moduleKey?: ModuleKey;
  /** Voce del catalogo da cui leggere l'offerta (passo 4c), se diversa o senza import JSON. */
  offertaDi?: ModuleKey;
  /** Opzione che non sta nel catalogo dei moduli (pannello Zabbix, passo 7.4). */
  opzioneFuoriCatalogo?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  const solo = useContext(SoloModulo);
  const chiave = offertaDi ?? moduleKey;
  if (solo !== id.replace(/^module-/, "")) return null;
  const opzione = opzioneFuoriCatalogo === true || (chiave !== undefined && OFFERTA_MODULO[chiave] === "opzione");
  return (
    <section id={id} className="scroll-mt-24 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-2">
          {title}
          {opzione && (
            <Badge
              variant="secondary"
              className="normal-case tracking-normal"
              title="Modulo opzionale, potenzialmente a pagamento"
            >
              {ETICHETTA_OPZIONE}
            </Badge>
          )}
        </h3>
        {moduleKey && <ModuleJsonImport presetModule={moduleKey} size="sm" />}
      </div>
      {children}
    </section>
  );
}

export function ModulesTab({ isAdmin, solo }: { isAdmin: boolean; solo?: string }) {
  const router = useRouter();
  // I collegamenti di prima (`/settings?tab=moduli#module-<chiave>` o `#int-<chiave>`)
  // portano alla pagina del modulo.
  useEffect(() => {
    if (solo || typeof window === "undefined") return;
    const vai = () => {
      const m = /^#(?:module|int)-([a-z0-9_]+)$/.exec(window.location.hash);
      if (m) router.replace(`/settings/moduli/${m[1]}`);
    };
    vai();
    // Anche quando cambia solo l'ancora, a pagina già aperta.
    window.addEventListener("hashchange", vai);
    return () => window.removeEventListener("hashchange", vai);
  }, [solo, router]);

  // ── Docker availability (per le integrazioni Docker-managed) ───────
  const [dockerAvailable, setDockerAvailable] = useState<boolean | null>(null);
  // Errore nel leggere lo stato di Docker: non è «Docker non trovato».
  const [dockerError, setDockerError] = useState<string | null>(null);
  const [installingDocker, setInstallingDocker] = useState(false);
  const [meshInstallOpen, setMeshInstallOpen] = useState(false);

  const checkDocker = useCallback(async () => {
    const r = await fetchJson<{ available: boolean }>("/api/integrations/docker-status", { cache: "no-store" });
    if (!r.ok) {
      setDockerError(r.message);
      return;
    }
    setDockerError(null);
    setDockerAvailable(r.data.available === true);
  }, []);

  useEffect(() => {
    void checkDocker();
  }, [checkDocker]);

  const onFineDocker = (passo: PassoPolling) => {
    setInstallingDocker(false);
    if (passo.esito === "finito" && passo.job) {
      if (passo.job.phase === "done") {
        toast.success("Docker installato — ricarica la pagina");
        void checkDocker();
      } else {
        toast.error(`Errore installazione Docker: ${passo.job.error ?? "sconosciuto"}`);
      }
      return;
    }
    // Fermo senza esito: il messaggio resta anche accanto al log.
    if (passo.messaggio) toast.error(passo.messaggio);
    if (passo.esito === "esito_sconosciuto") void checkDocker();
  };
  const {
    job: dockerInstallJob,
    avviso: dockerJobAvviso,
    attivo: dockerJobAttivo,
    avvia: avviaPollingDocker,
  } = useJobPolling(onFineDocker);

  const handleInstallDocker = async () => {
    setInstallingDocker(true);
    const r = await fetchJson<{ jobId?: string }>("/api/integrations/install-docker", { method: "POST" });
    if (!r.ok || !r.data.jobId) {
      toast.error(r.ok ? "Errore avvio installazione Docker" : r.message);
      setInstallingDocker(false);
      return;
    }
    avviaPollingDocker(r.data.jobId);
  };

  // ── Patch Management (feature install/uninstall) ───────────────────
  // null = non ancora letti: «Non installato» si dice solo dopo una risposta buona.
  const [features, setFeatures] = useState<FeatureEntry[] | null>(null);
  const [featuresError, setFeaturesError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [uninstallDialog, setUninstallDialog] = useState<{
    open: boolean;
    feature: FeatureEntry | null;
    dropData: boolean;
  }>({ open: false, feature: null, dropData: false });

  const fetchFeatures = useCallback(async () => {
    const r = await fetchJson<{ features?: FeatureEntry[] }>("/api/features", { cache: "no-store" });
    if (!r.ok) {
      setFeaturesError(r.message);
      return;
    }
    setFeaturesError(null);
    setFeatures(r.data.features ?? []);
  }, []);

  useEffect(() => {
    void fetchFeatures();
  }, [fetchFeatures]);

  const patch = features?.find((f) => f.key === "patch_management");
  const inventoryAgent = features?.find((f) => f.key === "inventory_agent");
  const meshcentral = features?.find((f) => f.key === "meshcentral");
  // Al posto delle card dei moduli opzionali finché lo stato non è letto.
  const featuresPlaceholder = featuresError ? (
    <LoadError
      what="lo stato dei moduli opzionali"
      message={featuresError}
      onRetry={() => void fetchFeatures()}
    />
  ) : features === null ? (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" />
      Caricamento…
    </div>
  ) : null;

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

  // Apre il wizard che provisiona DAVVERO MeshCentral (container + utenza +
  // gruppo + config). Prima qui si chiamava /api/features/meshcentral/install,
  // che accendeva solo il flag: il modulo risultava "installato" ma inservibile,
  // e serviva completarlo da CLI. Vedi lib/integrations/meshcentral/install.ts.
  const handleInstallMesh = () => setMeshInstallOpen(true);

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
      // MOD-19: il messaggio dice cosa è successo davvero ai dati, letto dalla
      // risposta (dataDropped), non da cosa si era chiesto.
      const res = (await r.json().catch(() => null)) as { dataDropped?: boolean } | null;
      if (!uninstallDialog.dropData) {
        toast.success(`Modulo "${feature.title}" disinstallato. I dati storici restano nel database.`);
      } else if (res?.dataDropped === true) {
        toast.success(`Modulo "${feature.title}" disinstallato e dati storici cancellati.`);
      } else {
        toast.warning(
          `Modulo "${feature.title}" disinstallato, ma nessun dato è stato cancellato: le tabelle del modulo non c'erano o erano incomplete.`,
        );
      }
      setUninstallDialog({ open: false, feature: null, dropData: false });
      await fetchFeatures();
    } catch (e) {
      toast.error(`Disinstallazione fallita: ${e instanceof Error ? e.message : "errore"}`);
    } finally {
      setBusyKey(null);
    }
  };

  const uninstallKey = uninstallDialog.feature?.key ?? "";
  const uninstallCopy = isUninstallableFeature(uninstallKey) ? UNINSTALL_COPY[uninstallKey] : null;

  const patchInstalled = patch?.status === "installed";
  const patchBusy = busyKey === "patch_management";
  const inventoryInstalled = inventoryAgent?.status === "installed";
  const inventoryBusy = busyKey === "inventory_agent";
  const meshInstalled = meshcentral?.status === "installed";
  const meshBusy = busyKey === "meshcentral";

  return (
    <SoloModulo.Provider value={solo}>
    <div className="space-y-8">
      {!solo ? (
        <>
      <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <PackageOpen className="h-5 w-5" />
                Moduli
              </h2>
              <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
                Ogni modulo si configura e si verifica nella sua pagina («Apri»). Il JSON
                dell&apos;installer di un modulo si importa qui a destra.
              </p>
            </div>
            <div className="shrink-0">
              <ModuleJsonImport />
            </div>
          </div>

          <ElencoModuli />
        </>
      ) : (
        <Link href="/settings?tab=moduli" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
          Tutti i moduli
        </Link>
      )}

      {/* ════ Moduli nativi ════ */}
      <ModuleSection id="module-edge" moduleKey="edge" title="Scanner-Edge — Vulnerability Assessment">
        <ScannerEdgeCard />
        <VerificaModulo moduleKey="edge" isAdmin={isAdmin} />
      </ModuleSection>

      <ModuleSection
        id="module-patch_management"
        moduleKey="patch_management"
        title="Patch Management"
      >
        {featuresPlaceholder ?? (
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
        )}
      </ModuleSection>

      <ModuleSection
        id="module-inventory_agent"
        offertaDi="inventory_agent"
        title="Inventory Agent"
      >
        {featuresPlaceholder ?? (
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
        )}
      </ModuleSection>

      <ModuleSection
        id="module-meshcentral"
        offertaDi="meshcentral"
        title="MeshCentral — Controllo remoto"
      >
        {featuresPlaceholder ?? (
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
        )}
        <InterruttoreSenzaAgente isAdmin={isAdmin} />
        <VerificaModulo moduleKey="meshcentral" isAdmin={isAdmin} />
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

      <ModuleSection
        id="module-zabbix"
        title="Zabbix — pannello in sola lettura"
        opzioneFuoriCatalogo={OFFERTA_PANNELLO_ZABBIX === "opzione"}
      >
        <ZabbixLetturaCard isAdmin={isAdmin} />
      </ModuleSection>

      <ModuleSection id="module-unifi" title="Controller di rete">
        <p className="text-sm text-muted-foreground">
          I controller si gestiscono in{" "}
          <Link href="/controllers" className="underline underline-offset-2 hover:text-foreground">
            Rete → Controller di rete
          </Link>
          .
        </p>
        <VerificaModulo moduleKey="unifi" isAdmin={isAdmin} />
      </ModuleSection>

      {/* ════ Integrazioni a dashboard esterna: Docker solo nelle loro pagine ════ */}
      {solo && CON_DOCKER.has(solo) && (
      <>

      {dockerError && (
        <LoadError what="lo stato di Docker" message={dockerError} onRetry={() => void checkDocker()} />
      )}

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
          {dockerJobAvviso && (
            <div className="flex items-start gap-2 rounded-md border border-amber-400 bg-white/60 dark:bg-black/20 px-3 py-2 text-xs">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>{dockerJobAvviso}</span>
            </div>
          )}
          {dockerInstallJob && (
            <div className="rounded-md bg-black/90 text-green-400 font-mono text-xs p-3 max-h-36 overflow-y-auto space-y-0.5">
              <div className="flex items-center gap-2 mb-1 text-white/60">
                {dockerInstallJob.phase !== "done" &&
                  dockerInstallJob.phase !== "error" &&
                  (dockerJobAttivo ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <AlertTriangle className="h-3 w-3 text-amber-400" />
                  ))}
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
      </>
      )}

      <ModuleSection id="module-librenms" moduleKey="librenms" title="LibreNMS">
        <IntegrationCard
          component="librenms"
          title="LibreNMS"
          description="Monitoring SNMP e metriche di rete. I grafici device sono embeddati in DA-IPAM; la dashboard completa si apre dal Launchpad o da qui."
          dockerAvailable={dockerAvailable ?? false}
          showSyncButton
        />
        <VerificaModulo moduleKey="librenms" isAdmin={isAdmin} />
      </ModuleSection>

      <ModuleSection id="module-graylog" moduleKey="graylog" title="Graylog">
        <IntegrationCard
          component="graylog"
          title="Graylog"
          description="Log management completo (Windows/Linux/network)."
          dockerAvailable={dockerAvailable ?? false}
        />
        <VerificaModulo moduleKey="graylog" isAdmin={isAdmin} />
      </ModuleSection>

      <ModuleSection id="module-wazuh" moduleKey="wazuh" title="Wazuh SIEM">
        <WazuhCard />
        <VerificaModulo moduleKey="wazuh" isAdmin={isAdmin} />
      </ModuleSection>

      {solo === "loki" && (
        <section id="module-loki" className="scroll-mt-24">
          <IntegrationCard
            component="loki"
            title="Grafana Loki"
            description="Log management leggero (~512MB RAM). Raccolta syslog da device di rete e Linux."
            dockerAvailable={dockerAvailable ?? false}
          />
        </section>
      )}

      {solo && CON_DOCKER.has(solo) && <IntegrationViewer solo={solo} />}

      {solo === "credenziali" && <CredentialsVaultPanel isAdmin={isAdmin} />}

      <Dialog
        open={uninstallDialog.open}
        onOpenChange={(open) => {
          if (!open) setUninstallDialog({ open: false, feature: null, dropData: false });
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Disinstallare {uninstallDialog.feature?.title ?? "il modulo"}?
            </DialogTitle>
            <DialogDescription>{uninstallCopy?.effetto}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <label className="flex items-start gap-2 text-sm cursor-pointer">
              <Checkbox
                checked={uninstallDialog.dropData}
                onCheckedChange={(v) =>
                  setUninstallDialog((prev) => ({ ...prev, dropData: v === true }))
                }
              />
              <span>Elimina anche i dati storici del modulo</span>
            </label>
            {uninstallCopy &&
              (uninstallDialog.dropData ? (
                <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive space-y-1">
                  <p className="font-medium">{uninstallCopy.conCasella}</p>
                  <p className="text-xs">
                    Tabelle cancellate:{" "}
                    <span className="font-mono">{uninstallCopy.tabelle.join(", ")}</span>
                  </p>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">{uninstallCopy.senzaCasella}</p>
              ))}
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
              {uninstallDialog.dropData ? "Disinstalla e cancella i dati" : "Disinstalla"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <MeshCentralInstallDialog
        open={meshInstallOpen}
        onOpenChange={setMeshInstallOpen}
        onInstalled={() => void fetchFeatures()}
      />
    </div>
    </SoloModulo.Provider>
  );
}

/** Stato di GET /api/network-services/setup usato dalla card. */
interface NetServicesSetupState {
  installed: boolean;
  configured: boolean;
  apiUrl: string;
  hasToken: boolean;
  /** Da dove viene la configurazione (MOD-19). Assente = risposta vecchia. */
  source?: "database" | "env" | null;
  /** Le variabili d'ambiente tengono acceso il modulo anche dopo la disinstallazione. */
  envFallback?: boolean;
}

/** Config compatta Network Services (riusa /api/network-services/setup). */
function NetServicesConfigCard({ isAdmin }: { isAdmin: boolean }) {
  const router = useRouter();
  const [state, setState] = useState<NetServicesSetupState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [apiUrl, setApiUrl] = useState("https://192.168.99.52:8443");
  const [apiToken, setApiToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);

  const load = useCallback(async () => {
    const r = await fetchJson<NetServicesSetupState>("/api/network-services/setup", { cache: "no-store" });
    if (!r.ok) {
      // Un errore non è «Non configurato»: si dice e si lascia riprovare.
      setLoadError(r.message);
      return;
    }
    setLoadError(null);
    setState(r.data);
    if (r.data.apiUrl) setApiUrl(r.data.apiUrl);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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
      void load();
      router.refresh();
    } catch (e) {
      toast.error(`Install fallita: ${e instanceof Error ? e.message : "errore"}`);
    } finally {
      setBusy(false);
    }
  }

  async function uninstall() {
    // MOD-19: uninstallNetServices spegne il modulo e cancella URL e token
    // del bridge (config_json = NULL); non contatta il bridge. Se le variabili
    // d'ambiente NET_SERVICES_API_* ci sono, il modulo resta acceso da lì e
    // la conferma lo dice.
    if (!confirm(netServicesUninstallConfirmText(state?.envFallback === true))) {
      return;
    }
    setBusy(true);
    try {
      const r = await fetch("/api/network-services/setup", { method: "DELETE" });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error ?? r.statusText);
      toast.success(d.message ?? "Modulo disinstallato");
      void load();
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
              {state === null ? null : configured ? (
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
        {loadError ? (
          <LoadError
            what="lo stato di Network Services"
            message={loadError}
            onRetry={() => void load()}
          />
        ) : state === null ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Caricamento…
          </div>
        ) : !isAdmin ? (
          <p className="text-sm text-muted-foreground">
            Solo un amministratore può configurare questo modulo.
          </p>
        ) : configured ? (
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">
                Bridge corrente: <code>{state?.apiUrl}</code>
              </p>
              {state?.source === "env" && (
                <p className="text-sm text-muted-foreground">{NET_SERVICES_ENV_NOTE}</p>
              )}
            </div>
            {state?.source !== "env" && (
              <Button variant="destructive" size="sm" disabled={busy} onClick={uninstall}>
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Trash2 className="h-4 w-4 mr-2" />
                )}
                Disinstalla
              </Button>
            )}
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
