import { getAllHostIps } from "@/lib/utils";
import { getCurrentTenantCode, withTenant } from "@/lib/db-tenant";
import { pingSweep as _localPingSweep } from "./ping";
import { nmapDiscoverHosts as _localNmapDiscoverHosts, nmapPortScan as _localNmapPortScan, isNmapAvailable as _localIsNmapAvailable } from "./nmap";
import { tcpConnect, FALLBACK_TCP_PORTS } from "./tcp-check";
import type { Executor } from "@/lib/executor";
import { getExecutor } from "@/lib/executor";
import {
  buildTcpScanArgs,
  buildNetworkDiscoveryQuickTcpArgs,
  buildTargetedServiceTcpArgs,
  ALWAYS_USEFUL_TCP_PORTS,
  unionTcpPorts,
  getQuickScanTcpPorts,
  getFullScanTcpPortList,
  parseTcpPortSpec,
  tcpPortListToSpec,
  getNmapHostTimeoutSeconds,
  getNetworkDiscoveryQuickConcurrency,
  getNetworkDiscoveryQuickExecMs,
  setGetSettingFn,
} from "./ports";
import { isNaabuAvailable, runNaabuTcpPorts } from "./naabu";
import { readArpCache } from "./arp-cache";
import { lookupVendor } from "./mac-vendor";
import { querySnmpInfoMultiCommunity, querySnmpSysGroupMultiCommunity, normalizeOidString } from "./snmp-query";
import { classifyDeviceDetailed } from "@/lib/device-classifier";
import {
  getClassificationFromFingerprintSnapshot,
  FINGERPRINT_CLASSIFICATION_MIN_CONFIDENCE,
} from "@/lib/device-fingerprint-classification";
import { runClassificationEngineForHost } from "@/lib/classification/run";
import { mapSysObjCategory } from "@/lib/attribution/sysobj-category";
import { parseJsonSafe } from "@/lib/json-safe";
import {
  getNetworkById,
  getHostsByNetwork,
  getDb,
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
  getNetworkDeviceByHostId,
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
  getMultihomedStatus,
  recordCredentialFailure,
  recordCredentialSuccess,
  getCredentialById,
} from "@/lib/db";
import { resolveCredentialsFor } from "@/lib/credentials/resolve";
import type { CredProtocol } from "@/lib/credentials/resolve";
import { CredentialRunBudget } from "./credential-run-budget";
import { evidenceFromAuthOutcome } from "@/lib/attribution/credential-evidence";
import type { AuthOutcome } from "@/lib/attribution/credential-evidence";
import { recordEvidence } from "@/lib/attribution/evidence";
import { recomputeAttributionSafe } from "@/lib/attribution/recompute";
import { redfishDetect, redfishValidate, redfishFetchInfo, redfishEvidence } from "@/lib/protocols/redfish";
import { snmpValidateV3 } from "@/lib/protocols/snmpv3";
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

export type DiscoveryScanType =
  | "ping"
  | "fast"
  | "snmp"
  | "nmap"
  | "windows"
  | "ssh"
  | "network_discovery"
  | "ipam_full"
  | "credential_validate"
  | "scan_icmp"
  | "scan_nmap_base"
  | "scan_snmp_verify"
  | "scan_full"
  /** ICMP → Naabu TCP (obbligatorio) → Nmap -sV mirato. Nuovo modo di scan rete. */
  | "scan_naabu";

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

/**
 * Auto-aggiunge una credenziale funzionante ai bindings del device, se l'host
 * corrisponde a un network_device. Fase 1b (§7.2): risolve il device via
 * `getNetworkDeviceByHostId` (FK, più affidabile) quando `hostId` è noto, con
 * fallback sul match stringa IP. Se nessun device viene trovato la funzione
 * è un no-op sul binding — ma questo NON deve mai essere l'unico posto dove si
 * registra il tentativo: i chiamanti scrivono già su `host_credentials`
 * (via `addHostCredential`/`recordCredentialSuccess`) PRIMA di invocarla.
 */
function autoBindCredentialToDevice(
  hostIp: string,
  credentialId: number,
  protocolType: "ssh" | "snmp" | "winrm" | "api",
  port: number,
  hostId?: number | null
): void {
  try {
    const device = (hostId != null ? getNetworkDeviceByHostId(hostId) : undefined) ?? getNetworkDeviceByHost(hostIp);
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

  // Cattura il contesto tenant corrente per preservarlo nel background task
  const tenantCode = getCurrentTenantCode();

  const runInBackground = () =>
    runDiscovery(id, network.id, network.cidr, ips, scanType, nmapArgs, snmpCommunity, network.dns_server ?? null, options);

  const backgroundTask = tenantCode
    ? withTenant(tenantCode, runInBackground)
    : runInBackground();

  backgroundTask.catch(
    (error) => {
      const msg = error instanceof Error ? error.message : "Errore sconosciuto";
      const stack = error instanceof Error ? error.stack : "";
      console.error(`[Discovery] Fatal error (tenant: ${tenantCode ?? "DEFAULT"}, network: ${networkId}):`, msg, stack);
      const p = getProgressMap().get(id);
      if (p) {
        p.status = "failed";
        p.error = msg;
        p.logs = [...(p.logs ?? []), `[ERRORE] ${msg}`];
      }
      // v0.2.634 audit B9: anche le scan in stato `failed` devono uscire dalla
      // progressMap dopo 5 min, come quelle `completed`. Senza questo cleanup
      // la mappa cresce indefinitamente con ogni scan fallita (memory slow leak).
      setTimeout(() => getProgressMap().delete(id), 300_000);
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
  const tenantInBackground = getCurrentTenantCode();
  console.info(`[Discovery] runDiscovery started — tenant context: ${tenantInBackground ?? "NONE (fallback to DEFAULT)"}, network: ${networkId}, scanType: ${scanType}`);

  /* ─── Executor dispatch (Phase 3.5) ──────────────────────────────────────
   * Risolve l'Executor del tenant corrente: LocalExecutor per tenant local
   * (comportamento pre-Phase 3.5 invariato), RemoteExecutor per tenant con
   * agent configurato. Gli alias `pingSweep`, `nmapDiscoverHosts`,
   * `nmapPortScan` shadowano gli import top-level: tutti i call site
   * sottostanti li usano automaticamente senza modifiche.
   *
   * Se getExecutor fallisce (tenant remote senza hostname/token), facciamo
   * fallback al LOCAL per non spaccare l'utente: la scansione girerà
   * sull'hub e troverà nulla (visibile in UI), ma il job non crasha.
   */
  let _exec: Executor | null = null;
  if (tenantInBackground) {
    try {
      _exec = getExecutor(tenantInBackground);
      console.info(`[Discovery] Executor mode: ${_exec.mode}`);
    } catch (e) {
      console.warn(`[Discovery] getExecutor("${tenantInBackground}") fallito — fallback local: ${(e as Error).message}`);
      _exec = null;
    }
  }
  const pingSweep = _exec
    ? (ips: string[], concurrency: number = 50, onProgress?: (scanned: number, found: number) => void) =>
        _exec!.pingSweep(ips, concurrency, onProgress ? { onProgress } : undefined)
    : _localPingSweep;
  const nmapDiscoverHosts = _exec
    ? (target: string, timeoutMs?: number) => _exec!.nmapDiscoverHosts(target, timeoutMs)
    : _localNmapDiscoverHosts;
  const nmapPortScan = _exec
    ? (
        ip: string,
        customArgs?: string,
        timeoutMs?: number,
        opts?: { skipUdp?: boolean; onLog?: (msg: string) => void; udpPorts?: string | null },
      ) =>
        _exec!.nmapPortScan(
          ip,
          { customArgs, timeoutMs, skipUdp: opts?.skipUdp, udpPorts: opts?.udpPorts },
          opts?.onLog ? { onLog: opts.onLog } : undefined,
        )
    : _localNmapPortScan;
  // Per executor remoto saltiamo il check locale di nmap (sul hub nmap può
  // mancare): ci fidiamo dell'agente. Per executor locale usiamo il check
  // originale (subprocess `nmap --version`).
  const isNmapAvailable: () => Promise<boolean> = _exec && _exec.mode === "remote"
    ? async () => true
    : _localIsNmapAvailable;

  const startTime = Date.now();
  const progressRef = getProgressMap().get(scanId);
  if (!progressRef) throw new Error(`Scan progress not found for ${scanId}`);
  const progress = progressRef; // TypeScript: guaranteed non-undefined after throw

  let onlineIps: string[] = [];
  const nmapResults: Map<string, HostScanData> = new Map();
  /** Porte TCP da pre-pass naabu (per host), usate in classify + Nmap mirato. */
  let naabuPortsByIp: Map<string, number[]> = new Map();

  /**
   * Pre-pass Naabu.
   * - Default: solo se setting `port_discovery=naabu+nmap` (fail-soft → Nmap-only).
   * - `require: true` (scan_naabu): ignora il setting; se binario assente → disabled
   *   (il caller annulla lo scan). Map vuota dopo run riuscito = zero porte aperte,
   *   comunque `enabled: true` così Nmap usa union(always-useful, basePorts).
   */
  async function prepareNaabuPortDiscovery(
    hosts: string[],
    portsSpec: string,
    opts?: { require?: boolean }
  ): Promise<{ enabled: boolean; byIp: Map<string, number[]>; basePorts: number[] }> {
    const basePorts = parseTcpPortSpec(portsSpec);
    const disabled = (): { enabled: false; byIp: Map<string, number[]>; basePorts: number[] } => ({
      enabled: false,
      byIp: new Map(),
      basePorts,
    });
    const require = opts?.require === true;
    try {
      const mode = (getSetting("port_discovery") ?? "nmap").trim();
      if (!require && (mode !== "naabu+nmap" || hosts.length === 0 || basePorts.length === 0)) {
        return disabled();
      }
      if (hosts.length === 0 || basePorts.length === 0) {
        return disabled();
      }
      const binPath = (getSetting("naabu_bin_path") ?? "").trim() || undefined;
      const available = await isNaabuAvailable(binPath);
      if (!available) {
        log(
          require
            ? "[naabu] richiesto ma non disponibile — installa naabu o imposta path in Impostazioni → Scansione"
            : "[naabu] unavailable, fallback nmap"
        );
        return disabled();
      }
      progress.phase = `Naabu TCP — ${hosts.length} host`;
      log(`[naabu] ${require ? "scan" : "pre-pass"} TCP su ${hosts.length} host (${basePorts.length} porte)`);
      const byIp = await runNaabuTcpPorts(hosts, {
        binPath,
        ports: tcpPortListToSpec(basePorts),
      });
      let hits = 0;
      for (const ports of byIp.values()) hits += ports.length;
      if (!require && (hits === 0 || byIp.size === 0)) {
        // Optional path: empty result treated as fail → Nmap-only full list
        log("[naabu] unavailable, fallback nmap");
        return disabled();
      }
      log(`[naabu] ${byIp.size} host con porte aperte (${hits} hit)`);
      return { enabled: true, byIp, basePorts };
    } catch {
      log(
        require
          ? "[naabu] errore esecuzione — scan Naabu annullato"
          : "[naabu] unavailable, fallback nmap"
      );
      return disabled();
    }
  }

  function seedNaabuOpenPorts(byIp: Map<string, number[]>): void {
    for (const [ip, ports] of byIp) {
      if (!ports.length) continue;
      const existing = nmapResults.get(ip);
      const merged = [...(existing?.ports ?? [])];
      for (const port of ports) {
        if (!merged.some((p) => p.port === port && p.protocol === "tcp")) {
          merged.push({ port, protocol: "tcp", service: null, version: null });
        }
      }
      nmapResults.set(ip, {
        ...(existing ?? { os: null, mac: null }),
        ports: merged,
        os: existing?.os ?? null,
        mac: existing?.mac ?? null,
      });
    }
  }

  /** Targeted Nmap: union(naabu open, ALWAYS_USEFUL, prior quick/profile list). */
  function tcpArgsForHost(
    ip: string,
    fallbackArgs: string,
    naabuEnabled: boolean,
    byIp: Map<string, number[]>,
    basePorts: number[],
    hostTimeoutSeconds?: number
  ): string {
    if (!naabuEnabled) return fallbackArgs;
    return buildTargetedServiceTcpArgs(
      unionTcpPorts(byIp.get(ip) ?? [], ALWAYS_USEFUL_TCP_PORTS, basePorts),
      hostTimeoutSeconds != null ? { hostTimeoutSeconds } : undefined
    );
  }

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

  // scan_full è un alias semantico di network_discovery (UI: "Scan completo").
  // Mantiene il payload "network_discovery" lato persistenza/storia per non
  // sdoppiare metriche, ma rende esplicito in UI che esegue l'intera sequenza
  // ICMP → Nmap base → SNMP verify → Enrich (ARP/DHCP/AD).
  if (scanType === "scan_full") {
    scanType = "network_discovery";
    progress.scan_type = "network_discovery";
  }

  // ═══════════════════════════════════════════════════════════════
  // SCAN_NAABU: nuovo modo — ICMP (+ TCP second-pass) → Naabu obbligatorio
  // → Nmap -sV mirato sulle porte trovate ∪ profilo. Se naabu manca, stop.
  // ═══════════════════════════════════════════════════════════════
  if (scanType === "scan_naabu") {
    progress.phase = "Ping sweep (ICMP)";
    const results = await pingSweep(ips, 50, (scanned, found) => {
      progress.scanned = scanned;
      progress.found = found;
    });
    onlineIps = results.filter((r) => r.alive).map((r) => r.ip);

    const onlineSet = new Set(onlineIps);
    const dbHosts = getHostsByNetwork(networkId);
    const tcpCandidates = dbHosts
      .filter((h) => h.status === "online" && !onlineSet.has(h.ip))
      .map((h) => h.ip);
    if (tcpCandidates.length > 0) {
      progress.phase = `Second-pass TCP — 0/${tcpCandidates.length}`;
      log(`ICMP miss: ${tcpCandidates.length} host noti online, tento TCP su ${FALLBACK_TCP_PORTS.join("/")}`);
      const TCP_BATCH = 32;
      let recovered = 0;
      let scanned = 0;
      for (let i = 0; i < tcpCandidates.length; i += TCP_BATCH) {
        const batch = tcpCandidates.slice(i, i + TCP_BATCH);
        const probed = await Promise.all(
          batch.map(async (ip) => {
            for (const port of FALLBACK_TCP_PORTS) {
              if (await tcpConnect(ip, port, 2000)) return ip;
            }
            return null;
          })
        );
        for (const ip of probed) {
          scanned++;
          if (ip) {
            onlineIps.push(ip);
            recovered++;
          }
        }
        progress.phase = `Second-pass TCP — ${scanned}/${tcpCandidates.length}`;
      }
      if (recovered > 0) {
        log(`Second-pass TCP: recuperati ${recovered}/${tcpCandidates.length} host`);
      }
    }

    if (onlineIps.length === 0) {
      log("Nessun host raggiungibile — scan Naabu terminato");
    } else {
      const quickPortsSpec = getQuickScanTcpPorts();
      const naabuPrep = await prepareNaabuPortDiscovery(onlineIps, quickPortsSpec, { require: true });
      naabuPortsByIp = naabuPrep.byIp;
      if (!naabuPrep.enabled) {
        progress.status = "failed";
        progress.phase = "Naabu non disponibile";
        progress.error =
          "Naabu non disponibile: installa il binary ProjectDiscovery o configura il path in Impostazioni → Scansione";
        log("Scan Naabu annullato: installa naabu (ProjectDiscovery) e/o configura path in Impostazioni → Scansione");
        setTimeout(() => getProgressMap().delete(scanId), 300_000);
        return {
          network_id: networkId,
          total_ips: ips.length,
          hosts_found: onlineIps.length,
          hosts_online: onlineIps.length,
          hosts_offline: ips.length - onlineIps.length,
          new_hosts: 0,
          duration_ms: Date.now() - startTime,
        };
      }
      seedNaabuOpenPorts(naabuPrep.byIp);

      if (!(await isNmapAvailable())) {
        log("Nmap non disponibile — porte Naabu già acquisite; salto -sV");
      } else {
        const quickArgs = buildNetworkDiscoveryQuickTcpArgs();
        const quickExecMs = getNetworkDiscoveryQuickExecMs();
        const quickBatch = getNetworkDiscoveryQuickConcurrency();
        progress.phase = `Nmap -sV (post-naabu) — 0/${onlineIps.length}`;
        progress.total = onlineIps.length;
        progress.scanned = 0;
        log(`Naabu ok; Nmap -sV mirato su ${onlineIps.length} host (batch ${quickBatch})`);
        for (let i = 0; i < onlineIps.length; i += quickBatch) {
          const batch = onlineIps.slice(i, i + quickBatch);
          const batchResults = await Promise.all(
            batch.map((ip) =>
              nmapPortScan(
                ip,
                tcpArgsForHost(ip, quickArgs, true, naabuPrep.byIp, naabuPrep.basePorts),
                quickExecMs,
                { skipUdp: true, onLog: log }
              )
            )
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
          progress.phase = `Nmap -sV (post-naabu) — ${progress.scanned}/${onlineIps.length}`;
          if (i + quickBatch < onlineIps.length) {
            await new Promise<void>((resolve) => setImmediate(resolve));
          }
        }
      }
      progress.found = onlineIps.length;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // SCAN_ICMP: sotto-fase 1.1 — ICMP sweep + second-pass TCP, persist host
  // online. Niente ARP/DHCP/AD (vivono in scan_enrich), niente nmap, niente
  // SNMP. Additivo: NON marca offline i non rispondenti.
  // ═══════════════════════════════════════════════════════════════
  else if (scanType === "scan_icmp") {
    progress.phase = "Ping sweep (ICMP)";
    const results = await pingSweep(ips, 50, (scanned, found) => {
      progress.scanned = scanned;
      progress.found = found;
    });
    onlineIps = results.filter((r) => r.alive).map((r) => r.ip);
    log(`ICMP: ${onlineIps.length}/${ips.length} host rispondono`);

    // Second-pass TCP per host già online in DB ma silenziosi a ICMP
    const onlineSet = new Set(onlineIps);
    const dbHosts = getHostsByNetwork(networkId);
    const tcpCandidates = dbHosts
      .filter((h) => h.status === "online" && !onlineSet.has(h.ip))
      .map((h) => h.ip);
    if (tcpCandidates.length > 0) {
      progress.phase = `Second-pass TCP — 0/${tcpCandidates.length}`;
      log(`Second-pass TCP su ${tcpCandidates.length} host noti come online`);
      const TCP_BATCH = 32;
      let recovered = 0;
      let scanned = 0;
      for (let i = 0; i < tcpCandidates.length; i += TCP_BATCH) {
        const batch = tcpCandidates.slice(i, i + TCP_BATCH);
        const probed = await Promise.all(
          batch.map(async (ip) => {
            for (const port of FALLBACK_TCP_PORTS) {
              if (await tcpConnect(ip, port, 2000)) return ip;
            }
            return null;
          })
        );
        for (const ip of probed) {
          scanned++;
          if (ip) {
            onlineIps.push(ip);
            recovered++;
          }
        }
        progress.phase = `Second-pass TCP — ${scanned}/${tcpCandidates.length}`;
      }
      log(`Second-pass TCP: recuperati ${recovered}/${tcpCandidates.length} host`);
    }

    // Persist additivo
    for (const ip of onlineIps) {
      try {
        upsertHost({
          network_id: networkId,
          ip,
          status: "online",
          hostname_source: "scan",
          bypassExclusion: true,
        });
      } catch { /* upsert singolo host non blocca lo sweep */ }
    }

    progress.status = "completed";
    progress.phase = `ICMP completato (${onlineIps.length} online)`;
    progress.scanned = ips.length;
    progress.found = onlineIps.length;
    console.info(`[Discovery] scan_icmp completato: ${onlineIps.length}/${ips.length} online, ${Date.now() - startTime}ms`);
    setTimeout(() => getProgressMap().delete(scanId), 300000);
    return {
      network_id: networkId,
      total_ips: ips.length,
      hosts_found: onlineIps.length,
      hosts_online: onlineIps.length,
      hosts_offline: ips.length - onlineIps.length,
      new_hosts: 0,
      duration_ms: Date.now() - startTime,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // SCAN_NMAP_BASE: sotto-fase 1.2 — nmap quick TCP sugli host già online
  // in DB (no ping iniziale). Popola nmapResults; il post-processing comune
  // qui sotto si occupa di DNS/vendor/fingerprint/classify/persist.
  // Additivo: NON marca offline i non rispondenti.
  // ═══════════════════════════════════════════════════════════════
  if (scanType === "scan_nmap_base") {
    const inScopeNm = new Set(ips);
    const existingHosts = getHostsByNetwork(networkId);
    const targetIps = existingHosts
      .filter((h) => h.status === "online" && inScopeNm.has(h.ip))
      .map((h) => h.ip);
    onlineIps = targetIps;

    if (targetIps.length === 0) {
      log("Nessun host online in DB su cui eseguire Nmap base. Esegui prima ICMP o Scan completo.");
    } else if (!(await isNmapAvailable())) {
      log("Nmap non disponibile sul sistema/agent — scan annullato");
    } else {
      const quickPortsSpec = getQuickScanTcpPorts();
      const naabuPrep = await prepareNaabuPortDiscovery(targetIps, quickPortsSpec);
      naabuPortsByIp = naabuPrep.byIp;
      if (naabuPrep.enabled) seedNaabuOpenPorts(naabuPrep.byIp);

      const quickArgs = buildNetworkDiscoveryQuickTcpArgs();
      const quickExecMs = getNetworkDiscoveryQuickExecMs();
      const quickBatch = getNetworkDiscoveryQuickConcurrency();
      progress.phase = `Nmap quick TCP — 0/${targetIps.length}`;
      progress.total = targetIps.length;
      log(
        naabuPrep.enabled
          ? `Nmap -sV mirato (post-naabu) su ${targetIps.length} host (batch ${quickBatch})`
          : `Nmap base su ${targetIps.length} host (batch ${quickBatch}, ~${Math.ceil(quickExecMs / 1000)}s max/host)`
      );

      for (let i = 0; i < targetIps.length; i += quickBatch) {
        const batch = targetIps.slice(i, i + quickBatch);
        const batchResults = await Promise.all(
          batch.map((ip) =>
            nmapPortScan(
              ip,
              tcpArgsForHost(ip, quickArgs, naabuPrep.enabled, naabuPrep.byIp, naabuPrep.basePorts),
              quickExecMs,
              { skipUdp: true, onLog: log }
            )
          )
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
        progress.scanned = Math.min(i + quickBatch, targetIps.length);
        progress.phase = `Nmap quick TCP — ${progress.scanned}/${targetIps.length}`;
      }
      progress.found = onlineIps.length;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // SCAN_SNMP_VERIFY: sotto-fase 1.3 — SNMP sysObjectID probe sugli host
  // online del DB + SNMP-only discovery sugli IP non rispondenti. Popola
  // nmapResults; il post-processing comune persiste e classifica.
  // Additivo: NON marca offline.
  // ═══════════════════════════════════════════════════════════════
  else if (scanType === "scan_snmp_verify") {
    const inScopeSn = new Set(ips);
    const existingHosts = getHostsByNetwork(networkId);
    const onlineDbIps = existingHosts
      .filter((h) => h.status === "online" && inScopeSn.has(h.ip))
      .map((h) => h.ip);
    const offlineDbIps = ips.filter((ip) => !onlineDbIps.includes(ip));

    const communities = buildSnmpCommunitiesForHost(networkId, null, snmpCommunity ?? null);
    log(`SNMP verify — community: ${communities.slice(0, 3).join(", ")}${communities.length > 3 ? "…" : ""}`);

    // Probe sysObjectID su host online DB
    if (onlineDbIps.length > 0) {
      progress.phase = `SNMP sysObjectID — 0/${onlineDbIps.length}`;
      progress.total = onlineDbIps.length;
      const SNMP_BATCH = 24;
      for (let si = 0; si < onlineDbIps.length; si += SNMP_BATCH) {
        const batch = onlineDbIps.slice(si, si + SNMP_BATCH);
        const batchResults = await Promise.all(
          batch.map(async (ip) => {
            try {
              const r = await querySnmpInfoMultiCommunity(ip, communities, 161, { onLog: log });
              if (r.sysName || r.sysDescr || r.sysObjectID) {
                return { ip, ...r };
              }
            } catch { /* ignore */ }
            return null;
          })
        );
        for (const r of batchResults) {
          if (!r) continue;
          if (!onlineIps.includes(r.ip)) onlineIps.push(r.ip);
          const parsedSnmp = parseModelFromSysDescr(r.sysDescr ?? null);
          nmapResults.set(r.ip, {
            ports: [{ port: 161, protocol: "udp", service: "snmp", version: null }],
            os: null,
            mac: null,
            snmpHostname: r.sysName ?? null,
            snmpSysDescr: r.sysDescr ?? null,
            snmpSysObjectID: r.sysObjectID ?? null,
            snmpSerial: r.serialNumber ?? null,
            snmpModel: r.model ?? null,
            snmpIfDescrSummary: r.ifDescrSummary ?? null,
            snmpHostResourcesSummary: r.hostResourcesSummary ?? null,
            snmpFingerprintOidMatches: r.fingerprintOidMatches ?? null,
            snmpFirmware: parsedSnmp.firmware ?? null,
          });
          log(`✓ ${r.ip} → ${r.sysName || "—"} (${r.sysDescr?.slice(0, 50) || "—"})`);
        }
        progress.scanned = Math.min(si + SNMP_BATCH, onlineDbIps.length);
        progress.phase = `SNMP sysObjectID — ${progress.scanned}/${onlineDbIps.length}`;
      }
    }

    // SNMP-only discovery sugli IP non rispondenti (solo se community custom)
    const hasCustomCommunity = communities.some((c) => c !== "public" && c !== "private");
    if (hasCustomCommunity && offlineDbIps.length > 0 && offlineDbIps.length <= 512) {
      const { snmpGet } = await import("./snmp-query");
      progress.phase = `SNMP discovery (no-ICMP) — 0/${offlineDbIps.length}`;
      let discovered = 0;
      const SNMP_PROBE_BATCH = 32;
      for (let si = 0; si < offlineDbIps.length; si += SNMP_PROBE_BATCH) {
        const batch = offlineDbIps.slice(si, si + SNMP_PROBE_BATCH);
        const batchResults = await Promise.all(
          batch.map(async (ip) => {
            try {
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
                  return { ip, sysObjectID, sysName, sysDescr };
                }
              }
            } catch { /* ignore */ }
            return null;
          })
        );
        for (const r of batchResults) {
          if (!r) continue;
          discovered++;
          if (!onlineIps.includes(r.ip)) onlineIps.push(r.ip);
          nmapResults.set(r.ip, {
            ports: [{ port: 161, protocol: "udp", service: "snmp", version: null }],
            os: null,
            mac: null,
            snmpHostname: r.sysName,
            snmpSysDescr: r.sysDescr,
            snmpSysObjectID: r.sysObjectID,
          });
          log(`✓ SNMP-only ${r.ip} → ${r.sysName || "—"} (${r.sysObjectID || "—"})`);
        }
        progress.scanned = Math.min(si + SNMP_PROBE_BATCH, offlineDbIps.length);
        progress.phase = `SNMP discovery (no-ICMP) — ${progress.scanned}/${offlineDbIps.length}`;
      }
      log(`SNMP no-ICMP: ${discovered} device scoperti`);
    }
    progress.found = onlineIps.length;
  }

  // ═══════════════════════════════════════════════════════════════
  // PING: solo ICMP sweep — veloce, nessun SNMP/nmap
  // ═══════════════════════════════════════════════════════════════
  else if (scanType === "ping") {
    progress.phase = "Ping sweep";
    const results = await pingSweep(ips, 50, (scanned, found) => {
      progress.scanned = scanned;
      progress.found = found;
    });
    onlineIps = results.filter((r) => r.alive).map((r) => r.ip);
  }

  // ═══════════════════════════════════════════════════════════════
  // FAST: presenza rapida — nmap -sn sull'intero CIDR (fallback ping sweep ad
  // alta concorrenza) + ARP/DHCP dal router associato. Nessun port scan, niente
  // fingerprint, niente SNMP per-host. Additiva: NON marca offline i non
  // rispondenti (è una fotografia di presenza, non autoritativa).
  // ═══════════════════════════════════════════════════════════════
  else if (scanType === "fast") {
    progress.phase = "Sweep rapido (nmap -sn)";
    let nmapOk = false;
    try {
      if (await isNmapAvailable()) {
        const aliveResults = await nmapDiscoverHosts(cidr, 180000);
        const upHosts = aliveResults.filter((r) => r.alive);
        onlineIps = upHosts.map((r) => r.ip);
        // Persiste TUTTI gli host vivi (con o senza MAC). Cross-subnet nmap non
        // ottiene MAC perché ARP scan è limitato alla stessa L2: senza questo
        // upsert gli host risponderebbero a ICMP ma non finirebbero in DB.
        for (const r of upHosts) {
          try {
            upsertHost({
              network_id: networkId,
              ip: r.ip,
              mac: r.mac ?? undefined,
              status: "online",
              hostname_source: "scan",
              // ICMP/nmap ha confermato il device vivo: nuovo device legittimo
              // anche se l'IP era stato escluso (tombstone) in passato.
              bypassExclusion: true,
            });
          } catch { /* upsert singolo host non blocca lo sweep */ }
        }
        progress.scanned = ips.length;
        progress.found = onlineIps.length;
        nmapOk = true;
        log(`nmap -sn: ${onlineIps.length} host vivi su ${ips.length} IP del CIDR`);
      }
    } catch (e) {
      log(`nmap -sn fallito (${e instanceof Error ? e.message : "errore"}): fallback ping sweep…`);
    }
    if (!nmapOk) {
      progress.phase = "Ping sweep (fallback)";
      const results = await pingSweep(ips, 128, (scanned, found) => {
        progress.scanned = scanned;
        progress.found = found;
      });
      onlineIps = results.filter((r) => r.alive).map((r) => r.ip);
      log(`ping sweep: ${onlineIps.length}/${ips.length} host vivi`);
    }
    // Second-pass TCP per host già visti online ma silenziosi a ICMP/nmap-sn.
    // Stessa logica di network_discovery: previene falsi offline per device
    // che bloccano ICMP (Windows firewall, stampanti, IoT) ma rispondono su
    // porte TCP comuni.
    {
      const onlineSet = new Set(onlineIps);
      const dbHosts = getHostsByNetwork(networkId);
      const tcpCandidates = dbHosts
        .filter((h) => h.status === "online" && !onlineSet.has(h.ip))
        .map((h) => h.ip);
      if (tcpCandidates.length > 0) {
        progress.phase = `Second-pass TCP — 0/${tcpCandidates.length}`;
        log(`fast: ${tcpCandidates.length} host già online non rilevati, tento TCP su ${FALLBACK_TCP_PORTS.join("/")}`);
        const TCP_BATCH = 32;
        let recovered = 0;
        let scanned = 0;
        for (let i = 0; i < tcpCandidates.length; i += TCP_BATCH) {
          const batch = tcpCandidates.slice(i, i + TCP_BATCH);
          const probed = await Promise.all(
            batch.map(async (ip) => {
              for (const port of FALLBACK_TCP_PORTS) {
                if (await tcpConnect(ip, port, 2000)) return ip;
              }
              return null;
            })
          );
          for (const ip of probed) {
            scanned++;
            if (ip) {
              onlineIps.push(ip);
              recovered++;
            }
          }
          progress.phase = `Second-pass TCP — ${scanned}/${tcpCandidates.length}`;
        }
        log(`Second-pass TCP: recuperati ${recovered}/${tcpCandidates.length} host (silenziosi a ICMP, attivi su TCP)`);
      }
    }

    // ARP + DHCP dal router associato (se configurato): poll completo per
    // arricchire MAC/vendor/hostname. Dopo v0.2.492 NON tocca più lo status
    // degli host esistenti (vedi nota in cron/jobs.ts arp_poll), quindi è
    // sicuro chiamarlo prima del flip offline.
    progress.phase = "ARP/DHCP dal router…";
    try {
      const { runArpPoll } = await import("@/lib/cron/jobs");
      const arpResult = await runArpPoll(networkId);
      if (arpResult.error) {
        log(`ARP/DHCP router: ${arpResult.error}`);
      } else {
        log(`ARP/DHCP router: ${arpResult.phase ?? "completato"}`);
      }
    } catch (arpErr) {
      log(`ARP/DHCP router: ${arpErr instanceof Error ? arpErr.message : "errore"}`);
    }
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

    // Second-pass TCP per host già visti come online ma silenziosi a ICMP.
    // Molti device (Windows con firewall default, stampanti, IoT) bloccano ICMP
    // ma rispondono su porte TCP comuni; senza questo recupero finiscono nella
    // colonna "non rispondenti" e l'utente li vede sparire dalla rete.
    const onlineSet = new Set(onlineIps);
    const dbHosts = getHostsByNetwork(networkId);
    const tcpCandidates = dbHosts
      .filter((h) => h.status === "online" && !onlineSet.has(h.ip))
      .map((h) => h.ip);
    if (tcpCandidates.length > 0) {
      progress.phase = `Second-pass TCP — 0/${tcpCandidates.length}`;
      log(`ICMP miss: ${tcpCandidates.length} host noti come online non hanno risposto, tento TCP su ${FALLBACK_TCP_PORTS.join("/")}`);
      const TCP_BATCH = 32;
      let recovered = 0;
      let scanned = 0;
      for (let i = 0; i < tcpCandidates.length; i += TCP_BATCH) {
        const batch = tcpCandidates.slice(i, i + TCP_BATCH);
        const probed = await Promise.all(
          batch.map(async (ip) => {
            for (const port of FALLBACK_TCP_PORTS) {
              if (await tcpConnect(ip, port, 2000)) return ip;
            }
            return null;
          })
        );
        for (const ip of probed) {
          scanned++;
          if (ip) {
            onlineIps.push(ip);
            recovered++;
          }
        }
        progress.phase = `Second-pass TCP — ${scanned}/${tcpCandidates.length}`;
      }
      if (recovered > 0) {
        log(`Second-pass TCP: recuperati ${recovered}/${tcpCandidates.length} host (silenziosi a ICMP, attivi su TCP)`);
      } else {
        log(`Second-pass TCP: nessun recupero (${tcpCandidates.length} host davvero offline o porte TCP filtrate)`);
      }
    }

    const nmapAvailable = await isNmapAvailable();
    const quickPortsSpecNd = getQuickScanTcpPorts();
    const naabuPrepNd = await prepareNaabuPortDiscovery(onlineIps, quickPortsSpecNd);
    naabuPortsByIp = naabuPrepNd.byIp;
    if (naabuPrepNd.enabled) seedNaabuOpenPorts(naabuPrepNd.byIp);

    const quickArgs = buildNetworkDiscoveryQuickTcpArgs();
    const quickExecMs = getNetworkDiscoveryQuickExecMs();
    const quickBatch = getNetworkDiscoveryQuickConcurrency();

    if (nmapAvailable && onlineIps.length > 0) {
      progress.phase = `Nmap quick TCP — 0/${onlineIps.length}`;
      progress.total = onlineIps.length;
      progress.scanned = 0;
      log(
        naabuPrepNd.enabled
          ? `ICMP: ${onlineIps.length} host; Nmap -sV mirato post-naabu (batch ${quickBatch})`
          : `ICMP: ${onlineIps.length} host rispondenti; Nmap TCP (batch ${quickBatch}, ~${Math.ceil(quickExecMs / 1000)}s max/host)`
      );
      for (let i = 0; i < onlineIps.length; i += quickBatch) {
        const batch = onlineIps.slice(i, i + quickBatch);
        const batchResults = await Promise.all(
          batch.map((ip) =>
            nmapPortScan(
              ip,
              tcpArgsForHost(ip, quickArgs, naabuPrepNd.enabled, naabuPrepNd.byIp, naabuPrepNd.basePorts),
              quickExecMs,
              { skipUdp: true }
            )
          )
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
      log("⚠️ nmap NON installato sul server: port scan TCP SALTATO — nessuna porta verrà rilevata (solo host via ICMP). Installare con: sudo apt-get install -y nmap");
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
          // v0.2.644 audit perf SC1: probe leggero (solo sysGroup GET, no walk).
          // Prima `querySnmpInfoMultiCommunity` faceva FASE 1 + FASE 2 ENTITY-MIB
          // + FASE 3 walks + testFingerprintOids (5-15s/host) — e poi la stessa
          // pipeline veniva ripetuta nella "sessione unificata" successiva.
          // Ora ~200ms/host per la sola identificazione vendor via sysObjectID;
          // il walk completo resta una sola volta nel blocco unificato (riga ~1720).
          const batchResults = await Promise.all(
            batch.map(async (ip) => {
              try {
                const r = await querySnmpSysGroupMultiCommunity(ip, communities, 161);
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
    // Anti-lockout (fix Critical post-review, §7.5): questo loop provava OGNI
    // credenziale in catena su OGNI host Windows senza consultare backoff né
    // budget di run — una credenziale di dominio con password sbagliata su 20
    // host Windows = fino a 20 logon falliti dello stesso account in pochi
    // minuti (rischio lockout AD). Riusa `CredentialRunBudget` (stessa logica
    // di `credential_validate`, non duplicata).
    const runBudget = new CredentialRunBudget(log);
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
      const nowIso = new Date().toISOString();
      // hasWindowsIndicator sempre true qui: `windowsHosts` è già filtrato per
      // porte SMB/WinRM (445/135/5985/5986) — vedi definizione sopra.
      const resolved = resolveCredentialsFor({ hostId: host.id, ip, networkId }, "winrm", { includeBackoff: true });
      let ok = false;
      for (const credId of chain) {
        const backoffUntil = resolved.find(
          (r) => r.credential_id === credId && r.protocol === "winrm" && r.port === winrmPort
        )?.backoff_until ?? null;
        if (!runBudget.gate({ ip, credId, credType: "windows", hasWindowsIndicator: true, backoffUntil, nowIso })) continue;
        const creds = getCredentialLoginPair(credId, "windows");
        if (!creds) {
          log(`✗ ${ip} cred#${credId} — dati mancanti`);
          continue;
        }
        try {
          const hostname = await runWinrmCommand(ip, winrmPort, creds.username, creds.password, "hostname", false, adRealm);
          const hn = String(hostname ?? "").trim();
          // Hostname valido: solo lettere/cifre/-/. fino a 254 char. Defense in
          // depth contro stderr filtrato come stdout (es. "bad command name
          // hostname (line 1 column 1)" da PowerShell ConstrainedLanguage).
          const isValidHostname = hn.length > 0 && hn.length < 255 && /^[A-Za-z0-9][A-Za-z0-9.-]*$/.test(hn);
          if (isValidHostname) {
            nmapResults.set(ip, {
              ports: [{ port: winrmPort, protocol: "tcp", service: winrmPort === 5986 ? "winrm-https" : "winrm", version: null }],
              os: "Microsoft Windows",
              mac: null,
              snmpHostname: hn,
            });
            setHostDetectCredential(host.id, "windows", credId);
            addHostCredential(host.id, credId, "winrm", winrmPort, { validated: true, auto_detected: true });
            recordCredentialSuccess(host.id, credId, "winrm", winrmPort);
            runBudget.recordSuccess(credId);
            autoBindCredentialToDevice(ip, credId, "winrm", winrmPort, host.id);
            log(`✓ ${ip} → ${hn} (cred#${credId}, porta ${winrmPort})`);
            ok = true;
            break;
          }
          const failMsg = hn ? `output non valido come hostname: "${hn.slice(0, 200)}"` : "risposta vuota da WinRM (hostname)";
          recordCredentialFailure(host.id, credId, "winrm", winrmPort, failMsg);
          runBudget.recordFailure(credId);
          if (hn) {
            log(`✗ ${ip} cred#${credId} — output non valido come hostname: "${hn.slice(0, 60)}"`);
          } else {
            log(`✗ ${ip} cred#${credId} — risposta vuota`);
          }
        } catch (e) {
          const msg = (e as Error).message ?? String(e);
          recordCredentialFailure(host.id, credId, "winrm", winrmPort, msg.slice(0, 500));
          runBudget.recordFailure(credId);
          log(`✗ ${ip} cred#${credId}: ${msg.slice(0, 72)}`);
        }
      }
      if (!ok) log(`✗ ${ip} — nessuna credenziale valida`);
      progress.scanned = i + 1;
      progress.found = nmapResults.size;
      progress.phase = `Scansione WinRM — ${i + 1}/${onlineIps.length}`;
    }
    runBudget.logSummary();
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

    const { sshExec: transportSshExec, SshError } = await import("@/lib/devices/ssh-transport");

    // Anti-lockout (fix Critical post-review, §7.5): stesso motivo del loop
    // Windows sopra — riusa `CredentialRunBudget`, non duplica la logica.
    const runBudget = new CredentialRunBudget(log);
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
      const nowIso = new Date().toISOString();
      const resolved = resolveCredentialsFor({ hostId: host.id, ip, networkId }, "ssh", { includeBackoff: true });
      let ok = false;
      for (const credId of chain) {
        const backoffUntil = resolved.find(
          (r) => r.credential_id === credId && r.protocol === "ssh" && r.port === 22
        )?.backoff_until ?? null;
        // credType "ssh" letterale: irrilevante se in catena c'è un cred "linux",
        // il gate distingue solo credType==="windows" (nessuna catena SSH può
        // contenerne uno — resolveCredentialsFor filtra per protocollo).
        if (!runBudget.gate({ ip, credId, credType: "ssh", hasWindowsIndicator: false, backoffUntil, nowIso })) continue;
        const creds = getSshLinuxCredentialPair(credId);
        if (!creds) {
          log(`✗ ${ip} cred#${credId} — dati mancanti`);
          continue;
        }
        log(`SSH ${ip} — prova cred#${credId}`);
        try {
          const res = await transportSshExec(
            { host: ip, port: 22, username: creds.username, password: creds.password, timeout: 6000 },
            "hostname -f 2>/dev/null || hostname; uname -sr 2>/dev/null; cat /etc/os-release 2>/dev/null | head -5"
          );
          const output = res.stdout + res.stderr;
          const lines = output.trim().split("\n");
          const rawHn = lines[0]?.trim() || "";
          // Stessa difesa di WinRM: l'output di `hostname` su shell restricted
          // (rbash) o container minimi può ritornare errori o stringhe lunghe.
          const isValidHostname = rawHn.length > 0 && rawHn.length < 255 && /^[A-Za-z0-9][A-Za-z0-9.-]*$/.test(rawHn);
          const hn = isValidHostname ? rawHn : null;
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
          recordCredentialSuccess(host.id, credId, "ssh", 22);
          runBudget.recordSuccess(credId);
          autoBindCredentialToDevice(ip, credId, "ssh", 22, host.id);
          if (boundSshForSave == null) {
            setHostDetectCredential(host.id, "ssh", credId);
          }
          log(`✓ ${ip} → ${hn || "—"}, OS: ${osInfo} (cred#${credId})`);
          ok = true;
          break;
        } catch (sshErr) {
          const msg = sshErr instanceof SshError
            ? `[${sshErr.kind}] ${sshErr.message}`
            : (sshErr as Error).message ?? String(sshErr);
          recordCredentialFailure(host.id, credId, "ssh", 22, msg.slice(0, 500));
          runBudget.recordFailure(credId);
          log(`✗ ${ip} cred#${credId}: ${msg.slice(0, 160)}`);
        }
      }
      if (!ok) log(`✗ ${ip} — nessuna credenziale valida`);
      progress.scanned = i + 1;
      progress.found = nmapResults.size;
      progress.phase = `Scansione SSH — ${i + 1}/${onlineIps.length}`;
    }
    runBudget.logSummary();
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

    // Fase 2: Nmap quick TCP (opzionale pre-pass naabu)
    const nmapAvailable = await isNmapAvailable();
    const quickPortsSpecIpam = getQuickScanTcpPorts();
    const naabuPrepIpam = await prepareNaabuPortDiscovery(onlineIps, quickPortsSpecIpam);
    naabuPortsByIp = naabuPrepIpam.byIp;
    if (naabuPrepIpam.enabled) seedNaabuOpenPorts(naabuPrepIpam.byIp);

    const quickArgs = buildNetworkDiscoveryQuickTcpArgs();
    const quickExecMs = getNetworkDiscoveryQuickExecMs();
    const quickBatch = getNetworkDiscoveryQuickConcurrency();

    if (nmapAvailable && onlineIps.length > 0) {
      progress.phase = `IPAM [2/4] Nmap quick — 0/${onlineIps.length}`;
      progress.total = onlineIps.length;
      progress.scanned = 0;
      log(
        naabuPrepIpam.enabled
          ? `Fase 2: Nmap -sV mirato post-naabu (batch ${quickBatch})`
          : `Fase 2: Nmap TCP quick (batch ${quickBatch}, ~${Math.ceil(quickExecMs / 1000)}s max/host)`
      );
      for (let i = 0; i < onlineIps.length; i += quickBatch) {
        const batch = onlineIps.slice(i, i + quickBatch);
        const batchResults = await Promise.all(
          batch.map((ip) =>
            nmapPortScan(
              ip,
              tcpArgsForHost(ip, quickArgs, naabuPrepIpam.enabled, naabuPrepIpam.byIp, naabuPrepIpam.basePorts),
              quickExecMs,
              { skipUdp: true }
            )
          )
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
      log("⚠️ nmap NON installato sul server: fase TCP SALTATA — nessuna porta verrà rilevata. Installare con: sudo apt-get install -y nmap");
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
      const { sshExec: transportSshExec, SshError } = await import("@/lib/devices/ssh-transport");

      // Anti-lockout (fix Critical post-review, §7.5): stesso motivo dei loop
      // windows/ssh sopra — riusa `CredentialRunBudget`, non duplica la logica.
      const runBudget = new CredentialRunBudget(log);
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

        const nowIso = new Date().toISOString();
        const resolved = resolveCredentialsFor({ hostId, ip, networkId }, "ssh", { includeBackoff: true });
        let ok = false;
        for (const credId of chain) {
          const backoffUntil = resolved.find(
            (r) => r.credential_id === credId && r.protocol === "ssh" && r.port === 22
          )?.backoff_until ?? null;
          if (!runBudget.gate({ ip, credId, credType: "ssh", hasWindowsIndicator: false, backoffUntil, nowIso })) continue;
          const creds = getSshLinuxCredentialPair(credId);
          if (!creds) continue;
          try {
            const res = await transportSshExec(
              { host: ip, port: 22, username: creds.username, password: creds.password, timeout: 8000 },
              "hostname -f 2>/dev/null || hostname; uname -sr 2>/dev/null; cat /etc/os-release 2>/dev/null | head -5"
            );
            const output = res.stdout + res.stderr;

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
              recordCredentialSuccess(hostId, credId, "ssh", 22);
              if (boundSsh == null) {
                setHostDetectCredential(hostId, "ssh", credId);
              }
            }
            runBudget.recordSuccess(credId);
            autoBindCredentialToDevice(ip, credId, "ssh", 22, hostId);
            log(`SSH ✓ ${ip} → ${hn || "—"}, OS: ${osInfo}`);
            ok = true;
            break;
          } catch (sshErr) {
            const msg = sshErr instanceof SshError
              ? `[${sshErr.kind}] ${sshErr.message}`
              : (sshErr as Error).message ?? String(sshErr);
            if (hostId != null) recordCredentialFailure(hostId, credId, "ssh", 22, msg.slice(0, 500));
            runBudget.recordFailure(credId);
            log(`SSH ✗ ${ip} cred#${credId}: ${msg.slice(0, 160)}`);
          }
        }
        if (!ok) log(`SSH ✗ ${ip} — nessuna credenziale valida`);
        progress.scanned = i + 1;
        progress.found = nmapResults.size;
        progress.phase = `IPAM [4/4] SSH — ${i + 1}/${sshHosts.length}`;
      }
      runBudget.logSummary();
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
      const fullPortsSpec = tcpPortListToSpec(getFullScanTcpPortList(discoverOpts?.tcpPorts));
      const naabuPrepNmap = await prepareNaabuPortDiscovery(onlineIps, fullPortsSpec);
      naabuPortsByIp = naabuPrepNmap.byIp;
      if (naabuPrepNmap.enabled) seedNaabuOpenPorts(naabuPrepNmap.byIp);
      const udpPortsRaw = discoverOpts?.udpPorts;
      /** `""` = nessuna scansione UDP (solo TCP); `null`/`undefined` = elenco UDP predefinito (profilo legacy). */
      const skipUdpPhase = udpPortsRaw === "";
      const udpPortsArg = skipUdpPhase ? null : (udpPortsRaw ?? null);
      /** TCP + UDP in sequenza: host-timeout + margine avvio/chiusura; tetto 180s. */
      const htSec = getNmapHostTimeoutSeconds();
      const htMs = htSec * 1000;
      const nmapPortExecTimeoutMs = Math.min(180_000, htMs + 20_000);
      log(
        naabuPrepNmap.enabled
          ? `Nmap TCP mirato post-naabu (union naabu + always-useful + profilo); base: ${portScanArgs}`
          : `Profilo Nmap TCP: ${portScanArgs}`
      );
      if (skipUdpPhase) log("UDP: disattivato (nessuna porta UDP nel profilo)");
      else if (udpPortsArg) log(`Porte UDP profilo: ${udpPortsArg}`);
      else log("UDP: elenco predefinito applicazione (profilo senza elenco UDP)");
      /** v0.2.643 audit perf SC5: default 4→8, cap 8→12. Combinato con
       *  --max-retries 1 + --min-rate 200 lo scan profondo ~2-3× più veloce
       *  senza degrado rilevante. Override: DA_INVENT_NMAP_PORT_SCAN_CONCURRENCY */
      const BATCH_SIZE = Math.min(
        12,
        Math.max(1, parseInt(process.env.DA_INVENT_NMAP_PORT_SCAN_CONCURRENCY || "8", 10))
      );
      if (BATCH_SIZE < 4) log(`Nmap port scan: concorrenza ${BATCH_SIZE} host (consigliato per reti con hypervisor / TLS)`);
      for (let i = 0; i < onlineIps.length; i += BATCH_SIZE) {
        const batch = onlineIps.slice(i, i + BATCH_SIZE);
        const batchResults = await Promise.all(
          batch.map((ip) =>
            nmapPortScan(
              ip,
              tcpArgsForHost(
                ip,
                portScanArgs,
                naabuPrepNmap.enabled,
                naabuPrepNmap.byIp,
                naabuPrepNmap.basePorts,
                htSec
              ),
              nmapPortExecTimeoutMs,
              {
                onLog: log,
                udpPorts: udpPortsArg,
                skipUdp: skipUdpPhase,
              }
            )
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
    const { sshExec: transportSshExec, SshError } = await import("@/lib/devices/ssh-transport");
    const { runWinrmCommand, WinrmError } = await import("@/lib/devices/winrm-run");

    // Codici WinRM che indicano un servizio RAGGIUNTO (auth/negoziazione fallita),
    // a differenza di TCP_CLOSED/TCP_TIMEOUT/PYWINRM_MISSING/BRIDGE_TIMEOUT/UNKNOWN
    // che indicano "nessun servizio lì" — distinzione usata dalla regola Task 4
    // "auth rifiutata ma servizio presente" per WinRM.
    const WINRM_SERVICE_PRESENT_CODES = new Set([
      "AUTH_REJECTED", "KERBEROS_FAILED", "KERBEROS_ONLY", "BASIC_DISABLED", "WSMAN_FAULT",
    ]);

    // Anti-lockout fase 1b (§7.5) / fix post-review Critical: budget di RUN per
    // credenziale, indipendente dall'host — dopo MAX_CONSECUTIVE_FAILURES_PER_RUN
    // fallimenti CONSECUTIVI della stessa credenziale in QUESTA esecuzione, la
    // escludiamo dal resto del run (mai troncamento silenzioso). Estratto in
    // `CredentialRunBudget` cosi' i loop detect windows/ssh e ipam_full fase 4
    // riusano la STESSA logica invece di duplicarla.
    const runBudget = new CredentialRunBudget(log);

    /** Esiti di autenticazione → evidenze di attribuzione (Task 4, §7.3). Persiste
     * solo se c'è davvero qualcosa da dire: recordEvidence su array vuoto è un
     * no-op, ma recomputeAttributionSafe rifonderebbe comunque l'host per niente
     * su ogni singolo tentativo fallito — lo evitiamo quando non c'è evidenza. */
    function applyAuthEvidence(hostId: number, outcome: AuthOutcome): void {
      const evidences = evidenceFromAuthOutcome(outcome);
      if (evidences.length === 0) return;
      try {
        recordEvidence(getDb(), hostId, evidences);
        recomputeAttributionSafe(hostId, "scan");
      } catch (e) {
        log(`⚠ evidenza attribuzione non registrata per host ${hostId}: ${(e as Error).message ?? e}`);
      }
    }

    for (let i = 0; i < targetHosts.length; i++) {
      const host = targetHosts[i];
      const ip = host.ip;
      let openPorts: Array<{ port: number; service?: string }> = [];
      try { openPorts = JSON.parse(host.open_ports || "[]"); } catch { /* skip */ }

      progress.phase = `Validazione — ${i + 1}/${targetHosts.length} (${ip})`;

      // Multihomed secondary: mai testare credenziali su un IP secondary di un
      // gruppo (§7.5, stessa policy di dedup di /api/devices/[id]/test — riusa
      // getMultihomedStatus invece di duplicarla). Skip dell'intero host: un
      // secondary non è mai il target giusto per NESSUNA credenziale/protocollo.
      const mh = getMultihomedStatus(host.id);
      if (mh && !mh.is_primary) {
        log(`⏭ ${ip}: host multihomed secondary (primary ${mh.primary_ip}) — credenziali non testate`);
        progress.scanned = i + 1;
        continue;
      }

      // Indicatori Windows: porte SMB/WinRM o classificazione/OS
      const hasWinrmPort = openPorts.some((p) => [5985, 5986].includes(p.port));
      const hasWindowsIndicator = hasWinrmPort
        || openPorts.some((p) => [445, 135].includes(p.port))
        || (host.classification ?? "").includes("windows")
        || (host.classification ?? "") === "workstation"
        || (host.os_info ?? "").toLowerCase().includes("windows");

      const nowIso = new Date().toISOString();
      const resolvedBackoffCache = new Map<CredProtocol, ReturnType<typeof resolveCredentialsFor>>();
      const getResolvedForProtocol = (protocol: CredProtocol): ReturnType<typeof resolveCredentialsFor> => {
        let r = resolvedBackoffCache.get(protocol);
        if (!r) {
          r = resolveCredentialsFor({ hostId: host.id, ip, networkId }, protocol, { includeBackoff: true });
          resolvedBackoffCache.set(protocol, r);
        }
        return r;
      };

      /** Gate anti-lockout unico (Task 3, via `CredentialRunBudget`): backoff
       * persistito (Task 1), divieto esplicito windows-senza-indicatore, budget
       * di run. Il multihomed è già filtrato a livello host sopra, quindi qui è
       * sempre false — passato comunque per tenere `shouldAttemptCredential`
       * come unica fonte di verità.
       *
       * Minor 1 (review): il lookup del backoff confronta anche protocollo e
       * porta effettivamente usata, non solo `credential_id` — una riga di
       * backoff su una porta diversa (es. stessa credenziale provata su 5985 e
       * 5986) non deve essere scambiata per quella della porta corrente. */
      const gateCredential = (protocol: CredProtocol, credId: number, credType: string, port: number): boolean => {
        const resolved = getResolvedForProtocol(protocol).find(
          (r) => r.credential_id === credId && r.protocol === protocol && r.port === port
        );
        return runBudget.gate({
          ip,
          credId,
          credType,
          hasWindowsIndicator,
          backoffUntil: resolved?.backoff_until ?? null,
          nowIso,
        });
      };

      // Protocolli già validati per QUESTO host: una volta trovata la cred giusta
      // per un protocollo, NON provare le altre (fix C2 2026-06-23: senza, ogni
      // credenziale sbagliata era un logon fallito reale su ogni host → lockout AD).
      const validatedProtos = new Set<string>();
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
        if ((credType === "ssh" || credType === "linux") && hasSshIndicator && !validatedProtos.has("ssh")) {
          const sshPort = openPorts.find((p) => p.port === 22 || p.service === "ssh")?.port ?? 22;
          if (!gateCredential("ssh", credId, credType, sshPort)) continue;
          const creds = getSshLinuxCredentialPair(credId);
          if (!creds) continue;
          try {
            await transportSshExec(
              // Timeout 6000→15000 (§7.5): allineato al default del transport, evita
              // falsi negativi (quindi falsi FALLIMENTI persistiti) su link lenti.
              { host: ip, port: sshPort, username: creds.username, password: creds.password, timeout: 15000, credentialName: nc.credential_name },
              "true"
            );
            recordCredentialSuccess(host.id, credId, "ssh", sshPort);
            autoBindCredentialToDevice(ip, credId, "ssh", sshPort, host.id);
            runBudget.recordSuccess(credId);
            log(`✓ ${ip}:${sshPort} SSH cred#${credId} (${nc.credential_name})`);
            validated++;
            validatedProtos.add("ssh");
            // Banner SSH non catturato dal transport attuale (ssh2 espone solo
            // stdout/stderr/errore, non l'identification string) — nessuna nuova
            // evidenza da qui finché ssh-transport.ts non viene esteso (fuori
            // scope qui: già in parte coperto da nmap_os/snmp_sysdescr altrove).
            applyAuthEvidence(host.id, { protocol: "ssh", ok: true, banner: null });
          } catch (e) {
            const msg = e instanceof SshError ? `[${e.kind}] ${e.message}` : (e as Error).message ?? String(e);
            recordCredentialFailure(host.id, credId, "ssh", sshPort, msg.slice(0, 500));
            runBudget.recordFailure(credId);
            log(`✗ ${ip}:${sshPort} SSH cred#${credId}: ${msg.slice(0, 160)}`);
            applyAuthEvidence(host.id, { protocol: "ssh", ok: false, banner: null });
          }
        }

        if (credType === "snmp" && !validatedProtos.has("snmp")) {
          if (!gateCredential("snmp", credId, credType, 161)) continue;

          // Fase 4b Task 2 (§7.1/§7.4): credenziali con security_level
          // impostato (noAuthNoPriv/authNoPriv/authPriv) sono SNMPv3 vero —
          // niente community string, sessione dedicata via createV3Session.
          // Le credenziali v2c legacy (security_level assente/NULL) restano
          // sul percorso community esistente sotto. Stesso gate anti-lockout
          // (`gateCredential` sopra) e stessa persistenza esito di ogni altro
          // protocollo — nessun bypass del budget di run.
          const credRow = getCredentialById(credId);
          if (credRow?.security_level) {
            try {
              const v3 = await snmpValidateV3(ip, credId, { port: 161 });
              if (v3.ok) {
                recordCredentialSuccess(host.id, credId, "snmp", 161);
                autoBindCredentialToDevice(ip, credId, "snmp", 161, host.id);
                runBudget.recordSuccess(credId);
                log(`✓ ${ip}:161 SNMPv3 cred#${credId} (${nc.credential_name})`);
                validated++;
                validatedProtos.add("snmp");
                // Nessuna evidenza aggiuntiva qui: sysObjectID/sysDescr restano
                // emessi da emitEvidenceFromSignals sui dati persistiti (Task 4) —
                // stesso motivo del percorso v2c sotto, snmpValidateV3 fa solo il
                // test di autenticazione, non il fingerprint completo.
              } else {
                const msg = v3.error ?? "autenticazione SNMPv3 non riuscita";
                recordCredentialFailure(host.id, credId, "snmp", 161, msg.slice(0, 500));
                runBudget.recordFailure(credId);
                log(`✗ ${ip}:161 SNMPv3 cred#${credId}: ${msg.slice(0, 160)}`);
              }
            } catch (e) {
              const msg = (e as Error).message ?? String(e);
              recordCredentialFailure(host.id, credId, "snmp", 161, msg.slice(0, 500));
              runBudget.recordFailure(credId);
              log(`✗ ${ip}:161 SNMPv3 cred#${credId}: ${msg.slice(0, 60)}`);
            }
            continue;
          }

          const com = getCredentialCommunityString(credId);
          if (!com) continue;
          try {
            const r = await querySnmpInfoMultiCommunity(ip, [com], 161, { onLog: log });
            if (r.sysName || r.sysDescr || r.sysObjectID) {
              recordCredentialSuccess(host.id, credId, "snmp", 161);
              autoBindCredentialToDevice(ip, credId, "snmp", 161, host.id);
              runBudget.recordSuccess(credId);
              log(`✓ ${ip}:161 SNMP cred#${credId} (${nc.credential_name})`);
              validated++;
              validatedProtos.add("snmp");
              // Nessuna evidenza aggiuntiva qui: sysObjectID/sysDescr sono già
              // emessi da emitEvidenceFromSignals sui dati persistiti (Task 4).
            } else {
              recordCredentialFailure(host.id, credId, "snmp", 161, "Nessuna risposta SNMP (community non valida o host non raggiungibile su 161)");
              runBudget.recordFailure(credId);
              log(`✗ ${ip}:161 SNMP cred#${credId}: nessuna risposta`);
            }
          } catch (e) {
            const msg = (e as Error).message ?? String(e);
            recordCredentialFailure(host.id, credId, "snmp", 161, msg.slice(0, 500));
            runBudget.recordFailure(credId);
            log(`✗ ${ip}:161 SNMP cred#${credId}: ${msg.slice(0, 60)}`);
          }
        }

        // hasWindowsIndicator NON è più solo una condizione di ramo (§Task3): se
        // falsa, gateCredential nega esplicitamente con motivo loggato invece di
        // saltare l'intero blocco in silenzio come accadeva prima della fase 1b.
        if (credType === "windows" && !validatedProtos.has("winrm")) {
          // Porta WinRM: preferisci porta esplicita, fallback a 5985 — calcolata
          // PRIMA del gate (Minor 1: gateCredential deve conoscere la porta
          // effettiva per confrontarla col backoff persistito).
          const winrmPort = openPorts.find((p) => [5985, 5986].includes(p.port))?.port ?? 5985;
          if (!gateCredential("winrm", credId, credType, winrmPort)) continue;
          const creds = getCredentialLoginPair(credId, "windows");
          if (!creds) continue;
          try {
            const adInfo = getAdRealm();
            const hn = await runWinrmCommand(ip, winrmPort, creds.username, creds.password, "hostname", false, adInfo?.realm || "");
            if (String(hn ?? "").trim()) {
              recordCredentialSuccess(host.id, credId, "winrm", winrmPort);
              autoBindCredentialToDevice(ip, credId, "winrm", winrmPort, host.id);
              runBudget.recordSuccess(credId);
              log(`✓ ${ip}:${winrmPort} WinRM cred#${credId} (${nc.credential_name})`);
              validated++;
              validatedProtos.add("winrm");
              applyAuthEvidence(host.id, { protocol: "winrm", ok: true, banner: String(hn).trim() });
            } else {
              recordCredentialFailure(host.id, credId, "winrm", winrmPort, "Risposta vuota da WinRM (hostname)");
              runBudget.recordFailure(credId);
              log(`✗ ${ip}:${winrmPort} WinRM cred#${credId}: risposta vuota`);
            }
          } catch (e) {
            const msg = e instanceof WinrmError ? e.message : ((e as Error).message ?? String(e));
            recordCredentialFailure(host.id, credId, "winrm", winrmPort, msg.slice(0, 500));
            runBudget.recordFailure(credId);
            log(`✗ ${ip}:${winrmPort} WinRM cred#${credId}: ${msg.slice(0, 60)}`);
            const servicePresent = e instanceof WinrmError && WINRM_SERVICE_PRESENT_CODES.has(e.code);
            applyAuthEvidence(host.id, { protocol: "winrm", ok: false, banner: servicePresent ? e.code : null });
          }
        }

        // API: nessun test di autenticazione generico in questa fase (§7.4 fuori
        // scope) — TRANNE Redfish (BMC), Fase 4b Task 1: se il service root
        // anonimo (`redfishDetect`) conferma un BMC su 443/8443, tentiamo
        // l'autenticazione vera. NOTA (per Task 4): riusiamo credential_type/
        // protocol_type "api" perché un tipo "redfish" dedicato richiederebbe
        // una migrazione del CHECK su host_credentials/device_credential_bindings
        // (rimandata al Task 4 di integrazione) — mai un tentativo alla cieca
        // contro API generiche non-Redfish che condividono lo stesso tipo (es.
        // Proxmox): il detect anonimo PRIMA dell'auth evita lo sweep (Global
        // Constraints "nessuno sweep").
        if (credType === "api" && openPorts.some((p) => [80, 443, 8080, 8443].includes(p.port))) {
          const apiPort = openPorts.find((p) => [80, 443, 8080, 8443].includes(p.port))!.port;

          if ((apiPort === 443 || apiPort === 8443) && !validatedProtos.has("api")) {
            const detected = await redfishDetect(ip, { port: apiPort, timeoutMs: 3000 }).catch(
              () => ({ present: false, vendorHint: null })
            );
            if (detected.present) {
              if (!gateCredential("api", credId, credType, apiPort)) continue;
              const creds = getCredentialLoginPair(credId, "api");
              if (creds) {
                const result = await redfishValidate(ip, creds.username, creds.password, { port: apiPort }).catch(
                  (e) => ({ ok: false, error: (e as Error).message ?? String(e) })
                );
                if (result.ok) {
                  recordCredentialSuccess(host.id, credId, "api", apiPort);
                  autoBindCredentialToDevice(ip, credId, "api", apiPort, host.id);
                  runBudget.recordSuccess(credId);
                  log(`✓ ${ip}:${apiPort} Redfish (BMC) cred#${credId} (${nc.credential_name})`);
                  validated++;
                  validatedProtos.add("api");
                  const infoResult = await redfishFetchInfo(ip, creds.username, creds.password, { port: apiPort }).catch(
                    () => null
                  );
                  if (infoResult) {
                    try {
                      recordEvidence(getDb(), host.id, redfishEvidence(infoResult));
                      recomputeAttributionSafe(host.id, "scan");
                    } catch (e) {
                      log(`⚠ evidenza Redfish non registrata per host ${host.id}: ${(e as Error).message ?? e}`);
                    }
                  }
                } else {
                  const msg = result.error ?? "credenziali non valide";
                  recordCredentialFailure(host.id, credId, "api", apiPort, msg.slice(0, 500));
                  runBudget.recordFailure(credId);
                  log(`✗ ${ip}:${apiPort} Redfish (BMC) cred#${credId}: ${msg.slice(0, 160)}`);
                }
                continue; // esito reale (successo o fallimento) già registrato: non serve il fallback "non testato"
              }
            }
          }
        }

        // API generica (o Redfish non rilevato/credenziale non compatibile): nessun
        // test di autenticazione disponibile — registriamo il binding come NON
        // validato con motivo esplicito, mai più un "validated:false" muto (§Task3).
        if (credType === "api" && openPorts.some((p) => [80, 443, 8080, 8443].includes(p.port))) {
          const apiPort = openPorts.find((p) => [80, 443, 8080, 8443].includes(p.port))!.port;
          if (!gateCredential("api", credId, credType, apiPort)) continue;
          const noTestError = "nessun test disponibile per il protocollo api";
          addHostCredential(host.id, credId, "api", apiPort, { validated: false, auto_detected: true });
          getDb()
            .prepare(
              `UPDATE host_credentials SET last_error = ? WHERE host_id = ? AND credential_id = ? AND protocol_type = 'api' AND port = ?`
            )
            .run(noTestError, host.id, credId, apiPort);
          log(`⚙ ${ip}:${apiPort} API cred#${credId} (${nc.credential_name}) — ${noTestError}`);
        }
      }

      progress.scanned = i + 1;
      progress.found = validated;
    }

    // Riepilogo budget di run (§Task3: mai troncamento silenzioso) — quante
    // credenziali sono state escluse dal resto del run e quanti tentativi
    // sono stati risparmiati grazie all'esclusione.
    runBudget.logSummary();

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
    (scanType === "nmap" || scanType === "network_discovery" || scanType === "ipam_full" || scanType === "scan_nmap_base" || scanType === "scan_naabu") &&
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
  if (fpEnabled && !fpHostOk && (scanType === "nmap" || scanType === "snmp" || scanType === "network_discovery" || scanType === "ipam_full" || scanType === "scan_nmap_base" || scanType === "scan_snmp_verify" || scanType === "scan_naabu")) {
    console.warn(
      `[Discovery] Fingerprint: probe HTTP/SSH/SMB disattivati (${onlineIps.length} host online > ${fpProbesMaxHosts}); uso solo firme porte/SNMP. Alzare DA_INVENT_FINGERPRINT_PROBES_MAX_HOSTS solo su subnet piccole.`
    );
  }

  const fpUserRules = getFingerprintClassificationRulesForResolve();
  const fpDbRules = fpEnabled ? getEnabledDeviceFingerprintRules() : [];

  // Reset contatori per la fase host processing (evita 100% falso dopo DNS)
  progress.scanned = 0;
  progress.total = onlineIps.length;

  // Attribution v2 fase 3 — probe passivi (HTTP/TLS, mDNS, SSDP, WSD, SMB2): raccolti
  // qui durante la fase porte e lanciati in un'unica chiamata dopo il loop, per gli
  // scan che portano open_ports fresco (scan_naabu/scan_nmap_base/network_discovery).
  const probeEligibleScan =
    scanType === "scan_naabu" || scanType === "scan_nmap_base" || scanType === "network_discovery";
  const probeHosts: Array<{ id: number; ip: string; openPorts: number[] }> = [];

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

    const rulesDetailed = classifyDeviceDetailed({
      sysDescr: nmapData?.snmpSysDescr ?? null,
      sysObjectID: nmapData?.snmpSysObjectID ?? null,
      osInfo: nmapData?.os ?? null,
      openPorts: portsForClassification,
      hostname: hostname ?? null,
      vendor: vendor ?? null,
      snmpContext: buildSnmpContextForClassifier(nmapData),
    });
    const classificationFromRules = rulesDetailed.classification;

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
    if (fpEnabled && (scanType === "nmap" || scanType === "snmp" || scanType === "network_discovery" || scanType === "ipam_full" || scanType === "scan_nmap_base" || scanType === "scan_snmp_verify" || scanType === "scan_naabu")) {
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
            (scanType === "nmap" || scanType === "network_discovery" || scanType === "ipam_full" || scanType === "scan_nmap_base" || scanType === "scan_naabu") &&
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

    // sysObjectID lookup (dalla tabella snmp-sysobj-lookup.ts): alta affidabilità, match esatto su OID standard.
    // La category della lookup è storicamente libera ("networking"/"wireless"): mapSysObjCategory la
    // normalizza a uno slug valido e ritorna undefined se il prodotto è ambiguo, così la cascade prosegue.
    const classFromSysObj: DC | undefined = nmapData?.sysObjMatch
      ? mapSysObjCategory(nmapData.sysObjMatch)
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

    // Persistenza per-host in try/catch (fix C4 2026-06-23): un singolo host che
    // fa throw (constraint, MAC mojibake, ecc.) NON deve abortire l'intero scan
    // né saltare l'offline-marking post-scan — come già fanno gli sweep fast/icmp.
    try {
    const prevHost = hostRowByIp.get(ip);
    const previousClassification = prevHost?.classification ?? null;
    const previousConfidence =
      (prevHost as { inferred_confidence?: number | null } | undefined)?.inferred_confidence ?? 0;
    const classificationManual =
      (prevHost as { classification_manual?: number } | undefined)?.classification_manual === 1;

    // Classification slug: non scrivere in upsert (evita double-write se l'engine
    // rifiuta l'upgrade). Cascade → cascade_slug; engine applica dopo. INSERT usa "unknown".
    const host = upsertHost({
      network_id: networkId,
      ip,
      mac: mac || undefined,
      vendor: vendor || undefined,
      hostname: hostname || undefined,
      hostname_source: hostnameSource,
      dns_reverse: dnsReverse || undefined,
      dns_forward: dnsForward || undefined,
      status: "online",
      open_ports: portsJson,
      // Valore già unione DB + sessione (TCP+UDP+SNMP 161); persistenza puntuale
      open_ports_replace: portsJson !== undefined,
      os_info: nmapData?.snmpSysDescr || nmapData?.os || undefined,
      model: hostModel,
      serial_number: hostSerial,
      // preserve_existing: scan nmap/network_discovery/ipam_full non sovrascrivono dati già rilevati
      preserve_existing: scanType === "nmap" || scanType === "network_discovery" || scanType === "ipam_full" || scanType === "scan_nmap_base" || scanType === "scan_snmp_verify" || scanType === "scan_naabu",
      // Probe attivo ICMP-confermato: se l'IP era nel tombstone (host cancellato e poi
      // sostituito da un device nuovo), rimuovi l'esclusione e procedi alla creazione.
      bypassExclusion: true,
      ...(finalFirmware !== undefined || hostManufacturer !== undefined || vendor
        ? {
            firmware: finalFirmware ?? null,
            device_manufacturer: hostManufacturer ?? vendor ?? null,
          }
        : {}),
      ...(detectionJson !== undefined ? { detection_json: detectionJson } : {}),
      ...(snmpDataJson !== undefined ? { snmp_data: snmpDataJson } : {}),
    });

    if (!host) continue;
    if (host.first_seen === host.created_at) newHosts++;

    // Classification-engine facade (post-cascade): evidence + policy + history
    const detectionForEngine =
      fpSnap ??
      (detectionJson
        ? parseJsonSafe<DeviceFingerprintSnapshot | null>(detectionJson, null)
        : null);
    let cascadeMethod: string = "rules";
    if (classification === effectiveVendorProfileClass || classification === classFromSysObj || classification === classificationFromFpOid || classification === classificationFromGenericOid) {
      cascadeMethod = "oid";
    } else if (classification === classificationFromFingerprint || classification === classificationFromGenericFp) {
      cascadeMethod = "fingerprint";
    } else if (classification === classificationFromRules) {
      // Real DetectionMethod from classifyDeviceDetailed (oid|text|port|hostname|vendor|…)
      cascadeMethod = rulesDetailed.method !== "none" ? rulesDetailed.method : "rules";
    } else if (classification === classFromHostnamePrefix) {
      cascadeMethod = "hostname";
    }
    const naabuPortsForHost = naabuPortsByIp.get(ip) ?? null;
    const { decision, touchedClassification } = await runClassificationEngineForHost({
      db: getDb(),
      hostId: host.id,
      ip,
      hostname: hostname ?? null,
      vendor: vendor ?? null,
      os_info: nmapData?.snmpSysDescr || nmapData?.os || null,
      open_ports: portsForClassification,
      detection: detectionForEngine,
      snmp_sysdescr: nmapData?.snmpSysDescr ?? detectionForEngine?.snmp_sysdescr ?? null,
      snmp_sysobjectid: nmapData?.snmpSysObjectID ?? detectionForEngine?.snmp_vendor_oid ?? null,
      naabu_ports: naabuPortsForHost && naabuPortsForHost.length > 0 ? naabuPortsForHost : null,
      cascade_slug: classification,
      cascade_method: cascadeMethod,
      classification_manual: classificationManual,
      previous_classification: previousClassification,
      previous_confidence: previousConfidence,
      trigger: "scan",
    });

    // Attribution v2 (fase 1, parallel-run): rifusione evidenze sui dati appena persistiti
    const { recomputeAttributionSafe } = await import("@/lib/attribution/recompute");
    recomputeAttributionSafe(host.id, "scan");

    // Attribution v2 fase 3: raccolta host per i probe passivi post-loop (vedi sotto)
    if (probeEligibleScan) {
      probeHosts.push({ id: host.id, ip, openPorts: (portsForClassification ?? []).map((p) => p.port) });
    }

    // Sync network_device collegato (stesso IP) — port e classification applicata
    const slugForDevice = touchedClassification
      ? decision.classification
      : (previousClassification ?? classification);
    if (nmapData?.ports?.length && getNetworkDeviceByHost(ip)) {
      syncNetworkDeviceFromHostScan(ip, nmapData.ports, slugForDevice);
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
    } catch (e) {
      log(`✗ persist host ${ip}: ${(e as Error).message?.slice(0, 120)}`);
    }

    progress.scanned = i + 1;
    progress.phase = `Elaborazione host — ${i + 1}/${onlineIps.length} (${ip})`;
  }

  // Attribution v2 fase 3 — probe passivi (HTTP/TLS, mDNS, SSDP, WSD, SMB2): al termine
  // della fase porte, sugli host con open_ports appena persistito. Gating (setting
  // globale + override per rete + porta aperta) e budget/concorrenza sono interamente
  // responsabilità dell'orchestratore; qui basta non propagare mai un suo errore.
  if (probeEligibleScan && probeHosts.length > 0) {
    try {
      const { runAttributionProbes } = await import("@/lib/scanner/probes/run-probes");
      const probeResult = await runAttributionProbes(networkId, probeHosts);
      log(
        `Probe attribuzione: ${probeResult.hostsProbed} host probati, ${probeResult.evidenceWritten} evidenze scritte, ${probeResult.skipped} skip (${probeResult.elapsedMs}ms)`
      );
    } catch (e) {
      console.error(`[Discovery] probe attribuzione falliti per rete ${networkId}:`, e);
    }
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
  // - network_discovery / fast: dopo ICMP + second-pass TCP, marca offline
  //   (policy P1 strict). Entrambi gli scan ora hanno fallback TCP, quindi
  //   sono autoritativi: chi non risponde a ICMP NÉ a TCP è davvero spento.
  //   Aggiunge anche la nota per traccia diagnostica.
  // - nmap / ipam_full: restano additivi → annotano nelle note, non flippano
  //   (scan manuali, l'utente può avere visioni parziali su CIDR grandi).
  // - ping: marca offline (solo ICMP, comportamento classico).
  // ═══════════════════════════════════════════════════════════════
  if (scanType === "network_discovery" || scanType === "fast" || scanType === "scan_naabu") {
    progress.phase = "Aggiornamento host offline";
    noteHostsNonResponding(networkId, onlineIps, ips, scanType);
    markHostsOffline(networkId, onlineIps, ips);
    log(`Host non rispondenti (${ips.length - onlineIps.length}): marcati offline dopo ICMP + TCP fallback`);
  } else if (scanType === "nmap" || scanType === "ipam_full") {
    progress.phase = "Annotazione host non rispondenti";
    noteHostsNonResponding(networkId, onlineIps, ips, scanType);
    log(`Host non rispondenti (${ips.length - onlineIps.length}): annotati nelle note per revisione`);
  } else if (
    scanType !== "snmp" &&
    scanType !== "scan_nmap_base" &&
    scanType !== "scan_snmp_verify"
  ) {
    // ping e altri sweep ICMP-only: marca offline. I sub-step UI additivi
    // (nmap_base / snmp_verify) non devono flippare host non in target.
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
  if (scanType === "network_discovery" || scanType === "ipam_full" || scanType === "nmap" || scanType === "scan_nmap_base" || scanType === "scan_snmp_verify" || scanType === "scan_naabu") {
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
