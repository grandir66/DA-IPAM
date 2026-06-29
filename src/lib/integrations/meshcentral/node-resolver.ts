/**
 * resolveNodeToHostId — auto-resolve a MeshCentral node to a DA-IPAM host.
 *
 * Resolution order: MAC → IP → hostname (case-insensitive).
 * Virtual MACs (VRRP, HSRP, zero) are skipped before MAC lookup.
 * node.ip is passed as preferIp to getHostByMac to disambiguate MAC collisions (B4 fix).
 */

import { getHostByMac, getHostByIp, getTenantDb, getCurrentTenantCode } from "@/lib/db-tenant";
import { isVirtualMac } from "@/lib/devices/physical-device-db";
import type { Host } from "@/types";
import type { MeshNode } from "@/lib/integrations/meshcentral/control-client";

export interface NodeMatch {
  hostId: number | null;
  matchStatus: "matched" | "unmatched";
  mac?: string;
  ip?: string;
}

/** Zero MAC used by some hypervisors / misconfigured NICs — not a valid anchor. */
const ZERO_MAC = "00:00:00:00:00:00";

function isSkippableMac(mac: string): boolean {
  return mac === ZERO_MAC || isVirtualMac(mac);
}

function matchByHostname(name: string): Host | undefined {
  const trimmed = name.trim();
  if (!trimmed) return undefined;
  const code = getCurrentTenantCode();
  if (!code) return undefined;
  return getTenantDb(code)
    .prepare(
      "SELECT * FROM hosts WHERE hostname = ? COLLATE NOCASE OR custom_name = ? COLLATE NOCASE ORDER BY id LIMIT 1"
    )
    .get(trimmed, trimmed) as Host | undefined;
}

/**
 * Auto-resolve a MeshCentral node to a DA-IPAM host.
 *
 * 1. Iterate all node.macs, skip virtual/zero MACs, call getHostByMac(mac, node.ip).
 * 2. If no MAC hit and node.ip is set, try getHostByIp(node.ip).
 * 3. If still no match and node.rname is set, try case-insensitive hostname lookup.
 * 4. No match → { hostId: null, matchStatus: 'unmatched' }.
 */
export function resolveNodeToHostId(node: MeshNode): NodeMatch {
  const preferIp = node.ip ?? undefined;

  // Phase 1: MAC anchors
  for (const mac of node.macs) {
    if (isSkippableMac(mac)) continue;
    const host = getHostByMac(mac, preferIp);
    if (host) {
      return { hostId: host.id, matchStatus: "matched", mac, ip: host.ip };
    }
  }

  // Phase 2: IP fallback
  if (node.ip) {
    const host = getHostByIp(node.ip);
    if (host) {
      return { hostId: host.id, matchStatus: "matched", ip: host.ip };
    }
  }

  // Phase 3: hostname fallback (rname preferred; name as secondary)
  const nameToTry = node.rname || node.name;
  if (nameToTry) {
    const host = matchByHostname(nameToTry);
    if (host) {
      return { hostId: host.id, matchStatus: "matched", ip: host.ip };
    }
  }

  return { hostId: null, matchStatus: "unmatched" };
}
