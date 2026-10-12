import { NextResponse } from "next/server";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { getJob } from "@/lib/integrations/job-store";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  // Avanzamento di un'installazione: solo l'admin le lancia (SEC-13).
  const authError = await requireAdmin();
  if (isAuthError(authError)) return authError;

  const { jobId } = await params;
  const job = getJob(jobId);
  if (!job) return NextResponse.json({ error: "Job non trovato" }, { status: 404 });

  return NextResponse.json(job);
}
