/**
 * POST /api/integrations/wazuh/agent-script
 *
 * Genera lo script di install dell'AGENTE Wazuh per Linux/macOS, puntando al
 * manager configurato (getWazuhConfig). Ritorna lo script come testo.
 * Body: { platform: 'linux' | 'macos' }. Auth: requireAdmin.
 */
import { NextResponse } from "next/server";
import { lookup } from "dns/promises";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { getWazuhConfig } from "@/lib/integrations/wazuh-config";
import { buildWazuhAgentScript, isWazuhAgentPlatform } from "@/lib/integrations/wazuh-agent-script";

export async function POST(request: Request) {
  const adminCheck = await requireAdmin();
  if (isAuthError(adminCheck)) return adminCheck;

  let body: { platform?: unknown };
  try {
    body = (await request.json()) as { platform?: unknown };
  } catch {
    return NextResponse.json({ error: "Body JSON non valido" }, { status: 400 });
  }

  const platform = typeof body.platform === "string" ? body.platform : "";
  if (!isWazuhAgentPlatform(platform)) {
    return NextResponse.json(
      { error: "platform non valida (linux|macos)" },
      { status: 400 },
    );
  }

  const cfg = getWazuhConfig();
  if (!cfg.enabled || !cfg.url) {
    return NextResponse.json(
      { error: "Wazuh non configurato. Vai a Integrazioni → Wazuh." },
      { status: 400 },
    );
  }

  let managerHost: string;
  try {
    managerHost = new URL(cfg.url).hostname;
  } catch {
    return NextResponse.json({ error: "URL manager Wazuh non valido" }, { status: 400 });
  }

  let managerIp: string | undefined;
  try {
    managerIp = (await lookup(managerHost)).address;
  } catch {
    managerIp = undefined;
  }

  try {
    const script = buildWazuhAgentScript(platform, managerHost, managerIp);
    return new NextResponse(script, {
      status: 200,
      headers: {
        "Content-Type": "text/x-shellscript; charset=utf-8",
        "Content-Disposition": `attachment; filename="install-wazuh-agent-${platform}.sh"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Errore generazione script" },
      { status: 400 },
    );
  }
}
