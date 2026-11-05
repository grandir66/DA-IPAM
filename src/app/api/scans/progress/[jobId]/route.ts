import { NextResponse } from "next/server";
import { getScanProgress } from "@/lib/scanner/discovery";
import { giroDelCliente } from "@/lib/scanner/giri";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getCurrentTenantCode } from "@/lib/db";

export async function GET(_request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  return await withTenantFromSession(async () => {
    const authCheck = await requireAuth();
    if (isAuthError(authCheck)) return authCheck;
    const { jobId } = await params;
    const progress = getScanProgress(jobId);

    // Un giro di un altro cliente non esiste, per chi lo chiede: stessa risposta di un id sconosciuto.
    if (!progress || !giroDelCliente(progress, getCurrentTenantCode())) {
      return NextResponse.json({ error: "Scansione non trovata" }, { status: 404 });
    }

    return NextResponse.json(progress);
  });
}
