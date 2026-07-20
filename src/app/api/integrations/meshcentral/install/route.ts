/**
 * POST /api/integrations/meshcentral/install
 *
 * Provisiona MeshCentral per intero (container + utenza + gruppo + config) e
 * ritorna un jobId da seguire su /api/integrations/jobs/[id]. Stesso schema di
 * install-docker: il lavoro dura 1-2 minuti e gira in background.
 *
 * Body (tutti opzionali tranne host):
 *   { host, title?, subtitle?, port?, password? }
 * Senza `password` si usa la PASSWORD MASTER dei moduli (generata alla prima
 * installazione): un solo segreto da ricordare invece di uno per modulo.
 *
 * requireAdmin: crea container e utenze di servizio sull'appliance.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { randomUUID } from "crypto";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getCurrentTenantCode } from "@/lib/db-tenant";
import { createJob, listJobs } from "@/lib/integrations/job-store";
import { installMeshCentral } from "@/lib/integrations/meshcentral/install";
import { ensureMasterPassword } from "@/lib/master-password";

const bodySchema = z.object({
  /** Host/IP con cui il BROWSER raggiunge l'appliance (window.location.hostname). */
  host: z.string().min(1).max(255),
  title: z.string().max(120).optional(),
  subtitle: z.string().max(120).optional(),
  port: z.number().int().min(1024).max(65535).optional(),
  /** Se assente si usa la password master dei moduli. */
  password: z.string().min(8).max(200).optional(),
});

export async function POST(req: Request) {
  return withTenantFromSession(async () => {
    const auth = await requireAdmin();
    if (isAuthError(auth)) return auth;

    const tenantCode = getCurrentTenantCode();
    if (!tenantCode) {
      return NextResponse.json({ error: "Tenant non risolto" }, { status: 400 });
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Body JSON non valido" }, { status: 400 });
    }
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Dati non validi" },
        { status: 400 },
      );
    }

    // Un solo provisioning alla volta: due installazioni parallele si
    // contenderebbero lo stesso container e la stessa dir dati.
    const running = listJobs().find(
      (j) => j.component === "meshcentral" && j.phase !== "done" && j.phase !== "error",
    );
    if (running) {
      return NextResponse.json(
        { error: "Installazione MeshCentral già in corso", jobId: running.id },
        { status: 409 },
      );
    }

    // Default = password master: la si cambia in un punto solo e i moduli
    // installati dopo la ereditano.
    const password = parsed.data.password ?? ensureMasterPassword();

    const jobId = randomUUID();
    createJob({
      id: jobId,
      component: "meshcentral",
      phase: "idle",
      log: [],
      startedAt: new Date().toISOString(),
    });

    // Background: la request non aspetta i 1-2 minuti del provisioning.
    void installMeshCentral(jobId, {
      adminPassword: password,
      title: parsed.data.title?.trim() || "Domarc RMM",
      subtitle: parsed.data.subtitle?.trim() || "Controllo remoto",
      port: parsed.data.port ?? 4443,
      host: parsed.data.host,
      tenantCode,
    }).catch(() => {
      /* gli errori finiscono nel job (phase: error) */
    });

    return NextResponse.json({ jobId });
  });
}
