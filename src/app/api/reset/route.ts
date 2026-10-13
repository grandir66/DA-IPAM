import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSuperAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getCurrentTenantCode } from "@/lib/db-tenant";
import { resetTenantConCopia, ResetRifiutato } from "@/lib/reset/reset-tenant";

const Corpo = z.object({ conferma: z.string().min(1) });

export async function POST(request: Request) {
  const check = await requireSuperAdmin();
  if (isAuthError(check)) return check;
  return withTenantFromSession(async () => {
    let corpo: unknown;
    try {
      corpo = await request.json();
    } catch {
      return NextResponse.json({ error: "Scrivi il codice del cliente per confermare" }, { status: 400 });
    }
    const parsed = Corpo.safeParse(corpo);
    if (!parsed.success) {
      return NextResponse.json({ error: "Scrivi il codice del cliente per confermare" }, { status: 400 });
    }
    try {
      const copia = await resetTenantConCopia(getCurrentTenantCode() ?? "", parsed.data.conferma);
      return NextResponse.json({ success: true, message: "Configurazione resettata", copia });
    } catch (error) {
      if (error instanceof ResetRifiutato) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      console.error("Reset configurazione: errore", error instanceof Error ? error.message : error);
      return NextResponse.json({ error: "Errore durante il reset: niente è stato cancellato" }, { status: 500 });
    }
  });
}
