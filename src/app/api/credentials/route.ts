import { NextResponse } from "next/server";
import { getAllCredentials, getDb } from "@/lib/db";
import { CredentialSchema } from "@/lib/validators";
import { creaVoceDb } from "@/lib/credentials/archivio";
import { mascheraCredenziale } from "@/lib/credentials/maschera";
import { presenzaSegretiDb } from "@/lib/credentials/segreti";
import { usiTotaliDb } from "@/lib/credentials/usi";
import { requireAdminOrOnboarding, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";

/**
 * Elenco dell'archivio: ogni voce come vista mascherata (T13, 16/10), che dei
 * segreti dice solo se ci sono, col numero degli usi per la colonna «Usata da».
 */
export async function GET() {
  return withTenantFromSession(async () => {
    try {
      const dbh = getDb();
      const usi = usiTotaliDb(dbh);
      // I segreti "ci sono" guardando le colonne o, con OpenBao e il riferimento, OpenBao (da-vault): le colonne sono vuote.
      const voci = getAllCredentials().map((c) => mascheraCredenziale(c, usi.get(c.id) ?? 0, presenzaSegretiDb(dbh, c)));
      // v0.2.642 audit perf UI7: cache client 60s + SWR 5min (read-mostly).
      // La pagina Credenziali e il wizard chiedono `no-store`: dopo una
      // modifica l'elenco non deve tornare com'era.
      return NextResponse.json(voci, {
        headers: { "Cache-Control": "private, max-age=60, stale-while-revalidate=300" },
      });
    } catch (error) {
      console.error("Error fetching credentials:", error);
      return NextResponse.json({ error: "Errore nel recupero delle credenziali" }, { status: 500 });
    }
  });
}

/**
 * Voce nuova. I campi richiesti per tipo e metodo li decide `campiRichiesti`
 * di `credentials/tipi.ts` (in `creaVoceDb`): prima erano regole scritte qui a
 * mano, solo per cinque tipi.
 */
export async function POST(request: Request) {
  return withTenantFromSession(async () => {
    try {
      const adminCheck = await requireAdminOrOnboarding();
      if (isAuthError(adminCheck)) return adminCheck;
      const body = await request.json();
      const parsed = CredentialSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
      }
      // Con OpenBao acceso i segreti vanno in OpenBao prima di tutto: se non vanno, 503 col motivo e niente salvato.
      const esito = creaVoceDb(getDb(), parsed.data);
      if (!esito.ok) return NextResponse.json({ error: esito.errore }, { status: esito.stato });
      return NextResponse.json(esito.vista, { status: esito.stato });
    } catch (error) {
      console.error("Error creating credential:", error);
      return NextResponse.json({ error: "Errore nella creazione della credenziale" }, { status: 500 });
    }
  });
}
