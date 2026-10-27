import { NextResponse } from "next/server";
import { requireAdmin, requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { addSingleNetworkDeviceToLibreNMS } from "@/lib/integrations/librenms-sync";
import { z } from "zod";

const Schema = z.object({
  device_id: z.number().int().positive(),
});

/** POST /api/integrations/librenms/device — aggiunge/aggiorna un NetworkDevice in LibreNMS */
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
      const esito = await addSingleNetworkDeviceToLibreNMS(parsed.data.device_id);
      if (!esito.ok) {
        // Rifiuto di LibreNMS (senza force_add): il motivo arriva a chi ha cliccato, ed è scritto in librenms_rifiuto.
        const testo = esito.codice === "rete" ? esito.messaggio : `LibreNMS ha rifiutato l'aggiunta: ${esito.messaggio}`;
        return NextResponse.json({ error: testo, codice: esito.codice }, { status: 422 });
      }
      return NextResponse.json({ librenms_device_id: esito.librenms_device_id, added: esito.aggiunto });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: msg }, { status: 422 });
    }
  });
}

/** GET /api/integrations/librenms/device — restituisce il mapping IP → device_id per tutti i NetworkDevice */
export async function GET() {
  return withTenantFromSession(async () => {
    const authCheck = await requireAuth();
    if (isAuthError(authCheck)) return authCheck;

    const { getLibreNMSMapForNetworkDevices } = await import("@/lib/integrations/librenms-db");
    const maps = getLibreNMSMapForNetworkDevices();
    return NextResponse.json(maps);
  });
}
