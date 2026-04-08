import { NextResponse } from "next/server";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { createJob, listJobs } from "@/lib/integrations/job-store";
import { installDocker } from "@/lib/integrations/docker-install";
import { randomUUID } from "crypto";

export async function POST(req: Request) {
  const adminCheck = await requireAdmin();
  if (isAuthError(adminCheck)) return adminCheck;

  // Controlla se c'è già un job di installazione Docker in corso
  const running = listJobs().find(
    (j) => j.component === ("docker" as never) && j.phase !== "done" && j.phase !== "error"
  );
  if (running) {
    return NextResponse.json({ error: "Installazione Docker già in corso", jobId: running.id }, { status: 409 });
  }

  const jobId = randomUUID();
  createJob({
    id: jobId,
    component: "librenms", // usiamo librenms come placeholder (component non influisce sul job)
    phase: "idle",
    log: [],
    startedAt: new Date().toISOString(),
  });

  // Avvia in background
  installDocker(jobId).catch(() => {});

  return NextResponse.json({ jobId });
}
