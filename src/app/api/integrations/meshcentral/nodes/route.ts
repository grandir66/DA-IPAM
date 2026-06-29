/**
 * GET /api/integrations/meshcentral/nodes
 * Lista dei nodi MeshCentral del tenant (inclusi gli 'unmatched'), con join host,
 * per la UI lista nodi / manual-bind. Lettura → requireAuth.
 */
import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { listMeshNodes } from "@/lib/integrations/meshcentral/db";

export async function GET() {
  return withTenantFromSession(async () => {
    const auth = await requireAuth();
    if (isAuthError(auth)) return auth;
    return NextResponse.json({ nodes: listMeshNodes() });
  });
}
