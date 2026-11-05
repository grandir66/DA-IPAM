import { NextResponse } from "next/server";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getCurrentTenantCode } from "@/lib/db";
import { getScanProgress, segnaGiroInArresto } from "@/lib/scanner/discovery";
import { fermaGiro } from "@/lib/scanner/ferma-giro";
import { giroDelCliente } from "@/lib/scanner/giri";

/**
 * Ferma un giro. Risponde subito: il giro si chiude da solo appena i processi sono morti e il lotto in
 * corso è finito, e chi lo segue lo vede «Fermata». Quello che ha già scritto resta.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  return await withTenantFromSession(async () => {
    const adminCheck = await requireAdmin();
    if (isAuthError(adminCheck)) return adminCheck;
    const { jobId } = await params;
    const giro = getScanProgress(jobId);

    if (!giro || !giroDelCliente(giro, getCurrentTenantCode())) {
      return NextResponse.json({ error: "Scansione non trovata" }, { status: 404 });
    }
    if (giro.status !== "running" || !fermaGiro(jobId)) {
      return NextResponse.json({ error: "Questa attività non si può fermare: è già finita o non è una scansione" }, { status: 409 });
    }
    segnaGiroInArresto(jobId);
    return NextResponse.json({ fermando: true }, { status: 202 });
  });
}
