/**
 * Recupera informazioni STP via SSH per MikroTik, UniFi (CLI EdgeSwitch) e Linux (brctl).
 * MikroTik: /interface bridge print terse + /interface bridge monitor [find] once (lettori in mikrotik-stp.ts)
 * UniFi: telnet localhost + enable + show spanning-tree (CLI EdgeSwitch)
 * Linux: brctl showstp
 */

import type { StpInfo } from "./snmp-stp-info";
import type { SshOptions } from "./ssh-helper";
import { erroreRouterOs, parseBridge, parseMonitorBridge } from "./mikrotik-stp";

function parseMikrotikDuration(s: string): number | null {
  if (!s) return null;
  const m = s.match(/^(\d+)(s|m|h)?$/);
  if (!m) return null;
  const val = parseInt(m[1], 10);
  const unit = m[2] || "s";
  if (unit === "s") return val;
  if (unit === "m") return val * 60;
  if (unit === "h") return val * 3600;
  return val;
}

/**
 * MikroTik: MK3 (`/interface bridge print terse`) e MK5 (`/interface bridge monitor [find] once`), coi lettori delle
 * forme vere (spec topologia §13.5.2). Il primo bridge, come prima. MSTP non diventa più null. Un errore riconosciuto dal
 * testo, o nessun bridge, dà null (niente informazioni, mai informazioni sbagliate).
 */
export async function getMikrotikStpInfo(execCommand: (cmd: string) => Promise<string>): Promise<StpInfo | null> {
  try {
    const out3 = await execCommand("/interface bridge print terse without-paging");
    if (erroreRouterOs(out3)) return null;
    const b = parseBridge(out3)[0];
    if (!b) return null;
    const out5 = await execCommand("/interface bridge monitor [find] once");
    if (erroreRouterOs(out5)) return null;
    const m = parseMonitorBridge(out5)[0];
    if (!m || (!m.bridgeId && !m.radiceId)) return null;
    const prio = b.priorita ?? (m.bridgeId ? Number(m.bridgeId.split(".")[0]) : null);
    return {
      bridge_id: m.bridgeId, root_bridge_id: m.radiceId ?? m.bridgeId, priority: prio, root_cost: m.costo,
      root_port: m.portaRadice ?? "none", hello_time_s: null,
      forward_delay_s: parseMikrotikDuration(b.forwardDelay ?? ""), max_age_s: parseMikrotikDuration(b.maxAge ?? ""),
      is_root_bridge: m.radice === true, protocol: b.modo === "stp" || b.modo === "rstp" || b.modo === "mstp" ? b.modo : null,
    };
  } catch {
    return null;
  }
}

/**
 * Linux brctl showstp [bridge]
 * Output example:
 * br0
 *  bridge id        8000.00032544aace
 *  designated root  8000.00032544aace
 *  root port        0                    path cost          0
 *  max age          20.00                 bridge max age     20.00
 *  hello time       2.00                  bridge hello time  2.00
 *  forward delay    15.00                 bridge forward delay 15.00
 */
function parseBrctlShowstp(output: string): StpInfo | null {
  const lines = output.split("\n").map((l) => l.trim());
  let bridgeId: string | null = null;
  let rootBridgeId: string | null = null;
  let rootPort = "none";
  let maxAge: number | null = null;
  let helloTime: number | null = null;
  let forwardDelay: number | null = null;

  for (const line of lines) {
    const bridgeIdMatch = line.match(/bridge\s+id\s+(\d+\.[0-9a-f.]+)/i);
    if (bridgeIdMatch) {
      const raw = bridgeIdMatch[1];
      const [prio, macPart] = raw.split(".");
      const mac = macPart && macPart.length === 12 ? macPart.replace(/(.{2})/g, "$1:").slice(0, -1) : macPart;
      bridgeId = mac ? `${prio}.${mac}` : raw;
    }
    const designatedMatch = line.match(/designated\s+root\s+(\d+\.[0-9a-f.]+)/i);
    if (designatedMatch) {
      const raw = designatedMatch[1];
      const [prio, macPart] = raw.split(".");
      const mac = macPart && macPart.length === 12 ? macPart.replace(/(.{2})/g, "$1:").slice(0, -1) : macPart;
      rootBridgeId = mac ? `${prio}.${mac}` : raw;
    }
    const rootPortMatch = line.match(/root\s+port\s+(\d+)/i);
    if (rootPortMatch && rootPortMatch[1] !== "0") {
      rootPort = rootPortMatch[1];
    }
    const maxAgeMatch = line.match(/max\s+age\s+([\d.]+)/i);
    if (maxAgeMatch) maxAge = parseFloat(maxAgeMatch[1]);
    const helloMatch = line.match(/hello\s+time\s+([\d.]+)/i);
    if (helloMatch) helloTime = parseFloat(helloMatch[1]);
    const fwdMatch = line.match(/forward\s+delay\s+([\d.]+)/i);
    if (fwdMatch) forwardDelay = parseFloat(fwdMatch[1]);
  }

  if (!bridgeId && !rootBridgeId) return null;

  const isRootBridge = bridgeId === rootBridgeId || rootPort === "none";

  return {
    bridge_id: bridgeId,
    root_bridge_id: rootBridgeId ?? bridgeId,
    priority: bridgeId ? parseInt(bridgeId.split(".")[0], 10) : null,
    root_cost: null,
    root_port: rootPort,
    hello_time_s: helloTime,
    forward_delay_s: forwardDelay,
    max_age_s: maxAge,
    is_root_bridge: isRootBridge,
    protocol: "rstp",
  };
}

const BRIDGE_NAMES = ["br0", "bridge", "br-lan", "br0.1", "br0:1"];

export async function getBrctlStpInfo(execCommand: (cmd: string) => Promise<string>): Promise<StpInfo | null> {
  let bridges = BRIDGE_NAMES;
  try {
    const showOut = await execCommand("brctl show 2>/dev/null");
    const lines = showOut.split("\n").slice(1);
    for (const line of lines) {
      const m = line.match(/^(\S+)\s+\d+\./);
      if (m && m[1] !== "name") {
        bridges = [m[1], ...BRIDGE_NAMES.filter((b) => b !== m[1])];
        break;
      }
    }
  } catch { /* use default list */ }
  for (const br of bridges) {
    try {
      const out = await execCommand(`brctl showstp ${br} 2>/dev/null`);
      const info = parseBrctlShowstp(out);
      if (info) return info;
    } catch { /* try next bridge */ }
  }
  return null;
}

/**
 * Converte Bridge ID 8-octet (priority:MAC) in formato "priority.mac".
 * Es: "80:00:E4:38:83:74:D4:FF" → "32768.e4:38:83:74:d4:ff"
 */
function bridgeId8OctetToPriorityMac(s: string): string {
  const parts = s.trim().split(/[:\s]+/).filter(Boolean);
  if (parts.length >= 8) {
    const prioHex = parts[0] + parts[1];
    const prio = parseInt(prioHex, 16);
    const mac = parts.slice(2, 8).join(":").toLowerCase();
    return `${prio}.${mac}`;
  }
  return s;
}

/**
 * Estrae un valore numerico da una linea usando uno dei pattern (primo match vince).
 */
function parseFirstOf(line: string, patterns: RegExp[]): number | null {
  for (const re of patterns) {
    const m = line.match(re);
    if (m?.[1]) return parseInt(m[1], 10);
  }
  return null;
}

/**
 * Estrae un valore stringa (es. MAC/Bridge ID) da una linea usando uno dei pattern.
 */
function parseFirstOfStr(line: string, patterns: RegExp[]): string | null {
  for (const re of patterns) {
    const m = line.match(re);
    if (m?.[1]?.trim()) return m[1].trim();
  }
  return null;
}

/**
 * UniFi/Ubiquiti Switch: output da "show spanning-tree".
 * Supporta output diversi (modello dipendente): label con punti, colon, spazio, formato Cisco.
 * Aggiungere nuovi pattern in PATTERNS per estendere il supporto.
 */
function parseEdgeSwitchSpanningTree(output: string): StpInfo | null {
  const lines = output.split("\n").map((l) => l.trim());
  let bridgeId: string | null = null;
  let rootBridgeId: string | null = null;
  let priority: number | null = null;
  let rootCost: number | null = null;
  let rootPort = "none";
  let helloTime: number | null = null;
  let forwardDelay: number | null = null;
  let maxAge: number | null = null;

  const macFromCisco = (s: string): string => {
    const hex = s.replace(/\./g, "").replace(/:/g, "").toLowerCase();
    if (hex.length === 12) return hex.replace(/(.{2})/g, "$1:").slice(0, -1);
    return s;
  };

  const extractAddr = (i: number, prio: number): string | null => {
    const sameLine = lines[i].match(/Address\s+([\da-f.:]+)/i);
    if (sameLine) return `${prio}.${macFromCisco(sameLine[1])}`;
    const nextLine = (lines[i + 1] || "").match(/Address\s+([\da-f.:]+)/i);
    if (nextLine) return `${prio}.${macFromCisco(nextLine[1])}`;
    return null;
  };

  // Pattern multipli per varianti di output (label con . : = o spazi; aggiungere nuovi per altri modelli)
  const PATTERNS = {
    priority: [
      /Bridge\s+Priority[.\s:=]+(\d+)/i,
      /Priority[.\s:=]+(\d+)/i,
      /Root\s+ID\s+Priority\s+(\d+)/i,
      /Bridge\s+ID\s+Priority\s+(\d+)/i,
    ],
    bridgeId: [
      /Bridge\s+Identifier[.\s:=]+([\da-fA-F:.-]+)/i,
      /Bridge\s+ID[.\s:=]+([\da-fA-F:.-]+)/i,
      /Bridge\s+Identifier\s+([\da-fA-F:.-]+)/i,
    ],
    rootBridgeId: [
      /Designated\s+Root[.\s:=]+([\da-fA-F:.-]+)/i,
      /Root\s+ID[.\s:=]+([\da-fA-F:.-]+)/i,
      /Designated\s+Root\s+([\da-fA-F:.-]+)/i,
    ],
    rootCost: [
      /Root\s+Path\s+Cost[.\s:=]+(\d+)/i,
      /Path\s+Cost[.\s:=]+(\d+)/i,
      /Root\s+Path\s+Cost\s+(\d+)/i,
      /Path\s+Cost\s+(\d+)/i,
    ],
    rootPort: [
      /Root\s+Port\s+Identifier[.\s:=]+(\S+)/i,
      /Root\s+Port[.\s:=]+(\S+)/i,
      /Root\s+Port\s+Identifier\s+(\S+)/i,
      /Root\s+Port\s+(\d+)/i,
    ],
    maxAge: [
      /Bridge\s+Max\s+Age[.\s:=]+(\d+)/i,
      /Max\s+Age[.\s:=]+(\d+)/i,
      /Max\s+Age\s+(\d+)/i,
    ],
    forwardDelay: [
      /Bridge\s+Forwarding\s+Delay[.\s:=]+(\d+)/i,
      /Forward(?:ing)?\s+Delay[.\s:=]+(\d+)/i,
      /Forward\s+Delay\s+(\d+)/i,
    ],
    helloTime: [
      /Hello\s+Time[.\s:=]+(\d+)/i,
      /Hello\s+Time\s+(\d+)/i,
    ],
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const p = parseFirstOf(line, PATTERNS.priority);
    if (p != null) priority = p;

    const bid = parseFirstOfStr(line, PATTERNS.bridgeId);
    if (bid && /[\da-fA-F:.-]{10,}/.test(bid)) bridgeId = bridgeId8OctetToPriorityMac(bid);

    const rid = parseFirstOfStr(line, PATTERNS.rootBridgeId);
    if (rid && /[\da-fA-F:.-]{10,}/.test(rid)) rootBridgeId = bridgeId8OctetToPriorityMac(rid);

    const cost = parseFirstOf(line, PATTERNS.rootCost);
    if (cost != null) rootCost = cost;

    const port = parseFirstOfStr(line, PATTERNS.rootPort);
    if (port && port !== "N/A" && !/^0+$/.test(port)) rootPort = port;

    const ma = parseFirstOf(line, PATTERNS.maxAge);
    if (ma != null) maxAge = ma;

    const fd = parseFirstOf(line, PATTERNS.forwardDelay);
    if (fd != null) forwardDelay = fd;

    const ht = parseFirstOf(line, PATTERNS.helloTime);
    if (ht != null) helloTime = ht;

    // Formato Cisco/EdgeSwitch (Address su riga successiva)
    const rootIdMatch = line.match(/Root\s+ID\s+Priority\s+(\d+)/i);
    if (rootIdMatch) {
      const prio = parseInt(rootIdMatch[1], 10);
      priority = prio;
      rootBridgeId = extractAddr(i, prio) ?? rootBridgeId;
    }
    const bridgeIdMatch = line.match(/Bridge\s+ID\s+Priority\s+(\d+)/i);
    if (bridgeIdMatch) {
      const prio = parseInt(bridgeIdMatch[1], 10);
      bridgeId = extractAddr(i, prio) ?? bridgeId;
    }
  }

  if (!bridgeId && !rootBridgeId) return null;

  const isRootBridge = bridgeId === rootBridgeId || rootPort === "none" || rootCost === 0;

  return {
    bridge_id: bridgeId,
    root_bridge_id: rootBridgeId ?? bridgeId,
    priority,
    root_cost: rootCost,
    root_port: rootPort,
    hello_time_s: helloTime,
    forward_delay_s: forwardDelay,
    max_age_s: maxAge,
    is_root_bridge: isRootBridge,
    protocol: "rstp",
  };
}

/**
 * UniFi Switch: usa unifiCliExec (telnet localhost + enable) poi "show spanning-tree".
 */
export async function getUnifiStpInfo(options: SshOptions): Promise<StpInfo | null> {
  try {
    const { unifiCliExec } = await import("./unifi-cli");
    const out = await unifiCliExec(options, "show spanning-tree", 25000);
    let info = parseEdgeSwitchSpanningTree(out);
    if (!info?.bridge_id && !info?.root_bridge_id) {
      const detail = await unifiCliExec(options, "show spanning-tree root detail", 15000).catch(() => "");
      info = parseEdgeSwitchSpanningTree(detail);
    }
    return info;
  } catch {
    return null;
  }
}
