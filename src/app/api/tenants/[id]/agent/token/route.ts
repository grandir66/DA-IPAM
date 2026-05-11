import { NextResponse } from "next/server";
import crypto from "crypto";
import bcrypt from "bcrypt";
import { getTenantById, setTenantAgentToken } from "@/lib/db-hub";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { encrypt } from "@/lib/crypto";

/**
 * Genera un nuovo bearer token per l'agente del tenant.
 * - 32 byte random base64url come plaintext (lunghezza ~43 char)
 * - bcrypt cost 10 per hash (verifica rapida lato agente)
 * - encrypt() per ciphertext (usato dal RemoteExecutor lato hub in Phase 3)
 *
 * Il plaintext viene restituito UNA volta nella risposta e mai persistito in chiaro.
 * Sovrascrive il token precedente: il vecchio token cessa di essere valido al successivo
 * deploy della config sull'agente.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const adminCheck = await requireAdmin();
    if (isAuthError(adminCheck)) return adminCheck;

    const { id } = await params;
    const tenantId = Number(id);
    if (!Number.isFinite(tenantId)) {
      return NextResponse.json({ error: "ID tenant non valido" }, { status: 400 });
    }

    const tenant = getTenantById(tenantId);
    if (!tenant) {
      return NextResponse.json({ error: "Cliente non trovato" }, { status: 404 });
    }

    const plaintext = crypto.randomBytes(32).toString("base64url");
    const tokenHash = await bcrypt.hash(plaintext, 10);
    const tokenEncrypted = encrypt(plaintext);

    const ok = setTenantAgentToken(tenantId, tokenHash, tokenEncrypted);
    if (!ok) {
      return NextResponse.json({ error: "Errore nella persistenza del token" }, { status: 500 });
    }

    return NextResponse.json({
      token: plaintext,
      created_at: new Date().toISOString(),
      hint: "Conserva il token ora: non sarà più mostrato in chiaro.",
    });
  } catch (error) {
    console.error("Errore nella generazione del token agente:", error);
    return NextResponse.json({ error: "Errore nella generazione del token agente" }, { status: 500 });
  }
}
