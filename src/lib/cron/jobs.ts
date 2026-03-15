import {
  getScheduledJobs,
  getNetworks,
  getNetworkById,
  getNetworkDevices,
  getNetworkRouterId,
  getNetworkDeviceById,
  cleanupStaleHosts,
  getHostsByNetwork,
} from "@/lib/db";
import { discoverNetwork } from "@/lib/scanner/discovery";
import { reverseDns, forwardDns } from "@/lib/scanner/dns";
import { upsertHost } from "@/lib/db";
import { createRouterClient } from "@/lib/devices/router-client";
import { createSwitchClient } from "@/lib/devices/switch-client";
import { upsertArpEntries, upsertMacPortEntries, upsertSwitchPorts, resolveMacToDevice, resolveMacToNetworkDevice } from "@/lib/db";
import { lookupVendor } from "@/lib/scanner/mac-vendor";
import { isIpInCidr, normalizePortNameForMatch } from "@/lib/utils";

export async function runJob(jobId: number): Promise<void> {
  const jobs = getScheduledJobs();
  const job = jobs.find((j) => j.id === jobId);
  if (!job) throw new Error(`Job #${jobId} non trovato`);

  switch (job.job_type) {
    case "ping_sweep":
      await runPingSweep(job.network_id);
      break;
    case "nmap_scan":
      await runNmapScan(job.network_id);
      break;
    case "arp_poll":
      await runArpPoll();
      break;
    case "dns_resolve":
      await runDnsResolve(job.network_id);
      break;
    case "cleanup":
      await runCleanup(job.config);
      break;
  }
}

async function runPingSweep(networkId: number | null): Promise<void> {
  if (networkId) {
    await discoverNetwork(networkId, "ping");
  } else {
    const networks = getNetworks();
    for (const net of networks) {
      await discoverNetwork(net.id, "ping");
    }
  }
}

async function runNmapScan(networkId: number | null): Promise<void> {
  const { buildCustomScanArgs } = await import("@/lib/scanner/ports");
  const runForNetwork = async (nid: number) => {
    const network = getNetworkById(nid);
    if (!network) return;
    const nmapArgs = buildCustomScanArgs(null);
    const snmpCommunity = network.snmp_community ?? null;
    await discoverNetwork(nid, "nmap", nmapArgs, snmpCommunity);
  };
  if (networkId) {
    await runForNetwork(networkId);
  } else {
    const networks = getNetworks();
    for (const net of networks) {
      await runForNetwork(net.id);
    }
  }
}

export async function runArpPoll(): Promise<void> {
  const devices = getNetworkDevices()
    .filter((d) => d.enabled)
    .sort((a, b) => (a.device_type === "router" ? 0 : 1) - (b.device_type === "router" ? 0 : 1));
  const networks = getNetworks();

  for (const device of devices) {
    try {
      if (device.device_type === "router") {
        const client = await createRouterClient(device);
        const entries = await client.getArpTable();
        upsertArpEntries(device.id, entries);

        // Update host MAC addresses
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

        // MikroTik: recupera lease DHCP per popolare hostname, MAC e altri campi
        if (client.getDhcpLeases) {
          try {
            const leases = await client.getDhcpLeases();
            for (const lease of leases) {
              const network = networks.find((n) => isIpInCidr(lease.ip, n.cidr));
              if (!network) continue;
              upsertHost({
                network_id: network.id,
                ip: lease.ip,
                mac: lease.mac,
                ...(lease.hostname && { hostname: lease.hostname }),
              });
            }
          } catch (err) {
            console.error(`[DHCP Leases] Errore su ${device.name}:`, err);
          }
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
                const nd = resolveMacToNetworkDevice(mac, device.id);
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
            };
          });

          upsertSwitchPorts(device.id, switchPorts);
        }
      } else {
        const client = await createSwitchClient(device);
        const entries = await client.getMacTable();
        upsertMacPortEntries(device.id, entries.map((e) => ({
          mac: e.mac,
          port_name: e.port_name.trim(),
          vlan: e.vlan,
          port_status: e.port_status,
          speed: e.speed,
        })));

        // Port schema con cross-ref ARP/IPAM per assegnare device alla porta
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
                const nd = resolveMacToNetworkDevice(mac, device.id);
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
            };
          });

          upsertSwitchPorts(device.id, switchPorts);
        }
      }
    } catch (error) {
      console.error(`[ARP Poll] Errore su ${device.name}:`, error);
    }
  }
}

/** Recupera lease DHCP dal router MikroTik della rete per popolare hostname e MAC */
export async function runDhcpPollForNetwork(networkId: number): Promise<{ updated: number; error?: string }> {
  const routerId = getNetworkRouterId(networkId);
  if (!routerId) {
    return { updated: 0, error: "Nessun router configurato per questa rete" };
  }
  const device = getNetworkDeviceById(routerId);
  if (!device || device.device_type !== "router") {
    return { updated: 0, error: "Router non trovato" };
  }
  if (device.vendor !== "mikrotik" || device.protocol !== "ssh") {
    return { updated: 0, error: "Solo router MikroTik con SSH supporta il recupero DHCP" };
  }
  const networks = getNetworks();
  const network = networks.find((n) => n.id === networkId);
  if (!network) return { updated: 0, error: "Rete non trovata" };

  const client = await createRouterClient(device);
  if (!client.getDhcpLeases) {
    return { updated: 0, error: "Router non supporta DHCP leases" };
  }
  const leases = await client.getDhcpLeases();
  let updated = 0;
  for (const lease of leases) {
    if (!isIpInCidr(lease.ip, network.cidr)) continue;
    upsertHost({
      network_id: networkId,
      ip: lease.ip,
      mac: lease.mac,
      ...(lease.hostname && { hostname: lease.hostname }),
    });
    updated++;
  }
  return { updated };
}

async function runDnsResolve(networkId: number | null): Promise<void> {
  const networkIds = networkId
    ? [networkId]
    : getNetworks().map((n) => n.id);

  for (const nid of networkIds) {
    const network = getNetworkById(nid);
    const dnsServer = network?.dns_server ?? null;
    const hosts = getHostsByNetwork(nid);
    for (const host of hosts) {
      const dnsReverse = await reverseDns(host.ip, dnsServer);
      let dnsForward: string | undefined;
      if (dnsReverse) {
        const fwd = await forwardDns(dnsReverse, dnsServer);
        dnsForward = fwd.includes(host.ip) ? dnsReverse : undefined;
      }

      if (dnsReverse || dnsForward) {
        upsertHost({
          network_id: nid,
          ip: host.ip,
          hostname: dnsReverse || undefined,
          dns_reverse: dnsReverse || undefined,
          dns_forward: dnsForward || undefined,
        });
      }
    }
  }
}

async function runCleanup(configStr: string): Promise<void> {
  const config = JSON.parse(configStr || "{}");
  const daysUntilStale = config.days_until_stale || 30;
  const daysUntilDelete = config.days_until_delete || 90;

  const result = cleanupStaleHosts(daysUntilStale, daysUntilDelete);
  console.log(`[Cleanup] ${result.flagged} host segnalati stale, ${result.deleted} eliminati`);
}
