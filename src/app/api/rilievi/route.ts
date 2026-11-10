/**
 * GET /api/rilievi — elenco unico Findings (CVE + trunk + giri).
 */
import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { FONTI_RILIEVO, type FonteRilievo } from "@/lib/rilievi/tipi";
import { elencoRilievi } from "@/lib/rilievi/unione";
import { SEVERITIES, type Severity } from "@/lib/severity-style";

export async function GET(request: Request) {
  const session = await requireAuth();
  if (isAuthError(session)) return session;
  return withTenantFromSession(() => {
    const q = new URL(request.url).searchParams;
    const fonti = q.get("fonte")
      ?.split(",")
      .map((s) => s.trim())
      .filter((s): s is FonteRilievo => (FONTI_RILIEVO as readonly string[]).includes(s));
    const gravita = q.get("gravita")
      ?.split(",")
      .map((s) => s.trim())
      .filter((s): s is Severity => (SEVERITIES as readonly string[]).includes(s));
    const page = Number(q.get("page") ?? 1);
    const pageSize = Number(q.get("pageSize") ?? 50);
    return NextResponse.json(
      elencoRilievi({
        fonti,
        gravita,
        q: q.get("q") ?? undefined,
        page: Number.isInteger(page) ? page : 1,
        pageSize: Number.isInteger(pageSize) ? pageSize : 50,
      }),
    );
  });
}
