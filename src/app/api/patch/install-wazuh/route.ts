/**
 * POST /api/patch/install-wazuh
 *
 * Installa Wazuh agent su un host Windows via WinRM.
 *
 * Body: { hostId: number, managerHost?: string }
 *
 * managerHost (opzionale): hostname/IP del Wazuh manager. Se omesso, viene
 * derivato da getWazuhConfig().url (hub-level setting). Throw 400 se Wazuh
 * non è configurato e managerHost non è fornito.
 *
 * Idempotente lato target (skip se WazuhSvc già running).
 *
 * Auth: patchModuleGuard + requireAdmin.
 */
import { NextResponse } from "next/server";
import { withTenantFromSession } from "@/lib/api-tenant";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { patchModuleGuard, userIdFromSession } from "@/lib/patch/route-guard";
import { executeWazuhInstall } from "@/lib/patch/executor";
import { getWazuhConfig } from "@/lib/integrations/wazuh-config";

interface InstallWazuhBody {
  hostId?: unknown;
  managerHost?: unknown;
}

/**
 * Estrae l'host da una URL Wazuh manager. Es:
 *   "https://da-wazuh.domarc.it:55000" → "da-wazuh.domarc.it"
 *   "https://192.168.1.10:55000"        → "192.168.1.10"
 *   ""                                  → null
 */
function extractHostFromUrl(url: string): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.hostname || null;
  } catch {
    // Fallback: stringa libera, prendi prima del primo ':'
    const trimmed = url.trim().replace(/^https?:\/\//, "");
    const host = trimmed.split(/[/:]/)[0];
    return host || null;
  }
}

const NO_CACHE_HEADERS = { "Cache-Control": "no-store, no-cache, must-revalidate" };

/**
 * GET /api/patch/install-wazuh
 * Ritorna `{ configured, managerHost }` per consentire alla UI di abilitare/
 * disabilitare il bottone install Wazuh prima di tentare la POST.
 * Auth: patchModuleGuard (lettura).
 */
export async function GET() {
  return withTenantFromSession(async () => {
    const guard = await patchModuleGuard();
    if (isAuthError(guard)) return guard;
    const cfg = getWazuhConfig();
    const managerHost = extractHostFromUrl(cfg.url);
    return NextResponse.json(
      { configured: !!managerHost, managerHost: managerHost ?? null },
      { headers: NO_CACHE_HEADERS }
    );
  });
}

export async function POST(request: Request) {
  return withTenantFromSession(async () => {
    const guard = await patchModuleGuard();
    if (isAuthError(guard)) return guard;
    const adminCheck = await requireAdmin();
    if (isAuthError(adminCheck)) return adminCheck;

    let body: InstallWazuhBody;
    try {
      body = (await request.json()) as InstallWazuhBody;
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

    // managerHost: dal body o derivato da getWazuhConfig()
    let managerHost: string | null = null;
    if (typeof body.managerHost === "string" && body.managerHost.trim()) {
      managerHost = body.managerHost.trim();
    } else {
      const cfg = getWazuhConfig();
      managerHost = extractHostFromUrl(cfg.url);
    }
    if (!managerHost) {
      return NextResponse.json(
        {
          error:
            "Wazuh manager non configurato (Integrazioni → Wazuh). Specifica managerHost esplicito nel body o configura prima il manager.",
        },
        { status: 400 }
      );
    }

    const userId = userIdFromSession(adminCheck);
    if (userId === null) {
      return NextResponse.json(
        { error: "Sessione senza userId numerico" },
        { status: 500 }
      );
    }

    try {
      const result = await executeWazuhInstall({
        hostId,
        userId,
        managerHost,
      });
      return NextResponse.json(result, { status: 200 });
    } catch (error) {
      console.error("[patch/install-wazuh POST] errore:", error);
      return NextResponse.json(
        { error: "Errore durante install Wazuh agent" },
        { status: 500 }
      );
    }
  });
}
