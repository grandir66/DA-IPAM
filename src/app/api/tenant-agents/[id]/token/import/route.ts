import { NextResponse } from "next/server";
import bcrypt from "bcrypt";
import { z } from "zod";
import { getTenantAgentById, setTenantAgentTokenById } from "@/lib/db-hub";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { encrypt } from "@/lib/crypto";

const ImportTokenSchema = z.object({
  token: z.string().min(16, "Token troppo corto (min 16 char)").max(256),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const adminCheck = await requireAdmin();
    if (isAuthError(adminCheck)) return adminCheck;
    const { id } = await params;
    const agentId = Number(id);
    const agent = getTenantAgentById(agentId);
    if (!agent) return NextResponse.json({ error: "Agente non trovato" }, { status: 404 });

    let body: unknown;
    try { body = await request.json(); } catch { return NextResponse.json({ error: "JSON non valido" }, { status: 400 }); }
    const parsed = ImportTokenSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });

    const plaintext = parsed.data.token.trim();
    const tokenHash = await bcrypt.hash(plaintext, 10);
    const tokenEncrypted = encrypt(plaintext);
    setTenantAgentTokenById(agentId, tokenHash, tokenEncrypted);

    return NextResponse.json({ imported: true, created_at: new Date().toISOString() });
  } catch (e) {
    console.error("Errore import token:", e);
    return NextResponse.json({ error: "Errore" }, { status: 500 });
  }
}
