"use client";

import { useEffect, useState, useRef } from "react";
import { IntegrationCard } from "./integration-card";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import type { InstallJob } from "@/lib/integrations/types";

export function IntegrationsTab() {
  const [dockerAvailable, setDockerAvailable] = useState<boolean | null>(null);
  const [installingDocker, setInstallingDocker] = useState(false);
  const [dockerInstallJob, setDockerInstallJob] = useState<InstallJob | null>(null);
  const dockerPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const checkDocker = () => {
    fetch("/api/integrations/docker-status")
      .then((r) => r.json())
      .then((d: { available: boolean }) => setDockerAvailable(d.available))
      .catch(() => setDockerAvailable(false));
  };

  useEffect(() => {
    checkDocker();
    return () => { if (dockerPollRef.current) clearInterval(dockerPollRef.current); };
  }, []);

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
          Connetti DA-INVENT a sistemi di monitoring (LibreNMS) e log management (Loki, Graylog).
          Puoi usare istanze Docker gestite localmente oppure istanze già esistenti.
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

      <IntegrationCard
        component="librenms"
        title="LibreNMS"
        description="Monitoring SNMP e metriche di rete. DA-INVENT sincronizza i device scoperti su LibreNMS."
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
