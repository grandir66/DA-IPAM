import { NextResponse } from "next/server";
import { getScheduledJobById } from "@/lib/db";
import { eseguiJobOra } from "@/lib/cron/jobs";
import { corpoScanInCorso } from "@/lib/scanner/network-scan-lock";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { rifiutoJobRiservato } from "@/lib/cron/job-riservati";

/**
 * POST /api/jobs/[id]/run — esecuzione on-demand di un job schedulato.
 * Bypassa lo scheduler cron: utile per "Run now" dalla UI o test smoke.
 *
 * Job di scansione (T3-17): si risponde 202 appena parte il primo giro, con il
 * suo id; il giro continua in background e `last_run` si scrive alla fine.
 * Gli altri job si aspettano e rispondono 200 con la durata, come prima.
 * Rete già in scansione (T3-18): 409 con il giro in corso, `last_run` invariato.
 * `pulizia_host` (si gestisce dalla sua scheda): 409, non parte.
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
      // pulizia_host gira solo di notte, acceso dalla sua scheda: niente «Esegui ora» (m6, revisione finale 20/10).
      const riservato = rifiutoJobRiservato(jobId);
      if (riservato) return NextResponse.json(riservato.body, { status: riservato.status });

      const esito = await eseguiJobOra(jobId);
      if (esito.modo === "saltato") {
        return NextResponse.json(corpoScanInCorso(esito.giroInCorso), { status: 409 });
      }
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
        // Il job è finito senza fare tutto (es. client UniFi fuori dalle 7-20): la pagina lo mostra.
        ...(esito.motivo ? { note: esito.motivo } : {}),
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
