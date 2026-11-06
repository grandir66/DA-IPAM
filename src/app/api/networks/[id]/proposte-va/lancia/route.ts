/**
 * Lancia i gruppi delle proposte confermate della rete su Edge, uno dopo l'altro. Solo a mano e solo
 * l'amministratore, come il POST di `/api/vulnerabilities/scansioni`. Il corpo non si legge: le conferme
 * e gli host si rileggono dal database (al 72729 nove PLC sono spariti dentro una scansione della loro
 * rete, causa non accertata: la rotta non si fida di un elenco di IP che arrivi dal client).
 * Niente interfaccia: la pagina è il Passo 5.
 */
import { NextResponse } from "next/server";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getNetworkById } from "@/lib/db";
import { lanciaGruppiConfermati } from "@/lib/vuln/proposta/lancio";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, { params }: Ctx) {
  const adminCheck = await requireAdmin();
  if (isAuthError(adminCheck)) return adminCheck;
  return withTenantFromSession(async () => {
    const n = Number((await params).id);
    if (!Number.isInteger(n) || n <= 0 || !getNetworkById(n)) return NextResponse.json({ error: "Rete non trovata" }, { status: 404 });
    return NextResponse.json(await lanciaGruppiConfermati(n));
  });
}
