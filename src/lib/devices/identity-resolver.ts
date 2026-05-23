/**
 * Risoluzione identità physical_device:
 *   - prende un `NetworkDevice` + il suo `DeviceProbeOutcome` (interfacce con MAC e IP),
 *   - calcola anchor multipli con score,
 *   - cerca match in `physical_devices` (serial, MAC, sysname), altrimenti crea,
 *   - upserta tutte le interfacce + indirizzi,
 *   - **auto-promote**: per ogni IP che cade in una `networks.cidr` esistente, crea un
 *     `hosts` (se non esiste) e lo aggancia al physical_device.
 *
 * Pensato per essere chiamato alla fine di `runInfoQuery()` con il risultato di
 * `probeDeviceInterfaces()`. Idempotente: rieseguibile più volte senza duplicazioni.
 */

import type { NetworkDevice } from "@/types";
import { getDb } from "@/lib/db";
import type { DeviceProbeOutcome, InterfaceProbeResult } from "./interface-probe";
import {
  createPhysicalDevice,
  findPhysicalDeviceBySerial,
  findPhysicalDeviceByPrimaryMac,
  findPhysicalDeviceBySysname,
  findPhysicalDevicesByAnyMac,
  isVirtualMac,
  listPhysicalDeviceMacs,
  normalizeMac,
  setHostPhysicalDevice,
  setNetworkDevicePhysicalDevice,
  updatePhysicalDevice,
  upsertDeviceInterface,
  upsertInterfaceAddress,
} from "./physical-device-db";

/** Soglia minima di confidenza per associare un physical_device esistente (anziché creare). */
const MIN_CONFIDENCE = 60;

export interface ResolveOutcome {
  physical_device_id: number;
  /** True se nuovo record, false se match su esistente. */
  created: boolean;
  identity_anchor: string;
  identity_confidence: number;
  interfaces_upserted: number;
  addresses_upserted: number;
  /** IP che sono stati promossi a `hosts` (cadono in una subnet conosciuta). */
  promoted_hosts: Array<{ host_id: number; ip: string; network_id: number; created: boolean }>;
}

interface MatchCandidate {
  physical_device_id: number;
  anchor: string;
  confidence: number;
}

/** Sceglie il MAC "primary" da usare come anchor: prima ethernet non virtuale con MAC valido. */
function pickPrimaryMac(interfaces: InterfaceProbeResult[]): string | null {
  for (const iface of interfaces) {
    const m = normalizeMac(iface.mac);
    if (!m) continue;
    if (isVirtualMac(m)) continue;
    // Salta loopback (di solito null mac comunque) e tunnel
    const name = iface.ifname.toLowerCase();
    if (name === "lo" || name.startsWith("lo:") || name.startsWith("tun") || name.startsWith("tap")) continue;
    return m;
  }
  return null;
}

function findMatchCandidates(
  device: NetworkDevice,
  probe: DeviceProbeOutcome,
  primaryMac: string | null
): MatchCandidate[] {
  const candidates: MatchCandidate[] = [];

  // Anchor 1: serial_number dal NetworkDevice (settato da getDeviceInfo via SSH/SNMP)
  if (device.serial_number) {
    const match = findPhysicalDeviceBySerial(device.serial_number);
    if (match) candidates.push({ physical_device_id: match.id, anchor: "serial_number", confidence: 100 });
  }

  // Anchor 2: primary_mac
  if (primaryMac) {
    const match = findPhysicalDeviceByPrimaryMac(primaryMac);
    if (match) candidates.push({ physical_device_id: match.id, anchor: "primary_mac", confidence: 80 });
  }

  // Anchor 3: set di MAC fisici condivisi (≥ 2 MAC condivisi con un device esistente)
  const macs = probe.interfaces
    .map((i) => normalizeMac(i.mac))
    .filter((m): m is string => m !== null && !isVirtualMac(m));
  if (macs.length > 0) {
    const matches = findPhysicalDevicesByAnyMac(macs);
    for (const m of matches) {
      const existingMacs = new Set(listPhysicalDeviceMacs(m.id));
      const overlap = macs.filter((mac) => existingMacs.has(mac));
      if (overlap.length >= 2) {
        candidates.push({ physical_device_id: m.id, anchor: "mac_set", confidence: 70 });
      } else if (overlap.length === 1) {
        candidates.push({ physical_device_id: m.id, anchor: "single_mac", confidence: 50 });
      }
    }
  }

  // Anchor 4: sys_object_id + sysname
  if (device.sysname) {
    const match = findPhysicalDeviceBySysname(device.sysname);
    if (match) candidates.push({ physical_device_id: match.id, anchor: "sysname", confidence: 30 });
  }

  return candidates;
}

function chooseBest(candidates: MatchCandidate[]): MatchCandidate | null {
  if (candidates.length === 0) return null;
  // Aggrega per physical_device_id: somma score (cap a 100) + scegli anchor migliore
  const byId = new Map<number, { score: number; anchor: string }>();
  for (const c of candidates) {
    const cur = byId.get(c.physical_device_id);
    if (!cur || c.confidence > cur.score) {
      byId.set(c.physical_device_id, { score: c.confidence, anchor: c.anchor });
    }
  }
  let best: MatchCandidate | null = null;
  for (const [id, info] of byId) {
    if (!best || info.score > best.confidence) {
      best = { physical_device_id: id, anchor: info.anchor, confidence: info.score };
    }
  }
  return best;
}

/** Cerca una `networks` row la cui CIDR include l'IP dato. Restituisce id+cidr o null. */
function findNetworkContainingIp(ip: string, family: 4 | 6): { id: number; cidr: string } | null {
  if (family === 6) return null; // IPv6 non ancora gestito da `networks.cidr` (TODO Fase futura)
  // Strategia: leggiamo tutte le subnet IPv4 e usiamo un test in JS — DA-IPAM tipicamente < 100 subnet
  const networks = getDb()
    .prepare("SELECT id, cidr FROM networks WHERE cidr LIKE '%.%/%'")
    .all() as Array<{ id: number; cidr: string }>;
  for (const n of networks) {
    if (cidrContainsIpv4(n.cidr, ip)) return n;
  }
  return null;
}

function cidrContainsIpv4(cidr: string, ip: string): boolean {
  const [net, prefixStr] = cidr.split("/");
  const prefix = parseInt(prefixStr);
  if (!Number.isFinite(prefix) || prefix < 0 || prefix > 32) return false;
  const netInt = ipv4ToInt(net);
  const ipInt = ipv4ToInt(ip);
  if (netInt === null || ipInt === null) return false;
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  return (netInt & mask) === (ipInt & mask);
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".").map((s) => parseInt(s));
  if (parts.length !== 4 || parts.some((p) => !Number.isFinite(p) || p < 0 || p > 255)) return null;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

/** Crea un host se non esiste, ritorna `{host_id, created}`. */
function ensureHostForIp(networkId: number, ip: string, physicalDeviceId: number): { host_id: number; created: boolean } {
  const existing = getDb()
    .prepare("SELECT id, physical_device_id FROM hosts WHERE network_id = ? AND ip = ?")
    .get(networkId, ip) as { id: number; physical_device_id: number | null } | undefined;
  if (existing) {
    if (existing.physical_device_id !== physicalDeviceId) {
      setHostPhysicalDevice(existing.id, physicalDeviceId);
    }
    return { host_id: existing.id, created: false };
  }
  const res = getDb()
    .prepare(
      `INSERT INTO hosts (network_id, ip, status, host_source, physical_device_id, hostname_source)
       VALUES (?, ?, 'unknown', 'device_interface', ?, 'device_interface')`
    )
    .run(networkId, ip, physicalDeviceId);
  return { host_id: Number(res.lastInsertRowid), created: true };
}

export function resolvePhysicalDevice(device: NetworkDevice, probe: DeviceProbeOutcome): ResolveOutcome {
  const primaryMac = pickPrimaryMac(probe.interfaces);
  const candidates = findMatchCandidates(device, probe, primaryMac);
  const best = chooseBest(candidates);

  let physicalDeviceId: number;
  let created: boolean;
  let identityAnchor: string;
  let identityConfidence: number;

  if (best && best.confidence >= MIN_CONFIDENCE) {
    physicalDeviceId = best.physical_device_id;
    created = false;
    identityAnchor = best.anchor;
    identityConfidence = best.confidence;
    updatePhysicalDevice(physicalDeviceId, {
      vendor: device.vendor ?? undefined,
      model: device.model ?? undefined,
      serial_number: device.serial_number ?? undefined,
      primary_mac: primaryMac ?? undefined,
      sysname: device.sysname ?? undefined,
      identity_confidence: Math.max(best.confidence, identityConfidence),
      identity_anchor: best.anchor,
    });
  } else {
    const initialAnchor = device.serial_number
      ? "serial_number"
      : primaryMac
        ? "primary_mac"
        : device.sysname
          ? "sysname"
          : "unknown";
    const initialConfidence = device.serial_number ? 100 : primaryMac ? 80 : device.sysname ? 30 : 10;
    const created_ = createPhysicalDevice({
      vendor: device.vendor,
      model: device.model,
      serial_number: device.serial_number,
      primary_mac: primaryMac,
      sysname: device.sysname,
      identity_confidence: initialConfidence,
      identity_anchor: initialAnchor,
    });
    physicalDeviceId = created_.id;
    created = true;
    identityAnchor = initialAnchor;
    identityConfidence = initialConfidence;
  }

  // Aggancia il NetworkDevice
  setNetworkDevicePhysicalDevice(device.id, physicalDeviceId);

  // Upsert interfacce e indirizzi
  let interfacesUpserted = 0;
  let addressesUpserted = 0;
  const promoted: ResolveOutcome["promoted_hosts"] = [];
  for (const probeIface of probe.interfaces) {
    const iface = upsertDeviceInterface(physicalDeviceId, {
      ifname: probeIface.ifname,
      ifindex: probeIface.ifindex,
      mac: probeIface.mac,
      status: probeIface.status,
      speed_mbps: probeIface.speed_mbps,
      alias: probeIface.alias,
    });
    interfacesUpserted++;
    for (const addr of probeIface.addresses) {
      // Salta link-local e host-scope per non sporcare `hosts`
      if (addr.scope === "host" || addr.scope === "link") {
        upsertInterfaceAddress(iface.id, addr);
        addressesUpserted++;
        continue;
      }
      upsertInterfaceAddress(iface.id, addr);
      addressesUpserted++;

      // Promote: se l'IP cade in una network conosciuta, crea/aggancia host
      const network = findNetworkContainingIp(addr.ip, addr.family);
      if (network) {
        const { host_id, created } = ensureHostForIp(network.id, addr.ip, physicalDeviceId);
        promoted.push({ host_id, ip: addr.ip, network_id: network.id, created });
      }
    }
  }

  return {
    physical_device_id: physicalDeviceId,
    created,
    identity_anchor: identityAnchor,
    identity_confidence: identityConfidence,
    interfaces_upserted: interfacesUpserted,
    addresses_upserted: addressesUpserted,
    promoted_hosts: promoted,
  };
}
