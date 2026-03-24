import { NextResponse } from "next/server";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getAdDhcpLeasesPaginated } from "@/lib/db";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  return withTenantFromSession(async () => {
    const { id } = await params;
  const numId = parseInt(id, 10);
  if (isNaN(numId)) {
    return NextResponse.json({ error: "ID non valido" }, { status: 400 });
  }

  const { searchParams } = new URL(request.url);
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get("pageSize") ?? "25", 10)));
  const search = searchParams.get("search") ?? undefined;

  const result = getAdDhcpLeasesPaginated(numId, page, pageSize, search);
  return NextResponse.json(result);
  });
}
