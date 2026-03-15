import { NextRequest, NextResponse } from "next/server";
import { globalSearch } from "@/lib/db";

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q") || "";
  if (q.length < 2) {
    return NextResponse.json({ hosts: [], networks: [] });
  }
  const results = globalSearch(q);
  return NextResponse.json(results);
}
