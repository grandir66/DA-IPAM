import { NextRequest, NextResponse } from "next/server";
import { globalSearch } from "@/lib/db";
import { auth } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  }

  const q = request.nextUrl.searchParams.get("q") || "";
  if (q.length < 2) {
    return NextResponse.json({ hosts: [], networks: [] });
  }
  const results = globalSearch(q);
  return NextResponse.json(results);
}
