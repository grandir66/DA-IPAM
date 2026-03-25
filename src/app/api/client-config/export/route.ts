import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { getClientConfigMd } from "@/lib/client-config";

/**
 * GET /api/client-config/export?code=XXX
 * Scarica il file markdown della configurazione cliente.
 */
export async function GET(req: Request) {
  const session = await requireAuth();
  if (isAuthError(session)) return session;

  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  if (!code) {
    return NextResponse.json({ error: "Parametro 'code' richiesto" }, { status: 400 });
  }

  const md = getClientConfigMd(code);
  if (!md) {
    return NextResponse.json({ error: "Configurazione non trovata" }, { status: 404 });
  }

  return new NextResponse(md, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${code}.md"`,
    },
  });
}
