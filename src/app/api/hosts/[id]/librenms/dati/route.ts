import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { rispostaDatiHost } from "@/lib/integrations/librenms-rotte";

/**
 * GET /api/hosts/[id]/librenms/dati — i dati che LibreNMS ha dell'oggetto (piano 2026-10-22 LibreNMS, task 5): apparato,
 * porte, vicini, sensori, inventario e lo stato della lettura per parte, dalle tabelle `librenms_*` (nessuna chiamata a
 * LibreNMS). `{ abbinato: false }` se l'oggetto non ha un apparato in LibreNMS.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withTenantFromSession(async () => {
    const s = await requireAuth();
    if (isAuthError(s)) return s;
    const { id } = await params;
    try {
      const r = rispostaDatiHost(id);
      return NextResponse.json(r.corpo, { status: r.status });
    } catch (error) {
      console.error("[librenms] dati dell'host:", error instanceof Error ? error.message : "errore");
      return NextResponse.json({ error: "Errore nella lettura dei dati di LibreNMS" }, { status: 500 });
    }
  });
}
