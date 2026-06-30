/**
 * Toggle del modulo nativo "Inventario NIS2" (voce /services).
 *   GET  → { enabled }   (default true se mai impostato)   requireAuth
 *   POST → { enabled }   imposta tenant_settings            requireAdmin
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getTenantSetting, setTenantSetting } from "@/lib/db-tenant";

const KEY = "nis2_inventory_enabled";

function readEnabled(): boolean {
  const raw = getTenantSetting(KEY);
  return raw === null ? true : raw === "1" || raw === "true";
}

export async function GET() {
  return withTenantFromSession(async () => {
    const auth = await requireAuth();
    if (isAuthError(auth)) return auth;
    return NextResponse.json({ enabled: readEnabled() });
  });
}

export async function POST(req: Request) {
  return withTenantFromSession(async () => {
    const auth = await requireAdmin();
    if (isAuthError(auth)) return auth;
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "JSON non valido" }, { status: 400 });
    }
    const parsed = z.object({ enabled: z.boolean() }).safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
    }
    setTenantSetting(KEY, parsed.data.enabled ? "1" : "0");
    return NextResponse.json({ ok: true, enabled: parsed.data.enabled });
  });
}
