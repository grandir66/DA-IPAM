import { NextResponse } from "next/server";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { addSingleHostToLibreNMS } from "@/lib/integrations/librenms-sync";
import { z } from "zod";

const Schema = z.object({
  host_id: z.number().int().positive(),
});

/** POST /api/integrations/librenms/host — aggiunge/aggiorna un singolo host in LibreNMS */
export async function POST(req: Request) {
  return withTenantFromSession(async () => {
    const adminCheck = await requireAdmin();
    if (isAuthError(adminCheck)) return adminCheck;

    let body: unknown = {};
    try { body = await req.json(); } catch { /* body vuoto */ }

    const parsed = Schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Dati non validi" }, { status: 400 });
    }

    try {
      const result = await addSingleHostToLibreNMS(parsed.data.host_id);
      return NextResponse.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: msg }, { status: 422 });
    }
  });
}
