import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { NO_STORE, readJson } from "@/lib/controllers/route-helpers";
import { aggiornaListe, codiceValido, impostaFonte, scaricaListe, statoListe, togliFonte, URL_DI_SERIE, urlListe } from "@/lib/traffico/liste";

const Fonte = z.object({ url: z.string().trim().min(1).max(200).default(URL_DI_SERIE), codice: z.string().trim().min(1).max(64) });

/** GET /api/traffico/liste — le liste di DA-GEO scaricate e il loro stato. Mai il codice. */
export async function GET() {
  const s = await requireAuth();
  if (isAuthError(s)) return s;
  return withTenantFromSession(() => NextResponse.json(statoListe(), { headers: NO_STORE }));
}

/** PUT /api/traffico/liste — `{ url, codice }`: si salva solo se DA-GEO riconosce il codice, poi scarica. */
export async function PUT(req: Request) {
  const s = await requireAdmin();
  if (isAuthError(s)) return s;
  return withTenantFromSession(async () => {
    const dati = Fonte.safeParse(await readJson(req));
    const url = dati.success ? urlListe(dati.data.url) : null;
    if (!dati.success || !url) return NextResponse.json({ error: "L'indirizzo deve essere https, come https://survey.domarc.it/geo" }, { status: 400 });
    if (!codiceValido(dati.data.codice)) return NextResponse.json({ error: "Il codice del dispositivo ha 32 cifre esadecimali" }, { status: 400 });
    try {
      await scaricaListe(url, dati.data.codice);
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "DA-GEO non risponde" }, { status: 502 });
    }
    impostaFonte(url, dati.data.codice);
    return NextResponse.json(await aggiornaListe(), { headers: NO_STORE });
  });
}

/** POST /api/traffico/liste — scarica adesso. */
export async function POST() {
  const s = await requireAdmin();
  if (isAuthError(s)) return s;
  return withTenantFromSession(async () => NextResponse.json(await aggiornaListe(), { headers: NO_STORE }));
}

/** DELETE /api/traffico/liste — toglie il codice e le liste scaricate. Gli avvisi già nati restano. */
export async function DELETE() {
  const s = await requireAdmin();
  if (isAuthError(s)) return s;
  return withTenantFromSession(() => {
    togliFonte();
    return NextResponse.json(statoListe(), { headers: NO_STORE });
  });
}
