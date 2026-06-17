import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getCurrentTenantCode } from "@/lib/db-tenant";
import {
  installNetServices,
  uninstallNetServices,
  getNetServicesState,
} from "@/lib/network-services/feature";

const SetupSchema = z.object({
  apiUrl: z.string().url("apiUrl deve essere un URL valido (https://host:port)"),
  apiToken: z.string().min(8, "token troppo corto"),
});

/**
 * GET — stato corrente feature (per setup page + status indicator)
 */
export async function GET() {
  return withTenantFromSession(async () => {
    const auth = await requireAdmin();
    if (isAuthError(auth)) return auth;
    const tenantCode = getCurrentTenantCode();
    if (!tenantCode) return NextResponse.json({ error: "Tenant non risolto" }, { status: 400 });

    const state = await getNetServicesState(tenantCode);
    return NextResponse.json({
      installed: state.enabled,
      configured: state.configured,
      apiUrl: state.apiUrl,
      // NB: il token NON viene mai restituito plain — solo flag presente/assente
      hasToken: state.apiToken.length > 0,
      enabledAt: state.enabledAt,
    });
  });
}

/**
 * POST — install + config (o re-config se già installato).
 * Cifra il token AES-GCM in tenant_features.config_json.
 */
export async function POST(req: Request) {
  return withTenantFromSession(async () => {
    const auth = await requireAdmin();
    if (isAuthError(auth)) return auth;
    const tenantCode = getCurrentTenantCode();
    if (!tenantCode) return NextResponse.json({ error: "Tenant non risolto" }, { status: 400 });

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    const parsed = SetupSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
    }

    const session = auth as { user?: { id?: number } };
    const userId = typeof session.user?.id === "number" ? session.user.id : null;

    try {
      installNetServices(tenantCode, userId, {
        apiUrl: parsed.data.apiUrl,
        apiToken: parsed.data.apiToken,
      });
      return NextResponse.json({ ok: true, message: "Modulo Network Services installato" });
    } catch (e) {
      return NextResponse.json({ error: String(e) }, { status: 500 });
    }
  });
}

/**
 * DELETE — uninstall (disabilita feature, mantiene riga per audit, azzera config).
 */
export async function DELETE() {
  return withTenantFromSession(async () => {
    const auth = await requireAdmin();
    if (isAuthError(auth)) return auth;
    const tenantCode = getCurrentTenantCode();
    if (!tenantCode) return NextResponse.json({ error: "Tenant non risolto" }, { status: 400 });

    try {
      uninstallNetServices(tenantCode);
      return NextResponse.json({ ok: true, message: "Modulo disinstallato" });
    } catch (e) {
      return NextResponse.json({ error: String(e) }, { status: 500 });
    }
  });
}
