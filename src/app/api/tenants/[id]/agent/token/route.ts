import { NextResponse } from "next/server";
import crypto from "crypto";
import bcrypt from "bcrypt";
import {
  getTenantById,
  getFirstTenantAgent,
  setTenantAgentTokenById,
  createTenantAgent,
} from "@/lib/db-hub";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { encrypt } from "@/lib/crypto";

/**
 * Back-compat: genera nuovo token per il PRIMO agente del tenant.
 * Se il tenant non ha agenti, ne crea uno con label="Sede principale" e
 * hostname=placeholder (l'utente lo aggiorna successivamente).
 *
 * Per il nuovo flow usare /api/tenant-agents/[agentId]/token.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const adminCheck = await requireAdmin();
    if (isAuthError(adminCheck)) return adminCheck;
    const { id } = await params;
    const tenant = getTenantById(Number(id));
    if (!tenant) return NextResponse.json({ error: "Cliente non trovato" }, { status: 404 });

    let agent = getFirstTenantAgent(tenant.id);
    if (!agent) {
      // crea un placeholder se non esiste alcun agente per il tenant
      agent = createTenantAgent({
        tenant_id: tenant.id,
        label: "Sede principale",
        hostname: "agent-placeholder",
        port: 8443,
      });
    }

    const plaintext = crypto.randomBytes(32).toString("base64url");
    const tokenHash = await bcrypt.hash(plaintext, 10);
    const tokenEncrypted = encrypt(plaintext);
    setTenantAgentTokenById(agent.id, tokenHash, tokenEncrypted);

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
