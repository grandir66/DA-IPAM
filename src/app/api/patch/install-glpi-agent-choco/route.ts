/**
 * POST /api/patch/install-glpi-agent-choco
 *
 * Installa il GLPI Agent come PACCHETTO CHOCOLATEY configurato
 * (`domarc-glpi-agent`) su un host Windows via WinRM: MSI silenzioso + task di
 * push inventario verso l'endpoint ingest di DA-IPAM (token Bearer).
 *
 * L'URL ingest si risolve qui (serve il contesto Request per l'origine pubblica);
 * il token è quello attivo del tenant. Richiede il modulo Inventory Agent
 * abilitato e un token generato.
 *
 * Body: { hostId: number, intervalHours?: number }. Auth: patchModuleGuard + requireAdmin.
 */
import { NextResponse } from "next/server";
import { withTenantFromSession } from "@/lib/api-tenant";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { getCurrentTenantCode } from "@/lib/db-tenant";
import { patchModuleGuard, userIdFromSession } from "@/lib/patch/route-guard";
import { executeGlpiAgentChocoInstall } from "@/lib/patch/executor";
import {
  isInventoryAgentEnabled,
  getStoredInventoryIngestTokenPlaintext,
} from "@/lib/inventory-agent/feature";
import { publicIngestUrl, isUnusablePublicHost } from "@/lib/inventory-agent/public-url";
import { normalizePushIntervalHours } from "@/lib/inventory-agent/install-scripts";

export async function POST(request: Request) {
  return withTenantFromSession(async () => {
    const guard = await patchModuleGuard();
    if (isAuthError(guard)) return guard;
    const adminCheck = await requireAdmin();
    if (isAuthError(adminCheck)) return adminCheck;

    const tenantCode = getCurrentTenantCode();
    if (!tenantCode) {
      return NextResponse.json({ error: "Tenant non risolto" }, { status: 400 });
    }
    if (!isInventoryAgentEnabled(tenantCode)) {
      return NextResponse.json(
        { error: "Modulo Inventory Agent (GLPI) non abilitato per il tenant" },
        { status: 412 },
      );
    }

    const ingestToken = getStoredInventoryIngestTokenPlaintext(tenantCode);
    if (!ingestToken) {
      return NextResponse.json(
        { error: "Nessun token ingest attivo: generane uno nella pagina Moduli → Inventory Agent" },
        { status: 412 },
      );
    }

    const ingestUrl = publicIngestUrl(request);
    // Se l'origine non è risolvibile (es. host 0.0.0.0 / localhost), l'agente non
    // saprebbe dove inviare l'inventario: meglio fermarsi con un errore chiaro.
    if (isUnusablePublicHost(new URL(ingestUrl, "https://x").hostname)) {
      return NextResponse.json(
        { error: "URL pubblico non risolvibile: configura l'origine dell'appliance" },
        { status: 400 },
      );
    }

    let body: unknown = {};
    try {
      const text = await request.text();
      if (text.trim()) body = JSON.parse(text);
    } catch {
      return NextResponse.json({ error: "Body JSON non valido" }, { status: 400 });
    }
    const raw = (body ?? {}) as { hostId?: unknown; intervalHours?: unknown };
    const hostId = Number(raw.hostId);
    if (!Number.isFinite(hostId) || hostId <= 0) {
      return NextResponse.json({ error: "hostId mancante o non valido" }, { status: 400 });
    }
    const intervalHours = normalizePushIntervalHours(
      typeof raw.intervalHours === "number" ? raw.intervalHours : undefined,
    );

    const userId = userIdFromSession(adminCheck);
    if (userId === null) {
      return NextResponse.json({ error: "Sessione senza userId numerico" }, { status: 400 });
    }

    try {
      const result = await executeGlpiAgentChocoInstall({
        hostId,
        userId,
        ingestUrl,
        ingestToken,
        intervalHours,
      });
      return NextResponse.json(result, { status: 200 });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Errore install choco GLPI Agent" },
        { status: 500 },
      );
    }
  });
}
