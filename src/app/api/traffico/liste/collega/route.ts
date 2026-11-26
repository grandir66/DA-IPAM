import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { NO_STORE, readJson } from "@/lib/controllers/route-helpers";
import { annullaRichiesta, apriRichiesta, controllaRichiesta, richiestaAperta } from "@/lib/traffico/collegamento";
import { URL_DI_SERIE, urlListe } from "@/lib/traffico/liste";

const Corpo = z.object({ url: z.string().trim().min(1).max(200).default(URL_DI_SERIE) });

/** GET /api/traffico/liste/collega — la richiesta aperta, se c'è: numero e pagina da aprire, mai il segreto. */
export async function GET() {
  const s = await requireAdmin();
  if (isAuthError(s)) return s;
  return withTenantFromSession(() => NextResponse.json({ richiesta: richiestaAperta() }, { headers: NO_STORE }));
}

/** POST /api/traffico/liste/collega — chiede a DA-GEO di collegarsi. */
export async function POST(req: Request) {
  const s = await requireAdmin();
  if (isAuthError(s)) return s;
  return withTenantFromSession(async () => {
    const dati = Corpo.safeParse((await readJson(req)) ?? {});
    const url = dati.success ? urlListe(dati.data.url) : null;
    if (!url) return NextResponse.json({ error: "L'indirizzo deve essere https, come https://survey.domarc.it/geo" }, { status: 400 });
    try {
      return NextResponse.json({ richiesta: await apriRichiesta(url) }, { headers: NO_STORE });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "DA-GEO non risponde" }, { status: 502 });
    }
  });
}

/** PUT /api/traffico/liste/collega — com'è andata: se è confermata ritira il codice e scarica le liste. */
export async function PUT() {
  const s = await requireAdmin();
  if (isAuthError(s)) return s;
  return withTenantFromSession(async () => NextResponse.json(await controllaRichiesta(), { headers: NO_STORE }));
}

/** DELETE /api/traffico/liste/collega — lascia perdere la richiesta: in DA-GEO scade da sola. */
export async function DELETE() {
  const s = await requireAdmin();
  if (isAuthError(s)) return s;
  return withTenantFromSession(() => {
    annullaRichiesta();
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  });
}
