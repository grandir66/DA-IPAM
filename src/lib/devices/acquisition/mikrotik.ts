/**
 * Handler acquisizione MikroTik.
 *
 * Supporta SSH per MAC table, ARP, e informazioni base dispositivo.
 * SNMP fallback per porte quando SSH non disponibile.
 */

import type { NetworkDevice } from "@/types";
import type { MacTableEntry, PortInfo } from "../switch-client";
import type { ArpTableEntry } from "../router-client";
import type { AcquisitionHandler, DeviceInfo } from "./registry";
import { registerHandler } from "./registry";
import { getDeviceCredentials } from "@/lib/db";

async function sshExecMikrotik(
  device: NetworkDevice,
  command: string
): Promise<string> {
  const creds = getDeviceCredentials(device);
  const { Client } = await import("ssh2");

  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn.on("ready", () => {
      conn.exec(command, (err, stream) => {
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
      username: creds?.username ?? device.username ?? undefined,
      password: creds?.password,
      readyTimeout: 10000,
    });
  });
}

function parseMikrotikMacTable(output: string): MacTableEntry[] {
  const entries: MacTableEntry[] = [];
  const lines = output.split("\n");
  for (const line of lines) {
    const parts = line.split(/\s+/);
    const macIdx = parts.findIndex((p) => /^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/.test(p));
    if (macIdx === -1) continue;
    const mac = parts[macIdx].toUpperCase();
    const portIdx = parts.findIndex((p, i) => i > macIdx && p.startsWith("ether"));
    const port_name = portIdx !== -1 ? parts[portIdx] : parts[macIdx + 1] || "bridge";
    entries.push({ mac, port_name, vlan: null, port_status: null, speed: null });
  }
  return entries;
}

function parseMikrotikArpTable(output: string): ArpTableEntry[] {
  const entries: ArpTableEntry[] = [];
  const lines = output.split("\n");
  for (const line of lines) {
    const parts = line.split(/\s+/);
    const ipMatch = parts.find((p) => /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(p));
    const macMatch = parts.find((p) => /^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/.test(p));
    const ifMatch = parts.find((p) => p.startsWith("ether") || p.startsWith("bridge") || p.startsWith("sfp"));
    if (ipMatch && macMatch) {
      entries.push({
        mac: macMatch.toUpperCase(),
        ip: ipMatch,
        interface_name: ifMatch ?? null,
      });
    }
  }
  return entries;
}

function parseMikrotikIdentity(output: string): string | null {
  const m = output.match(/name=(\S+)/);
  return m ? m[1] : null;
}

function parseMikrotikVersion(output: string): { firmware: string | null; model: string | null } {
  const lines = output.split("\n");
  let firmware: string | null = null;
  let model: string | null = null;
  for (const line of lines) {
    const vMatch = line.match(/version:\s*(.+)/i);
    if (vMatch) firmware = vMatch[1].trim();
    const bMatch = line.match(/board-name:\s*(.+)/i);
    if (bMatch) model = bMatch[1].trim();
  }
  return { firmware, model };
}

const handler: AcquisitionHandler = {
  vendor: "mikrotik",
  priority: 100,

  async getMacTable(device: NetworkDevice): Promise<MacTableEntry[]> {
    if (device.protocol !== "ssh") return [];
    const output = await sshExecMikrotik(device, "/interface bridge host print terse");
    return parseMikrotikMacTable(output);
  },

  async getPortSchema(_device: NetworkDevice): Promise<PortInfo[]> {
    return [];
  },

  async getArpTable(device: NetworkDevice): Promise<ArpTableEntry[]> {
    if (device.protocol !== "ssh") return [];
    const output = await sshExecMikrotik(device, "/ip arp print terse");
    return parseMikrotikArpTable(output);
  },

  async getDeviceInfo(device: NetworkDevice): Promise<DeviceInfo | null> {
    if (device.protocol !== "ssh") return null;
    try {
      const [identity, version] = await Promise.all([
        sshExecMikrotik(device, "/system identity print"),
        sshExecMikrotik(device, "/system resource print"),
      ]);
      const { firmware, model } = parseMikrotikVersion(version);
      return {
        sysname: parseMikrotikIdentity(identity),
        model,
        firmware,
      };
    } catch {
      return null;
    }
  },

  async testConnection(device: NetworkDevice): Promise<boolean> {
    if (device.protocol !== "ssh") return false;
    try {
      await sshExecMikrotik(device, "echo test");
      return true;
    } catch {
      return false;
    }
  },
};

registerHandler(() => handler);

export default handler;
