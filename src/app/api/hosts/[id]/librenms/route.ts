import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getIntegrationConfig } from "@/lib/integrations/config";
import { createLibreNMSClient } from "@/lib/integrations/librenms-api";
import { getHostById } from "@/lib/db";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return withTenantFromSession(async () => {
    const authCheck = await requireAuth();
    if (isAuthError(authCheck)) return authCheck;

    const { id } = await params;
    const host = getHostById(Number(id));
    if (!host) return NextResponse.json({ error: "Host non trovato" }, { status: 404 });

    const cfg = getIntegrationConfig("librenms");
    if (cfg.mode === "disabled" || !cfg.url || !cfg.apiToken) {
      return NextResponse.json({ configured: false });
    }

    // Cerca il mapping in DB
    const { getLibreNMSMapByIp } = await import("@/lib/integrations/librenms-db");
    const map = getLibreNMSMapByIp(host.network_id, host.ip);
    if (!map) {
      return NextResponse.json({ configured: true, mapped: false });
    }

    // Recupera stato live da LibreNMS
    const client = createLibreNMSClient(cfg.url, cfg.apiToken);
    const device = await client.getDeviceStatus(map.librenms_device_id);

    return NextResponse.json({
      configured: true,
      mapped: true,
      librenmsDeviceId: map.librenms_device_id,
      librenmsHostname: map.librenms_hostname,
      lastSyncedAt: map.last_synced_at,
      device,
      librenmsUrl: cfg.url,
    });
  });
}
