/**
 * Acquisizione estesa Synology / QNAP: SNMP (MIB enterprise) + SSH (sistema).
 * Obiettivo: volumi logici/fisici, RAID, dischi, rete con IP, HW, utenti locali.
 *
 * Walk SNMP: `snmpSubwalkLimitedForDevice` usa SNMPv2c (community) salvo `protocol === "snmp_v3"`
 * con credenziali SNMP v3 (stesso schema authNoPriv di getDeviceInfoFromSnmp). I NAS solo SSH
 * con community in credenziale continuano a usare v2c sulla porta 161.
 */

import type { NetworkDevice } from "@/types";
import { getDeviceCredentials } from "@/lib/db";
import { sshExec } from "./ssh-helper";
import type { DeviceInfo, NasInventorySnapshot } from "./device-info";
import { snmpSubwalkLimitedForDevice, stringifySnmpValue } from "@/lib/scanner/snmp-query";

export type NasVendor = "synology" | "qnap";

const SYNO_DISK_BASE = "1.3.6.1.4.1.6574.2.1.1";
const SYNO_RAID_BASE = "1.3.6.1.4.1.6574.3.1.1";
const SYNO_POOL_BASE = "1.3.6.1.4.1.6574.4.1.1";
const SYNO_IO_BASE = "1.3.6.1.4.1.6574.5.1.1";
const SYNO_UPS_BASE = "1.3.6.1.4.1.6574.6";
const SYNO_SVC_BASE = "1.3.6.1.4.1.6574.7.1.1";
const QNAP_STORAGE_BASE = "1.3.6.1.4.1.24681.1.2";
const QNAP_QTS5_POOL_BASE = "1.3.6.1.4.1.24681.2.2";

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
    if (col === "7") row.slot = val;
    if (col === "13") row.smart = val;
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
      slot: row.slot,
      smart_health: row.smart,
    });
  }
  return out.length ? out : undefined;
}

function synoMbToGb(n: number): number | null {
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round((n / 1024) * 10) / 10;
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
    if (!Number.isNaN(c4) && c4 > 0) total_gb = synoMbToGb(c4);
    if (!Number.isNaN(c5) && c5 > 0) free_gb = synoMbToGb(c5);
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

function parseSynologyStoragePoolWalk(
  rows: Array<{ oid: string; value: unknown }>
): NonNullable<NasInventorySnapshot["snmp"]>["storage_pools"] | undefined {
  const byIdx = new Map<string, Record<string, string>>();
  for (const r of rows) {
    const m = r.oid.match(/\.6574\.4\.1\.1\.(\d+)\.(\d+)$/);
    if (!m) continue;
    const col = m[1];
    const idx = m[2];
    const val = stringifySnmpValue(r.value);
    if (!val) continue;
    if (!byIdx.has(idx)) byIdx.set(idx, {});
    const row = byIdx.get(idx)!;
    if (col === "2") row.name = val;
    if (col === "3") row.status = val;
    if (col === "4") row.total_mb = val;
    if (col === "5") row.used_mb = val;
  }
  const out: NonNullable<NasInventorySnapshot["snmp"]>["storage_pools"] = [];
  for (const [, row] of byIdx) {
    const tmb = row.total_mb ? parseInt(row.total_mb, 10) : NaN;
    const umb = row.used_mb ? parseInt(row.used_mb, 10) : NaN;
    out.push({
      name: row.name,
      status: row.status ?? null,
      total_gb: !Number.isNaN(tmb) && tmb > 0 ? synoMbToGb(tmb) : null,
      used_gb: !Number.isNaN(umb) && umb > 0 ? synoMbToGb(umb) : null,
    });
  }
  return out.length ? out : undefined;
}

function parseSynologyVolumeIoWalk(
  rows: Array<{ oid: string; value: unknown }>
): NonNullable<NasInventorySnapshot["snmp"]>["volume_io"] | undefined {
  const byIdx = new Map<string, Record<string, string>>();
  for (const r of rows) {
    const m = r.oid.match(/\.6574\.5\.1\.1\.(\d+)\.(\d+)$/);
    if (!m) continue;
    const col = m[1];
    const idx = m[2];
    const val = stringifySnmpValue(r.value);
    if (!val) continue;
    if (!byIdx.has(idx)) byIdx.set(idx, {});
    const row = byIdx.get(idx)!;
    if (col === "2") row.name = val;
    if (col === "3") row.read_bps = val;
    if (col === "4") row.write_bps = val;
  }
  const out: NonNullable<NasInventorySnapshot["snmp"]>["volume_io"] = [];
  for (const [, row] of byIdx) {
    out.push({
      name: row.name,
      read_bps: row.read_bps ?? null,
      write_bps: row.write_bps ?? null,
    });
  }
  return out.length ? out : undefined;
}

function parseSynologyUpsWalk(
  rows: Array<{ oid: string; value: unknown }>
): { status: string | null; battery_pct: string | null } | undefined {
  let status: string | null = null;
  let battery_pct: string | null = null;
  for (const r of rows) {
    const v = stringifySnmpValue(r.value);
    if (!v) continue;
    if (r.oid.match(/\.6574\.6\.1\.1\.3\.1$/)) status = v;
    if (r.oid.match(/\.6574\.6\.1\.1\.4\.1$/)) battery_pct = v;
  }
  if (status == null && battery_pct == null) return undefined;
  return { status, battery_pct };
}

function parseSynologyServicesWalk(
  rows: Array<{ oid: string; value: unknown }>
): NonNullable<NasInventorySnapshot["snmp"]>["services"] | undefined {
  const byIdx = new Map<string, Record<string, string>>();
  for (const r of rows) {
    const m = r.oid.match(/\.6574\.7\.1\.1\.(\d+)\.(\d+)$/);
    if (!m) continue;
    const col = m[1];
    const idx = m[2];
    const val = stringifySnmpValue(r.value);
    if (!val) continue;
    if (!byIdx.has(idx)) byIdx.set(idx, {});
    const row = byIdx.get(idx)!;
    if (col === "2") row.name = val;
    if (col === "3") row.state = val;
  }
  const out: NonNullable<NasInventorySnapshot["snmp"]>["services"] = [];
  for (const [, row] of byIdx) {
    if (row.name || row.state) out.push({ name: row.name, state: row.state ?? null });
  }
  return out.length ? out : undefined;
}

function parseQnapStorageWalk(rows: Array<{ oid: string; value: unknown }>): {
  volumes?: NonNullable<NasInventorySnapshot["snmp"]>["volumes_snmp"];
  disks?: NonNullable<NasInventorySnapshot["snmp"]>["disks"];
  temperature_c?: number | null;
} {
  let temperature_c: number | null = null;
  const diskTable = new Map<string, Record<string, string>>();
  const volTable = new Map<string, Record<string, string>>();

  for (const r of rows) {
    const v = stringifySnmpValue(r.value);
    if (r.oid.endsWith(".24681.1.2.7.0") || /\.24681\.1\.2\.7\.0$/.test(r.oid)) {
      if (v) {
        const n = parseInt(v, 10);
        if (!Number.isNaN(n)) temperature_c = n;
      }
      continue;
    }
    const diskM = r.oid.match(/\.24681\.1\.2\.11\.1\.(\d+)\.(\d+)$/);
    if (diskM) {
      const col = diskM[1];
      const idx = diskM[2];
      if (!diskTable.has(idx)) diskTable.set(idx, {});
      const row = diskTable.get(idx)!;
      if (col === "1") row.index = v ?? "";
      if (col === "2") row.model = v ?? "";
      if (col === "3") row.serial = v ?? "";
      if (col === "4") row.capacity_gb = v ?? "";
      if (col === "5") row.temp_c = v ?? "";
      if (col === "6") row.status = v ?? "";
      if (col === "7") row.smart = v ?? "";
      continue;
    }
    const volM = r.oid.match(/\.24681\.1\.2\.17\.1\.(\d+)\.(\d+)$/);
    if (volM) {
      const col = volM[1];
      const idx = volM[2];
      if (!volTable.has(idx)) volTable.set(idx, {});
      const row = volTable.get(idx)!;
      if (col === "1") row.index = v ?? "";
      if (col === "2") row.name = v ?? "";
      if (col === "3") row.status = v ?? "";
      if (col === "4") row.total_gb = v ?? "";
      if (col === "5") row.free_gb = v ?? "";
      if (col === "6") row.raid_type = v ?? "";
      continue;
    }
    if (v && temperature_c == null && (r.oid.endsWith(".24681.1.2.4.0") || r.oid.includes(".1.2.4.0"))) {
      const n = parseInt(v, 10);
      if (!Number.isNaN(n)) temperature_c = n;
    }
  }

  const volumes: NonNullable<NasInventorySnapshot["snmp"]>["volumes_snmp"] = [];
  for (const [, row] of volTable) {
    if (!row.name) continue;
    const tg = row.total_gb ? parseFloat(row.total_gb) : NaN;
    const fg = row.free_gb ? parseFloat(row.free_gb) : NaN;
    volumes.push({
      name: row.name,
      size_gb: !Number.isNaN(tg) ? tg : null,
      free_gb: !Number.isNaN(fg) ? fg : null,
      status: row.status || null,
      raid_type: row.raid_type || null,
    });
  }

  const disks: NonNullable<NasInventorySnapshot["snmp"]>["disks"] = [];
  for (const [, row] of diskTable) {
    const tempRaw = row.temp_c;
    let temperature_c_disk: number | null = null;
    if (tempRaw && /^\d+$/.test(tempRaw)) temperature_c_disk = parseInt(tempRaw, 10);
    const cap = row.capacity_gb ? parseFloat(row.capacity_gb) : null;
    disks.push({
      index: row.index,
      model: row.model,
      status: row.status,
      serial: row.serial,
      capacity_gb: cap != null && !Number.isNaN(cap) ? cap : null,
      temperature_c: temperature_c_disk,
      smart_health: row.smart,
      type: undefined,
    });
  }

  return {
    volumes: volumes.length ? volumes : undefined,
    disks: disks.length ? disks : undefined,
    temperature_c,
  };
}

export async function getNasSnmpInventory(
  device: NetworkDevice,
  vendor: NasVendor
): Promise<Partial<DeviceInfo>> {
  const sources: NasInventorySnapshot["sources"] = ["snmp"];
  const snap: NasInventorySnapshot = { vendor, sources, snmp: {} };

  const walk = (base: string, max: number, timeout: number, rep = 20) =>
    snmpSubwalkLimitedForDevice(device, base, max, timeout, rep);

  try {
    if (vendor === "synology") {
      const [
        diskRows,
        raidRows,
        poolRows,
        ioRows,
        upsRows,
        svcRows,
      ] = await Promise.all([
        walk(SYNO_DISK_BASE, 180, 8000, 20),
        walk(SYNO_RAID_BASE, 180, 8000, 20),
        walk(SYNO_POOL_BASE, 120, 6000, 18),
        walk(SYNO_IO_BASE, 100, 5000, 18),
        walk(SYNO_UPS_BASE, 40, 4000, 15),
        walk(SYNO_SVC_BASE, 100, 6000, 18),
      ]);

      const disks = parseSynologyDiskWalk(diskRows);
      const raids = parseSynologyRaidWalk(raidRows);
      const storage_pools = parseSynologyStoragePoolWalk(poolRows);
      const volume_io = parseSynologyVolumeIoWalk(ioRows);
      const ups = parseSynologyUpsWalk(upsRows);
      const services = parseSynologyServicesWalk(svcRows);

      if (disks?.length) snap.snmp!.disks = disks;
      if (raids?.length) snap.snmp!.raids = raids;
      if (storage_pools?.length) snap.snmp!.storage_pools = storage_pools;
      if (volume_io?.length) snap.snmp!.volume_io = volume_io;
      if (ups) snap.snmp!.ups = ups;
      if (services?.length) snap.snmp!.services = services;

      const physFromSnmp: NonNullable<DeviceInfo["physical_disks"]> = [];
      for (const d of disks ?? []) {
        if (d.model || d.status) {
          physFromSnmp.push({
            device: d.id || d.index || "?",
            model: d.model,
            vendor: d.type,
            serial: d.serial,
            interface_type: d.smart_health ? `SMART ${d.smart_health}` : d.status ? `status ${d.status}` : undefined,
          });
        }
      }
      const partial: Partial<DeviceInfo> = { nas_inventory: snap };
      if (physFromSnmp.length) partial.physical_disks = physFromSnmp;
      return partial;
    }

    const [qnapRows, qts5Rows] = await Promise.all([
      walk(QNAP_STORAGE_BASE, 260, 11000, 25),
      walk(QNAP_QTS5_POOL_BASE, 80, 6000, 18).catch(() => [] as Array<{ oid: string; value: unknown }>),
    ]);
    const parsed = parseQnapStorageWalk(qnapRows);
    if (parsed.temperature_c != null) snap.snmp!.temperature_c = parsed.temperature_c;
    if (parsed.disks?.length) snap.snmp!.disks = parsed.disks;
    if (parsed.volumes?.length) snap.snmp!.volumes_snmp = parsed.volumes;
    if (qts5Rows.length > 0) snap.snmp!.qts5_pool_rows = qts5Rows.length;

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
    const [fs, type, size, , avail, , mount] = parts;
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

function countSynopkgLines(out: string): number | null {
  const lines = out.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) return null;
  return lines.length;
}

/**
 * Acquisizione SSH completa per NAS Synology / QNAP (comandi shell disponibili su DSM/QTS).
 */
export async function getNasDeviceInfoFromSsh(device: NetworkDevice, vendor: NasVendor): Promise<Partial<DeviceInfo>> {
  const creds = getDeviceCredentials(device);
  const username = creds?.username ?? device.username ?? undefined;
  const password = creds?.password;
  if (!username || !password) return {};

  // Se il protocollo primario è SNMP, la porta configurata è quella SNMP (161): usa 22 per SSH
  const sshPort = (device.protocol === "snmp_v2" || device.protocol === "snmp_v3") ? 22 : (device.port || 22);
  const opts: SshOpts = {
    host: device.host,
    port: sshPort,
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
    synoShares,
    synoPkg,
    synoPool,
    synoTemp,
    qnapRaid,
    qnapStorageCfg,
    qnapQpkg,
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
    vendor === "synology" ? exec("synoshare --enum ALL 2>/dev/null | head -35") : Promise.resolve(""),
    vendor === "synology" ? exec("synopkg list 2>/dev/null | head -40") : Promise.resolve(""),
    vendor === "synology"
      ? exec("synostgpool list 2>/dev/null | head -25; synovolume list 2>/dev/null | head -25")
      : Promise.resolve(""),
    vendor === "synology" ? exec("synotemperature 2>/dev/null | head -20") : Promise.resolve(""),
    vendor === "qnap" ? exec("/sbin/raid_info 2>/dev/null | head -25 || /usr/sbin/raid_info 2>/dev/null | head -25") : Promise.resolve(""),
    vendor === "qnap"
      ? exec(
          "for i in $(seq 1 16); do m=$(getcfg \"Storage $i\" model 2>/dev/null); [ -z \"$m\" ] && continue; echo \"Disk$i: model=$m serial=$(getcfg \"Storage $i\" serial 2>/dev/null) temp=$(getcfg \"Storage $i\" temp 2>/dev/null)\"; done | head -20"
        )
      : Promise.resolve(""),
    vendor === "qnap"
      ? exec("ls /share/CACHEDEV1_DATA/.qpkg 2>/dev/null | head -25; ls /share/MD0_DATA/.qpkg 2>/dev/null | head -25")
      : Promise.resolve(""),
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

  if (vendor === "synology") {
    if (synoShares.trim()) snap.ssh!.synology_shares_preview = synoShares.trim().slice(0, 4000);
    const pc = countSynopkgLines(synoPkg);
    if (pc != null) snap.ssh!.synology_packages_count = pc;
    if (synoPool.trim()) snap.ssh!.synology_storage_lines = synoPool.trim().slice(0, 4000);
    if (synoTemp.trim()) snap.ssh!.synology_temperature_lines = synoTemp.trim().slice(0, 2000);
  } else {
    if (qnapRaid.trim()) snap.ssh!.qnap_raid_info_preview = qnapRaid.trim().slice(0, 4000);
    if (qnapStorageCfg.trim()) snap.ssh!.qnap_storage_cfg_preview = qnapStorageCfg.trim().slice(0, 4000);
    if (qnapQpkg.trim()) snap.ssh!.qnap_qpkg_preview = qnapQpkg.trim().slice(0, 2000);
  }

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
