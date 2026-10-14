import { NextResponse } from "next/server";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { deleteTopologyLinkPrimary, setTopologyLinkPrimary } from "@/lib/db-tenant";
import { parsePrimaryBody, parsePrimaryDeleteBody } from "@/lib/topology/api-input";
import { actorOf, readJson } from "@/lib/controllers/route-helpers";

/**
 * Collegamento principale scelto a mano (spec §11.3, «★ Rendi principale»): per
 * l'oggetto `node_id` il principale è il collegamento verso `other_node` su quelle
 * porte, e vince sulla scelta del sistema. Vale per tutte le mappe.
 */

/** PUT /api/topology/primary — `{ node_id, other_node, node_port, other_port }` → `{ ok: true }`. Sostituisce la scelta di prima. */
export async function PUT(req: Request) {
  return withTenantFromSession(async () => {
    const s = await requireAdmin();
    if (isAuthError(s)) return s;
    const body = parsePrimaryBody(await readJson(req));
    if (!body.ok) return NextResponse.json({ error: body.error }, { status: 400 });
    try {
      setTopologyLinkPrimary(body.data, actorOf(s) ?? "sconosciuto");
      return NextResponse.json({ ok: true });
    } catch (error) {
      console.error("[topology] principale, scrittura:", error);
      return NextResponse.json({ error: "Errore nel salvataggio del collegamento principale" }, { status: 500 });
    }
  });
}

/**
 * DELETE /api/topology/primary — corpo `{ node_id }` → `{ ok: true }`: il principale
 * torna a sceglierlo il sistema. Se non c'era una scelta risponde lo stesso `{ ok: true }`
 * (il risultato voluto c'è già).
 */
export async function DELETE(req: Request) {
  return withTenantFromSession(async () => {
    const s = await requireAdmin();
    if (isAuthError(s)) return s;
    const body = parsePrimaryDeleteBody(await readJson(req));
    if (!body.ok) return NextResponse.json({ error: body.error }, { status: 400 });
    try {
      deleteTopologyLinkPrimary(body.data.node_id);
      return NextResponse.json({ ok: true });
    } catch (error) {
      console.error("[topology] principale, cancellazione:", error);
      return NextResponse.json({ error: "Errore nel togliere la scelta del collegamento principale" }, { status: 500 });
    }
  });
}
