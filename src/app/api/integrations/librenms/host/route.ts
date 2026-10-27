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
      const esito = await addSingleHostToLibreNMS(parsed.data.host_id);
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
