/**
 * GET  /api/integrations/meshcentral/nodes
 *   Lista dei nodi MeshCentral del tenant (inclusi gli 'unmatched'), con join host,
 *   per la UI lista nodi / manual-bind. Lettura → requireAuth. Legge la cache mc_node.
 * POST /api/integrations/meshcentral/nodes
 *   Forza subito un mesh-sync (senza aspettare il job schedulato ogni 15 min) e
 *   ritorna la lista aggiornata. Scrittura → requireAdmin.
 */
import { NextResponse } from "next/server";
import { requireAuth, requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { listMeshNodes } from "@/lib/integrations/meshcentral/db";
import { syncMeshForTenant } from "@/lib/integrations/meshcentral/mesh-sync";

export async function GET() {
  return withTenantFromSession(async () => {
    const auth = await requireAuth();
    if (isAuthError(auth)) return auth;
    return NextResponse.json({ nodes: listMeshNodes() });
  });
}

export async function POST() {
  return withTenantFromSession(async () => {
    const auth = await requireAdmin();
    if (isAuthError(auth)) return auth;
    try {
      const result = await syncMeshForTenant();
      return NextResponse.json({ ok: true, ...result, nodes: listMeshNodes() });
    } catch (e) {
      return NextResponse.json(
        { error: `Sync MeshCentral fallito: ${(e as Error).message}` },
        { status: 502 },
      );
    }
  });
}
