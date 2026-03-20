import { getAllHostIps } from "@/lib/utils";
import { pingSweep } from "./ping";
import { nmapDiscoverHosts, nmapPortScan, isNmapAvailable } from "./nmap";
import { buildTcpScanArgs } from "./ports";
import { reverseDns, forwardDns } from "./dns";
import { readArpCache } from "./arp-cache";
import { lookupVendor } from "./mac-vendor";
import { querySnmpInfoMultiCommunity } from "./snmp-query";
import { classifyDevice } from "@/lib/device-classifier";
import {
  getNetworkById,
  upsertHost,
  markHostsOffline,
  addScanHistory,
  addStatusHistory,
  getHostWindowsCredentials,
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

export type DiscoveryScanType = "ping" | "snmp" | "nmap" | "windows" | "ssh";

/**
 * Start a network discovery scan.
 * - ping: solo ICMP ping sweep (veloce, scoperta host)
 * - snmp: solo SNMP discovery + enrichment (raccolta dati sysName, sysDescr, sysObjectID)
 * - nmap: host discovery + port scan (verifica risposta, compila porte/os; SNMP non usato per dati)
 *
 * @param nmapArgs - Custom nmap args string from DB profile (TCP-only). Usato solo per scanType "nmap".
 * @param snmpCommunity - SNMP community per questa rete/profilo. Usato solo per scanType "snmp".
 */
export async function discoverNetwork(
  networkId: number,
  scanType: DiscoveryScanType,
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
    logs: [],
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

/**
 * Ordine: community configurata (rete/profilo), poi `public`, poi `private`.
 * Dedup preservando l'ordine.
 */
function buildSnmpCommunities(configured?: string | null): string[] {
  const ordered: string[] = [];
  const c = configured?.trim();
  if (c) ordered.push(c);
  ordered.push("public", "private");
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of ordered) {
    if (seen.has(x)) continue;
    seen.add(x);
    out.push(x);
  }
  return out;
}

type HostScanData = {
  ports: { port: number; protocol: string; service: string | null; version: string | null }[];
  os: string | null;
  mac: string | null;
  snmpHostname?: string | null;
  snmpSysDescr?: string | null;
  snmpSysObjectID?: string | null;
  snmpSerial?: string | null;
  snmpModel?: string | null;
};

async function runDiscovery(
  scanId: string,
  networkId: number,
  cidr: string,
  ips: string[],
  scanType: DiscoveryScanType,
  nmapArgs?: string,
  snmpCommunity?: string | null,
  dnsServer?: string | null
): Promise<DiscoveryResult> {
  const startTime = Date.now();
  const progressRef = getProgressMap().get(scanId);
  if (!progressRef) throw new Error(`Scan progress not found for ${scanId}`);
  const progress = progressRef; // TypeScript: guaranteed non-undefined after throw

  let onlineIps: string[] = [];
  const nmapResults: Map<string, HostScanData> = new Map();

  /** Estrae modello e firmware dal sysDescr quando ENTITY-MIB non è disponibile. */
  function parseModelFromSysDescr(sysDescr: string | null): { model: string | null; firmware: string | null } {
    if (!sysDescr) return { model: null, firmware: null };
    const s = sysDescr.trim();

    // Ubiquiti: "USW-Flex 7.2.123.16565" / "USW-Pro-48-PoE, 7.2.123.16565, Linux 3.6" / "U7-Pro 8.4.6.18068"
    const ubiMatch = s.match(/^(U\w[\w-]*?)[\s,]+(\d+\.\d+\.\d+[\.\d]*)/);
    if (ubiMatch) return { model: ubiMatch[1], firmware: ubiMatch[2] };

    // MikroTik: "RouterOS CCR2004-1G-12S+2XS"
    const mtMatch = s.match(/RouterOS\s+(\S+)/i);
    if (mtMatch) return { model: mtMatch[1], firmware: null };

    // Cisco: "Cisco IOS Software, C2960 Software (C2960-LANBASEK9-M), Version 15.0(2)SE"
    const ciscoMatch = s.match(/,\s*(\S+)\s+Software.*Version\s+([\d.()A-Za-z]+)/i);
    if (ciscoMatch) return { model: ciscoMatch[1], firmware: ciscoMatch[2] };

    // HP ProCurve: "ProCurve J9729A 2920-48G-POE+ Switch..."
    const hpMatch = s.match(/ProCurve\s+(\S+\s+\S+)/i);
    if (hpMatch) return { model: hpMatch[1].trim(), firmware: null };

    // Generico: "MODELLO, versione X.Y.Z" o "MODELLO versione X.Y.Z"
    const genericMatch = s.match(/^([\w][\w\s-]{2,30}?)[\s,]+v?(\d+\.\d+[\.\d]*)/);
    if (genericMatch) return { model: genericMatch[1].trim(), firmware: genericMatch[2] };

    return { model: null, firmware: null };
  }

  /** Aggiunge una riga al log live (max 50 righe, le più vecchie vengono rimosse) */
  function log(msg: string) {
    progress.logs!.push(`[${new Date().toLocaleTimeString("it-IT")}] ${msg}`);
    if (progress.logs!.length > 50) progress.logs = progress.logs!.slice(-50);
  }

  const snmpCommunities = buildSnmpCommunities(snmpCommunity);

  // ═══════════════════════════════════════════════════════════════
  // PING: solo ICMP sweep — veloce, nessun SNMP/nmap
  // ═══════════════════════════════════════════════════════════════
  if (scanType === "ping") {
    progress.phase = "Ping sweep";
    const results = await pingSweep(ips, 50, (scanned, found) => {
      progress.scanned = scanned;
      progress.found = found;
    });
    onlineIps = results.filter((r) => r.alive).map((r) => r.ip);
  }

  // ═══════════════════════════════════════════════════════════════
  // WINDOWS: WinRM su host online — richiede credenziali Windows globali
  // ═══════════════════════════════════════════════════════════════
  else if (scanType === "windows") {
    const winCreds = getHostWindowsCredentials();
    if (!winCreds) {
      throw new Error("Configura le credenziali Windows globali in Impostazioni (host_windows_credential_id)");
    }
    // Filtra host che hanno porta 445 o 135 aperta (indicatore Windows), oppure 5985/5986 (WinRM)
    const { getHostsByNetwork } = await import("@/lib/db");
    const existingHosts = getHostsByNetwork(networkId);
    const windowsIps = existingHosts
      .filter((h) => {
        if (!h.open_ports) return false;
        try {
          const ports = JSON.parse(h.open_ports) as Array<{ port: number }>;
          return ports.some((p) => [445, 135, 5985, 5986].includes(p.port));
        } catch { return false; }
      })
      .map((h) => h.ip);
    onlineIps = windowsIps;
    progress.total = windowsIps.length;
    progress.scanned = 0;
    log(`Trovati ${windowsIps.length} host con porte Windows (445/135/5985/5986) su ${existingHosts.length} host in DB`);
    if (windowsIps.length === 0) { log("Nessun host con porte Windows trovato. Esegui prima una scansione Nmap."); }
    progress.phase = `Scansione WinRM — 0/${onlineIps.length}`;
    const { runWinrmCommand } = await import("@/lib/devices/winrm-run");
    for (let i = 0; i < onlineIps.length; i++) {
      const ip = onlineIps[i];
      log(`WinRM ${ip} — tentativo porta 5985...`);
      try {
        const hostname = await runWinrmCommand(
          ip,
          5985,
          winCreds.username,
          winCreds.password,
          "hostname",
          false
        );
        const hn = String(hostname ?? "").trim();
        if (hn) {
          nmapResults.set(ip, {
            ports: [{ port: 5985, protocol: "tcp", service: "winrm", version: null }],
            os: "Microsoft Windows",
            mac: null,
            snmpHostname: hn,
          });
          log(`✓ ${ip} → hostname: ${hn} (WinRM 5985)`);
        } else {
          log(`✗ ${ip} — risposta vuota su 5985`);
        }
      } catch (err5985) {
        log(`✗ ${ip}:5985 fallito (${(err5985 as Error).message?.slice(0, 60)}), provo 5986...`);
        try {
          const hostname = await runWinrmCommand(
            ip,
            5986,
            winCreds.username,
            winCreds.password,
            "hostname",
            false
          );
          const hn = String(hostname ?? "").trim();
          if (hn) {
            nmapResults.set(ip, {
              ports: [{ port: 5986, protocol: "tcp", service: "winrm-https", version: null }],
              os: "Microsoft Windows",
              mac: null,
              snmpHostname: hn,
            });
            log(`✓ ${ip} → hostname: ${hn} (WinRM 5986/HTTPS)`);
          } else {
            log(`✗ ${ip} — risposta vuota anche su 5986`);
          }
        } catch (err5986) {
          log(`✗ ${ip} — WinRM non disponibile (${(err5986 as Error).message?.slice(0, 60)})`);
        }
      }
      progress.scanned = i + 1;
      progress.found = nmapResults.size;
      progress.phase = `Scansione WinRM — ${i + 1}/${onlineIps.length}`;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // SSH: Ping + SSH su host online — richiede credenziali Linux globali
  // Raccoglie hostname, OS info, kernel, CPU, RAM
  // ═══════════════════════════════════════════════════════════════
  else if (scanType === "ssh") {
    const { getHostLinuxCredentials, getHostsByNetwork } = await import("@/lib/db");
    const linuxCreds = getHostLinuxCredentials();
    if (!linuxCreds) {
      throw new Error("Configura le credenziali Linux globali in Impostazioni (host_linux_credential_id)");
    }
    // Filtra host che hanno porta 22 aperta (SSH) e NON hanno 445 (quelli sono Windows)
    const existingHosts = getHostsByNetwork(networkId);
    const sshIps = existingHosts
      .filter((h) => {
        if (!h.open_ports) return false;
        try {
          const ports = JSON.parse(h.open_ports) as Array<{ port: number }>;
          const has22 = ports.some((p) => p.port === 22);
          const has445 = ports.some((p) => p.port === 445);
          return has22 && !has445; // SSH ma non Windows
        } catch { return false; }
      })
      .map((h) => h.ip);
    onlineIps = sshIps;
    progress.total = sshIps.length;
    progress.scanned = 0;
    log(`Trovati ${sshIps.length} host con porta 22 (senza 445) su ${existingHosts.length} host in DB`);
    if (sshIps.length === 0) { log("Nessun host con porta 22 trovato. Esegui prima una scansione Nmap."); }
    progress.phase = `Scansione SSH — 0/${onlineIps.length}`;

    const { Client } = await import("ssh2");
    for (let i = 0; i < onlineIps.length; i++) {
      const ip = onlineIps[i];
      log(`SSH ${ip} — connessione...`);
      try {
        const output = await new Promise<string>((resolve, reject) => {
          const conn = new Client();
          const timeout = setTimeout(() => { conn.end(); reject(new Error("timeout")); }, 8000);
          conn.on("ready", () => {
            conn.exec("hostname -f 2>/dev/null || hostname; uname -sr 2>/dev/null; cat /etc/os-release 2>/dev/null | head -5", (err, stream) => {
              if (err) { clearTimeout(timeout); conn.end(); reject(err); return; }
              let data = "";
              stream.on("data", (d: Buffer) => { data += d.toString(); });
              stream.stderr.on("data", () => {});
              stream.on("close", () => { clearTimeout(timeout); conn.end(); resolve(data); });
            });
          });
          conn.on("error", (err) => { clearTimeout(timeout); reject(err); });
          conn.connect({
            host: ip,
            port: 22,
            username: linuxCreds.username,
            password: linuxCreds.password,
            readyTimeout: 6000,
            algorithms: { kex: ["ecdh-sha2-nistp256", "ecdh-sha2-nistp384", "ecdh-sha2-nistp521", "diffie-hellman-group-exchange-sha256", "diffie-hellman-group14-sha256", "diffie-hellman-group14-sha1", "diffie-hellman-group1-sha1"] },
          });
        });

        const lines = output.trim().split("\n");
        const hn = lines[0]?.trim() || null;
        const kernel = lines[1]?.trim() || null;
        // Parse PRETTY_NAME da /etc/os-release
        let osName: string | null = null;
        for (const line of lines) {
          const m = line.match(/^PRETTY_NAME="?(.+?)"?\s*$/);
          if (m) { osName = m[1]; break; }
        }
        const osInfo = osName || kernel || "Linux";

        nmapResults.set(ip, {
          ports: [{ port: 22, protocol: "tcp", service: "ssh", version: null }],
          os: osInfo,
          mac: null,
          snmpHostname: hn,
        });
        log(`✓ ${ip} → hostname: ${hn || "—"}, OS: ${osInfo}`);
      } catch (sshErr) {
        log(`✗ ${ip} — SSH fallito (${(sshErr as Error).message?.slice(0, 80)})`);
      }
      progress.scanned = i + 1;
      progress.found = nmapResults.size;
      progress.phase = `Scansione SSH — ${i + 1}/${onlineIps.length}`;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // SNMP: solo discovery + enrichment — raccolta dati sysName, sysDescr, sysObjectID
  // Nessun ping, nessun nmap
  // ═══════════════════════════════════════════════════════════════
  else if (scanType === "snmp") {
    // SNMP solo sugli host già presenti nel DB (non su tutta la subnet)
    const { getHostsByNetwork } = await import("@/lib/db");
    const existingHosts = getHostsByNetwork(networkId);
    const targetIps = existingHosts.length > 0
      ? existingHosts.map((h) => h.ip)
      : ips; // Fallback a tutta la subnet solo se la rete è vuota

    progress.phase = `Query SNMP — 0/${targetIps.length}`;
    progress.total = targetIps.length;
    log(`SNMP scan su ${targetIps.length} host (community: ${snmpCommunities.join(", ")})`);
    const BATCH = 16;
    for (let i = 0; i < targetIps.length; i += BATCH) {
      const batch = targetIps.slice(i, i + BATCH);
      const results = await Promise.all(
        batch.map(async (ip) => {
          const r = await querySnmpInfoMultiCommunity(ip, snmpCommunities);
          if (r.sysName || r.sysDescr || r.sysObjectID) {
            const parsed = parseModelFromSysDescr(r.sysDescr);
            const modelStr = r.model || parsed.model;
            const fwStr = parsed.firmware;
            const extra = [modelStr, fwStr, r.serialNumber].filter(Boolean).join(", ");
            const walkHint = [
              r.ifDescrSummary ? `if: ${r.ifDescrSummary.slice(0, 60)}` : "",
              r.arpEntryCount != null ? `ARP~${r.arpEntryCount}` : "",
              r.hostResourcesSummary ? `hr: ${r.hostResourcesSummary.slice(0, 80)}` : "",
            ]
              .filter(Boolean)
              .join(" · ");
            log(
              `✓ ${ip} → ${r.sysName || "—"} (${r.sysDescr?.slice(0, 50) || "—"})${extra ? ` [${extra}]` : ""}${walkHint ? ` {${walkHint}}` : ""}`
            );
            return { ip, ...r };
          }
          log(`✗ ${ip} — nessuna risposta SNMP`);
          return null;
        })
      );
      for (const r of results) {
        if (r) {
          onlineIps.push(r.ip);
          nmapResults.set(r.ip, {
            ports: [{ port: 161, protocol: "udp", service: "snmp", version: null }],
            os: null,
            mac: null,
            snmpHostname: r.sysName ?? null,
            snmpSysDescr: r.sysDescr ?? null,
            snmpSysObjectID: r.sysObjectID ?? null,
            snmpSerial: r.serialNumber ?? null,
            snmpModel: r.model ?? null,
          });
        }
      }
      progress.scanned = Math.min(i + BATCH, targetIps.length);
      progress.found = onlineIps.length;
      progress.phase = `Query SNMP — ${progress.scanned}/${targetIps.length}`;
    }
    console.log(`[Discovery] SNMP: ${onlineIps.length}/${targetIps.length} host rispondono`);
  }

  // ═══════════════════════════════════════════════════════════════
  // NMAP: host discovery + port scan — verifica risposta, compila porte/os
  // SNMP non usato per raccolta dati (solo nmap)
  // ═══════════════════════════════════════════════════════════════
  else if (scanType === "nmap") {
    const isDiscoveryOnly = nmapArgs?.trim() === "-sn";
    const nmapAvailable = await isNmapAvailable();
    if (!nmapAvailable) {
      progress.phase = "Nmap non disponibile, fallback a ping";
      const results = await pingSweep(ips, 50, (scanned, found) => {
        progress.scanned = scanned;
        progress.found = found;
      });
      onlineIps = results.filter((r) => r.alive).map((r) => r.ip);
    } else {
      progress.phase = "Scoperta host (nmap -sn)";
      console.log(`[Discovery] Nmap: host discovery su ${cidr}`);
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
        progress.phase = "Nmap fallito, fallback a ping";
        const results = await pingSweep(ips, 50, (scanned, found) => {
          progress.scanned = scanned;
          progress.found = found;
        });
        onlineIps = results.filter((r) => r.alive).map((r) => r.ip);
      }

      if (!isDiscoveryOnly && onlineIps.length > 0) {
        progress.phase = `Scansione porte — 0/${onlineIps.length}`;
        progress.scanned = 0;
        progress.total = onlineIps.length;
        const portScanArgs = nmapArgs ?? buildTcpScanArgs(null);
        const BATCH_SIZE = 5;
        for (let i = 0; i < onlineIps.length; i += BATCH_SIZE) {
          const batch = onlineIps.slice(i, i + BATCH_SIZE);
          const batchResults = await Promise.all(
            batch.map((ip) => nmapPortScan(ip, portScanArgs, 150000))
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
                snmpHostname: null,
                snmpSysDescr: null,
                snmpSysObjectID: null,
              });
            }
          }
          progress.scanned = Math.min(i + BATCH_SIZE, onlineIps.length);
          progress.phase = `Scansione porte — ${progress.scanned}/${onlineIps.length}`;
        }
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

    const snmpHostname = nmapData?.snmpHostname || null;

    // Reverse DNS — SEMPRE tentato, indipendentemente da SNMP
    const dnsReverse = await reverseDns(ip, dnsServer);
    let dnsForward: string | null = null;
    if (dnsReverse) {
      const forwardResults = await forwardDns(dnsReverse, dnsServer);
      if (forwardResults.includes(ip)) {
        dnsForward = dnsReverse; // Forward confermato: il PTR punta a un nome che risolve a questo IP
      }
    }

    // Hostname: priorità SNMP > DNS reverse
    const hostname = snmpHostname || dnsReverse;
    const hostnameSource = snmpHostname ? "snmp" : (dnsReverse ? "dns" : undefined);

    const classification = classifyDevice({
      sysDescr: nmapData?.snmpSysDescr ?? null,
      sysObjectID: nmapData?.snmpSysObjectID ?? null,
      osInfo: nmapData?.os ?? null,
      openPorts: nmapData?.ports ?? null,
      hostname: hostname ?? null,
      vendor: vendor ?? null,
    });

    const portsJson = nmapData?.ports.length
      ? JSON.stringify(nmapData.ports)
      : undefined;

    // Estrai modello/firmware da ENTITY-MIB, oppure fallback su sysDescr
    const sysDescrParsed = parseModelFromSysDescr(nmapData?.snmpSysDescr ?? null);
    const hostModel = nmapData?.snmpModel || sysDescrParsed.model || undefined;
    const hostSerial = nmapData?.snmpSerial || undefined;

    const host = upsertHost({
      network_id: networkId,
      ip,
      mac: mac || undefined,
      vendor: vendor || undefined,
      hostname: hostname || undefined,
      hostname_source: hostnameSource,
      dns_reverse: dnsReverse || undefined,
      dns_forward: dnsForward || undefined,
      classification: classification,
      status: "online",
      open_ports: portsJson,
      os_info: nmapData?.snmpSysDescr || nmapData?.os || undefined,
      model: hostModel,
      serial_number: hostSerial,
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
  // Phase 4: Mark offline hosts (solo per ping/nmap; SNMP è additivo)
  // ═══════════════════════════════════════════════════════════════
  if (scanType !== "snmp") {
    progress.phase = "Aggiornamento host offline";
    markHostsOffline(networkId, onlineIps);
  }

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
