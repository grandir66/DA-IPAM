import type { NetworkDevice } from "@/types";
import { getDeviceCredentials, getDeviceCommunityString, getDeviceSnmpV3Credentials, getCredentialCommunityString } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import type { PortInfo } from "./switch-client";
import { getSnmpPortSchema } from "./snmp-port-schema";

export interface ArpTableEntry {
  mac: string;
  ip: string | null;
  interface_name: string | null;
}

/** Lease DHCP da MikroTik: IP, MAC, hostname inviato dal client */
export interface DhcpLeaseEntry {
  ip: string;
  mac: string;
  hostname: string | null;
  status?: "bound" | "waiting" | "offered" | string;
  server?: string;
  expiresAfter?: string;
  lastSeen?: string;
  comment?: string;
}

/** Info pool DHCP MikroTik */
export interface DhcpPoolInfo {
  name: string;
  ranges: string;
  nextPool?: string;
}

/** Info server DHCP MikroTik */
export interface DhcpServerInfo {
  name: string;
  interface: string;
  addressPool: string;
  disabled: boolean;
  leaseCount?: number;
}

/** Configurazione MikroTik esportata */
export interface MikrotikConfig {
  exportFull: string;
  exportCompact?: string;
  systemInfo?: {
    identity?: string;
    version?: string;
    boardName?: string;
    serialNumber?: string;
    uptime?: string;
  };
}

export interface RouterClient {
  getArpTable(): Promise<ArpTableEntry[]>;
  testConnection(): Promise<boolean>;
  /** Solo MikroTik SSH: recupera lease DHCP con hostname client */
  getDhcpLeases?(): Promise<DhcpLeaseEntry[]>;
  /** SNMP: elenco interfacce con LLDP/CDP (opzionale) */
  getPortSchema?(): Promise<PortInfo[]>;
  /** MikroTik: esporta configurazione completa */
  getConfig?(): Promise<MikrotikConfig>;
  /** MikroTik: info server DHCP */
  getDhcpServers?(): Promise<DhcpServerInfo[]>;
  /** MikroTik: info pool DHCP */
  getDhcpPools?(): Promise<DhcpPoolInfo[]>;
}

export async function createRouterClient(device: NetworkDevice): Promise<RouterClient> {
  const creds = getDeviceCredentials(device);
  const username = creds?.username ?? device.username ?? undefined;
  const password = creds?.password;
  const primary = await getVendorRouterClient(device, { username, password });

  // Se il client primario non ha getPortSchema ma il device ha SNMP (community_string o credential SNMP),
  // aggiungi fallback per acquisire porte e LLDP/CDP
  const hasSnmpCommunity = device.community_string
    || (device.snmp_credential_id ? !!getCredentialCommunityString(device.snmp_credential_id) : false)
    || (device.credential_id ? !!getCredentialCommunityString(device.credential_id) : false);
  let client: RouterClient = primary;
  if (!primary.getPortSchema && hasSnmpCommunity) {
    const snmpClient = await createSnmpArpClient(device);
    client = { ...primary, getPortSchema: () => snmpClient.getPortSchema!() };
  }

  // Fallback SSH → SNMP: se SSH fallisce (es. credenziali mancanti), prova SNMP
  if (device.protocol === "ssh" && hasSnmpCommunity) {
    const snmpClient = await createSnmpArpClient(device);
    return {
      async getArpTable() {
        try {
          return await client.getArpTable();
        } catch {
          return snmpClient.getArpTable();
        }
      },
      async getPortSchema() {
        try {
          const ports = await client.getPortSchema?.();
          if (ports && ports.length > 0) return ports;
        } catch { /* ignore */ }
        return snmpClient.getPortSchema?.() ?? [];
      },
      async testConnection() {
        try {
          const ok = await client.testConnection();
          if (ok) return true;
        } catch { /* ignore */ }
        return snmpClient.testConnection();
      },
      getDhcpLeases: client.getDhcpLeases,
    };
  }

  return client;
}

type DeviceCreds = { username?: string; password?: string };

async function getVendorRouterClient(device: NetworkDevice, creds: DeviceCreds): Promise<RouterClient> {
  switch (device.vendor) {
    case "mikrotik":
      return createMikrotikClient(device, creds);
    case "cisco":
      return createCiscoClient(device, creds);
    case "ubiquiti":
      return createUbiquitiClient(device, creds);
    case "hp":
      return createHpClient(device, creds);
    case "omada":
      return createOmadaClient(device);
    case "stormshield":
    case "other":
      if (device.protocol === "snmp_v2" || device.protocol === "snmp_v3") {
        return createSnmpArpClient(device);
      }
      return createGenericSshRouterClient(device, creds);
    default:
      if (device.protocol === "snmp_v2" || device.protocol === "snmp_v3") {
        return createSnmpArpClient(device);
      }
      return createGenericSshRouterClient(device, creds);
  }
}

// SSH-based client factory
async function createSshClient(
  device: NetworkDevice,
  creds: DeviceCreds,
  command: string,
  parser: (output: string) => ArpTableEntry[]
): Promise<RouterClient> {
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
        algorithms: {
          kex: ["diffie-hellman-group14-sha256", "diffie-hellman-group14-sha1", "diffie-hellman-group-exchange-sha256"],
        },
      });
    });
  }

  return {
    async getArpTable() {
      const output = await execCommand(command);
      return parser(output);
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

// SNMP-based ARP client (v2c e v3)
async function createSnmpArpClient(
  device: NetworkDevice
): Promise<RouterClient> {
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

  function parseArpResults(results: { oid: string; value: Buffer | string | number }[]): ArpTableEntry[] {
    const entries: ArpTableEntry[] = [];
    for (const result of results) {
      const oidParts = result.oid.split(".");
      if (oidParts.length < 4) continue;
      const ip = oidParts.slice(-4).join(".");
      if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip)) continue;
      let mac: string;
      if (Buffer.isBuffer(result.value)) {
        mac = Array.from(result.value)
          .map((b: number) => b.toString(16).padStart(2, "0").toUpperCase())
          .join(":");
      } else {
        continue;
      }
      const ifIndex = oidParts[oidParts.length - 5];
      entries.push({ mac, ip, interface_name: ifIndex ? `if${ifIndex}` : null });
    }
    return entries;
  }

  return {
    async getArpTable() {
      // ipNetToMediaPhysAddress OID: 1.3.6.1.2.1.4.22.1.2 (RFC 1213)
      let results = await snmpWalk("1.3.6.1.2.1.4.22.1.2");
      let entries = parseArpResults(results);
      if (entries.length === 0) {
        // Fallback: ipNetToPhysicalPhysAddress 1.3.6.1.2.1.4.35.1.4 (RFC 4293)
        try {
          results = await snmpWalk("1.3.6.1.2.1.4.35.1.4");
          entries = parseArpResults(results);
        } catch { /* ignore */ }
      }
      return entries;
    },
    async getPortSchema() {
      return getSnmpPortSchema(snmpWalk);
    },
    async testConnection() {
      try {
        await snmpWalk("1.3.6.1.2.1.1.1.0"); // sysDescr
        return true;
      } catch {
        return false;
      }
    },
  };
}

// Vendor-specific implementations
async function createMikrotikClient(device: NetworkDevice, creds: DeviceCreds): Promise<RouterClient> {
  if (device.protocol !== "ssh") {
    return createSnmpArpClient(device);
  }
  const { Client } = await import("ssh2");

  function execCommand(cmd: string, timeoutMs = 30000): Promise<string> {
    return new Promise((resolve, reject) => {
      const conn = new Client();
      const timeout = setTimeout(() => {
        conn.end();
        reject(new Error("Timeout"));
      }, timeoutMs);

      conn.on("ready", () => {
        conn.exec(cmd, (err, stream) => {
          if (err) { clearTimeout(timeout); conn.end(); reject(err); return; }
          let output = "";
          stream.on("data", (data: Buffer) => { output += data.toString(); });
          stream.stderr.on("data", (data: Buffer) => { output += data.toString(); });
          stream.on("close", () => { clearTimeout(timeout); conn.end(); resolve(output); });
        });
      });
      conn.on("error", (err) => { clearTimeout(timeout); reject(err); });
      conn.connect({
        host: device.host,
        port: device.port,
        username: creds.username || device.username || undefined,
        password: creds.password,
        readyTimeout: 10000,
        algorithms: {
          kex: ["diffie-hellman-group14-sha256", "diffie-hellman-group14-sha1", "diffie-hellman-group-exchange-sha256"],
        },
      });
    });
  }

  return {
    async getArpTable() {
      const output = await execCommand("/ip arp print terse");
      return parseMikrotikArp(output);
    },
    async getDhcpLeases() {
      const output = await execCommand("/ip dhcp-server lease print terse");
      return parseMikrotikDhcpLeases(output);
    },
    async getDhcpServers() {
      const output = await execCommand("/ip dhcp-server print terse");
      return parseMikrotikDhcpServers(output);
    },
    async getDhcpPools() {
      const output = await execCommand("/ip pool print terse");
      return parseMikrotikDhcpPools(output);
    },
    async getConfig() {
      const [exportFull, exportCompact, sysInfo] = await Promise.all([
        execCommand("/export", 60000),
        execCommand("/export compact", 60000).catch(() => undefined),
        execCommand("/system resource print terse").catch(() => ""),
      ]);
      const [identity, routerboard] = await Promise.all([
        execCommand("/system identity print terse").catch(() => ""),
        execCommand("/system routerboard print terse").catch(() => ""),
      ]);

      const systemInfo: MikrotikConfig["systemInfo"] = {};
      const identityMatch = identity.match(/name=(\S+)/);
      if (identityMatch) systemInfo.identity = identityMatch[1].replace(/"/g, "");

      const versionMatch = sysInfo.match(/version=(\S+)/);
      if (versionMatch) systemInfo.version = versionMatch[1];

      const boardMatch = routerboard.match(/model=(\S+)/);
      if (boardMatch) systemInfo.boardName = boardMatch[1];

      const serialMatch = routerboard.match(/serial-number=(\S+)/);
      if (serialMatch) systemInfo.serialNumber = serialMatch[1];

      const uptimeMatch = sysInfo.match(/uptime=(\S+)/);
      if (uptimeMatch) systemInfo.uptime = uptimeMatch[1];

      return {
        exportFull,
        exportCompact,
        systemInfo: Object.keys(systemInfo).length > 0 ? systemInfo : undefined,
      };
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

function createCiscoClient(device: NetworkDevice, creds: DeviceCreds): Promise<RouterClient> {
  if (device.protocol === "ssh") {
    return createSshClient(device, creds, "show ip arp", parseCiscoArp);
  }
  return createSnmpArpClient(device);
}

function createUbiquitiClient(device: NetworkDevice, creds: DeviceCreds): Promise<RouterClient> {
  if (device.protocol === "ssh") {
    return createSshClient(device, creds, "show arp", parseGenericArp);
  }
  return createSnmpArpClient(device);
}

function createHpClient(device: NetworkDevice, creds: DeviceCreds): Promise<RouterClient> {
  if (device.protocol === "ssh") {
    return createSshClient(device, creds, "show arp", parseGenericArp);
  }
  return createSnmpArpClient(device);
}

function createOmadaClient(device: NetworkDevice): Promise<RouterClient> {
  // Omada primarily uses SNMP or API
  if (device.protocol === "api" && device.api_url) {
    return createOmadaApiClient(device);
  }
  return createSnmpArpClient(device);
}

async function createOmadaApiClient(device: NetworkDevice): Promise<RouterClient> {
  const apiToken = device.api_token ? decrypt(device.api_token) : "";
  const baseUrl = device.api_url || `https://${device.host}`;

  return {
    async getArpTable() {
      const res = await fetch(`${baseUrl}/api/v2/arp`, {
        headers: { Authorization: `Bearer ${apiToken}` },
      });
      if (!res.ok) throw new Error(`Omada API error: ${res.status}`);
      const data = await res.json();

      return (data.result?.data || []).map((entry: Record<string, string>) => ({
        mac: entry.mac || "",
        ip: entry.ip || null,
        interface_name: entry.interface || null,
      }));
    },
    async testConnection() {
      try {
        const res = await fetch(`${baseUrl}/api/v2/info`, {
          headers: { Authorization: `Bearer ${apiToken}` },
        });
        return res.ok;
      } catch {
        return false;
      }
    },
  };
}

/** Router client con fallback su più comandi ARP per firewall/dispositivi "other" */
async function createGenericSshRouterClient(device: NetworkDevice, creds: DeviceCreds): Promise<RouterClient> {
  const commands = [
    { cmd: "show arp", parser: parseGenericArp },
    { cmd: "show ip arp", parser: parseGenericArp },
    { cmd: "arp -a", parser: parseGenericArp },
    { cmd: "arp -n", parser: parseGenericArp },
    { cmd: "arp", parser: parseGenericArp },
    { cmd: "ip neigh show", parser: parseLinuxIpNeigh },
    { cmd: "ip neighbor", parser: parseLinuxIpNeigh },
    { cmd: "cat /proc/net/arp", parser: parseLinuxProcArp },
  ];

  const { Client } = await import("ssh2");

  function execCmd(cmd: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const conn = new Client();
      conn.on("ready", () => {
        conn.exec(cmd, (err, stream) => {
          if (err) {
            conn.end();
            reject(err);
            return;
          }
          let output = "";
          stream.on("data", (data: Buffer) => {
            output += data.toString();
          });
          stream.stderr.on("data", (data: Buffer) => {
            output += data.toString();
          });
          stream.on("close", () => {
            conn.end();
            resolve(output);
          });
        });
      });
      conn.on("error", reject);
      conn.connect({
        host: device.host,
        port: device.port || 22,
        username: creds.username || device.username || undefined,
        password: creds.password,
        readyTimeout: 10000,
        algorithms: {
          kex: ["diffie-hellman-group14-sha256", "diffie-hellman-group14-sha1", "diffie-hellman-group-exchange-sha256", "diffie-hellman-group1-sha1"],
        },
      });
    });
  }

  return {
    async getArpTable() {
      for (const { cmd, parser } of commands) {
        try {
          const output = await execCmd(cmd);
          if (
            output.includes("not found") ||
            output.includes("Invalid") ||
            output.includes("Unknown command") ||
            output.includes("command not found") ||
            output.trim().length === 0
          ) {
            continue;
          }
          const entries = parser(output);
          if (entries.length > 0) return entries;
        } catch {
          continue;
        }
      }
      return [];
    },
    async testConnection() {
      try {
        await execCmd("echo test");
        return true;
      } catch {
        return false;
      }
    },
  };
}

function parseLinuxIpNeigh(output: string): ArpTableEntry[] {
  const entries: ArpTableEntry[] = [];
  for (const line of output.split("\n")) {
    const parts = line.trim().split(/\s+/);
    const ipMatch = parts.find((p) => /^\d+\.\d+\.\d+\.\d+$/.test(p));
    const macMatch = parts.find((p) => /^[0-9a-fA-F]{2}(:[0-9a-fA-F]{2}){5}$/.test(p));
    if (ipMatch && macMatch) {
      entries.push({ ip: ipMatch, mac: macMatch.toUpperCase(), interface_name: null });
    }
  }
  return entries;
}

function parseLinuxProcArp(output: string): ArpTableEntry[] {
  const entries: ArpTableEntry[] = [];
  const lines = output.split("\n").slice(1);
  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts.length >= 4) {
      const ip = parts[0];
      const mac = parts[3];
      if (/^\d+\.\d+\.\d+\.\d+$/.test(ip) && /^[0-9a-fA-F:]+$/.test(mac) && mac !== "00:00:00:00:00:00") {
        entries.push({ ip, mac: mac.toUpperCase(), interface_name: null });
      }
    }
  }
  return entries;
}

function parseMikrotikDhcpLeases(output: string): DhcpLeaseEntry[] {
  const entries: DhcpLeaseEntry[] = [];
  for (const line of output.split("\n")) {
    // MikroTik: address=, active-address= (dynamic), mac-address=, active-mac-address=, host-name=
    const ipMatch = line.match(/(?:active-address|address)=(\d+\.\d+\.\d+\.\d+)/);
    const macMatch = line.match(/(?:active-mac-address|mac-address)=([0-9A-Fa-f:]+)/);
    const hostMatch = line.match(/host-name="([^"]*)"|host-name=(\S+)/);
    const statusMatch = line.match(/status=(\S+)/);
    const serverMatch = line.match(/server=(\S+)/);
    const expiresMatch = line.match(/expires-after=(\S+)/);
    const lastSeenMatch = line.match(/last-seen=(\S+)/);
    const commentMatch = line.match(/comment="([^"]*)"|comment=(\S+)/);

    if (ipMatch && macMatch) {
      const hostname = (hostMatch?.[1] ?? hostMatch?.[2])?.trim() || null;
      entries.push({
        ip: ipMatch[1],
        mac: macMatch[1].toUpperCase(),
        hostname: hostname && hostname.length > 0 ? hostname : null,
        status: statusMatch?.[1] || undefined,
        server: serverMatch?.[1] || undefined,
        expiresAfter: expiresMatch?.[1] || undefined,
        lastSeen: lastSeenMatch?.[1] || undefined,
        comment: (commentMatch?.[1] ?? commentMatch?.[2]) || undefined,
      });
    }
  }
  return entries;
}

function parseMikrotikDhcpServers(output: string): DhcpServerInfo[] {
  const entries: DhcpServerInfo[] = [];
  for (const line of output.split("\n")) {
    const nameMatch = line.match(/name=(\S+)/);
    const ifMatch = line.match(/interface=(\S+)/);
    const poolMatch = line.match(/address-pool=(\S+)/);
    const disabledMatch = line.match(/disabled=(yes|no)/);

    if (nameMatch) {
      entries.push({
        name: nameMatch[1].replace(/"/g, ""),
        interface: ifMatch?.[1] || "",
        addressPool: poolMatch?.[1] || "",
        disabled: disabledMatch?.[1] === "yes",
      });
    }
  }
  return entries;
}

function parseMikrotikDhcpPools(output: string): DhcpPoolInfo[] {
  const entries: DhcpPoolInfo[] = [];
  for (const line of output.split("\n")) {
    const nameMatch = line.match(/name=(\S+)/);
    const rangesMatch = line.match(/ranges=(\S+)/);
    const nextPoolMatch = line.match(/next-pool=(\S+)/);

    if (nameMatch) {
      entries.push({
        name: nameMatch[1].replace(/"/g, ""),
        ranges: rangesMatch?.[1] || "",
        nextPool: nextPoolMatch?.[1],
      });
    }
  }
  return entries;
}

// ARP output parsers
function parseMikrotikArp(output: string): ArpTableEntry[] {
  const entries: ArpTableEntry[] = [];
  for (const line of output.split("\n")) {
    // MikroTik terse format: .id=*1 interface=ether1 address=192.168.1.1 mac-address=AA:BB:CC:DD:EE:FF
    const ipMatch = line.match(/address=(\d+\.\d+\.\d+\.\d+)/);
    const macMatch = line.match(/mac-address=([0-9A-Fa-f:]+)/);
    const ifMatch = line.match(/interface=(\S+)/);

    if (ipMatch && macMatch) {
      entries.push({
        ip: ipMatch[1],
        mac: macMatch[1].toUpperCase(),
        interface_name: ifMatch?.[1] || null,
      });
    }
  }
  return entries;
}

function parseCiscoArp(output: string): ArpTableEntry[] {
  const entries: ArpTableEntry[] = [];
  for (const line of output.split("\n")) {
    // Cisco format: Internet  192.168.1.1    10   aaaa.bbbb.cccc  ARPA   GigabitEthernet0/0
    const match = line.match(/Internet\s+(\d+\.\d+\.\d+\.\d+)\s+\S+\s+([0-9a-fA-F.]+)\s+\S+\s+(\S+)/);
    if (match) {
      // Convert Cisco MAC format (aaaa.bbbb.cccc) to standard (AA:BB:CC:DD:EE:FF)
      const rawMac = match[2].replace(/\./g, "");
      const mac = rawMac.match(/.{2}/g)!.join(":").toUpperCase();
      entries.push({
        ip: match[1],
        mac,
        interface_name: match[3],
      });
    }
  }
  return entries;
}

function parseGenericArp(output: string): ArpTableEntry[] {
  const entries: ArpTableEntry[] = [];
  for (const line of output.split("\n")) {
    // Generic: look for IP and MAC pattern
    const ipMatch = line.match(/(\d+\.\d+\.\d+\.\d+)/);
    const macMatch = line.match(/([0-9a-fA-F]{2}[:-][0-9a-fA-F]{2}[:-][0-9a-fA-F]{2}[:-][0-9a-fA-F]{2}[:-][0-9a-fA-F]{2}[:-][0-9a-fA-F]{2})/);

    if (ipMatch && macMatch) {
      entries.push({
        ip: ipMatch[1],
        mac: macMatch[1].toUpperCase(),
        interface_name: null,
      });
    }
  }
  return entries;
}
