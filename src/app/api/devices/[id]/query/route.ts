import { withTenantFromSession } from "@/lib/api-tenant";
import { NextResponse } from "next/server";
import { getNetworkDeviceById, updateNetworkDevice, upsertArpEntries, upsertMacPortEntries, upsertSwitchPorts, resolveMacToDevice, resolveMacToNetworkDevice, getInventoryAssetByNetworkDevice, updateInventoryAsset, syncDeviceToHost, trackDeviceInfoChanges, upsertNeighbors, upsertRoutes, getDeviceCommunityString } from "@/lib/db";
import { createRouterClient } from "@/lib/devices/router-client";
import { createSwitchClient } from "@/lib/devices/switch-client";
import { getDeviceInfo, resolveNasKind } from "@/lib/devices/device-info";
import { lookupVendor } from "@/lib/scanner/mac-vendor";
import { upsertHost, getNetworks } from "@/lib/db";
import { isIpInCidr, normalizePortNameForMatch } from "@/lib/utils";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { networkDeviceUsesArpPoll } from "@/lib/network-device-arp";

const QUERY_TIMEOUT_MS = 120_000; // 2 min server-side (allineato al client)

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Timeout: la scansione ha superato i 2 minuti. Verifica connettività del dispositivo.")), ms)
    ),
  ]);
}

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withTenantFromSession(async () => {
  try {
    const adminCheck = await requireAdmin();
    if (isAuthError(adminCheck)) return adminCheck;
    const { id } = await params;
    const device = getNetworkDeviceById(Number(id));
    if (!device) {
      return NextResponse.json({ error: "Dispositivo non trovato" }, { status: 404 });
    }

    const scanTarget = (device as { scan_target?: string | null }).scan_target;
    const nasKindRoute = resolveNasKind(device);
    const isWindows =
      device.protocol === "winrm" || device.vendor === "windows" || scanTarget === "windows";
    // SSH-scannable: vendor Linux-type (linux/other/synology/qnap) OPPURE scan_target=linux,
    // indipendentemente dal protocol (un host Linux può avere anche SNMP configurato).
    // Anche classificazione nas_synology / nas_qnap con vendor ancora "generic".
    const isLinuxVendor =
      scanTarget === "linux" ||
      device.vendor === "linux" ||
      device.vendor === "other" ||
      device.vendor === "synology" ||
      device.vendor === "qnap";
    const isSshScannable = isLinuxVendor || nasKindRoute != null;
    const isSnmpInfoDevice =
      (device.protocol === "snmp_v2" || device.protocol === "snmp_v3" || device.community_string || device.snmp_credential_id)
      && ["stampante", "telecamera", "voip", "iot", "access_point", "firewall", "vm"].includes(device.classification ?? "");

    const result = await withTimeout(
      (async () => {
        if (isWindows) {
          const info = await getDeviceInfo(device);
          const now = new Date().toISOString();
          const hasInfo =
            info.sysname ||
            info.sysdescr ||
            info.model ||
            info.firmware ||
            info.serial_number ||
            info.part_number ||
            info.os_name ||
            info.hostname;
          if (!hasInfo) {
            return NextResponse.json(
              {
                error:
                  "Nessun dato acquisito via WinRM/SNMP. Verifica: protocollo e porta (5985 HTTP / 5986 HTTPS), credenziale Windows collegata al dispositivo, firewall verso l'IP, e su Windows: winrm quickconfig e Basic auth se necessario.",
              },
              { status: 502 }
            );
          }
          const deviceInfoJson = JSON.stringify({ ...info, scanned_at: now });
          trackDeviceInfoChanges(Number(id), info);
          updateNetworkDevice(Number(id), {
            sysname: info.sysname ?? (info.hostname as string | undefined) ?? undefined,
            sysdescr: info.os_name ? `${info.os_name} ${info.os_version || ""}`.trim() : (info.sysdescr ?? undefined),
            model: info.model ?? undefined,
            firmware: info.os_build ? `Build ${info.os_build}` : (info.firmware ?? undefined),
            serial_number: info.serial_number ?? undefined,
            part_number: info.part_number ?? undefined,
            last_info_update: now,
            last_device_info_json: deviceInfoJson,
          });
          syncDeviceToHost(Number(id));
          const asset = getInventoryAssetByNetworkDevice(Number(id));
          if (asset) {
            updateInventoryAsset(asset.id, {
              modello: info.model ?? undefined,
              serial_number: info.serial_number ?? undefined,
              firmware_version: info.os_name ? `${info.os_name} ${info.os_version || ""}`.trim() : undefined,
              technical_data: deviceInfoJson,
            });
          }
          const fields = Object.keys(info).filter(k => info[k as keyof typeof info] != null).length;
          return NextResponse.json({
            success: true,
            message: `Dati Windows acquisiti: ${fields} campi da ${device.name}`,
          });
        }

        if (isSshScannable) {
          const info = await getDeviceInfo(device);
          const now = new Date().toISOString();
          const hasNasPayload =
            (info.nas_inventory != null &&
              (info.nas_inventory.snmp != null || info.nas_inventory.ssh != null)) ||
            (Array.isArray(info.disks) && info.disks.length > 0) ||
            (Array.isArray(info.physical_disks) && info.physical_disks.length > 0) ||
            (Array.isArray(info.network_adapters) && info.network_adapters.length > 0);
          const hasInfo =
            info.sysname ||
            info.sysdescr ||
            info.model ||
            info.firmware ||
            info.serial_number ||
            info.part_number ||
            info.os_name ||
            info.hostname ||
            hasNasPayload;
          if (!hasInfo) {
            return NextResponse.json(
              {
                error:
                  "Nessun dato acquisito via SSH. Verifica: protocollo SSH, porta (default 22), credenziale collegata al dispositivo, utente con shell e accesso (sudo se necessario per dmidecode).",
              },
              { status: 502 }
            );
          }
          const deviceInfoJsonSsh = JSON.stringify({ ...info, scanned_at: now });
          trackDeviceInfoChanges(Number(id), info);
          updateNetworkDevice(Number(id), {
            sysname: info.sysname ?? (info.hostname as string | undefined) ?? undefined,
            sysdescr: info.os_name ? `${info.os_name} ${info.os_version || ""}`.trim() : (info.sysdescr ?? undefined),
            model: info.model ?? undefined,
            firmware: info.os_version ? info.os_version : (info.firmware ?? undefined),
            serial_number: info.serial_number ?? undefined,
            part_number: info.part_number ?? undefined,
            last_info_update: now,
            last_device_info_json: deviceInfoJsonSsh,
          });
          syncDeviceToHost(Number(id));
          const assetSsh = getInventoryAssetByNetworkDevice(Number(id));
          if (assetSsh) {
            updateInventoryAsset(assetSsh.id, {
              modello: info.model ?? undefined,
              serial_number: info.serial_number ?? undefined,
              firmware_version: info.os_name ? `${info.os_name} ${info.os_version || ""}`.trim() : undefined,
              technical_data: deviceInfoJsonSsh,
            });
          }
          const fields = Object.keys(info).filter(k => info[k as keyof typeof info] != null).length;
          const scanType = nasKindRoute != null ? "Storage" : "Linux";
          return NextResponse.json({
            success: true,
            message: `Dati ${scanType} acquisiti: ${fields} campi da ${device.name}`,
          });
        }

        if (isSnmpInfoDevice) {
          const info = await getDeviceInfo(device);
          const now = new Date().toISOString();
          const hasInfo = info.sysname || info.sysdescr || info.model || info.firmware || info.serial_number || info.part_number;
          if (hasInfo) {
            const deviceInfoJson = JSON.stringify({ ...info, scanned_at: now });
            trackDeviceInfoChanges(Number(id), info);
            updateNetworkDevice(Number(id), {
              sysname: info.sysname ?? (info.hostname as string | undefined) ?? undefined,
              sysdescr: info.sysdescr ?? undefined,
              model: info.model ?? undefined,
              firmware: info.firmware ?? undefined,
              serial_number: info.serial_number ?? undefined,
              part_number: info.part_number ?? undefined,
              last_info_update: now,
              last_device_info_json: deviceInfoJson,
            });
            // Sync info su host collegato
            syncDeviceToHost(Number(id));
            const asset = getInventoryAssetByNetworkDevice(Number(id));
            if (asset) {
              updateInventoryAsset(asset.id, {
                modello: info.model ?? undefined,
                serial_number: info.serial_number ?? undefined,
                firmware_version: info.sysdescr ?? undefined,
                technical_data: deviceInfoJson,
              });
            }
          }
          const fields = Object.keys(info).filter(k => info[k as keyof typeof info] != null).length;
          return NextResponse.json({
            success: true,
            message: `Dati SNMP acquisiti: ${fields} campi da ${device.name}`,
          });
        }

        if (networkDeviceUsesArpPoll(device)) {
          const client = await createRouterClient(device);
      const entries = await client.getArpTable();

      upsertArpEntries(Number(id), entries);

      // Neighbors LLDP/CDP/MNDP
      if (client.getNeighbors) {
        try {
          const neighbors = await client.getNeighbors();
          if (neighbors.length > 0) upsertNeighbors(Number(id), neighbors);
        } catch { /* optional */ }
      }

      // Tabella di routing
      if (client.getRoutingTable) {
        try {
          const routes = await client.getRoutingTable();
          if (routes.length > 0) upsertRoutes(Number(id), routes);
        } catch { /* optional */ }
      }

      // DHCP leases (MikroTik, Ubiquiti, ecc.)
      if (client.getDhcpLeases) {
        try {
          const { upsertDhcpLease, upsertMacIpMapping, syncIpAssignmentsForNetwork } = await import("@/lib/db");
          const leases = await client.getDhcpLeases();
          const dhcpNetworks = new Set<number>();
          const nets = getNetworks();
          for (const lease of leases) {
            const network = nets.find((n) => isIpInCidr(lease.ip, n.cidr));
            if (!network) continue;
            const vendor = await lookupVendor(lease.mac);
            const host = upsertHost({
              network_id: network.id,
              ip: lease.ip,
              mac: lease.mac,
              status: "online",
              ...(lease.hostname && { hostname: lease.hostname }),
              hostname_source: "dhcp",
              vendor: vendor || undefined,
            });
            upsertMacIpMapping({
              mac: lease.mac,
              ip: lease.ip,
              source: "dhcp",
              source_device_id: Number(id),
              network_id: network.id,
              host_id: host.id,
              vendor: vendor ?? undefined,
              hostname: lease.hostname ?? undefined,
            });
            const sourceType = device.vendor === "mikrotik" ? "mikrotik" : "other";
            upsertDhcpLease({
              source_type: sourceType,
              source_device_id: Number(id),
              source_name: device.name,
              server_name: lease.server ?? null,
              ip_address: lease.ip,
              mac_address: lease.mac,
              hostname: lease.hostname ?? null,
              status: lease.status ?? null,
              lease_expires: lease.expiresAfter ?? null,
              description: lease.comment ?? null,
              dynamic_lease: lease.dynamic === true ? 1 : lease.dynamic === false ? 0 : null,
              host_id: host.id,
              network_id: network.id,
            });
            dhcpNetworks.add(network.id);
          }
          for (const nid of dhcpNetworks) syncIpAssignmentsForNetwork(nid);
        } catch { /* DHCP optional */ }
      }

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

      // Schema porte e LLDP/CDP (SNMP)
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

        const deviceId = Number(id);
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

      try {
        const info = await getDeviceInfo(device);
        const now = new Date().toISOString();
        const hasInfo = info.sysname || info.sysdescr || info.model || info.firmware || info.serial_number || info.part_number;
        if (hasInfo) {
          const deviceInfoJson = JSON.stringify({ ...info, scanned_at: now });
          trackDeviceInfoChanges(Number(id), info);
          updateNetworkDevice(Number(id), {
            sysname: info.sysname ?? undefined,
            sysdescr: info.sysdescr ?? undefined,
            model: info.model ?? undefined,
            firmware: info.firmware ?? undefined,
            serial_number: info.serial_number ?? undefined,
            part_number: info.part_number ?? undefined,
            last_info_update: now,
            last_device_info_json: deviceInfoJson,
          });
          // Sync info su host collegato
          syncDeviceToHost(Number(id));
          const asset = getInventoryAssetByNetworkDevice(Number(id));
          if (asset) {
            const technicalData = JSON.stringify({
              source: "device",
              sysname: info.sysname,
              sysdescr: info.sysdescr,
              model: info.model,
              firmware: info.firmware,
              serial_number: info.serial_number,
              part_number: info.part_number,
              last_info_update: now,
            });
            updateInventoryAsset(asset.id, {
              modello: info.model ?? undefined,
              serial_number: info.serial_number ?? undefined,
              part_number: info.part_number ?? undefined,
              firmware_version: info.firmware ?? undefined,
              technical_data: technicalData,
            });
          }
        }
      } catch { /* device info opzionale */ }

      // STP via SNMP (router — stessa logica degli switch)
      try {
        const { getSnmpStpInfo } = await import("@/lib/devices/snmp-stp-info");
        const snmpMod = await import("net-snmp");
        const community = getDeviceCommunityString(device);
        const snmpPort = device.protocol === "snmp_v2" || device.protocol === "snmp_v3" ? (device.port || 161) : 161;
        const session = snmpMod.createSession(device.host, community, { port: snmpPort, timeout: 8000 });
        const snmpWalk = (oid: string) => new Promise<{ oid: string; value: Buffer | string | number }[]>((resolve, reject) => {
          const results: { oid: string; value: Buffer | string | number }[] = [];
          session.subtree(oid, (vbs: Array<{ oid: string; value: Buffer | string | number }>) => { for (const vb of vbs) results.push({ oid: vb.oid, value: vb.value }); }, (err: Error | undefined) => { session.close(); if (err) reject(err); else resolve(results); });
        });
        const stpInfo = await getSnmpStpInfo(snmpWalk);
        if (stpInfo) {
          updateNetworkDevice(Number(id), { stp_info: JSON.stringify(stpInfo) });
        }
      } catch { /* STP opzionale */ }

      const portsMsg = portInfos.length > 0 ? ` e ${portInfos.length} porte` : "";
      return NextResponse.json({
        success: true,
        entries_count: entries.length,
        ports_count: portInfos.length,
        message: `${entries.length} entry ARP${portsMsg} acquisite da ${device.name}`,
      });
    } else {
      const client = await createSwitchClient(device);
      const entries = await client.getMacTable();

      upsertMacPortEntries(
        Number(id),
        entries.map((e) => ({
          mac: e.mac,
          port_name: e.port_name.trim(),
          vlan: e.vlan,
          port_status: e.port_status,
          speed: e.speed,
        }))
      );

      // Collect port schema and aggregate MACs per port
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

        const deviceId = Number(id);
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

      try {
        const info = await getDeviceInfo(device);
        const now = new Date().toISOString();
        const hasInfo = info.sysname || info.sysdescr || info.model || info.firmware || info.serial_number || info.part_number;
        if (hasInfo) {
          const deviceInfoJson = JSON.stringify({ ...info, scanned_at: now });
          trackDeviceInfoChanges(Number(id), info);
          updateNetworkDevice(Number(id), {
            sysname: info.sysname ?? undefined,
            sysdescr: info.sysdescr ?? undefined,
            model: info.model ?? undefined,
            firmware: info.firmware ?? undefined,
            serial_number: info.serial_number ?? undefined,
            part_number: info.part_number ?? undefined,
            last_info_update: now,
            last_device_info_json: deviceInfoJson,
          });
          // Sync info su host collegato
          syncDeviceToHost(Number(id));
          const asset = getInventoryAssetByNetworkDevice(Number(id));
          if (asset) {
            const technicalData = JSON.stringify({
              source: "device",
              sysname: info.sysname,
              sysdescr: info.sysdescr,
              model: info.model,
              firmware: info.firmware,
              serial_number: info.serial_number,
              part_number: info.part_number,
              last_info_update: now,
            });
            updateInventoryAsset(asset.id, {
              modello: info.model ?? undefined,
              serial_number: info.serial_number ?? undefined,
              part_number: info.part_number ?? undefined,
              firmware_version: info.firmware ?? undefined,
              technical_data: technicalData,
            });
          }
        }
      } catch { /* device info opzionale */ }

      try {
        if ("getStpInfo" in client && typeof client.getStpInfo === "function") {
          const stpInfo = await client.getStpInfo();
          if (stpInfo) {
            updateNetworkDevice(Number(id), { stp_info: JSON.stringify(stpInfo) });
          }
        }
      } catch { /* STP opzionale */ }

      return NextResponse.json({
        success: true,
        entries_count: entries.length,
        ports_count: portInfos.length,
        message: `${entries.length} MAC e ${portInfos.length} porte acquisite da ${device.name}`,
      });
    }
      })(),
      QUERY_TIMEOUT_MS
    );

    return result;
  } catch (error) {
    console.error("Device query error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Errore nella query" },
      { status: 500 }
    );
  }
  });
}
