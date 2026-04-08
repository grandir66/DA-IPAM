import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { batchRefingerPrintAsync } from "@/lib/analytics/batch-refingerprint";
import { z } from "zod";

const Schema = z.object({
  network_id: z.number().int().positive(),
});

export async function POST(req: NextRequest) {
  const session = await requireAdmin();
  if (isAuthError(session)) return session;

  return withTenantFromSession(async () => {
    const body = await req.json();
    const parsed = Schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "network_id obbligatorio" }, { status: 400 });
    }

    const result = await batchRefingerPrintAsync(parsed.data.network_id);
    return NextResponse.json(result);
  });
}
