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
        <div className="flex items-start gap-2 rounded-md border border-red-300 bg-red-50 dark:bg-red-950/20 px-4 py-3 text-sm text-red-800 dark:text-red-300">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>
            Docker non disponibile su questo host. L&apos;installazione automatizzata non è possibile.
            Puoi comunque configurare istanze esterne selezionando &quot;Istanza esterna&quot;.
          </span>
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
