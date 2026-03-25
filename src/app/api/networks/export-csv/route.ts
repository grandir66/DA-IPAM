import { NextResponse } from "next/server";
import { z } from "zod";
import { buildSubnetHostsExportCsv } from "@/lib/subnet-hosts-export";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";

const BodySchema = z.object({
  network_ids: z
    .array(z.number().int().positive())
    .min(1, "Seleziona almeno una subnet")
    .max(200, "Massimo 200 subnet per export"),
});

/**
 * Export CSV completo degli host delle subnet selezionate (metadati rete + tutti i campi host).
 * POST /api/networks/export-csv — body: { network_ids: number[] }
 */
export async function POST(request: Request) {
  return withTenantFromSession(async () => {
    const auth = await requireAuth();
    if (isAuthError(auth)) return auth;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "JSON non valido" }, { status: 400 });
    }

    const parsed = BodySchema.safeParse(body);
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? "Richiesta non valida";
      return NextResponse.json({ error: msg }, { status: 400 });
    }

    const { csv } = buildSubnetHostsExportCsv(parsed.data.network_ids);

    const date = new Date().toISOString().slice(0, 10);
    const filename = `subnet-hosts-export-${date}.csv`;

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  });
}
