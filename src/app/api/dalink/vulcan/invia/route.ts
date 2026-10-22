import { NextResponse } from "next/server";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { leggiConfigVulcan } from "@/lib/vulcan/config";
import { inviaOraVulcan, invioOraInCorso } from "@/lib/vulcan/job";

/**
 * «Invia ora» dalla scheda DA-Vul-can di «Cosa esce» (A-IPAM, Task 8), solo admin.
 * Accoda l'inventario, rimette in attesa i falliti, svuota la coda e batte: in
 * sottofondo, perché un hub lento può tenere il giro per minuti. La pagina si rilegge
 * e mostra l'esito dal sistema vivo. Senza gettone non parte niente e lo si dice;
 * con un «Invia ora» già in fila, 409 (un giro automatico in corso no: si va in fila).
 */
export async function POST() {
  const sessione = await requireAdmin();
  if (isAuthError(sessione)) return sessione;
  const cfg = leggiConfigVulcan();
  if (cfg.stato === "spento") {
    return NextResponse.json({ error: "DA-Vul-can non è configurato su questa istanza: non parte niente" }, { status: 409 });
  }
  if (cfg.stato === "non_valida") {
    return NextResponse.json({ error: `Configurazione DA-Vul-can non valida: ${cfg.motivo}. Non parte niente` }, { status: 409 });
  }
  // Solo un altro «Invia ora» fa 409: un giro automatico in corso no, questo si mette in fila dopo.
  if (invioOraInCorso()) {
    return NextResponse.json({ error: "Un invio verso DA-Vul-can è già in corso: riprova fra poco" }, { status: 409 });
  }
  const u = sessione.user;
  const chi = (u.name || u.email || (u.id ? `utente ${u.id}` : "")).trim() || "amministratore";
  inviaOraVulcan(chi).catch((e: unknown) => {
    console.error("[vulcan] «Invia ora» fallito:", e instanceof Error ? e.message : "errore imprevisto");
  });
  return NextResponse.json({ avviato: true }, { status: 202 });
}
