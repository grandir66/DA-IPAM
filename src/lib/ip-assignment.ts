/**
 * Derivazione statico/dinamico/riservato da tabelle DHCP unificate e da DHCP Windows (AD).
 * La risoluzione del lease preferisce il match su MAC (host ↔ record DHCP), poi l’IP.
 */

import { macToHex } from "@/lib/utils";

export type IpAssignment = "unknown" | "dynamic" | "static" | "reserved";

/** MAC non valido / vuoto dopo normalizzazione esadecimale */
function hostMacHex(hostMac: string | null | undefined): string | null {
  if (!hostMac?.trim()) return null;
  const h = macToHex(hostMac);
  return h.length === 12 && h !== "000000000000" ? h : null;
}

/**
 * Sceglie il lease DHCP della rete più coerente con l’host:
 * 1) stesso MAC (normalizzato) — se più righe, preferisce IP uguale all’host, altrimenti la più recente (`last_synced`);
 * 2) altrimenti lease con stesso IP.
 */
export function resolveDhcpLeaseForHost<L extends { ip_address: string; mac_address: string; last_synced?: string | null }>(
  hostIp: string,
  hostMac: string | null | undefined,
  leasesInNetwork: L[],
): L | undefined {
  const hex = hostMacHex(hostMac);
  if (hex) {
    const withMac = leasesInNetwork.filter((l) => l.mac_address && macToHex(l.mac_address) === hex);
    if (withMac.length > 0) {
      const exact = withMac.find((l) => l.ip_address === hostIp);
      if (exact) return exact;
      return withMac.sort((a, b) => String(b.last_synced ?? "").localeCompare(String(a.last_synced ?? "")))[0];
    }
  }
  return leasesInNetwork.find((l) => l.ip_address === hostIp);
}

/**
 * Lease AD (Microsoft): prima per IP dell’host; se assente, qualsiasi riga AD con stesso MAC dell’host.
 */
export function resolveAdDhcpLeaseForHost<L extends { ip_address: string; mac_address: string; last_synced?: string }>(
  hostIp: string,
  hostMac: string | null | undefined,
  byIpAd: Map<string, L>,
  allAdRows: L[],
): L | undefined {
  const byIp = byIpAd.get(hostIp);
  if (byIp) return byIp;
  const hex = hostMacHex(hostMac);
  if (!hex) return undefined;
  const candidates = allAdRows.filter((a) => a.mac_address && macToHex(a.mac_address) === hex);
  if (candidates.length === 0) return undefined;
  const exact = candidates.find((a) => a.ip_address === hostIp);
  if (exact) return exact;
  return candidates.sort((a, b) => String(b.last_synced ?? "").localeCompare(String(a.last_synced ?? "")))[0];
}

export function inferIpAssignment(
  lease: {
    status?: string | null;
    lease_expires?: string | null;
    description?: string | null;
    /** MikroTik RouterOS: 1 = lease dinamico dal pool, 0 = lease statico (IP fisso su MAC) */
    dynamic_lease?: number | null;
  } | null | undefined,
  adLease: { address_state?: string | null; lease_expires?: string | null } | null | undefined
): IpAssignment {
  if (lease?.dynamic_lease === 1) return "dynamic";
  if (lease?.dynamic_lease === 0) return "static";
  const adState = adLease?.address_state?.toLowerCase() ?? "";
  if (adState) {
    if (adState.includes("reservation") || adState.includes("reserved")) return "reserved";
    if (adState.includes("active")) return "dynamic";
  }
  if (lease) {
    const desc = lease.description?.toLowerCase() ?? "";
    if (desc.includes("reservation") || desc.includes("reserved")) return "reserved";
    if (desc.includes("static")) return "static";
    const st = lease.status?.toLowerCase() ?? "";
    if (st.includes("static")) return "static";
    if (lease.lease_expires && lease.lease_expires.trim() !== "") return "dynamic";
    if (st.includes("bound") || st.includes("active")) return "dynamic";
  }
  if (adLease?.lease_expires && adLease.lease_expires.trim() !== "") return "dynamic";
  return "unknown";
}

export const IP_ASSIGNMENT_LABELS: Record<IpAssignment, string> = {
  unknown: "Non noto",
  dynamic: "Dinamico (DHCP)",
  static: "Statico",
  reserved: "Riservato DHCP",
};

/** Badge compatto in IPAM: DYN / STAT; null = non mostrare nulla. */
export function ipAssignmentShortLabel(kind: IpAssignment | undefined): "DYN" | "STAT" | null {
  if (!kind || kind === "unknown") return null;
  if (kind === "dynamic") return "DYN";
  if (kind === "static" || kind === "reserved") return "STAT";
  return null;
}
