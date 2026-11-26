import { NextResponse } from "next/server";
import { z } from "zod";
import { withTenantFromSession } from "@/lib/api-tenant";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { accessoDnsDi } from "@/lib/ad/dns/accesso";
import { MASSIMO_CORREZIONI, segretoConferma, verificaConferma } from "@/lib/ad/dns/conferma";
import { eseguiCorrezioni } from "@/lib/ad/dns/esecuzione";
import { chi, corpoJson, integrazioneDa } from "@/lib/ad/dns/rotte";
import { correzioniScelte } from "@/lib/ad/dns/vista";

type Params = { params: Promise<{ id: string }> };
const Corpo = z.object({
  ids: z.array(z.string().min(3).max(400)).min(1).max(MASSIMO_CORREZIONI),
  gettone: z.string().regex(/^[0-9a-f]{64}$/),
  scade: z.number().int().positive(),
});

/**
 * Applica sul DC le correzioni CONFERMATE. Dal browser arrivano solo gli id e il gettone
 * dell'anteprima: i passi si ricalcolano qui dai dati di adesso, e devono essere gli stessi
 * che la persona ha visto, altrimenti si rifà l'anteprima.
 */
export async function POST(request: Request, { params }: Params) {
  return withTenantFromSession(async () => {
    const sessione = await requireAdmin();
    if (isAuthError(sessione)) return sessione;
    const integrazione = await integrazioneDa(params);
    if (integrazione instanceof NextResponse) return integrazione;
    const accesso = accessoDnsDi(integrazione);
    if (!accesso.ok) return NextResponse.json({ error: accesso.motivo }, { status: 403 });
    const dati = Corpo.safeParse(await corpoJson(request));
    if (!dati.success) return NextResponse.json({ error: "Conferma non valida: rifai l'anteprima" }, { status: 400 });
    const segreto = segretoConferma();
    if (!segreto) return NextResponse.json({ error: "Segreto del servizio assente: correzioni non disponibili" }, { status: 500 });

    const ids = [...new Set(dati.data.ids)];
    const { trovate, mancanti } = correzioniScelte(integrazione.id, ids);
    if (mancanti.length > 0) return NextResponse.json({ error: "Alcune correzioni non valgono più: rifai l'anteprima" }, { status: 409 });
    const utente = chi(sessione);
    const conferma = verificaConferma({ integrazione: integrazione.id, utente, scade: dati.data.scade, correzioni: trovate }, dati.data.gettone, segreto);
    if (!conferma.ok) return NextResponse.json({ error: conferma.motivo }, { status: 400 });

    try {
      return NextResponse.json(await eseguiCorrezioni(integrazione, trovate, utente));
    } catch (errore) {
      console.error("[dns-ad] correzioni interrotte:", errore instanceof Error ? errore.message : errore);
      return NextResponse.json({ error: errore instanceof Error ? errore.message : "Correzioni interrotte" }, { status: 500 });
    }
  });
}
