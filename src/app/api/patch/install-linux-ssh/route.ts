/**
 * POST /api/patch/install-linux-ssh
 *
 * Push install su host Linux/macOS via SSH — equivalente del push WinRM su
 * Windows. DA-IPAM fa SSH all'host (credenziali salvate) ed esegue lo script
 * di install dell'agente, con log su patch_operation_logs (modale live).
 *
 * Body: { hostId: number, agent: 'wazuh'|'glpi'|'mesh', platform?: 'linux'|'macos' }.
 * Lo script è costruito SERVER-SIDE per l'agente (MAI accettato dal client:
 * verrebbe eseguito come root sull'host). Solo admin.
 */
import { NextResponse } from "next/server";
import { lookup } from "dns/promises";
import { withTenantFromSession } from "@/lib/api-tenant";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { patchModuleGuard, userIdFromSession } from "@/lib/patch/route-guard";
import { getCurrentTenantCode } from "@/lib/db-tenant";
import { executeSshInstall } from "@/lib/patch/executor";
import { buildWazuhAgentScript } from "@/lib/integrations/wazuh-agent-script";
import { getWazuhConfig } from "@/lib/integrations/wazuh-config";
import { buildInstallScript, normalizePushIntervalHours } from "@/lib/inventory-agent/install-scripts";
import { isInventoryAgentEnabled, getStoredInventoryIngestTokenPlaintext } from "@/lib/inventory-agent/feature";
import { publicIngestUrl, publicHubOrigin } from "@/lib/inventory-agent/public-url";
import { buildMeshInstallScript } from "@/lib/integrations/meshcentral/install-scripts";
import { getMeshCreds } from "@/lib/integrations/meshcentral/config";

const AGENTS = new Set(["wazuh", "glpi", "mesh"]);

export async function POST(request: Request) {
  return withTenantFromSession(async () => {
    const guard = await patchModuleGuard();
    if (isAuthError(guard)) return guard;
    const adminCheck = await requireAdmin();
    if (isAuthError(adminCheck)) return adminCheck;

    let body: { hostId?: unknown; agent?: unknown; platform?: unknown };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return NextResponse.json({ error: "Body JSON non valido" }, { status: 400 });
    }

    const hostId = Number(body.hostId);
    if (!Number.isFinite(hostId) || hostId <= 0) {
      return NextResponse.json({ error: "hostId non valido" }, { status: 400 });
    }
    const agent = typeof body.agent === "string" ? body.agent : "";
    if (!AGENTS.has(agent)) {
      return NextResponse.json({ error: "agent non valido (wazuh|glpi|mesh)" }, { status: 400 });
    }
    const platform: "linux" | "macos" = body.platform === "macos" ? "macos" : "linux";

    const userId = userIdFromSession(adminCheck);
    if (userId === null) {
      return NextResponse.json({ error: "Sessione senza userId numerico" }, { status: 500 });
    }
    const tenantCode = getCurrentTenantCode() ?? "DEFAULT";

    let script: string;
    let packageId: string;
    try {
      if (agent === "wazuh") {
        const cfg = getWazuhConfig();
        if (!cfg.enabled || !cfg.url) {
          return NextResponse.json({ error: "Wazuh non configurato in Integrazioni" }, { status: 400 });
        }
        const managerHost = new URL(cfg.url).hostname;
        let managerIp: string | undefined;
        try {
          managerIp = (await lookup(managerHost)).address;
        } catch {
          managerIp = undefined;
        }
        script = buildWazuhAgentScript(platform, managerHost, managerIp);
        packageId = "wazuh-agent";
      } else if (agent === "glpi") {
        if (!isInventoryAgentEnabled(tenantCode)) {
          return NextResponse.json({ error: "Modulo Inventory Agent non abilitato" }, { status: 400 });
        }
        const token = getStoredInventoryIngestTokenPlaintext(tenantCode);
        if (!token) {
          return NextResponse.json(
            { error: "Token ingest non disponibile — genera prima un token in Impostazioni" },
            { status: 400 },
          );
        }
        script = buildInstallScript(platform, {
          ingestUrl: publicIngestUrl(request),
          ingestToken: token,
          hubOrigin: publicHubOrigin(request),
          intervalHours: normalizePushIntervalHours(),
        });
        packageId = "glpi-agent";
      } else {
        const creds = getMeshCreds();
        if (!creds) {
          return NextResponse.json({ error: "MeshCentral non configurato" }, { status: 400 });
        }
        script = buildMeshInstallScript(platform, { serverUrl: creds.serverUrl, meshId: creds.meshId });
        packageId = "meshagent";
      }
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "Errore generazione script" },
        { status: 400 },
      );
    }

    try {
      const result = await executeSshInstall({ hostId, userId, script, packageId });
      return NextResponse.json(result);
    } catch (e) {
      console.error("[patch/install-linux-ssh] errore:", e);
      return NextResponse.json({ error: "Errore durante l'install via SSH" }, { status: 500 });
    }
  });
}
