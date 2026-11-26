import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { NO_STORE, readJson } from "@/lib/controllers/route-helpers";
import { elencoOggetti, NOME_MASSIMO, NOTA_MASSIMA, salvaOggetto, togliOggetto } from "@/lib/traffico/oggetti";

const Oggetto = z.object({ chiave: z.string().min(7).max(18), nome: z.string().min(1).max(NOME_MASSIMO), nota: z.string().max(NOTA_MASSIMA).optional() });
const MOTIVI: Record<string, string> = {
  chiave: "Rete o indirizzo non valido: serve un IPv4, con prefisso da 8 a 32",
  nome: "Il nome non può essere vuoto",
  censita: "Questa rete è già censita fra le subnet: ha già il suo nome",
  troppi: "Troppi oggetti con nome",
};

/** GET /api/traffico/oggetti — le reti e gli indirizzi a cui è stato dato un nome (non sono subnet censite). */
export async function GET() {
  const s = await requireAuth();
  if (isAuthError(s)) return s;
  return withTenantFromSession(() => NextResponse.json({ oggetti: elencoOggetti() }, { headers: NO_STORE }));
}

/** PUT /api/traffico/oggetti — `{ chiave, nome, nota? }`: dà o cambia il nome di una rete o di un indirizzo visto nel traffico. */
export async function PUT(req: Request) {
  const s = await requireAdmin();
  if (isAuthError(s)) return s;
  return withTenantFromSession(async () => {
    const dati = Oggetto.safeParse(await readJson(req));
    if (!dati.success) return NextResponse.json({ error: "Dati non validi", campi: dati.error.issues.map((i) => i.path.join(".")) }, { status: 400 });
    const esito = salvaOggetto({ ...dati.data, chi: s.user.name ?? "" });
    if (!esito.ok) return NextResponse.json({ error: MOTIVI[esito.motivo] }, { status: 400 });
    return NextResponse.json({ oggetto: esito.oggetto }, { headers: NO_STORE });
  });
}

/** DELETE /api/traffico/oggetti?chiave= — toglie il nome; gli indirizzi tornano «Rete non censita». */
export async function DELETE(req: Request) {
  const s = await requireAdmin();
  if (isAuthError(s)) return s;
  return withTenantFromSession(() => {
    const chiave = new URL(req.url).searchParams.get("chiave") ?? "";
    if (!togliOggetto(chiave)) return NextResponse.json({ error: "Oggetto non trovato" }, { status: 404 });
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  });
}
