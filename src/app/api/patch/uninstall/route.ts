/**
 * POST /api/patch/uninstall
 *
 * Disinstalla un software su un host Windows via WinRM (awaited).
 * Body: { hostId: number, name: string, chocoId?: string }
 *   - chocoId presente → `choco uninstall <id>`
 *   - altrimenti       → uninstall silenzioso da registro per DisplayName == name
 * Risposta: { operationId, status }. Solo admin.
 */
import { NextResponse } from "next/server";
import { withTenantFromSession } from "@/lib/api-tenant";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { patchModuleGuard, userIdFromSession } from "@/lib/patch/route-guard";
import { executeUninstall } from "@/lib/patch/executor";

interface UninstallBody {
  hostId?: unknown;
  name?: unknown;
  chocoId?: unknown;
}

export async function POST(request: Request) {
  return withTenantFromSession(async () => {
    const guard = await patchModuleGuard();
    if (isAuthError(guard)) return guard;

    const adminCheck = await requireAdmin();
    if (isAuthError(adminCheck)) return adminCheck;

    let body: UninstallBody;
    try {
      body = (await request.json()) as UninstallBody;
    } catch {
      return NextResponse.json({ error: "Body JSON non valido" }, { status: 400 });
    }

    const hostId = Number(body.hostId);
    if (!Number.isFinite(hostId) || hostId <= 0) {
      return NextResponse.json({ error: "hostId mancante o non valido" }, { status: 400 });
    }
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const chocoId =
      typeof body.chocoId === "string" && body.chocoId.trim().length > 0
        ? body.chocoId.trim()
        : null;
    if (!name && !chocoId) {
      return NextResponse.json({ error: "name o chocoId richiesto" }, { status: 400 });
    }

    const userId = userIdFromSession(adminCheck);
    if (userId === null) {
      return NextResponse.json({ error: "Sessione senza userId numerico" }, { status: 500 });
    }

    try {
      const result = await executeUninstall({
        hostId,
        userId,
        name: name || (chocoId as string),
        chocoId,
      });
      return NextResponse.json(result);
    } catch (error) {
      console.error("[patch/uninstall POST] errore:", error);
      return NextResponse.json(
        { error: "Errore durante la disinstallazione" },
        { status: 500 },
      );
    }
  });
}
