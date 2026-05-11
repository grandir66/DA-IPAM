import { NextResponse } from "next/server";
import bcrypt from "bcrypt";
import { z } from "zod";
import { getTenantById, setTenantAgentToken } from "@/lib/db-hub";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { encrypt } from "@/lib/crypto";

const ImportTokenSchema = z.object({
  token: z.string().min(16, "Token troppo corto (almeno 16 caratteri)").max(256),
});

/**
 * Importa un token agente esistente (plaintext) generato altrove (es.
 * agent già installato manualmente prima della config nell'UI).
 *
 * Use case: l'agent è stato deployato su un host, ha il suo bearer in
 * /etc/da-invent-agent/config.yml (come hash bcrypt), e l'utente vuole
 * collegarlo al tenant senza dover rigenerare un token nuovo (che
 * costringerebbe a riconfigurare l'agent).
 *
 * Equivalente funzionale a `/token` POST ma con valore fornito dall'utente.
 * Il plaintext NON viene persistito: salviamo solo bcrypt hash + encrypted.
 */
export async function POST(
  request: Request,
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

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "JSON non valido" }, { status: 400 });
    }

    const parsed = ImportTokenSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const plaintext = parsed.data.token.trim();
    if (!plaintext) {
      return NextResponse.json({ error: "Token vuoto" }, { status: 400 });
    }

    const tokenHash = await bcrypt.hash(plaintext, 10);
    const tokenEncrypted = encrypt(plaintext);

    const ok = setTenantAgentToken(tenantId, tokenHash, tokenEncrypted);
    if (!ok) {
      return NextResponse.json({ error: "Errore nella persistenza del token" }, { status: 500 });
    }

    return NextResponse.json({
      imported: true,
      created_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Errore nell'import token agente:", error);
    return NextResponse.json({ error: "Errore nell'import del token agente" }, { status: 500 });
  }
}
