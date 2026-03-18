import { NextResponse } from "next/server";
import { getNetworkRouterId, getNetworkDeviceById } from "@/lib/db";
import { createRouterClient } from "@/lib/devices/router-client";
import { createSwitchClient } from "@/lib/devices/switch-client";
import { upsertArpEntries, upsertMacPortEntries, upsertSwitchPorts, resolveMacToDevice, resolveMacToNetworkDevice } from "@/lib/db";
import { lookupVendor } from "@/lib/scanner/mac-vendor";
import { upsertHost, getNetworks } from "@/lib/db";
import { isIpInCidr, normalizePortNameForMatch } from "@/lib/utils";
import { requireAdmin, isAuthError } from "@/lib/api-auth";

/**
 * Esegue la query (ARP/MAC/porte) sui router delle reti selezionate.
 * POST /api/networks/bulk-scan-devices
 * Body: { network_ids: number[] }
 */
export async function POST(request: Request) {
  try {
    const adminCheck = await requireAdmin();
    if (isAuthError(adminCheck)) return adminCheck;
    const body = await request.json();
    const networkIds = Array.isArray(body.network_ids) ? body.network_ids.map(Number) : [];

    if (networkIds.length === 0) {
      return NextResponse.json({ error: "Seleziona almeno una rete" }, { status: 400 });
    }

    const routerIds = new Set<number>();
    for (const networkId of networkIds) {
      const routerId = getNetworkRouterId(networkId);
      if (routerId) routerIds.add(routerId);
    }

    const results: { device_id: number; device_name: string; success: boolean; error?: string }[] = [];

    for (const deviceId of routerIds) {
      const device = getNetworkDeviceById(deviceId);
      if (!device) continue;

      try {
        if (device.device_type === "router") {
          const client = await createRouterClient(device);
          const entries = await client.getArpTable();
          upsertArpEntries(deviceId, entries);

          const networks = getNetworks();
          for (const entry of entries) {
            if (!entry.ip || !entry.mac) continue;
            const network = networks.find((n) => isIpInCidr(entry.ip!, n.cidr));
            if (!network) continue;
            const vendor = await lookupVendor(entry.mac);
            upsertHost({
              network_id: network.id,
              ip: entry.ip,
              mac: entry.mac,
              vendor: vendor || undefined,
            });
          }

          const portInfos = await client.getPortSchema?.().catch(() => []) ?? [];
          if (portInfos.length > 0) {
            const macsByPortByIndex = new Map<number, { macs: string[] }>();
            const macsByPortByName = new Map<string, { macs: string[] }>();
            for (const e of entries) {
              const ifName = (e.interface_name ?? "").trim();
              if (!ifName) continue;
              const ifIndexMatch = ifName.match(/^if(\d+)$/i);
              if (ifIndexMatch) {
                const idx = parseInt(ifIndexMatch[1], 10);
                const existing = macsByPortByIndex.get(idx) || { macs: [] };
                existing.macs.push(e.mac);
                macsByPortByIndex.set(idx, existing);
              } else {
                const key = normalizePortNameForMatch(ifName);
                const existing = macsByPortByName.get(key) || { macs: [] };
                existing.macs.push(e.mac);
                macsByPortByName.set(key, existing);
              }
            }

            const switchPorts = portInfos.map((p) => {
              const portMacs = macsByPortByIndex.get(p.port_index) ?? macsByPortByName.get(normalizePortNameForMatch(p.port_name.trim()));
              const macCount = portMacs?.macs.length || 0;
              const isTrunk = macCount > 1 ? 1 : 0;
              let singleMac: string | null = null;
              let singleMacVendor: string | null = null;
              let singleMacIp: string | null = null;
              let singleMacHostname: string | null = null;
              let hostId: number | null = null;
              if (macCount === 1 && portMacs) {
                singleMac = portMacs.macs[0];
                const resolved = resolveMacToDevice(singleMac);
                singleMacIp = resolved.ip;
                singleMacHostname = resolved.hostname;
                singleMacVendor = resolved.vendor;
                hostId = resolved.host_id;
              }
              let trunk_primary_device_id: number | null = null;
              let trunk_primary_name: string | null = null;
              if (isTrunk && portMacs && !p.trunk_neighbor_name) {
                const matches: { device_id: number; device_name: string; device_type: string }[] = [];
                for (const mac of portMacs.macs) {
                  const nd = resolveMacToNetworkDevice(mac, deviceId);
                  if (nd) matches.push(nd);
                }
                const primary = matches.find((m) => m.device_type === "router") ?? matches[0];
                if (primary) {
                  trunk_primary_device_id = primary.device_id;
                  trunk_primary_name = primary.device_name;
                }
              }
              return {
                port_index: p.port_index,
                port_name: p.port_name.trim(),
                status: p.status,
                speed: p.speed,
                duplex: p.duplex,
                vlan: p.vlan,
                poe_status: p.poe_status,
                poe_power_mw: p.poe_power_mw,
                mac_count: macCount,
                is_trunk: isTrunk,
                single_mac: singleMac,
                single_mac_vendor: singleMacVendor,
                single_mac_ip: singleMacIp,
                single_mac_hostname: singleMacHostname,
                host_id: hostId,
                trunk_neighbor_name: p.trunk_neighbor_name ?? null,
                trunk_neighbor_port: p.trunk_neighbor_port ?? null,
                trunk_primary_device_id,
                trunk_primary_name,
                stp_state: p.stp_state ?? null,
              };
            });
            upsertSwitchPorts(deviceId, switchPorts);
          }
          results.push({ device_id: deviceId, device_name: device.name, success: true });
        } else {
          const client = await createSwitchClient(device);
          const entries = await client.getMacTable();
          upsertMacPortEntries(deviceId, entries.map((e) => ({
            mac: e.mac,
            port_name: e.port_name.trim(),
            vlan: e.vlan,
            port_status: e.port_status,
            speed: e.speed,
          })));
          const portInfos = await client.getPortSchema();
          if (portInfos.length > 0) {
            const macsByPort = new Map<string, { macs: string[]; vlan: number | null }>();
            for (const e of entries) {
              const key = normalizePortNameForMatch(e.port_name.trim());
              const existing = macsByPort.get(key) || { macs: [], vlan: e.vlan };
              existing.macs.push(e.mac);
              if (e.vlan != null) existing.vlan = e.vlan;
              macsByPort.set(key, existing);
            }
            const switchPorts = portInfos.map((p) => {
              const portMacs = macsByPort.get(normalizePortNameForMatch(p.port_name.trim()));
              const macCount = portMacs?.macs.length || 0;
              const isTrunk = macCount > 1 ? 1 : 0;
              let singleMac: string | null = null;
              let singleMacVendor: string | null = null;
              let singleMacIp: string | null = null;
              let singleMacHostname: string | null = null;
              let hostId: number | null = null;
              if (macCount === 1 && portMacs) {
                singleMac = portMacs.macs[0];
                const resolved = resolveMacToDevice(singleMac);
                singleMacIp = resolved.ip;
                singleMacHostname = resolved.hostname;
                singleMacVendor = resolved.vendor;
                hostId = resolved.host_id;
              }
              let trunk_primary_device_id: number | null = null;
              let trunk_primary_name: string | null = null;
              if (isTrunk && portMacs && !p.trunk_neighbor_name) {
                const matches: { device_id: number; device_name: string; device_type: string }[] = [];
                for (const mac of portMacs.macs) {
                  const nd = resolveMacToNetworkDevice(mac, deviceId);
                  if (nd) matches.push(nd);
                }
                const primary = matches.find((m) => m.device_type === "router") ?? matches[0];
                if (primary) {
                  trunk_primary_device_id = primary.device_id;
                  trunk_primary_name = primary.device_name;
                }
              }
              return {
                port_index: p.port_index,
                port_name: p.port_name.trim(),
                status: p.status,
                speed: p.speed,
                duplex: p.duplex,
                vlan: portMacs?.vlan ?? p.vlan,
                poe_status: p.poe_status,
                poe_power_mw: p.poe_power_mw,
                mac_count: macCount,
                is_trunk: isTrunk,
                single_mac: singleMac,
                single_mac_vendor: singleMacVendor,
                single_mac_ip: singleMacIp,
                single_mac_hostname: singleMacHostname,
                host_id: hostId,
                trunk_neighbor_name: p.trunk_neighbor_name ?? null,
                trunk_neighbor_port: p.trunk_neighbor_port ?? null,
                trunk_primary_device_id,
                trunk_primary_name,
                stp_state: p.stp_state ?? null,
              };
            });
            upsertSwitchPorts(deviceId, switchPorts);
          }
          results.push({ device_id: deviceId, device_name: device.name, success: true });
        }
      } catch (err) {
        results.push({
          device_id: deviceId,
          device_name: device.name,
          success: false,
          error: err instanceof Error ? err.message : "Errore sconosciuto",
        });
      }
    }

    const successCount = results.filter((r) => r.success).length;
    const failCount = results.filter((r) => !r.success).length;

    return NextResponse.json({
      success: failCount === 0,
      scanned: successCount,
      failed: failCount,
      results,
      message: `${successCount} dispositivi scansionati${failCount > 0 ? `, ${failCount} falliti` : ""}`,
    });
  } catch (error) {
    console.error("Bulk scan devices error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Errore nella scansione" },
      { status: 500 }
    );
  }
}
