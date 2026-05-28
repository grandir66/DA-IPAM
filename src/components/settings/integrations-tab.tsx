"use client";

import { useEffect, useState, useRef } from "react";
import { IntegrationCard } from "./integration-card";
import { ScannerEdgeCard } from "./scanner-edge-card";
import { WazuhCard } from "./wazuh-card";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import type { InstallJob } from "@/lib/integrations/types";
import { LaunchpadClient } from "@/app/(dashboard)/launchpad/launchpad-client";
import type { SystemCredential } from "@/lib/credentials-vault";

export function IntegrationsTab() {
  const [dockerAvailable, setDockerAvailable] = useState<boolean | null>(null);
  const [installingDocker, setInstallingDocker] = useState(false);
  const [dockerInstallJob, setDockerInstallJob] = useState<InstallJob | null>(null);
  const dockerPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [vaultItems, setVaultItems] = useState<SystemCredential[] | null>(null);

  const checkDocker = () => {
    fetch("/api/integrations/docker-status")
      .then((r) => r.json())
      .then((d: { available: boolean }) => setDockerAvailable(d.available))
      .catch(() => setDockerAvailable(false));
  };

  const loadVault = () => {
    fetch("/api/system-credentials")
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d: { items: SystemCredential[] }) => setVaultItems(d.items ?? []))
      .catch(() => setVaultItems([]));
  };

  useEffect(() => {
    checkDocker();
    loadVault();
    return () => { if (dockerPollRef.current) clearInterval(dockerPollRef.current); };
  }, []);

  // Deep-link: /settings?tab=integrazioni#int-<kind> scrolla alla card integrazione
  // corrispondente. Riferimento dai bottoni "Configura integrazione" nel Launchpad.
  // Usa rAF doppio per attendere che il render con vaultItems sia completo (la
  // sezione embed cresce e cambia gli offset).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const hash = window.location.hash;
    if (!hash || !hash.startsWith("#int-")) return;
    if (vaultItems === null) return;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const el = document.getElementById(hash.slice(1));
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "start" });
          // Highlight transitorio: aggiungi una classe ring per ~2s
          el.classList.add("ring-2", "ring-primary", "ring-offset-2");
          setTimeout(() => el.classList.remove("ring-2", "ring-primary", "ring-offset-2"), 2200);
        }
      });
    });
  }, [vaultItems]);

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
        } catch { /* ignore */ }
      }, 1500);
    } catch {
      toast.error("Errore di rete");
      setInstallingDocker(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Integrazioni esterne</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Connetti DA-IPAM a sistemi di monitoring (LibreNMS) e log management (Loki, Graylog).
          Puoi usare istanze Docker gestite localmente oppure istanze già esistenti.
          Sotto trovi sia gli accessi (URL, credenziali, test) sia la configurazione
          delle integrazioni Docker.
        </p>
      </div>

      {/* v0.2.671 fusione: ex-Launchpad embedded come prima sezione.
          Una sola tab in /settings?tab=integrazioni con accessi + config Docker. */}
      <Card>
        <CardContent className="pt-6">
          {vaultItems === null ? (
            <div className="text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Carico credenziali vault…
            </div>
          ) : (
            <LaunchpadClient initialItems={vaultItems} embedded />
          )}
        </CardContent>
      </Card>

      <Separator />

      <div>
        <h3 className="text-base font-semibold">Configurazione integrazioni</h3>
        <p className="text-xs text-muted-foreground mt-1">
          Gestione container Docker locali e parametri di connessione per le
          integrazioni con UI/API dedicata.
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
              disabled={installingDocker}
              className="bg-amber-600 hover:bg-amber-700 text-white"
            >
              {installingDocker
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />Installazione in corso...</>
                : "Installa Docker automaticamente"}
            </Button>
            <span className="text-xs text-amber-700 dark:text-amber-400">
              Oppure installa manualmente e ricarica la pagina
            </span>
          </div>

          {/* Log installazione Docker */}
          {dockerInstallJob && (
            <div className="rounded-md bg-black/90 text-green-400 font-mono text-xs p-3 max-h-36 overflow-y-auto space-y-0.5">
              <div className="flex items-center gap-2 mb-1 text-white/60">
                {(dockerInstallJob.phase !== "done" && dockerInstallJob.phase !== "error")
                  && <Loader2 className="h-3 w-3 animate-spin" />}
                <span className="capitalize">{dockerInstallJob.phase}</span>
              </div>
              {dockerInstallJob.log.map((line, i) => <div key={i}>{line}</div>)}
            </div>
          )}

          <p className="text-xs">
            In alternativa installa manualmente:{" "}
            <code className="bg-black/10 px-1 rounded">curl -fsSL https://get.docker.com | sh</code>
          </p>
        </div>
      )}

      {dockerAvailable === true && (
        <div className="flex items-start gap-2 rounded-md border border-green-300 bg-green-50 dark:bg-green-950/20 px-4 py-3 text-sm text-green-800 dark:text-green-300">
          <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0 text-green-500" />
          <span>Docker disponibile — l&apos;installazione automatizzata è abilitata.</span>
        </div>
      )}

      <ScannerEdgeCard />

      <WazuhCard />

      <IntegrationCard
        component="librenms"
        title="LibreNMS"
        description="Monitoring SNMP e metriche di rete. DA-IPAM sincronizza i device scoperti su LibreNMS."
        dockerAvailable={dockerAvailable ?? false}
        showSyncButton
      />

      <IntegrationCard
        component="loki"
        title="Grafana Loki"
        description="Log management leggero (~512MB RAM). Raccolta syslog da device di rete e Linux."
        dockerAvailable={dockerAvailable ?? false}
      />

      <IntegrationCard
        component="graylog"
        title="Graylog"
        description="Log management completo (~3–4GB RAM). Supporto Windows (WinLogBeat), Linux e device di rete."
        dockerAvailable={dockerAvailable ?? false}
      />
    </div>
  );
}
