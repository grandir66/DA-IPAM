import { NextResponse } from "next/server";
import { getStatusHistory } from "@/lib/db";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const data = getStatusHistory(Number(id), 96);
  return NextResponse.json(data);
}
