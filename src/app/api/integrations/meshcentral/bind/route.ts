/**
 * POST /api/integrations/meshcentral/bind  { nodeId, hostId }
 * Associa manualmente un nodo MeshCentral a un host DA-IPAM (match_status='manual',
 * preservato dai re-sync). Mutazione → requireAdmin. Audit in mc_node_bind.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { bindNodeToHost } from "@/lib/integrations/meshcentral/db";

const schema = z.object({
  nodeId: z.string().min(1),
  hostId: z.number().int().positive(),
});

export async function POST(request: Request) {
  return withTenantFromSession(async () => {
    const auth = await requireAdmin();
    if (isAuthError(auth)) return auth;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
    }

    const operator = auth.user.email ?? "unknown";
    const res = bindNodeToHost(parsed.data.nodeId, parsed.data.hostId, operator);
    if (!res.ok) {
      return NextResponse.json({ error: res.error }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  });
}
