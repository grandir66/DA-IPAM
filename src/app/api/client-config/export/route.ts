import { NextResponse } from "next/server";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { denyCrossTenantConfig } from "@/lib/client-config-access";
import { getClientConfigMd } from "@/lib/client-config";

/**
 * GET /api/client-config/export?code=XXX
 * Scarica il file markdown della configurazione cliente (VPN/config sensibile): solo admin.
 */
export async function GET(req: Request) {
  const session = await requireAdmin();
  if (isAuthError(session)) return session;

  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  if (!code) {
    return NextResponse.json({ error: "Parametro 'code' richiesto" }, { status: 400 });
  }
  const denied = denyCrossTenantConfig(session, code);
  if (denied) return denied;

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
