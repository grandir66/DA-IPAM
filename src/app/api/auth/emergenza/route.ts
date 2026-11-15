import { NextResponse } from "next/server";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { getActiveTenants, getUserTenantAccess } from "@/lib/db-hub";
import { confermaValida, utenteDaSessione } from "@/lib/vault/mostra";
import { creaAccessoEmergenza, statoAccessoEmergenza, togliAccessoEmergenza } from "@/lib/accesso/emergenza";
import { scriviRegistroAccessi } from "@/lib/accesso/registro-accessi";

const NO_STORE = { "Cache-Control": "no-store" };

/** Lo stato dell'accesso d'emergenza del cliente: assente, pronto, usato (e quando). */
export async function GET() {
  const s = await requireAdmin();
  if (isAuthError(s)) return s;
  return NextResponse.json(statoAccessoEmergenza(), { headers: NO_STORE });
}

/**
 * Prepara o rigenera l'accesso d'emergenza e rende la frase UNA volta. Chiede la conferma recente in due
 * passaggi: è l'unico ingresso senza secondo fattore, non lo crea chi trova una sessione aperta.
 */
export async function POST() {
  const s = await requireAdmin();
  if (isAuthError(s)) return s;
  const io = utenteDaSessione(s);
  if (confermaValida(io.id) === null) {
    return NextResponse.json(
      { error: "Serve la conferma con la verifica in due passaggi" },
      { status: 403, headers: NO_STORE },
    );
  }
  // Le istanze di chi lo crea: sulle installazioni dei clienti è l'unica.
  const tenantIds =
    s.user.role === "superadmin"
      ? getActiveTenants().map((t) => t.id)
      : getUserTenantAccess(Number(io.id)).map((t) => t.tenant_id);
  try {
    const frase = await creaAccessoEmergenza(tenantIds, io.nome);
    return NextResponse.json({ frase }, { headers: NO_STORE });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Accesso d'emergenza non creato" }, { status: 409, headers: NO_STORE });
  }
}

/** Toglie l'accesso d'emergenza: una sessione aperta con quello cade alla richiesta dopo. */
export async function DELETE() {
  const s = await requireAdmin();
  if (isAuthError(s)) return s;
  const tolto = togliAccessoEmergenza();
  if (tolto) scriviRegistroAccessi({ azione: "emergenza_tolta", utente: "emergenza", utenteId: 0, da: utenteDaSessione(s).nome });
  return NextResponse.json({ tolto }, { headers: NO_STORE });
}
