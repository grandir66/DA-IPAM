import { NextResponse } from "next/server";
import { getScheduledJobById } from "@/lib/db";
import { eseguiJobOra } from "@/lib/cron/jobs";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";

/**
 * POST /api/jobs/[id]/run — esecuzione on-demand di un job schedulato.
 * Bypassa lo scheduler cron: utile per "Run now" dalla UI o test smoke.
 *
 * Job di scansione (T3-17): si risponde 202 appena parte il primo giro, con il
 * suo id; il giro continua in background e `last_run` si scrive alla fine.
 * Gli altri job si aspettano e rispondono 200 con la durata, come prima.
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

      const esito = await eseguiJobOra(jobId);
      if (esito.modo === "avviato") {
        return NextResponse.json(
          { success: true, job_id: jobId, job_type: job.job_type, scan_id: esito.scanId },
          { status: 202 },
        );
      }
      return NextResponse.json({
        success: true,
        job_id: jobId,
        job_type: job.job_type,
        duration_ms: esito.durationMs,
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
