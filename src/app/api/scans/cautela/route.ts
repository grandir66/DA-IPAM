/**
 * GET /api/scans/cautela?reti=1,2 — impianti ed esclusi a mano che un giro interno non tocca.
 */
import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { cautelaDelleReti } from "@/lib/vuln/cautela-interna";

export async function GET(request: Request) {
  const sessione = await requireAuth();
  if (isAuthError(sessione)) return sessione;
  const ids = (new URL(request.url).searchParams.get("reti") ?? "")
    .split(",")
    .map((s) => Number(s))
    .filter((n) => Number.isInteger(n) && n > 0)
    .slice(0, 64);
  return withTenantFromSession(() => NextResponse.json({ reti: cautelaDelleReti(ids) }));
}
