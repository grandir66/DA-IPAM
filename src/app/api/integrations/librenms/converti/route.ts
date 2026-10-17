import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { getIntegrationConfig, setIntegrationConfig } from "@/lib/integrations/config";
import { conversioneInAppliance } from "@/lib/integrations/librenms-modo";

/**
 * POST /api/integrations/librenms/converti — passo 5 del piano di solidità (16/10).
 *
 * Unico modo per portare una configurazione LibreNMS «Istanza esterna» a
 * «Installato dall'appliance»: le righe `external` non si migrano mai da sole.
 * Cambia solo la modalità (indirizzo, token e password restano), solo per un
 * admin e solo con `{ "conferma": true }` nel corpo, che la scheda manda dopo la
 * conferma in italiano (`CONFERMA_CONVERSIONE_LIBRENMS`).
 */
const Schema = z.object({ conferma: z.literal(true) });

export async function POST(req: Request) {
  const adminCheck = await requireAdmin();
  if (isAuthError(adminCheck)) return adminCheck;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON non valido" }, { status: 400 });
  }
  if (!Schema.safeParse(body).success) {
    return NextResponse.json(
      { error: "Conversione non confermata: serve { \"conferma\": true }" },
      { status: 400 },
    );
  }

  const cfg = getIntegrationConfig("librenms");
  const esito = conversioneInAppliance(cfg);
  if (!esito.ok) return NextResponse.json({ error: esito.error }, { status: esito.status });

  setIntegrationConfig("librenms", { mode: esito.a });
  return NextResponse.json({ ok: true, da: esito.da, a: esito.a });
}
