import { NextResponse } from "next/server";
import { z } from "zod";
import { withTenantFromSession } from "@/lib/api-tenant";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { accessoDnsDi } from "@/lib/ad/dns/accesso";
import { DURATA_CONFERMA_MS, MASSIMO_CORREZIONI, firmaConferma, segretoConferma } from "@/lib/ad/dns/conferma";
import { chi, corpoJson, integrazioneDa } from "@/lib/ad/dns/rotte";
import { correzioniScelte } from "@/lib/ad/dns/vista";

type Params = { params: Promise<{ id: string }> };
const Corpo = z.object({ ids: z.array(z.string().min(3).max(400)).min(1).max(MASSIMO_CORREZIONI) });

/** Anteprima delle correzioni scelte: i passi col prima e il dopo, e il gettone che li firma. Non scrive niente. */
export async function POST(request: Request, { params }: Params) {
  return withTenantFromSession(async () => {
    const sessione = await requireAdmin();
    if (isAuthError(sessione)) return sessione;
    const integrazione = await integrazioneDa(params);
    if (integrazione instanceof NextResponse) return integrazione;
    const accesso = accessoDnsDi(integrazione);
    if (!accesso.ok) return NextResponse.json({ error: accesso.motivo }, { status: 403 });
    const dati = Corpo.safeParse(await corpoJson(request));
    if (!dati.success) return NextResponse.json({ error: `Scegli da 1 a ${MASSIMO_CORREZIONI} correzioni` }, { status: 400 });
    const segreto = segretoConferma();
    if (!segreto) return NextResponse.json({ error: "Segreto del servizio assente: correzioni non disponibili" }, { status: 500 });

    const { trovate, mancanti, motivi } = correzioniScelte(integrazione.id, [...new Set(dati.data.ids)]);
    if (motivi.length > 0) return NextResponse.json({ error: motivi[0] }, { status: 400 });
    if (mancanti.length > 0) return NextResponse.json({ error: "Alcune correzioni non valgono più: il DNS è cambiato, ricarica la scheda", mancanti }, { status: 409 });
    const scade = Date.now() + DURATA_CONFERMA_MS;
    return NextResponse.json({
      correzioni: trovate,
      scade,
      gettone: firmaConferma({ integrazione: integrazione.id, utente: chi(sessione), scade, correzioni: trovate }, segreto),
      utenza: `${accesso.nome} (${accesso.fonte === "dedicata" ? "dedicata al DNS" : "voce WinRM del DC"})`,
      dc: integrazione.dc_host,
    });
  });
}
