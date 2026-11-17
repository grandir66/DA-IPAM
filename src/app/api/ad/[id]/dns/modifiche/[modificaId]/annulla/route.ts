import { NextResponse } from "next/server";
import { z } from "zod";
import { withTenantFromSession } from "@/lib/api-tenant";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { accessoDnsDi } from "@/lib/ad/dns/accesso";
import { annullaModifica } from "@/lib/ad/dns/esecuzione";
import { chi, corpoJson, integrazioneDa } from "@/lib/ad/dns/rotte";

type Params = { params: Promise<{ id: string; modificaId: string }> };
const Corpo = z.object({ conferma: z.literal(true) });

/** Annulla una modifica riuscita: rimette il record tolto o toglie quello aggiunto, con le stesse garanzie. */
export async function POST(request: Request, { params }: Params) {
  return withTenantFromSession(async () => {
    const sessione = await requireAdmin();
    if (isAuthError(sessione)) return sessione;
    const integrazione = await integrazioneDa(params);
    if (integrazione instanceof NextResponse) return integrazione;
    const accesso = accessoDnsDi(integrazione);
    if (!accesso.ok) return NextResponse.json({ error: accesso.motivo }, { status: 403 });
    if (!Corpo.safeParse(await corpoJson(request)).success) return NextResponse.json({ error: "Serve la conferma" }, { status: 400 });
    const modificaId = Number.parseInt((await params).modificaId, 10);
    if (!Number.isInteger(modificaId)) return NextResponse.json({ error: "Modifica non valida" }, { status: 400 });
    try {
      return NextResponse.json(await annullaModifica(integrazione, modificaId, chi(sessione)));
    } catch (errore) {
      return NextResponse.json({ error: errore instanceof Error ? errore.message : "Annullamento non riuscito" }, { status: 400 });
    }
  });
}
