import { getAllHostIps } from "@/lib/utils";
import { pingSweep } from "./ping";
import { nmapDiscoverHosts, nmapPortScan, isNmapAvailable } from "./nmap";
import { buildTcpScanArgs } from "./ports";
import { reverseDns, forwardDns } from "./dns";
import { readArpCache } from "./arp-cache";
import { lookupVendor } from "./mac-vendor";
import { querySnmpInfoMultiCommunity } from "./snmp-query";
import {
  getNetworkById,
  upsertHost,
  markHostsOffline,
  addScanHistory,
  addStatusHistory,
} from "@/lib/db";
import type { ScanProgress, DiscoveryResult } from "@/types";

const GLOBAL_KEY = "__daipam_scan_progress__" as const;

function getProgressMap(): Map<string, ScanProgress> {
  const g = globalThis as Record<string, unknown>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = new Map<string, ScanProgress>();
  }
  return g[GLOBAL_KEY] as Map<string, ScanProgress>;
}

export function getScanProgress(id: string): ScanProgress | undefined {
  return getProgressMap().get(id);
}

let scanIdCounter = Date.now();

/**
 * Start a network discovery scan.
 * @param nmapArgs - Custom nmap args string from DB profile (TCP-only).
 * @param snmpCommunity - SNMP community per questa rete/profilo.
 *   "public" viene sempre provata come fallback.
 */
export async function discoverNetwork(
  networkId: number,
  scanType: "ping" | "nmap",
  nmapArgs?: string,
  snmpCommunity?: string | null
): Promise<{ id: string; progress: ScanProgress }> {
  const network = getNetworkById(networkId);
  if (!network) throw new Error("Rete non trovata");

  const id = `scan-${++scanIdCounter}-${Date.now()}`;
  const ips = getAllHostIps(network.cidr);

  const progress: ScanProgress = {
    id,
    network_id: networkId,
    scan_type: scanType,
    status: "running",
    total: ips.length,
    scanned: 0,
    found: 0,
    phase: "Inizializzazione",
    started_at: new Date().toISOString(),
  };

  getProgressMap().set(id, progress);

  runDiscovery(id, network.id, network.cidr, ips, scanType, nmapArgs, snmpCommunity, network.dns_server ?? null).catch(
    (error) => {
      console.error("[Discovery] Fatal error:", error);
      const p = getProgressMap().get(id);
      if (p) {
        p.status = "failed";
        p.error = error instanceof Error ? error.message : "Errore sconosciuto";
      }
    }
  );

  return { id, progress };
}

/** Deduplica e costruisce la lista di community SNMP da provare. */
function buildSnmpCommunities(configured?: string | null): string[] {
  const list: string[] = [];
  const c = configured?.trim();
  if (c) list.push(c);
  if (!list.includes("public")) list.push("public");
  return list;
}

type HostScanData = {
  ports: { port: number; protocol: string; service: string | null; version: string | null }[];
  os: string | null;
  mac: string | null;
  snmpHostname?: string | null;
  snmpSysDescr?: string | null;
};

async function runDiscovery(
  scanId: string,
  networkId: number,
  cidr: string,
  ips: string[],
  scanType: "ping" | "nmap",
  nmapArgs?: string,
  snmpCommunity?: string | null,
  dnsServer?: string | null
): Promise<DiscoveryResult> {
  const startTime = Date.now();
  const progress = getProgressMap().get(scanId);
  if (!progress) throw new Error(`Scan progress not found for ${scanId}`);

  let onlineIps: string[] = [];
  const nmapResults: Map<string, HostScanData> = new Map();

  const isDiscoveryOnly = nmapArgs?.trim() === "-sn";
  const snmpCommunities = buildSnmpCommunities(snmpCommunity);

  // ═══════════════════════════════════════════════════════════════
  // Phase 1: Host Discovery
  // ═══════════════════════════════════════════════════════════════
  if (scanType === "ping") {
    progress.phase = "Ping sweep";
    const results = await pingSweep(ips, 50, (scanned, found) => {
      progress.scanned = scanned;
      progress.found = found;
    });
    onlineIps = results.filter((r) => r.alive).map((r) => r.ip);
  } else {
    const nmapAvailable = await isNmapAvailable();
    if (!nmapAvailable) {
      progress.phase = "Nmap non disponibile, fallback a ping";
      const results = await pingSweep(ips, 50, (scanned, found) => {
        progress.scanned = scanned;
        progress.found = found;
      });
      onlineIps = results.filter((r) => r.alive).map((r) => r.ip);
    } else {
      // Phase 1a: Quick host discovery with nmap -sn
      progress.phase = "Scoperta host (nmap -sn)";
      console.log(`[Discovery] Phase 1a: nmap host discovery on ${cidr}`);

      try {
        const discoveryResults = await nmapDiscoverHosts(cidr);
        for (const result of discoveryResults) {
          if (result.alive) {
            onlineIps.push(result.ip);
            if (result.mac) {
              nmapResults.set(result.ip, { ports: [], os: null, mac: result.mac });
            }
          }
        }
        progress.scanned = ips.length;
        progress.found = onlineIps.length;
        console.log(`[Discovery] Phase 1a: ${onlineIps.length} host attivi`);

        if (onlineIps.length === 0) {
          progress.phase = "Nmap senza risultati, fallback a ping";
          const pingResults = await pingSweep(ips, 50, (scanned, found) => {
            progress.scanned = scanned;
            progress.found = found;
          });
          onlineIps = pingResults.filter((r) => r.alive).map((r) => r.ip);
        }
      } catch (error) {
        console.error("[Discovery] nmap discovery failed, fallback to ping:", error);
        progress.phase = "Nmap discovery fallito, fallback a ping";
        const results = await pingSweep(ips, 50, (scanned, found) => {
          progress.scanned = scanned;
          progress.found = found;
        });
        onlineIps = results.filter((r) => r.alive).map((r) => r.ip);
      }

      // ═══════════════════════════════════════════════════════════
      // Phase 1b: Port scan TCP + tentativo UDP (scansioni separate)
      // ═══════════════════════════════════════════════════════════
      if (!isDiscoveryOnly && onlineIps.length > 0) {
        progress.phase = `Scansione porte — 0/${onlineIps.length}`;
        progress.scanned = 0;
        progress.total = onlineIps.length;
        console.log(`[Discovery] Phase 1b: port scan ${onlineIps.length} host (TCP + tentativo UDP)`);

        const BATCH_SIZE = 5;
        for (let i = 0; i < onlineIps.length; i += BATCH_SIZE) {
          const batch = onlineIps.slice(i, i + BATCH_SIZE);
          const batchResults = await Promise.all(
            batch.map((ip) => nmapPortScan(ip, nmapArgs, 150000))
          );

          for (let j = 0; j < batch.length; j++) {
            const ip = batch[j];
            const result = batchResults[j];
            if (result) {
              const existing = nmapResults.get(ip);
              nmapResults.set(ip, {
                ports: result.ports.map((p) => ({
                  port: p.port,
                  protocol: p.protocol,
                  service: p.service,
                  version: p.version,
                })),
                os: result.os,
                mac: result.mac || existing?.mac || null,
                snmpHostname: result.snmpHostname ?? existing?.snmpHostname,
                snmpSysDescr: result.snmpSysDescr ?? existing?.snmpSysDescr,
              });
            }
          }

          progress.scanned = Math.min(i + BATCH_SIZE, onlineIps.length);
          progress.phase = `Scansione porte — ${progress.scanned}/${onlineIps.length}`;
        }

        console.log("[Discovery] Phase 1b: port scan completata");
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Phase 1c: SNMP discovery — trova host che rispondono solo a SNMP
  //           Usa net-snmp (non richiede root). Prova tutte le community.
  // ═══════════════════════════════════════════════════════════════
  const snmpDiscoveredIps: string[] = [];
  {
    const foundBySnmp = new Set(onlineIps);
    const toProbe = ips.filter((ip) => !foundBySnmp.has(ip));
    if (toProbe.length > 0) {
      progress.phase = `Scoperta SNMP — 0/${toProbe.length}`;
      console.log(`[Discovery] Phase 1c: SNMP discovery su ${toProbe.length} IP (community: ${snmpCommunities.join(", ")})`);
      const BATCH = 16;
      for (let i = 0; i < toProbe.length; i += BATCH) {
        const batch = toProbe.slice(i, i + BATCH);
        const results = await Promise.all(
          batch.map(async (ip) => {
            const r = await querySnmpInfoMultiCommunity(ip, snmpCommunities);
            if (r.sysName || r.sysDescr) return { ip, ...r };
            return null;
          })
        );
        for (const r of results) {
          if (r) {
            onlineIps.push(r.ip);
            snmpDiscoveredIps.push(r.ip);
            nmapResults.set(r.ip, {
              ports: [{ port: 161, protocol: "udp", service: "snmp", version: null }],
              os: null,
              mac: null,
              snmpHostname: r.sysName ?? null,
              snmpSysDescr: r.sysDescr ?? null,
            });
          }
        }
        progress.phase = `Scoperta SNMP — ${Math.min(i + BATCH, toProbe.length)}/${toProbe.length}`;
      }
      if (snmpDiscoveredIps.length > 0) {
        console.log(`[Discovery] Phase 1c: ${snmpDiscoveredIps.length} host scoperti via SNMP`);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Phase 1d: SNMP enrichment — arricchisce host già scoperti con dati SNMP
  //           Prova tutte le community, aggiunge porta 161/udp se risponde.
  // ═══════════════════════════════════════════════════════════════
  {
    progress.phase = "Query SNMP (net-snmp)";
    console.log(`[Discovery] Phase 1d: SNMP enrichment su ${onlineIps.length} host (community: ${snmpCommunities.join(", ")})`);
    const BATCH = 8;
    for (let i = 0; i < onlineIps.length; i += BATCH) {
      const batch = onlineIps.slice(i, i + BATCH);
      const results = await Promise.all(
        batch.map(async (ip) => {
          const existing = nmapResults.get(ip);
          if (existing?.snmpHostname && existing?.snmpSysDescr) return null;
          const r = await querySnmpInfoMultiCommunity(ip, snmpCommunities);
          if (r.sysName || r.sysDescr) return { ip, ...r };
          return null;
        })
      );
      for (const r of results) {
        if (r) {
          const ex = nmapResults.get(r.ip);
          const ports = ex?.ports ?? [];
          const has161udp = ports.some((p) => p.port === 161 && p.protocol === "udp");
          const newPorts = has161udp
            ? ports
            : [...ports, { port: 161, protocol: "udp", service: "snmp", version: null as string | null }];
          nmapResults.set(r.ip, {
            ...(ex ?? { ports: [], os: null, mac: null }),
            ports: newPorts,
            snmpHostname: r.sysName ?? ex?.snmpHostname ?? null,
            snmpSysDescr: r.sysDescr ?? ex?.snmpSysDescr ?? null,
          });
        }
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Phase 1e: Port scan TCP su host senza porte TCP
  //           (SNMP-only, o scoperti da ping senza nmap)
  // ═══════════════════════════════════════════════════════════════
  const portScanArgs = nmapArgs && nmapArgs.trim() !== "-sn" ? nmapArgs : buildTcpScanArgs(null);
  const ipsNeedingPortScan = [
    ...snmpDiscoveredIps,
    ...onlineIps.filter((ip) => {
      if (snmpDiscoveredIps.includes(ip)) return false;
      const ex = nmapResults.get(ip);
      const ports = ex?.ports ?? [];
      return !ports.some((p) => p.protocol === "tcp");
    }),
  ];
  const uniqueIpsToScan = [...new Set(ipsNeedingPortScan)];
  if (uniqueIpsToScan.length > 0) {
    const nmapAvailable = await isNmapAvailable();
    if (nmapAvailable) {
      console.log(`[Discovery] Phase 1e: port scan TCP su ${uniqueIpsToScan.length} host senza porte TCP`);
      progress.phase = `Scansione porte — 0/${uniqueIpsToScan.length}`;
      const BATCH_SIZE = 5;
      for (let i = 0; i < uniqueIpsToScan.length; i += BATCH_SIZE) {
        const batch = uniqueIpsToScan.slice(i, i + BATCH_SIZE);
        const batchResults = await Promise.all(
          batch.map((ip) => nmapPortScan(ip, portScanArgs, 150000))
        );
        for (let j = 0; j < batch.length; j++) {
          const ip = batch[j];
          const result = batchResults[j];
          const existing = nmapResults.get(ip);
          if (result && result.ports.length > 0) {
            const mergedPorts = [...(existing?.ports ?? [])];
            for (const p of result.ports) {
              if (!mergedPorts.some((m) => m.port === p.port && m.protocol === p.protocol)) {
                mergedPorts.push({ port: p.port, protocol: p.protocol, service: p.service, version: p.version });
              }
            }
            nmapResults.set(ip, {
              ports: mergedPorts,
              os: result.os ?? existing?.os ?? null,
              mac: result.mac ?? existing?.mac ?? null,
              snmpHostname: result.snmpHostname ?? existing?.snmpHostname ?? null,
              snmpSysDescr: result.snmpSysDescr ?? existing?.snmpSysDescr ?? null,
            });
          }
        }
        progress.phase = `Scansione porte — ${Math.min(i + BATCH_SIZE, uniqueIpsToScan.length)}/${uniqueIpsToScan.length}`;
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Phase 2: Read local ARP cache for MAC addresses
  // ═══════════════════════════════════════════════════════════════
  progress.phase = "Lettura cache ARP";
  const arpCache = await readArpCache();
  const arpMap = new Map(arpCache.map((e) => [e.ip, e.mac]));

  // ═══════════════════════════════════════════════════════════════
  // Phase 3: DNS + MAC vendor for discovered hosts, persist to DB
  // ═══════════════════════════════════════════════════════════════
  progress.phase = "Risoluzione DNS e vendor";
  progress.scanned = 0;
  progress.total = onlineIps.length;
  let newHosts = 0;

  for (let i = 0; i < onlineIps.length; i++) {
    const ip = onlineIps[i];
    const nmapData = nmapResults.get(ip);
    const mac = nmapData?.mac || arpMap.get(ip) || null;
    const vendor = mac ? await lookupVendor(mac) : null;

    const snmpHostname = nmapData?.snmpHostname;
    const hostname = snmpHostname || (await reverseDns(ip, dnsServer));
    let dnsForward: string | null = null;
    if (hostname && !snmpHostname) {
      const forwardResults = await forwardDns(hostname, dnsServer);
      if (forwardResults.length > 0) {
        dnsForward = forwardResults.join(", ");
      }
    }

    const snmpSysDescr = nmapData?.snmpSysDescr ?? "";
    let classification: string | undefined;
    if (snmpSysDescr) {
      const d = snmpSysDescr.toLowerCase();
      if (/router|ios|vyos|mikrotik|edge.?router/i.test(d)) classification = "router";
      else if (/switch|switching|procurve|nexus| catalyst/i.test(d)) classification = "switch";
      else if (/firewall|fortigate|pfsense|opnsense/i.test(d)) classification = "firewall";
      else if (/access.?point|ap-|unifi|wifi|wireless/i.test(d)) classification = "access_point";
      else if (/nas|synology|qnap|storage/i.test(d)) classification = "nas";
      else if (/printer|print|laserjet|epson/i.test(d)) classification = "stampante";
      else if (/server|esxi|hyper-v|vmware/i.test(d)) classification = "server";
      else if (/camera|ipcam|hikvision|dahua/i.test(d)) classification = "telecamera";
      else if (/phone|voip|yealink|cisco.?phone/i.test(d)) classification = "voip";
    }

    const portsJson = nmapData?.ports.length
      ? JSON.stringify(nmapData.ports)
      : undefined;

    const host = upsertHost({
      network_id: networkId,
      ip,
      mac: mac || undefined,
      vendor: vendor || undefined,
      hostname: hostname || undefined,
      dns_reverse: hostname || undefined,
      dns_forward: dnsForward || undefined,
      classification: classification,
      status: "online",
      open_ports: portsJson,
      os_info: nmapData?.os || nmapData?.snmpSysDescr || undefined,
    });

    if (host.first_seen === host.created_at) newHosts++;

    addStatusHistory(host.id, "online");

    addScanHistory({
      host_id: host.id,
      network_id: networkId,
      scan_type: scanType,
      status: "online",
      ports_open: nmapData?.ports.length
        ? JSON.stringify(nmapData.ports.map((p) => String(p.port)))
        : null,
      raw_output: nmapData?.os || null,
      duration_ms: null,
    });

    progress.scanned = i + 1;
    progress.phase = `Risoluzione DNS e vendor — ${i + 1}/${onlineIps.length}`;
  }

  // ═══════════════════════════════════════════════════════════════
  // Phase 4: Mark offline hosts
  // ═══════════════════════════════════════════════════════════════
  progress.phase = "Aggiornamento host offline";
  markHostsOffline(networkId, onlineIps);

  const totalPorts = Array.from(nmapResults.values()).reduce((sum, r) => sum + r.ports.length, 0);
  addScanHistory({
    host_id: null,
    network_id: networkId,
    scan_type: scanType,
    status: `${onlineIps.length} online, ${ips.length - onlineIps.length} offline${totalPorts > 0 ? `, ${totalPorts} porte aperte` : ""}`,
    ports_open: null,
    raw_output: null,
    duration_ms: Date.now() - startTime,
  });

  progress.status = "completed";
  progress.phase = "Completata";
  progress.scanned = progress.total;
  progress.found = onlineIps.length;

  console.log(`[Discovery] Completata: ${onlineIps.length} host, ${totalPorts} porte, ${Date.now() - startTime}ms`);

  setTimeout(() => getProgressMap().delete(scanId), 300000);

  return {
    network_id: networkId,
    total_ips: ips.length,
    hosts_found: onlineIps.length,
    hosts_online: onlineIps.length,
    hosts_offline: ips.length - onlineIps.length,
    new_hosts: newHosts,
    duration_ms: Date.now() - startTime,
  };
}
