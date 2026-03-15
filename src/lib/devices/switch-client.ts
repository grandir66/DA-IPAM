import type { NetworkDevice } from "@/types";
import { decrypt } from "@/lib/crypto";
import { getSnmpPortSchema } from "./snmp-port-schema";

export interface MacTableEntry {
  mac: string;
  port_name: string;
  vlan: number | null;
  port_status: "up" | "down" | null;
  speed: string | null;
}

export interface PortInfo {
  port_index: number;
  port_name: string;
  status: "up" | "down" | "disabled" | null;
  speed: string | null;
  duplex: string | null;
  vlan: number | null;
  poe_status: string | null;
  poe_power_mw: number | null;
  trunk_neighbor_name: string | null;
  trunk_neighbor_port: string | null;
}

export interface SwitchClient {
  getMacTable(): Promise<MacTableEntry[]>;
  getPortSchema(): Promise<PortInfo[]>;
  testConnection(): Promise<boolean>;
}

export async function createSwitchClient(device: NetworkDevice): Promise<SwitchClient> {
  const password = device.encrypted_password ? decrypt(device.encrypted_password) : undefined;
  const primaryClient = await createVendorClient(device, password);

  return {
    async getMacTable() {
      try {
        const entries = await primaryClient.getMacTable();
        if (entries.length > 0) return entries;
      } catch { /* primary failed, try fallback */ }

      if (device.protocol === "ssh" && device.community_string) {
        const snmpClient = await createSnmpSwitchClient(device);
        return snmpClient.getMacTable();
      }

      if ((device.protocol === "snmp_v2" || device.protocol === "snmp_v3") && device.encrypted_password && device.username) {
        const sshClient = await createSshWithFallbackCommands(device, password);
        return sshClient.getMacTable();
      }

      return primaryClient.getMacTable();
    },
    async getPortSchema() {
      try {
        const ports = await primaryClient.getPortSchema();
        if (ports.length > 0) return ports;
      } catch { /* primary failed */ }

      if (device.protocol === "ssh" && device.community_string) {
        const snmpClient = await createSnmpSwitchClient(device);
        return snmpClient.getPortSchema();
      }

      return [];
    },
    async testConnection() {
      return primaryClient.testConnection();
    },
  };
}

async function createVendorClient(device: NetworkDevice, password: string | undefined): Promise<SwitchClient> {
  switch (device.vendor) {
    case "mikrotik":
      return createMikrotikSwitchClient(device, password);
    case "cisco":
      return createCiscoSwitchClient(device, password);
    case "ubiquiti":
      return createUbiquitiSwitchClient(device, password);
    case "hp":
      return createHpSwitchClient(device, password);
    case "omada":
      return createOmadaSwitchClient(device);
    default:
      return createGenericSwitchClient(device, password);
  }
}

async function createSshSwitchClient(
  device: NetworkDevice,
  password: string | undefined,
  command: string,
  parser: (output: string) => MacTableEntry[]
): Promise<SwitchClient> {
  const { Client } = await import("ssh2");

  function execCommand(cmd: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const conn = new Client();
      conn.on("ready", () => {
        conn.exec(cmd, (err, stream) => {
          if (err) { conn.end(); reject(err); return; }
          let output = "";
          stream.on("data", (data: Buffer) => { output += data.toString(); });
          stream.stderr.on("data", (data: Buffer) => { output += data.toString(); });
          stream.on("close", () => { conn.end(); resolve(output); });
        });
      });
      conn.on("error", reject);
      conn.connect({
        host: device.host,
        port: device.port,
        username: device.username || undefined,
        password,
        readyTimeout: 10000,
      });
    });
  }

  return {
    async getMacTable() {
      const output = await execCommand(command);
      return parser(output);
    },
    async getPortSchema() {
      return [];
    },
    async testConnection() {
      try {
        await execCommand("echo test");
        return true;
      } catch {
        return false;
      }
    },
  };
}

async function createSnmpSwitchClient(device: NetworkDevice): Promise<SwitchClient> {
  const snmp = await import("net-snmp");
  let community = "public";
  if (device.community_string) {
    try {
      community = decrypt(device.community_string);
    } catch {
      community = device.community_string;
    }
  }

  const isSnmpProtocol = device.protocol === "snmp_v2" || device.protocol === "snmp_v3";
  const snmpPort = isSnmpProtocol ? (device.port || 161) : 161;

  function snmpWalk(oid: string): Promise<{ oid: string; value: Buffer | string | number }[]> {
    return new Promise((resolve, reject) => {
      const session = snmp.createSession(device.host, community, {
        port: snmpPort,
        timeout: 10000,
      });
      const results: { oid: string; value: Buffer | string | number }[] = [];

      session.subtree(
        oid,
        (varbinds: Array<{ oid: string; value: Buffer | string | number }>) => {
          for (const vb of varbinds) {
            results.push({ oid: vb.oid, value: vb.value });
          }
        },
        (error: Error | undefined) => {
          session.close();
          if (error) reject(error);
          else resolve(results);
        }
      );
    });
  }

  // Shared SNMP data maps (populated lazily, used by both getMacTable and getPortSchema)
  let ifDescrMap: Map<number, string> | null = null;
  let ifOperStatusMap: Map<number, "up" | "down"> | null = null;
  let ifSpeedMap: Map<number, string> | null = null;

  async function loadInterfaceMaps() {
    if (ifDescrMap) return;
    ifDescrMap = new Map();
    ifOperStatusMap = new Map();
    ifSpeedMap = new Map();

    try {
      const ifDescrResults = await snmpWalk("1.3.6.1.2.1.2.2.1.2");
      for (const r of ifDescrResults) {
        const ifIndex = parseInt(r.oid.split(".").pop()!);
        ifDescrMap!.set(ifIndex, String(r.value));
      }
    } catch { /* optional */ }

    try {
      const ifOperResults = await snmpWalk("1.3.6.1.2.1.2.2.1.8");
      for (const r of ifOperResults) {
        const ifIndex = parseInt(r.oid.split(".").pop()!);
        ifOperStatusMap!.set(ifIndex, Number(r.value) === 1 ? "up" : "down");
      }
    } catch { /* optional */ }

    try {
      const ifSpeedResults = await snmpWalk("1.3.6.1.2.1.31.1.1.1.15");
      for (const r of ifSpeedResults) {
        const ifIndex = parseInt(r.oid.split(".").pop()!);
        const mbps = Number(r.value);
        ifSpeedMap!.set(ifIndex, mbps > 0 ? `${mbps} Mbps` : "");
      }
    } catch { /* optional */ }
  }

  return {
    async getMacTable() {
      await loadInterfaceMaps();

      const portIndexMap = new Map<number, number>();
      try {
        const portIndexResults = await snmpWalk("1.3.6.1.2.1.17.1.4.1.2");
        for (const r of portIndexResults) {
          const bridgePort = parseInt(r.oid.split(".").pop()!);
          portIndexMap.set(bridgePort, Number(r.value));
        }
      } catch { /* optional */ }

      // Try 1: Standard Bridge MIB (dot1dTpFdbPort)
      let fdbResults: { oid: string; value: Buffer | string | number }[] = [];
      try {
        fdbResults = await snmpWalk("1.3.6.1.2.1.17.4.3.1.2");
      } catch { /* might not be supported */ }

      if (fdbResults.length > 0) {
        const entries: MacTableEntry[] = [];
        for (const r of fdbResults) {
          const oidParts = r.oid.split(".");
          const macBytes = oidParts.slice(-6).map((b) => parseInt(b).toString(16).padStart(2, "0").toUpperCase());
          const mac = macBytes.join(":");
          const bridgePort = Number(r.value);
          const ifIndex = portIndexMap.get(bridgePort);
          const portName = ifIndex ? (ifDescrMap!.get(ifIndex) || `Port${bridgePort}`) : `Port${bridgePort}`;
          const port_status = ifIndex ? (ifOperStatusMap!.get(ifIndex) ?? null) : null;
          const speed = ifIndex ? (ifSpeedMap!.get(ifIndex) || null) : null;
          entries.push({ mac, port_name: portName, vlan: null, port_status, speed: speed || null });
        }
        return entries;
      }

      // Try 2: Q-BRIDGE-MIB (dot1qTpFdbPort) — VLAN-aware switches
      let qbridgeResults: { oid: string; value: Buffer | string | number }[] = [];
      try {
        qbridgeResults = await snmpWalk("1.3.6.1.2.1.17.7.1.2.2.1.2");
      } catch { /* might not be supported */ }

      if (qbridgeResults.length > 0) {
        const entries: MacTableEntry[] = [];
        for (const r of qbridgeResults) {
          const oidParts = r.oid.split(".");
          const vlan = parseInt(oidParts[oidParts.length - 7]);
          const macBytes = oidParts.slice(-6).map((b) => parseInt(b).toString(16).padStart(2, "0").toUpperCase());
          const mac = macBytes.join(":");
          const bridgePort = Number(r.value);
          const ifIndex = portIndexMap.get(bridgePort) ?? bridgePort;
          const portName = ifDescrMap!.get(ifIndex) || `Port${bridgePort}`;
          const port_status = ifOperStatusMap!.get(ifIndex) ?? null;
          const speed = ifSpeedMap!.get(ifIndex) || null;
          entries.push({ mac, port_name: portName, vlan: isNaN(vlan) ? null : vlan, port_status, speed: speed || null });
        }
        return entries;
      }

      return [];
    },
    async getPortSchema() {
      return getSnmpPortSchema(snmpWalk);
    },
    async testConnection() {
      try {
        await snmpWalk("1.3.6.1.2.1.1.1.0");
        return true;
      } catch {
        return false;
      }
    },
  };
}

async function createSshWithFallbackCommands(device: NetworkDevice, password: string | undefined): Promise<SwitchClient> {
  const commands = [
    { cmd: "show mac address-table", parser: parseGenericMacTable },
    { cmd: "show mac-address-table", parser: parseGenericMacTable },
    { cmd: "bridge fdb show", parser: parseLinuxFdbTable },
    { cmd: "brctl showmacs br0", parser: parseLinuxBrctlTable },
  ];

  const { Client } = await import("ssh2");

  function execCmd(cmd: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const conn = new Client();
      conn.on("ready", () => {
        conn.exec(cmd, (err, stream) => {
          if (err) { conn.end(); reject(err); return; }
          let output = "";
          stream.on("data", (data: Buffer) => { output += data.toString(); });
          stream.stderr.on("data", (data: Buffer) => { output += data.toString(); });
          stream.on("close", () => { conn.end(); resolve(output); });
        });
      });
      conn.on("error", reject);
      conn.connect({
        host: device.host,
        port: device.port || 22,
        username: device.username || undefined,
        password,
        readyTimeout: 10000,
      });
    });
  }

  return {
    async getMacTable() {
      for (const { cmd, parser } of commands) {
        try {
          const output = await execCmd(cmd);
          if (output.includes("not found") || output.includes("Invalid") || output.includes("Unknown command") || output.trim().length === 0) continue;
          const entries = parser(output);
          if (entries.length > 0) return entries;
        } catch { continue; }
      }
      return [];
    },
    async getPortSchema() {
      return [];
    },
    async testConnection() {
      try { await execCmd("echo test"); return true; } catch { return false; }
    },
  };
}

// Vendor implementations
function createMikrotikSwitchClient(device: NetworkDevice, password: string | undefined): Promise<SwitchClient> {
  if (device.protocol === "ssh") {
    return createSshSwitchClient(device, password, "/interface bridge host print terse", parseMikrotikMacTable);
  }
  return createSnmpSwitchClient(device);
}

function createCiscoSwitchClient(device: NetworkDevice, password: string | undefined): Promise<SwitchClient> {
  if (device.protocol === "ssh") {
    return createSshSwitchClient(device, password, "show mac address-table", parseCiscoMacTable);
  }
  return createSnmpSwitchClient(device);
}

function createUbiquitiSwitchClient(device: NetworkDevice, password: string | undefined): Promise<SwitchClient> {
  if (device.protocol === "ssh") {
    return createSshWithFallbackCommands(device, password);
  }
  return createSnmpSwitchClient(device);
}

function createHpSwitchClient(device: NetworkDevice, password: string | undefined): Promise<SwitchClient> {
  if (device.protocol === "ssh") {
    return createSshSwitchClient(device, password, "show mac-address", parseGenericMacTable);
  }
  return createSnmpSwitchClient(device);
}

function createOmadaSwitchClient(device: NetworkDevice): Promise<SwitchClient> {
  return createSnmpSwitchClient(device);
}

function createGenericSwitchClient(device: NetworkDevice, password: string | undefined): Promise<SwitchClient> {
  if (device.protocol === "ssh") {
    return createSshWithFallbackCommands(device, password);
  }
  return createSnmpSwitchClient(device);
}

// Parsers
function parseMikrotikMacTable(output: string): MacTableEntry[] {
  const entries: MacTableEntry[] = [];
  for (const line of output.split("\n")) {
    const macMatch = line.match(/mac-address=([0-9A-Fa-f:]+)/);
    const ifMatch = line.match(/on-interface=(\S+)/);

    if (macMatch) {
      entries.push({
        mac: macMatch[1].toUpperCase(),
        port_name: ifMatch?.[1] || "unknown",
        vlan: null,
        port_status: null,
        speed: null,
      });
    }
  }
  return entries;
}

function parseCiscoMacTable(output: string): MacTableEntry[] {
  const entries: MacTableEntry[] = [];
  for (const line of output.split("\n")) {
    const match = line.match(/\s*(\d+)\s+([0-9a-fA-F.]+)\s+\S+\s+(\S+)/);
    if (match) {
      const rawMac = match[2].replace(/\./g, "");
      const mac = rawMac.match(/.{2}/g)!.join(":").toUpperCase();
      entries.push({
        mac,
        port_name: match[3],
        vlan: parseInt(match[1]),
        port_status: null,
        speed: null,
      });
    }
  }
  return entries;
}

function parseLinuxFdbTable(output: string): MacTableEntry[] {
  const entries: MacTableEntry[] = [];
  for (const line of output.split("\n")) {
    const match = line.match(/^([0-9a-fA-F]{2}(?:[:-][0-9a-fA-F]{2}){5})\s+dev\s+(\S+)/);
    if (match) {
      const mac = match[1].toUpperCase();
      if (mac === "33:33:00:00:00:01" || mac.startsWith("01:00:5E") || mac === "FF:FF:FF:FF:FF:FF") continue;
      const vlanMatch = line.match(/vlan\s+(\d+)/);
      entries.push({
        mac,
        port_name: match[2],
        vlan: vlanMatch ? parseInt(vlanMatch[1]) : null,
        port_status: null,
        speed: null,
      });
    }
  }
  return entries;
}

function parseLinuxBrctlTable(output: string): MacTableEntry[] {
  const entries: MacTableEntry[] = [];
  for (const line of output.split("\n")) {
    const match = line.match(/\s*(\d+)\s+([0-9a-fA-F]{2}(?:[:-][0-9a-fA-F]{2}){5})\s+(yes|no)/);
    if (match) {
      const isLocal = match[3] === "yes";
      if (isLocal) continue;
      entries.push({
        mac: match[2].toUpperCase(),
        port_name: `Port${match[1]}`,
        vlan: null,
        port_status: null,
        speed: null,
      });
    }
  }
  return entries;
}

function parseGenericMacTable(output: string): MacTableEntry[] {
  const entries: MacTableEntry[] = [];
  for (const line of output.split("\n")) {
    const macMatch = line.match(/([0-9a-fA-F]{2}[:-][0-9a-fA-F]{2}[:-][0-9a-fA-F]{2}[:-][0-9a-fA-F]{2}[:-][0-9a-fA-F]{2}[:-][0-9a-fA-F]{2})/);
    if (macMatch) {
      const afterMac = line.substring(line.indexOf(macMatch[0]) + macMatch[0].length);
      const portMatch = afterMac.match(/\s+\S+\s+(\S+)/);

      entries.push({
        mac: macMatch[1].toUpperCase(),
        port_name: portMatch?.[1] || "unknown",
        vlan: null,
        port_status: null,
        speed: null,
      });
    }
  }
  return entries;
}
