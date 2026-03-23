/**
 * API DHCP Leases - Gestione centralizzata lease DHCP da tutte le fonti
 * GET: Lista lease con paginazione e filtri
 * POST: Sync lease da un device specifico
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireAdmin, isAuthError } from "@/lib/api-auth";
import {
  getDhcpLeasesPaginated,
  getDhcpLeaseStats,
  getNetworkDeviceById,
  bulkUpsertDhcpLeases,
  deleteDhcpLeasesByDevice,
  buildNetworkLookup,
  getRouters,
} from "@/lib/db";
import { createRouterClient } from "@/lib/devices/router-client";

export async function GET(request: NextRequest) {
  const authResult = await requireAuth();
  if (isAuthError(authResult)) return authResult;

  const url = new URL(request.url);
  const action = url.searchParams.get("action");

  if (action === "stats") {
    const stats = getDhcpLeaseStats();
    return NextResponse.json(stats);
  }

  if (action === "sources") {
    const routers = getRouters();
    const dhcpSources = routers
      .filter((r) => r.vendor === "mikrotik" && r.protocol === "ssh")
      .map((r) => ({
        id: r.id,
        name: r.name,
        host: r.host,
        vendor: r.vendor,
        type: "mikrotik" as const,
      }));
    return NextResponse.json({ sources: dhcpSources });
  }

  const page = parseInt(url.searchParams.get("page") || "1", 10);
  const pageSize = parseInt(url.searchParams.get("pageSize") || "50", 10);
  const search = url.searchParams.get("search") || undefined;
  const sourceType = url.searchParams.get("sourceType") || undefined;
  const sourceDeviceId = url.searchParams.get("sourceDeviceId");
  const networkId = url.searchParams.get("networkId");

  const result = getDhcpLeasesPaginated(page, pageSize, {
    search,
    sourceType,
    sourceDeviceId: sourceDeviceId ? parseInt(sourceDeviceId, 10) : undefined,
    networkId: networkId ? parseInt(networkId, 10) : undefined,
  });

  return NextResponse.json({
    leases: result.rows,
    total: result.total,
    page,
    pageSize,
    totalPages: Math.ceil(result.total / pageSize),
  });
}

export async function POST(request: NextRequest) {
  const authResult = await requireAdmin();
  if (isAuthError(authResult)) return authResult;

  const url = new URL(request.url);
  const action = url.searchParams.get("action");

  if (action === "sync") {
    try {
      const body = await request.json();
      const deviceId = body.deviceId;

      if (!deviceId) {
        return NextResponse.json({ error: "deviceId richiesto" }, { status: 400 });
      }

      const device = getNetworkDeviceById(deviceId);
      if (!device) {
        return NextResponse.json({ error: "Device non trovato" }, { status: 404 });
      }

      if (device.vendor !== "mikrotik" || device.protocol !== "ssh") {
        return NextResponse.json({
          error: "Solo dispositivi MikroTik con SSH supportano sync DHCP",
        }, { status: 400 });
      }

      const client = await createRouterClient(device);
      if (!client.getDhcpLeases) {
        return NextResponse.json({ error: "getDhcpLeases non disponibile" }, { status: 501 });
      }

      const leases = await client.getDhcpLeases();
      const findNetwork = buildNetworkLookup();

      const leasesToInsert = leases.map((lease) => {
        const network = findNetwork(lease.ip);
        return {
          source_type: "mikrotik" as const,
          source_device_id: deviceId,
          source_name: device.name,
          server_name: lease.server || null,
          ip_address: lease.ip,
          mac_address: lease.mac,
          hostname: lease.hostname || null,
          status: lease.status || null,
          lease_expires: lease.expiresAfter || null,
          description: lease.comment || null,
          dynamic_lease: lease.dynamic === true ? 1 : lease.dynamic === false ? 0 : null,
          network_id: network?.id || null,
        };
      });

      const result = bulkUpsertDhcpLeases(leasesToInsert);

      return NextResponse.json({
        success: true,
        inserted: result.inserted,
        updated: result.updated,
        total: leases.length,
        deviceName: device.name,
      });
    } catch (error) {
      console.error("[DHCP Sync] Error:", error);
      return NextResponse.json({
        error: `Errore sync: ${error instanceof Error ? error.message : String(error)}`,
      }, { status: 500 });
    }
  }

  if (action === "sync-all") {
    try {
      const routers = getRouters();
      const mikrotikRouters = routers.filter((r) => r.vendor === "mikrotik" && r.protocol === "ssh");

      if (mikrotikRouters.length === 0) {
        return NextResponse.json({ error: "Nessun router MikroTik configurato" }, { status: 404 });
      }

      let totalInserted = 0;
      let totalUpdated = 0;
      const errors: string[] = [];
      const findNetwork = buildNetworkLookup();

      for (const device of mikrotikRouters) {
        try {
          const client = await createRouterClient(device);
          if (!client.getDhcpLeases) continue;

          const leases = await client.getDhcpLeases();

          const leasesToInsert = leases.map((lease) => {
            const network = findNetwork(lease.ip);
            return {
              source_type: "mikrotik" as const,
              source_device_id: device.id,
              source_name: device.name,
              server_name: lease.server || null,
              ip_address: lease.ip,
              mac_address: lease.mac,
              hostname: lease.hostname || null,
              status: lease.status || null,
              lease_expires: lease.expiresAfter || null,
              description: lease.comment || null,
              dynamic_lease: lease.dynamic === true ? 1 : lease.dynamic === false ? 0 : null,
              network_id: network?.id || null,
            };
          });

          const result = bulkUpsertDhcpLeases(leasesToInsert);
          totalInserted += result.inserted;
          totalUpdated += result.updated;
        } catch (err) {
          errors.push(`${device.name}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      return NextResponse.json({
        success: true,
        devicesProcessed: mikrotikRouters.length,
        inserted: totalInserted,
        updated: totalUpdated,
        errors: errors.length > 0 ? errors : undefined,
      });
    } catch (error) {
      return NextResponse.json({
        error: `Errore sync-all: ${error instanceof Error ? error.message : String(error)}`,
      }, { status: 500 });
    }
  }

  if (action === "clear") {
    try {
      const body = await request.json();
      const deviceId = body.deviceId;

      if (!deviceId) {
        return NextResponse.json({ error: "deviceId richiesto" }, { status: 400 });
      }

      const deleted = deleteDhcpLeasesByDevice(deviceId);
      return NextResponse.json({ success: true, deleted });
    } catch (error) {
      return NextResponse.json({
        error: `Errore clear: ${error instanceof Error ? error.message : String(error)}`,
      }, { status: 500 });
    }
  }

  return NextResponse.json({ error: "Azione non supportata" }, { status: 400 });
}
