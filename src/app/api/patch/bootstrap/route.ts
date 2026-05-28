/**
 * POST /api/patch/bootstrap
 *
 * Installa Chocolatey su un host Windows via WinRM (awaited ~60-120s).
 * Body: { hostId: number, cveId?: string }
 *
 * Risposta: BootstrapResult { operationId, chocoVersion, success }
 *
 * Solo admin.
 */
import { NextResponse } from "next/server";
import { withTenantFromSession } from "@/lib/api-tenant";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { patchModuleGuard, userIdFromSession } from "@/lib/patch/route-guard";
import { executeBootstrap } from "@/lib/patch/executor";

interface BootstrapBody {
  hostId?: unknown;
  cveId?: unknown;
}

export async function POST(request: Request) {
  return withTenantFromSession(async () => {
    const guard = await patchModuleGuard();
    if (isAuthError(guard)) return guard;

    const adminCheck = await requireAdmin();
    if (isAuthError(adminCheck)) return adminCheck;

    let body: BootstrapBody;
    try {
      body = (await request.json()) as BootstrapBody;
    } catch {
      return NextResponse.json({ error: "Body JSON non valido" }, { status: 400 });
    }

    const hostId = Number(body.hostId);
    if (!Number.isFinite(hostId) || hostId <= 0) {
      return NextResponse.json(
        { error: "hostId mancante o non valido" },
        { status: 400 }
      );
    }
    const cveId =
      typeof body.cveId === "string" && body.cveId.trim().length > 0
        ? body.cveId.trim()
        : null;

    const userId = userIdFromSession(adminCheck);
    if (userId === null) {
      return NextResponse.json(
        { error: "Sessione senza userId numerico" },
        { status: 500 }
      );
    }

    try {
      const result = await executeBootstrap({ hostId, userId, cveId });
      return NextResponse.json(result);
    } catch (error) {
      console.error("[patch/bootstrap POST] errore:", error);
      return NextResponse.json(
        { error: "Errore durante il bootstrap Chocolatey" },
        { status: 500 }
      );
    }
  });
}
