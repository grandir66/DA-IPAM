/**
 * Configurazione singleton Wazuh (hub-level, condivisa fra tenant).
 *
 *   GET    — ritorna config attuale (password mascherata)
 *   POST   — crea/aggiorna config
 *   DELETE — disabilita l'integrazione (mantiene URL/username, azzera password)
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, requireAuth, isAuthError } from "@/lib/api-auth";
import {
  getWazuhConfigPublic,
  setWazuhConfig,
} from "@/lib/integrations/wazuh-config";

const PostSchema = z.object({
  enabled:   z.boolean().optional(),
  url:       z.string().min(1).max(500).optional(),
  username:  z.string().min(1).max(200).optional(),
  password:  z.string().min(1).max(500).optional(),
  verifyTls: z.boolean().optional(),
});

export async function GET() {
  const authCheck = await requireAuth();
  if (isAuthError(authCheck)) return authCheck;
  return NextResponse.json(getWazuhConfigPublic());
}

export async function POST(req: Request) {
  const adminCheck = await requireAdmin();
  if (isAuthError(adminCheck)) return adminCheck;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON non valido" }, { status: 400 });
  }
  const parsed = PostSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Dati non validi" }, { status: 400 });
  }

  setWazuhConfig(parsed.data);
  return NextResponse.json(getWazuhConfigPublic());
}

export async function DELETE() {
  const adminCheck = await requireAdmin();
  if (isAuthError(adminCheck)) return adminCheck;
  setWazuhConfig({ enabled: false });
  return NextResponse.json(getWazuhConfigPublic());
}
