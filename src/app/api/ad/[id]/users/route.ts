import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { getAdIntegrationById, getAdUsersPaginated } from "@/lib/db";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const auth = await requireAuth();
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

  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get("page") ?? "1", 10);
  const pageSize = parseInt(searchParams.get("pageSize") ?? "50", 10);
  const search = searchParams.get("search") ?? undefined;
  const activeDaysParam = searchParams.get("activeDays");
  const activeDays = activeDaysParam ? parseInt(activeDaysParam, 10) : undefined;

  const { rows, total } = getAdUsersPaginated(numId, page, pageSize, search, activeDays);

  return NextResponse.json({
    rows,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  });
}
