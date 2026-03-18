import type { PortInfo } from "./switch-client";

type SnmpWalkFn = (oid: string) => Promise<{ oid: string; value: Buffer | string | number }[]>;

/**
 * Recupera schema porte (interfacce) via SNMP con LLDP/CDP per router e switch.
 * Usa IF-MIB, LLDP-MIB, CISCO-CDP-MIB.
 */
export async function getSnmpPortSchema(snmpWalk: SnmpWalkFn): Promise<PortInfo[]> {
  const ifDescrMap = new Map<number, string>();
  const ifOperStatusMap = new Map<number, "up" | "down">();
  const ifSpeedMap = new Map<number, string>();

  try {
    const ifDescrResults = await snmpWalk("1.3.6.1.2.1.2.2.1.2");
    for (const r of ifDescrResults) {
      const ifIndex = parseInt(r.oid.split(".").pop()!);
      ifDescrMap.set(ifIndex, String(r.value));
    }
  } catch { /* optional */ }

  try {
    const ifOperResults = await snmpWalk("1.3.6.1.2.1.2.2.1.8");
    for (const r of ifOperResults) {
      const ifIndex = parseInt(r.oid.split(".").pop()!);
      ifOperStatusMap.set(ifIndex, Number(r.value) === 1 ? "up" : "down");
    }
  } catch { /* optional */ }

  try {
    const ifSpeedResults = await snmpWalk("1.3.6.1.2.1.31.1.1.1.15");
    for (const r of ifSpeedResults) {
      const ifIndex = parseInt(r.oid.split(".").pop()!);
      const mbps = Number(r.value);
      ifSpeedMap.set(ifIndex, mbps > 0 ? `${mbps} Mbps` : "");
    }
  } catch { /* optional */ }

  const pvidMap = new Map<number, number>();
  try {
    const pvidResults = await snmpWalk("1.3.6.1.2.1.17.7.1.4.5.1.1");
    for (const r of pvidResults) {
      const portIdx = parseInt(r.oid.split(".").pop()!);
      pvidMap.set(portIdx, Number(r.value));
    }
  } catch { /* optional */ }

  const duplexMap = new Map<number, string>();
  try {
    const duplexResults = await snmpWalk("1.3.6.1.2.1.26.2.1.1.14");
    for (const r of duplexResults) {
      const ifIndex = parseInt(r.oid.split(".").pop()!);
      const val = Number(r.value);
      duplexMap.set(ifIndex, val === 3 ? "full" : val === 2 ? "half" : "unknown");
    }
  } catch { /* optional */ }

  const poeStatusMap = new Map<string, string>();
  try {
    const poeResults = await snmpWalk("1.3.6.1.2.1.105.1.1.1.6");
    for (const r of poeResults) {
      const parts = r.oid.split(".");
      const key = parts.slice(-2).join(".");
      const val = Number(r.value);
      const labels: Record<number, string> = { 1: "disabled", 2: "searching", 3: "delivering", 4: "fault", 5: "test", 6: "otherFault" };
      poeStatusMap.set(key, labels[val] || `status-${val}`);
    }
  } catch { /* optional */ }

  const poePowerMap = new Map<string, number>();
  try {
    const poePowerResults = await snmpWalk("1.3.6.1.2.1.105.1.1.1.4");
    for (const r of poePowerResults) {
      const parts = r.oid.split(".");
      const key = parts.slice(-2).join(".");
      poePowerMap.set(key, Number(r.value));
    }
  } catch { /* optional */ }

  const ifAdminMap = new Map<number, number>();
  try {
    const adminResults = await snmpWalk("1.3.6.1.2.1.2.2.1.7");
    for (const r of adminResults) {
      const ifIndex = parseInt(r.oid.split(".").pop()!);
      ifAdminMap.set(ifIndex, Number(r.value));
    }
  } catch { /* optional */ }

  const bridgePortMap = new Map<number, number>();
  try {
    const portIndexResults = await snmpWalk("1.3.6.1.2.1.17.1.4.1.2");
    for (const r of portIndexResults) {
      const bridgePort = parseInt(r.oid.split(".").pop()!);
      bridgePortMap.set(Number(r.value), bridgePort);
    }
  } catch { /* optional */ }

  const stpStateByBridgePort = new Map<number, string>();
  const stpStateByIfIndex = new Map<number, string>();
  try {
    const stpResults = await snmpWalk("1.3.6.1.2.1.17.2.15.1.3");
    const labels: Record<number, string> = {
      1: "disabled", 2: "blocking", 3: "listening", 4: "learning", 5: "forwarding", 6: "broken",
    };
    for (const r of stpResults) {
      const bridgePort = parseInt(r.oid.split(".").pop()!);
      const val = Number(r.value);
      const state = labels[val] || `stp-${val}`;
      stpStateByBridgePort.set(bridgePort, state);
    }
    // Mappa ifIndex -> stato STP usando dot1dBasePortIfIndex (bridgePort -> ifIndex)
    for (const [ifIdx, brPort] of bridgePortMap) {
      const state = stpStateByBridgePort.get(brPort);
      if (state) stpStateByIfIndex.set(ifIdx, state);
    }
  } catch { /* STP opzionale */ }

  const neighborByPort = new Map<number, { name: string; port: string }>();
  try {
    const lldpSysResults = await snmpWalk("1.0.8802.1.1.2.1.4.1.1.9");
    const lldpPortResults = await snmpWalk("1.0.8802.1.1.2.1.4.1.1.8");
    const lldpSysByKey = new Map<string, string>();
    const lldpPortByKey = new Map<string, string>();
    for (const r of lldpSysResults) {
      lldpSysByKey.set(r.oid, String(r.value ?? "").trim());
    }
    for (const r of lldpPortResults) {
      lldpPortByKey.set(r.oid, String(r.value ?? "").trim());
    }
    for (const r of lldpSysResults) {
      const parts = r.oid.split(".");
      const localPortNum = parseInt(parts[parts.length - 2]);
      const name = (lldpSysByKey.get(r.oid) || "").trim();
      const port = (lldpPortByKey.get(r.oid) || "").trim();
      if (name || port) {
        neighborByPort.set(localPortNum, { name, port });
      }
    }
  } catch { /* LLDP opzionale */ }

  try {
    const cdpIdResults = await snmpWalk("1.3.6.1.4.1.9.9.23.1.2.1.1.6");
    const cdpPortResults = await snmpWalk("1.3.6.1.4.1.9.9.23.1.2.1.1.7");
    const cdpPortBySuffix = new Map<string, string>();
    for (const r of cdpPortResults) {
      const suffix = r.oid.split(".").slice(-2).join(".");
      cdpPortBySuffix.set(suffix, String(r.value ?? "").trim());
    }
    for (const r of cdpIdResults) {
      const parts = r.oid.split(".");
      const ifIndex = parseInt(parts[parts.length - 2]);
      const suffix = parts.slice(-2).join(".");
      const name = String(r.value ?? "").trim();
      const port = (cdpPortBySuffix.get(suffix) || "").trim();
      if (name || port) {
        const existing = neighborByPort.get(ifIndex);
        if (!existing) neighborByPort.set(ifIndex, { name, port });
      }
    }
  } catch { /* CDP opzionale (Cisco) */ }

  const ports: PortInfo[] = [];
  for (const [ifIndex, name] of ifDescrMap.entries()) {
    const trimmedName = name.trim();
    if (/^lo$|^null|^cpu|^stack/i.test(trimmedName)) continue;

    const adminStatus = ifAdminMap.get(ifIndex);
    const operStatus = ifOperStatusMap.get(ifIndex);
    let status: "up" | "down" | "disabled" | null = null;
    if (adminStatus === 2) status = "disabled";
    else if (operStatus === "up") status = "up";
    else if (operStatus === "down") status = "down";

    const speed = ifSpeedMap.get(ifIndex) || null;
    const duplex = duplexMap.get(ifIndex) || null;
    const bridgePort = bridgePortMap.get(ifIndex);
    const vlan = bridgePort ? (pvidMap.get(bridgePort) ?? null) : null;

    const poeKey = bridgePort ? `1.${bridgePort}` : null;
    const poe_status = poeKey ? (poeStatusMap.get(poeKey) ?? null) : null;
    const poe_power_mw = poeKey ? (poePowerMap.get(poeKey) ?? null) : null;

    const neighbor = neighborByPort.get(ifIndex) ?? (bridgePort != null ? neighborByPort.get(bridgePort) : null);
    const trunk_neighbor_name = neighbor?.name ? neighbor.name : null;
    const trunk_neighbor_port = neighbor?.port ? neighbor.port : null;
    const stp_state = (bridgePort != null ? stpStateByBridgePort.get(bridgePort) : null)
      ?? stpStateByIfIndex.get(ifIndex)
      ?? (stpStateByBridgePort.get(ifIndex) ?? null);

    ports.push({
      port_index: ifIndex,
      port_name: trimmedName,
      status,
      speed: speed || null,
      duplex,
      vlan,
      poe_status,
      poe_power_mw,
      trunk_neighbor_name: trunk_neighbor_name || null,
      trunk_neighbor_port: trunk_neighbor_port || null,
      stp_state,
    });
  }

  return ports;
}
