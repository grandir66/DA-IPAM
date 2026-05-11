import { NextResponse } from "next/server";
import crypto from "crypto";
import bcrypt from "bcrypt";
import { getTenantAgentById, setTenantAgentTokenById } from "@/lib/db-hub";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { encrypt } from "@/lib/crypto";

/**
 * Genera un nuovo bearer token per uno specifico agente.
 * Sostituisce il token precedente (rotazione). Il plaintext è ritornato una
 * sola volta nella response e mai persistito.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const adminCheck = await requireAdmin();
    if (isAuthError(adminCheck)) return adminCheck;
    const { id } = await params;
    const agentId = Number(id);
    if (!Number.isFinite(agentId)) {
      return NextResponse.json({ error: "ID agente non valido" }, { status: 400 });
    }
    const agent = getTenantAgentById(agentId);
    if (!agent) {
      return NextResponse.json({ error: "Agente non trovato" }, { status: 404 });
    }

    const plaintext = crypto.randomBytes(32).toString("base64url");
    const tokenHash = await bcrypt.hash(plaintext, 10);
    const tokenEncrypted = encrypt(plaintext);

    const ok = setTenantAgentTokenById(agentId, tokenHash, tokenEncrypted);
    if (!ok) {
      return NextResponse.json({ error: "Errore nella persistenza del token" }, { status: 500 });
    }

    return NextResponse.json({
      token: plaintext,
      created_at: new Date().toISOString(),
      hint: "Conserva il token ora: non sarà più mostrato in chiaro.",
    });
  } catch (error) {
    console.error("Errore generazione token agente:", error);
    return NextResponse.json({ error: "Errore" }, { status: 500 });
  }
}
