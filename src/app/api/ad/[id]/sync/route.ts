import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getAdIntegrationById } from "@/lib/db";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  return withTenantFromSession(async () => {
    const { id } = await params;
    const numId = parseInt(id, 10);
    if (isNaN(numId)) {
      return NextResponse.json({ error: "ID non valido" }, { status: 400 });
    }

    const integration = getAdIntegrationById(numId);
    if (!integration) {
      return NextResponse.json({ error: "Integrazione non trovata" }, { status: 404 });
    }

    return NextResponse.json({
      last_sync_at: integration.last_sync_at,
      last_sync_status: integration.last_sync_status,
      computers_count: integration.computers_count,
      users_count: integration.users_count,
      groups_count: integration.groups_count,
    });
  });
}

export async function POST(request: Request, { params }: Params) {
  return withTenantFromSession(async () => {
    const auth = await requireAdmin();
    if (auth instanceof NextResponse) return auth;

    const { id } = await params;
  const numId = parseInt(id, 10);
  if (isNaN(numId)) {
    return NextResponse.json({ error: "ID non valido" }, { status: 400 });
  }

  const integration = getAdIntegrationById(numId);
  if (!integration) {
    return NextResponse.json({ error: "Integrazione non trovata" }, { status: 404 });
  }

  if (!integration.enabled) {
    return NextResponse.json({ error: "Integrazione disabilitata" }, { status: 400 });
  }

  try {
    const { syncActiveDirectory } = await import("@/lib/ad/ad-client");
    const result = await syncActiveDirectory(numId);
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Errore sconosciuto";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
  });
}
