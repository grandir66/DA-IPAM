/**
 * POST /api/patch/install-meshagent
 *
 * Installa il MeshCentral Agent su un host Windows via WinRM (push).
 * Body: { hostId: number }. serverUrl/meshId presi dalla config tenant
 * (getMeshCreds) dentro l'executor. Idempotente lato target.
 *
 * Auth: patchModuleGuard + requireAdmin.
 */
import { NextResponse } from "next/server";
import { withTenantFromSession } from "@/lib/api-tenant";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { patchModuleGuard, userIdFromSession } from "@/lib/patch/route-guard";
import { executeMeshAgentInstall } from "@/lib/patch/executor";

export type ValidateBodyResult =
  | { ok: true; hostId: number }
  | { ok: false; error: string };

/** Validazione pura del body (testabile senza HTTP). */
export function validateInstallMeshBody(body: unknown): ValidateBodyResult {
  const raw = (body ?? {}) as { hostId?: unknown };
  const hostId = Number(raw.hostId);
  if (!Number.isFinite(hostId) || hostId <= 0) {
    return { ok: false, error: "hostId mancante o non valido" };
  }
  return { ok: true, hostId };
}

export async function POST(request: Request) {
  return withTenantFromSession(async () => {
    const guard = await patchModuleGuard();
    if (isAuthError(guard)) return guard;
    const adminCheck = await requireAdmin();
    if (isAuthError(adminCheck)) return adminCheck;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Body JSON non valido" }, { status: 400 });
    }

    const v = validateInstallMeshBody(body);
    if (!v.ok) {
      return NextResponse.json({ error: v.error }, { status: 400 });
    }

    const userId = userIdFromSession(adminCheck);
    if (userId === null) {
      return NextResponse.json(
        { error: "Sessione senza userId numerico" },
        { status: 400 },
      );
    }

    try {
      const result = await executeMeshAgentInstall({ hostId: v.hostId, userId });
      return NextResponse.json(result, { status: 200 });
    } catch (error) {
      console.error("[patch/install-meshagent POST] errore:", error);
      return NextResponse.json(
        { error: "Errore durante install MeshAgent" },
        { status: 500 },
      );
    }
  });
}
