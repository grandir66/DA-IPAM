import type { NetworkDevice } from "@/types";
import { getDeviceCredentials, getDeviceCommunityString, getDeviceSnmpV3Credentials, getCredentialCommunityString } from "@/lib/db";
import { decrypt, safeDecrypt } from "@/lib/crypto";
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
  /** RouterOS `dynamic=yes|no`: true = pool DHCP, false = lease statico (binding fisso) */
  dynamic?: boolean;
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

/** Neighbor LLDP/CDP/MNDP scoperto su un'interfaccia del router */
export interface NeighborEntry {
  localPort: string;
  remoteDevice: string;
  remotePort: string;
  protocol: "lldp" | "cdp" | "mndp" | "unknown";
  remoteIp?: string;
  remoteMac?: string;
  remotePlatform?: string;
}

/** Riga della tabella di routing */
export interface RouteEntry {
  destination: string;
  gateway: string | null;
  interface_name: string | null;
  protocol: "connected" | "static" | "ospf" | "bgp" | "rip" | "other";
  metric?: number;
  distance?: number;
  active: boolean;
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
  /** Neighbors LLDP/CDP/MNDP (multi-vendor SSH + SNMP) */
  getNeighbors?(): Promise<NeighborEntry[]>;
  /** Tabella di routing (multi-vendor SSH + SNMP) */
  getRoutingTable?(): Promise<RouteEntry[]>;
}

export async function createRouterClient(device: NetworkDevice): Promise<RouterClient> {
  const creds = getDeviceCredentials(device);
  const username = creds?.username ?? device.username ?? undefined;
  const password = creds?.password;
  const primary = await getVendorRouterClient(device, { username, password });

  // Se il client primario non ha getPortSchema ma il device ha SNMP (community_string, credential, o binding SNMP),
  // aggiungi fallback per acquisire porte e LLDP/CDP
  const { getDb } = await import("@/lib/db");
  const hasSnmpBinding = !!(getDb().prepare(
    "SELECT 1 FROM device_credential_bindings WHERE device_id = ? AND protocol_type = 'snmp' LIMIT 1"
  ).get(device.id));
  const hasSnmpCommunity = device.community_string
    || (device.snmp_credential_id ? !!getCredentialCommunityString(device.snmp_credential_id) : false)
    || (device.credential_id ? !!getCredentialCommunityString(device.credential_id) : false)
    || hasSnmpBinding;
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
      getNeighbors: client.getNeighbors
        ? async () => {
            try { return await client.getNeighbors!(); } catch { /* ignore */ }
            return snmpClient.getNeighbors?.() ?? [];
          }
        : snmpClient.getNeighbors,
      getRoutingTable: client.getRoutingTable
        ? async () => {
            try { return await client.getRoutingTable!(); } catch { /* ignore */ }
            return snmpClient.getRoutingTable?.() ?? [];
          }
        : snmpClient.getRoutingTable,
    };
  }

  // Aggiungi getNeighbors SNMP se il client SSH non ce l'ha ma SNMP è disponibile
  if (!client.getNeighbors && hasSnmpCommunity) {
    const snmpClient = await createSnmpArpClient(device);
    client = { ...client, getNeighbors: () => snmpClient.getNeighbors?.() ?? Promise.resolve([]) };
  }
  if (!client.getRoutingTable && hasSnmpCommunity) {
    const snmpClient = await createSnmpArpClient(device);
    client = { ...client, getRoutingTable: () => snmpClient.getRoutingTable?.() ?? Promise.resolve([]) };
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
      conn.on("error", (err) => { try { conn.end(); } catch { /* ignore */ } reject(err); });
      conn.connect({
        host: device.host,
        port: device.port,
        username: creds.username || device.username || undefined,
        password: creds.password,
        readyTimeout: 10000,
        algorithms: {
          kex: ["curve25519-sha256", "curve25519-sha256@libssh.org", "ecdh-sha2-nistp256", "ecdh-sha2-nistp384", "ecdh-sha2-nistp521", "diffie-hellman-group-exchange-sha256", "diffie-hellman-group14-sha256", "diffie-hellman-group14-sha1"],
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
  // SNMP usa sempre porta 161 (standard)
  const opts = { port: 161, timeout: 10000 };

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
      let settled = false;

      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          try { session.close(); } catch { /* ignore */ }
          reject(new Error(`SNMP walk timeout for OID ${oid}`));
        }
      }, 30000);

      session.subtree(
        oid,
        (varbinds: Array<{ oid: string; value: Buffer | string | number }>) => {
          for (const vb of varbinds) {
            results.push({ oid: vb.oid, value: vb.value });
          }
        },
        (error: Error | undefined) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
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
    async getNeighbors() {
      return getSnmpNeighbors(snmpWalk);
    },
    async getRoutingTable() {
      return getSnmpRoutingTable(snmpWalk);
    },
  };
}

/** Recupera neighbors LLDP/CDP via SNMP (riusa logica di snmp-port-schema ma ritorna NeighborEntry[]) */
async function getSnmpNeighbors(
  snmpWalk: (oid: string) => Promise<{ oid: string; value: Buffer | string | number }[]>
): Promise<NeighborEntry[]> {
  const ifDescrMap = new Map<number, string>();
  try {
    const ifDescrResults = await snmpWalk("1.3.6.1.2.1.2.2.1.2");
    for (const r of ifDescrResults) {
      const ifIndex = parseInt(r.oid.split(".").pop()!);
      ifDescrMap.set(ifIndex, String(r.value));
    }
  } catch { /* optional */ }

  const neighbors: NeighborEntry[] = [];

  // LLDP-MIB
  try {
    const [lldpSys, lldpPort, lldpPortDesc] = await Promise.all([
      snmpWalk("1.0.8802.1.1.2.1.4.1.1.9"),   // lldpRemSysName
      snmpWalk("1.0.8802.1.1.2.1.4.1.1.7"),   // lldpRemPortId
      snmpWalk("1.0.8802.1.1.2.1.4.1.1.8"),   // lldpRemPortDesc
    ]);
    const sysMap = new Map<string, string>();
    const portMap = new Map<string, string>();
    const portDescMap = new Map<string, string>();
    for (const r of lldpSys) sysMap.set(r.oid.split(".").slice(-3).join("."), String(r.value ?? "").trim());
    for (const r of lldpPort) portMap.set(r.oid.split(".").slice(-3).join("."), String(r.value ?? "").trim());
    for (const r of lldpPortDesc) portDescMap.set(r.oid.split(".").slice(-3).join("."), String(r.value ?? "").trim());

    for (const [key, remoteName] of sysMap) {
      const localIfIndex = parseInt(key.split(".")[0]);
      const localPort = ifDescrMap.get(localIfIndex) || `if${localIfIndex}`;
      const remotePort = portMap.get(key) || portDescMap.get(key) || "";
      if (remoteName || remotePort) {
        neighbors.push({
          localPort,
          remoteDevice: remoteName,
          remotePort,
          protocol: "lldp",
        });
      }
    }
  } catch { /* LLDP optional */ }

  // Cisco CDP
  try {
    const [cdpId, cdpPort, cdpAddr, cdpPlatform] = await Promise.all([
      snmpWalk("1.3.6.1.4.1.9.9.23.1.2.1.1.6"),  // cdpCacheDeviceId
      snmpWalk("1.3.6.1.4.1.9.9.23.1.2.1.1.7"),  // cdpCacheDevicePort
      snmpWalk("1.3.6.1.4.1.9.9.23.1.2.1.1.4"),  // cdpCacheAddress
      snmpWalk("1.3.6.1.4.1.9.9.23.1.2.1.1.8"),  // cdpCachePlatform
    ]);
    const portBySuffix = new Map<string, string>();
    const addrBySuffix = new Map<string, string>();
    const platBySuffix = new Map<string, string>();
    for (const r of cdpPort) portBySuffix.set(r.oid.split(".").slice(-2).join("."), String(r.value ?? "").trim());
    for (const r of cdpAddr) {
      const suffix = r.oid.split(".").slice(-2).join(".");
      if (Buffer.isBuffer(r.value) && r.value.length === 4) {
        addrBySuffix.set(suffix, Array.from(r.value).join("."));
      }
    }
    for (const r of cdpPlatform) platBySuffix.set(r.oid.split(".").slice(-2).join("."), String(r.value ?? "").trim());

    for (const r of cdpId) {
      const parts = r.oid.split(".");
      const ifIndex = parseInt(parts[parts.length - 2]);
      const suffix = parts.slice(-2).join(".");
      const localPort = ifDescrMap.get(ifIndex) || `if${ifIndex}`;
      const name = String(r.value ?? "").trim();
      // Evita duplicati con LLDP (stesso localPort + remoteDevice)
      if (!neighbors.some((n) => n.localPort === localPort && n.remoteDevice === name)) {
        neighbors.push({
          localPort,
          remoteDevice: name,
          remotePort: portBySuffix.get(suffix) || "",
          protocol: "cdp",
          remoteIp: addrBySuffix.get(suffix),
          remotePlatform: platBySuffix.get(suffix),
        });
      }
    }
  } catch { /* CDP optional */ }

  return neighbors;
}

/** Recupera tabella di routing via SNMP (ipCidrRouteTable RFC 2096 / ipRouteTable RFC 1213 fallback) */
async function getSnmpRoutingTable(
  snmpWalk: (oid: string) => Promise<{ oid: string; value: Buffer | string | number }[]>
): Promise<RouteEntry[]> {
  const routes: RouteEntry[] = [];
  const ifDescrMap = new Map<number, string>();
  try {
    const ifDescrResults = await snmpWalk("1.3.6.1.2.1.2.2.1.2");
    for (const r of ifDescrResults) {
      ifDescrMap.set(parseInt(r.oid.split(".").pop()!), String(r.value));
    }
  } catch { /* optional */ }

  // Prova ipCidrRouteTable (RFC 2096) — più completo
  try {
    const nextHopResults = await snmpWalk("1.3.6.1.2.1.4.24.4.1.4"); // ipCidrRouteNextHop (solo per contare)
    if (nextHopResults.length > 0) {
      // ipCidrRouteTable OID structure: .dest.mask.tos.nexthop
      const typeResults = await snmpWalk("1.3.6.1.2.1.4.24.4.1.6");   // ipCidrRouteType
      const ifIdxResults = await snmpWalk("1.3.6.1.2.1.4.24.4.1.5");  // ipCidrRouteIfIndex
      const metricResults = await snmpWalk("1.3.6.1.2.1.4.24.4.1.11"); // ipCidrRouteMetric1

      const typeMap = new Map<string, number>();
      const ifIdxMap = new Map<string, number>();
      const metricMap = new Map<string, number>();
      for (const r of typeResults) typeMap.set(r.oid.split(".").slice(-13).join("."), Number(r.value));
      for (const r of ifIdxResults) ifIdxMap.set(r.oid.split(".").slice(-13).join("."), Number(r.value));
      for (const r of metricResults) metricMap.set(r.oid.split(".").slice(-13).join("."), Number(r.value));

      for (const r of nextHopResults) {
        const suffix = r.oid.split(".").slice(-13).join(".");
        const parts = suffix.split(".");
        const dest = parts.slice(0, 4).join(".");
        const mask = parts.slice(4, 8).join(".");
        const nexthop = parts.slice(9, 13).join(".");
        const cidr = netmaskToCidr(mask);
        const routeType = typeMap.get(suffix) ?? 0;
        const ifIdx = ifIdxMap.get(suffix) ?? 0;
        const metric = metricMap.get(suffix);

        routes.push({
          destination: `${dest}/${cidr}`,
          gateway: nexthop !== "0.0.0.0" ? nexthop : null,
          interface_name: ifDescrMap.get(ifIdx) || (ifIdx > 0 ? `if${ifIdx}` : null),
          protocol: snmpRouteProto(routeType),
          metric: metric && metric > 0 ? metric : undefined,
          active: true,
        });
      }
      return routes.slice(0, 200);
    }
  } catch { /* ipCidrRouteTable non supportata, prova legacy */ }

  // Fallback: ipRouteTable (RFC 1213)
  try {
    const destResults = await snmpWalk("1.3.6.1.2.1.4.21.1.1");  // ipRouteDest
    const nextHopResults = await snmpWalk("1.3.6.1.2.1.4.21.1.7"); // ipRouteNextHop
    const maskResults = await snmpWalk("1.3.6.1.2.1.4.21.1.11");   // ipRouteMask
    const typeResults = await snmpWalk("1.3.6.1.2.1.4.21.1.8");    // ipRouteProto
    const ifIdxResults = await snmpWalk("1.3.6.1.2.1.4.21.1.2");   // ipRouteIfIndex
    const metricResults = await snmpWalk("1.3.6.1.2.1.4.21.1.3");  // ipRouteMetric1

    const nhMap = new Map<string, string>();
    const maskMap = new Map<string, string>();
    const typeMap = new Map<string, number>();
    const ifMap = new Map<string, number>();
    const metricMap = new Map<string, number>();

    for (const r of nextHopResults) nhMap.set(r.oid.split(".").slice(-4).join("."), String(r.value));
    for (const r of maskResults) maskMap.set(r.oid.split(".").slice(-4).join("."), String(r.value));
    for (const r of typeResults) typeMap.set(r.oid.split(".").slice(-4).join("."), Number(r.value));
    for (const r of ifIdxResults) ifMap.set(r.oid.split(".").slice(-4).join("."), Number(r.value));
    for (const r of metricResults) metricMap.set(r.oid.split(".").slice(-4).join("."), Number(r.value));

    for (const r of destResults) {
      const dest = r.oid.split(".").slice(-4).join(".");
      const mask = maskMap.get(dest) || "255.255.255.0";
      const cidr = netmaskToCidr(mask);
      const nexthop = nhMap.get(dest) || "0.0.0.0";
      const routeProto = typeMap.get(dest) ?? 0;
      const ifIdx = ifMap.get(dest) ?? 0;
      const metric = metricMap.get(dest);

      routes.push({
        destination: `${dest}/${cidr}`,
        gateway: nexthop !== "0.0.0.0" ? nexthop : null,
        interface_name: ifDescrMap.get(ifIdx) || (ifIdx > 0 ? `if${ifIdx}` : null),
        protocol: snmpRouteProtoLegacy(routeProto),
        metric: metric && metric > 0 ? metric : undefined,
        active: true,
      });
    }
  } catch { /* nessuna tabella routing SNMP disponibile */ }

  return routes.slice(0, 200);
}

/** Converte netmask (es. 255.255.255.0) in CIDR prefix (es. 24) */
function netmaskToCidr(mask: string): number {
  return mask.split(".").reduce((acc, octet) => {
    let n = parseInt(octet, 10);
    while (n > 0) { acc += n & 1; n >>= 1; }
    return acc;
  }, 0);
}

/** ipCidrRouteType → protocol label */
function snmpRouteProto(type: number): RouteEntry["protocol"] {
  // RFC 2096 ipCidrRouteType: 1=other, 2=reject, 3=local, 4=remote
  // Combined with ipCidrRouteProto info from standard mapping
  switch (type) {
    case 3: return "connected";
    case 4: return "static"; // remote/indirect — best guess
    default: return "other";
  }
}

/** ipRouteProto (RFC 1213) → protocol label */
function snmpRouteProtoLegacy(proto: number): RouteEntry["protocol"] {
  switch (proto) {
    case 2: return "connected"; // local
    case 3: return "static";    // netmgmt
    case 8: return "rip";
    case 13: return "ospf";
    case 14: return "bgp";
    default: return "other";
  }
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
          kex: ["curve25519-sha256", "curve25519-sha256@libssh.org", "ecdh-sha2-nistp256", "ecdh-sha2-nistp384", "ecdh-sha2-nistp521", "diffie-hellman-group-exchange-sha256", "diffie-hellman-group14-sha256", "diffie-hellman-group14-sha1"],
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
    async getNeighbors() {
      const output = await execCommand("/ip neighbor print terse");
      return parseMikrotikNeighbors(output);
    },
    async getRoutingTable() {
      const output = await execCommand("/ip route print terse");
      return parseMikrotikRoutes(output);
    },
  };
}

async function createCiscoClient(device: NetworkDevice, creds: DeviceCreds): Promise<RouterClient> {
  if (device.protocol !== "ssh") return createSnmpArpClient(device);
  const base = await createSshClient(device, creds, "show ip arp", parseCiscoArp);
  const { Client } = await import("ssh2");

  function execCisco(cmd: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const conn = new Client();
      const timeout = setTimeout(() => { conn.end(); reject(new Error("Timeout")); }, 15000);
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
        host: device.host, port: device.port,
        username: creds.username || device.username || undefined, password: creds.password,
        readyTimeout: 10000,
        algorithms: { kex: ["curve25519-sha256", "curve25519-sha256@libssh.org", "ecdh-sha2-nistp256", "ecdh-sha2-nistp384", "ecdh-sha2-nistp521", "diffie-hellman-group-exchange-sha256", "diffie-hellman-group14-sha256", "diffie-hellman-group14-sha1", "diffie-hellman-group1-sha1"] },
      });
    });
  }

  return {
    ...base,
    async getNeighbors() {
      const neighbors: NeighborEntry[] = [];
      // CDP
      try {
        const cdpOut = await execCisco("show cdp neighbors detail");
        neighbors.push(...parseCiscoNeighbors(cdpOut, "cdp"));
      } catch { /* optional */ }
      // LLDP
      try {
        const lldpOut = await execCisco("show lldp neighbors detail");
        neighbors.push(...parseCiscoNeighbors(lldpOut, "lldp"));
      } catch { /* optional */ }
      return neighbors;
    },
    async getRoutingTable() {
      try {
        const output = await execCisco("show ip route");
        return parseCiscoRoutes(output);
      } catch { return []; }
    },
  };
}

async function createUbiquitiClient(device: NetworkDevice, creds: DeviceCreds): Promise<RouterClient> {
  if (device.protocol !== "ssh") return createSnmpArpClient(device);
  const base = await createSshClient(device, creds, "show arp", parseGenericArp);
  const { Client } = await import("ssh2");

  function execUbnt(cmd: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const conn = new Client();
      const timeout = setTimeout(() => { conn.end(); reject(new Error("Timeout")); }, 15000);
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
        host: device.host, port: device.port,
        username: creds.username || device.username || undefined, password: creds.password,
        readyTimeout: 10000,
        algorithms: { kex: ["curve25519-sha256", "curve25519-sha256@libssh.org", "ecdh-sha2-nistp256", "ecdh-sha2-nistp384", "ecdh-sha2-nistp521", "diffie-hellman-group-exchange-sha256", "diffie-hellman-group14-sha256", "diffie-hellman-group14-sha1", "diffie-hellman-group1-sha1"] },
      });
    });
  }

  return {
    ...base,
    async getDhcpLeases() {
      try {
        // EdgeOS: show dhcp leases
        const output = await execUbnt("show dhcp leases 2>/dev/null || cat /var/run/dhcpd.leases 2>/dev/null || cat /tmp/dhcpd.leases 2>/dev/null");
        return parseEdgeOsDhcpLeases(output);
      } catch { return []; }
    },
    async getNeighbors() {
      // EdgeOS usa lldpctl; UniFi potrebbe usare lldpctl o file
      try {
        const out = await execUbnt("lldpctl -f json 2>/dev/null || lldpcli show neighbors -f json 2>/dev/null");
        return parseLldpctlJson(out);
      } catch { return []; }
    },
    async getRoutingTable() {
      try {
        const output = await execUbnt("show ip route 2>/dev/null || ip route show 2>/dev/null");
        return parseEdgeOsRoutes(output);
      } catch { return []; }
    },
  };
}

async function createHpClient(device: NetworkDevice, creds: DeviceCreds): Promise<RouterClient> {
  if (device.protocol !== "ssh") return createSnmpArpClient(device);
  const base = await createSshClient(device, creds, "show arp", parseGenericArp);
  const { Client } = await import("ssh2");

  function execHp(cmd: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const conn = new Client();
      const timeout = setTimeout(() => { conn.end(); reject(new Error("Timeout")); }, 15000);
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
        host: device.host, port: device.port,
        username: creds.username || device.username || undefined, password: creds.password,
        readyTimeout: 10000,
        algorithms: { kex: ["curve25519-sha256", "curve25519-sha256@libssh.org", "ecdh-sha2-nistp256", "ecdh-sha2-nistp384", "ecdh-sha2-nistp521", "diffie-hellman-group-exchange-sha256", "diffie-hellman-group14-sha256", "diffie-hellman-group14-sha1", "diffie-hellman-group1-sha1"] },
      });
    });
  }

  return {
    ...base,
    async getNeighbors() {
      try {
        // ProCurve: "show lldp info remote-device", Comware: "display lldp neighbor-information"
        const out = await execHp("show lldp info remote-device 2>/dev/null || display lldp neighbor-information 2>/dev/null || show lldp neighbors 2>/dev/null");
        return parseHpLldpNeighbors(out);
      } catch { return []; }
    },
    async getRoutingTable() {
      try {
        const output = await execHp("show ip route 2>/dev/null || display ip routing-table 2>/dev/null");
        return parseGenericRoutes(output);
      } catch { return []; }
    },
  };
}

function createOmadaClient(device: NetworkDevice): Promise<RouterClient> {
  // Omada primarily uses SNMP or API
  if (device.protocol === "api" && device.api_url) {
    return createOmadaApiClient(device);
  }
  return createSnmpArpClient(device);
}

async function createOmadaApiClient(device: NetworkDevice): Promise<RouterClient> {
  const apiToken = device.api_token ? (safeDecrypt(device.api_token) ?? "") : "";
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
      conn.on("error", (err) => { try { conn.end(); } catch { /* ignore */ } reject(err); });
      conn.connect({
        host: device.host,
        port: device.port || 22,
        username: creds.username || device.username || undefined,
        password: creds.password,
        readyTimeout: 10000,
        algorithms: {
          kex: ["curve25519-sha256", "curve25519-sha256@libssh.org", "ecdh-sha2-nistp256", "ecdh-sha2-nistp384", "ecdh-sha2-nistp521", "diffie-hellman-group-exchange-sha256", "diffie-hellman-group14-sha256", "diffie-hellman-group14-sha1", "diffie-hellman-group1-sha1"],
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

    // RouterOS terse: il flag "D" tra numero e primo key=value indica lease dinamico.
    // Formato riga:  " 0 D  address=... " (dynamic) oppure " 1    address=..." (static)
    // Fallback: alcune versioni potrebbero esporre dynamic=yes|no come key=value.
    let dynamic: boolean | undefined;
    const dynamicKvMatch = line.match(/dynamic=(yes|no|true|false)/i);
    if (dynamicKvMatch) {
      const v = dynamicKvMatch[1].toLowerCase();
      dynamic = v === "yes" || v === "true";
    } else if (ipMatch) {
      // Controlla flags terse: la porzione prima del primo "key=" contiene i flag
      const beforeKeys = line.substring(0, line.indexOf("=")).replace(/\S+=.*/, "");
      dynamic = /\bD\b/.test(beforeKeys);
    }

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
        dynamic,
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

// ─── Neighbor parsers ────────────────────────────────────────────────

/** MikroTik: /ip neighbor print terse */
function parseMikrotikNeighbors(output: string): NeighborEntry[] {
  const entries: NeighborEntry[] = [];
  for (const line of output.split("\n")) {
    const iface = line.match(/interface=(\S+)/)?.[1];
    const identity = line.match(/identity="([^"]+)"|identity=(\S+)/);
    const address = line.match(/address=(\d+\.\d+\.\d+\.\d+)/)?.[1];
    const macAddr = line.match(/mac-address=([0-9A-Fa-f:]+)/)?.[1];
    const platform = line.match(/platform="([^"]+)"|platform=(\S+)/);
    const intPort = line.match(/interface-name="([^"]+)"|interface-name=(\S+)/);

    const remoteName = identity?.[1] ?? identity?.[2] ?? "";
    if (!iface && !remoteName) continue;

    entries.push({
      localPort: iface || "",
      remoteDevice: remoteName,
      remotePort: intPort?.[1] ?? intPort?.[2] ?? "",
      protocol: "mndp",
      remoteIp: address,
      remoteMac: macAddr?.toUpperCase(),
      remotePlatform: platform?.[1] ?? platform?.[2],
    });
  }
  return entries;
}

/** Cisco: show cdp/lldp neighbors detail */
function parseCiscoNeighbors(output: string, proto: "cdp" | "lldp"): NeighborEntry[] {
  const entries: NeighborEntry[] = [];
  // Split by separator (--- or blank line between entries)
  const blocks = output.split(/^-{3,}$/m).filter((b) => b.trim());

  for (const block of blocks) {
    const deviceId = block.match(/Device ID[:\s]+(.+)/i)?.[1]?.trim()
      || block.match(/System Name[:\s]+(.+)/i)?.[1]?.trim();
    const localInt = block.match(/(?:Interface|Local Intf)[:\s]+(\S+)/i)?.[1]?.trim();
    const remotePort = block.match(/Port ID[:\s]+(\S+)/i)?.[1]?.trim()
      || block.match(/(?:Port|Outgoing)[^:]*port[:\s]+(\S+)/i)?.[1]?.trim();
    const platform = block.match(/Platform[:\s]+(.+?)(?:,|\n)/i)?.[1]?.trim();
    const ipMatch = block.match(/(?:IP address|Management address)[:\s]+(\d+\.\d+\.\d+\.\d+)/i);

    if (deviceId || remotePort) {
      entries.push({
        localPort: localInt || "",
        remoteDevice: deviceId || "",
        remotePort: remotePort || "",
        protocol: proto,
        remoteIp: ipMatch?.[1],
        remotePlatform: platform,
      });
    }
  }
  return entries;
}

/** lldpctl -f json output parser */
function parseLldpctlJson(output: string): NeighborEntry[] {
  const entries: NeighborEntry[] = [];
  try {
    const data = JSON.parse(output);
    const lldp = data?.lldp?.interface || data?.lldp || {};
    const interfaces = Array.isArray(lldp) ? lldp : Object.entries(lldp);

    for (const item of interfaces) {
      let ifName: string;
      let chassis: Record<string, unknown>;
      let port: Record<string, unknown>;

      if (Array.isArray(item)) {
        // Object.entries format: [ifName, details]
        ifName = String(item[0]);
        const details = item[1] as Record<string, unknown>;
        const neighbor = (details.chassis || details) as Record<string, unknown>;
        chassis = (typeof neighbor === "object" ? Object.values(neighbor)[0] : neighbor) as Record<string, unknown> || {};
        port = (details.port || {}) as Record<string, unknown>;
      } else {
        // Array format
        ifName = (item as Record<string, unknown>).name as string || "";
        chassis = ((item as Record<string, unknown>).chassis || {}) as Record<string, unknown>;
        port = ((item as Record<string, unknown>).port || {}) as Record<string, unknown>;
      }

      const nested = (obj: Record<string, unknown>, key: string, subkey: string): string =>
        String((obj[key] as Record<string, unknown> | undefined)?.[subkey] ?? "");
      const remoteName = String(chassis?.name || nested(chassis, "id", "value") || "");
      const remotePort = String(nested(port, "id", "value") || port?.descr || "");
      const mgmtIp = String(chassis?.["mgmt-ip"] || "");
      const descr = String(chassis?.descr || "");

      if (remoteName || remotePort) {
        entries.push({
          localPort: ifName,
          remoteDevice: String(remoteName),
          remotePort: String(remotePort),
          protocol: "lldp",
          remoteIp: typeof mgmtIp === "string" && /^\d+\.\d+\.\d+\.\d+$/.test(mgmtIp) ? mgmtIp : undefined,
          remotePlatform: descr ? String(descr) : undefined,
        });
      }
    }
  } catch {
    // Non-JSON output, parse testuale
    return parseTextLldpNeighbors(output);
  }
  return entries;
}

/** Fallback: parse output testuale di lldpctl o show lldp neighbors */
function parseTextLldpNeighbors(output: string): NeighborEntry[] {
  const entries: NeighborEntry[] = [];
  const blocks = output.split(/^-{3,}$|^Interface:/m);
  for (const block of blocks) {
    const localPort = block.match(/(?:Interface|Local Port)[:\s]+(\S+)/i)?.[1];
    const sysName = block.match(/SysName[:\s]+(.+)/i)?.[1]?.trim();
    const portId = block.match(/PortID[:\s]+(.+)/i)?.[1]?.trim()
      || block.match(/Port Description[:\s]+(.+)/i)?.[1]?.trim();
    const mgmtIp = block.match(/MgmtIP[:\s]+(\d+\.\d+\.\d+\.\d+)/i)?.[1];
    if (sysName || portId) {
      entries.push({
        localPort: localPort || "",
        remoteDevice: sysName || "",
        remotePort: portId || "",
        protocol: "lldp",
        remoteIp: mgmtIp,
      });
    }
  }
  return entries;
}

/** HP ProCurve/Comware LLDP neighbors */
function parseHpLldpNeighbors(output: string): NeighborEntry[] {
  const entries: NeighborEntry[] = [];
  // ProCurve: tabellare con LocalPort | ChassisId | PortId | PortDescr | SysName
  const lines = output.split("\n");
  for (const line of lines) {
    // Skip header/separator
    if (line.includes("Local Port") || line.includes("---") || !line.trim()) continue;
    const parts = line.trim().split(/\s{2,}/);
    if (parts.length >= 3) {
      const localPort = parts[0];
      const sysName = parts.length >= 5 ? parts[4] : parts[parts.length - 1];
      const portDescr = parts.length >= 4 ? parts[3] : parts[2];
      if (/\d/.test(localPort)) {
        entries.push({
          localPort,
          remoteDevice: sysName || "",
          remotePort: portDescr || "",
          protocol: "lldp",
        });
      }
    }
  }
  return entries;
}

// ─── Route parsers ───────────────────────────────────────────────────

/** MikroTik: /ip route print terse
 * Formato: " 0 ADC  dst-address=10.0.0.0/24 gateway=ether1 gateway-status=reachable distance=0 scope=10"
 * Flags prima del primo key=value: A=active, D=dynamic, S=static, C=connect, o=ospf, b=bgp, r=rip
 */
function parseMikrotikRoutes(output: string): RouteEntry[] {
  const entries: RouteEntry[] = [];
  for (const line of output.split("\n")) {
    const dst = line.match(/dst-address=(\S+)/)?.[1];
    if (!dst) continue;
    const gw = line.match(/gateway=(\S+)/)?.[1];
    const iface = line.match(/(?:pref-src|interface)=(\S+)/)?.[1];
    const distance = line.match(/distance=(\d+)/)?.[1];

    // Flags: parte prima del primo "key=" (es. " 0 ADC ")
    const dstIdx = line.indexOf("dst-address=");
    const beforeKeys = dstIdx >= 0 ? line.substring(0, dstIdx) : "";
    const flags = beforeKeys.replace(/\d+/g, "").trim();

    let protocol: RouteEntry["protocol"] = "other";
    if (/C/i.test(flags) || line.includes("connect")) protocol = "connected";
    else if (/S/i.test(flags) || line.includes("static")) protocol = "static";
    else if (/o/i.test(flags) || line.includes("ospf")) protocol = "ospf";
    else if (/b/i.test(flags) || line.includes("bgp")) protocol = "bgp";
    else if (/r/i.test(flags) || line.includes("rip")) protocol = "rip";

    const active = /A/i.test(flags);

    entries.push({
      destination: dst,
      gateway: gw && gw !== "0.0.0.0" ? gw : null,
      interface_name: iface || null,
      protocol,
      distance: distance ? parseInt(distance, 10) : undefined,
      active,
    });
  }
  return entries.slice(0, 200);
}

/** Cisco: show ip route */
function parseCiscoRoutes(output: string): RouteEntry[] {
  const entries: RouteEntry[] = [];
  for (const line of output.split("\n")) {
    // Formato: "C    192.168.1.0/24 is directly connected, GigabitEthernet0/0"
    //          "S    10.0.0.0/8 [1/0] via 192.168.1.1"
    //          "O    172.16.0.0/16 [110/20] via 10.1.1.1, 00:05:00, Ethernet0"
    const match = line.match(/^([CSOBDR*>i\s]+)\s+(\d+\.\d+\.\d+\.\d+(?:\/\d+)?)\s/);
    if (!match) continue;
    const flags = match[1].trim();
    let dest = match[2];
    if (!dest.includes("/")) dest += "/32";

    let protocol: RouteEntry["protocol"] = "other";
    if (flags.includes("C")) protocol = "connected";
    else if (flags.includes("S")) protocol = "static";
    else if (flags.includes("O")) protocol = "ospf";
    else if (flags.includes("B")) protocol = "bgp";
    else if (flags.includes("R")) protocol = "rip";
    else if (flags.includes("D")) protocol = "other"; // EIGRP

    const viaMatch = line.match(/via\s+(\d+\.\d+\.\d+\.\d+)/);
    const ifMatch = line.match(/(?:,\s*|\s)([A-Za-z]+\d+[\d/]*)\s*$/);
    const metricMatch = line.match(/\[(\d+)\/(\d+)\]/);

    entries.push({
      destination: dest,
      gateway: viaMatch?.[1] || null,
      interface_name: ifMatch?.[1] || null,
      protocol,
      distance: metricMatch ? parseInt(metricMatch[1], 10) : undefined,
      metric: metricMatch ? parseInt(metricMatch[2], 10) : undefined,
      active: flags.includes("*") || flags.includes(">") || !flags.includes("!"),
    });
  }
  return entries.slice(0, 200);
}

/** EdgeOS/Vyatta: show ip route (simile a Cisco) + fallback ip route show (Linux) */
function parseEdgeOsRoutes(output: string): RouteEntry[] {
  // Prova prima il formato Cisco-like
  const ciscoStyle = parseCiscoRoutes(output);
  if (ciscoStyle.length > 0) return ciscoStyle;
  // Fallback: Linux ip route show
  return parseLinuxIpRoutes(output);
}

/** Linux: ip route show */
function parseLinuxIpRoutes(output: string): RouteEntry[] {
  const entries: RouteEntry[] = [];
  for (const line of output.split("\n")) {
    if (!line.trim()) continue;
    // "default via 192.168.1.1 dev eth0"
    // "10.0.0.0/8 via 10.1.1.1 dev eth0 proto static metric 100"
    // "192.168.1.0/24 dev eth0 proto kernel scope link src 192.168.1.100"
    const destMatch = line.match(/^(\S+)\s/);
    if (!destMatch) continue;
    let dest = destMatch[1];
    if (dest === "default") dest = "0.0.0.0/0";
    else if (!dest.includes("/")) dest += "/32";

    const via = line.match(/via\s+(\d+\.\d+\.\d+\.\d+)/)?.[1];
    const dev = line.match(/dev\s+(\S+)/)?.[1];
    const protoMatch = line.match(/proto\s+(\S+)/)?.[1];
    const metricMatch = line.match(/metric\s+(\d+)/)?.[1];

    let protocol: RouteEntry["protocol"] = "other";
    if (protoMatch === "kernel" || line.includes("scope link")) protocol = "connected";
    else if (protoMatch === "static") protocol = "static";
    else if (protoMatch === "ospf" || protoMatch === "bird") protocol = "ospf";
    else if (protoMatch === "bgp") protocol = "bgp";

    entries.push({
      destination: dest,
      gateway: via || null,
      interface_name: dev || null,
      protocol,
      metric: metricMatch ? parseInt(metricMatch, 10) : undefined,
      active: true,
    });
  }
  return entries.slice(0, 200);
}

/** HP/Generic: show ip route (tabellare con Destination, Gateway, Interface) */
function parseGenericRoutes(output: string): RouteEntry[] {
  const entries: RouteEntry[] = [];
  for (const line of output.split("\n")) {
    const ipMatch = line.match(/(\d+\.\d+\.\d+\.\d+(?:\/\d+)?)/);
    if (!ipMatch) continue;
    if (line.includes("Destination") || line.includes("---")) continue;
    const parts = line.trim().split(/\s+/);
    let dest = ipMatch[1];
    if (!dest.includes("/")) dest += "/32";

    const gwMatch = line.match(/(\d+\.\d+\.\d+\.\d+).*(\d+\.\d+\.\d+\.\d+)/);
    const gateway = gwMatch && gwMatch[2] !== gwMatch[1] ? gwMatch[2] : null;

    entries.push({
      destination: dest,
      gateway,
      interface_name: parts[parts.length - 1]?.match(/[A-Za-z]/) ? parts[parts.length - 1] : null,
      protocol: line.toLowerCase().includes("static") ? "static" : line.toLowerCase().includes("direct") ? "connected" : "other",
      active: true,
    });
  }
  return entries.slice(0, 200);
}

/** EdgeOS: show dhcp leases / dhcpd.leases parser */
function parseEdgeOsDhcpLeases(output: string): DhcpLeaseEntry[] {
  const entries: DhcpLeaseEntry[] = [];
  // "show dhcp leases" format: IP  MAC  Pool  Expiry  Hostname
  // oppure dhcpd.leases stanza: lease x.x.x.x { ... }
  if (output.includes("lease ")) {
    // ISC dhcpd.leases format
    const blocks = output.split(/^lease\s+/m);
    for (const block of blocks) {
      const ipMatch = block.match(/^(\d+\.\d+\.\d+\.\d+)\s*\{/);
      if (!ipMatch) continue;
      const mac = block.match(/hardware ethernet\s+([0-9a-f:]+)/i)?.[1];
      const hostname = block.match(/client-hostname\s+"([^"]+)"/)?.[1];
      if (mac) {
        entries.push({
          ip: ipMatch[1],
          mac: mac.toUpperCase(),
          hostname: hostname || null,
        });
      }
    }
  } else {
    // Tabellare: IP  MAC  Pool  Expiry  State  Hostname
    for (const line of output.split("\n")) {
      const ipMatch = line.match(/(\d+\.\d+\.\d+\.\d+)/);
      const macMatch = line.match(/([0-9a-fA-F]{2}:[0-9a-fA-F]{2}:[0-9a-fA-F]{2}:[0-9a-fA-F]{2}:[0-9a-fA-F]{2}:[0-9a-fA-F]{2})/);
      if (ipMatch && macMatch) {
        const parts = line.trim().split(/\s+/);
        // L'hostname è generalmente l'ultimo campo non-vuoto
        const hostname = parts.length > 4 ? parts[parts.length - 1] : null;
        entries.push({
          ip: ipMatch[1],
          mac: macMatch[1].toUpperCase(),
          hostname: hostname && !/[\d:.]/.test(hostname) ? hostname : null,
        });
      }
    }
  }
  return entries;
}
