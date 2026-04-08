import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { getJob } from "@/lib/integrations/job-store";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const authError = await requireAuth();
  if (isAuthError(authError)) return authError;

  const { jobId } = await params;
  const job = getJob(jobId);
  if (!job) return NextResponse.json({ error: "Job non trovato" }, { status: 404 });

  return NextResponse.json(job);
}
