/** Quanto è avanti la proposta di ogni rete, per l'elenco della scheda «Per device». Solo lettura. */
import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { contiPropostePerRete } from "@/lib/vuln/proposta/store";

export async function GET() {
  const authCheck = await requireAuth();
  if (isAuthError(authCheck)) return authCheck;
  return withTenantFromSession(async () => NextResponse.json({ conti: contiPropostePerRete() }));
}
