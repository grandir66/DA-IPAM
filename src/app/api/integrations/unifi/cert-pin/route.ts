import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { acceptUnifiCertPin, unifiCertPinStore } from "@/lib/integrations/config";

/**
 * Impronta del certificato del controller UniFi (`integration_unifi_cert_pin`).
 *
 * La fissa il client al primo collegamento riuscito; dopo, un certificato
 * diverso è un errore. Cambiarla è una scelta dell'amministratore dalla card
 * UniFi, sempre con conferma:
 * - POST `{ pin, replaces }` accetta l'impronta nuova mostrata dall'errore
 *   «certificato cambiato» (`replaces` = quella che l'amministratore ha visto
 *   fissata, null se nessuna; se è cambiata nel frattempo → 409);
 * - DELETE la dimentica: il prossimo collegamento riuscito ne fissa una nuova.
 *
 * Configurazione dell'hub, non dati del tenant: niente contesto tenant.
 */
const AcceptSchema = z.object({
  pin: z.string().trim().min(1, "Impronta mancante").max(128, "Impronta troppo lunga"),
  replaces: z.string().trim().max(128, "Impronta troppo lunga").nullable(),
});

export async function POST(req: Request) {
  const adminCheck = await requireAdmin();
  if (isAuthError(adminCheck)) return adminCheck;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON non valido" }, { status: 400 });
  }
  const parsed = AcceptSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Dati non validi" }, { status: 400 });
  }

  const r = acceptUnifiCertPin(parsed.data.pin, parsed.data.replaces || null);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ ok: true, certPin: r.certPin });
}

export async function DELETE() {
  const adminCheck = await requireAdmin();
  if (isAuthError(adminCheck)) return adminCheck;

  unifiCertPinStore.clear();
  return NextResponse.json({ ok: true, certPin: null });
}
