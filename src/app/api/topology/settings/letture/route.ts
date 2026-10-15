import { NextResponse } from "next/server";
import { requireAdmin, requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { cadenzaLetture, getNetworkDevices, schemaCaviPresente } from "@/lib/db-tenant";
import { actorOf, NO_STORE, readJson } from "@/lib/controllers/route-helpers";
import { LETTURE, LETTURE_DISPONIBILI, leggiEsiti, leggiInterruttore, scriviInterruttore } from "@/lib/topology/letture/interruttori";
import { decidiCorpoLetture } from "@/lib/topology/letture/corpo";

/**
 * Letture in più per la mappa (spec topologia §13.5.6): GET lo stato di ogni lettura, l'esito per apparato, la cadenza
 * vera e se lo schema c'è; PUT `{ lettura, acceso }` le accende o le spegne, solo un amministratore. Spente di default.
 */
export async function GET() {
  return withTenantFromSession(async () => {
    const s = await requireAuth();
    if (isAuthError(s)) return s;
    try {
      const nomi = new Map(getNetworkDevices().map((d) => [d.id, d.name]));
      const letture = LETTURE.map((l) => {
        const esiti = leggiEsiti(l);
        return {
          lettura: l,
          disponibile: LETTURE_DISPONIBILI.has(l),
          stato: leggiInterruttore(l),
          esiti,
          nomi: Object.fromEntries(Object.keys(esiti).map((id) => [id, nomi.get(Number(id)) ?? `apparato #${id}`])),
        };
      });
      return NextResponse.json({ letture, schema: schemaCaviPresente(), cadenza: cadenzaLetture() }, { headers: NO_STORE });
    } catch (error) {
      console.error("[topology] letture in più, stato:", error instanceof Error ? error.message : "errore");
      return NextResponse.json({ error: "Errore nella lettura dello stato delle letture in più" }, { status: 500 });
    }
  });
}

export async function PUT(req: Request) {
  return withTenantFromSession(async () => {
    const s = await requireAdmin();
    if (isAuthError(s)) return s;
    // Il corpo (strict), la lettura disponibile e lo schema, solo per accendere: letture/corpo.ts, provato da corpo.test.ts (M6).
    const d = decidiCorpoLetture(await readJson(req), { schemaPresente: schemaCaviPresente });
    if (!d.ok) return NextResponse.json({ error: d.error }, { status: d.status });
    const { lettura, acceso } = d.dati;
    try {
      const stato = scriviInterruttore(lettura, acceso, actorOf(s) ?? "amministratore");
      return NextResponse.json({ lettura, stato }, { headers: NO_STORE });
    } catch (error) {
      console.error("[topology] letture in più, scrittura:", error instanceof Error ? error.message : "errore");
      return NextResponse.json({ error: "Errore nel salvataggio della lettura" }, { status: 500 });
    }
  });
}
