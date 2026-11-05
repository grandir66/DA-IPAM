import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { statoScheduler, chiaveJob } from "@/lib/cron/stato-scheduler";
import { getCurrentTenantCode, getScheduledJobs } from "@/lib/db";
import { ETICHETTE_JOB, scheduledJobLabel } from "@/lib/scheduled-job-types";
import { elencaGiri } from "@/lib/scanner/discovery";
import { giriDelCliente, jobInEsecuzione } from "@/lib/scanner/giri";

/**
 * La bacheca di cosa sta girando per questo cliente: giri di scansione (compresi quelli finiti da
 * meno di 5 minuti) e job dello scheduler. Tutto in memoria: un riavvio del servizio la azzera.
 */
export async function GET() {
  return await withTenantFromSession(async () => {
    const authCheck = await requireAuth();
    if (isAuthError(authCheck)) return authCheck;

    const tenantCode = getCurrentTenantCode();
    const giri = giriDelCliente(elencaGiri(), tenantCode);
    const { runningJobs } = statoScheduler();
    const jobs = getScheduledJobs();
    const perId = new Map(jobs.map((j) => [j.id, j]));
    const job = jobInEsecuzione(
      jobs,
      (id) => tenantCode != null && runningJobs.has(chiaveJob(tenantCode, id)),
      giri,
      (id) => {
        const j = perId.get(id);
        return j ? scheduledJobLabel(j, ETICHETTE_JOB) : `Job #${id}`;
      },
    );
    return NextResponse.json({ giri, job });
  });
}
