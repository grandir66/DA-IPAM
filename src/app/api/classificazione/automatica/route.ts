import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { tornaAutomatica } from "@/lib/classification/scrivi";

const Schema = z
  .object({
    hostId: z.number().int().positive().optional(),
    deviceId: z.number().int().positive().optional(),
  })
  .refine((v) => v.hostId !== undefined || v.deviceId !== undefined, { message: "Indica hostId o deviceId" });

/**
 * POST /api/classificazione/automatica { hostId? | deviceId? }
 * «Torna automatica»: toglie la scelta a mano (classification_manual = 0) su host e
 * apparato abbinati. Il valore resta; la prossima scansione può cambiarlo.
 */
export async function POST(request: Request) {
  return withTenantFromSession(async () => {
    try {
      const adminCheck = await requireAdmin();
      if (isAuthError(adminCheck)) return adminCheck;
      const parsed = Schema.safeParse(await request.json().catch(() => null));
      if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Dati non validi" }, { status: 400 });
      }
      tornaAutomatica(getDb(), parsed.data);
      return NextResponse.json({ success: true });
    } catch (error) {
      console.error("Error classificazione automatica:", error);
      return NextResponse.json({ error: "Errore nel ripristino della classificazione automatica" }, { status: 500 });
    }
  });
}
