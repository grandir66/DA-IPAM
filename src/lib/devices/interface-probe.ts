/**
 * Probe universale "interfacce + IP" di un device, vendor-agnostic via SNMP IP-MIB.
 *
 * Strategia:
 *   1. SNMP `ipAddressTable` (`1.3.6.1.2.1.4.34`) — IPv4 + IPv6 unificato, RFC 4293.
 *      Indicizzato per (addressType, address), valore: ifIndex.
 *   2. Fallback SNMP `ipAddrTable` (`1.3.6.1.2.1.4.20`) — IPv4-only, RFC 1213.
 *      Per device che non implementano la tabella moderna (Stormshield, vecchi switch).
 *   3. SNMP `ifTable`/`ifXTable` per nome interfaccia, MAC, status, speed.
 *
 * Output: `InterfaceProbeResult` — struttura piatta independente dal transport.
 * Il caller (typicamente `runInfoQuery`) la passa a `physical-device-db.upsert*`.
 *
 * Niente SSH / CLI vendor-specific qui: quelli arriveranno in Fase 3 come
 * fallback opzionale quando SNMP non è configurato.
 */

import type { NetworkDevice } from "@/types";
import {
  getDeviceCommunityString,
  getDeviceSnmpV3Credentials,
} from "@/lib/db";

const OID_IF_DESCR = "1.3.6.1.2.1.2.2.1.2";
const OID_IF_PHYS_ADDRESS = "1.3.6.1.2.1.2.2.1.6";
const OID_IF_OPER_STATUS = "1.3.6.1.2.1.2.2.1.8";
const OID_IF_HIGH_SPEED = "1.3.6.1.2.1.31.1.1.1.15";
const OID_IF_NAME = "1.3.6.1.2.1.31.1.1.1.1";
const OID_IF_ALIAS = "1.3.6.1.2.1.31.1.1.1.18";
// IP-MIB ipAddressIfIndex: chiave (addressType, address) → ifIndex
const OID_IP_ADDRESS_IF_INDEX = "1.3.6.1.2.1.4.34.1.3";
const OID_IP_ADDRESS_PREFIX_LEN = "1.3.6.1.2.1.4.34.1.5"; // ipAddressPrefixLen
const OID_IP_ADDRESS_TYPE = "1.3.6.1.2.1.4.34.1.4";       // unicast=1, broadcast=2, ...
// Legacy IP-MIB ipAdEntIfIndex (IPv4-only)
const OID_IP_AD_ENT_IF_INDEX = "1.3.6.1.2.1.4.20.1.2";
const OID_IP_AD_ENT_NETMASK = "1.3.6.1.2.1.4.20.1.3";

const PROBE_TIMEOUT_MS = 15_000;

export interface InterfaceProbeAddress {
  ip: string;
  prefix: number | null;
  family: 4 | 6;
  scope: "global" | "link" | "host" | "unknown";
}

export interface InterfaceProbeResult {
  ifname: string;
  ifindex: number | null;
  mac: string | null;
  status: "up" | "down" | "unknown";
  speed_mbps: number | null;
  alias: string | null;
  addresses: InterfaceProbeAddress[];
}

export interface DeviceProbeOutcome {
  interfaces: InterfaceProbeResult[];
  /** Transport che ha prodotto il risultato. Utile per log e per UI "fonte". */
  source:
    | "snmp_ip_mib_v4v6"
    | "snmp_ip_mib_v4_legacy"
    | "vendor_cli_mikrotik"
    | "vendor_cli_linux"
    | "none";
  /** Errori non-fatali raccolti durante il probe (per il diagnostic log). */
  warnings: string[];
}

// ──────────────────────────────────────────────────────────────────
// SNMP session helper (replica logica di router-client.createSnmpArpClient
// per non importare quella factory che ritorna un RouterClient diverso).
// ──────────────────────────────────────────────────────────────────

interface SnmpWalkResult {
  oid: string;
  value: Buffer | string | number;
}

function buildSession(device: NetworkDevice, snmp: typeof import("net-snmp")) {
  const opts = { port: 161, timeout: 10000 };
  if (device.protocol === "snmp_v3") {
    const v3 = getDeviceSnmpV3Credentials(device);
    if (v3) {
      const user = {
        name: v3.username,
        level: snmp.SecurityLevel.authNoPriv,
        authProtocol: snmp.AuthProtocols.md5,
        authKey: v3.authKey,
      };
      return snmp.createV3Session(device.host, user, opts);
    }
  }
  const community = getDeviceCommunityString(device);
  return snmp.createSession(device.host, community, opts);
}

function snmpWalk(device: NetworkDevice, snmp: typeof import("net-snmp"), oid: string): Promise<SnmpWalkResult[]> {
  return new Promise((resolve, reject) => {
    const session = buildSession(device, snmp);
    const results: SnmpWalkResult[] = [];
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { session.close(); } catch { /* ignore */ }
      reject(new Error(`SNMP walk timeout for OID ${oid}`));
    }, PROBE_TIMEOUT_MS);

    session.subtree(
      oid,
      (varbinds: SnmpWalkResult[]) => {
        for (const vb of varbinds) results.push({ oid: vb.oid, value: vb.value });
      },
      (error: Error | undefined) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        try { session.close(); } catch { /* ignore */ }
        if (error) reject(error);
        else resolve(results);
      }
    );
  });
}

// ──────────────────────────────────────────────────────────────────
// Decodifica OID
// ──────────────────────────────────────────────────────────────────

function decodeMac(value: Buffer | string | number): string | null {
  if (Buffer.isBuffer(value)) {
    if (value.length !== 6) return null;
    return Array.from(value).map((b) => b.toString(16).padStart(2, "0")).join(":");
  }
  return null;
}

function decodeString(value: Buffer | string | number): string | null {
  if (Buffer.isBuffer(value)) return value.toString("utf8").replace(/\0+$/, "");
  if (typeof value === "string") return value;
  return null;
}

/**
 * ipAddressIfIndex OID layout: `<base>.<addressType>.<addressLen>.<addressBytes...>`
 * addressType: 1=ipv4, 2=ipv6, 3=ipv4z, 4=ipv6z.
 * Ritorna `{family, ip}` o null se non decifrabile.
 */
function decodeIpAddressKey(oidSuffix: string): { family: 4 | 6; ip: string } | null {
  const parts = oidSuffix.split(".").filter((s) => s.length > 0);
  if (parts.length < 3) return null;
  const addressType = parseInt(parts[0]);
  const addressLen = parseInt(parts[1]);
  if (!Number.isFinite(addressLen)) return null;
  const addressBytes = parts.slice(2, 2 + addressLen).map((s) => parseInt(s));
  if (addressBytes.length !== addressLen || addressBytes.some((b) => !Number.isFinite(b))) return null;

  if (addressType === 1 && addressLen === 4) {
    return { family: 4, ip: addressBytes.join(".") };
  }
  if (addressType === 2 && addressLen === 16) {
    const hexPairs: string[] = [];
    for (let i = 0; i < 16; i += 2) {
      hexPairs.push(((addressBytes[i] << 8) | addressBytes[i + 1]).toString(16));
    }
    return { family: 6, ip: hexPairs.join(":") };
  }
  return null;
}

function ipv4Scope(ip: string): "global" | "link" | "host" {
  if (ip.startsWith("127.")) return "host";
  if (ip.startsWith("169.254.")) return "link";
  return "global";
}

function ipv6Scope(ip: string): "global" | "link" | "host" {
  const low = ip.toLowerCase();
  if (low === "::1") return "host";
  if (low.startsWith("fe80:") || low.startsWith("fe80::")) return "link";
  return "global";
}

function netmaskToPrefix(netmask: string): number | null {
  const octets = netmask.split(".").map((s) => parseInt(s));
  if (octets.length !== 4 || octets.some((o) => !Number.isFinite(o))) return null;
  let prefix = 0;
  for (const oct of octets) {
    for (let i = 7; i >= 0; i--) {
      if (oct & (1 << i)) prefix++;
      else return prefix;
    }
  }
  return prefix;
}

// ──────────────────────────────────────────────────────────────────
// Probe principale
// ──────────────────────────────────────────────────────────────────

/**
 * True se il device ha una community/credenziale SNMP risolvibile. NON probe-able
 * SNMP se ritorna false (router-client lo gestisce diversamente; qui restituiamo
 * `source='none'`).
 */
function canProbeSnmp(device: NetworkDevice): boolean {
  if (device.community_string) return true;
  if (device.snmp_credential_id) return true;
  // credential_id può essere SNMP community archiviata; lasciamo che getDeviceCommunityString decida
  return !!getDeviceCommunityString(device);
}

/**
 * Fallback CLI vendor-specific quando SNMP non è disponibile o ritorna 0
 * interfacce. Mappa `device.vendor` → probe corrispondente in
 * [vendor-interface-probes.ts](./vendor-interface-probes.ts).
 */
async function tryVendorCliFallback(
  device: NetworkDevice,
  warnings: string[]
): Promise<{ interfaces: InterfaceProbeResult[]; source: DeviceProbeOutcome["source"] } | null> {
  try {
    const { probeVendorInterfacesCli } = await import("./vendor-interface-probes");
    const result = await probeVendorInterfacesCli(device);
    if (result === null || result.length === 0) return null;
    const source: DeviceProbeOutcome["source"] =
      device.vendor === "mikrotik" ? "vendor_cli_mikrotik" : "vendor_cli_linux";
    return { interfaces: result, source };
  } catch (e) {
    warnings.push(`Vendor CLI probe fallito: ${(e as Error).message}`);
    return null;
  }
}

export async function probeDeviceInterfaces(device: NetworkDevice): Promise<DeviceProbeOutcome> {
  const warnings: string[] = [];

  // Prima tentativo: SNMP IP-MIB (universale per i device SNMP-compliant).
  if (!canProbeSnmp(device)) {
    // Niente SNMP → prova CLI vendor (Mikrotik, Proxmox/Linux/NAS).
    const cli = await tryVendorCliFallback(device, warnings);
    if (cli) return { interfaces: cli.interfaces, source: cli.source, warnings };
    return { interfaces: [], source: "none", warnings: ["SNMP non configurato e nessun CLI vendor applicabile"] };
  }

  const snmp = await import("net-snmp");

  // 1. ifTable + ifXTable → metadata interfaccia (key = ifIndex)
  const interfacesByIndex = new Map<number, InterfaceProbeResult>();

  async function loadIfTable() {
    const descrResults = await snmpWalk(device, snmp, OID_IF_DESCR);
    for (const r of descrResults) {
      const ifindex = parseInt(r.oid.split(".").pop()!);
      if (!Number.isFinite(ifindex)) continue;
      const ifname = decodeString(r.value) ?? `if${ifindex}`;
      interfacesByIndex.set(ifindex, {
        ifname,
        ifindex,
        mac: null,
        status: "unknown",
        speed_mbps: null,
        alias: null,
        addresses: [],
      });
    }

    // ifName (preferito su ifDescr quando disponibile)
    try {
      const nameResults = await snmpWalk(device, snmp, OID_IF_NAME);
      for (const r of nameResults) {
        const ifindex = parseInt(r.oid.split(".").pop()!);
        const name = decodeString(r.value);
        if (name && interfacesByIndex.has(ifindex)) {
          interfacesByIndex.get(ifindex)!.ifname = name;
        }
      }
    } catch (e) {
      warnings.push(`ifName non disponibile (${(e as Error).message})`);
    }

    try {
      const macResults = await snmpWalk(device, snmp, OID_IF_PHYS_ADDRESS);
      for (const r of macResults) {
        const ifindex = parseInt(r.oid.split(".").pop()!);
        const iface = interfacesByIndex.get(ifindex);
        if (!iface) continue;
        iface.mac = decodeMac(r.value);
      }
    } catch (e) {
      warnings.push(`ifPhysAddress non disponibile (${(e as Error).message})`);
    }

    try {
      const statusResults = await snmpWalk(device, snmp, OID_IF_OPER_STATUS);
      for (const r of statusResults) {
        const ifindex = parseInt(r.oid.split(".").pop()!);
        const iface = interfacesByIndex.get(ifindex);
        if (!iface) continue;
        const s = Number(r.value);
        iface.status = s === 1 ? "up" : s === 2 ? "down" : "unknown";
      }
    } catch (e) {
      warnings.push(`ifOperStatus non disponibile (${(e as Error).message})`);
    }

    try {
      const speedResults = await snmpWalk(device, snmp, OID_IF_HIGH_SPEED);
      for (const r of speedResults) {
        const ifindex = parseInt(r.oid.split(".").pop()!);
        const iface = interfacesByIndex.get(ifindex);
        if (!iface) continue;
        const mbps = Number(r.value);
        iface.speed_mbps = Number.isFinite(mbps) && mbps > 0 ? mbps : null;
      }
    } catch { /* opzionale */ }

    try {
      const aliasResults = await snmpWalk(device, snmp, OID_IF_ALIAS);
      for (const r of aliasResults) {
        const ifindex = parseInt(r.oid.split(".").pop()!);
        const iface = interfacesByIndex.get(ifindex);
        if (!iface) continue;
        const alias = decodeString(r.value);
        if (alias) iface.alias = alias;
      }
    } catch { /* opzionale */ }
  }

  try {
    await loadIfTable();
  } catch (e) {
    warnings.push(`ifTable walk fallito: ${(e as Error).message}`);
    // SNMP timeout / community sbagliata / device senza SNMP agent → CLI fallback.
    const cli = await tryVendorCliFallback(device, warnings);
    if (cli) return { interfaces: cli.interfaces, source: cli.source, warnings };
    return { interfaces: [], source: "none", warnings };
  }

  // 2. Tentativo IP-MIB ipAddressTable (IPv4 + IPv6)
  let source: DeviceProbeOutcome["source"] = "none";
  let ipAddressTableHits = 0;
  try {
    const ipResults = await snmpWalk(device, snmp, OID_IP_ADDRESS_IF_INDEX);
    for (const r of ipResults) {
      const suffix = r.oid.startsWith(OID_IP_ADDRESS_IF_INDEX + ".")
        ? r.oid.substring(OID_IP_ADDRESS_IF_INDEX.length + 1)
        : r.oid;
      const decoded = decodeIpAddressKey(suffix);
      if (!decoded) continue;
      const ifindex = Number(r.value);
      const iface = interfacesByIndex.get(ifindex);
      if (!iface) continue;
      const scope = decoded.family === 4 ? ipv4Scope(decoded.ip) : ipv6Scope(decoded.ip);
      iface.addresses.push({ ip: decoded.ip, prefix: null, family: decoded.family, scope });
      ipAddressTableHits++;
    }
    if (ipAddressTableHits > 0) {
      source = "snmp_ip_mib_v4v6";
      // Prefix len opzionale
      try {
        const prefixResults = await snmpWalk(device, snmp, OID_IP_ADDRESS_PREFIX_LEN);
        for (const r of prefixResults) {
          const suffix = r.oid.startsWith(OID_IP_ADDRESS_PREFIX_LEN + ".")
            ? r.oid.substring(OID_IP_ADDRESS_PREFIX_LEN.length + 1)
            : r.oid;
          const decoded = decodeIpAddressKey(suffix);
          if (!decoded) continue;
          // Il valore è un OID-style "ipAddressPrefix" pointer — non è il prefix len direttamente.
          // In molti dispositivi però alcune varianti vendor restituiscono direttamente l'integer prefix.
          // Manteniamo il parsing best-effort.
          const numeric = Number(r.value);
          if (Number.isFinite(numeric) && numeric > 0 && numeric <= 128) {
            for (const iface of interfacesByIndex.values()) {
              const addr = iface.addresses.find((a) => a.ip === decoded.ip && a.family === decoded.family);
              if (addr) addr.prefix = numeric;
            }
          }
        }
      } catch { /* opzionale */ }

      // Filtra non-unicast (broadcast, multicast) se ipAddressType è disponibile
      try {
        const typeResults = await snmpWalk(device, snmp, OID_IP_ADDRESS_TYPE);
        const nonUnicast = new Set<string>();
        for (const r of typeResults) {
          const suffix = r.oid.startsWith(OID_IP_ADDRESS_TYPE + ".")
            ? r.oid.substring(OID_IP_ADDRESS_TYPE.length + 1)
            : r.oid;
          const decoded = decodeIpAddressKey(suffix);
          if (!decoded) continue;
          if (Number(r.value) !== 1) nonUnicast.add(`${decoded.family}:${decoded.ip}`);
        }
        if (nonUnicast.size > 0) {
          for (const iface of interfacesByIndex.values()) {
            iface.addresses = iface.addresses.filter((a) => !nonUnicast.has(`${a.family}:${a.ip}`));
          }
        }
      } catch { /* opzionale */ }
    }
  } catch (e) {
    warnings.push(`ipAddressTable walk fallito: ${(e as Error).message}`);
  }

  // 3. Fallback IPv4-only legacy (ipAdEntIfIndex)
  if (ipAddressTableHits === 0) {
    try {
      const v4Results = await snmpWalk(device, snmp, OID_IP_AD_ENT_IF_INDEX);
      for (const r of v4Results) {
        const ip = r.oid.startsWith(OID_IP_AD_ENT_IF_INDEX + ".")
          ? r.oid.substring(OID_IP_AD_ENT_IF_INDEX.length + 1)
          : "";
        if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip)) continue;
        const ifindex = Number(r.value);
        const iface = interfacesByIndex.get(ifindex);
        if (!iface) continue;
        iface.addresses.push({ ip, prefix: null, family: 4, scope: ipv4Scope(ip) });
      }
      if (interfacesByIndex.size > 0 && Array.from(interfacesByIndex.values()).some((i) => i.addresses.length > 0)) {
        source = "snmp_ip_mib_v4_legacy";
      }
      // Prefix da netmask
      try {
        const maskResults = await snmpWalk(device, snmp, OID_IP_AD_ENT_NETMASK);
        const maskByIp = new Map<string, string>();
        for (const r of maskResults) {
          const ip = r.oid.startsWith(OID_IP_AD_ENT_NETMASK + ".")
            ? r.oid.substring(OID_IP_AD_ENT_NETMASK.length + 1)
            : "";
          if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip)) continue;
          maskByIp.set(ip, decodeString(r.value) ?? "");
        }
        for (const iface of interfacesByIndex.values()) {
          for (const addr of iface.addresses) {
            if (addr.family !== 4 || addr.prefix !== null) continue;
            const mask = maskByIp.get(addr.ip);
            if (mask) addr.prefix = netmaskToPrefix(mask);
          }
        }
      } catch { /* opzionale */ }
    } catch (e) {
      warnings.push(`ipAdEntIfIndex walk fallito: ${(e as Error).message}`);
    }
  }

  // 4. Filtra interfacce vuote (no IP, no MAC): rumore (Null0, virtual senza addressi)
  const interfaces = Array.from(interfacesByIndex.values()).filter(
    (i) => i.addresses.length > 0 || i.mac
  );

  // 5. Se SNMP ha risposto ma con 0 interfacce utili (community sbagliata, MIB minimo)
  //    proviamo il CLI vendor come secondo tentativo.
  if (interfaces.length === 0) {
    const cli = await tryVendorCliFallback(device, warnings);
    if (cli) return { interfaces: cli.interfaces, source: cli.source, warnings };
  }

  return { interfaces, source, warnings };
}
