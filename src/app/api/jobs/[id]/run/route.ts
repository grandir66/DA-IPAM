import { NextResponse } from "next/server";
import { getScheduledJobById, updateJobLastRun } from "@/lib/db";
import { runJob } from "@/lib/cron/jobs";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";

/**
 * POST /api/jobs/[id]/run — esecuzione on-demand di un job schedulato.
 * Bypassa lo scheduler cron: utile per "Run now" dalla UI o test smoke.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withTenantFromSession(async () => {
    try {
      const adminCheck = await requireAdmin();
      if (isAuthError(adminCheck)) return adminCheck;

      const { id } = await params;
      const jobId = Number(id);
      if (!Number.isFinite(jobId) || jobId <= 0) {
        return NextResponse.json({ error: "ID job non valido" }, { status: 400 });
      }

      const job = getScheduledJobById(jobId);
      if (!job) return NextResponse.json({ error: "Job non trovato" }, { status: 404 });

      const startedAt = Date.now();
      await runJob(jobId);
      updateJobLastRun(jobId);
      const durationMs = Date.now() - startedAt;

      return NextResponse.json({
        success: true,
        job_id: jobId,
        job_type: job.job_type,
        duration_ms: durationMs,
      });
    } catch (error) {
      console.error("[/api/jobs/[id]/run] error:", error);
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Errore esecuzione job" },
        { status: 500 },
      );
    }
  });
}
