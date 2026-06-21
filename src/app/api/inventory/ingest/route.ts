/**
 * POST /api/inventory/ingest — riceve inventario JSON (GLPI Agent format).
 * GET  — health probe per script/agent.
 *
 * Auth: Bearer token (hub inventory_ingest_tokens), no session cookie.
 */
import { NextResponse } from "next/server";
import { withTenant } from "@/lib/db-tenant";
import { extractIngestToken, resolveTenantFromIngestToken } from "@/lib/inventory-agent/auth";
import { isInventoryAgentEnabled } from "@/lib/inventory-agent/feature";
import { parseGlpiInventory } from "@/lib/inventory-agent/parse-glpi-inventory";
import { ingestInventoryReport } from "@/lib/inventory-agent/db";

const MAX_BODY_BYTES = 8 * 1024 * 1024;

export async function GET() {
  return NextResponse.json({
    status: "ok",
    service: "da-ipam-inventory-ingest",
    accepts: "application/json (GLPI inventory_format)",
  });
}

export async function POST(request: Request) {
  const token = extractIngestToken(request);
  if (!token) {
    return NextResponse.json({ error: "Token ingest mancante (Authorization: Bearer)" }, { status: 401 });
  }

  const tenantCode = resolveTenantFromIngestToken(token);
  if (!tenantCode) {
    return NextResponse.json({ error: "Token ingest non valido" }, { status: 401 });
  }

  const enabled = await isInventoryAgentEnabled(tenantCode);
  if (!enabled) {
    return NextResponse.json({ error: "Inventory Agent non abilitato per questo tenant" }, { status: 403 });
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Payload troppo grande" }, { status: 413 });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw) as unknown;
  } catch {
    return NextResponse.json({ error: "JSON non valido" }, { status: 400 });
  }

  try {
    const parsed = parseGlpiInventory(body);
    const result = withTenant(tenantCode, () => ingestInventoryReport(parsed));
    return NextResponse.json({
      status: "ok",
      report_id: result.reportId,
      device_id: result.deviceId,
      host_id: result.hostId,
      match_status: result.matchStatus,
      apps_count: result.appsCount,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Errore ingest";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
