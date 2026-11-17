import { NextResponse } from "next/server";
import { z } from "zod";
import { withTenantFromSession } from "@/lib/api-tenant";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { getAdIntegrationById, getCredentialById, impostaCorrezioniDnsAd } from "@/lib/db-tenant";
import { statoScritturaDns } from "@/lib/ad/dns/accesso";
import { corpoJson, integrazioneDa } from "@/lib/ad/dns/rotte";

type Params = { params: Promise<{ id: string }> };
const Corpo = z.object({
  dns_scrittura: z.boolean(),
  dns_usa_winrm_dc: z.boolean(),
  dns_credential_id: z.number().int().positive().nullable(),
});

/** Interruttore delle correzioni al DNS e utenza con cui si scrive. Nasce spento; lo accende solo un amministratore. */
export async function PUT(request: Request, { params }: Params) {
  return withTenantFromSession(async () => {
    const sessione = await requireAdmin();
    if (isAuthError(sessione)) return sessione;
    const integrazione = await integrazioneDa(params);
    if (integrazione instanceof NextResponse) return integrazione;
    const dati = Corpo.safeParse(await corpoJson(request));
    if (!dati.success) return NextResponse.json({ error: "Dati non validi" }, { status: 400 });
    if (dati.data.dns_credential_id != null) {
      const voce = getCredentialById(dati.data.dns_credential_id);
      if (!voce || voce.credential_type !== "windows") return NextResponse.json({ error: "L'utenza dedicata al DNS deve essere una voce di tipo Windows" }, { status: 400 });
    }
    impostaCorrezioniDnsAd(integrazione.id, dati.data);
    console.info(`[dns-ad] impostazioni delle correzioni cambiate sull'integrazione #${integrazione.id}: accese=${dati.data.dns_scrittura}, voce dedicata=${dati.data.dns_credential_id != null}, voce WinRM del DC=${dati.data.dns_usa_winrm_dc}`);
    const nuova = getAdIntegrationById(integrazione.id)!;
    return NextResponse.json({ scrittura: statoScritturaDns(nuova), dns_scrittura: !!nuova.dns_scrittura, dns_usa_winrm_dc: !!nuova.dns_usa_winrm_dc, dns_credential_id: nuova.dns_credential_id ?? null });
  });
}
