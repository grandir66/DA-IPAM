/**
 * Opzioni vendor per network_devices: etichette di base + costruzione dinamica
 * da profili SNMP abilitati (profile_id, OID enterprise) e stringhe rilevate sugli host IPAM.
 */

import type { NetworkDevice } from "@/types";
import { inferNetworkDeviceVendorFromHostHint } from "@/lib/device-vendor-infer";

export const NETWORK_DEVICE_VENDOR_BASE_LABELS: Record<NetworkDevice["vendor"], string> = {
  mikrotik: "MikroTik",
  ubiquiti: "Ubiquiti",
  cisco: "Cisco",
  hp: "HPE",
  omada: "TP-Link Omada",
  stormshield: "Stormshield",
  proxmox: "Proxmox",
  vmware: "VMware",
  linux: "Linux",
  windows: "Windows",
  synology: "Synology",
  qnap: "QNAP",
  other: "Altro",
};

/** Ordine elenco UI (Altro in coda). */
export const NETWORK_DEVICE_VENDOR_ORDER: readonly NetworkDevice["vendor"][] = [
  "mikrotik",
  "ubiquiti",
  "windows",
  "linux",
  "proxmox",
  "synology",
  "qnap",
  "hp",
  "omada",
  "stormshield",
  "cisco",
  "vmware",
  "other",
];

export interface NetworkDeviceVendorSelectOption {
  value: NetworkDevice["vendor"];
  /** Solo nome marca (lista leggibile). */
  label: string;
  /** Opzionale: contesto SNMP/IPAM per tooltip, non nel testo della voce. */
  hint?: string;
}

export function getDefaultNetworkDeviceVendorOptions(): NetworkDeviceVendorSelectOption[] {
  return NETWORK_DEVICE_VENDOR_ORDER.map((v) => ({
    value: v,
    label: NETWORK_DEVICE_VENDOR_BASE_LABELS[v],
  })).sort((a, b) => a.label.localeCompare(b.label, "it", { sensitivity: "base" }));
}

/**
 * Mappa profile_id del catalogo SNMP (snmp_vendor_profiles) → slug network_devices.vendor.
 */
export function mapSnmpProfileIdToNetworkDeviceVendor(profileId: string): NetworkDevice["vendor"] {
  const id = profileId.trim().toLowerCase();
  if (!id) return "other";

  if (id.startsWith("ubiquiti")) return "ubiquiti";
  if (id.startsWith("mikrotik")) return "mikrotik";
  if (id.startsWith("cisco")) return "cisco";
  if (id.startsWith("hp_") || id.startsWith("hpe_") || id.startsWith("aruba")) return "hp";
  if (id.startsWith("tplink_omada") || id === "omada") return "omada";
  if (id.startsWith("stormshield")) return "stormshield";
  if (id === "synology") return "synology";
  if (id === "qnap" || id.startsWith("qnap_")) return "qnap";
  if (id.startsWith("proxmox")) return "proxmox";
  if (id.startsWith("vmware")) return "vmware";
  if (id.includes("linux")) return "linux";
  if (id.includes("windows")) return "windows";

  return "other";
}

function parseEnterpriseOidPrefixes(json: string): string[] {
  try {
    const p = JSON.parse(json) as unknown;
    if (!Array.isArray(p)) return [];
    return p.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
  } catch {
    return [];
  }
}

function truncateHint(s: string, max = 480): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

type Slug = NetworkDevice["vendor"];

interface SlugAccum {
  snmpNames: Set<string>;
  snmpOidSamples: Set<string>;
  ipamRaw: Set<string>;
}

function emptyAccum(): SlugAccum {
  return {
    snmpNames: new Set(),
    snmpOidSamples: new Set(),
    ipamRaw: new Set(),
  };
}

/**
 * Costruisce le opzioni select: **label** = solo marca (sempre leggibile).
 * Profili SNMP e stringhe IPAM restano in **hint** per tooltip, non nel menu.
 */
export function buildNetworkDeviceVendorSelectOptionsFromData(input: {
  snmpProfiles: Array<{ profile_id: string; name: string; enterprise_oid_prefixes: string }>;
  hostVendorHints: string[];
}): NetworkDeviceVendorSelectOption[] {
  const bySlug = new Map<Slug, SlugAccum>();
  for (const v of NETWORK_DEVICE_VENDOR_ORDER) {
    bySlug.set(v, emptyAccum());
  }

  for (const p of input.snmpProfiles) {
    const slug = mapSnmpProfileIdToNetworkDeviceVendor(p.profile_id);
    const acc = bySlug.get(slug)!;
    if (p.name?.trim()) acc.snmpNames.add(p.name.trim());
    const prefixes = parseEnterpriseOidPrefixes(p.enterprise_oid_prefixes);
    for (const pr of prefixes.slice(0, 2)) {
      const short = pr.length > 36 ? `${pr.slice(0, 33)}…` : pr;
      acc.snmpOidSamples.add(short);
    }
  }

  for (const raw of input.hostVendorHints) {
    const trimmed = raw?.trim();
    if (!trimmed) continue;
    const inferred = inferNetworkDeviceVendorFromHostHint(trimmed);
    const slug: Slug = inferred ?? "other";
    bySlug.get(slug)!.ipamRaw.add(trimmed);
  }

  return NETWORK_DEVICE_VENDOR_ORDER.map((slug) => {
    const base = NETWORK_DEVICE_VENDOR_BASE_LABELS[slug];
    const acc = bySlug.get(slug)!;
    const hasSnmp = acc.snmpNames.size > 0 || acc.snmpOidSamples.size > 0;
    const hasIpam = acc.ipamRaw.size > 0;
    if (!hasSnmp && !hasIpam) {
      return { value: slug, label: base };
    }

    const parts: string[] = [];
    if (hasSnmp) {
      const names = [...acc.snmpNames].sort((a, b) => a.localeCompare(b, "it")).slice(0, 5);
      const oidBit =
        acc.snmpOidSamples.size > 0
          ? ` · OID ${[...acc.snmpOidSamples].sort((a, b) => a.localeCompare(b)).slice(0, 2).join(", ")}`
          : "";
      parts.push(`Profili SNMP: ${names.join(", ")}${oidBit}`);
    }
    if (hasIpam) {
      const samples = [...acc.ipamRaw].sort((a, b) => a.localeCompare(b, "it")).slice(0, 4);
      parts.push(
        `Rilevato su host: ${samples.map((s) => (s.length > 36 ? `"${s.slice(0, 33)}…"` : `"${s}"`)).join(", ")}`
      );
    }
    return {
      value: slug,
      label: base,
      hint: truncateHint(parts.join(" — ")),
    };
  }).sort((a, b) => a.label.localeCompare(b.label, "it", { sensitivity: "base" }));
}
