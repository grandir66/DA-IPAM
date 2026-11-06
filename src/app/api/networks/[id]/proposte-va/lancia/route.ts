/**
 * Lancia i gruppi delle proposte confermate della rete su Edge, uno dopo l'altro. Solo a mano e solo
 * l'amministratore, come il POST di `/api/vulnerabilities/scansioni`. Dall'indirizzo arrivano solo le
 * famiglie spuntate, obbligatorie: una richiesta senza non diventa «tutte». Il corpo non si legge: conferme e host si rileggono dal database
 * (al 72729 nove PLC sono spariti dentro una scansione della loro rete, causa non accertata: la rotta non
 * si fida di un elenco di IP che arrivi dal client).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getNetworkById } from "@/lib/db";
import { lanciaGruppiConfermati } from "@/lib/vuln/proposta/lancio";

type Ctx = { params: Promise<{ id: string }> };

const Famiglie = z.array(z.enum(["rete", "windows", "linux", "web", "periferiche"])).min(1, "Scegli almeno un gruppo");

export async function POST(req: Request, { params }: Ctx) {
  const adminCheck = await requireAdmin();
  if (isAuthError(adminCheck)) return adminCheck;
  return withTenantFromSession(async () => {
    const n = Number((await params).id);
    if (!Number.isInteger(n) || n <= 0 || !getNetworkById(n)) return NextResponse.json({ error: "Rete non trovata" }, { status: 404 });
    const scelte = (new URL(req.url).searchParams.get("famiglie") ?? "").split(",").filter(Boolean);
    const parsed = Famiglie.safeParse(scelte);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Famiglie non valide" }, { status: 400 });
    const esito = await lanciaGruppiConfermati(n, {}, { famiglie: parsed.data });
    return NextResponse.json(esito.errore ? { ...esito, error: esito.errore } : esito, { status: esito.errore ? 502 : 200 });
  });
}
