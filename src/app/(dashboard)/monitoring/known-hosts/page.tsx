import { getKnownHostsWithNetwork } from "@/lib/db";
import { KnownHostsClient } from "./known-hosts-client";

export default function KnownHostsMonitoringPage() {
  const rows = getKnownHostsWithNetwork();
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Monitoraggio host conosciuti</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Host segnati come conosciuti (monitoraggio continuo). Gli host offline sono irraggiungibili all&apos;ultimo controllo.
        </p>
      </div>
      <KnownHostsClient initialRows={rows} />
    </div>
  );
}
