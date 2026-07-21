/**
 * POST /api/ssh-terminal/token  { hostId }
 *
 * Emette un token effimero per aprire il terminale SSH interattivo (WebSocket
 * /ws/ssh). Verifica requireAdmin + tenant + presenza credenziali SSH per l'host.
 * Il token è host-bound e scade in ~60s (il tempo di aprire il WS).
 */
import { NextResponse } from "next/server";
import { withTenantFromSession } from "@/lib/api-tenant";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { userIdFromSession } from "@/lib/patch/route-guard";
import { getTenantDb, getCurrentTenantCode } from "@/lib/db-tenant";
import { loadSshCredentialsForHost } from "@/lib/patch/credentials";
import { signSshToken } from "@/lib/ssh-terminal/token";

export async function POST(request: Request) {
  return withTenantFromSession(async () => {
    const adminCheck = await requireAdmin();
    if (isAuthError(adminCheck)) return adminCheck;

    let body: { hostId?: unknown };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return NextResponse.json({ error: "Body JSON non valido" }, { status: 400 });
    }
    const hostId = Number(body.hostId);
    if (!Number.isFinite(hostId) || hostId <= 0) {
      return NextResponse.json({ error: "hostId non valido" }, { status: 400 });
    }

    const tenantCode = getCurrentTenantCode() ?? "DEFAULT";
    const creds = loadSshCredentialsForHost(getTenantDb(tenantCode), hostId);
    if (!creds) {
      return NextResponse.json(
        { error: "Nessuna credenziale SSH salvata per questo host" },
        { status: 400 },
      );
    }

    const userId = userIdFromSession(adminCheck);
    if (userId === null) {
      return NextResponse.json({ error: "Sessione senza userId numerico" }, { status: 500 });
    }

    const token = signSshToken({ hostId, tenantCode, userId });
    return NextResponse.json({ token, host: creds.host, username: creds.username });
  });
}
