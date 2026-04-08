import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { isDockerAvailable } from "@/lib/integrations/docker";

export async function GET(req: Request) {
  const authError = await requireAuth();
  if (isAuthError(authError)) return authError;

  const available = await isDockerAvailable();
  return NextResponse.json({ available });
}
