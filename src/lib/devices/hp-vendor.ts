/**
 * HP ProCurve / Aruba e HP Comware: comandi SSH specifici per MAC table, LLDP, port schema, STP.
 * ProCurve usa shell interattiva (show ...), Comware usa exec (display ...).
 * Integrato da DA-MKNET: parsing STP per entrambi i vendor.
 */

import type { MacTableEntry, PortInfo } from "./switch-client";
import type { StpInfo } from "./snmp-stp-info";
import { sshExec, sshExecViaShell } from "./ssh-helper";

export interface HpConnectionOptions {
  host: string;
  port?: number;
  username: string;
  password: string;
  timeout?: number;
}

export interface LldpNeighbor {
  interface: string;
  chassisId: string;
  systemName: string;
  systemDescription: string;
  portId: string;
  ipAddress?: string | null;
}

async function runProcurve(options: HpConnectionOptions, cmd: string): Promise<string> {
  try {
    const r = await sshExec(options, cmd);
    if (r.stdout.includes("not supported") || r.stdout.length < 20) {
      const r2 = await sshExecViaShell(options, cmd);
      return r2.stdout;
    }
    return r.stdout;
  } catch {
    const r = await sshExecViaShell(options, cmd);
    return r.stdout;
  }
}

async function runComware(options: HpConnectionOptions, cmd: string): Promise<string> {
  const r = await sshExec(options, cmd);
  return r.stdout;
}

async function runComwareViaShell(options: HpConnectionOptions, cmd: string): Promise<string> {
  const r = await sshExecViaShell(options, cmd);
  return r.stdout;
}

// ==================== HP ProCurve / Aruba ====================

export async function getHpProcurveMacTable(options: HpConnectionOptions): Promise<MacTableEntry[]> {
  const output = await runProcurve(options, "show mac-address");
  return parseHpProcurveMacTable(output);
}

function parseHpProcurveMacTable(output: string): MacTableEntry[] {
  const entries: MacTableEntry[] = [];
  for (const line of output.split("\n")) {
    const macMatch = line.match(/([0-9a-fA-F]{2}[:-][0-9a-fA-F]{2}[:-][0-9a-fA-F]{2}[:-][0-9a-fA-F]{2}[:-][0-9a-fA-F]{2}[:-][0-9a-fA-F]{2})/);
    if (macMatch) {
      const afterMac = line.substring(line.indexOf(macMatch[0]) + macMatch[0].length);
      const portMatch = afterMac.match(/\s+\S+\s+(\S+)/);
      const vlanMatch = line.match(/VLAN\s+(\d+)/i);
      entries.push({
        mac: macMatch[1].toUpperCase(),
        port_name: portMatch?.[1] || "unknown",
        vlan: vlanMatch ? parseInt(vlanMatch[1]) : null,
        port_status: null,
        speed: null,
      });
    }
  }
  return entries;
}

export async function getHpProcurveLldpNeighbors(options: HpConnectionOptions): Promise<LldpNeighbor[]> {
  const output = await runProcurve(options, "show lldp info remote-device");
  return parseHpProcurveLldp(output);
}

function parseHpProcurveLldp(output: string): LldpNeighbor[] {
  const neighbors: LldpNeighbor[] = [];
  const lines = output.split("\n");
  const isDetailed = output.includes("Local Port   :") || output.includes("ChassisId  :");

  if (isDetailed) {
    let current: Partial<LldpNeighbor> | null = null;
    for (const line of lines) {
      const t = line.trim();
      if (t.startsWith("Local Port") && t.includes(":")) {
        if (current?.interface && current.chassisId) {
          neighbors.push(current as LldpNeighbor);
        }
        const m = t.match(/Local Port\s*:\s*(\S+)/);
        current = { interface: m?.[1] ?? "unknown", chassisId: "", systemName: "", systemDescription: "", portId: "" };
        continue;
      }
      if (!current) continue;
      if (t.startsWith("ChassisId") && t.includes(":")) {
        const m = t.match(/ChassisId\s*:\s*(.+)/);
        if (m) {
          const v = m[1].trim();
          current.chassisId = v.includes("-") ? v.replace(/-/g, "").match(/.{2}/g)?.join(":") ?? v : v.replace(/\s+/g, ":");
        }
      } else if (t.startsWith("PortId") && t.includes(":")) {
        const m = t.match(/PortId\s*:\s*(.+)/);
        if (m) current.portId = m[1].trim().replace(/\s+/g, ":");
      } else if (t.startsWith("SysName") && t.includes(":")) {
        const m = t.match(/SysName\s*:\s*(.+)/);
        if (m) current.systemName = m[1].trim();
      } else if (t.startsWith("System Descr") && t.includes(":")) {
        const m = t.match(/System Descr\s*:\s*(.+)/);
        if (m) current.systemDescription = m[1].trim();
      } else if (t.match(/Address\s*:\s*(\d+\.\d+\.\d+\.\d+)/)) {
        const m = t.match(/Address\s*:\s*(\d+\.\d+\.\d+\.\d+)/);
        if (m) current.ipAddress = m[1];
      }
    }
    if (current?.interface && current.chassisId) neighbors.push(current as LldpNeighbor);
  } else {
    let inData = false;
    for (const line of lines) {
      if (line.includes("-----")) { inData = true; continue; }
      if (!inData || !line.trim()) continue;
      const parts = line.replace(/\|/g, " ").split(/\s{2,}/).map((p) => p.trim()).filter(Boolean);
      if (parts.length >= 3 && parts[0] && !parts[0].toLowerCase().includes("localport")) {
        const chassisId = parts[1].includes(" ") ? parts[1].replace(/\s+/g, ":") : parts[1];
        neighbors.push({
          interface: parts[0],
          chassisId,
          systemName: parts[4] ?? parts[3] ?? "Unknown",
          systemDescription: parts[3] ?? "",
          portId: parts[2] ?? parts[0],
        });
      }
    }
  }
  return neighbors;
}

export async function getHpProcurvePortSchema(options: HpConnectionOptions): Promise<PortInfo[]> {
  const output = await runProcurve(options, "show interface brief");
  return parseHpProcurveInterfaceBrief(output);
}

function parseHpProcurveInterfaceBrief(output: string): PortInfo[] {
  const ports: PortInfo[] = [];
  const lines = output.split("\n");
  let idx = 0;
  for (const line of lines) {
    if (line.includes("Port") && line.includes("Type")) continue;
    if (line.includes("----")) continue;
    if (!line.trim()) continue;
    const m = line.match(/^\s*([A-Z]?\d+)\s+(\S+)\s+(?:\|\s+)?(\S+)\s+(\S+)\s+(\S+)\s+(\S+)/);
    if (m) {
      const [, port, type, , enabled, status, mode] = m;
      if (port?.toLowerCase() === "port") continue;
      idx++;
      ports.push({
        port_index: idx,
        port_name: port ?? `Port${idx}`,
        status: status?.toLowerCase() === "up" ? "up" : status?.toLowerCase() === "down" ? "down" : "disabled",
        speed: type ?? null,
        duplex: null,
        vlan: null,
        poe_status: null,
        poe_power_mw: null,
        trunk_neighbor_name: null,
        trunk_neighbor_port: null,
        stp_state: null,
      });
    }
  }
  return ports;
}

/** Converte MAC HP (es. "20677c-ced5c0") in formato "20:67:7c:ce:d5:c0" */
function hpMacToColon(s: string): string {
  const hex = s.replace(/[-:.\s]/g, "").toLowerCase();
  if (hex.length === 12) return hex.replace(/(.{2})/g, "$1:").slice(0, -1);
  return s;
}

/**
 * STP per HP ProCurve / Aruba (da DA-MKNET).
 * Comando: show spanning-tree
 * Formato: Switch MAC Address, CST Root MAC Address, CST Root Priority, CST Root Path Cost, CST Root Port
 */
export async function getHpProcurveStpInfo(options: HpConnectionOptions): Promise<StpInfo | null> {
  try {
    const output = await runProcurve(options, "show spanning-tree");
    const stpEnabledMatch = output.match(/STP Enabled\s*:\s*(\S+)/i);
    if (stpEnabledMatch && stpEnabledMatch[1].toLowerCase() !== "yes") return null;

    const switchMacMatch = output.match(/Switch MAC Address\s*:\s*(\S+)/i);
    const switchPriorityMatch = output.match(/Switch Priority\s*:\s*(\d+)/i);
    const rootMacMatch = output.match(/CST Root MAC Address\s*:\s*(\S+)/i);
    const rootPriorityMatch = output.match(/CST Root Priority\s*:\s*(\d+)/i);
    const rootCostMatch = output.match(/CST Root Path Cost\s*:\s*(\d+)/i);
    const rootPortMatch = output.match(/CST Root Port\s*:\s*(\S+)/i);
    const maxAgeMatch = output.match(/Max Age\s*:\s*(\d+)/i);
    const forwardDelayMatch = output.match(/Forward Delay\s*:\s*(\d+)/i);
    const helloTimeMatch = output.match(/Hello Time\s*:\s*(\d+)/i);

    const switchMac = switchMacMatch?.[1];
    if (!switchMac) return null;

    const switchPriority = switchPriorityMatch ? parseInt(switchPriorityMatch[1], 10) : 32768;
    const rootMac = rootMacMatch?.[1] ?? switchMac;
    const rootPriority = rootPriorityMatch ? parseInt(rootPriorityMatch[1], 10) : switchPriority;

    const bridgeId = `${switchPriority}.${hpMacToColon(switchMac)}`;
    const rootBridgeId = `${rootPriority}.${hpMacToColon(rootMac)}`;
    const isRoot = switchMac.replace(/[-:]/g, "") === rootMac.replace(/[-:]/g, "");

    return {
      bridge_id: bridgeId,
      root_bridge_id: rootBridgeId,
      priority: switchPriority,
      root_cost: rootCostMatch ? parseInt(rootCostMatch[1], 10) : null,
      root_port: rootPortMatch?.[1] && rootPortMatch[1] !== "N/A" ? rootPortMatch[1] : "none",
      hello_time_s: helloTimeMatch ? parseInt(helloTimeMatch[1], 10) : null,
      forward_delay_s: forwardDelayMatch ? parseInt(forwardDelayMatch[1], 10) : null,
      max_age_s: maxAgeMatch ? parseInt(maxAgeMatch[1], 10) : null,
      is_root_bridge: isRoot,
      protocol: output.match(/MSTP|RSTP|STP/i)?.[0]?.toLowerCase() === "mstp" ? "stp" : "rstp",
    };
  } catch {
    return null;
  }
}

// ==================== HP Comware ====================

export async function getHpComwareMacTable(options: HpConnectionOptions): Promise<MacTableEntry[]> {
  const output = await runComware(options, "display mac-address");
  return parseHpComwareMacTable(output);
}

function parseHpComwareMacTable(output: string): MacTableEntry[] {
  const entries: MacTableEntry[] = [];
  for (const line of output.split("\n")) {
    const macMatch = line.match(/([0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4})/);
    if (macMatch) {
      const mac = macMatch[1].replace(/-/g, "").match(/.{2}/g)?.join(":").toUpperCase() ?? macMatch[1];
      const portMatch = line.match(/(?:GigabitEthernet|Ten-GigabitEthernet|XGE|GE|BAGG)[\w\/\-]+/i);
      const vlanMatch = line.match(/VLAN\s+(\d+)/i);
      entries.push({
        mac,
        port_name: portMatch?.[0] ?? "unknown",
        vlan: vlanMatch ? parseInt(vlanMatch[1]) : null,
        port_status: null,
        speed: null,
      });
    }
  }
  return entries;
}

export async function getHpComwareLldpNeighbors(options: HpConnectionOptions): Promise<LldpNeighbor[]> {
  const output = await runComware(options, "display lldp neighbor-information verbose");
  return parseHpComwareLldp(output);
}

function parseHpComwareLldp(output: string): LldpNeighbor[] {
  const neighbors: LldpNeighbor[] = [];
  const lines = output.split("\n");
  let current: Partial<LldpNeighbor> | null = null;

  for (const line of lines) {
    const t = line.trim();
    const portMatch = t.match(/LLDP neighbor-information of port \d+\[([^\]]+)\]:/i);
    if (portMatch) {
      if (current?.interface) neighbors.push(current as LldpNeighbor);
      let ifName = portMatch[1];
      ifName = ifName.replace(/^Ten-GigabitEthernet/i, "XGE").replace(/^GigabitEthernet/i, "GE").replace(/^Bridge-Aggregation/i, "BAGG");
      current = { interface: ifName, chassisId: "", systemName: "", systemDescription: "", portId: "" };
      continue;
    }
    if (!current) continue;
    if (t.match(/^Chassis ID\s*:\s*(.+)/i)) {
      const m = t.match(/^Chassis ID\s*:\s*(.+)/i);
      if (m) current.chassisId = m[1].trim();
    } else if (t.match(/^Port ID\s*:\s*(.+)/i)) {
      const m = t.match(/^Port ID\s*:\s*(.+)/i);
      if (m) {
        current.portId = m[1].trim();
        if (current.portId.match(/[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}/i) && !current.chassisId) {
          current.chassisId = current.portId.replace(/-/g, "").match(/.{2}/g)?.join(":") ?? current.portId;
        }
      }
    } else if (t.match(/^System name\s*:\s*(.+)/i)) {
      const m = t.match(/^System name\s*:\s*(.+)/i);
      if (m) current.systemName = m[1].trim();
    } else if (t.match(/^System description\s*:\s*(.+)/i)) {
      const m = t.match(/^System description\s*:\s*(.+)/i);
      if (m) current.systemDescription = m[1].trim();
    } else if (t.match(/^Management address\s*:\s*(\d+\.\d+\.\d+\.\d+)/i)) {
      const m = t.match(/^Management address\s*:\s*(\d+\.\d+\.\d+\.\d+)/i);
      if (m) current.ipAddress = m[1];
    }
  }
  if (current?.interface) neighbors.push(current as LldpNeighbor);
  return neighbors;
}

export async function getHpComwarePortSchema(options: HpConnectionOptions): Promise<PortInfo[]> {
  const output = await runComware(options, "display interface brief");
  return parseHpComwareInterfaceBrief(output);
}

/**
 * STP per HP Comware (da DA-MKNET).
 * Comandi: display stp, display stp region-configuration
 * Formato: Bridge ID, Root ID/ERPC, RootPort ID, Bridge times
 */
export async function getHpComwareStpInfo(options: HpConnectionOptions): Promise<StpInfo | null> {
  try {
    let output = "";
    try {
      output = await runComwareViaShell(options, "display stp");
      output = output.substring(0, 4000);
    } catch {
      output = await runComwareViaShell(options, "display stp region-configuration").catch(() => "");
    }
    if (!output) return null;

    const modeMatch = output.match(/\[Mode\s+(\w+)\]/i);
    const protocol = modeMatch ? modeMatch[1] : "MSTP";

    const bridgeIdMatch = output.match(/Bridge ID\s*:\s*(\d+)\.([0-9a-f\-]+)/i);
    const rootIdMatch = output.match(/Root ID\/ERPC\s*:\s*(\d+)\.([0-9a-f\-]+),\s*(\d+)/i);
    const rootPortIdMatch = output.match(/RootPort ID\s*:\s*(\S+)/i);
    const timingMatch = output.match(/Hello\s*(\d+)s\s*MaxAge\s*(\d+)s\s*FwdDelay\s*(\d+)s/i);

    if (!bridgeIdMatch) return null;

    const bridgePrio = parseInt(bridgeIdMatch[1], 10);
    const bridgeMac = hpMacToColon(bridgeIdMatch[2]);
    const bridgeId = `${bridgePrio}.${bridgeMac}`;

    let rootBridgeId = bridgeId;
    let rootCost = 0;
    let rootPort = "none";
    if (rootIdMatch) {
      const rootPrio = parseInt(rootIdMatch[1], 10);
      const rootMac = hpMacToColon(rootIdMatch[2]);
      rootBridgeId = `${rootPrio}.${rootMac}`;
      rootCost = parseInt(rootIdMatch[3], 10);
    }
    if (rootPortIdMatch && rootPortIdMatch[1] !== "0.0") {
      const portSections = output.match(/----\[Port\d+\(([^)]+)\)\]\[(\w+)\]----[\s\S]*?Port role\s*:\s*([^\n]+)/gi);
      if (portSections) {
        for (const section of portSections) {
          if (section.toLowerCase().includes("root port")) {
            const nameMatch = section.match(/\[Port\d+\(([^)]+)\)\]/i);
            if (nameMatch) {
              rootPort = nameMatch[1];
              break;
            }
          }
        }
      }
    }

    const isRoot = bridgeId === rootBridgeId && rootCost === 0;

    return {
      bridge_id: bridgeId,
      root_bridge_id: rootBridgeId,
      priority: bridgePrio,
      root_cost: rootCost,
      root_port: rootPort,
      hello_time_s: timingMatch ? parseInt(timingMatch[1], 10) : null,
      forward_delay_s: timingMatch ? parseInt(timingMatch[3], 10) : null,
      max_age_s: timingMatch ? parseInt(timingMatch[2], 10) : null,
      is_root_bridge: isRoot,
      protocol: protocol.toLowerCase().includes("mstp") ? "stp" : "rstp",
    };
  } catch {
    return null;
  }
}

function parseHpComwareInterfaceBrief(output: string): PortInfo[] {
  const ports: PortInfo[] = [];
  const lines = output.split("\n");
  let idx = 0;
  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith("Interface") || t.startsWith("Link:") || t.startsWith("---")) continue;
    const m = t.match(/^([A-Za-z][\w\-\/]+)\s+(UP|DOWN|ADM)\s+(\S+)\s+(\S+)\s+([ATH]|--)\s+(\d+|--)\s*(.*)?$/i);
    if (m) {
      const [, port, status, speed] = m;
      idx++;
      ports.push({
        port_index: idx,
        port_name: port ?? `Port${idx}`,
        status: status?.toLowerCase() === "up" ? "up" : status?.toLowerCase() === "down" ? "down" : "disabled",
        speed: speed !== "auto" ? speed ?? null : null,
        duplex: null,
        vlan: null,
        poe_status: null,
        poe_power_mw: null,
        trunk_neighbor_name: null,
        trunk_neighbor_port: null,
        stp_state: null,
      });
    }
  }
  return ports;
}
