/**
 * Device fingerprinting — regole unificate da DB.
 * Valuta porte TCP, OID SNMP, sysDescr, hostname, MAC vendor, banner HTTP/SSH, TTL ICMP.
 * Cache in-memory 1h per IP (processo).
 */

import type { DeviceFingerprintPortMatch, DeviceFingerprintSnapshot } from "@/types";
import type { DeviceFingerprintRuleRow } from "@/lib/db";
import { runActiveProbes } from "./device-fingerprint-probes";

const CACHE_TTL_MS = 60 * 60 * 1000;
const PORT_SIG_THRESHOLD = 0.4;
const FINGERPRINT_CACHE_KEY = "__daipam_fingerprint_cache__";

type CacheEntry = { at: number; data: DeviceFingerprintSnapshot };

function getCache(): Map<string, CacheEntry> {
  const g = globalThis as Record<string, unknown>;
  if (!g[FINGERPRINT_CACHE_KEY]) g[FINGERPRINT_CACHE_KEY] = new Map<string, CacheEntry>();
  return g[FINGERPRINT_CACHE_KEY] as Map<string, CacheEntry>;
}

export function getCachedFingerprint(ip: string): DeviceFingerprintSnapshot | null {
  const c = getCache().get(ip);
  if (!c) return null;
  if (Date.now() - c.at > CACHE_TTL_MS) {
    getCache().delete(ip);
    return null;
  }
  return c.data;
}

export function setCachedFingerprint(ip: string, data: DeviceFingerprintSnapshot): void {
  getCache().set(ip, { at: Date.now(), data });
}

export function inferOsHintFromTtl(ttl: number | null | undefined): string | null {
  if (ttl == null || ttl < 0) return null;
  if (ttl <= 64) return "Linux/Unix/embedded";
  if (ttl <= 128) return "Windows";
  if (ttl >= 200) return "Cisco/Juniper/BSD-like";
  if (ttl <= 32) return "Windows legacy";
  return null;
}

function parsePorts(json: string | null): number[] {
  if (!json) return [];
  try { const a = JSON.parse(json); return Array.isArray(a) ? a.filter((n: unknown) => typeof n === "number") : []; }
  catch { return []; }
}

function oidPrefixMatches(oid: string, prefix: string): boolean {
  const o = oid.replace(/^\.+/, "").split(".").filter(Boolean);
  const p = prefix.replace(/^\.+/, "").split(".").filter(Boolean);
  if (p.length > o.length) return false;
  for (let i = 0; i < p.length; i++) { if (o[i] !== p[i]) return false; }
  return true;
}

function testPattern(text: string, pattern: string): boolean {
  if (!text || !pattern) return false;
  try { return new RegExp(pattern, "i").test(text); }
  catch { return text.toLowerCase().includes(pattern.toLowerCase()); }
}

function specificityPenalty(keyCount: number): number {
  if (keyCount >= 3) return 0;
  if (keyCount === 2) return 0.05;
  return 0.15;
}

function scorePortRule(
  openSet: Set<number>,
  keyPorts: number[],
  optPorts: number[],
  minKey?: number | null,
): number {
  if (keyPorts.length === 0) return 0;
  const keyHits = keyPorts.filter((p) => openSet.has(p)).length;
  const minRequired = minKey ?? keyPorts.length;
  if (keyHits < minRequired) return 0;
  const optHits = optPorts.filter((p) => openSet.has(p)).length;
  const partKey = (keyHits / keyPorts.length) * 0.75;
  const partOpt = optPorts.length === 0 ? 0 : (optHits / optPorts.length) * 0.25;
  const raw = Math.min(1, partKey + partOpt);
  return Math.max(0, raw - specificityPenalty(keyPorts.length));
}

/** Port-signature matching against DB rules that have tcp_ports_key. */
export function matchPortSignatures(
  openPorts: number[],
  rules: DeviceFingerprintRuleRow[],
): DeviceFingerprintPortMatch[] {
  const openSet = new Set(openPorts);
  const out: DeviceFingerprintPortMatch[] = [];
  for (const rule of rules) {
    const keyPorts = parsePorts(rule.tcp_ports_key);
    if (keyPorts.length === 0) continue;
    const optPorts = parsePorts(rule.tcp_ports_optional);
    const confidence = scorePortRule(openSet, keyPorts, optPorts, rule.min_key_ports);
    if (confidence < PORT_SIG_THRESHOLD) continue;
    const matched_ports = [...keyPorts, ...optPorts].filter((p) => openSet.has(p));
    out.push({ name: rule.device_label, confidence, matched_ports });
  }
  out.sort((a, b) => b.confidence - a.confidence);
  return out.slice(0, 5);
}

export interface FingerprintBuildInput {
  ip: string;
  hostname?: string | null;
  mac?: string | null;
  macVendor?: string | null;
  ttl?: number | null;
  openPorts: Array<{ port: number; protocol?: string }>;
  snmpSysDescr?: string | null;
  snmpSysObjectID?: string | null;
  snmpSysName?: string | null;
  activeProbes?: boolean;
}

interface RuleMatchResult {
  device_label: string;
  classification: string;
  confidence: number;
  priority: number;
  source: string;
}

function evaluateRules(
  rules: DeviceFingerprintRuleRow[],
  ctx: {
    openTcpSet: Set<number>;
    tcpPorts: number[];
    sysObjectID: string | null;
    sysDescr: string | null;
    hostname: string | null;
    macVendor: string | null;
    banner: string | null;
    ttl: number | null;
  },
): RuleMatchResult | null {
  let best: RuleMatchResult | null = null;

  for (const rule of rules) {
    let matched = false;
    let confidence = 0;
    let source = "";
    let criteriaCount = 0;
    let criteriaMatched = 0;

    const keyPorts = parsePorts(rule.tcp_ports_key);
    if (keyPorts.length > 0) {
      criteriaCount++;
      const optPorts = parsePorts(rule.tcp_ports_optional);
      const score = scorePortRule(ctx.openTcpSet, keyPorts, optPorts, rule.min_key_ports);
      if (score >= PORT_SIG_THRESHOLD) {
        criteriaMatched++;
        confidence = Math.max(confidence, score);
        source = "ports";
        matched = true;
      }
    }

    if (rule.oid_prefix && ctx.sysObjectID) {
      criteriaCount++;
      if (oidPrefixMatches(ctx.sysObjectID, rule.oid_prefix)) {
        criteriaMatched++;
        confidence = Math.max(confidence, 0.9);
        source = source ? `${source}+oid` : "oid";
        matched = true;
      }
    }

    if (rule.sysdescr_pattern && ctx.sysDescr) {
      criteriaCount++;
      if (testPattern(ctx.sysDescr, rule.sysdescr_pattern)) {
        criteriaMatched++;
        confidence = Math.max(confidence, 0.85);
        source = source ? `${source}+sysdescr` : "sysdescr";
        matched = true;
      }
    }

    if (rule.banner_pattern && ctx.banner) {
      criteriaCount++;
      if (testPattern(ctx.banner, rule.banner_pattern)) {
        criteriaMatched++;
        confidence = Math.max(confidence, 0.88);
        source = source ? `${source}+banner` : "banner";
        matched = true;
      }
    }

    if (rule.hostname_pattern && ctx.hostname) {
      criteriaCount++;
      if (testPattern(ctx.hostname, rule.hostname_pattern)) {
        criteriaMatched++;
        confidence = Math.max(confidence, 0.6);
        source = source ? `${source}+hostname` : "hostname";
        matched = true;
      }
    }

    if (rule.mac_vendor_pattern && ctx.macVendor) {
      criteriaCount++;
      if (testPattern(ctx.macVendor, rule.mac_vendor_pattern)) {
        criteriaMatched++;
        confidence = Math.max(confidence, 0.5);
        source = source ? `${source}+mac_vendor` : "mac_vendor";
        matched = true;
      }
    }

    if (rule.ttl_min != null || rule.ttl_max != null) {
      if (ctx.ttl != null) {
        criteriaCount++;
        const min = rule.ttl_min ?? 0;
        const max = rule.ttl_max ?? 999;
        if (ctx.ttl >= min && ctx.ttl <= max) {
          criteriaMatched++;
          confidence = Math.max(confidence, 0.3);
          source = source ? `${source}+ttl` : "ttl";
          matched = true;
        }
      }
    }

    if (!matched || criteriaCount === 0) continue;

    if (criteriaMatched > 1) {
      confidence = Math.min(1, confidence + 0.05 * (criteriaMatched - 1));
    }

    const isBetter = !best ||
      rule.priority < best.priority ||
      (rule.priority === best.priority && confidence > best.confidence);

    if (isBetter) {
      best = { device_label: rule.device_label, classification: rule.classification, confidence, priority: rule.priority, source };
    }
  }

  return best;
}

export async function buildDeviceFingerprint(
  input: FingerprintBuildInput,
  dbRules?: DeviceFingerprintRuleRow[],
): Promise<DeviceFingerprintSnapshot> {
  const cached = getCachedFingerprint(input.ip);
  if (cached) return cached;

  const rules = dbRules ?? (() => {
    try { const { getEnabledDeviceFingerprintRules } = require("@/lib/db"); return getEnabledDeviceFingerprintRules(); }
    catch { return []; }
  })();

  const tcpPorts = input.openPorts.filter((p) => (p.protocol ?? "tcp") === "tcp").map((p) => p.port);
  const openTcpSet = new Set(tcpPorts);
  const matches = matchPortSignatures(tcpPorts, rules as DeviceFingerprintRuleRow[]);
  const os_hint = inferOsHintFromTtl(input.ttl);

  const detection_sources: string[] = [];
  if (input.ttl != null) detection_sources.push("ttl");
  if (matches.length) detection_sources.push("port_signature");
  if (input.snmpSysDescr || input.snmpSysObjectID) detection_sources.push("snmp");

  let banner_http: string | null = null;
  let banner_ssh: string | null = null;
  const snmp_sysdescr = input.snmpSysDescr ?? null;
  const snmp_vendor_oid = input.snmpSysObjectID ?? null;

  const probesEnabled = input.activeProbes !== false && process.env.DA_INVENT_FINGERPRINT_PROBES !== "false";
  if (probesEnabled && tcpPorts.length > 0) {
    try {
      const probes = await runActiveProbes({
        ip: input.ip,
        openTcpPorts: tcpPorts,
        enableSmb: tcpPorts.includes(445),
      });
      if (probes.http) {
        banner_http = [probes.http.title, probes.http.server].filter(Boolean).join(" — ") || probes.http.snippet.slice(0, 200);
        detection_sources.push("banner_http");
      }
      if (probes.sshBanner) {
        banner_ssh = probes.sshBanner;
        detection_sources.push("banner_ssh");
      }
      if (probes.smbRaw) {
        detection_sources.push("smb_os_discovery");
        banner_http = (banner_http ? `${banner_http}\n` : "") + probes.smbRaw.slice(0, 400);
      }
    } catch { /* probe failure non blocca */ }
  }

  const bannerAll = [banner_http, banner_ssh].filter(Boolean).join("\n") || null;

  const ruleResult = evaluateRules(rules as DeviceFingerprintRuleRow[], {
    openTcpSet,
    tcpPorts,
    sysObjectID: snmp_vendor_oid,
    sysDescr: snmp_sysdescr,
    hostname: input.hostname ?? input.snmpSysName ?? null,
    macVendor: input.macVendor ?? null,
    banner: bannerAll,
    ttl: input.ttl ?? null,
  });

  let final_device = ruleResult?.device_label ?? matches[0]?.name ?? null;
  let final_confidence = ruleResult?.confidence ?? matches[0]?.confidence ?? 0;

  if (ruleResult?.source) {
    detection_sources.push(`rule:${ruleResult.source}`);
  }

  const snap: DeviceFingerprintSnapshot = {
    ip: input.ip,
    hostname: input.hostname ?? null,
    mac: input.mac ?? null,
    ttl: input.ttl ?? null,
    os_hint,
    open_ports: tcpPorts,
    matches,
    banner_http,
    banner_ssh,
    snmp_sysdescr,
    snmp_vendor_oid,
    final_device,
    final_confidence: final_confidence > 0 ? final_confidence : undefined,
    detection_sources: [...new Set(detection_sources)],
    generated_at: new Date().toISOString(),
  };

  setCachedFingerprint(input.ip, snap);
  return snap;
}
