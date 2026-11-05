/**
 * POST /api/hosts/conferma-rivisti — «ho guardato, va bene»: svuota il segno
 * «da rivedere» sugli host scelti e sui loro apparati.
 *
 *   { "hostIds": [12, 13], "campi": ["model"] }   // `campi` assente = tutti
 *   → 200 { "host": 2, "apparati": 1 }
 *
 * Confermare **non cambia nessun dato**: i valori che il profilo ha scritto
 * restano come sono, sparisce solo il segno. Rifiutare un valore si fa dalla
 * scheda o dalla tabella svuotando il campo, ed e' un'altra azione.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getTenantDb, getCurrentTenantCode } from "@/lib/db-tenant";
import { togliDaRivedere } from "@/lib/scanner/profili/propaga-apparato";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Corpo = z.object({
  hostIds: z.array(z.number().int().positive()).min(1).max(2000),
  campi: z.array(z.string().min(1).max(40)).optional(),
});

export async function POST(req: Request) {
  /* Admin: conferma in blocco che tocca host e apparati di tutta la subnet. La prova
   * del censimento delle rotte (`permessi/rotte-censite.test.ts`) lo chiede per ogni
   * POST che scrive, e qui e' giusto: curare l'inventario non e' una lettura. */
  const session = await requireAdmin();
  if (isAuthError(session)) return session;

  return withTenantFromSession(async () => {
    let grezzo: unknown;
    try {
      grezzo = await req.json();
    } catch {
      return NextResponse.json({ error: "JSON non valido" }, { status: 400 });
    }
    const p = Corpo.safeParse(grezzo);
    if (!p.success) {
      return NextResponse.json({ error: "servono hostIds (numeri) e, se si vuole, campi" }, { status: 400 });
    }

    const code = getCurrentTenantCode();
    if (!code) return NextResponse.json({ error: "tenant non risolto" }, { status: 500 });

    try {
      const db = getTenantDb(code);
      const esito = togliDaRivedere(db, p.data.hostIds, p.data.campi);
      return NextResponse.json(esito, { headers: { "Cache-Control": "no-store" } });
    } catch (e) {
      console.error("[conferma-rivisti] non riuscita:", e);
      return NextResponse.json({ error: "conferma non riuscita" }, { status: 500 });
    }
  });
}
