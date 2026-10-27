import { NextResponse } from "next/server";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getDb } from "@/lib/db";
import { mostraVoce, utenteDaSessione } from "@/lib/vault/mostra";

/**
 * «Mostra password» di una voce (da-vault, D2): solo admin, con la conferma della verifica in due passaggi ancora
 * valida (5 minuti); ogni visualizzazione va nel registro. Interruttori del vault spenti: 404, come oggi.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withTenantFromSession(async () => {
    const s = await requireAdmin();
    if (isAuthError(s)) return s;
    const id = Number((await params).id);
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Id non valido" }, { status: 400 });
    const e = await mostraVoce({ dbh: getDb(), utente: utenteDaSessione(s), credentialId: id });
    if (!e.ok) return NextResponse.json({ error: e.errore }, { status: e.stato });
    return NextResponse.json(
      { nome: e.nome, campi: e.campi, scade: new Date(e.scade).toISOString() },
      { headers: { "Cache-Control": "no-store" } },
    );
  });
}
