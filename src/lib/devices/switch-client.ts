import type { NetworkDevice } from "@/types";
import { getDeviceCredentials, getDeviceCommunityString, getDeviceSnmpV3Credentials, getCredentialCommunityString } from "@/lib/db";
import { normalizePortNameForMatch } from "@/lib/utils";
import { getSnmpPortSchema } from "./snmp-port-schema";
import { getSnmpStpInfo, type StpInfo } from "./snmp-stp-info";
import { getMikrotikStpInfo, getBrctlStpInfo, getUnifiStpInfo } from "./stp-ssh";
import {
  getHpProcurveMacTable,
  getHpProcurveLldpNeighbors,
  getHpProcurvePortSchema,
  getHpProcurveStpInfo,
  getHpComwareMacTable,
  getHpComwareLldpNeighbors,
  getHpComwarePortSchema,
  getHpComwareStpInfo,
} from "./hp-vendor";
import { createWinrmClient } from "./winrm-client";

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
  stp_state: string | null;
}

export interface SwitchClient {
  getMacTable(): Promise<MacTableEntry[]>;
  getPortSchema(): Promise<PortInfo[]>;
  getStpInfo?(): Promise<StpInfo | null>;
  testConnection(): Promise<boolean>;
}

export async function createSwitchClient(device: NetworkDevice): Promise<SwitchClient> {
  const creds = getDeviceCredentials(device);
  const password = creds?.password;
  const username = creds?.username ?? device.username ?? undefined;
  const primaryClient = await createVendorClient(device, { username, password });
  const hasSnmpCommunity = device.community_string
    || (device.snmp_credential_id ? !!getCredentialCommunityString(device.snmp_credential_id) : false)
    || (device.credential_id ? !!getCredentialCommunityString(device.credential_id) : false);

  // UniFi con SNMP: la MAC table va presa da SNMP (Bridge MIB), non da SSH che restituisce dati incompleti
  const useSnmpFirstForMac = device.vendor === "ubiquiti" && hasSnmpCommunity;

  return {
    async getMacTable() {
      if (useSnmpFirstForMac) {
        try {
          const snmpClient = await createSnmpSwitchClient(device);
          const entries = await snmpClient.getMacTable();
          if (entries.length > 0) return entries;
        } catch { /* SNMP fallito, prova SSH */ }
      }

      try {
        const entries = await primaryClient.getMacTable();
        if (entries.length > 0) return entries;
      } catch { /* primary failed, try fallback */ }

      if (device.protocol === "ssh" && hasSnmpCommunity && !useSnmpFirstForMac) {
        const snmpClient = await createSnmpSwitchClient(device);
        return snmpClient.getMacTable();
      }

      if ((device.protocol === "snmp_v2" || device.protocol === "snmp_v3") && (password || (device.encrypted_password && device.username))) {
        const sshClient = await createSshWithFallbackCommands(device, { username, password });
        return sshClient.getMacTable();
      }

      return primaryClient.getMacTable();
    },
    async getPortSchema() {
      if (useSnmpFirstForMac) {
        try {
          const snmpClient = await createSnmpSwitchClient(device);
          const ports = await snmpClient.getPortSchema();
          if (ports.length > 0) return ports;
        } catch { /* SNMP fallito, prova SSH */ }
      }

      try {
        const ports = await primaryClient.getPortSchema();
        if (ports.length > 0) return ports;
      } catch { /* primary failed */ }

      if (device.protocol === "ssh" && hasSnmpCommunity && !useSnmpFirstForMac) {
        const snmpClient = await createSnmpSwitchClient(device);
        return snmpClient.getPortSchema();
      }

      return [];
    },
    async getStpInfo() {
      // Ubiquiti: SNMP STP (BRIDGE-MIB) funziona su più modelli; SSH (telnet+enable) solo su alcuni
      if (device.vendor === "ubiquiti" && hasSnmpCommunity) {
        try {
          const snmpClient = await createSnmpSwitchClient(device);
          const info = await snmpClient.getStpInfo?.();
          if (info) return info;
        } catch { /* SNMP STP fallito */ }
      }
      try {
        if ("getStpInfo" in primaryClient && typeof primaryClient.getStpInfo === "function") {
          const info = await primaryClient.getStpInfo();
          if (info) return info;
        }
      } catch { /* SSH STP fallito */ }
      if (hasSnmpCommunity && device.vendor !== "ubiquiti") {
        try {
          const snmpClient = await createSnmpSwitchClient(device);
          return snmpClient.getStpInfo?.() ?? null;
        } catch {
          return null;
        }
      }
      return null;
    },
    async testConnection() {
      return primaryClient.testConnection();
    },
  };
}

type DeviceCreds = { username?: string; password?: string };

async function createVendorClient(device: NetworkDevice, creds: DeviceCreds): Promise<SwitchClient> {
  if (device.protocol === "winrm" || device.vendor === "windows") {
    return createWinrmSwitchClient(device);
  }
  switch (device.vendor) {
    case "mikrotik":
      return createMikrotikSwitchClient(device, creds);
    case "cisco":
      return createCiscoSwitchClient(device, creds);
    case "ubiquiti":
      return createUbiquitiSwitchClient(device, creds);
    case "hp":
      return createHpSwitchClient(device, creds);
    case "omada":
      return createOmadaSwitchClient(device);
    default:
      return createGenericSwitchClient(device, creds);
  }
}

async function createSshSwitchClient(
  device: NetworkDevice,
  creds: DeviceCreds,
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
        username: creds.username || device.username || undefined,
        password: creds.password,
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
  const isSnmpProtocol = device.protocol === "snmp_v2" || device.protocol === "snmp_v3";
  const snmpPort = isSnmpProtocol ? (device.port || 161) : 161;
  const opts = { port: snmpPort, timeout: 10000 };

  function createSession() {
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

  function snmpWalk(oid: string): Promise<{ oid: string; value: Buffer | string | number }[]> {
    return new Promise((resolve, reject) => {
      const session = createSession();
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
    async getStpInfo() {
      return getSnmpStpInfo(snmpWalk);
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

async function createSshWithFallbackCommands(device: NetworkDevice, creds: DeviceCreds): Promise<SwitchClient> {
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
        username: creds.username || device.username || undefined,
        password: creds.password,
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
    async getStpInfo() {
      return getBrctlStpInfo(execCmd);
    },
    async testConnection() {
      try { await execCmd("echo test"); return true; } catch { return false; }
    },
  };
}

// Vendor implementations
async function createMikrotikSwitchClient(device: NetworkDevice, creds: DeviceCreds): Promise<SwitchClient> {
  if (device.protocol === "ssh") {
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
          username: creds.username ?? device.username ?? undefined,
          password: creds.password,
          readyTimeout: 10000,
        });
      });
    }
    return {
      async getMacTable() {
        const output = await execCommand("/interface bridge host print terse");
        return parseMikrotikMacTable(output);
      },
      async getPortSchema() { return []; },
      async getStpInfo() { return getMikrotikStpInfo(execCommand); },
      async testConnection() {
        try { await execCommand("echo test"); return true; } catch { return false; }
      },
    };
  }
  return createSnmpSwitchClient(device);
}

function createCiscoSwitchClient(device: NetworkDevice, creds: DeviceCreds): Promise<SwitchClient> {
  if (device.protocol === "ssh") {
    return createSshSwitchClient(device, creds, "show mac address-table", parseCiscoMacTable);
  }
  return createSnmpSwitchClient(device);
}

async function createUbiquitiSwitchClient(device: NetworkDevice, creds: DeviceCreds): Promise<SwitchClient> {
  if (device.protocol === "ssh") {
    const base = await createSshWithFallbackCommands(device, creds);
    const opts = {
      host: device.host,
      port: device.port || 22,
      username: creds.username ?? device.username ?? "",
      password: creds.password ?? "",
      timeout: 15000,
    };
    return {
      ...base,
      getStpInfo: async () => {
        if (!opts.username || !opts.password) return null;
        return getUnifiStpInfo(opts);
      },
    };
  }
  return createSnmpSwitchClient(device);
}

async function createHpProcurveSwitchClient(device: NetworkDevice, creds: DeviceCreds): Promise<SwitchClient> {
  const opts = {
    host: device.host,
    port: device.port || 22,
    username: creds.username!,
    password: creds.password!,
    timeout: 30000,
  };
  return {
    async getMacTable() {
      return getHpProcurveMacTable(opts);
    },
    async getPortSchema() {
      const [ports, lldp] = await Promise.all([getHpProcurvePortSchema(opts), getHpProcurveLldpNeighbors(opts)]);
      return mergeLldpIntoPorts(ports, lldp);
    },
    async getStpInfo() {
      return getHpProcurveStpInfo(opts);
    },
    async testConnection() {
      try {
        const { sshExec } = await import("./ssh-helper");
        await sshExec(opts, "show version");
        return true;
      } catch {
        return false;
      }
    },
  };
}

async function createHpComwareSwitchClient(device: NetworkDevice, creds: DeviceCreds): Promise<SwitchClient> {
  const opts = {
    host: device.host,
    port: device.port || 22,
    username: creds.username!,
    password: creds.password!,
    timeout: 30000,
  };
  return {
    async getMacTable() {
      return getHpComwareMacTable(opts);
    },
    async getPortSchema() {
      const [ports, lldp] = await Promise.all([getHpComwarePortSchema(opts), getHpComwareLldpNeighbors(opts)]);
      return mergeLldpIntoPorts(ports, lldp);
    },
    async getStpInfo() {
      return getHpComwareStpInfo(opts);
    },
    async testConnection() {
      try {
        const { sshExec } = await import("./ssh-helper");
        await sshExec(opts, "display version");
        return true;
      } catch {
        return false;
      }
    },
  };
}

function mergeLldpIntoPorts(ports: PortInfo[], lldp: { interface: string; systemName: string; portId: string }[]): PortInfo[] {
  const byPort = new Map<string, { systemName: string; portId: string }>();
  for (const n of lldp) {
    const key = normalizePortNameForMatch(n.interface);
    if (!byPort.has(key)) byPort.set(key, { systemName: n.systemName, portId: n.portId });
  }
  return ports.map((p) => {
    const n = byPort.get(normalizePortNameForMatch(p.port_name));
    return n
      ? { ...p, trunk_neighbor_name: n.systemName || null, trunk_neighbor_port: n.portId || null }
      : p;
  });
}

function createHpSwitchClient(device: NetworkDevice, creds: DeviceCreds): Promise<SwitchClient> {
  if (device.protocol === "ssh" && creds?.username && creds?.password) {
    const subtype = device.vendor_subtype ?? "procurve";
    if (subtype === "comware") {
      return createHpComwareSwitchClient(device, creds);
    }
    return createHpProcurveSwitchClient(device, creds);
  }
  if (device.protocol === "ssh") {
    return createSshSwitchClient(device, creds, "show mac-address", parseGenericMacTable);
  }
  return createSnmpSwitchClient(device);
}

function createOmadaSwitchClient(device: NetworkDevice): Promise<SwitchClient> {
  return createSnmpSwitchClient(device);
}

async function createWinrmSwitchClient(device: NetworkDevice): Promise<SwitchClient> {
  const winrm = await createWinrmClient(device);
  return {
    async getMacTable() {
      return []; // Windows host non ha MAC table come switch
    },
    async getPortSchema() {
      return [];
    },
    async testConnection() {
      return winrm.testConnection();
    },
  };
}

function createGenericSwitchClient(device: NetworkDevice, creds: DeviceCreds): Promise<SwitchClient> {
  if (device.protocol === "winrm") {
    return createWinrmSwitchClient(device);
  }
  if (device.protocol === "ssh") {
    return createSshWithFallbackCommands(device, creds);
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
