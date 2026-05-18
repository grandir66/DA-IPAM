import { NextResponse } from "next/server";
import bcrypt from "bcrypt";
import { z } from "zod";
import {
  getTenantById,
  getFirstTenantAgent,
  setTenantAgentTokenById,
  createTenantAgent,
} from "@/lib/db-hub";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { encrypt } from "@/lib/crypto";

const ImportTokenSchema = z.object({
  token: z.string().min(16).max(256),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const adminCheck = await requireAdmin();
    if (isAuthError(adminCheck)) return adminCheck;
    const { id } = await params;
    const tenant = getTenantById(Number(id));
    if (!tenant) return NextResponse.json({ error: "Cliente non trovato" }, { status: 404 });

    let body: unknown;
    try { body = await request.json(); } catch { return NextResponse.json({ error: "JSON non valido" }, { status: 400 }); }
    const parsed = ImportTokenSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });

    let agent = getFirstTenantAgent(tenant.id);
    if (!agent) {
      agent = createTenantAgent({
        tenant_id: tenant.id, label: "Sede principale", hostname: "agent-placeholder", port: 8443,
      });
    }

    const plaintext = parsed.data.token.trim();
    const tokenHash = await bcrypt.hash(plaintext, 10);
    const tokenEncrypted = encrypt(plaintext);
    setTenantAgentTokenById(agent.id, tokenHash, tokenEncrypted);

    return NextResponse.json({ imported: true, created_at: new Date().toISOString() });
  } catch (e) {
    console.error("Errore import token (back-compat):", e);
    return NextResponse.json({ error: "Errore" }, { status: 500 });
  }
}
