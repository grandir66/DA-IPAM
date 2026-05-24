/**
 * GET /api/software/[key]/hosts
 *
 * Drill-down: lista completa degli host con un determinato software.
 * `key` è URL-encoded `name|version` (lowercase). Per la fonte Greenbone
 * (best-effort senza version) la chiave avrà version vuota.
 */

import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getSoftwareHostsByKey } from "@/lib/db-tenant";

export async function GET(
  request: Request,
  ctx: { params: Promise<{ key: string }> },
) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  const { key: rawKey } = await ctx.params;
  const key = decodeURIComponent(rawKey);
  if (!key || key.length > 400 || !key.includes("|")) {
    return NextResponse.json({ error: "key non valida" }, { status: 400 });
  }

  const url = new URL(request.url);
  const limitRaw = Number(url.searchParams.get("limit") ?? "500");
  const limit = Number.isFinite(limitRaw)
    ? Math.min(2000, Math.max(1, Math.floor(limitRaw)))
    : 500;

  return withTenantFromSession(() => {
    try {
      const hosts = getSoftwareHostsByKey(key, limit);
      return NextResponse.json({ key, hosts, total: hosts.length });
    } catch (e) {
      console.error("[api/software/[key]/hosts] errore:", e);
      return NextResponse.json(
        { error: "Errore nel recupero degli host" },
        { status: 500 },
      );
    }
  });
}
