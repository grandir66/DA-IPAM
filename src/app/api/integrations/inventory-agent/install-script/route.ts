import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getCurrentTenantCode } from "@/lib/db-tenant";
import { isInventoryAgentEnabled } from "@/lib/inventory-agent/feature";
import { publicHubOrigin, publicIngestUrl } from "@/lib/inventory-agent/public-url";
import {
  buildInstallScript,
  buildPersonalizedOneLiner,
  installScriptContentType,
  installScriptFilename,
  isInventoryInstallPlatform,
  normalizePushIntervalHours,
} from "@/lib/inventory-agent/install-scripts";

const bodySchema = z.object({
  platform: z.enum(["windows", "linux", "macos"]),
  token: z.string().min(16).optional(),
  intervalHours: z.number().int().min(1).max(168).optional(),
  /** true = file con token embedded; false = solo one-liner template */
  download: z.boolean().optional(),
});

/**
 * POST — genera script install personalizzato (admin) o one-liner con token.
 */
export async function POST(request: Request) {
  return withTenantFromSession(async () => {
    const admin = await requireAdmin();
    if (isAuthError(admin)) return admin;

    const tenantCode = getCurrentTenantCode();
    if (!tenantCode) {
      return NextResponse.json({ error: "Tenant non risolto" }, { status: 400 });
    }
    if (!(await isInventoryAgentEnabled(tenantCode))) {
      return NextResponse.json({ error: "Modulo Inventory Agent non installato" }, { status: 403 });
    }

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return NextResponse.json({ error: "JSON non valido" }, { status: 400 });
    }

    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: "Parametri non validi", details: parsed.error.flatten() }, { status: 400 });
    }

    const { platform, token, intervalHours, download } = parsed.data;
    if (!isInventoryInstallPlatform(platform)) {
      return NextResponse.json({ error: "Platform non valida" }, { status: 400 });
    }
    if (!token) {
      return NextResponse.json(
        { error: "Token obbligatorio — genera prima un token ingest" },
        { status: 400 },
      );
    }

    const ingestUrl = publicIngestUrl(request);
    const hubOrigin = publicHubOrigin(request);
    const params = {
      ingestUrl,
      ingestToken: token,
      hubOrigin,
      intervalHours: normalizePushIntervalHours(intervalHours),
    };

    if (download) {
      const body = buildInstallScript(platform, params);
      return new NextResponse(body, {
        status: 200,
        headers: {
          "Content-Type": installScriptContentType(platform),
          "Cache-Control": "no-store",
          "Content-Disposition": `attachment; filename="${installScriptFilename(platform)}"`,
        },
      });
    }

    return NextResponse.json({
      platform,
      ingestUrl,
      hubOrigin,
      intervalHours: params.intervalHours,
      oneLiner: buildPersonalizedOneLiner(platform, params),
      installScriptUrl: `${hubOrigin}/api/integrations/inventory-agent/install/${
        platform === "windows" ? "windows.ps1" : platform === "macos" ? "macos.sh" : "linux.sh"
      }`,
    });
  });
}
