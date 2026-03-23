/**
 * Acquisizione estesa Synology / QNAP: SNMP (MIB enterprise) + SSH (sistema).
 * Obiettivo: volumi logici/fisici, RAID, dischi, rete con IP, HW, utenti locali.
 */

import type { NetworkDevice } from "@/types";
import { getDeviceCredentials } from "@/lib/db";
import { sshExec } from "./ssh-helper";
import type { DeviceInfo, NasInventorySnapshot } from "./device-info";
import { snmpSubwalkLimited, stringifySnmpValue } from "@/lib/scanner/snmp-query";

export type NasVendor = "synology" | "qnap";

const SYNO_DISK_BASE = "1.3.6.1.4.1.6574.2.1.1";
const SYNO_RAID_BASE = "1.3.6.1.4.1.6574.3.1.1";
const QNAP_STORAGE_BASE = "1.3.6.1.4.1.24681.1.2";

export function mergeNasInventorySnapshots(a: NasInventorySnapshot, b: NasInventorySnapshot): NasInventorySnapshot {
  const sources = [...new Set([...a.sources, ...b.sources])] as NasInventorySnapshot["sources"];
  return {
    vendor: a.vendor || b.vendor,
    sources,
    snmp: { ...a.snmp, ...b.snmp },
    ssh: { ...a.ssh, ...b.ssh },
  };
}

function parseSynologyDiskWalk(
  rows: Array<{ oid: string; value: unknown }>
): NonNullable<NasInventorySnapshot["snmp"]>["disks"] | undefined {
  const byIdx = new Map<string, Record<string, string>>();
  for (const r of rows) {
    const m = r.oid.match(/\.6574\.2\.1\.1\.(\d+)\.(\d+)$/);
    if (!m) continue;
    const col = m[1];
    const idx = m[2];
    const val = stringifySnmpValue(r.value);
    if (!val) continue;
    if (!byIdx.has(idx)) byIdx.set(idx, { index: idx });
    const row = byIdx.get(idx)!;
    if (col === "1") row.disk_index = val;
    if (col === "2") row.disk_id = val;
    if (col === "3") row.model = val;
    if (col === "4") row.type = val;
    if (col === "5") row.status = val;
    if (col === "6") row.temp_c = val;
  }
  const out: NonNullable<NasInventorySnapshot["snmp"]>["disks"] = [];
  for (const [, row] of byIdx) {
    const tempRaw = row.temp_c;
    let temperature_c: number | null = null;
    if (tempRaw && /^\d+$/.test(tempRaw)) temperature_c = parseInt(tempRaw, 10);
    out.push({
      index: row.disk_index ?? row.index,
      id: row.disk_id,
      model: row.model,
      type: row.type,
      status: row.status,
      temperature_c,
    });
  }
  return out.length ? out : undefined;
}

function synoBlocksToGb(n: number): number | null {
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n > 2_000_000_000) return Math.round((n / 1e9) * 10) / 10;
  if (n > 2_000_000) return Math.round((n / 1e6) * 10) / 10;
  if (n > 2_000) return Math.round((n / 1e3) * 10) / 10;
  return Math.round(n * 10) / 10;
}

function parseSynologyRaidWalk(
  rows: Array<{ oid: string; value: unknown }>
): NonNullable<NasInventorySnapshot["snmp"]>["raids"] | undefined {
  const byIdx = new Map<string, Record<string, string>>();
  for (const r of rows) {
    const m = r.oid.match(/\.6574\.3\.1\.1\.(\d+)\.(\d+)$/);
    if (!m) continue;
    const col = m[1];
    const idx = m[2];
    const val = stringifySnmpValue(r.value);
    if (!val) continue;
    if (!byIdx.has(idx)) byIdx.set(idx, { index: idx });
    const row = byIdx.get(idx)!;
    row[`c${col}`] = val;
    if (col === "2") row.name = val;
    if (col === "3") row.status = val;
  }
  const out: NonNullable<NasInventorySnapshot["snmp"]>["raids"] = [];
  for (const [, row] of byIdx) {
    let free_gb: number | null = null;
    let total_gb: number | null = null;
    const c4 = row.c4 ? parseInt(row.c4, 10) : NaN;
    const c5 = row.c5 ? parseInt(row.c5, 10) : NaN;
    const c6 = row.c6 ? parseInt(row.c6, 10) : NaN;
    const c7 = row.c7 ? parseInt(row.c7, 10) : NaN;
    if (!Number.isNaN(c5) && c5 > 0) total_gb = synoBlocksToGb(c5);
    if (!Number.isNaN(c4) && c4 > 0) free_gb = synoBlocksToGb(c4);
    if (total_gb == null && !Number.isNaN(c7) && c7 > 0) total_gb = synoBlocksToGb(c7);
    if (free_gb == null && !Number.isNaN(c6) && c6 > 0) free_gb = synoBlocksToGb(c6);
    out.push({
      index: row.index,
      name: row.name,
      status: row.status,
      free_gb,
      total_gb,
    });
  }
  return out.length ? out : undefined;
}

function parseQnapStorageWalk(rows: Array<{ oid: string; value: unknown }>): {
  volumes?: NonNullable<NasInventorySnapshot["snmp"]>["volumes_snmp"];
  disks?: NonNullable<NasInventorySnapshot["snmp"]>["disks"];
  temperature_c?: number | null;
} {
  let temperature_c: number | null = null;
  const volByIdx = new Map<string, Record<string, string>>();
  const diskByIdx = new Map<string, Record<string, string>>();

  for (const r of rows) {
    const v = stringifySnmpValue(r.value);
    if (!v) continue;
    if (r.oid.endsWith(".24681.1.2.4.0") || r.oid.includes(".1.2.4.0")) {
      const n = parseInt(v, 10);
      if (!Number.isNaN(n)) temperature_c = n;
      continue;
    }
    const vm = r.oid.match(/\.24681\.1\.2\.11\.1\.(\d+)\.(\d+)$/);
    if (vm) {
      const col = vm[1];
      const idx = vm[2];
      if (!volByIdx.has(idx)) volByIdx.set(idx, {});
      const row = volByIdx.get(idx)!;
      if (col === "1") row.name = v;
      if (col === "2" || col === "3") {
        const n = parseInt(v, 10);
        if (!Number.isNaN(n) && n > 1000) {
          row.size_gb = String(Math.round(n / 1e6));
        }
      }
      continue;
    }
    const dm = r.oid.match(/\.24681\.1\.2\.(\d+)\.1\.(\d+)\.(\d+)$/);
    if (dm) {
      const sub = dm[1];
      const col = dm[2];
      const idx = dm[3];
      if (sub === "12" || sub === "13") {
        if (!diskByIdx.has(idx)) diskByIdx.set(idx, {});
        const row = diskByIdx.get(idx)!;
        if (col === "1") row.model = v;
        if (col === "2") row.status = v;
        if (col === "3") row.type = v;
      }
    }
  }

  const volumes: NonNullable<NasInventorySnapshot["snmp"]>["volumes_snmp"] = [];
  for (const [, row] of volByIdx) {
    const size_gb = row.size_gb ? parseFloat(row.size_gb) : null;
    volumes.push({
      name: row.name,
      size_gb: size_gb != null && !Number.isNaN(size_gb) ? size_gb : null,
      free_gb: null,
      status: null,
    });
  }

  const disks: NonNullable<NasInventorySnapshot["snmp"]>["disks"] = [];
  for (const [, row] of diskByIdx) {
    disks.push({
      model: row.model,
      status: row.status,
      type: row.type,
    });
  }

  return {
    volumes: volumes.length ? volumes : undefined,
    disks: disks.length ? disks : undefined,
    temperature_c,
  };
}

export async function getNasSnmpInventory(
  host: string,
  community: string,
  port: number,
  vendor: NasVendor
): Promise<Partial<DeviceInfo>> {
  const sources: NasInventorySnapshot["sources"] = ["snmp"];
  const snap: NasInventorySnapshot = { vendor, sources, snmp: {} };

  try {
    if (vendor === "synology") {
      const [diskRows, raidRows] = await Promise.all([
        snmpSubwalkLimited(host, community, port, SYNO_DISK_BASE, 180, 8000, 20),
        snmpSubwalkLimited(host, community, port, SYNO_RAID_BASE, 180, 8000, 20),
      ]);
      const disks = parseSynologyDiskWalk(diskRows);
      const raids = parseSynologyRaidWalk(raidRows);
      if (disks?.length) snap.snmp!.disks = disks;
      if (raids?.length) snap.snmp!.raids = raids;

      const physFromSnmp: NonNullable<DeviceInfo["physical_disks"]> = [];
      for (const d of disks ?? []) {
        if (d.model || d.status) {
          physFromSnmp.push({
            device: d.id || d.index || "?",
            model: d.model,
            vendor: d.type,
            interface_type: d.status ? `status ${d.status}` : undefined,
          });
        }
      }
      const partial: Partial<DeviceInfo> = { nas_inventory: snap };
      if (physFromSnmp.length) partial.physical_disks = physFromSnmp;
      return partial;
    }

    const qnapRows = await snmpSubwalkLimited(host, community, port, QNAP_STORAGE_BASE, 220, 10000, 25);
    const parsed = parseQnapStorageWalk(qnapRows);
    if (parsed.temperature_c != null) snap.snmp!.temperature_c = parsed.temperature_c;
    if (parsed.disks?.length) snap.snmp!.disks = parsed.disks;
    if (parsed.volumes?.length) snap.snmp!.volumes_snmp = parsed.volumes;

    return { nas_inventory: snap };
  } catch {
    return {};
  }
}

type SshOpts = { host: string; port?: number; username: string; password: string; timeout?: number };

function parseMdstatSummary(md: string): string {
  const lines = md.trim().split("\n").slice(0, 8);
  return lines.join("\n").slice(0, 2000);
}

function parseDfToDisks(dfOut: string): NonNullable<DeviceInfo["disks"]> {
  const disks: NonNullable<DeviceInfo["disks"]> = [];
  for (const line of dfOut.split("\n")) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 7) continue;
    const [fs, type, size, used, avail, , mount] = parts;
    if (!fs || fs === "Filesystem") continue;
    if (/tmpfs|devtmpfs|overlay|udev/i.test(type)) continue;
    const sizeGb = parseDfSizeToGb(size);
    const freeGb = parseDfSizeToGb(avail);
    disks.push({
      device: fs,
      filesystem: type,
      size_gb: sizeGb,
      free_gb: freeGb,
      label: mount,
    });
  }
  return disks;
}

function parseDfSizeToGb(s: string): number | undefined {
  if (!s || s === "-") return undefined;
  const n = parseFloat(s);
  if (Number.isNaN(n)) return undefined;
  if (s.endsWith("T")) return Math.round(n * 1024 * 10) / 10;
  if (s.endsWith("G")) return Math.round(n * 10) / 10;
  if (s.endsWith("M")) return Math.round((n / 1024) * 100) / 100;
  return undefined;
}

function parseIpBr(output: string): NonNullable<DeviceInfo["network_adapters"]> {
  const adapters: NonNullable<DeviceInfo["network_adapters"]> = [];
  for (const line of output.split("\n")) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 2) continue;
    const name = parts[0].replace(/@.*/, "");
    if (name === "lo") continue;
    const ips = line.match(/\d+\.\d+\.\d+\.\d+/g);
    if (ips?.length) adapters.push({ name, ips: [...new Set(ips)] });
  }
  return adapters;
}

function parseIpAddrFallback(output: string): NonNullable<DeviceInfo["network_adapters"]> {
  const adapters: NonNullable<DeviceInfo["network_adapters"]> = [];
  let current: { name: string; mac?: string; ips?: string[] } | null = null;
  for (const line of output.split("\n")) {
    const nm = line.match(/^\d+:\s*(\S+):/);
    if (nm) {
      if (current?.name) adapters.push(current);
      current = { name: nm[1].replace(/@.*/, "") };
    } else if (current && line.includes("inet ") && !line.includes("127.0.0.1")) {
      const im = line.match(/inet\s+([\d.]+)/);
      if (im) {
        current.ips = current.ips || [];
        if (!current.ips.includes(im[1])) current.ips.push(im[1]);
      }
      const mm = line.match(/link\/ether\s+([0-9a-f:]+)/i);
      if (mm) current.mac = mm[1];
    }
  }
  if (current?.name) adapters.push(current);
  return adapters.filter((a) => a.name !== "lo");
}

function parsePasswdUsers(passwdOut: string): NonNullable<DeviceInfo["local_users"]> {
  const users: NonNullable<DeviceInfo["local_users"]> = [];
  for (const line of passwdOut.split("\n")) {
    const p = line.split(":");
    if (p.length < 7) continue;
    const name = p[0];
    const uid = parseInt(p[2], 10);
    const shell = p[6] || "";
    if (!name) continue;
    if (/nologin|false$/i.test(shell)) continue;
    if (name === "root" || (uid >= 1000 && uid < 65534) || (name !== "nobody" && uid === 0)) {
      users.push({ name, full_name: p[4] || undefined, disabled: false });
    }
    if (users.length >= 40) break;
  }
  return users;
}

function parseLsblkPhysical(output: string): NonNullable<DeviceInfo["physical_disks"]> {
  const disks: NonNullable<DeviceInfo["physical_disks"]> = [];
  for (const line of output.split("\n")) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 2) continue;
    const [name, size, model, serial, rota, tran] = parts;
    if (!name || name.startsWith("loop")) continue;
    const sizeGb = parseDfSizeToGb(size);
    disks.push({
      device: name.startsWith("/dev/") ? name : `/dev/${name}`,
      model: model && model !== "-" ? model.replace(/_/g, " ") : undefined,
      size_gb: sizeGb,
      serial: serial && serial !== "-" ? serial : undefined,
      rotational: rota === "1" ? true : rota === "0" ? false : undefined,
      interface_type: tran && tran !== "-" ? tran.toUpperCase() : undefined,
    });
  }
  return disks;
}

/**
 * Acquisizione SSH completa per NAS Synology / QNAP (comandi shell disponibili su DSM/QTS).
 */
export async function getNasDeviceInfoFromSsh(device: NetworkDevice, vendor: NasVendor): Promise<Partial<DeviceInfo>> {
  const creds = getDeviceCredentials(device);
  const username = creds?.username ?? device.username ?? undefined;
  const password = creds?.password;
  if (!username || !password) return {};

  const opts: SshOpts = {
    host: device.host,
    port: device.port || 22,
    username,
    password,
    timeout: 45_000,
  };

  const exec = (cmd: string) => sshExec(opts, cmd).then((r) => r.stdout).catch(() => "");

  const sources: NasInventorySnapshot["sources"] = ["ssh"];
  const snap: NasInventorySnapshot = { vendor, sources, ssh: {} };

  const [
    hostname,
    mdstat,
    dfOut,
    ipBr,
    ipAddr,
    lsblkOut,
    cpuLine,
    memKb,
    passwdOut,
    synoVer,
    synoInfo,
    synoSerial,
    qnapModel,
    qnapSerial,
    qnapUname,
    dmiProduct,
    dmiSerial,
  ] = await Promise.all([
    exec("hostname 2>/dev/null"),
    exec("cat /proc/mdstat 2>/dev/null"),
    exec("df -hPT 2>/dev/null | head -40"),
    exec("ip -br addr 2>/dev/null"),
    exec("ip addr 2>/dev/null"),
    exec("lsblk -d -o NAME,SIZE,MODEL,SERIAL,ROTA,TRAN --noheadings 2>/dev/null | grep -v loop"),
    exec("grep -m1 'model name' /proc/cpuinfo 2>/dev/null | cut -d: -f2"),
    exec("grep MemTotal /proc/meminfo 2>/dev/null | awk '{print $2}'"),
    exec("cat /etc/passwd 2>/dev/null"),
    vendor === "synology"
      ? exec("cat /etc.defaults/VERSION 2>/dev/null || cat /etc/VERSION 2>/dev/null")
      : Promise.resolve(""),
    vendor === "synology" ? exec("cat /etc/synoinfo.conf 2>/dev/null | head -50") : Promise.resolve(""),
    vendor === "synology"
      ? exec("synogetkeyvalue /etc/synoinfo.conf serial 2>/dev/null; cat /proc/sys/kernel/syno_serial 2>/dev/null")
      : Promise.resolve(""),
    vendor === "qnap" ? exec("getsysinfo model 2>/dev/null") : Promise.resolve(""),
    vendor === "qnap" ? exec("getsysinfo serial 2>/dev/null || cat /etc/nas_serial 2>/dev/null") : Promise.resolve(""),
    vendor === "qnap" ? exec("uname -rsm 2>/dev/null") : Promise.resolve(""),
    exec("cat /sys/class/dmi/id/product_name 2>/dev/null"),
    exec("cat /sys/class/dmi/id/product_serial 2>/dev/null"),
  ]);

  let model: string | null = null;
  let serial_number: string | null = null;
  let firmware: string | null = null;
  const sysname = hostname.trim() || null;

  if (vendor === "synology") {
    const m = synoInfo.match(/upnpmodelname\s*=\s*["']?([^"'\n]+)/i);
    model = m?.[1]?.trim() || dmiProduct.trim() || null;
    const build = synoVer.match(/buildnumber\s*=\s*["']?(\d+)/i)?.[1];
    const major = synoVer.match(/majorversion\s*=\s*["']?(\d+)/i)?.[1];
    const minor = synoVer.match(/minorversion\s*=\s*["']?(\d+)/i)?.[1];
    firmware = [major, minor, build].filter(Boolean).join(".") || synoVer.trim() || null;
    const s = synoSerial.trim();
    if (s && !/synology_/i.test(s)) serial_number = s;
  } else {
    model = qnapModel.trim() || dmiProduct.trim() || null;
    serial_number =
      qnapSerial.trim() ||
      (dmiSerial.trim() && !/Not Specified/i.test(dmiSerial) ? dmiSerial.trim() : null) ||
      null;
    firmware = qnapUname.trim() || null;
  }

  const ramKb = parseInt(memKb.trim(), 10);
  const ram_total_gb = !Number.isNaN(ramKb) ? Math.round((ramKb / (1024 * 1024)) * 10) / 10 : null;

  const disks = parseDfToDisks(dfOut);
  const physical_disks = parseLsblkPhysical(lsblkOut);
  let network_adapters = parseIpBr(ipBr);
  if (network_adapters.length === 0) network_adapters = parseIpAddrFallback(ipAddr);

  const local_users = parsePasswdUsers(passwdOut);
  if (mdstat.trim()) {
    snap.ssh!.mdstat_summary = parseMdstatSummary(mdstat);
  }
  snap.ssh!.cpu_model = cpuLine.trim() || null;
  snap.ssh!.kernel = vendor === "qnap" ? qnapUname.trim() || null : null;

  const result: Partial<DeviceInfo> = {
    sysname,
    hostname: sysname,
    model,
    firmware,
    serial_number,
    manufacturer: vendor === "synology" ? "Synology" : "QNAP",
    cpu_model: cpuLine.trim() || null,
    ram_total_gb,
    disks: disks.length ? disks : undefined,
    physical_disks: physical_disks.length ? physical_disks : undefined,
    network_adapters: network_adapters.length ? network_adapters : undefined,
    local_users: local_users.length ? local_users : undefined,
    kernel_version: vendor === "synology" ? undefined : qnapUname.trim() || undefined,
    nas_inventory: snap,
  };

  return result;
}
