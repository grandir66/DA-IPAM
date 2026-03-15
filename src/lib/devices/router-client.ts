import type { NetworkDevice } from "@/types";
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
}

export interface RouterClient {
  getArpTable(): Promise<ArpTableEntry[]>;
  testConnection(): Promise<boolean>;
  /** Solo MikroTik SSH: recupera lease DHCP con hostname client */
  getDhcpLeases?(): Promise<DhcpLeaseEntry[]>;
  /** SNMP: elenco interfacce con LLDP/CDP (opzionale) */
  getPortSchema?(): Promise<PortInfo[]>;
}

export async function createRouterClient(device: NetworkDevice): Promise<RouterClient> {
  const password = device.encrypted_password ? decrypt(device.encrypted_password) : undefined;
  const primary = await getVendorRouterClient(device, password);

  // Se il client primario non ha getPortSchema ma il device ha SNMP (community_string),
  // aggiungi fallback per acquisire porte e LLDP/CDP
  let client: RouterClient = primary;
  if (!primary.getPortSchema && device.community_string) {
    const snmpClient = await createSnmpArpClient(device);
    client = { ...primary, getPortSchema: () => snmpClient.getPortSchema!() };
  }

  // Fallback SSH → SNMP: se SSH fallisce (es. credenziali mancanti), prova SNMP
  if (device.protocol === "ssh" && device.community_string) {
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

async function getVendorRouterClient(device: NetworkDevice, password: string | undefined): Promise<RouterClient> {
  switch (device.vendor) {
    case "mikrotik":
      return createMikrotikClient(device, password);
    case "cisco":
      return createCiscoClient(device, password);
    case "ubiquiti":
      return createUbiquitiClient(device, password);
    case "hp":
      return createHpClient(device, password);
    case "omada":
      return createOmadaClient(device);
    case "other":
      if (device.protocol === "snmp_v2" || device.protocol === "snmp_v3") {
        return createSnmpArpClient(device);
      }
      return createGenericSshClient(device, password);
    default:
      if (device.protocol === "snmp_v2" || device.protocol === "snmp_v3") {
        return createSnmpArpClient(device);
      }
      return createGenericSshClient(device, password);
  }
}

// SSH-based client factory
async function createSshClient(
  device: NetworkDevice,
  password: string | undefined,
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
        username: device.username || undefined,
        password: password,
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

// SNMP-based ARP client
async function createSnmpArpClient(
  device: NetworkDevice
): Promise<RouterClient> {
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
async function createMikrotikClient(device: NetworkDevice, password: string | undefined): Promise<RouterClient> {
  if (device.protocol !== "ssh") {
    return createSnmpArpClient(device);
  }
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
        password: password,
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

function createCiscoClient(device: NetworkDevice, password: string | undefined): Promise<RouterClient> {
  if (device.protocol === "ssh") {
    return createSshClient(device, password, "show ip arp", parseCiscoArp);
  }
  return createSnmpArpClient(device);
}

function createUbiquitiClient(device: NetworkDevice, password: string | undefined): Promise<RouterClient> {
  if (device.protocol === "ssh") {
    return createSshClient(device, password, "show arp", parseGenericArp);
  }
  return createSnmpArpClient(device);
}

function createHpClient(device: NetworkDevice, password: string | undefined): Promise<RouterClient> {
  if (device.protocol === "ssh") {
    return createSshClient(device, password, "show arp", parseGenericArp);
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

function createGenericSshClient(device: NetworkDevice, password: string | undefined): Promise<RouterClient> {
  return createSshClient(device, password, "show arp", parseGenericArp);
}

function parseMikrotikDhcpLeases(output: string): DhcpLeaseEntry[] {
  const entries: DhcpLeaseEntry[] = [];
  for (const line of output.split("\n")) {
    // MikroTik: address=, active-address= (dynamic), mac-address=, active-mac-address=, host-name=
    const ipMatch = line.match(/(?:active-address|address)=(\d+\.\d+\.\d+\.\d+)/);
    const macMatch = line.match(/(?:active-mac-address|mac-address)=([0-9A-Fa-f:]+)/);
    const hostMatch = line.match(/host-name="([^"]*)"|host-name=(\S+)/);
    if (ipMatch && macMatch) {
      const hostname = (hostMatch?.[1] ?? hostMatch?.[2])?.trim() || null;
      entries.push({
        ip: ipMatch[1],
        mac: macMatch[1].toUpperCase(),
        hostname: hostname && hostname.length > 0 ? hostname : null,
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
