import { NextResponse } from "next/server";
import { getStatusHistory } from "@/lib/db";
import { withTenantFromSession } from "@/lib/api-tenant";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return withTenantFromSession(async () => {
    const { id } = await params;
    const data = getStatusHistory(Number(id), 96);
    return NextResponse.json(data);
  });
}
