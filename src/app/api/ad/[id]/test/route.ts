import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-auth";
import { getAdIntegrationById } from "@/lib/db";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
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

  try {
    const { testAdConnection } = await import("@/lib/ad/ad-client");
    const result = await testAdConnection(numId);
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Errore sconosciuto";
    return NextResponse.json({ success: false, message: msg });
  }
}
