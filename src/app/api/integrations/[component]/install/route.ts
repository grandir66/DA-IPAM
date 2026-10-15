import { NextResponse } from "next/server";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { createJob, listJobs } from "@/lib/integrations/job-store";
import { installLibreNMS } from "@/lib/integrations/librenms";
import { installLoki } from "@/lib/integrations/loki";
import { installGraylog } from "@/lib/integrations/graylog";
import { getIntegrationConfig } from "@/lib/integrations/config";
import { rifiutoInstallazione } from "@/lib/integrations/librenms-appliance";
import { parametriInstallazione } from "@/lib/integrations/segreti-installazione";
import type { ContainerIntegrationComponent } from "@/lib/integrations/types";
import { randomUUID } from "crypto";
import { networkInterfaces } from "os";

/** Rileva il primo IP non-loopback del server (es. 192.168.1.10) */
function detectServerIp(): string {
  const nets = networkInterfaces();
  for (const ifaces of Object.values(nets)) {
    for (const iface of ifaces ?? []) {
      if (iface.family === "IPv4" && !iface.internal) {
        return iface.address;
      }
    }
  }
  return "localhost";
}

const VALID_COMPONENTS: ContainerIntegrationComponent[] = ["librenms", "loki", "graylog"];

function parseComponent(raw: string): ContainerIntegrationComponent | null {
  return VALID_COMPONENTS.includes(raw as ContainerIntegrationComponent)
    ? (raw as ContainerIntegrationComponent)
    : null;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ component: string }> }
) {
  const authError = await requireAdmin();
  if (isAuthError(authError)) return authError;

  const { component: raw } = await params;
  const component = parseComponent(raw);
  if (!component) return NextResponse.json({ error: "Componente non valido" }, { status: 400 });

  // Il LibreNMS dell'installatore dell'appliance c'è già: un secondo sulla 8090
  // prenderebbe il suo posto in DA-IPAM, vuoto (pilota PX-NAS 2026-10-15).
  const rifiuto = await rifiutoInstallazione(component);
  if (rifiuto) return NextResponse.json({ error: rifiuto }, { status: 409 });

  // Controlla se c'è già un job in corso per questo componente
  const running = listJobs().find(
    (j) => j.component === component && (j.phase !== "done" && j.phase !== "error")
  );
  if (running) {
    return NextResponse.json({ error: "Installazione già in corso", jobId: running.id }, { status: 409 });
  }

  const cfg = getIntegrationConfig(component);
  const containerName = cfg.containerName ?? `da-${component}`;

  // Password admin: quella della richiesta (almeno 6 caratteri) oppure una
  // generata qui — mai un valore predefinito (SEC-13). Si salva cifrata e la
  // mostra la card dell'integrazione agli admin.
  let corpo: unknown = {};
  try {
    corpo = await req.json();
  } catch { /* body vuoto ok */ }
  const parametri = parametriInstallazione(corpo);
  const adminPassword = parametri.adminPassword;
  let serverUrl = parametri.serverUrl;

  // Se l'utente non ha specificato un URL, lo rileva automaticamente
  if (!serverUrl) {
    const ip = detectServerIp();
    const defaultPorts: Record<ContainerIntegrationComponent, number> = { librenms: 8090, graylog: 9000, loki: 3100 };
    serverUrl = `http://${ip}:${defaultPorts[component]}`;
  }

  const jobId = randomUUID();
  createJob({
    id: jobId,
    component,
    phase: "idle",
    log: [],
    startedAt: new Date().toISOString(),
  });

  // Avvia in background
  const runners: Record<ContainerIntegrationComponent, () => Promise<void>> = {
    librenms: () => installLibreNMS(jobId, containerName, adminPassword, serverUrl),
    loki: () => installLoki(jobId, containerName),
    graylog: () => installGraylog(jobId, containerName, adminPassword, serverUrl),
  };

  runners[component]().catch(() => {
    // errore già gestito dentro il runner
  });

  return NextResponse.json({ jobId });
}
