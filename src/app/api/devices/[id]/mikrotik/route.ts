/**
 * API MikroTik - Download config, DHCP leases, servers, pools
 * GET /api/devices/[id]/mikrotik?action=config|dhcp|servers|pools|all
 * POST /api/devices/[id]/mikrotik/import-dhcp - importa lease DHCP come host IPAM
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import {
  getNetworkDeviceById,
  buildNetworkLookup,
  upsertHost,
  getHostByIp,
  getHostByMac,
  upsertDhcpLease,
  syncIpAssignmentsForNetwork,
} from "@/lib/db";
import { createRouterClient, type DhcpLeaseEntry } from "@/lib/devices/router-client";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
  const authResult = await requireAuth();
  if (isAuthError(authResult)) return authResult;

  const { id } = await params;
  const deviceId = parseInt(id, 10);
  if (isNaN(deviceId)) {
    return NextResponse.json({ error: "ID non valido" }, { status: 400 });
  }

  const device = getNetworkDeviceById(deviceId);
  if (!device) {
    return NextResponse.json({ error: "Dispositivo non trovato" }, { status: 404 });
  }

  if (device.vendor !== "mikrotik") {
    return NextResponse.json({ error: "Questo endpoint è solo per dispositivi MikroTik" }, { status: 400 });
  }

  if (device.protocol !== "ssh") {
    return NextResponse.json({ error: "MikroTik richiede protocollo SSH per queste funzionalità" }, { status: 400 });
  }

  const url = new URL(request.url);
  const action = url.searchParams.get("action") || "all";

  try {
    const client = await createRouterClient(device);

    switch (action) {
      case "config": {
        if (!client.getConfig) {
          return NextResponse.json({ error: "getConfig non disponibile" }, { status: 501 });
        }
        const config = await client.getConfig();
        return NextResponse.json({ config });
      }

      case "dhcp": {
        if (!client.getDhcpLeases) {
          return NextResponse.json({ error: "getDhcpLeases non disponibile" }, { status: 501 });
        }
        const leases = await client.getDhcpLeases();
        return NextResponse.json({ leases });
      }

      case "servers": {
        if (!client.getDhcpServers) {
          return NextResponse.json({ error: "getDhcpServers non disponibile" }, { status: 501 });
        }
        const servers = await client.getDhcpServers();
        return NextResponse.json({ servers });
      }

      case "pools": {
        if (!client.getDhcpPools) {
          return NextResponse.json({ error: "getDhcpPools non disponibile" }, { status: 501 });
        }
        const pools = await client.getDhcpPools();
        return NextResponse.json({ pools });
      }

      case "all":
      default: {
        const [config, leases, servers, pools] = await Promise.all([
          client.getConfig?.().catch(() => null),
          client.getDhcpLeases?.().catch(() => []),
          client.getDhcpServers?.().catch(() => []),
          client.getDhcpPools?.().catch(() => []),
        ]);
        return NextResponse.json({
          config,
          leases: leases || [],
          servers: servers || [],
          pools: pools || [],
        });
      }
    }
  } catch (error) {
    console.error("[MikroTik API] Error:", error);
    return NextResponse.json({
      error: `Errore connessione MikroTik: ${error instanceof Error ? error.message : String(error)}`,
    }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const authResult = await requireAuth();
  if (isAuthError(authResult)) return authResult;

  const { id } = await params;
  const deviceId = parseInt(id, 10);
  if (isNaN(deviceId)) {
    return NextResponse.json({ error: "ID non valido" }, { status: 400 });
  }

  const device = getNetworkDeviceById(deviceId);
  if (!device) {
    return NextResponse.json({ error: "Dispositivo non trovato" }, { status: 404 });
  }

  if (device.vendor !== "mikrotik") {
    return NextResponse.json({ error: "Questo endpoint è solo per dispositivi MikroTik" }, { status: 400 });
  }

  const url = new URL(request.url);
  const action = url.searchParams.get("action");

  if (action === "import-dhcp") {
    try {
      const body = await request.json();
      const leases: DhcpLeaseEntry[] = body.leases || [];
      const networkId: number | undefined = body.networkId;
      const overwriteHostname = body.overwriteHostname === true;

      if (leases.length === 0) {
        return NextResponse.json({ error: "Nessun lease da importare" }, { status: 400 });
      }

      let imported = 0;
      let updated = 0;
      let skipped = 0;
      const errors: string[] = [];
      const netsToSync = new Set<number>();
      const findNetwork = buildNetworkLookup();

      for (const lease of leases) {
        try {
          // Determina la rete di appartenenza
          let targetNetworkId = networkId;
          if (!targetNetworkId) {
            const network = findNetwork(lease.ip);
            if (network) {
              targetNetworkId = network.id;
            }
          }

          if (!targetNetworkId) {
            skipped++;
            continue;
          }

          // Cerca host esistente per IP o MAC
          const existingByIp = getHostByIp(lease.ip);
          const existingByMac = lease.mac ? getHostByMac(lease.mac) : undefined;
          const existing = existingByIp || existingByMac;

          if (existing) {
            // Aggiorna se necessario
            const updates: Record<string, unknown> = {};
            if (!existing.mac && lease.mac) {
              updates.mac = lease.mac;
            }
            if (lease.hostname && (overwriteHostname || !existing.hostname)) {
              updates.hostname = lease.hostname;
            }
            if (!existing.notes?.includes("[DHCP]")) {
              updates.notes = `${existing.notes || ""} [DHCP: ${lease.server || "mikrotik"}]`.trim();
            }

            if (Object.keys(updates).length > 0) {
              upsertHost({
                network_id: existing.network_id,
                ip: existing.ip,
                ...updates,
              });
              updated++;
            } else {
              skipped++;
            }
          } else {
            // Crea nuovo host
            upsertHost({
              network_id: targetNetworkId,
              ip: lease.ip,
              mac: lease.mac || undefined,
              hostname: lease.hostname || undefined,
              status: "unknown",
              notes: `[DHCP: ${lease.server || "mikrotik"}]${lease.comment ? ` ${lease.comment}` : ""}`,
            });
            imported++;
          }

          const hostForLease = getHostByIp(lease.ip) ?? (lease.mac ? getHostByMac(lease.mac) : undefined);
          if (hostForLease && targetNetworkId) {
            upsertDhcpLease({
              source_type: "mikrotik",
              source_device_id: deviceId,
              source_name: device.name,
              server_name: lease.server ?? null,
              ip_address: lease.ip,
              mac_address: lease.mac,
              hostname: lease.hostname ?? null,
              status: lease.status ?? null,
              lease_expires: lease.expiresAfter ?? null,
              description: lease.comment ?? null,
              dynamic_lease: lease.dynamic === true ? 1 : lease.dynamic === false ? 0 : null,
              host_id: hostForLease.id,
              network_id: targetNetworkId,
            });
            netsToSync.add(targetNetworkId);
          }
        } catch (err) {
          errors.push(`${lease.ip}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      for (const nid of netsToSync) {
        syncIpAssignmentsForNetwork(nid);
      }

      return NextResponse.json({
        success: true,
        imported,
        updated,
        skipped,
        errors: errors.length > 0 ? errors : undefined,
      });
    } catch (error) {
      return NextResponse.json({
        error: `Errore importazione: ${error instanceof Error ? error.message : String(error)}`,
      }, { status: 500 });
    }
  }

  return NextResponse.json({ error: "Azione non supportata" }, { status: 400 });
}
