/**
 * POST /api/patch/install-meshagent-choco
 *
 * Installa il MeshCentral Agent come PACCHETTO CHOCOLATEY configurato
 * (`domarc-meshagent`) su un host Windows via WinRM. serverUrl/meshId presi dalla
 * config tenant. Diverso da /install-meshagent (download diretto): qui il
 * lifecycle è gestito da Chocolatey.
 *
 * Body: { hostId: number }. Auth: patchModuleGuard + requireAdmin.
 */
import { NextResponse } from "next/server";
import { withTenantFromSession } from "@/lib/api-tenant";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { patchModuleGuard, userIdFromSession } from "@/lib/patch/route-guard";
import { executeMeshAgentChocoInstall } from "@/lib/patch/executor";
import { validateInstallMeshBody } from "@/app/api/patch/install-meshagent/route";

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
      return NextResponse.json({ error: "Sessione senza userId numerico" }, { status: 400 });
    }

    try {
      const result = await executeMeshAgentChocoInstall({ hostId: v.hostId, userId });
      return NextResponse.json(result, { status: 200 });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Errore install choco MeshAgent" },
        { status: 500 },
      );
    }
  });
}
