"use client";

import { useEffect, useState } from "react";
import { IntegrationCard } from "./integration-card";
import { AlertTriangle, CheckCircle2 } from "lucide-react";

export function IntegrationsTab() {
  const [dockerAvailable, setDockerAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    fetch("/api/integrations/docker-status")
      .then((r) => r.json())
      .then((d: { available: boolean }) => setDockerAvailable(d.available))
      .catch(() => setDockerAvailable(false));
  }, []);

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
        <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/20 px-4 py-3 text-sm text-amber-900 dark:text-amber-300 space-y-2">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <span className="font-medium">Docker non trovato su questo host.</span>
          </div>
          <p>
            Per usare l&apos;installazione automatizzata, installa Docker sul server con:
          </p>
          <pre className="bg-black/10 dark:bg-black/30 rounded px-3 py-2 font-mono text-xs overflow-x-auto">
            {`curl -fsSL https://get.docker.com | sh\nsudo usermod -aG docker $USER`}
          </pre>
          <p>
            Dopo l&apos;installazione riavvia il browser o effettua un nuovo accesso, poi ricarica questa pagina.
            In alternativa puoi subito configurare un&apos;istanza esterna selezionando <strong>&quot;Istanza esterna&quot;</strong>.
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
