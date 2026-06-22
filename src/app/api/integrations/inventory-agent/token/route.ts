import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getCurrentTenantCode } from "@/lib/db-tenant";
import {
  generateInventoryIngestToken,
  tenantHasActiveIngestToken,
} from "@/lib/inventory-agent/feature";

const BodySchema = z.object({
  /** true = revoca il token corrente e ne crea uno nuovo (invalida i client deployati). */
  regenerate: z.boolean().optional(),
});

export async function POST(request: Request) {
  return withTenantFromSession(async () => {
    const admin = await requireAdmin();
    if (isAuthError(admin)) return admin;
    const tenantCode = getCurrentTenantCode();
    if (!tenantCode) {
      return NextResponse.json({ error: "Tenant non risolto" }, { status: 400 });
    }

    let regenerate = false;
    try {
      const raw = await request.json();
      const parsed = BodySchema.safeParse(raw);
      if (parsed.success) regenerate = parsed.data.regenerate === true;
    } catch {
      /* body vuoto: prima generazione */
    }

    if (!regenerate && tenantHasActiveIngestToken(tenantCode)) {
      return NextResponse.json(
        {
          error:
            "Esiste già un token ingest attivo. Usa «Rigenera token» solo se devi invalidarlo (perderai i client già configurati).",
          code: "TOKEN_ALREADY_ACTIVE",
        },
        { status: 409 },
      );
    }

    try {
      const token = generateInventoryIngestToken(tenantCode);
      return NextResponse.json({
        token,
        created_at: new Date().toISOString(),
        regenerated: regenerate,
        hint: "Conserva il token: non sarà più mostrato in chiaro. Gli script con token integrato restano scaricabili da «Script installazione».",
      });
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "Errore generazione token" },
        { status: 500 },
      );
    }
  });
}
