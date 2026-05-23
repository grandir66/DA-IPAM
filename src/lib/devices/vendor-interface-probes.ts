/**
 * Probe interfacce + IP via CLI vendor-specific. Usato come fallback da
 * [interface-probe.ts](./interface-probe.ts) quando SNMP non è configurato o
 * ritorna 0 risultati (es. Mikrotik con solo SSH, Proxmox/Linux senza SNMP).
 *
 * Pattern: ogni `probeXxx(device)` ritorna un `InterfaceProbeResult[]`
 * (struttura identica al probe SNMP) o `null` se non applicabile.
 *
 * Auth: passa per il transport SSH unificato (`sshExec` da `ssh-transport`),
 * quindi gode di `tryKeyboard` + error mapping parlante.
 */

import type { NetworkDevice } from "@/types";
import { getDeviceCredentials } from "@/lib/db";
import { sshExec } from "./ssh-transport";
import type { InterfaceProbeResult, InterfaceProbeAddress } from "./interface-probe";

const PROBE_TIMEOUT_MS = 15_000;

function buildSshOptions(device: NetworkDevice) {
  const creds = getDeviceCredentials(device);
  const username = creds?.username ?? device.username ?? undefined;
  if (!username || !creds?.password) return null;
  const host = device.host.replace(/^https?:\/\//i, "").split(":")[0];
  return {
    host,
    port: device.port || 22,
    username,
    password: creds.password,
    timeout: PROBE_TIMEOUT_MS,
  };
}

function ipv4Scope(ip: string): "global" | "link" | "host" {
  if (ip.startsWith("127.")) return "host";
  if (ip.startsWith("169.254.")) return "link";
  return "global";
}

function ipv6Scope(ip: string): "global" | "link" | "host" {
  const low = ip.toLowerCase();
  if (low === "::1") return "host";
  if (low.startsWith("fe80:") || low.startsWith("fe80::")) return "link";
  return "global";
}

// ──────────────────────────────────────────────────────────────────
// MikroTik RouterOS CLI
// ──────────────────────────────────────────────────────────────────

/**
 * Parser per output `/interface print terse`. Formato per riga:
 *   ` 0   name=ether1 default-name=ether1 type=ether mtu=1500 ...`
 * Restituisce mappa `ifname → {type, mtu}`.
 */
function parseMikrotikInterfacePrint(output: string): Map<string, { type: string | null; mtu: number | null }> {
  const map = new Map<string, { type: string | null; mtu: number | null }>();
  for (const line of output.split("\n")) {
    const nameMatch = line.match(/\bname=("[^"]+"|\S+)/);
    if (!nameMatch) continue;
    const name = nameMatch[1].replace(/^"|"$/g, "");
    const typeMatch = line.match(/\btype=(\S+)/);
    const mtuMatch = line.match(/\bmtu=(\d+)/);
    map.set(name, {
      type: typeMatch?.[1] ?? null,
      mtu: mtuMatch ? parseInt(mtuMatch[1]) : null,
    });
  }
  return map;
}

/**
 * Parser per `/interface ethernet print terse`. Estrae MAC per nome interfaccia.
 *   ` 0  name=ether1 mac-address=4C:5E:0C:11:22:33 ...`
 */
function parseMikrotikEthernetMacs(output: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of output.split("\n")) {
    const nameMatch = line.match(/\bname=("[^"]+"|\S+)/);
    const macMatch = line.match(/\bmac-address=([0-9A-Fa-f:]{17})/);
    if (nameMatch && macMatch) {
      const name = nameMatch[1].replace(/^"|"$/g, "");
      map.set(name, macMatch[1].toLowerCase());
    }
  }
  return map;
}

/**
 * Parser per `/ip address print terse` (IPv4). Formato:
 *   ` 0   address=192.168.1.1/24 network=192.168.1.0 interface=ether1 actual-interface=ether1`
 * Ritorna mappa `ifname → [{ip, prefix, family:4}]`.
 */
function parseMikrotikIpv4Addresses(output: string): Map<string, InterfaceProbeAddress[]> {
  const map = new Map<string, InterfaceProbeAddress[]>();
  for (const line of output.split("\n")) {
    const addrMatch = line.match(/\baddress=(\d+\.\d+\.\d+\.\d+)\/(\d+)/);
    const ifaceMatch = line.match(/\binterface=("[^"]+"|\S+)/);
    if (!addrMatch || !ifaceMatch) continue;
    const ifname = ifaceMatch[1].replace(/^"|"$/g, "");
    const ip = addrMatch[1];
    const prefix = parseInt(addrMatch[2]);
    const list = map.get(ifname) ?? [];
    list.push({ ip, prefix, family: 4, scope: ipv4Scope(ip) });
    map.set(ifname, list);
  }
  return map;
}

/**
 * Parser per `/ipv6 address print terse`. Formato:
 *   ` 0 G ;;; ... address=fe80::abc/64 interface=ether1`
 *   ` 1 G   address=2001:db8::1/64 from-pool="" interface=ether1`
 */
function parseMikrotikIpv6Addresses(output: string): Map<string, InterfaceProbeAddress[]> {
  const map = new Map<string, InterfaceProbeAddress[]>();
  for (const line of output.split("\n")) {
    const addrMatch = line.match(/\baddress=([0-9a-fA-F:]+)\/(\d+)/);
    const ifaceMatch = line.match(/\binterface=("[^"]+"|\S+)/);
    if (!addrMatch || !ifaceMatch) continue;
    const ifname = ifaceMatch[1].replace(/^"|"$/g, "");
    const ip = addrMatch[1].toLowerCase();
    const prefix = parseInt(addrMatch[2]);
    const list = map.get(ifname) ?? [];
    list.push({ ip, prefix, family: 6, scope: ipv6Scope(ip) });
    map.set(ifname, list);
  }
  return map;
}

export async function probeMikrotikInterfaces(device: NetworkDevice): Promise<InterfaceProbeResult[] | null> {
  if (device.protocol !== "ssh") return null;
  const opts = buildSshOptions(device);
  if (!opts) return null;

  // 1. lista interfacce
  const ifPrint = await sshExec(opts, "/interface print terse");
  const ifaces = parseMikrotikInterfacePrint(ifPrint.stdout + ifPrint.stderr);
  if (ifaces.size === 0) return [];

  // 2. MAC per ethernet (best-effort)
  let ethMacs = new Map<string, string>();
  try {
    const ethPrint = await sshExec(opts, "/interface ethernet print terse");
    ethMacs = parseMikrotikEthernetMacs(ethPrint.stdout + ethPrint.stderr);
  } catch { /* alcune versioni/edizioni non hanno /interface ethernet */ }

  // 3. IPv4
  const ip4 = await sshExec(opts, "/ip address print terse");
  const v4 = parseMikrotikIpv4Addresses(ip4.stdout + ip4.stderr);

  // 4. IPv6 (best-effort: pacchetto ipv6 può essere disabilitato)
  let v6 = new Map<string, InterfaceProbeAddress[]>();
  try {
    const ip6 = await sshExec(opts, "/ipv6 address print terse");
    v6 = parseMikrotikIpv6Addresses(ip6.stdout + ip6.stderr);
  } catch { /* IPv6 disabilitato */ }

  // 5. merge per interfaccia
  const results: InterfaceProbeResult[] = [];
  let ifindexCounter = 1;
  for (const [ifname, meta] of ifaces) {
    const addresses: InterfaceProbeAddress[] = [
      ...(v4.get(ifname) ?? []),
      ...(v6.get(ifname) ?? []),
    ];
    results.push({
      ifname,
      ifindex: ifindexCounter++,
      mac: ethMacs.get(ifname) ?? null,
      status: "unknown", // RouterOS terse non esplicita oper-status uniformemente
      speed_mbps: null,
      alias: meta.type, // riusiamo alias per esporre il tipo Mikrotik (ether/bridge/vlan/...)
      addresses,
    });
  }
  // Filtra interfacce senza IP né MAC (rumore)
  return results.filter((r) => r.addresses.length > 0 || r.mac);
}

// ──────────────────────────────────────────────────────────────────
// Linux generico (`ip -j addr`) — Proxmox, Debian/Ubuntu, RHEL recenti
// ──────────────────────────────────────────────────────────────────

interface IpJsonAddrInfo {
  family: "inet" | "inet6";
  local: string;
  prefixlen?: number;
  scope?: string;
}

interface IpJsonInterface {
  ifindex?: number;
  ifname?: string;
  address?: string; // MAC
  flags?: string[];
  operstate?: string;
  link_type?: string;
  mtu?: number;
  addr_info?: IpJsonAddrInfo[];
}

/**
 * Esegue `ip -j addr` sul device e parsa l'output JSON. Funziona su:
 *   - Proxmox (Debian)
 *   - Ubuntu/Debian moderni
 *   - RHEL/CentOS 8+
 *   - Synology DSM 7+ (busybox di alcuni modelli può mancare; fallback `ip addr`)
 *
 * Non gestisce VLAN sub-interface in modo speciale: appaiono come interfacce a sé
 * con `link@parent` come ifname.
 */
export async function probeLinuxInterfaces(device: NetworkDevice): Promise<InterfaceProbeResult[] | null> {
  if (device.protocol !== "ssh") return null;
  const opts = buildSshOptions(device);
  if (!opts) return null;

  let raw: string;
  try {
    const res = await sshExec(opts, "ip -j addr 2>/dev/null");
    raw = res.stdout.trim();
    if (!raw || res.code !== 0) {
      // Fallback: comando senza -j (raro su Proxmox, ma alcuni Synology/NAS)
      // — al momento non implementato, restituisce empty.
      return [];
    }
  } catch {
    return null;
  }

  let parsed: IpJsonInterface[];
  try {
    parsed = JSON.parse(raw) as IpJsonInterface[];
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const results: InterfaceProbeResult[] = [];
  for (const iface of parsed) {
    if (!iface.ifname) continue;
    const addresses: InterfaceProbeAddress[] = [];
    for (const a of iface.addr_info ?? []) {
      if (!a.local) continue;
      const family: 4 | 6 = a.family === "inet6" ? 6 : 4;
      const scope: "global" | "link" | "host" =
        a.scope === "host"
          ? "host"
          : a.scope === "link"
            ? "link"
            : family === 4
              ? ipv4Scope(a.local)
              : ipv6Scope(a.local);
      addresses.push({
        ip: a.local,
        prefix: typeof a.prefixlen === "number" ? a.prefixlen : null,
        family,
        scope,
      });
    }
    if (addresses.length === 0 && !iface.address) continue;
    const status =
      iface.operstate === "UP"
        ? "up"
        : iface.operstate === "DOWN"
          ? "down"
          : (iface.flags ?? []).includes("UP")
            ? "up"
            : "unknown";
    results.push({
      ifname: iface.ifname,
      ifindex: iface.ifindex ?? null,
      mac: iface.address && iface.link_type === "ether" ? iface.address.toLowerCase() : null,
      status,
      speed_mbps: null,
      alias: iface.link_type ?? null,
      addresses,
    });
  }
  return results;
}

// ──────────────────────────────────────────────────────────────────
// Dispatcher: sceglie il probe CLI giusto in base a `device.vendor`
// ──────────────────────────────────────────────────────────────────

export async function probeVendorInterfacesCli(device: NetworkDevice): Promise<InterfaceProbeResult[] | null> {
  switch (device.vendor) {
    case "mikrotik":
      return probeMikrotikInterfaces(device);
    case "proxmox":
    case "linux":
    case "synology":
    case "qnap":
      return probeLinuxInterfaces(device);
    default:
      return null;
  }
}
