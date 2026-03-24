import {
  getScheduledJobs,
  getNetworks,
  getNetworkById,
  getNetworkDevices,
  getNetworkRouterId,
  getNetworkDeviceById,
  cleanupStaleHosts,
  getHostsByNetwork,
  getKnownHosts,
  updateHost,
  addStatusHistory,
  getDb,
  getActiveNmapProfile,
  upsertHost,
  upsertArpEntries,
  upsertMacPortEntries,
  upsertSwitchPorts,
  resolveMacToDevice,
  resolveMacToNetworkDevice,
  upsertMacIpMapping,
  upsertDhcpLease,
  syncIpAssignmentsForNetwork,
  upsertNeighbors,
  upsertRoutes,
} from "@/lib/db";
import { discoverNetwork } from "@/lib/scanner/discovery";
import { reverseDns, forwardDns } from "@/lib/scanner/dns";
import { pingHost } from "@/lib/scanner/ping";
import { tcpConnect, FALLBACK_TCP_PORTS } from "@/lib/scanner/tcp-check";
import { createRouterClient } from "@/lib/devices/router-client";
import { createSwitchClient } from "@/lib/devices/switch-client";
import { lookupVendor } from "@/lib/scanner/mac-vendor";
import { classifyDevice } from "@/lib/device-classifier";
import { isIpInCidr, normalizePortNameForMatch } from "@/lib/utils";

export async function runJob(jobId: number): Promise<void> {
  const jobs = getScheduledJobs();
  const job = jobs.find((j) => j.id === jobId);
  if (!job) throw new Error(`Job #${jobId} non trovato`);

  switch (job.job_type) {
    case "ping_sweep":
      await runPingSweep(job.network_id);
      break;
    case "snmp_scan":
      await runSnmpScan(job.network_id);
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
    case "known_host_check":
      await runKnownHostCheck(job.network_id);
      break;
    case "cleanup":
      await runCleanup(job.config);
      break;
    case "ad_sync":
      await runAdSync(job.config);
      break;
  }
}

async function runPingSweep(networkId: number | null): Promise<void> {
  if (networkId) {
    await discoverNetwork(networkId, "network_discovery");
  } else {
    const networks = getNetworks();
    for (const net of networks) {
      await discoverNetwork(net.id, "network_discovery");
    }
  }
}

async function runSnmpScan(networkId: number | null): Promise<void> {
  const runForNetwork = async (nid: number) => {
    const network = getNetworkById(nid);
    if (!network) return;
    const snmpCommunity = network.snmp_community ?? null;
    await discoverNetwork(nid, "snmp", undefined, snmpCommunity);
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

async function runNmapScan(networkId: number | null): Promise<void> {
  const { buildCustomScanArgs } = await import("@/lib/scanner/ports");
  const profile = getActiveNmapProfile();
  const runForNetwork = async (nid: number) => {
    const network = getNetworkById(nid);
    if (!network) return;
    let nmapArgs: string | undefined;
    let tcpPorts: string | null = null;
    let udpPorts: string | null = null;
    if (profile) {
      tcpPorts = profile.tcp_ports ?? null;
      udpPorts = profile.udp_ports ?? null;
      if (!tcpPorts) {
        nmapArgs =
          profile.custom_ports !== null && profile.custom_ports !== undefined
            ? buildCustomScanArgs(profile.custom_ports)
            : profile.args || buildCustomScanArgs(null);
      }
    } else {
      nmapArgs = buildCustomScanArgs(null);
    }
    const snmpCommunity = profile?.snmp_community || network.snmp_community || null;
    await discoverNetwork(nid, "nmap", nmapArgs, snmpCommunity, { tcpPorts, udpPorts });
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

export type RunArpPollOptions = {
  /** Se impostato, aggiorna solo questi IP (nessun nuovo host da voci ARP fuori elenco). */
  onlyEnrichIps?: string[];
  /** Se true, non importa lease DHCP MikroTik (evita host extra durante scoperta rete). */
  skipDhcpLeases?: boolean;
};

export async function runArpPoll(
  networkId?: number | null,
  options?: RunArpPollOptions
): Promise<{ phase?: string; error?: string }> {
  const networks = getNetworks();
  const enrichSet = options?.onlyEnrichIps?.length ? new Set(options.onlyEnrichIps) : null;
  let devices = getNetworkDevices()
    .filter((d) => d.enabled)
    .sort((a, b) => (a.device_type === "router" ? 0 : 1) - (b.device_type === "router" ? 0 : 1));

  if (networkId != null) {
    const routerId = getNetworkRouterId(networkId);
    if (!routerId) {
      return { error: "Nessun router assegnato a questa rete. Assegna un router dalla pagina di modifica rete." };
    }
    const device = devices.find((d) => d.id === routerId);
    if (!device || device.device_type !== "router") {
      return { error: "Router non trovato o non abilitato" };
    }
    devices = [device];
  }

  for (const device of devices) {
    try {
      if (device.device_type === "hypervisor") {
        continue;
      }
      if (device.device_type === "router") {
        const client = await createRouterClient(device);
        const entries = await client.getArpTable();

        // Prima aggiorna hosts con MAC e vendor, poi upsertArpEntries (così host_id in arp_entries è corretto)
        for (const entry of entries) {
          if (!entry.ip || !entry.mac) continue;
          if (enrichSet && !enrichSet.has(entry.ip)) continue;
          const network = networks.find((n) => isIpInCidr(entry.ip!, n.cidr));
          if (!network) continue;
          const vendor = await lookupVendor(entry.mac);
          const classification = classifyDevice({ hostname: null, vendor: vendor ?? null });
          upsertHost({
            network_id: network.id,
            ip: entry.ip,
            mac: entry.mac,
            vendor: vendor || undefined,
            status: "online",
            hostname_source: "arp",
            ...(classification && { classification }),
          });
        }
        upsertArpEntries(device.id, entries, (ip) => {
          const n = networks.find((net) => isIpInCidr(ip, net.cidr));
          return n?.id ?? null;
        });

        // MikroTik: recupera lease DHCP per popolare hostname, MAC e altri campi
        if (client.getDhcpLeases && !options?.skipDhcpLeases) {
          try {
            const leases = await client.getDhcpLeases();
            const dhcpNetworksToSync = new Set<number>();
            for (const lease of leases) {
              if (enrichSet && !enrichSet.has(lease.ip)) continue;
              const network = networks.find((n) => isIpInCidr(lease.ip, n.cidr));
              if (!network) continue;
              const vendor = await lookupVendor(lease.mac);
              const classification = classifyDevice({
                hostname: lease.hostname ?? null,
                vendor: vendor ?? null,
              });
              const host = upsertHost({
                network_id: network.id,
                ip: lease.ip,
                mac: lease.mac,
                status: "online",
                ...(lease.hostname && { hostname: lease.hostname }),
                hostname_source: "dhcp",
                vendor: vendor || undefined,
                ...(classification && { classification }),
              });
              upsertMacIpMapping({
                mac: lease.mac,
                ip: lease.ip,
                source: "dhcp",
                source_device_id: device.id,
                network_id: network.id,
                host_id: host.id,
                vendor: vendor ?? undefined,
                hostname: lease.hostname ?? undefined,
              });
              upsertDhcpLease({
                source_type: "mikrotik",
                source_device_id: device.id,
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
              dhcpNetworksToSync.add(network.id);
            }
            for (const nid of dhcpNetworksToSync) {
              syncIpAssignmentsForNetwork(nid);
            }
          } catch (err) {
            console.error(`[DHCP Leases] Errore su ${device.name}:`, err);
          }
        }

        // Schema porte e LLDP/CDP (SNMP)
        const portInfos = await client.getPortSchema?.().catch((err: unknown) => {
          console.warn(`[ARP Poll] getPortSchema fallito per ${device.name}:`, err instanceof Error ? err.message : err);
          return [];
        }) ?? [];
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
              stp_state: p.stp_state ?? null,
            };
          });

          upsertSwitchPorts(device.id, switchPorts);
        }

        // Neighbors LLDP/CDP/MNDP
        if (client.getNeighbors) {
          try {
            const neighbors = await client.getNeighbors();
            if (neighbors.length > 0) {
              upsertNeighbors(device.id, neighbors);
            }
          } catch (err) {
            console.warn(`[Neighbors] Errore su ${device.name}:`, err);
          }
        }

        // Tabella di routing
        if (client.getRoutingTable) {
          try {
            const routes = await client.getRoutingTable();
            if (routes.length > 0) {
              upsertRoutes(device.id, routes);
            }
          } catch (err) {
            console.warn(`[Routing] Errore su ${device.name}:`, err);
          }
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

        // Popola mac_ip_mapping con MAC da switch risolti a IP (hosts/ARP)
        const switchNetwork = networks.find((n) => isIpInCidr(device.host, n.cidr));
        for (const e of entries) {
          if (!e.mac) continue;
          const resolved = resolveMacToDevice(e.mac);
          if (resolved.ip) {
            upsertMacIpMapping({
              mac: e.mac,
              ip: resolved.ip,
              source: "switch",
              source_device_id: device.id,
              network_id: switchNetwork?.id ?? null,
              host_id: resolved.host_id,
              vendor: resolved.vendor ?? undefined,
              hostname: resolved.hostname ?? undefined,
            });
          }
        }

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
            stp_state: p.stp_state ?? null,
          };
        });

        upsertSwitchPorts(device.id, switchPorts);
      }
    }
    } catch (error) {
      console.error(`[ARP Poll] Errore su ${device.name}:`, error);
    }
  }
  const network = networkId != null ? networks.find((n) => n.id === networkId) : null;
  const phase = networkId != null && network
    ? `ARP poll completato per ${network.name}`
    : "ARP poll completato";
  return { phase };
}

/** Recupera lease DHCP dal router MikroTik della rete per popolare hostname e MAC */
export async function runDhcpPollForNetwork(
  networkId: number,
  options?: { onlyIps?: string[] }
): Promise<{ updated: number; error?: string }> {
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
  const allow = options?.onlyIps?.length ? new Set(options.onlyIps) : null;
  let updated = 0;
  for (const lease of leases) {
    if (allow && !allow.has(lease.ip)) continue;
    if (!isIpInCidr(lease.ip, network.cidr)) continue;
    const vendor = await lookupVendor(lease.mac);
    const classification = classifyDevice({
      hostname: lease.hostname ?? null,
      vendor: vendor ?? null,
    });
    const host = upsertHost({
      network_id: networkId,
      ip: lease.ip,
      mac: lease.mac,
      ...(lease.hostname && { hostname: lease.hostname }),
      hostname_source: "dhcp",
      vendor: vendor || undefined,
      ...(classification && { classification }),
    });
    upsertMacIpMapping({
      mac: lease.mac,
      ip: lease.ip,
      source: "dhcp",
      source_device_id: device.id,
      network_id: networkId,
      host_id: host.id,
      vendor: vendor ?? undefined,
      hostname: lease.hostname ?? undefined,
    });
    upsertDhcpLease({
      source_type: "mikrotik",
      source_device_id: device.id,
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
      network_id: networkId,
    });
    updated++;
  }
  syncIpAssignmentsForNetwork(networkId);
  return { updated };
}

export async function runKnownHostCheck(networkId: number | null): Promise<void> {
  const hosts = getKnownHosts(networkId);
  const timeoutMs = 3000;

  for (const host of hosts) {
    let alive = false;
    let latencyMs: number | null = null;

    const pingResult = await pingHost(host.ip, timeoutMs);
    latencyMs = pingResult.latency_ms;
    if (pingResult.alive) {
      alive = true;
    } else {
      // Use custom monitor_ports if set, otherwise fallback
      let portsToCheck: number[] = FALLBACK_TCP_PORTS;
      if (host.monitor_ports) {
        try {
          const parsed = JSON.parse(host.monitor_ports) as number[];
          if (Array.isArray(parsed) && parsed.length > 0) {
            portsToCheck = parsed;
          }
        } catch { /* invalid JSON, use fallback */ }
      }
      for (const port of portsToCheck) {
        const ok = await tcpConnect(host.ip, port, 2000);
        if (ok) {
          alive = true;
          break;
        }
      }
    }

    const newStatus = alive ? "online" : "offline";
    // Always record status history with latency
    addStatusHistory(host.id, newStatus, latencyMs);
    // Always update host status and latency
    updateHost(host.id, { status: newStatus });
    // Update last_response_time_ms directly
    getDb().prepare("UPDATE hosts SET last_response_time_ms = ? WHERE id = ?").run(latencyMs, host.id);
  }

  console.info(`[KnownHostCheck] ${hosts.length} host verificati`);
}

export async function runDnsResolve(
  networkId: number | null,
  hostIds?: number[] | null
): Promise<{ resolved: number; total: number }> {
  const networkIds = networkId
    ? [networkId]
    : getNetworks().map((n) => n.id);

  const idFilter = hostIds?.length ? new Set(hostIds) : null;

  let resolved = 0;
  let total = 0;

  for (const nid of networkIds) {
    const network = getNetworkById(nid);
    const dnsServer = network?.dns_server ?? null;
    let hosts = getHostsByNetwork(nid);
    if (idFilter) {
      hosts = hosts.filter((h) => idFilter.has(h.id));
    }
    total += hosts.length;
    const cronRefreshDnsStored = process.env.DA_INVENT_DNS_CRON_REFRESH_STORED === "true";
    for (const host of hosts) {
      if (!cronRefreshDnsStored && host.dns_reverse) {
        continue;
      }
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
          hostname_source: "dns",
          dns_reverse: dnsReverse || undefined,
          dns_forward: dnsForward || undefined,
        });
        resolved++;
      }
    }
  }

  return { resolved, total };
}

async function runCleanup(configStr: string): Promise<void> {
  let config: { days_until_stale?: number; days_until_delete?: number };
  try {
    config = JSON.parse(configStr || "{}");
  } catch {
    console.error("[Cleanup] Configurazione JSON non valida, uso valori predefiniti:", configStr);
    config = {};
  }
  const daysUntilStale = config.days_until_stale || 30;
  const daysUntilDelete = config.days_until_delete || 90;

  const result = cleanupStaleHosts(daysUntilStale, daysUntilDelete);
  console.info(`[Cleanup] ${result.flagged} host segnalati stale, ${result.deleted} eliminati`);
}

async function runAdSync(configStr: string): Promise<void> {
  let config: { integration_id?: number };
  try {
    config = JSON.parse(configStr || "{}");
  } catch {
    console.error("[AD Sync] Configurazione JSON non valida:", configStr);
    return;
  }

  const integrationId = config.integration_id;
  if (!integrationId) {
    const { getAdIntegrations } = await import("@/lib/db");
    const integrations = getAdIntegrations().filter((i) => i.enabled);
    if (integrations.length === 0) {
      console.info("[AD Sync] Nessuna integrazione AD abilitata");
      return;
    }
    for (const int of integrations) {
      await syncSingleAdIntegration(int.id);
    }
  } else {
    await syncSingleAdIntegration(integrationId);
  }
}

async function syncSingleAdIntegration(integrationId: number): Promise<void> {
  try {
    const { syncActiveDirectory } = await import("@/lib/ad/ad-client");
    console.info(`[AD Sync] Avvio sincronizzazione integrazione #${integrationId}`);
    const result = await syncActiveDirectory(integrationId);
    console.info(`[AD Sync] Completato: ${result.computers} computer, ${result.users} utenti, ${result.groups} gruppi, ${result.linked_hosts} host collegati (${result.duration_ms}ms)`);
    if (result.errors.length > 0) {
      console.warn(`[AD Sync] Errori: ${result.errors.join(", ")}`);
    }
  } catch (err) {
    console.error(`[AD Sync] Errore integrazione #${integrationId}:`, err);
  }
}

