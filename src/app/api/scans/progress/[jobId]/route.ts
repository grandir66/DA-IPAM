import { NextResponse } from "next/server";
import { getScanProgress } from "@/lib/scanner/discovery";
import { requireAuth, isAuthError } from "@/lib/api-auth";

export async function GET(_request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const authCheck = await requireAuth();
  if (isAuthError(authCheck)) return authCheck;
  const { jobId } = await params;
  const progress = getScanProgress(jobId);

  if (!progress) {
    return NextResponse.json({ error: "Scansione non trovata" }, { status: 404 });
  }

  return NextResponse.json(progress);
}
