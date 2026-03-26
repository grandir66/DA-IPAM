import { withTenantFromSession } from "@/lib/api-tenant";
import { NextResponse } from "next/server";
import { getNetworkDeviceById, updateNetworkDevice, upsertArpEntries, upsertMacPortEntries, upsertSwitchPorts, resolveMacToDevice, resolveMacToNetworkDevice, getInventoryAssetByNetworkDevice, updateInventoryAsset, syncDeviceToHost, trackDeviceInfoChanges, upsertNeighbors, upsertRoutes, getDeviceCommunityString, cleanOrphanedForeignKeys } from "@/lib/db";
import { createRouterClient } from "@/lib/devices/router-client";
import { createSwitchClient } from "@/lib/devices/switch-client";
import { getDeviceInfo, resolveNasKind } from "@/lib/devices/device-info";
import { lookupVendor } from "@/lib/scanner/mac-vendor";
import { upsertHost, getNetworks, upsertDhcpLease, upsertMacIpMapping, syncIpAssignmentsForNetwork, getCurrentTenantCode } from "@/lib/db";
import { withTenant } from "@/lib/db-tenant";
import { isIpInCidr, normalizePortNameForMatch } from "@/lib/utils";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { networkDeviceUsesArpPoll } from "@/lib/network-device-arp";
import { getScanProgress } from "@/lib/scanner/discovery";
import type { ScanProgress } from "@/types";

// ═══════════════════════════════════════════════════════════════════════════
// Progress tracking (stessa map globale usata da discovery.ts)
// ═══════════════════════════════════════════════════════════════════════════

const GLOBAL_KEY = "__daipam_scan_progress__" as const;

function getProgressMap(): Map<string, ScanProgress> {
  const g = globalThis as Record<string, unknown>;
  if (!g[GLOBAL_KEY]) g[GLOBAL_KEY] = new Map<string, ScanProgress>();
  return g[GLOBAL_KEY] as Map<string, ScanProgress>;
}

let _deviceQueryCounter = 0;

function createDeviceQueryProgress(deviceName: string, scanType: string): ScanProgress {
  const id = `devquery-${++_deviceQueryCounter}-${Date.now()}`;
  const progress: ScanProgress = {
    id,
    network_id: 0,
    scan_type: scanType,
    status: "running",
    total: 0,
    scanned: 0,
    found: 0,
    phase: `Connessione a ${deviceName}...`,
    started_at: new Date().toISOString(),
    logs: [],
  };
  getProgressMap().set(id, progress);
  return progress;
}

function plog(p: ScanProgress, msg: string) {
  p.logs!.push(`[${new Date().toLocaleTimeString("it-IT")}] ${msg}`);
  if (p.logs!.length > 200) p.logs = p.logs!.slice(-200);
}

function finishProgress(p: ScanProgress, status: "completed" | "failed", phase: string) {
  p.status = status;
  p.phase = phase;
  p.scanned = p.total;
  setTimeout(() => getProgressMap().delete(p.id), 300_000);
}

// ═══════════════════════════════════════════════════════════════════════════
// Helper per salvare device info (condiviso tra router e switch)
// ═══════════════════════════════════════════════════════════════════════════

async function saveDeviceInfo(deviceId: number, device: { host: string; name: string; community_string?: string | null; snmp_credential_id?: number | null }, p: ScanProgress) {
  try {
    const info = await getDeviceInfo(device as Parameters<typeof getDeviceInfo>[0]);
    const now = new Date().toISOString();
    const hasInfo = info.sysname || info.sysdescr || info.model || info.firmware || info.serial_number || info.part_number;
    if (hasInfo) {
      const deviceInfoJson = JSON.stringify({ ...info, scanned_at: now });
      trackDeviceInfoChanges(deviceId, info);
      updateNetworkDevice(deviceId, {
        sysname: info.sysname ?? undefined,
        sysdescr: info.sysdescr ?? undefined,
        model: info.model ?? undefined,
        firmware: info.firmware ?? undefined,
        serial_number: info.serial_number ?? undefined,
        part_number: info.part_number ?? undefined,
        last_info_update: now,
        last_device_info_json: deviceInfoJson,
      });
      syncDeviceToHost(deviceId);
      const asset = getInventoryAssetByNetworkDevice(deviceId);
      if (asset) {
        updateInventoryAsset(asset.id, {
          modello: info.model ?? undefined,
          serial_number: info.serial_number ?? undefined,
          part_number: info.part_number ?? undefined,
          firmware_version: info.firmware ?? undefined,
          technical_data: deviceInfoJson,
        });
      }
      const fields = Object.keys(info).filter(k => info[k as keyof typeof info] != null);
      plog(p, `✓ Device info: ${fields.length} campi acquisiti`);
    } else {
      plog(p, "— Nessuna info dispositivo via SNMP");
    }
  } catch {
    plog(p, "— Device info non disponibile");
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Background task: router query
// ═══════════════════════════════════════════════════════════════════════════

async function runRouterQuery(deviceId: number, device: Parameters<typeof createRouterClient>[0], p: ScanProgress) {
  cleanOrphanedForeignKeys();

  p.phase = "Connessione al router...";
  const client = await createRouterClient(device);
  plog(p, `✓ Connesso a ${device.name} (${device.host})`);

  // ARP table
  p.phase = "Acquisizione tabella ARP...";
  const entries = await client.getArpTable();
  p.total = entries.length;
  plog(p, `✓ ${entries.length} entry ARP ricevute`);

  p.phase = "Salvataggio ARP entries...";
  upsertArpEntries(deviceId, entries);
  p.scanned = entries.length;
  plog(p, `✓ ARP entries salvate`);

  // Neighbors
  if (client.getNeighbors) {
    try {
      p.phase = "Acquisizione neighbors LLDP/CDP...";
      const neighbors = await client.getNeighbors();
      if (neighbors.length > 0) {
        upsertNeighbors(deviceId, neighbors);
        plog(p, `✓ ${neighbors.length} neighbors (LLDP/CDP/MNDP)`);
      } else {
        plog(p, "— Nessun neighbor trovato");
      }
    } catch { plog(p, "— Neighbors non disponibili"); }
  }

  // Routes
  if (client.getRoutingTable) {
    try {
      p.phase = "Acquisizione tabella routing...";
      const routes = await client.getRoutingTable();
      if (routes.length > 0) {
        upsertRoutes(deviceId, routes);
        plog(p, `✓ ${routes.length} route`);
      }
    } catch { plog(p, "— Routing table non disponibile"); }
  }

  // DHCP leases
  if (client.getDhcpLeases) {
    try {
      p.phase = "Acquisizione DHCP leases...";
      const leases = await client.getDhcpLeases();
      if (leases.length > 0) {
        const dhcpNetworks = new Set<number>();
        const nets = getNetworks();
        for (const lease of leases) {
          const network = nets.find((n) => isIpInCidr(lease.ip, n.cidr));
          if (!network) continue;
          const vendor = await lookupVendor(lease.mac);
          const host = upsertHost({
            network_id: network.id, ip: lease.ip, mac: lease.mac, status: "online",
            ...(lease.hostname && { hostname: lease.hostname }),
            hostname_source: "dhcp", vendor: vendor || undefined,
          });
          upsertMacIpMapping({
            mac: lease.mac, ip: lease.ip, source: "dhcp", source_device_id: deviceId,
            network_id: network.id, host_id: host.id, vendor: vendor ?? undefined,
            hostname: lease.hostname ?? undefined,
          });
          const sourceType = device.vendor === "mikrotik" ? "mikrotik" : "other";
          upsertDhcpLease({
            source_type: sourceType, source_device_id: deviceId, source_name: device.name,
            server_name: lease.server ?? null, ip_address: lease.ip, mac_address: lease.mac,
            hostname: lease.hostname ?? null, status: lease.status ?? null,
            lease_expires: lease.expiresAfter ?? null, description: lease.comment ?? null,
            dynamic_lease: lease.dynamic === true ? 1 : lease.dynamic === false ? 0 : null,
            host_id: host.id, network_id: network.id,
          });
          dhcpNetworks.add(network.id);
        }
        for (const nid of dhcpNetworks) syncIpAssignmentsForNetwork(nid);
        plog(p, `✓ ${leases.length} DHCP leases`);
      } else {
        plog(p, "— Nessun lease DHCP");
      }
    } catch (err) {
      plog(p, `✗ DHCP leases: ${err instanceof Error ? err.message : "errore"}`);
    }
  }

  // Aggiorna host con MAC/vendor da ARP
  p.phase = "Aggiornamento host da ARP...";
  const networks = getNetworks();
  let hostsUpdated = 0;
  for (const entry of entries) {
    if (!entry.ip || !entry.mac) continue;
    const network = networks.find((n) => isIpInCidr(entry.ip!, n.cidr));
    if (!network) continue;
    const vendor = await lookupVendor(entry.mac);
    upsertHost({ network_id: network.id, ip: entry.ip, mac: entry.mac, vendor: vendor || undefined });
    hostsUpdated++;
  }
  plog(p, `✓ ${hostsUpdated} host aggiornati con MAC/vendor`);

  // Port schema
  p.phase = "Acquisizione schema porte (SNMP)...";
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

    const switchPorts = portInfos.map((port) => {
      const portMacs = macsByPortByIndex.get(port.port_index) ?? macsByPortByName.get(normalizePortNameForMatch(port.port_name.trim()));
      const macCount = portMacs?.macs.length || 0;
      const isTrunk = macCount > 1 ? 1 : 0;
      let singleMac: string | null = null, singleMacVendor: string | null = null,
          singleMacIp: string | null = null, singleMacHostname: string | null = null, hostId: number | null = null;
      if (macCount === 1 && portMacs) {
        singleMac = portMacs.macs[0];
        const resolved = resolveMacToDevice(singleMac);
        singleMacIp = resolved.ip; singleMacHostname = resolved.hostname;
        singleMacVendor = resolved.vendor; hostId = resolved.host_id;
      }
      let trunk_primary_device_id: number | null = null, trunk_primary_name: string | null = null;
      if (isTrunk && portMacs && !port.trunk_neighbor_name) {
        const matches: { device_id: number; device_name: string; device_type: string }[] = [];
        for (const mac of portMacs.macs) {
          const nd = resolveMacToNetworkDevice(mac, deviceId);
          if (nd) matches.push(nd);
        }
        const primary = matches.find((m) => m.device_type === "router") ?? matches[0];
        if (primary) { trunk_primary_device_id = primary.device_id; trunk_primary_name = primary.device_name; }
      }
      return {
        port_index: port.port_index, port_name: port.port_name.trim(), status: port.status,
        speed: port.speed, duplex: port.duplex, vlan: port.vlan, poe_status: port.poe_status,
        poe_power_mw: port.poe_power_mw, mac_count: macCount, is_trunk: isTrunk,
        single_mac: singleMac, single_mac_vendor: singleMacVendor, single_mac_ip: singleMacIp,
        single_mac_hostname: singleMacHostname, host_id: hostId,
        trunk_neighbor_name: port.trunk_neighbor_name ?? null, trunk_neighbor_port: port.trunk_neighbor_port ?? null,
        trunk_primary_device_id, trunk_primary_name, stp_state: port.stp_state ?? null,
      };
    });
    upsertSwitchPorts(deviceId, switchPorts);
    plog(p, `✓ ${portInfos.length} porte switch`);
  } else {
    plog(p, "— Nessuna porta SNMP");
  }

  // Device info
  p.phase = "Acquisizione info dispositivo...";
  await saveDeviceInfo(deviceId, device, p);

  // STP via SNMP
  try {
    p.phase = "Acquisizione STP (SNMP)...";
    const { getSnmpStpInfo } = await import("@/lib/devices/snmp-stp-info");
    const snmpMod = await import("net-snmp");
    const community = getDeviceCommunityString(device);
    const session = snmpMod.createSession(device.host, community, { port: 161, timeout: 5000 });
    let sessionClosed = false;
    const safeClose = () => { if (!sessionClosed) { sessionClosed = true; try { session.close(); } catch { /* */ } } };
    const snmpWalk = (oid: string) => new Promise<{ oid: string; value: Buffer | string | number }[]>((resolve) => {
      const results: { oid: string; value: Buffer | string | number }[] = [];
      const timer = setTimeout(() => { safeClose(); resolve(results); }, 10_000);
      session.subtree(oid,
        (vbs: Array<{ oid: string; value: Buffer | string | number }>) => { for (const vb of vbs) results.push({ oid: vb.oid, value: vb.value }); },
        (err: Error | undefined) => { clearTimeout(timer); safeClose(); if (err) resolve([]); else resolve(results); }
      );
    });
    const stpInfo = await getSnmpStpInfo(snmpWalk);
    if (stpInfo) {
      updateNetworkDevice(deviceId, { stp_info: JSON.stringify(stpInfo) });
      plog(p, "✓ STP info acquisite");
    }
  } catch { /* STP opzionale */ }

  const portsMsg = portInfos.length > 0 ? `, ${portInfos.length} porte` : "";
  finishProgress(p, "completed", `Completata: ${entries.length} ARP${portsMsg}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// Background task: switch query
// ═══════════════════════════════════════════════════════════════════════════

async function runSwitchQuery(deviceId: number, device: Parameters<typeof createSwitchClient>[0], p: ScanProgress) {
  p.phase = "Connessione allo switch...";
  const client = await createSwitchClient(device);
  plog(p, `✓ Connesso a ${device.name} (${device.host})`);

  p.phase = "Acquisizione MAC table...";
  const entries = await client.getMacTable();
  p.total = entries.length;
  plog(p, `✓ ${entries.length} entry MAC`);

  upsertMacPortEntries(deviceId, entries.map((e) => ({
    mac: e.mac, port_name: e.port_name.trim(), vlan: e.vlan, port_status: e.port_status, speed: e.speed,
  })));
  p.scanned = entries.length;
  plog(p, `✓ MAC table salvata`);

  // Port schema
  p.phase = "Acquisizione schema porte...";
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

    const switchPorts = portInfos.map((port) => {
      const portMacs = macsByPort.get(normalizePortNameForMatch(port.port_name.trim()));
      const macCount = portMacs?.macs.length || 0;
      const isTrunk = macCount > 1 ? 1 : 0;
      let singleMac: string | null = null, singleMacVendor: string | null = null,
          singleMacIp: string | null = null, singleMacHostname: string | null = null, hostId: number | null = null;
      if (macCount === 1 && portMacs) {
        singleMac = portMacs.macs[0];
        const resolved = resolveMacToDevice(singleMac);
        singleMacIp = resolved.ip; singleMacHostname = resolved.hostname;
        singleMacVendor = resolved.vendor; hostId = resolved.host_id;
      }
      let trunk_primary_device_id: number | null = null, trunk_primary_name: string | null = null;
      if (isTrunk && portMacs && !port.trunk_neighbor_name) {
        const matches: { device_id: number; device_name: string; device_type: string }[] = [];
        for (const mac of portMacs.macs) {
          const nd = resolveMacToNetworkDevice(mac, deviceId);
          if (nd) matches.push(nd);
        }
        const primary = matches.find((m) => m.device_type === "router") ?? matches[0];
        if (primary) { trunk_primary_device_id = primary.device_id; trunk_primary_name = primary.device_name; }
      }
      return {
        port_index: port.port_index, port_name: port.port_name.trim(), status: port.status,
        speed: port.speed, duplex: port.duplex, vlan: portMacs?.vlan ?? port.vlan,
        poe_status: port.poe_status, poe_power_mw: port.poe_power_mw, mac_count: macCount,
        is_trunk: isTrunk, single_mac: singleMac, single_mac_vendor: singleMacVendor,
        single_mac_ip: singleMacIp, single_mac_hostname: singleMacHostname, host_id: hostId,
        trunk_neighbor_name: port.trunk_neighbor_name ?? null, trunk_neighbor_port: port.trunk_neighbor_port ?? null,
        trunk_primary_device_id, trunk_primary_name, stp_state: port.stp_state ?? null,
      };
    });
    upsertSwitchPorts(deviceId, switchPorts);
    plog(p, `✓ ${portInfos.length} porte switch`);
  }

  // Device info
  p.phase = "Acquisizione info dispositivo...";
  await saveDeviceInfo(deviceId, device, p);

  // STP
  try {
    if ("getStpInfo" in client && typeof client.getStpInfo === "function") {
      const stpInfo = await client.getStpInfo();
      if (stpInfo) {
        updateNetworkDevice(deviceId, { stp_info: JSON.stringify(stpInfo) });
        plog(p, "✓ STP info acquisite");
      }
    }
  } catch { /* STP opzionale */ }

  finishProgress(p, "completed", `Completata: ${entries.length} MAC, ${portInfos.length} porte`);
}

// ═══════════════════════════════════════════════════════════════════════════
// Background task: info-only query (Windows, SSH, SNMP)
// ═══════════════════════════════════════════════════════════════════════════

async function runInfoQuery(deviceId: number, device: Parameters<typeof getDeviceInfo>[0], scanLabel: string, p: ScanProgress) {
  p.phase = `Acquisizione dati ${scanLabel}...`;
  p.total = 1;
  const info = await getDeviceInfo(device);
  const now = new Date().toISOString();
  const hasInfo = info.sysname || info.sysdescr || info.model || info.firmware ||
    info.serial_number || info.part_number || info.os_name || info.hostname ||
    (info.nas_inventory != null);

  if (!hasInfo) {
    plog(p, `✗ Nessun dato acquisito via ${scanLabel}`);
    finishProgress(p, "failed", `Nessun dato da ${scanLabel}`);
    return;
  }

  const deviceInfoJson = JSON.stringify({ ...info, scanned_at: now });
  trackDeviceInfoChanges(deviceId, info);
  updateNetworkDevice(deviceId, {
    sysname: info.sysname ?? (info.hostname as string | undefined) ?? undefined,
    sysdescr: info.os_name ? `${info.os_name} ${info.os_version || ""}`.trim() : (info.sysdescr ?? undefined),
    model: info.model ?? undefined,
    firmware: info.os_build ? `Build ${info.os_build}` : (info.os_version ? info.os_version : (info.firmware ?? undefined)),
    serial_number: info.serial_number ?? undefined,
    part_number: info.part_number ?? undefined,
    last_info_update: now,
    last_device_info_json: deviceInfoJson,
  });
  syncDeviceToHost(deviceId);
  const asset = getInventoryAssetByNetworkDevice(deviceId);
  if (asset) {
    updateInventoryAsset(asset.id, {
      modello: info.model ?? undefined,
      serial_number: info.serial_number ?? undefined,
      firmware_version: info.os_name ? `${info.os_name} ${info.os_version || ""}`.trim() : (info.firmware ?? undefined),
      technical_data: deviceInfoJson,
    });
  }
  const fields = Object.keys(info).filter(k => info[k as keyof typeof info] != null);
  p.scanned = 1;
  plog(p, `✓ ${fields.length} campi acquisiti: ${fields.join(", ")}`);
  finishProgress(p, "completed", `${scanLabel}: ${fields.length} campi acquisiti`);
}

// ═══════════════════════════════════════════════════════════════════════════
// POST handler
// ═══════════════════════════════════════════════════════════════════════════

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
      const isWindows = device.protocol === "winrm" || device.vendor === "windows" || scanTarget === "windows";
      const isLinuxVendor = scanTarget === "linux" || device.vendor === "linux" || device.vendor === "other" || device.vendor === "synology" || device.vendor === "qnap";
      const isSshScannable = isLinuxVendor || nasKindRoute != null;
      const isSnmpInfoDevice = (device.protocol === "snmp_v2" || device.protocol === "snmp_v3" || device.community_string || device.snmp_credential_id)
        && ["stampante", "telecamera", "voip", "iot", "access_point", "firewall", "vm"].includes(device.classification ?? "");

      // Determina tipo di scan e label
      let scanType: string;
      let scanLabel: string;
      if (isWindows) { scanType = "windows"; scanLabel = "WinRM"; }
      else if (isSshScannable) { scanType = "ssh"; scanLabel = nasKindRoute != null ? "Storage" : "Linux/SSH"; }
      else if (isSnmpInfoDevice) { scanType = "snmp"; scanLabel = "SNMP"; }
      else if (networkDeviceUsesArpPoll(device)) { scanType = "arp_poll"; scanLabel = "Router"; }
      else { scanType = "switch"; scanLabel = "Switch"; }

      // Crea progress e lancia task in background
      const progress = createDeviceQueryProgress(device.name, `${scanLabel} — ${device.name}`);

      const tenantCode = getCurrentTenantCode();
      const deviceId = Number(id);

      const runTask = async () => {
        try {
          if (isWindows || isSshScannable || isSnmpInfoDevice) {
            await runInfoQuery(deviceId, device as Parameters<typeof getDeviceInfo>[0], scanLabel, progress);
          } else if (networkDeviceUsesArpPoll(device)) {
            await runRouterQuery(deviceId, device as Parameters<typeof createRouterClient>[0], progress);
          } else {
            await runSwitchQuery(deviceId, device as Parameters<typeof createSwitchClient>[0], progress);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Errore sconosciuto";
          console.error(`[Device Query] Error device ${deviceId}:`, err);
          plog(progress, `✗ ${msg}`);
          finishProgress(progress, "failed", msg);
        }
      };

      const bgTask = tenantCode ? withTenant(tenantCode, runTask) : runTask();
      bgTask.catch((err) => {
        console.error(`[Device Query] Unhandled error device ${deviceId}:`, err);
        const msg = err instanceof Error ? err.message : "Errore fatale";
        plog(progress, `✗ ${msg}`);
        finishProgress(progress, "failed", msg);
      });

      return NextResponse.json({ id: progress.id, progress });
    } catch (error) {
      console.error("Device query error:", error);
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Errore nella query" },
        { status: 500 }
      );
    }
  });
}
