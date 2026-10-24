import { NextResponse } from "next/server";
import { getCredentialById, getDb } from "@/lib/db";
import { CredentialSchema } from "@/lib/validators";
import { eliminaVoceDb, modificaVoceDb } from "@/lib/credentials/archivio";
import { mascheraCredenziale, type CredenzialeVista } from "@/lib/credentials/maschera";
import { colonneChiareDb, presenzaSegretiDb } from "@/lib/credentials/segreti";
import { totaleUsi, usiCredenzialeDb, type UsiCredenziale } from "@/lib/credentials/usi";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";

/**
 * Una voce, mascherata (T13, 16/10), con l'elenco degli usi: la pagina
 * Credenziali lo mostra al posto di eliminare una voce in uso (D8 = (a)).
 * `for_edit=1` (solo admin) aggiunge lo username in chiaro per il modulo di
 * modifica; chiavi e password non escono mai, nemmeno così.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withTenantFromSession(async () => {
    try {
      const { id } = await params;
      const credential = getCredentialById(Number(id));
      if (!credential) {
        return NextResponse.json({ error: "Credenziale non trovata" }, { status: 404 });
      }
      const url = new URL(request.url);
      const forEdit = url.searchParams.get("for_edit") === "1";
      // for_edit=1 decifra i dati: solo admin. La lettura mascherata resta ai viewer.
      if (forEdit) {
        const adminCheck = await requireAdmin();
        if (isAuthError(adminCheck)) return adminCheck;
      }
      const usi = usiCredenzialeDb(getDb(), credential.id);
      const risposta: CredenzialeVista & { usi: UsiCredenziale; username?: string | null } = {
        ...mascheraCredenziale(credential, totaleUsi(usi), presenzaSegretiDb(getDb(), credential)),
        usi,
      };
      if (forEdit) {
        // L'utente dal lettore unico (da-vault): con OpenBao e il riferimento viene da lì; se OpenBao non risponde,
        // 503 col motivo, non un modulo con l'utente vuoto da salvare per sbaglio.
        const letto = colonneChiareDb(getDb(), credential.id, ["encrypted_username"]);
        if (!letto.ok) return NextResponse.json({ error: letto.motivo }, { status: 503 });
        risposta.username = letto.esiste ? (letto.valori.encrypted_username ?? null) || null : null;
      }
      return NextResponse.json(risposta);
    } catch (error) {
      console.error("Error fetching credential:", error);
      return NextResponse.json({ error: "Errore nel recupero della credenziale" }, { status: 500 });
    }
  });
}

/**
 * Modifica. Segreti vuoti = non modificare (tappa 1); i campi richiesti si
 * guardano sulla voce risultante; una voce in uso non cambia tipo (409 con gli
 * usi, D8 = (a)). Dettaglio in `src/lib/credentials/archivio.ts`.
 */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withTenantFromSession(async () => {
    try {
      const adminCheck = await requireAdmin();
      if (isAuthError(adminCheck)) return adminCheck;
      const { id } = await params;
      const body = await request.json();
      const parsed = CredentialSchema.partial().safeParse(body);
      if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
      }
      const esito = modificaVoceDb(getDb(), Number(id), parsed.data, body);
      if (!esito.ok) return NextResponse.json({ error: esito.errore, usi: esito.usi }, { status: esito.stato });
      return NextResponse.json(esito.vista);
    } catch (error) {
      console.error("Error updating credential:", error);
      return NextResponse.json({ error: "Errore nell'aggiornamento" }, { status: 500 });
    }
  });
}

/**
 * Eliminazione. Una voce in uso non si elimina: 409 con gli usi (D8 = (a)).
 * Prima la cancellazione toglieva in silenzio binding, catene e righe host e
 * spegneva il WinRM dell'AD.
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withTenantFromSession(async () => {
    try {
      const adminCheck = await requireAdmin();
      if (isAuthError(adminCheck)) return adminCheck;
      const { id } = await params;
      const esito = eliminaVoceDb(getDb(), Number(id));
      if (!esito.ok) return NextResponse.json({ error: esito.errore, usi: esito.usi }, { status: esito.stato });
      return NextResponse.json({ success: true });
    } catch (error) {
      console.error("Error deleting credential:", error);
      return NextResponse.json({ error: "Errore nell'eliminazione" }, { status: 500 });
    }
  });
}
