import { NextResponse } from "next/server";
import { getCredentialById, getDb, getHostByIp } from "@/lib/db";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { provaCredenzialeSuHost, registraProva } from "@/lib/credentials/trova";
import { avviaChocoDopoCredenziali } from "@/lib/patch/choco-automatico";

/**
 * Registra l'esito della prova sull'host con quell'IP, riuscito o no: un successo azzera i fallimenti e riabilita
 * una credenziale esclusa, un fallimento la esclude per la ricerca in sequenza (21/10: prima il fallimento non
 * lasciava traccia). Best-effort: se l'host non esiste in DB (test estemporaneo) o la scrittura fallisce, ignora.
 */
function registraSuHost(ip: string, credentialId: number, esito: Awaited<ReturnType<typeof provaCredenzialeSuHost>>): void {
  if (!esito.registra || !esito.protocollo || esito.porta == null) return;
  try {
    const host = getHostByIp(ip);
    if (!host?.id) return;
    registraProva(host.id, credentialId, esito.protocollo, esito.porta, esito);
    // WinRM verificato: Chocolatey si installa da solo, se serve (21/10).
    if (esito.ok && esito.protocollo === "winrm") avviaChocoDopoCredenziali([host.id]);
  } catch (e) {
    console.warn("[credentials/test] registraSuHost failed:", e);
  }
}

/** Test connessione credenziale su host specificato. POST body: { host: string, port?: number } */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return withTenantFromSession(async () => {
    try {
      const adminCheck = await requireAdmin();
      if (isAuthError(adminCheck)) return adminCheck;
      const { id } = await params;
      const cred = getCredentialById(Number(id));
      if (!cred) {
        return NextResponse.json({ success: false, error: "Credenziale non trovata" }, { status: 404 });
      }

      const body = await request.json().catch(() => ({}));
      const host = typeof body.host === "string" ? body.host.trim() : "";
      if (!host) {
        return NextResponse.json({ success: false, error: "Indirizzo IP o hostname richiesto" }, { status: 400 });
      }

      const esito = await provaCredenzialeSuHost(getDb(), Number(id), host, typeof body.port === "number" ? body.port : null);
      registraSuHost(host, Number(id), esito);
      return NextResponse.json(esito.risposta);
    } catch (error) {
      console.error("Credential test error:", error);
      return NextResponse.json(
        { success: false, error: error instanceof Error ? error.message : "Errore nel test" },
        { status: 500 }
      );
    }
  });
}
