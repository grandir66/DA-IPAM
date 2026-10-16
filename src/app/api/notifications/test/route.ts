/**
 * Invio di prova sui canali abilitati. Ignora di proposito il flag `enabled`:
 * serve a validare la configurazione PRIMA di attivare le notifiche.
 */
import { NextResponse } from "next/server";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { sendTestNotification } from "@/lib/notifications/notifier";

export async function POST() {
  const adminCheck = await requireAdmin();
  if (isAuthError(adminCheck)) return adminCheck;

  const results = await sendTestNotification("DA-IPAM");
  if (results.length === 0) {
    return NextResponse.json(
      { error: "Nessun canale abilitato: attiva SMTP o webhook e salva prima di provare." },
      { status: 400 },
    );
  }
  return NextResponse.json({ results });
}
