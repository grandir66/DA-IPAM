import { NextResponse } from "next/server";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { createJob, listJobs } from "@/lib/integrations/job-store";
import { installLibreNMS } from "@/lib/integrations/librenms";
import { installLoki } from "@/lib/integrations/loki";
import { installGraylog } from "@/lib/integrations/graylog";
import { getIntegrationConfig } from "@/lib/integrations/config";
import type { IntegrationComponent } from "@/lib/integrations/types";
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

const VALID_COMPONENTS: IntegrationComponent[] = ["librenms", "loki", "graylog"];

function parseComponent(raw: string): IntegrationComponent | null {
  return VALID_COMPONENTS.includes(raw as IntegrationComponent)
    ? (raw as IntegrationComponent)
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

  // Controlla se c'è già un job in corso per questo componente
  const running = listJobs().find(
    (j) => j.component === component && (j.phase !== "done" && j.phase !== "error")
  );
  if (running) {
    return NextResponse.json({ error: "Installazione già in corso", jobId: running.id }, { status: 409 });
  }

  const cfg = getIntegrationConfig(component);
  const containerName = cfg.containerName ?? `da-${component}`;

  let adminPassword = "admin";
  let serverUrl = "";
  try {
    const body = await req.json() as { adminPassword?: string; serverUrl?: string };
    if (body.adminPassword && typeof body.adminPassword === "string" && body.adminPassword.trim().length >= 6) {
      adminPassword = body.adminPassword.trim();
    }
    if (body.serverUrl && typeof body.serverUrl === "string" && body.serverUrl.trim()) {
      serverUrl = body.serverUrl.trim().replace(/\/$/, "");
    }
  } catch { /* body vuoto ok */ }

  // Se l'utente non ha specificato un URL, lo rileva automaticamente
  if (!serverUrl) {
    const ip = detectServerIp();
    const defaultPorts: Record<IntegrationComponent, number> = { librenms: 8090, graylog: 9000, loki: 3100 };
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
  const runners: Record<IntegrationComponent, () => Promise<void>> = {
    librenms: () => installLibreNMS(jobId, containerName, adminPassword, serverUrl),
    loki: () => installLoki(jobId, containerName),
    graylog: () => installGraylog(jobId, containerName, adminPassword, serverUrl),
  };

  runners[component]().catch(() => {
    // errore già gestito dentro il runner
  });

  return NextResponse.json({ jobId });
}
