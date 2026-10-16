import { NextResponse } from "next/server";
import { requireAdmin, requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { schemaCaviPresente } from "@/lib/db-tenant";
import { actorOf, NO_STORE, readJson } from "@/lib/controllers/route-helpers";
import { decidiCorpoMappa } from "@/lib/topology/letture/corpo";
import { leggiMappaCavi, scriviMappaCavi } from "@/lib/topology/letture/mappa";

/**
 * La mappa nuova, una linea per cavo (spec topologia §13.11.4, T3.7): GET lo stato dell'interruttore e se lo schema di T2
 * c'è; PUT `{ acceso }` la accende o la spegne, solo un amministratore. Nasce spenta (D4): spenta, la mappa è quella di T1.
 * Chi e quando stanno nel valore scritto (`da`, `il`): è la storia, nessuna riga di log in più.
 */
export async function GET() {
  return withTenantFromSession(async () => {
    const s = await requireAuth();
    if (isAuthError(s)) return s;
    try {
      return NextResponse.json({ stato: leggiMappaCavi(), schema: schemaCaviPresente() }, { headers: NO_STORE });
    } catch (error) {
      console.error("[topology] mappa nuova, stato:", error instanceof Error ? error.message : "errore");
      return NextResponse.json({ error: "Errore nella lettura dello stato della mappa nuova" }, { status: 500 });
    }
  });
}

export async function PUT(req: Request) {
  return withTenantFromSession(async () => {
    const s = await requireAdmin();
    if (isAuthError(s)) return s;
    // Il corpo (strict) e lo schema, solo per accendere: letture/corpo.ts, provato da corpo.test.ts.
    const d = decidiCorpoMappa(await readJson(req), { schemaPresente: schemaCaviPresente });
    if (!d.ok) return NextResponse.json({ error: d.error }, { status: d.status });
    try {
      const stato = scriviMappaCavi(d.dati.acceso, actorOf(s) ?? "amministratore");
      return NextResponse.json({ stato }, { headers: NO_STORE });
    } catch (error) {
      console.error("[topology] mappa nuova, scrittura:", error instanceof Error ? error.message : "errore");
      return NextResponse.json({ error: "Errore nel salvataggio della mappa nuova" }, { status: 500 });
    }
  });
}
