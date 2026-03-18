/**
 * Recupera informazioni globali Spanning Tree (STP/RSTP) via SNMP BRIDGE-MIB.
 * Bridge ID, Root Bridge ID, Priority, Root Cost, Root Port, Hello Time, Forward Delay, Max Age.
 */

type SnmpWalkFn = (oid: string) => Promise<{ oid: string; value: Buffer | string | number }[]>;

export interface StpInfo {
  bridge_id: string | null;
  root_bridge_id: string | null;
  priority: number | null;
  root_cost: number | null;
  root_port: string | null;
  hello_time_s: number | null;
  forward_delay_s: number | null;
  max_age_s: number | null;
  is_root_bridge: boolean;
  protocol: "stp" | "rstp" | null;
}

function formatBridgeId(buf: Buffer | string): string {
  if (Buffer.isBuffer(buf) && buf.length >= 8) {
    const prio = buf.readUInt16BE(0);
    const mac = buf.slice(2, 8);
    const macStr = mac.toString("hex").padStart(12, "0").replace(/(.{2})(?=.)/g, "$1:");
    return `${prio}.${macStr}`;
  }
  if (typeof buf === "string") {
    return buf;
  }
  return "";
}

async function getSingleOid(snmpWalk: SnmpWalkFn, oid: string): Promise<Buffer | string | number | null> {
  try {
    const rows = await snmpWalk(oid);
    return rows.length > 0 ? rows[0].value : null;
  } catch {
    return null;
  }
}

/** OID BRIDGE-MIB */
const OIDS = {
  bridgeAddress: "1.3.6.1.2.1.17.1.1",       // dot1dBaseBridgeAddress (6 octets MAC)
  stpPriority: "1.3.6.1.2.1.17.2.2",          // dot1dStpPriority
  designatedRoot: "1.3.6.1.2.1.17.2.5",       // dot1dStpDesignatedRoot (8 octets BridgeId)
  rootCost: "1.3.6.1.2.1.17.2.6",              // dot1dStpRootCost
  rootPort: "1.3.6.1.2.1.17.2.7",             // dot1dStpRootPort (0 = root bridge)
  maxAge: "1.3.6.1.2.1.17.2.8",               // dot1dStpMaxAge (centiseconds)
  helloTime: "1.3.6.1.2.1.17.2.9",            // dot1dStpHelloTime (centiseconds)
  forwardDelay: "1.3.6.1.2.1.17.2.11",        // dot1dStpForwardDelay (centiseconds)
  protocolSpec: "1.3.6.1.2.1.17.2.1",        // dot1dStpProtocolSpecification (1=unknown, 2=decLb100, 3=ieee8021d)
};

export async function getSnmpStpInfo(snmpWalk: SnmpWalkFn): Promise<StpInfo | null> {
  try {
    const [bridgeAddr, priority, designatedRoot, rootCost, rootPort, maxAge, helloTime, forwardDelay, protocolSpec] =
      await Promise.all([
        getSingleOid(snmpWalk, OIDS.bridgeAddress),
        getSingleOid(snmpWalk, OIDS.stpPriority),
        getSingleOid(snmpWalk, OIDS.designatedRoot),
        getSingleOid(snmpWalk, OIDS.rootCost),
        getSingleOid(snmpWalk, OIDS.rootPort),
        getSingleOid(snmpWalk, OIDS.maxAge),
        getSingleOid(snmpWalk, OIDS.helloTime),
        getSingleOid(snmpWalk, OIDS.forwardDelay),
        getSingleOid(snmpWalk, OIDS.protocolSpec),
      ]);

    if (designatedRoot == null && priority == null) return null;

    const prio = priority != null ? Number(priority) : null;
    const rootCostNum = rootCost != null ? Number(rootCost) : null;
    const rootPortNum = rootPort != null ? Number(rootPort) : null;

    let bridgeId: string | null = null;
    if (Buffer.isBuffer(bridgeAddr) && bridgeAddr.length >= 6 && prio != null) {
      const buf = Buffer.alloc(8);
      buf.writeUInt16BE(prio, 0);
      bridgeAddr.copy(buf, 2);
      bridgeId = formatBridgeId(buf);
    }

    let rootBridgeId: string | null = null;
    if (Buffer.isBuffer(designatedRoot) && designatedRoot.length >= 8) {
      rootBridgeId = formatBridgeId(designatedRoot);
    }

    const maxAgeVal = maxAge != null ? Number(maxAge) : null;
    const helloTimeVal = helloTime != null ? Number(helloTime) : null;
    const forwardDelayVal = forwardDelay != null ? Number(forwardDelay) : null;

    const isRootBridge = rootPortNum === 0;
    const rootPortStr = rootPortNum != null && rootPortNum > 0 ? String(rootPortNum) : "none";

    const protocol = protocolSpec != null ? (Number(protocolSpec) === 3 ? "rstp" : "stp") : null;

    return {
      bridge_id: bridgeId,
      root_bridge_id: rootBridgeId,
      priority: prio,
      root_cost: rootCostNum,
      root_port: rootPortStr,
      hello_time_s: helloTimeVal != null ? helloTimeVal / 100 : null,
      forward_delay_s: forwardDelayVal != null ? forwardDelayVal / 100 : null,
      max_age_s: maxAgeVal != null ? maxAgeVal / 100 : null,
      is_root_bridge: isRootBridge,
      protocol,
    };
  } catch {
    return null;
  }
}
