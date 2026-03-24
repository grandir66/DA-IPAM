import { getAllHostIps } from "@/lib/utils";
import { pingSweep } from "./ping";
import { nmapDiscoverHosts, nmapPortScan, isNmapAvailable } from "./nmap";
import {
  buildTcpScanArgs,
  buildNetworkDiscoveryQuickTcpArgs,
  getNmapHostTimeoutSeconds,
  getNetworkDiscoveryQuickConcurrency,
  getNetworkDiscoveryQuickExecMs,
  setGetSettingFn,
} from "./ports";
import { readArpCache } from "./arp-cache";
import { lookupVendor } from "./mac-vendor";
import { querySnmpInfoMultiCommunity, normalizeOidString } from "./snmp-query";
import { classifyDevice } from "@/lib/device-classifier";
import {
  getClassificationFromFingerprintSnapshot,
  FINGERPRINT_CLASSIFICATION_MIN_CONFIDENCE,
} from "@/lib/device-fingerprint-classification";
import {
  getNetworkById,
  getHostsByNetwork,
  upsertHost,
  markHostsOffline,
  noteHostsNonResponding,
  addScanHistory,
  addStatusHistory,
  getCredentialLoginPair,
  getSshLinuxCredentialPair,
  getHostDetectCredentialId,
  setHostDetectCredential,
  getOrderedDetectCredentialIds,
  getOrderedSshLinuxCredentialIds,
  buildSnmpCommunitiesForHost,
  getFingerprintClassificationRulesForResolve,
  getEnabledDeviceFingerprintRules,
  getNetworkDeviceByHost,
  findExistingBinding,
  addDeviceCredentialBinding,
  updateBindingTestStatus,
  syncNetworkDeviceFromHostScan,
  mergeOpenPortsJson,
  syncIpAssignmentsForNetwork,
  getAdRealm,
  getCredentialCommunityString,
  addHostCredential,
  getSetting,
} from "@/lib/db";
import type { ScanProgress, DiscoveryResult, DeviceFingerprintSnapshot } from "@/types";
import type { DnsResolution } from "./dns";

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

export type DiscoveryScanType = "ping" | "snmp" | "nmap" | "windows" | "ssh" | "network_discovery" | "ipam_full" | "credential_validate";

export type DiscoverNetworkOptions = {
  /** Se impostato, la scansione riguarda solo questi IP (devono appartenere alla subnet). */
  targetIps?: string[];
  /** Elenco porte TCP esplicito (sovrascrive default se presente). */
  tcpPorts?: string | null;
  /** Elenco porte UDP esplicito (sovrascrive default se presente). */
  udpPorts?: string | null;
};

/**
 * Start a network discovery scan.
 * - ping: solo ICMP ping sweep (veloce, scoperta host)
 * - network_discovery: ICMP → Nmap TCP “quick” (porte comuni) in sequenza sugli host online → DNS → persistenza → ARP dal router
 * - snmp: solo SNMP discovery + enrichment (raccolta dati sysName, sysDescr, sysObjectID)
 * - nmap: host discovery + port scan TCP/UDP + nella stessa sessione SNMP (porte 161, sysDescr, modello/seriale/firmware, firme OID)
 * - ipam_full: Pipeline completa ICMP → Nmap quick → SNMP → SSH (arricchimento automatico host)
 *
 * @param nmapArgs - Custom nmap args string from DB profile (TCP-only). Usato solo per scanType "nmap".
 * @param snmpCommunity - SNMP community per questa rete/profilo. Usato solo per scanType "snmp".
 */

/** Auto-aggiunge una credenziale funzionante ai bindings del device, se l'host corrisponde a un network_device */
function autoBindCredentialToDevice(hostIp: string, credentialId: number, protocolType: "ssh" | "snmp" | "winrm", port: number): void {
  try {
    const device = getNetworkDeviceByHost(hostIp);
    if (!device) return;
    const existing = findExistingBinding(device.id, credentialId, protocolType, port);
    if (existing) {
      // Aggiorna stato test del binding esistente
      updateBindingTestStatus(existing.id, "success", "Auto-detect riuscito");
      return;
    }
    const binding = addDeviceCredentialBinding({
      device_id: device.id,
      credential_id: credentialId,
      protocol_type: protocolType,
      port,
      auto_detected: true,
    });
    updateBindingTestStatus(binding.id, "success", "Auto-detect riuscito");
  } catch { /* ignore: device non trovato o duplicato */ }
}

export async function discoverNetwork(
  networkId: number,
  scanType: DiscoveryScanType,
  nmapArgs?: string,
  snmpCommunity?: string | null,
  options?: DiscoverNetworkOptions
): Promise<{ id: string; progress: ScanProgress }> {
  // Inietta getSetting per leggere porte custom dal DB (ports.ts è usato anche client-side)
  try { setGetSettingFn(getSetting); } catch { /* ignore */ }

  const network = getNetworkById(networkId);
  if (!network) throw new Error("Rete non trovata");

  const id = `scan-${++scanIdCounter}-${Date.now()}`;
  let ips = getAllHostIps(network.cidr);
  if (options?.targetIps?.length) {
    const allow = new Set(options.targetIps);
    ips = ips.filter((ip) => allow.has(ip));
    if (ips.length === 0) {
      throw new Error("Nessun host selezionato valido per questa subnet");
    }
  }

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

  runDiscovery(id, network.id, network.cidr, ips, scanType, nmapArgs, snmpCommunity, network.dns_server ?? null, options).catch(
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

type HostScanData = {
  ports: { port: number; protocol: string; service: string | null; version: string | null }[];
  os: string | null;
  mac: string | null;
  snmpHostname?: string | null;
  snmpSysDescr?: string | null;
  snmpSysObjectID?: string | null;
  snmpSerial?: string | null;
  snmpModel?: string | null;
  /** Hint da walk SNMP (detect / categorizzazione) */
  snmpMikrotikIdentity?: string | null;
  snmpUnifiSummary?: string | null;
  snmpIfDescrSummary?: string | null;
  snmpHostResourcesSummary?: string | null;
  /** OID fingerprint enterprise rilevati come attivi */
  snmpFingerprintOidMatches?: Array<{ oid_prefix: string; device_label: string; classification: string }> | null;
  /** Firmware dedotto da SNMP (sysDescr / ENTITY) */
  snmpFirmware?: string | null;
  /** Produttore dedotto da SNMP */
  snmpManufacturer?: string | null;
  /** Community SNMP con cui ha risposto (null = non risposto) */
  snmpCommunity?: string | null;
  /** Numero parte (ENTITY-MIB partNumber) */
  snmpPartNumber?: string | null;
  /** Uptime SNMP */
  snmpSysUpTime?: string | null;
  /** Voci ARP lette via SNMP */
  snmpArpEntryCount?: number | null;
  /** Profilo vendor SNMP (da snmp-vendor-profiles.ts) */
  vendorProfileId?: string | null;
  vendorProfileName?: string | null;
  vendorProfileConfidence?: number | null;
  vendorProfileCategory?: string | null;
  vendorProfileFirmware?: string | null;
  vendorProfileExtra?: Record<string, string | null>;
  /** Match da tabella sysObjectID (vendor, prodotto, categoria) */
  sysObjMatch?: import("./snmp-sysobj-lookup").SysObjMatch;
};

/** Produttore da sysDescr / OID enterprise / prima firma fingerprint */
function inferManufacturerFromSnmp(
  sysDescr: string | null,
  sysObjectID: string | null,
  fpOid?: Array<{ device_label: string }> | null
): string | null {
  const label = fpOid?.[0]?.device_label;
  if (label) {
    const m = label.match(/^([A-Za-z][A-Za-z0-9]+(?:\s+[A-Za-z][A-Za-z0-9]+)?)/);
    if (m && !/unknown|generic|linux|server/i.test(m[1])) return m[1].trim();
  }
  const oid = sysObjectID || "";
  if (oid.includes("6574")) return "Synology";
  if (oid.includes("55062")) return "QNAP";
  if (/^1\.3\.6\.1\.4\.1\.9\./.test(oid)) return "Cisco";
  if (/^1\.3\.6\.1\.4\.1\.2636/.test(oid)) return "Juniper";
  if (/^1\.3\.6\.1\.4\.1\.2011/.test(oid)) return "Huawei";
  const s = (sysDescr || "").toLowerCase();
  if (/synology|diskstation|\bdsm\b/.test(s)) return "Synology";
  if (/qnap|qts|turbo nas/.test(s)) return "QNAP";
  if (/routeros|mikrotik/.test(s)) return "MikroTik";
  if (/ubiquiti|unifi|edgeswitch|u6-|u7-/.test(s)) return "Ubiquiti";
  if (/hewlett|hp |procurve|aruba/.test(s)) return "HPE";
  if (/\bcisco\b|ios xe|cat\d+k/.test(s)) return "Cisco";
  return null;
}

function buildSnmpContextForClassifier(d: HostScanData | undefined): string | null {
  if (!d) return null;
  const parts: string[] = [];
  if (d.snmpMikrotikIdentity) parts.push(`RouterOS identity ${d.snmpMikrotikIdentity}`);
  if (d.snmpUnifiSummary) parts.push(d.snmpUnifiSummary);
  if (d.snmpIfDescrSummary) parts.push(`interfaces ${d.snmpIfDescrSummary}`);
  if (d.snmpHostResourcesSummary) parts.push(d.snmpHostResourcesSummary);
  return parts.length ? parts.join("\n") : null;
}

async function runDiscovery(
  scanId: string,
  networkId: number,
  cidr: string,
  ips: string[],
  scanType: DiscoveryScanType,
  nmapArgs?: string,
  snmpCommunity?: string | null,
  dnsServer?: string | null,
  discoverOpts?: DiscoverNetworkOptions
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

  /** Aggiunge una riga al log live (max 200 righe, le più vecchie vengono rimosse) */
  function log(msg: string) {
    progress.logs!.push(`[${new Date().toLocaleTimeString("it-IT")}] ${msg}`);
    if (progress.logs!.length > 200) progress.logs = progress.logs!.slice(-200);
  }

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
  // NETWORK_DISCOVERY: ICMP → Nmap TCP quick (sequenziale) → poi DNS/DB; ARP router a fine run
  // ═══════════════════════════════════════════════════════════════
  else if (scanType === "network_discovery") {
    progress.phase = "Ping sweep (ICMP)";
    const results = await pingSweep(ips, 50, (scanned, found) => {
      progress.scanned = scanned;
      progress.found = found;
    });
    onlineIps = results.filter((r) => r.alive).map((r) => r.ip);

    const nmapAvailable = await isNmapAvailable();
    const quickArgs = buildNetworkDiscoveryQuickTcpArgs();
    const quickExecMs = getNetworkDiscoveryQuickExecMs();
    const quickBatch = getNetworkDiscoveryQuickConcurrency();

    if (nmapAvailable && onlineIps.length > 0) {
      progress.phase = `Nmap quick TCP — 0/${onlineIps.length}`;
      progress.total = onlineIps.length;
      progress.scanned = 0;
      log(
        `ICMP: ${onlineIps.length} host rispondenti; Nmap TCP (batch ${quickBatch}, ~${Math.ceil(quickExecMs / 1000)}s max/host)`
      );
      for (let i = 0; i < onlineIps.length; i += quickBatch) {
        const batch = onlineIps.slice(i, i + quickBatch);
        const batchResults = await Promise.all(
          batch.map((ip) => nmapPortScan(ip, quickArgs, quickExecMs, { skipUdp: true }))
        );
        for (let j = 0; j < batch.length; j++) {
          const ip = batch[j];
          const result = batchResults[j];
          if (result) {
            nmapResults.set(ip, {
              ports: result.ports.map((p) => ({
                port: p.port,
                protocol: p.protocol,
                service: p.service,
                version: p.version,
              })),
              os: result.os,
              mac: result.mac || null,
            });
          }
        }
        progress.scanned = Math.min(i + quickBatch, onlineIps.length);
        progress.phase = `Nmap quick TCP — ${progress.scanned}/${onlineIps.length}`;
        if (i + quickBatch < onlineIps.length) {
          await new Promise<void>((resolve) => setImmediate(resolve));
        }
      }
      progress.found = onlineIps.length;
    } else if (!nmapAvailable) {
      log("Nmap non disponibile: solo ICMP (nessuna scansione TCP)");
    }

    // ── SNMP sysObjectID quick probe: identifica vendor/prodotto con un singolo GET ──
    if (onlineIps.length > 0) {
      try {
        const { lookupSysObjectId } = await import("./snmp-sysobj-lookup");
        const communities = buildSnmpCommunitiesForHost(networkId, null, snmpCommunity ?? null);
        const SNMP_BATCH = 24;
        let identified = 0;
        progress.phase = `SNMP sysObjectID — 0/${onlineIps.length}`;
        log(`SNMP sysObjectID probe: ${onlineIps.length} host, community: ${communities.slice(0, 3).join(", ")}${communities.length > 3 ? "…" : ""}`);

        for (let si = 0; si < onlineIps.length; si += SNMP_BATCH) {
          const batch = onlineIps.slice(si, si + SNMP_BATCH);
          const batchResults = await Promise.all(
            batch.map(async (ip) => {
              try {
                const r = await querySnmpInfoMultiCommunity(ip, communities, 161, { onLog: log });
                if (r.sysObjectID) {
                  return { ip, sysObjectID: r.sysObjectID, sysName: r.sysName ?? null, sysDescr: r.sysDescr ?? null };
                }
              } catch { /* ignore */ }
              return null;
            })
          );
          for (const r of batchResults) {
            if (!r) continue;
            const match = lookupSysObjectId(r.sysObjectID);
            const prev = nmapResults.get(r.ip);
            const ports = prev?.ports ? [...prev.ports] : [];
            if (!ports.some((p) => p.port === 161 && p.protocol === "udp")) {
              ports.push({ port: 161, protocol: "udp", service: "snmp", version: null });
            }
            nmapResults.set(r.ip, {
              ...prev,
              ports,
              os: prev?.os ?? null,
              mac: prev?.mac ?? null,
              snmpHostname: r.sysName,
              snmpSysDescr: r.sysDescr,
              snmpSysObjectID: r.sysObjectID,
              sysObjMatch: match ?? undefined,
            });
            if (match) {
              identified++;
              log(`✓ ${r.ip} → ${match.vendor} ${match.product} (${match.category})`);
            } else {
              log(`⚙ ${r.ip} sysObjectID=${r.sysObjectID} (non in tabella)`);
            }
          }
          progress.scanned = Math.min(si + SNMP_BATCH, onlineIps.length);
          progress.phase = `SNMP sysObjectID — ${progress.scanned}/${onlineIps.length}`;
        }
        log(`SNMP sysObjectID: ${identified} device identificati su ${onlineIps.length} host`);
      } catch (snmpErr) {
        log(`SNMP sysObjectID probe fallito: ${snmpErr instanceof Error ? snmpErr.message : "errore"}`);
      }
    }

    // ── SNMP discovery su IP che NON hanno risposto a ICMP ──
    // Molti dispositivi (AP, switch managed) disabilitano ICMP ma rispondono a SNMP.
    // Questa fase prova un rapido SNMP GET (sysObjectID) sugli IP offline, se la rete ha community configurata.
    {
      const communities = buildSnmpCommunitiesForHost(networkId, null, snmpCommunity ?? null);
      // Esegui solo se c'è almeno una community non-default (segnale che l'utente ha configurato SNMP)
      const hasCustomCommunity = communities.some((c) => c !== "public" && c !== "private");
      const offlineIps = ips.filter((ip) => !onlineIps.includes(ip));
      if (hasCustomCommunity && offlineIps.length > 0 && offlineIps.length <= 512) {
        progress.phase = `SNMP discovery (no-ICMP) — 0/${offlineIps.length}`;
        log(`SNMP discovery su ${offlineIps.length} IP non rispondenti a ICMP (community: ${communities[0]}…)`);
        const SNMP_PROBE_BATCH = 32;
        let snmpDiscovered = 0;
        for (let si = 0; si < offlineIps.length; si += SNMP_PROBE_BATCH) {
          const batch = offlineIps.slice(si, si + SNMP_PROBE_BATCH);
          const batchResults = await Promise.all(
            batch.map(async (ip) => {
              try {
                // Probe rapido: solo GET su sysObjectID + sysName + sysDescr con timeout corto
                const { snmpGet } = await import("./snmp-query");
                for (const community of communities) {
                  const varbinds = await snmpGet(ip, community, 161,
                    ["1.3.6.1.2.1.1.2.0", "1.3.6.1.2.1.1.5.0", "1.3.6.1.2.1.1.1.0"], 2500);
                  if (varbinds.length === 0) continue;
                  let sysObjectID: string | null = null;
                  let sysName: string | null = null;
                  let sysDescr: string | null = null;
                  for (const vb of varbinds) {
                    if (vb.type != null && [128, 129, 130].includes(vb.type)) continue;
                    const val = vb.value != null ? String(vb.value).trim() : null;
                    if (!val || val === "noSuchObject" || val === "noSuchInstance") continue;
                    if (String(vb.oid).includes("1.2.0")) sysObjectID = normalizeOidString(val);
                    else if (String(vb.oid).includes("1.5.0")) sysName = val;
                    else if (String(vb.oid).includes("1.1.0")) sysDescr = val;
                  }
                  if (sysObjectID || sysName || sysDescr) {
                    return { ip, sysObjectID, sysName, sysDescr, community };
                  }
                }
              } catch { /* timeout/errore = IP non risponde neanche a SNMP */ }
              return null;
            })
          );
          for (const r of batchResults) {
            if (!r) continue;
            snmpDiscovered++;
            // Aggiungi agli onlineIps (scoperto via SNMP)
            if (!onlineIps.includes(r.ip)) {
              onlineIps.push(r.ip);
            }
            const { lookupSysObjectId } = await import("./snmp-sysobj-lookup");
            const match = r.sysObjectID ? lookupSysObjectId(r.sysObjectID) : null;
            nmapResults.set(r.ip, {
              ports: [{ port: 161, protocol: "udp", service: "snmp", version: null }],
              os: null,
              mac: null,
              snmpHostname: r.sysName,
              snmpSysDescr: r.sysDescr,
              snmpSysObjectID: r.sysObjectID,
              snmpCommunity: r.community,
              sysObjMatch: match ?? undefined,
            });
            log(`✓ SNMP-only ${r.ip} → ${r.sysName || "—"} (${match ? `${match.vendor} ${match.product}` : r.sysObjectID || "sconosciuto"})`);
          }
          progress.scanned = Math.min(si + SNMP_PROBE_BATCH, offlineIps.length);
          progress.phase = `SNMP discovery (no-ICMP) — ${progress.scanned}/${offlineIps.length}`;
        }
        if (snmpDiscovered > 0) {
          log(`SNMP discovery: ${snmpDiscovered} device scoperti senza ICMP (totale online: ${onlineIps.length})`);
          progress.found = onlineIps.length;
        } else {
          log(`SNMP discovery: nessun device aggiuntivo trovato`);
        }
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // WINDOWS: WinRM — credenziali dalla subnet (ordine) o globali; una prova per credenziale; salvataggio su IP
  // ═══════════════════════════════════════════════════════════════
  else if (scanType === "windows") {
    const existingHosts = getHostsByNetwork(networkId);
    const inScopeWin = new Set(ips);
    const windowsHosts = existingHosts.filter((h) => {
      if (!inScopeWin.has(h.ip)) return false;
      if (!h.open_ports) return false;
      try {
        const ports = JSON.parse(h.open_ports) as Array<{ port: number }>;
        return ports.some((p) => [445, 135, 5985, 5986].includes(p.port));
      } catch {
        return false;
      }
    });
    onlineIps = windowsHosts.map((h) => h.ip);
    progress.total = windowsHosts.length;
    progress.scanned = 0;
    const defaultChain = getOrderedDetectCredentialIds(networkId, "windows");
    log(
      `Trovati ${windowsHosts.length} host Windows in DB; catena credenziali: ${defaultChain.length ? defaultChain.map((id) => `#${id}`).join(" → ") : "nessuna (configura rete o Impostazioni)"}`
    );
    if (windowsHosts.length === 0) {
      log("Nessun host con porte Windows. Esegui prima Nmap.");
    }
    progress.phase = `Scansione WinRM — 0/${onlineIps.length}`;
    const { runWinrmCommand } = await import("@/lib/devices/winrm-run");
    const adInfo = getAdRealm();
    const adRealm = adInfo?.realm || "";
    const pickWinrmPort = (host: (typeof windowsHosts)[0]): 5985 | 5986 => {
      try {
        const ports = JSON.parse(host.open_ports || "[]") as Array<{ port: number }>;
        const s = new Set(ports.map((p) => p.port));
        if (s.has(5986) && !s.has(5985)) return 5986;
        return 5985;
      } catch {
        return 5985;
      }
    };
    for (let i = 0; i < windowsHosts.length; i++) {
      const host = windowsHosts[i];
      const ip = host.ip;
      const bound = getHostDetectCredentialId(host.id, "windows");
      const chain = bound != null ? [bound] : defaultChain;
      if (chain.length === 0) {
        log(`✗ ${ip} — nessuna credenziale Windows (subnet o globale)`);
        progress.scanned = i + 1;
        progress.found = nmapResults.size;
        progress.phase = `Scansione WinRM — ${i + 1}/${onlineIps.length}`;
        continue;
      }
      const winrmPort = pickWinrmPort(host);
      let ok = false;
      for (const credId of chain) {
        const creds = getCredentialLoginPair(credId, "windows");
        if (!creds) {
          log(`✗ ${ip} cred#${credId} — dati mancanti`);
          continue;
        }
        try {
          const hostname = await runWinrmCommand(ip, winrmPort, creds.username, creds.password, "hostname", false, adRealm);
          const hn = String(hostname ?? "").trim();
          if (hn) {
            nmapResults.set(ip, {
              ports: [{ port: winrmPort, protocol: "tcp", service: winrmPort === 5986 ? "winrm-https" : "winrm", version: null }],
              os: "Microsoft Windows",
              mac: null,
              snmpHostname: hn,
            });
            setHostDetectCredential(host.id, "windows", credId);
            addHostCredential(host.id, credId, "winrm", winrmPort, { validated: true, auto_detected: true });
            autoBindCredentialToDevice(ip, credId, "winrm", winrmPort);
            log(`✓ ${ip} → ${hn} (cred#${credId}, porta ${winrmPort})`);
            ok = true;
            break;
          }
          log(`✗ ${ip} cred#${credId} — risposta vuota`);
        } catch (e) {
          log(`✗ ${ip} cred#${credId}: ${(e as Error).message?.slice(0, 72) ?? "errore"}`);
        }
      }
      if (!ok) log(`✗ ${ip} — nessuna credenziale valida`);
      progress.scanned = i + 1;
      progress.found = nmapResults.size;
      progress.phase = `Scansione WinRM — ${i + 1}/${onlineIps.length}`;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // SSH: credenziali Linux per subnet (ordine) o globali; una connessione per credenziale; salvataggio su IP
  // ═══════════════════════════════════════════════════════════════
  else if (scanType === "ssh") {
    const existingHosts = getHostsByNetwork(networkId);
    const inScopeSsh = new Set(ips);
    const sshHosts = existingHosts.filter((h) => {
      if (!inScopeSsh.has(h.ip)) return false;
      if (!h.open_ports) return false;
      try {
        const ports = JSON.parse(h.open_ports) as Array<{ port: number }>;
        const has22 = ports.some((p) => p.port === 22);
        const has445 = ports.some((p) => p.port === 445);
        return has22 && !has445;
      } catch {
        return false;
      }
    });
    onlineIps = sshHosts.map((h) => h.ip);
    progress.total = sshHosts.length;
    progress.scanned = 0;
    const defaultSshChain = getOrderedSshLinuxCredentialIds(networkId);
    log(
      `Trovati ${sshHosts.length} host SSH in DB; catena credenziali: ${defaultSshChain.length ? defaultSshChain.map((id) => `#${id}`).join(" → ") : "nessuna (configura rete o Impostazioni)"}`
    );
    if (sshHosts.length === 0) {
      log("Nessun host con porta 22 (senza 445). Esegui prima Nmap.");
    }
    progress.phase = `Scansione SSH — 0/${onlineIps.length}`;

    const { Client } = await import("ssh2");

    for (let i = 0; i < sshHosts.length; i++) {
      const host = sshHosts[i];
      const ip = host.ip;
      const boundLinux = getHostDetectCredentialId(host.id, "linux");
      const boundSsh = getHostDetectCredentialId(host.id, "ssh");
      const boundSshForSave = boundSsh;
      let chain: number[];
      if (boundLinux != null && boundSsh != null && boundLinux !== boundSsh) {
        chain = [boundLinux, boundSsh];
      } else if (boundLinux != null) {
        chain = [boundLinux];
      } else if (boundSsh != null) {
        chain = [boundSsh];
      } else {
        chain = defaultSshChain;
      }
      if (chain.length === 0) {
        log(`✗ ${ip} — nessuna credenziale Linux (subnet o globale)`);
        progress.scanned = i + 1;
        progress.found = nmapResults.size;
        progress.phase = `Scansione SSH — ${i + 1}/${onlineIps.length}`;
        continue;
      }
      let ok = false;
      for (const credId of chain) {
        const creds = getSshLinuxCredentialPair(credId);
        if (!creds) {
          log(`✗ ${ip} cred#${credId} — dati mancanti`);
          continue;
        }
        log(`SSH ${ip} — prova cred#${credId}`);
        try {
          const output = await new Promise<string>((resolve, reject) => {
            const conn = new Client();
            const timeout = setTimeout(() => {
              conn.end();
              reject(new Error("timeout"));
            }, 8000);
            conn.on("ready", () => {
              conn.exec(
                "hostname -f 2>/dev/null || hostname; uname -sr 2>/dev/null; cat /etc/os-release 2>/dev/null | head -5",
                (err, stream) => {
                  if (err) {
                    clearTimeout(timeout);
                    conn.end();
                    reject(err);
                    return;
                  }
                  let data = "";
                  stream.on("data", (d: Buffer) => {
                    data += d.toString();
                  });
                  stream.stderr.on("data", () => {});
                  stream.on("close", () => {
                    clearTimeout(timeout);
                    conn.end();
                    resolve(data);
                  });
                }
              );
            });
            conn.on("error", (err) => {
              clearTimeout(timeout);
              reject(err);
            });
            conn.connect({
              host: ip,
              port: 22,
              username: creds.username,
              password: creds.password,
              readyTimeout: 6000,
              algorithms: {
                kex: [
                  "curve25519-sha256", "curve25519-sha256@libssh.org",
                  "ecdh-sha2-nistp256", "ecdh-sha2-nistp384", "ecdh-sha2-nistp521",
                  "diffie-hellman-group-exchange-sha256",
                  "diffie-hellman-group14-sha256", "diffie-hellman-group14-sha1",
                  "diffie-hellman-group1-sha1",
                ],
              },
            });
          });

          const lines = output.trim().split("\n");
          const hn = lines[0]?.trim() || null;
          const kernel = lines[1]?.trim() || null;
          let osName: string | null = null;
          for (const line of lines) {
            const m = line.match(/^PRETTY_NAME="?(.+?)"?\s*$/);
            if (m) {
              osName = m[1];
              break;
            }
          }
          const osInfo = osName || kernel || "Linux";

          nmapResults.set(ip, {
            ports: [{ port: 22, protocol: "tcp", service: "ssh", version: null }],
            os: osInfo,
            mac: null,
            snmpHostname: hn,
          });
          setHostDetectCredential(host.id, "linux", credId);
          addHostCredential(host.id, credId, "ssh", 22, { validated: true, auto_detected: true });
          autoBindCredentialToDevice(ip, credId, "ssh", 22);
          if (boundSshForSave == null) {
            setHostDetectCredential(host.id, "ssh", credId);
          }
          log(`✓ ${ip} → ${hn || "—"}, OS: ${osInfo} (cred#${credId})`);
          ok = true;
          break;
        } catch (sshErr) {
          log(`✗ ${ip} cred#${credId}: ${(sshErr as Error).message?.slice(0, 80)}`);
        }
      }
      if (!ok) log(`✗ ${ip} — nessuna credenziale valida`);
      progress.scanned = i + 1;
      progress.found = nmapResults.size;
      progress.phase = `Scansione SSH — ${i + 1}/${onlineIps.length}`;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // IPAM_FULL: Pipeline completa ICMP → Nmap quick → SNMP → SSH
  // Sequenza automatica per arricchimento completo degli host
  // ═══════════════════════════════════════════════════════════════
  else if (scanType === "ipam_full") {
    const existingHosts = getHostsByNetwork(networkId);
    const ipToHostId = new Map<string, number>();
    for (const h of existingHosts) {
      ipToHostId.set(h.ip, h.id);
    }

    // Fase 1: ICMP ping sweep
    progress.phase = "IPAM [1/4] Ping sweep (ICMP)";
    log("Fase 1: ICMP ping sweep");
    const pingResults = await pingSweep(ips, 50, (scanned, found) => {
      progress.scanned = scanned;
      progress.found = found;
    });
    onlineIps = pingResults.filter((r) => r.alive).map((r) => r.ip);
    log(`ICMP: ${onlineIps.length}/${ips.length} host rispondenti`);

    // Fase 2: Nmap quick TCP
    const nmapAvailable = await isNmapAvailable();
    const quickArgs = buildNetworkDiscoveryQuickTcpArgs();
    const quickExecMs = getNetworkDiscoveryQuickExecMs();
    const quickBatch = getNetworkDiscoveryQuickConcurrency();

    if (nmapAvailable && onlineIps.length > 0) {
      progress.phase = `IPAM [2/4] Nmap quick — 0/${onlineIps.length}`;
      progress.total = onlineIps.length;
      progress.scanned = 0;
      log(`Fase 2: Nmap TCP quick (batch ${quickBatch}, ~${Math.ceil(quickExecMs / 1000)}s max/host)`);
      for (let i = 0; i < onlineIps.length; i += quickBatch) {
        const batch = onlineIps.slice(i, i + quickBatch);
        const batchResults = await Promise.all(
          batch.map((ip) => nmapPortScan(ip, quickArgs, quickExecMs, { skipUdp: true }))
        );
        for (let j = 0; j < batch.length; j++) {
          const ip = batch[j];
          const result = batchResults[j];
          if (result) {
            nmapResults.set(ip, {
              ports: result.ports.map((p) => ({
                port: p.port,
                protocol: p.protocol,
                service: p.service,
                version: p.version,
              })),
              os: result.os,
              mac: result.mac || null,
            });
          }
        }
        progress.scanned = Math.min(i + quickBatch, onlineIps.length);
        progress.phase = `IPAM [2/4] Nmap quick — ${progress.scanned}/${onlineIps.length}`;
        if (i + quickBatch < onlineIps.length) {
          await new Promise<void>((resolve) => setImmediate(resolve));
        }
      }
      progress.found = onlineIps.length;
      log(`Nmap: ${nmapResults.size} host con porte aperte`);
    } else if (!nmapAvailable) {
      log("Nmap non disponibile: salto fase TCP");
    }

    // Fase 3: SNMP discovery leggero
    const SNMP_BATCH = 16;
    progress.phase = `IPAM [3/4] SNMP — 0/${onlineIps.length}`;
    progress.total = onlineIps.length;
    progress.scanned = 0;
    log(`Fase 3: SNMP discovery (batch ${SNMP_BATCH})`);
    for (let i = 0; i < onlineIps.length; i += SNMP_BATCH) {
      const batch = onlineIps.slice(i, i + SNMP_BATCH);
      const results = await Promise.all(
        batch.map(async (ip) => {
          const hid = ipToHostId.get(ip) ?? null;
          const snmpCommunities = buildSnmpCommunitiesForHost(networkId, hid, snmpCommunity ?? null);
          const r = await querySnmpInfoMultiCommunity(ip, snmpCommunities, 161, { onLog: log });
          if (r.sysName || r.sysDescr || r.sysObjectID) {
            return { ip, ...r };
          }
          return null;
        })
      );
      for (const r of results) {
        if (r) {
          const existing = nmapResults.get(r.ip);
          const parsedSnmp = parseModelFromSysDescr(r.sysDescr ?? null);
          const snmpManufacturerOnly = inferManufacturerFromSnmp(r.sysDescr ?? null, r.sysObjectID ?? null, r.fingerprintOidMatches ?? null);
          const mergedPorts = existing?.ports ?? [];
          const has161 = mergedPorts.some((p) => p.port === 161 && p.protocol === "udp");
          if (!has161) {
            mergedPorts.push({ port: 161, protocol: "udp", service: "snmp", version: null });
          }
          nmapResults.set(r.ip, {
            ports: mergedPorts,
            os: existing?.os ?? null,
            mac: existing?.mac ?? null,
            snmpHostname: r.sysName ?? null,
            snmpSysDescr: r.sysDescr ?? null,
            snmpSysObjectID: r.sysObjectID ?? null,
            snmpSerial: r.serialNumber ?? null,
            snmpModel: r.model ?? null,
            snmpMikrotikIdentity: r.mikrotikIdentity ?? null,
            snmpUnifiSummary: r.unifiSummary ?? null,
            snmpIfDescrSummary: r.ifDescrSummary ?? null,
            snmpHostResourcesSummary: r.hostResourcesSummary ?? null,
            snmpFingerprintOidMatches: r.fingerprintOidMatches ?? null,
            snmpFirmware: parsedSnmp.firmware ?? null,
            snmpManufacturer: snmpManufacturerOnly,
          });
          log(`SNMP ✓ ${r.ip} → ${r.sysName || "—"}`);
        }
      }
      progress.scanned = Math.min(i + SNMP_BATCH, onlineIps.length);
      progress.phase = `IPAM [3/4] SNMP — ${progress.scanned}/${onlineIps.length}`;
    }

    // ── SNMP discovery su IP che NON hanno risposto a ICMP (stessa logica di network_discovery) ──
    {
      const communities = buildSnmpCommunitiesForHost(networkId, null, snmpCommunity ?? null);
      const hasCustomCommunity = communities.some((c) => c !== "public" && c !== "private");
      const offlineIps = ips.filter((ip) => !onlineIps.includes(ip));
      if (hasCustomCommunity && offlineIps.length > 0 && offlineIps.length <= 512) {
        progress.phase = `IPAM [3b/4] SNMP no-ICMP — 0/${offlineIps.length}`;
        log(`SNMP discovery su ${offlineIps.length} IP non rispondenti a ICMP`);
        const SNMP_PROBE_BATCH = 32;
        let snmpDiscovered = 0;
        for (let si = 0; si < offlineIps.length; si += SNMP_PROBE_BATCH) {
          const batch = offlineIps.slice(si, si + SNMP_PROBE_BATCH);
          const batchResults = await Promise.all(
            batch.map(async (ip) => {
              try {
                const { snmpGet } = await import("./snmp-query");
                for (const community of communities) {
                  const varbinds = await snmpGet(ip, community, 161,
                    ["1.3.6.1.2.1.1.2.0", "1.3.6.1.2.1.1.5.0", "1.3.6.1.2.1.1.1.0"], 2500);
                  if (varbinds.length === 0) continue;
                  let sysObjectID: string | null = null;
                  let sysName: string | null = null;
                  let sysDescr: string | null = null;
                  for (const vb of varbinds) {
                    if (vb.type != null && [128, 129, 130].includes(vb.type)) continue;
                    const val = vb.value != null ? String(vb.value).trim() : null;
                    if (!val || val === "noSuchObject" || val === "noSuchInstance") continue;
                    if (String(vb.oid).includes("1.2.0")) sysObjectID = normalizeOidString(val);
                    else if (String(vb.oid).includes("1.5.0")) sysName = val;
                    else if (String(vb.oid).includes("1.1.0")) sysDescr = val;
                  }
                  if (sysObjectID || sysName || sysDescr) {
                    return { ip, sysObjectID, sysName, sysDescr, community };
                  }
                }
              } catch { /* IP non risponde neanche a SNMP */ }
              return null;
            })
          );
          for (const r of batchResults) {
            if (!r) continue;
            snmpDiscovered++;
            if (!onlineIps.includes(r.ip)) onlineIps.push(r.ip);
            const { lookupSysObjectId } = await import("./snmp-sysobj-lookup");
            const match = r.sysObjectID ? lookupSysObjectId(r.sysObjectID) : null;
            nmapResults.set(r.ip, {
              ports: [{ port: 161, protocol: "udp", service: "snmp", version: null }],
              os: null,
              mac: null,
              snmpHostname: r.sysName,
              snmpSysDescr: r.sysDescr,
              snmpSysObjectID: r.sysObjectID,
              snmpCommunity: r.community,
              sysObjMatch: match ?? undefined,
            });
            log(`✓ SNMP-only ${r.ip} → ${r.sysName || "—"} (${match ? `${match.vendor} ${match.product}` : r.sysObjectID || "?"})`);
          }
          progress.scanned = Math.min(si + SNMP_PROBE_BATCH, offlineIps.length);
          progress.phase = `IPAM [3b/4] SNMP no-ICMP — ${progress.scanned}/${offlineIps.length}`;
        }
        if (snmpDiscovered > 0) {
          log(`SNMP discovery: ${snmpDiscovered} device scoperti senza ICMP (totale online: ${onlineIps.length})`);
          progress.found = onlineIps.length;
        }
      }
    }

    // Fase 4: SSH per host con porta 22 (senza 445)
    const sshHosts = onlineIps.filter((ip) => {
      const data = nmapResults.get(ip);
      if (!data?.ports) return false;
      const has22 = data.ports.some((p) => p.port === 22);
      const has445 = data.ports.some((p) => p.port === 445);
      return has22 && !has445;
    });
    progress.phase = `IPAM [4/4] SSH — 0/${sshHosts.length}`;
    progress.total = sshHosts.length;
    progress.scanned = 0;
    const defaultSshChain = getOrderedSshLinuxCredentialIds(networkId);
    log(`Fase 4: SSH su ${sshHosts.length} host (porta 22, no 445); catena credenziali: ${defaultSshChain.length ? defaultSshChain.map((id) => `#${id}`).join(" → ") : "nessuna"}`);

    if (sshHosts.length > 0 && defaultSshChain.length > 0) {
      const { Client } = await import("ssh2");

      for (let i = 0; i < sshHosts.length; i++) {
        const ip = sshHosts[i];
        const hostRow = existingHosts.find((h) => h.ip === ip);
        const hostId = hostRow?.id;
        const boundLinux = hostId != null ? getHostDetectCredentialId(hostId, "linux") : null;
        const boundSsh = hostId != null ? getHostDetectCredentialId(hostId, "ssh") : null;
        let chain: number[];
        if (boundLinux != null && boundSsh != null && boundLinux !== boundSsh) {
          chain = [boundLinux, boundSsh];
        } else if (boundLinux != null) {
          chain = [boundLinux];
        } else if (boundSsh != null) {
          chain = [boundSsh];
        } else {
          chain = defaultSshChain;
        }

        let ok = false;
        for (const credId of chain) {
          const creds = getSshLinuxCredentialPair(credId);
          if (!creds) continue;
          try {
            const output = await new Promise<string>((resolve, reject) => {
              const conn = new Client();
              const timeout = setTimeout(() => {
                conn.end();
                reject(new Error("timeout"));
              }, 8000);
              conn.on("ready", () => {
                conn.exec(
                  "hostname -f 2>/dev/null || hostname; uname -sr 2>/dev/null; cat /etc/os-release 2>/dev/null | head -5",
                  (err, stream) => {
                    if (err) {
                      clearTimeout(timeout);
                      conn.end();
                      reject(err);
                      return;
                    }
                    let data = "";
                    stream.on("data", (d: Buffer) => {
                      data += d.toString();
                    });
                    stream.stderr.on("data", () => {});
                    stream.on("close", () => {
                      clearTimeout(timeout);
                      conn.end();
                      resolve(data);
                    });
                  }
                );
              });
              conn.on("error", (err) => {
                clearTimeout(timeout);
                reject(err);
              });
              conn.connect({
                host: ip,
                port: 22,
                username: creds.username,
                password: creds.password,
                readyTimeout: 6000,
                algorithms: {
                  kex: [
                    "ecdh-sha2-nistp256",
                    "ecdh-sha2-nistp384",
                    "ecdh-sha2-nistp521",
                    "diffie-hellman-group-exchange-sha256",
                    "diffie-hellman-group14-sha256",
                    "diffie-hellman-group14-sha1",
                    "diffie-hellman-group1-sha1",
                  ],
                },
              });
            });

            const lines = output.trim().split("\n");
            const hn = lines[0]?.trim() || null;
            const kernel = lines[1]?.trim() || null;
            let osName: string | null = null;
            for (const line of lines) {
              const m = line.match(/^PRETTY_NAME="?(.+?)"?\s*$/);
              if (m) {
                osName = m[1];
                break;
              }
            }
            const osInfo = osName || kernel || "Linux";

            const existing = nmapResults.get(ip);
            nmapResults.set(ip, {
              ...existing,
              ports: existing?.ports ?? [{ port: 22, protocol: "tcp", service: "ssh", version: null }],
              os: osInfo,
              mac: existing?.mac ?? null,
              snmpHostname: hn ?? existing?.snmpHostname ?? null,
            });
            if (hostId != null) {
              setHostDetectCredential(hostId, "linux", credId);
              addHostCredential(hostId, credId, "ssh", 22, { validated: true, auto_detected: true });
              if (boundSsh == null) {
                setHostDetectCredential(hostId, "ssh", credId);
              }
            }
            autoBindCredentialToDevice(ip, credId, "ssh", 22);
            log(`SSH ✓ ${ip} → ${hn || "—"}, OS: ${osInfo}`);
            ok = true;
            break;
          } catch (sshErr) {
            log(`SSH ✗ ${ip} cred#${credId}: ${(sshErr as Error).message?.slice(0, 60)}`);
          }
        }
        if (!ok) log(`SSH ✗ ${ip} — nessuna credenziale valida`);
        progress.scanned = i + 1;
        progress.found = nmapResults.size;
        progress.phase = `IPAM [4/4] SSH — ${i + 1}/${sshHosts.length}`;
      }
    } else if (sshHosts.length === 0) {
      log("Nessun host con porta 22 (senza 445)");
    } else {
      log("Nessuna credenziale SSH configurata (rete o Impostazioni)");
    }

    progress.found = onlineIps.length;
    log(`Pipeline IPAM completata: ${onlineIps.length} host online, ${nmapResults.size} con dati`);
  }

  // ═══════════════════════════════════════════════════════════════
  // SNMP: solo discovery + enrichment — raccolta dati sysName, sysDescr, sysObjectID
  // Nessun ping, nessun nmap
  // ═══════════════════════════════════════════════════════════════
  else if (scanType === "snmp") {
    // SNMP: host in DB intersecati con l’insieme `ips` (subnet o selezione); se vuoto, fallback a `ips`
    const { getHostsByNetwork } = await import("@/lib/db");
    const existingHosts = getHostsByNetwork(networkId);
    const inScope = new Set(ips);
    let targetIps =
      existingHosts.length > 0
        ? existingHosts.map((h) => h.ip).filter((ip) => inScope.has(ip))
        : ips;
    if (targetIps.length === 0 && ips.length > 0) {
      targetIps = ips;
    }
    const ipToHostId = new Map<string, number>();
    for (const h of existingHosts) {
      ipToHostId.set(h.ip, h.id);
    }

    progress.phase = `Query SNMP — 0/${targetIps.length}`;
    progress.total = targetIps.length;
    log(
      `SNMP scan su ${targetIps.length} host (community per host: credenziale forzata in archivio o elenco rete)`
    );
    const BATCH = 16;
    for (let i = 0; i < targetIps.length; i += BATCH) {
      const batch = targetIps.slice(i, i + BATCH);
      log(`SNMP batch ${Math.floor(i / BATCH) + 1}: ${batch.join(", ")}`);
      const results = await Promise.all(
        batch.map(async (ip) => {
          const hid = ipToHostId.get(ip) ?? null;
          const snmpCommunities = buildSnmpCommunitiesForHost(networkId, hid, snmpCommunity ?? null);
          const r = await querySnmpInfoMultiCommunity(ip, snmpCommunities, 161, { onLog: log });
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
            const fpOidHint = r.fingerprintOidMatches?.map((m) => m.device_label).join(", ");
            log(
              `✓ ${ip} → ${r.sysName || "—"} (${r.sysDescr?.slice(0, 50) || "—"})${extra ? ` [${extra}]` : ""}${walkHint ? ` {${walkHint}}` : ""}${fpOidHint ? ` [FP: ${fpOidHint}]` : ""}`
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
          // Recupera porte TCP esistenti dal DB per non perderle
          const existingHost = existingHosts.find((h) => h.ip === r.ip);
          let existingPorts: Array<{ port: number; protocol: string; service: string | null; version: string | null }> = [];
          if (existingHost?.open_ports) {
            try {
              existingPorts = JSON.parse(existingHost.open_ports);
            } catch { /* ignore */ }
          }
          // Aggiungi 161/udp se non presente
          const has161 = existingPorts.some((p) => p.port === 161 && p.protocol === "udp");
          const mergedPorts = has161
            ? existingPorts
            : [...existingPorts, { port: 161, protocol: "udp", service: "snmp", version: null }];
          const parsedSnmp = parseModelFromSysDescr(r.sysDescr ?? null);
          const snmpManufacturerOnly = inferManufacturerFromSnmp(r.sysDescr ?? null, r.sysObjectID ?? null, r.fingerprintOidMatches ?? null);

          nmapResults.set(r.ip, {
            ports: mergedPorts,
            os: null,
            mac: null,
            snmpHostname: r.sysName ?? null,
            snmpSysDescr: r.sysDescr ?? null,
            snmpSysObjectID: r.sysObjectID ?? null,
            snmpSerial: r.serialNumber ?? null,
            snmpModel: r.model ?? null,
            snmpMikrotikIdentity: r.mikrotikIdentity ?? null,
            snmpUnifiSummary: r.unifiSummary ?? null,
            snmpIfDescrSummary: r.ifDescrSummary ?? null,
            snmpHostResourcesSummary: r.hostResourcesSummary ?? null,
            snmpFingerprintOidMatches: r.fingerprintOidMatches ?? null,
            snmpFirmware: parsedSnmp.firmware ?? null,
            snmpManufacturer: snmpManufacturerOnly,
          });
        }
      }
      progress.scanned = Math.min(i + BATCH, targetIps.length);
      progress.found = onlineIps.length;
      progress.phase = `Query SNMP — ${progress.scanned}/${targetIps.length}`;
    }
    console.info(`[Discovery] SNMP: ${onlineIps.length}/${targetIps.length} host rispondono`);
  }

  // ═══════════════════════════════════════════════════════════════
  // NMAP: host discovery + port scan — verifica risposta, compila porte/os
  // SNMP non usato per raccolta dati (solo nmap)
  // ═══════════════════════════════════════════════════════════════
  else if (scanType === "nmap") {
    const isDiscoveryOnly = nmapArgs?.trim() === "-sn";
    const nmapAvailable = await isNmapAvailable();
    const isTargetedScan = ips.length < getAllHostIps(cidr).length;

    if (!nmapAvailable) {
      progress.phase = "Nmap non disponibile, fallback a ping";
      const results = await pingSweep(ips, 50, (scanned, found) => {
        progress.scanned = scanned;
        progress.found = found;
      });
      onlineIps = results.filter((r) => r.alive).map((r) => r.ip);
    } else if (isTargetedScan) {
      progress.phase = "Ping — host selezionati";
      const results = await pingSweep(ips, 50, (scanned, found) => {
        progress.scanned = scanned;
        progress.found = found;
      });
      onlineIps = results.filter((r) => r.alive).map((r) => r.ip);
      progress.scanned = ips.length;
      progress.found = onlineIps.length;
    } else {
      progress.phase = "Scoperta host (nmap -sn)";
      console.info(`[Discovery] Nmap: host discovery su ${cidr}`);
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
    }

    if (nmapAvailable && !isDiscoveryOnly && onlineIps.length > 0) {
      progress.phase = `Scansione porte — 0/${onlineIps.length}`;
      progress.scanned = 0;
      progress.total = onlineIps.length;
      // Usa porte esplicite dal profilo se presenti, altrimenti fallback a nmapArgs o default
      const portScanArgs = nmapArgs ?? buildTcpScanArgs(null, discoverOpts?.tcpPorts);
      const udpPortsRaw = discoverOpts?.udpPorts;
      /** `""` = nessuna scansione UDP (solo TCP); `null`/`undefined` = elenco UDP predefinito (profilo legacy). */
      const skipUdpPhase = udpPortsRaw === "";
      const udpPortsArg = skipUdpPhase ? null : (udpPortsRaw ?? null);
      /** TCP + UDP in sequenza: host-timeout + margine avvio/chiusura; tetto 180s. */
      const htMs = getNmapHostTimeoutSeconds() * 1000;
      const nmapPortExecTimeoutMs = Math.min(180_000, htMs + 20_000);
      log(`Profilo Nmap TCP: ${portScanArgs}`);
      if (skipUdpPhase) log("UDP: disattivato (nessuna porta UDP nel profilo)");
      else if (udpPortsArg) log(`Porte UDP profilo: ${udpPortsArg}`);
      else log("UDP: elenco predefinito applicazione (profilo senza elenco UDP)");
      /** Concorrenza port scan: default 4 host in parallelo (bilanciamento velocità / affidabilità). Override: DA_INVENT_NMAP_PORT_SCAN_CONCURRENCY */
      const BATCH_SIZE = Math.min(
        8,
        Math.max(1, parseInt(process.env.DA_INVENT_NMAP_PORT_SCAN_CONCURRENCY || "4", 10))
      );
      if (BATCH_SIZE < 8) log(`Nmap port scan: concorrenza ${BATCH_SIZE} host (consigliato per reti con hypervisor / TLS)`);
      for (let i = 0; i < onlineIps.length; i += BATCH_SIZE) {
        const batch = onlineIps.slice(i, i + BATCH_SIZE);
        const batchResults = await Promise.all(
          batch.map((ip) =>
            nmapPortScan(ip, portScanArgs, nmapPortExecTimeoutMs, {
              onLog: log,
              udpPorts: udpPortsArg,
              skipUdp: skipUdpPhase,
            })
          )
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

  // ═══════════════════════════════════════════════════════════════
  // SNMP nella stessa sessione di Nmap / network_discovery: somma porte + walk (produttore, modello, firmware, seriale)
  // ═══════════════════════════════════════════════════════════════
  if ((scanType === "nmap" || scanType === "network_discovery") && onlineIps.length > 0) {
    const hostsForSnmpMap = getHostsByNetwork(networkId);
    const ipToHostIdSnmp = new Map<string, number>();
    for (const h of hostsForSnmpMap) {
      ipToHostIdSnmp.set(h.ip, h.id);
    }
    progress.phase = `SNMP (sessione unificata) — 0/${onlineIps.length}`;
    log(
      `SNMP + walk nella sessione con Nmap: ${onlineIps.length} host (community per host: credenziale forzata o elenco rete)`
    );
    const SNMP_BATCH = 16;
    for (let si = 0; si < onlineIps.length; si += SNMP_BATCH) {
      const batch = onlineIps.slice(si, si + SNMP_BATCH);
      const snmpRows = await Promise.all(
        batch.map((ip) => {
          const hid = ipToHostIdSnmp.get(ip) ?? null;
          const snmpCommunities = buildSnmpCommunitiesForHost(networkId, hid, snmpCommunity ?? null);
          return querySnmpInfoMultiCommunity(ip, snmpCommunities, 161, { onLog: log });
        })
      );
      for (let bi = 0; bi < batch.length; bi++) {
        const ip = batch[bi];
        const r = snmpRows[bi];
        if (!r.sysName && !r.sysDescr && !r.sysObjectID) continue;
        const prev = nmapResults.get(ip) ?? { ports: [], os: null, mac: null };
        const parsed = parseModelFromSysDescr(r.sysDescr ?? null);
        const mergedPorts = [...prev.ports];
        const has161 = mergedPorts.some((p) => p.port === 161 && p.protocol === "udp");
        if (!has161) {
          mergedPorts.push({ port: 161, protocol: "udp", service: "snmp", version: null });
        }
        const fpMatches = r.fingerprintOidMatches ?? null;
        const manufacturer = inferManufacturerFromSnmp(r.sysDescr ?? null, r.sysObjectID ?? null, fpMatches);
        nmapResults.set(ip, {
          ...prev,
          ports: mergedPorts,
          snmpHostname: r.sysName ?? prev.snmpHostname ?? null,
          snmpSysDescr: r.sysDescr ?? prev.snmpSysDescr ?? null,
          snmpSysObjectID: r.sysObjectID ?? prev.snmpSysObjectID ?? null,
          snmpSerial: r.serialNumber ?? prev.snmpSerial ?? null,
          snmpModel: r.model ?? prev.snmpModel ?? null,
          snmpPartNumber: r.partNumber ?? prev.snmpPartNumber ?? null,
          snmpMikrotikIdentity: r.mikrotikIdentity ?? prev.snmpMikrotikIdentity ?? null,
          snmpUnifiSummary: r.unifiSummary ?? prev.snmpUnifiSummary ?? null,
          snmpIfDescrSummary: r.ifDescrSummary ?? prev.snmpIfDescrSummary ?? null,
          snmpHostResourcesSummary: r.hostResourcesSummary ?? prev.snmpHostResourcesSummary ?? null,
          snmpFingerprintOidMatches: fpMatches ?? prev.snmpFingerprintOidMatches ?? null,
          snmpFirmware: parsed.firmware ?? prev.snmpFirmware ?? null,
          snmpManufacturer: manufacturer ?? prev.snmpManufacturer ?? null,
          snmpCommunity: r.community ?? prev.snmpCommunity ?? null,
          snmpSysUpTime: r.sysUpTime ?? prev.snmpSysUpTime ?? null,
          snmpArpEntryCount: r.arpEntryCount ?? prev.snmpArpEntryCount ?? null,
          vendorProfileId: r.vendorProfileId ?? prev.vendorProfileId ?? null,
          vendorProfileName: r.vendorProfileName ?? prev.vendorProfileName ?? null,
          vendorProfileConfidence: r.vendorProfileConfidence ?? prev.vendorProfileConfidence ?? null,
          vendorProfileCategory: r.vendorProfileCategory ?? prev.vendorProfileCategory ?? null,
          vendorProfileFirmware: r.vendorProfileFirmware ?? prev.vendorProfileFirmware ?? null,
          vendorProfileExtra: r.vendorProfileExtra ?? prev.vendorProfileExtra ?? undefined,
        });
        const extra = [r.model || parsed.model, parsed.firmware, r.serialNumber].filter(Boolean).join(", ");
        log(
          `✓ SNMP sessione ${ip} → ${r.sysName || "—"}${extra ? ` [${extra}]` : ""}${manufacturer ? ` · ${manufacturer}` : ""}`
        );
      }
      progress.scanned = Math.min(si + SNMP_BATCH, onlineIps.length);
      progress.phase = `SNMP (sessione unificata) — ${progress.scanned}/${onlineIps.length}`;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // CREDENTIAL VALIDATE: fase dedicata che testa tutte le credenziali della subnet sugli host
  // ═══════════════════════════════════════════════════════════════
  if (scanType === "credential_validate") {
    const { getNetworkCredentials, addHostCredential, getHostsByNetwork } = await import("@/lib/db");
    const netCreds = getNetworkCredentials(networkId);
    if (netCreds.length === 0) {
      log("Nessuna credenziale configurata per questa subnet.");
      progress.status = "completed";
      progress.phase = "Completata — nessuna credenziale";
      addScanHistory({
        host_id: null,
        network_id: networkId,
        scan_type: "credential_validate",
        status: "Nessuna credenziale configurata",
        ports_open: null,
        raw_output: null,
        duration_ms: Date.now() - startTime,
      });
      setTimeout(() => getProgressMap().delete(scanId), 300000);
      return { network_id: networkId, total_ips: ips.length, hosts_found: 0, hosts_online: 0, hosts_offline: ips.length, new_hosts: 0, duration_ms: Date.now() - startTime };
    }

    const existingHosts = getHostsByNetwork(networkId);
    const inScope = new Set(ips);
    // Include host con porte note OPPURE con classificazione/OS che indica un tipo (da SNMP/AD)
    const targetHosts = existingHosts.filter((h) => {
      if (!inScope.has(h.ip)) return false;
      if (h.open_ports) return true;
      const cls = h.classification ?? "";
      const os = (h.os_info ?? "").toLowerCase();
      return cls.includes("windows") || cls === "workstation" || cls.includes("server") || cls.includes("linux")
        || cls === "networking" || os.includes("windows") || os.includes("linux");
    });

    log(`Validazione credenziali: ${netCreds.length} credenziali × ${targetHosts.length} host con porte note`);
    progress.total = targetHosts.length;
    progress.scanned = 0;

    let validated = 0;
    const { Client } = await import("ssh2");
    const { runWinrmCommand } = await import("@/lib/devices/winrm-run");

    for (let i = 0; i < targetHosts.length; i++) {
      const host = targetHosts[i];
      const ip = host.ip;
      let openPorts: Array<{ port: number; service?: string }> = [];
      try { openPorts = JSON.parse(host.open_ports || "[]"); } catch { /* skip */ }

      progress.phase = `Validazione — ${i + 1}/${targetHosts.length} (${ip})`;

      // Indicatori Windows: porte SMB/WinRM o classificazione/OS
      const hasWinrmPort = openPorts.some((p) => [5985, 5986].includes(p.port));
      const hasWindowsIndicator = hasWinrmPort
        || openPorts.some((p) => [445, 135].includes(p.port))
        || (host.classification ?? "").includes("windows")
        || (host.classification ?? "") === "workstation"
        || (host.os_info ?? "").toLowerCase().includes("windows");

      for (const nc of netCreds) {
        const credType = nc.credential_type.toLowerCase();
        const credId = nc.credential_id;

        // Match credenziale → porte aperte (+ indicatori OS)
        // SSH: porta esplicita oppure host Linux/networking/server senza indicatore Windows
        const hasSshPort = openPorts.some((p) => p.port === 22 || p.service === "ssh");
        const hasSshIndicator = hasSshPort
          || (!hasWindowsIndicator && (
            (host.classification ?? "").includes("server")
            || (host.classification ?? "").includes("linux")
            || (host.classification ?? "") === "networking"
            || (host.os_info ?? "").toLowerCase().includes("linux")
          ));
        if ((credType === "ssh" || credType === "linux") && hasSshIndicator) {
          const sshPort = openPorts.find((p) => p.port === 22 || p.service === "ssh")?.port ?? 22;
          const creds = getSshLinuxCredentialPair(credId);
          if (!creds) continue;
          try {
            await new Promise<void>((resolve, reject) => {
              const conn = new Client();
              const to = setTimeout(() => { conn.end(); reject(new Error("timeout")); }, 8000);
              conn.on("ready", () => { clearTimeout(to); conn.end(); resolve(); });
              conn.on("error", (err) => { clearTimeout(to); reject(err); });
              conn.connect({
                host: ip, port: sshPort, username: creds.username, password: creds.password, readyTimeout: 6000,
                algorithms: { kex: ["curve25519-sha256", "curve25519-sha256@libssh.org", "ecdh-sha2-nistp256", "ecdh-sha2-nistp384", "ecdh-sha2-nistp521", "diffie-hellman-group-exchange-sha256", "diffie-hellman-group14-sha256", "diffie-hellman-group14-sha1", "diffie-hellman-group1-sha1"] },
              });
            });
            addHostCredential(host.id, credId, "ssh", sshPort, { validated: true, auto_detected: true });
            autoBindCredentialToDevice(ip, credId, "ssh", sshPort);
            log(`✓ ${ip}:${sshPort} SSH cred#${credId} (${nc.credential_name})`);
            validated++;
          } catch (e) {
            log(`✗ ${ip}:${sshPort} SSH cred#${credId}: ${(e as Error).message?.slice(0, 60)}`);
          }
        }

        if (credType === "snmp") {
          const com = getCredentialCommunityString(credId);
          if (!com) continue;
          try {
            const r = await querySnmpInfoMultiCommunity(ip, [com], 161, { onLog: log });
            if (r.sysName || r.sysDescr || r.sysObjectID) {
              addHostCredential(host.id, credId, "snmp", 161, { validated: true, auto_detected: true });
              autoBindCredentialToDevice(ip, credId, "snmp", 161);
              log(`✓ ${ip}:161 SNMP cred#${credId} (${nc.credential_name})`);
              validated++;
            } else {
              log(`✗ ${ip}:161 SNMP cred#${credId}: nessuna risposta`);
            }
          } catch (e) {
            log(`✗ ${ip}:161 SNMP cred#${credId}: ${(e as Error).message?.slice(0, 60)}`);
          }
        }

        if (credType === "windows" && hasWindowsIndicator) {
          // Porta WinRM: preferisci porta esplicita, fallback a 5985
          const winrmPort = openPorts.find((p) => [5985, 5986].includes(p.port))?.port ?? 5985;
          const creds = getCredentialLoginPair(credId, "windows");
          if (!creds) continue;
          try {
            const adInfo = getAdRealm();
            const hn = await runWinrmCommand(ip, winrmPort, creds.username, creds.password, "hostname", false, adInfo?.realm || "");
            if (String(hn ?? "").trim()) {
              addHostCredential(host.id, credId, "winrm", winrmPort, { validated: true, auto_detected: true });
              autoBindCredentialToDevice(ip, credId, "winrm", winrmPort);
              log(`✓ ${ip}:${winrmPort} WinRM cred#${credId} (${nc.credential_name})`);
              validated++;
            } else {
              log(`✗ ${ip}:${winrmPort} WinRM cred#${credId}: risposta vuota`);
            }
          } catch (e) {
            log(`✗ ${ip}:${winrmPort} WinRM cred#${credId}: ${(e as Error).message?.slice(0, 60)}`);
          }
        }

        // API: porte 80/443/8080/8443
        if (credType === "api" && openPorts.some((p) => [80, 443, 8080, 8443].includes(p.port))) {
          const apiPort = openPorts.find((p) => [80, 443, 8080, 8443].includes(p.port))!.port;
          addHostCredential(host.id, credId, "api", apiPort, { validated: false, auto_detected: true });
          log(`⚙ ${ip}:${apiPort} API cred#${credId} (${nc.credential_name}) — aggiunta senza test`);
        }
      }

      progress.scanned = i + 1;
      progress.found = validated;
    }

    log(`Validazione completata: ${validated} credenziali validate su ${targetHosts.length} host`);
    progress.status = "completed";
    progress.phase = "Completata";
    progress.found = validated;

    addScanHistory({
      host_id: null,
      network_id: networkId,
      scan_type: "credential_validate",
      status: `${validated} credenziali validate su ${targetHosts.length} host`,
      ports_open: null,
      raw_output: null,
      duration_ms: Date.now() - startTime,
    });

    setTimeout(() => getProgressMap().delete(scanId), 300000);
    return { network_id: networkId, total_ips: ips.length, hosts_found: targetHosts.length, hosts_online: targetHosts.length, hosts_offline: 0, new_hosts: 0, duration_ms: Date.now() - startTime };
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

  /** TTL ICMP per fingerprint (solo scan nmap; batch 8, 50ms tra batch). */
  const ttlByIp = new Map<string, number | null>();
  const fpEnabled = process.env.DA_INVENT_FINGERPRINT !== "false";
  if (
    fpEnabled &&
    (scanType === "nmap" || scanType === "network_discovery" || scanType === "ipam_full") &&
    onlineIps.length > 0 &&
    process.env.DA_INVENT_FINGERPRINT_TTL !== "false"
  ) {
    progress.phase = "Fingerprint — TTL ICMP";
    const { pingHost } = await import("./ping");
    const TTL_BATCH = 8;
    for (let t = 0; t < onlineIps.length; t += TTL_BATCH) {
      const chunk = onlineIps.slice(t, t + TTL_BATCH);
      const pings = await Promise.all(chunk.map((aip) => pingHost(aip, 2000)));
      for (let u = 0; u < chunk.length; u++) {
        ttlByIp.set(chunk[u], pings[u].ttl ?? null);
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    progress.phase = "Risoluzione DNS e vendor";
  }

  /** PTR + forward: usa valori già in DB se presenti (nessuna query di rete). Import dns solo se serve. */
  const dnsConcurrency = Math.min(64, Math.max(1, parseInt(process.env.DA_INVENT_DNS_CONCURRENCY || "16", 10)));
  const forceDnsRefresh = process.env.DA_INVENT_DNS_ALWAYS_REFRESH === "true";
  const dbHostsForDns = getHostsByNetwork(networkId);
  const hostRowByIp = new Map(dbHostsForDns.map((h) => [h.ip, h]));
  const dnsByIp = new Map<string, DnsResolution>();
  const ipsNeedingNetworkDns: string[] = [];
  for (const ip of onlineIps) {
    const row = hostRowByIp.get(ip);
    if (!forceDnsRefresh && row?.dns_reverse) {
      dnsByIp.set(ip, { reverse: row.dns_reverse, forward: row.dns_forward ?? null });
    } else {
      ipsNeedingNetworkDns.push(ip);
    }
  }
  if (ipsNeedingNetworkDns.length > 0) {
    const { resolveDnsBatch } = await import("./dns");
    const merged = await resolveDnsBatch(ipsNeedingNetworkDns, dnsServer, dnsConcurrency, (done, tot) => {
      progress.scanned = done;
      progress.phase = `Risoluzione DNS — ${done}/${tot}`;
    });
    for (const [k, v] of merged) dnsByIp.set(k, v);
  } else {
    progress.phase = "Risoluzione DNS (da archivio locale)";
    progress.scanned = onlineIps.length;
  }

  /** Oltre questa soglia non eseguiamo HTTP/SSH/SMB sul fingerprint (troppo lento in sequenza su scan Nmap). Default 8: oltre 8 host online solo firme porte/SNMP. */
  const fpProbesMaxHosts = parseInt(process.env.DA_INVENT_FINGERPRINT_PROBES_MAX_HOSTS || "8", 10);
  const fpHostOk = onlineIps.length <= Math.max(1, Math.min(500, fpProbesMaxHosts));
  const fingerprintAllowHeavyProbes =
    fpEnabled && fpHostOk && process.env.DA_INVENT_FINGERPRINT_PROBES !== "false";
  if (fpEnabled && !fpHostOk && (scanType === "nmap" || scanType === "snmp" || scanType === "network_discovery" || scanType === "ipam_full")) {
    console.warn(
      `[Discovery] Fingerprint: probe HTTP/SSH/SMB disattivati (${onlineIps.length} host online > ${fpProbesMaxHosts}); uso solo firme porte/SNMP. Alzare DA_INVENT_FINGERPRINT_PROBES_MAX_HOSTS solo su subnet piccole.`
    );
  }

  const fpUserRules = getFingerprintClassificationRulesForResolve();
  const fpDbRules = fpEnabled ? getEnabledDeviceFingerprintRules() : [];

  // Reset contatori per la fase host processing (evita 100% falso dopo DNS)
  progress.scanned = 0;
  progress.total = onlineIps.length;

  for (let i = 0; i < onlineIps.length; i++) {
    const ip = onlineIps[i];
    progress.scanned = i;
    progress.phase = `Elaborazione host — ${i + 1}/${onlineIps.length} (${ip})`;
    log(`Host ${i + 1}/${onlineIps.length}: ${ip}`);

    const nmapData = nmapResults.get(ip);
    const mac = nmapData?.mac || arpMap.get(ip) || null;
    const vendor = mac ? await lookupVendor(mac) : null;

    const snmpHostname = nmapData?.snmpHostname || null;

    const dnsPair = dnsByIp.get(ip) ?? { reverse: null, forward: null };
    const dnsReverse = dnsPair.reverse;
    const dnsForward = dnsPair.forward;

    // Hostname: priorità SNMP > DNS reverse
    const hostname = snmpHostname || dnsReverse;
    const hostnameSource = snmpHostname ? "snmp" : (dnsReverse ? "dns" : undefined);

    /** Somma sessione corrente + archivio: non si perdono TCP se lo scan ha solo UDP o viceversa */
    const existingPortsFromDb = hostRowByIp.get(ip)?.open_ports ?? null;
    const portsJson =
      nmapData?.ports?.length
        ? mergeOpenPortsJson(existingPortsFromDb, JSON.stringify(nmapData.ports))
        : undefined;

    /**
     * Per classificazione e fingerprint usa SEMPRE le porte merged (archivio + sessione corrente).
     * Se uno scan parziale non rileva una porta già nota (es. 8006 su Proxmox), la classificazione
     * non deve degradare a "unknown" solo perché questa singola sessione non l'ha trovata.
     */
    type PortEntry = { port: number; protocol?: string; service?: string | null; version?: string | null };
    let portsForClassification: PortEntry[] | null = null;
    try {
      portsForClassification = portsJson
        ? (JSON.parse(portsJson) as PortEntry[])
        : (nmapData?.ports ?? null);
    } catch {
      portsForClassification = nmapData?.ports ?? null;
    }

    const classificationFromRules = classifyDevice({
      sysDescr: nmapData?.snmpSysDescr ?? null,
      sysObjectID: nmapData?.snmpSysObjectID ?? null,
      osInfo: nmapData?.os ?? null,
      openPorts: portsForClassification,
      hostname: hostname ?? null,
      vendor: vendor ?? null,
      snmpContext: buildSnmpContextForClassifier(nmapData),
    });

    // Estrai modello/firmware da ENTITY-MIB, oppure fallback su sysDescr
    const sysDescrParsed = parseModelFromSysDescr(nmapData?.snmpSysDescr ?? null);
    const hostFirmware = nmapData?.snmpFirmware ?? sysDescrParsed.firmware ?? undefined;
    const hostManufacturer =
      nmapData?.sysObjMatch?.vendor ??
      nmapData?.snmpManufacturer ??
      inferManufacturerFromSnmp(
        nmapData?.snmpSysDescr ?? null,
        nmapData?.snmpSysObjectID ?? null,
        nmapData?.snmpFingerprintOidMatches ?? null
      ) ??
      undefined;
    let fpSnap: DeviceFingerprintSnapshot | null = null;
    let detectionJson: string | undefined;
    // Vendor profile override — dichiarati fuori dal try per uso nel fallback snapshot
    let vpName = nmapData?.vendorProfileName ?? null;
    let vpId = nmapData?.vendorProfileId ?? null;
    let vpConf = nmapData?.vendorProfileConfidence ?? 0;
    let isGenericVp = vpId === "linux_generic" || vpId === "windows_snmp";
    if (fpEnabled && (scanType === "nmap" || scanType === "snmp" || scanType === "network_discovery" || scanType === "ipam_full")) {
      try {
        const { buildDeviceFingerprint } = await import("./device-fingerprint");
        const tcpPortCount = (portsForClassification ?? []).filter((p) => (p.protocol ?? "tcp") === "tcp").length;
        fpSnap = await buildDeviceFingerprint({
          ip,
          hostname: hostname ?? null,
          mac: mac ?? null,
          macVendor: vendor ?? null,
          ttl: ttlByIp.get(ip) ?? null,
          openPorts: portsForClassification ?? [],
          snmpSysDescr: nmapData?.snmpSysDescr ?? null,
          snmpSysObjectID: nmapData?.snmpSysObjectID ?? null,
          snmpSysName: snmpHostname ?? null,
          activeProbes:
            fingerprintAllowHeavyProbes &&
            (scanType === "nmap" || scanType === "network_discovery" || scanType === "ipam_full") &&
            tcpPortCount > 0,
        }, fpDbRules);
        // Se il vendor profile SNMP ha identificato un device specifico (non linux_generic/windows_snmp),
        // sovrascrivere il final_device del fingerprint con il nome del profilo.
        // Es: fingerprint dice "Linux/net-snmp" ma il vendor profile dice "Ubiquiti UniFi Switch" → usa quest'ultimo.
        // NB: vpName/vpId/vpConf/isGenericVp dichiarati sopra (fuori dal try) per il fallback snapshot.

        // Ubiquiti non identificato dal profilo: se l'enterprise MIB 41112 ha risposto (snmpUnifiSummary)
        // o se i fingerprintOidMatches contengono 41112, il device è Ubiquiti.
        // Combinare con hostname per determinare switch vs AP vs router.
        if (isGenericVp || !vpName) {
          const hasUnifiMib = !!nmapData?.snmpUnifiSummary ||
            nmapData?.snmpFingerprintOidMatches?.some((m) => m.oid_prefix.includes("41112"));
          const macIsUbiquiti = /ubiquiti/i.test(vendor ?? "");
          if (hasUnifiMib || macIsUbiquiti) {
            const hn = (hostname ?? "").toLowerCase();
            if (/^sw[-_]|^usw[-_]|^us[-_]\d|switch/i.test(hn)) {
              vpName = "Ubiquiti UniFi Switch";
              vpId = "ubiquiti_unifi_switch";
              vpConf = 0.92;
              isGenericVp = false;
            } else if (/^ap[-_]|^uap[-_]|^wifi[-_]|^u6[-_]|^u7[-_]/i.test(hn)) {
              vpName = "Ubiquiti UniFi AP";
              vpId = "ubiquiti_unifi_ap";
              vpConf = 0.92;
              isGenericVp = false;
            } else if (/^gw[-_]|^udm[-_]|^usg[-_]|^router[-_]/i.test(hn)) {
              vpName = "Ubiquiti EdgeRouter";
              vpId = "ubiquiti_edgerouter";
              vpConf = 0.92;
              isGenericVp = false;
            } else if (hasUnifiMib) {
              // UniFi MIB risponde ma hostname non indica il tipo → generico Ubiquiti
              vpName = "Ubiquiti Device";
              vpId = "ubiquiti_generic";
              vpConf = 0.90;
              isGenericVp = false;
            }
          }
        }

        if (fpSnap && vpName && vpConf >= 0.90 && !isGenericVp) {
          const fpIsGeneric = !fpSnap.final_device ||
            fpSnap.final_device === "Linux/net-snmp" ||
            fpSnap.final_device === "Linux generico" ||
            fpSnap.final_device === "Switch" ||
            (fpSnap.final_confidence ?? 0) < 0.70;
          if (fpIsGeneric) {
            fpSnap = { ...fpSnap, final_device: vpName, final_confidence: vpConf };
          }
        }
        if (fpSnap) detectionJson = JSON.stringify(fpSnap);
      } catch (fpErr) {
        console.warn("[Fingerprint]", ip, fpErr);
      }
    }

    // Se non c'è fingerprint snapshot ma c'è un vendor profile specifico, crearne uno minimale
    // così la UI mostra il nome del profilo nella colonna "Rilevamento"
    if (!detectionJson && vpName && !isGenericVp) {
      const vpSnap: DeviceFingerprintSnapshot = {
        ip,
        hostname: hostname ?? null,
        mac: mac ?? null,
        ttl: null,
        os_hint: null,
        open_ports: [],
        matches: [],
        banner_http: null,
        banner_ssh: null,
        snmp_sysdescr: nmapData?.snmpSysDescr ?? null,
        snmp_vendor_oid: nmapData?.snmpSysObjectID ?? null,
        final_device: vpName,
        final_confidence: vpConf || 0.90,
        detection_sources: ["snmp_vendor_profile"],
        generated_at: new Date().toISOString(),
      };
      detectionJson = JSON.stringify(vpSnap);
    }

    // Classificazione — catena di priorità:
    // 0. VENDOR PROFILE SNMP (confidenza 90-99%) → massima affidabilità, basato su OID specifici
    // 1. OID enterprise SPECIFICO (non net-snmp 8072)  → alta affidabilità
    // 2. Fingerprint SPECIFICO (es. Synology DSM, QNAP QTS, MikroTik…) con confidenza ≥ soglia
    //    — ESCLUSI "Linux generico" e "Linux/net-snmp": sono agenti generici e cedono alle regole host
    // 3. Regole classiche: hostname prefix (SW-, AP-…), vendor MAC, porte, testo sysDescr
    // 4. OID generico (net-snmp 8072) — last resort, solo se nessuna fonte più specifica ha esito
    // 5. Fingerprint GENERICO (Linux generico / Linux/net-snmp) — ultimo fallback
    //
    // Razionale: "Linux/net-snmp" a 90% identifica il protocollo SNMP, non il device.
    // Uno switch Ubiquiti risponde come Linux via net-snmp ma è uno switch, non un server.
    const GENERIC_FINGERPRINT_DEVICES = new Set(["Linux generico", "Linux/net-snmp"]);

    // Profilo vendor SNMP: ha confidenza alta (90-99%) e usa OID specifici
    // NB: linux_generic e windows_snmp hanno confidenza più bassa (85%) e vengono bypassati
    const vendorProfileConf = nmapData?.vendorProfileConfidence ?? 0;
    const vendorProfileCat = nmapData?.vendorProfileCategory ?? null;
    const isVendorProfileHighConf = vendorProfileConf >= 0.90 && vendorProfileCat;
    const classificationFromVendorProfile = isVendorProfileHighConf
      ? (vendorProfileCat as import("@/lib/device-classifier").DeviceClassification)
      : undefined;

    // Hostname prefix → classificazione ad alta affidabilità (l'admin nomina "SW-" i suoi switch)
    type DC = import("@/lib/device-classifier").DeviceClassification;
    const HOSTNAME_CLASS_OVERRIDES: Array<{ pattern: RegExp; classification: DC }> = [
      { pattern: /^sw[-_]|^usw[-_]|^us[-_]\d/i, classification: "switch" },
      { pattern: /^ap[-_]|^uap[-_]|^wifi[-_]/i, classification: "access_point" },
      { pattern: /^gw[-_]|^udm[-_]|^usg[-_]|^rtr[-_]|^router[-_]/i, classification: "router" },
      { pattern: /^fw[-_]|^firewall[-_]/i, classification: "firewall" },
    ];
    const hnForOverride = (hostname ?? "").trim();
    let classFromHostnamePrefix: DC | undefined;
    for (const rule of HOSTNAME_CLASS_OVERRIDES) {
      if (rule.pattern.test(hnForOverride)) {
        classFromHostnamePrefix = rule.classification;
        break;
      }
    }

    // Se hostname prefix indica un tipo diverso dal vendor profile, hostname vince:
    // l'admin sa cosa collega; vendor OID generici (Ubiquiti 41112) possono sbagliare.
    const effectiveVendorProfileClass =
      (classificationFromVendorProfile && classFromHostnamePrefix &&
        classificationFromVendorProfile !== classFromHostnamePrefix)
        ? undefined
        : classificationFromVendorProfile;

    const firstOidMatch = nmapData?.snmpFingerprintOidMatches?.[0];
    const isGenericSnmpAgent = (firstOidMatch?.oid_prefix ?? "").includes("8072");
    const classificationFromFpOid = (firstOidMatch && !isGenericSnmpAgent)
      ? (firstOidMatch.classification as DC)
      : undefined;

    const fpClassRaw = fpSnap ? getClassificationFromFingerprintSnapshot(fpSnap, fpUserRules) : undefined;
    const fpDeviceName = fpSnap?.final_device ?? "";
    const isGenericFp = GENERIC_FINGERPRINT_DEVICES.has(fpDeviceName);
    const classificationFromFingerprint = (!isGenericFp && fpClassRaw) ? fpClassRaw : undefined;
    const classificationFromGenericFp = (isGenericFp && fpClassRaw) ? fpClassRaw : undefined;

    const classificationFromGenericOid = (firstOidMatch && isGenericSnmpAgent)
      ? (firstOidMatch.classification as DC)
      : undefined;

    // sysObjectID lookup (dalla tabella snmp-sysobj-lookup.ts): alta affidabilità, match esatto su OID standard
    const classFromSysObj: DC | undefined = nmapData?.sysObjMatch
      ? (nmapData.sysObjMatch.category as DC)
      : undefined;

    const classification = (
      effectiveVendorProfileClass ??
      classFromHostnamePrefix ??
      classFromSysObj ??
      classificationFromFpOid ??
      classificationFromFingerprint ??
      classificationFromRules ??
      classificationFromGenericOid ??
      classificationFromGenericFp
    ) ?? "unknown";

    const hostModel =
      nmapData?.snmpModel ||
      sysDescrParsed.model ||
      nmapData?.sysObjMatch?.product ||
      (fpSnap &&
      (fpSnap.final_confidence ?? 0) >= FINGERPRINT_CLASSIFICATION_MIN_CONFIDENCE &&
      fpSnap.final_device
        ? fpSnap.final_device
        : undefined) ||
      undefined;
    const hostSerial = nmapData?.snmpSerial || undefined;
    // Firmware: preferisci quello dal profilo vendor (OID specifici) se disponibile
    const finalFirmware = nmapData?.vendorProfileFirmware || hostFirmware || undefined;

    // Costruisce snmp_data JSON solo se SNMP ha risposto (sysDescr o sysObjectID o sysName)
    let snmpDataJson: string | undefined;
    if (nmapData?.snmpSysDescr || nmapData?.snmpSysObjectID || nmapData?.snmpHostname) {
      snmpDataJson = JSON.stringify({
        sysName: nmapData.snmpHostname ?? null,
        sysDescr: nmapData.snmpSysDescr ?? null,
        sysObjectID: nmapData.snmpSysObjectID ?? null,
        serialNumber: nmapData.snmpSerial ?? null,
        model: nmapData.snmpModel ?? null,
        partNumber: nmapData.snmpPartNumber ?? null,
        firmware: finalFirmware ?? null,
        manufacturer: hostManufacturer ?? null,
        community: nmapData.snmpCommunity ?? "public",
        port: 161,
        mikrotikIdentity: nmapData.snmpMikrotikIdentity ?? null,
        unifiSummary: nmapData.snmpUnifiSummary ?? null,
        ifDescrSummary: nmapData.snmpIfDescrSummary ?? null,
        hostResourcesSummary: nmapData.snmpHostResourcesSummary ?? null,
        sysUpTime: nmapData.snmpSysUpTime ?? null,
        arpEntryCount: nmapData.snmpArpEntryCount ?? null,
        // Dati profilo vendor SNMP (OID specifici)
        vendorProfileId: nmapData.vendorProfileId ?? null,
        vendorProfileName: nmapData.vendorProfileName ?? null,
        vendorProfileConfidence: nmapData.vendorProfileConfidence ?? null,
        vendorProfileExtra: nmapData.vendorProfileExtra ?? null,
        collected_at: new Date().toISOString(),
      });
    }

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
      // Valore già unione DB + sessione (TCP+UDP+SNMP 161); persistenza puntuale
      open_ports_replace: portsJson !== undefined,
      os_info: nmapData?.snmpSysDescr || nmapData?.os || undefined,
      model: hostModel,
      serial_number: hostSerial,
      // preserve_existing: scan nmap/network_discovery/ipam_full non sovrascrivono dati già rilevati
      preserve_existing: scanType === "nmap" || scanType === "network_discovery" || scanType === "ipam_full",
      ...(finalFirmware !== undefined || hostManufacturer !== undefined
        ? {
            firmware: finalFirmware ?? null,
            device_manufacturer: hostManufacturer ?? null,
          }
        : {}),
      ...(detectionJson !== undefined ? { detection_json: detectionJson } : {}),
      ...(snmpDataJson !== undefined ? { snmp_data: snmpDataJson } : {}),
    });

    if (host.first_seen === host.created_at) newHosts++;

    // Sync network_device collegato (stesso IP) — port e classification
    if (nmapData?.ports?.length && getNetworkDeviceByHost(ip)) {
      syncNetworkDeviceFromHostScan(ip, nmapData.ports, classification);
    }

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
    progress.phase = `Elaborazione host — ${i + 1}/${onlineIps.length} (${ip})`;
  }

  // ═══════════════════════════════════════════════════════════════
  // Post-scoperta rete: MAC dal router (solo IP già scoperti; niente nuovi host da ARP/DHCP)
  // ═══════════════════════════════════════════════════════════════
  if (scanType === "network_discovery" || scanType === "ipam_full") {
    progress.phase = "ARP dal router…";
    log("Aggiornamento MAC da tabella ARP del router…");
    try {
      const { runArpPoll } = await import("@/lib/cron/jobs");
      const arpResult = await runArpPoll(networkId, {
        onlyEnrichIps: onlineIps,
        skipDhcpLeases: true,
      });
      if (arpResult.error) {
        log(`ARP router: ${arpResult.error}`);
      } else {
        log("ARP router completato");
      }
    } catch (arpErr) {
      log(`ARP router: ${arpErr instanceof Error ? arpErr.message : "errore"}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Phase 4: Gestione host non rispondenti
  // - nmap / network_discovery: additivi → annotano nelle note, non marcano offline
  // - ping: comportamento classico → marca offline (la scansione ha solo ICMP, nessun dato parziale)
  // ═══════════════════════════════════════════════════════════════
  if (scanType === "nmap" || scanType === "network_discovery" || scanType === "ipam_full") {
    progress.phase = "Annotazione host non rispondenti";
    noteHostsNonResponding(networkId, onlineIps, ips, scanType);
    log(`Host non rispondenti (${ips.length - onlineIps.length}): annotati nelle note per revisione`);
  } else if (scanType !== "snmp") {
    progress.phase = "Aggiornamento host offline";
    markHostsOffline(networkId, onlineIps, ips);
  }

  // ═══════════════════════════════════════════════════════════════
  // Post-scan: collega computer Active Directory agli host scoperti
  // (usa i dati AD già sincronizzati in DB — non fa sync LDAP)
  // ═══════════════════════════════════════════════════════════════
  if (scanType === "network_discovery" || scanType === "ipam_full" || scanType === "nmap") {
    progress.phase = "Collegamento dati Active Directory";
    try {
      const { relinkAdComputersForNetwork } = await import("@/lib/db");
      const adResult = relinkAdComputersForNetwork(networkId);
      if (adResult.linked > 0 || adResult.enriched > 0) {
        log(`Active Directory: ${adResult.linked} computer collegati, ${adResult.enriched} host arricchiti`);
      } else {
        log("Active Directory: nessun nuovo collegamento (dati già allineati o nessun computer AD)");
      }
    } catch (adErr) {
      log(`Active Directory: ${adErr instanceof Error ? adErr.message : "errore"}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Post-scan: sincronizza ip_assignment da DHCP leases + AD DHCP
  // (senza triggare sync DHCP/AD esterne — usa i dati già in DB)
  // ═══════════════════════════════════════════════════════════════
  progress.phase = "Aggiornamento assegnazioni IP (DHCP/AD)";
  try {
    syncIpAssignmentsForNetwork(networkId);
    log("Assegnazione IP (DHCP/AD) aggiornata");
  } catch (assignErr) {
    log(`Assegnazione IP: ${assignErr instanceof Error ? assignErr.message : "errore"}`);
  }

  // ═══════════════════════════════════════════════════════════════
  // Post-scan: rileva dispositivi multi-homed (stesso device su più subnet)
  // ═══════════════════════════════════════════════════════════════
  if (scanType === "network_discovery" || scanType === "ipam_full" || scanType === "nmap") {
    progress.phase = "Rilevamento dispositivi multi-homed";
    try {
      const { recomputeMultihomedLinks } = await import("@/lib/db");
      const mhResult = recomputeMultihomedLinks();
      if (mhResult.groups > 0) {
        log(`Multi-homed: ${mhResult.groups} gruppi, ${mhResult.hosts_linked} host collegati tra subnet`);
      }
    } catch (mhErr) {
      log(`Multi-homed: ${mhErr instanceof Error ? mhErr.message : "errore"}`);
    }
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

  console.info(`[Discovery] Completata: ${onlineIps.length} host, ${totalPorts} porte, ${Date.now() - startTime}ms`);

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
