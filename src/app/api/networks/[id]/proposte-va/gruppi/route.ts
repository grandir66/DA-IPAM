/** A che punto sono i gruppi dell'ultimo lancio della rete. Solo lettura. */
import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getNetworkById } from "@/lib/db";
import { leggiGruppiAperti } from "@/lib/vuln/proposta/gruppi-aperti";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const authCheck = await requireAuth();
  if (isAuthError(authCheck)) return authCheck;
  return withTenantFromSession(async () => {
    const n = Number((await params).id);
    if (!Number.isInteger(n) || n <= 0 || !getNetworkById(n)) return NextResponse.json({ error: "Rete non trovata" }, { status: 404 });
    return NextResponse.json(await leggiGruppiAperti(n));
  });
}
