/**
 * Recupera informazioni sul dispositivo via SNMP e SSH.
 * SNMP: sysName, sysDescr (standard MIB-2)
 * SSH: comandi vendor-specific per model, firmware
 */

import type { NetworkDevice } from "@/types";
import { getDeviceCredentials, getDeviceCommunityString, getDeviceSnmpV3Credentials, getCredentialCommunityString } from "@/lib/db";
import { sshExec, sshExecViaShell } from "./ssh-helper";

export interface DeviceInfo {
  sysname: string | null;
  sysdescr: string | null;
  model: string | null;
  firmware: string | null;
  serial_number: string | null;
  part_number: string | null;
  /** Campi estesi (da DADude3): salvati in last_device_info_json */
  os_name?: string | null;
  os_version?: string | null;
  os_build?: string | null;
  architecture?: string | null;
  hostname?: string | null;
  domain?: string | null;
  manufacturer?: string | null;
  ram_total_gb?: number | null;
  cpu_model?: string | null;
  cpu_cores?: number | null;
  cpu_threads?: number | null;
  cpu_speed_mhz?: number | null;
  disks?: Array<{ device: string; size_gb?: number; free_gb?: number; filesystem?: string; label?: string }>;
  network_adapters?: Array<{ name: string; mac?: string; ips?: string[]; dhcp?: boolean }>;
  memory_modules?: Array<{ size_gb?: number; speed_mhz?: number; manufacturer?: string }>;
  server_roles?: string[];
  important_services?: Array<{ name: string; display_name: string; state: string; start_mode: string }>;
  local_users?: Array<{ name: string; full_name?: string; disabled?: boolean }>;
  antivirus?: Array<{ name: string; state?: string }>;
  domain_role?: string | null;
  is_domain_controller?: boolean;
  is_server?: boolean;
  /** Campi estesi Windows: sistema */
  system_type?: string | null;
  os_serial?: string | null;
  registered_user?: string | null;
  organization?: string | null;
  install_date?: string | null;
  last_boot?: string | null;
  uptime_days?: number | null;
  bios_version?: string | null;
  bios_manufacturer?: string | null;
  /** Campi estesi Windows: HW aggiuntivo */
  cpu_manufacturer?: string | null;
  processor_count?: number | null;
  ram_total_mb?: number | null;
  disk_total_gb?: number | null;
  disk_free_gb?: number | null;
  gpu?: Array<{ name: string; driver_version?: string; ram_gb?: number }>;
  /** Campi estesi Windows: licenza */
  license_status?: string | null;
  license_name?: string | null;
  license_partial_key?: string | null;
  /** Campi estesi Windows: aggiornamenti */
  installed_hotfixes?: Array<{ id: string; description?: string; installed_on?: string }>;
  pending_updates_count?: number | null;
  /** Campi estesi Windows: software */
  installed_software_count?: number | null;
  key_software?: Array<{ name: string; version?: string; publisher?: string }>;
  /** Linux-specific (DADude3 linux_probe) */
  kernel_version?: string | null;
  uptime?: string | null;
  load_average?: string | null;
  virtualization?: string | null;
  is_virtual?: boolean;
  ram_free_mb?: number | null;
}

/**
 * Recupera sysName e sysDescr via SNMP (MIB-2).
 * Usato per dispositivi con community_string o protocollo SNMP.
 */
export async function getDeviceInfoFromSnmp(device: NetworkDevice): Promise<DeviceInfo> {
  const isSnmpProtocol = device.protocol === "snmp_v2" || device.protocol === "snmp_v3";
  const snmpPort = isSnmpProtocol ? (device.port || 161) : 161;
  const opts = { port: snmpPort, timeout: 5000 };

  try {
    const snmp = await import("net-snmp");
    type SnmpSession = { get: (oids: string[], cb: (err: Error | null, varbinds: Array<{ oid: string; value: Buffer | string | number }>) => void) => void; close: () => void };
    let session: SnmpSession;
    if (device.protocol === "snmp_v3") {
      const v3 = getDeviceSnmpV3Credentials(device);
      if (v3) {
        const user = {
          name: v3.username,
          level: snmp.SecurityLevel.authNoPriv,
          authProtocol: snmp.AuthProtocols.md5,
          authKey: v3.authKey,
        };
        session = snmp.createV3Session(device.host, user, opts);
      } else {
        const community = getDeviceCommunityString(device);
        session = snmp.createSession(device.host, community, opts);
      }
    } else {
      const community = getDeviceCommunityString(device);
      session = snmp.createSession(device.host, community, opts);
    }
    // sysDescr, sysName, ENTITY-MIB: entPhysicalSerialNum, entPhysicalDescr, entPhysicalModelName
    // OID base ENTITY-MIB: 1.3.6.1.2.1.47.1.1.1.1
    // .2 = entPhysicalDescr (model/description), .11 = entPhysicalSerialNum, .13 = entPhysicalModelName (part number)
    // Proviamo indice 1 (chassis) e 2 (alcuni device usano indice diverso)
    const oids = [
      "1.3.6.1.2.1.1.1.0",  // sysDescr
      "1.3.6.1.2.1.1.5.0",  // sysName
      "1.3.6.1.2.1.47.1.1.1.1.11.1", // entPhysicalSerialNum.1 (chassis)
      "1.3.6.1.2.1.47.1.1.1.1.11.2", // entPhysicalSerialNum.2 (fallback)
      "1.3.6.1.2.1.47.1.1.1.1.2.1",  // entPhysicalDescr.1 (model)
      "1.3.6.1.2.1.47.1.1.1.1.2.2",  // entPhysicalDescr.2 (fallback)
      "1.3.6.1.2.1.47.1.1.1.1.13.1", // entPhysicalModelName.1 (part number)
      "1.3.6.1.2.1.47.1.1.1.1.13.2", // entPhysicalModelName.2 (fallback)
    ];

    return new Promise((resolve) => {
      const t = setTimeout(() => {
        session.close();
        resolve({ sysname: null, sysdescr: null, model: null, firmware: null, serial_number: null, part_number: null });
      }, 8000);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (session as any).get(oids, (error: Error | null, varbinds: Array<{ oid: string; value: Buffer | string | number }>) => {
          clearTimeout(t);
          session.close();
          if (error) {
            resolve({ sysname: null, sysdescr: null, model: null, firmware: null, serial_number: null, part_number: null });
            return;
          }
          let sysdescr: string | null = null;
          let sysname: string | null = null;
          let serial_number: string | null = null;
          let model: string | null = null;
          let part_number: string | null = null;

          for (const vb of varbinds) {
            const val = Buffer.isBuffer(vb.value) ? vb.value.toString("utf-8").trim() : String(vb.value ?? "").trim();
            if (!val || val === "noSuchObject" || val === "noSuchInstance" || val === "endOfMibView") continue;

            // Match robusto usando endsWith per gestire formati OID variabili
            const oid = vb.oid;
            if (oid === "1.3.6.1.2.1.1.1.0" || oid.endsWith(".1.1.1.0")) sysdescr = sysdescr || val;
            if (oid === "1.3.6.1.2.1.1.5.0" || oid.endsWith(".1.1.5.0")) sysname = sysname || val;
            // entPhysicalSerialNum (.11.1 o .11.2)
            if (oid.includes(".47.1.1.1.1.11.")) serial_number = serial_number || val;
            // entPhysicalDescr (.2.1 o .2.2) - model
            if (oid.includes(".47.1.1.1.1.2.")) model = model || val;
            // entPhysicalModelName (.13.1 o .13.2) - part number
            if (oid.includes(".47.1.1.1.1.13.")) part_number = part_number || val;
          }
          resolve({ sysname, sysdescr, model, firmware: null, serial_number, part_number });
        }
      );
    });
  } catch {
    return { sysname: null, sysdescr: null, model: null, firmware: null, serial_number: null, part_number: null };
  }
}

/**
 * Recupera model e firmware via SSH con comandi vendor-specific.
 */
export async function getDeviceInfoFromSsh(device: NetworkDevice): Promise<Partial<DeviceInfo>> {
  const creds = getDeviceCredentials(device);
  const username = creds?.username ?? device.username ?? undefined;
  const password = creds?.password;
  if (!username || !password) return {};

  const opts = {
    host: device.host,
    port: device.port || 22,
    username,
    password,
    timeout: 15000,
  };

  try {
    if (device.vendor === "mikrotik") {
      const r = await sshExec(opts, '/system resource print');
      const board = r.stdout.match(/board-name:\s*(.+)/)?.[1]?.trim();
      const version = r.stdout.match(/version:\s*(.+)/)?.[1]?.trim();
      const serial = r.stdout.match(/serial-number:\s*(.+)/)?.[1]?.trim();
      const identity = await sshExec(opts, '/system identity print').then((x) => x.stdout.match(/name:\s*(.+)/)?.[1]?.trim());
      // MikroTik usa routerboard print per part number
      const rbInfo = await sshExec(opts, '/system routerboard print').catch(() => ({ stdout: "" }));
      const partNumber = rbInfo.stdout.match(/model:\s*(.+)/i)?.[1]?.trim();
      return {
        model: board || null,
        firmware: version || null,
        sysname: identity || null,
        serial_number: serial || null,
        part_number: partNumber || null,
      };
    }

    if (device.vendor === "cisco") {
      const r = await sshExec(opts, "show version");
      const model = r.stdout.match(/Model Number:\s*(.+)/)?.[1]?.trim()
        || r.stdout.match(/cisco\s+(\S+)\s+\(/i)?.[1]
        || r.stdout.match(/PID:\s*(\S+)/)?.[1]?.trim();
      const version = r.stdout.match(/Version\s+([^\s,]+)/i)?.[1]?.trim()
        || r.stdout.match(/Cisco IOS Software[^,]*,\s*Version\s+([^\s,]+)/i)?.[1]?.trim();
      const hostname = r.stdout.match(/^(\S+)\s+uptime/i)?.[1]?.trim();
      const serial = r.stdout.match(/Processor board ID\s+(\S+)/i)?.[1]?.trim()
        || r.stdout.match(/System Serial Number:\s*(\S+)/i)?.[1]?.trim()
        || r.stdout.match(/Serial Number:\s*(\S+)/i)?.[1]?.trim();
      // Cisco part number dal PID (Product ID)
      const partNumber = r.stdout.match(/PID:\s*(\S+)/)?.[1]?.trim()
        || r.stdout.match(/Product Identifier.*?:\s*(\S+)/i)?.[1]?.trim();
      return {
        model: model || null,
        firmware: version || null,
        sysname: hostname || null,
        serial_number: serial || null,
        part_number: partNumber || null,
      };
    }

    if (device.vendor === "hp") {
      const subtype = device.vendor_subtype ?? "procurve";
      if (subtype === "procurve") {
        const r = await sshExec(opts, "show system").catch(() => sshExecViaShell(opts, "show system"));
        const partNumber = r.stdout.match(/Product Number:\s*(.+)/)?.[1]?.trim();
        const model = r.stdout.match(/Model:\s*(.+)/)?.[1]?.trim() || partNumber;
        const version = r.stdout.match(/Software revision\s*:\s*(.+)/)?.[1]?.trim()
          || r.stdout.match(/ROM:\s*(.+)/)?.[1]?.trim();
        const name = r.stdout.match(/Name:\s*(.+)/)?.[1]?.trim();
        const serial = r.stdout.match(/Serial Number\s*:\s*(.+)/)?.[1]?.trim()
          || r.stdout.match(/Serial number\s*:\s*(.+)/i)?.[1]?.trim();
        return {
          model: model || null,
          firmware: version || null,
          sysname: name || null,
          serial_number: serial || null,
          part_number: partNumber || null,
        };
      }
      if (subtype === "comware") {
        const r = await sshExec(opts, "display device manuinfo");
        const model = r.stdout.match(/DEVICE_NAME\s*:\s*(.+)/)?.[1]?.trim();
        const partNumber = r.stdout.match(/DEVICE_PART_NUMBER\s*:\s*(.+)/)?.[1]?.trim()
          || r.stdout.match(/PART_NUMBER\s*:\s*(.+)/i)?.[1]?.trim();
        const serial = r.stdout.match(/DEVICE_SERIAL_NUMBER\s*:\s*(.+)/)?.[1]?.trim()
          || r.stdout.match(/SERIAL_NUMBER\s*:\s*(.+)/i)?.[1]?.trim();
        const version = await sshExec(opts, "display version").then((x) =>
          x.stdout.match(/Comware\s+V\d+[^\n]*\n[^\n]*Version\s+([^\s]+)/i)?.[1]?.trim()
        );
        const name = await sshExec(opts, "display current-configuration | include sysname").then((x) =>
          x.stdout.match(/sysname\s+(\S+)/)?.[1]?.trim()
        );
        return {
          model: model || null,
          firmware: version || null,
          sysname: name || null,
          serial_number: serial || null,
          part_number: partNumber || null,
        };
      }
    }

    if (device.vendor === "ubiquiti") {
      const r = await sshExec(opts, "cat /etc/version 2>/dev/null || cat /tmp/version 2>/dev/null || echo");
      const version = r.stdout.trim() || null;
      const model = r.stdout.match(/^(U[^\s]+)/)?.[1] || null;
      return { model: model || null, firmware: version || null };
    }

    // Synology DSM (DADude3 ssh_vendors/synology.py) — comandi determinati dal profilo vendor
    if (device.vendor === "synology") {
      const syno = await sshExec(opts, "cat /etc/synoinfo.conf 2>/dev/null").catch(() => ({ stdout: "" }));
      const model = syno.stdout.match(/upnpmodelname\s*=\s*["']?([^"'\n]+)/i)?.[1]?.trim() || null;
      const serial = await sshExec(opts, "synogetkeyvalue /etc/synoinfo.conf serial 2>/dev/null || cat /proc/sys/kernel/syno_serial 2>/dev/null").catch(() => ({ stdout: "" }));
      const ver = await sshExec(opts, "cat /etc.defaults/VERSION 2>/dev/null || cat /etc/VERSION 2>/dev/null").catch(() => ({ stdout: "" }));
      const build = ver.stdout.match(/buildnumber\s*=\s*["']?(\d+)/i)?.[1];
      const major = ver.stdout.match(/majorversion\s*=\s*["']?(\d+)/i)?.[1];
      const minor = ver.stdout.match(/minorversion\s*=\s*["']?(\d+)/i)?.[1];
      const firmware = [major, minor, build].filter(Boolean).join(".") || ver.stdout.trim() || null;
      const hostname = await sshExec(opts, "hostname").catch(() => ({ stdout: "" }));
      return {
        model: model || null,
        firmware: firmware || null,
        sysname: hostname.stdout.trim() || null,
        serial_number: serial.stdout.trim() && !serial.stdout.includes("synology_") ? serial.stdout.trim() : null,
      };
    }

    // QNAP QTS/QuTS Hero (DADude3 ssh_vendors/qnap.py) — comandi determinati dal profilo vendor
    if (device.vendor === "qnap") {
      const model = await sshExec(opts, "getsysinfo model 2>/dev/null").catch(() => ({ stdout: "" }));
      const serial = await sshExec(opts, "getsysinfo serial 2>/dev/null || cat /etc/nas_serial 2>/dev/null").catch(() => ({ stdout: "" }));
      const ver = await sshExec(opts, "get_hwspec 2>/dev/null | grep -i version || cat /etc/default_config/uLinux.conf 2>/dev/null | grep -i version").catch(() => ({ stdout: "" }));
      const version = ver.stdout.match(/version\s*[=:]\s*["']?([^"'\s\n]+)/i)?.[1]?.trim()
        || await sshExec(opts, "uname -r 2>/dev/null").then((x) => x.stdout.trim()).catch(() => null);
      const hostname = await sshExec(opts, "hostname").catch(() => ({ stdout: "" }));
      return {
        model: model.stdout.trim() || null,
        firmware: version || null,
        sysname: hostname.stdout.trim() || null,
        serial_number: serial.stdout.trim() || null,
      };
    }

    // Proxmox VE (DADude3 ssh_vendors/proxmox.py)
    if (device.vendor === "proxmox") {
      const pve = await sshExec(opts, "pveversion 2>/dev/null || cat /etc/pve/version 2>/dev/null").catch(() => ({ stdout: "" }));
      const version = pve.stdout.match(/pve-manager\/(\d+\.\d+\.\d+)/)?.[1] || pve.stdout.trim() || null;
      const hostname = await sshExec(opts, "hostname").catch(() => ({ stdout: "" }));
      const hw = await sshExec(opts, "dmidecode -s system-product-name 2>/dev/null || cat /sys/class/dmi/id/product_name 2>/dev/null").catch(() => ({ stdout: "" }));
      const serial = await sshExec(opts, "dmidecode -s system-serial-number 2>/dev/null || cat /sys/class/dmi/id/product_serial 2>/dev/null").catch(() => ({ stdout: "" }));
      return {
        model: hw.stdout.trim() || "Proxmox VE",
        firmware: version || null,
        sysname: hostname.stdout.trim() || null,
        serial_number: serial.stdout.trim() && serial.stdout !== "Not Specified" ? serial.stdout.trim() : null,
      };
    }

    // Linux generico (DADude3 ssh_vendors/linux.py) - acquisizione completa
    if (device.vendor === "linux" || device.vendor === "other") {
      return getDeviceInfoFromLinux(opts);
    }
  } catch {
    /* ignore */
  }
  return {};
}

/** Opzioni SSH per connessione */
type SshOpts = { host: string; port?: number; username: string; password: string; timeout?: number };

/**
 * Acquisizione dati completi da host Linux (DADude3 linux_probe).
 * Raccoglie: sistema, hardware, interfacce, dischi, servizi, utenti.
 */
async function getDeviceInfoFromLinux(opts: SshOpts): Promise<Partial<DeviceInfo>> {
  const exec = (cmd: string) => sshExec(opts, cmd).then((r) => r.stdout).catch(() => "");
  const execSudo = (cmd: string) => sshExec(opts, `sudo ${cmd} 2>/dev/null`).then((r) => r.stdout).catch(() => "");

  // Esecuzione parallela dei comandi base
  const [
    hostname,
    osRelease,
    kernel,
    arch,
    uptime,
    load,
    cpuLine,
    nproc,
    memTotal,
    memAvail,
    sysProduct,
    sysSerial,
    sysVendor,
    dmiProduct,
    dmiSerial,
    dmiVendor,
    virt,
  ] = await Promise.all([
    exec("hostname 2>/dev/null"),
    exec("cat /etc/os-release 2>/dev/null"),
    exec("uname -r 2>/dev/null"),
    exec("uname -m 2>/dev/null"),
    exec("uptime -p 2>/dev/null || uptime 2>/dev/null"),
    exec("cat /proc/loadavg 2>/dev/null"),
    exec("grep -m1 'model name' /proc/cpuinfo 2>/dev/null | cut -d: -f2"),
    exec("nproc 2>/dev/null || grep -c processor /proc/cpuinfo 2>/dev/null"),
    exec("grep MemTotal /proc/meminfo 2>/dev/null | awk '{print $2}'"),
    exec("grep MemAvailable /proc/meminfo 2>/dev/null | awk '{print $2}'"),
    exec("cat /sys/class/dmi/id/product_name 2>/dev/null"),
    exec("cat /sys/class/dmi/id/product_serial 2>/dev/null"),
    exec("cat /sys/class/dmi/id/sys_vendor 2>/dev/null"),
    execSudo("dmidecode -s system-product-name 2>/dev/null"),
    execSudo("dmidecode -s system-serial-number 2>/dev/null"),
    execSudo("dmidecode -s system-manufacturer 2>/dev/null"),
    exec("systemd-detect-virt 2>/dev/null || echo none"),
  ]);

  const hwProduct = (dmiProduct || sysProduct || "").trim();
  const hwSerial = (dmiSerial || sysSerial || "").trim();
  const hwManufacturer = (dmiVendor || sysVendor || "").trim();

  const osName = osRelease.match(/^NAME\s*=\s*["']?([^"'\n]+)/m)?.[1]?.trim();
  const osVersion = osRelease.match(/^VERSION\s*=\s*["']?([^"'\n]+)/m)?.[1]?.trim();
  const prettyName = osRelease.match(/^PRETTY_NAME\s*=\s*["']?([^"'\n]+)/m)?.[1]?.trim();

  const ramTotalKb = parseInt(memTotal, 10);
  const ramAvailKb = parseInt(memAvail, 10);
  const ramTotalGb = !Number.isNaN(ramTotalKb) ? Math.round((ramTotalKb / (1024 * 1024)) * 10) / 10 : null;
  const ramFreeMb = !Number.isNaN(ramAvailKb) ? Math.floor(ramAvailKb / 1024) : null;

  const virtLower = virt.trim().toLowerCase();
  const isVirtual = virtLower !== "none" && virtLower !== "" && /vmware|virtualbox|kvm|xen|hyperv|docker|lxc|qemu/.test(virtLower);

  const serial = hwSerial.trim();
  const validSerial = serial && !["Not Specified", "None", "To Be Filled"].includes(serial);

  const result: Partial<DeviceInfo> = {
    sysname: hostname.trim() || null,
    hostname: hostname.trim() || null,
    model: hwProduct.trim() || hwManufacturer.trim() || null,
    firmware: osVersion || prettyName || null,
    sysdescr: prettyName || osName || null,
    serial_number: validSerial ? serial : null,
    manufacturer: hwManufacturer.trim() || null,
    os_name: osName || prettyName || null,
    os_version: osVersion || null,
    kernel_version: kernel.trim() || null,
    architecture: arch.trim() || null,
    uptime: uptime.trim() || null,
    load_average: load.trim() ? load.trim().split(/\s+/).slice(0, 3).join(", ") : null,
    cpu_model: cpuLine?.trim() || null,
    cpu_cores: nproc && /^\d+$/.test(nproc.trim()) ? parseInt(nproc.trim(), 10) : null,
    ram_total_gb: ramTotalGb,
    ram_free_mb: ramFreeMb,
    virtualization: virtLower !== "none" && virtLower ? virtLower : null,
    is_virtual: isVirtual,
  };

  // Interfacce di rete (ip addr)
  const ipOutput = await exec("ip addr 2>/dev/null || ifconfig -a 2>/dev/null");
  if (ipOutput) {
    const adapters = parseLinuxNetworkInterfaces(ipOutput);
    if (adapters.length > 0) result.network_adapters = adapters;
  }

  // Filesystem (df)
  const dfOutput = await exec("df -h -T 2>/dev/null | grep -vE 'tmpfs|devtmpfs|^Filesystem' | head -20");
  if (dfOutput) {
    const disks = parseLinuxDf(dfOutput);
    if (disks.length > 0) result.disks = disks;
  }

  // Servizi in esecuzione (systemctl)
  const svcOutput = await exec("systemctl list-units --type=service --state=running --no-pager 2>/dev/null | head -25");
  if (svcOutput && svcOutput.includes("loaded")) {
    const services = parseLinuxServices(svcOutput);
    if (services.length > 0) result.important_services = services;
  }

  // Utenti con shell (passwd)
  const passwdOutput = await exec("cat /etc/passwd 2>/dev/null | grep -vE 'nologin|/bin/false'");
  if (passwdOutput) {
    const users = parseLinuxUsers(passwdOutput);
    if (users.length > 0) result.local_users = users;
  }

  return result;
}

function parseLinuxNetworkInterfaces(output: string): Array<{ name: string; mac?: string; ips?: string[] }> {
  const adapters: Array<{ name: string; mac?: string; ips?: string[] }> = [];
  let current: { name: string; mac?: string; ips?: string[] } | null = null;

  for (const line of output.split("\n")) {
    const newIfMatch = line.match(/^\d+:\s*(\S+)/);
    if (newIfMatch) {
      if (current?.name) adapters.push(current);
      current = { name: newIfMatch[1].replace(/@.*$/, "") };
    } else if (current) {
      const macMatch = line.match(/link\/ether\s+([0-9a-f:]+)/i);
      if (macMatch) current.mac = macMatch[1];
      const inetMatch = line.match(/inet\s+([\d.]+)/);
      if (inetMatch) {
        current.ips = current.ips || [];
        if (!current.ips.includes(inetMatch[1])) current.ips.push(inetMatch[1]);
      }
    }
  }
  if (current?.name) adapters.push(current);
  return adapters.filter((a) => !a.name.startsWith("lo") && !a.name.startsWith("virbr"));
}

function parseSizeToGb(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const n = parseFloat(s);
  if (Number.isNaN(n)) return undefined;
  if (s.endsWith("T")) return Math.round(n * 1024 * 10) / 10;
  if (s.endsWith("G")) return Math.round(n * 10) / 10;
  if (s.endsWith("M")) return Math.round((n / 1024) * 10) / 10;
  return n;
}

function parseLinuxDf(output: string): Array<{ device: string; size_gb?: number; free_gb?: number; filesystem?: string; label?: string }> {
  const disks: Array<{ device: string; size_gb?: number; free_gb?: number; filesystem?: string; label?: string }> = [];
  for (const line of output.split("\n")) {
    const parts = line.trim().split(/\s+/);
    if (parts.length >= 7) {
      disks.push({
        device: parts[0] || "",
        size_gb: parseSizeToGb(parts[1]),
        free_gb: parseSizeToGb(parts[3]),
        filesystem: parts[2] || undefined,
        label: parts[6] || undefined,
      });
    }
  }
  return disks;
}

function parseLinuxServices(output: string): Array<{ name: string; display_name: string; state: string; start_mode: string }> {
  const services: Array<{ name: string; display_name: string; state: string; start_mode: string }> = [];
  for (const line of output.split("\n")) {
    if (line.includes(".service") && line.toLowerCase().includes("loaded")) {
      const m = line.match(/^\s*(\S+?)\.service/);
      if (m) {
        const name = m[1];
        const parts = line.split(/\s+/).filter(Boolean);
        const state = parts[2] || "running";
        services.push({ name, display_name: name, state, start_mode: "" });
      }
    }
  }
  return services.slice(0, 20);
}

function parseLinuxUsers(output: string): Array<{ name: string; full_name?: string; disabled?: boolean }> {
  const users: Array<{ name: string; full_name?: string; disabled?: boolean }> = [];
  for (const line of output.split("\n")) {
    const parts = line.split(":");
    if (parts.length >= 7) {
      const username = parts[0];
      const uid = parseInt(parts[2], 10);
      if (username && (uid >= 1000 || username === "root")) {
        users.push({ name: username, disabled: false });
      }
    }
  }
  return users.slice(0, 20);
}

/**
 * Recupera info da host Windows via WinRM e WMI/CIM.
 * Replica le query WMI di DADude3 (wmi_probe.py): OS, hardware, rete, dischi, servizi, utenti, antivirus.
 * Usa Get-CimInstance (CIM) con fallback a Get-WmiObject (WMI legacy).
 */
export async function getDeviceInfoFromWinrm(device: NetworkDevice): Promise<Partial<DeviceInfo>> {
  const { createWinrmClient } = await import("./winrm-client");
  const client = await createWinrmClient(device);
  try {
    // Script PowerShell in Base64 per evitare problemi di escape (stile DADude3 wmi_probe)
    const psScript = `
$ErrorActionPreference='SilentlyContinue'
$r = @{}
function q1($q){try{$x=Get-CimInstance $q -EA 0;if(-not $x){$x=Get-WmiObject $q -EA 0};$x}catch{}}
function qa($q,$lim=50){try{$arr=@();$x=if($q -match 'SELECT'){Get-CimInstance -Query $q -EA 0}else{Get-CimInstance $q -EA 0};if(-not $x){$x=if($q -match 'SELECT'){Get-WmiObject -Query $q -EA 0}else{Get-WmiObject $q -EA 0}};$i=0;foreach($o in @($x)){if($i -ge $lim){break};$arr+=$o;$i++};$arr}catch{@()}}
$os=q1 "Win32_OperatingSystem"
if($os){$r.os_name=$os.Caption;$r.os_version=$os.Version;$r.os_build=$os.BuildNumber;$r.architecture=$os.OSArchitecture;$r.os_serial=$os.SerialNumber;$r.last_boot=$os.LastBootUpTime;$r.install_date=$os.InstallDate;$r.registered_user=$os.RegisteredUser;$r.organization=$os.Organization}
$cs=q1 "Win32_ComputerSystem"
if($cs){$r.hostname=$cs.Name;$r.domain=$cs.Domain;$r.model=$cs.Model;$r.manufacturer=$cs.Manufacturer;$r.system_type=$cs.SystemType;$r.processor_count=$cs.NumberOfProcessors;$dr=$cs.DomainRole;$roles=@{0='Standalone Workstation';1='Member Workstation';2='Standalone Server';3='Member Server';4='Backup Domain Controller';5='Primary Domain Controller'};$r.domain_role=$roles[$dr];$r.is_domain_controller=($dr -ge 4);$r.is_server=($dr -ge 2);if($cs.TotalPhysicalMemory){$r.ram_total_mb=[int]($cs.TotalPhysicalMemory/1MB);$r.ram_total_gb=[math]::Round($cs.TotalPhysicalMemory/1GB,1)}}
$cpu=q1 "Win32_Processor"
if($cpu){$r.cpu_model=$cpu.Name;$r.cpu_manufacturer=$cpu.Manufacturer;$r.cpu_cores=$cpu.NumberOfCores;$r.cpu_threads=$cpu.NumberOfLogicalProcessors;$r.cpu_speed_mhz=$cpu.MaxClockSpeed}
$disks=@();$ts=0;$tf=0;foreach($d in qa "SELECT * FROM Win32_LogicalDisk WHERE DriveType=3"){$obj=@{device=$d.DeviceID;filesystem=$d.FileSystem;label=$d.VolumeName};if($d.Size){$obj.size_gb=[int]($d.Size/1GB);$ts+=$obj.size_gb};if($d.FreeSpace){$obj.free_gb=[int]($d.FreeSpace/1GB);$tf+=$obj.free_gb};$disks+=$obj};if($disks.Count){$r.disks=$disks;$r.disk_total_gb=$ts;$r.disk_free_gb=$tf}
$bios=q1 "Win32_BIOS"
if($bios){$sn=$bios.SerialNumber;if($sn -and $sn -notmatch 'To Be Filled|Default string|^$'){$r.serial_number=$sn};$r.bios_manufacturer=$bios.Manufacturer;$r.bios_version=$bios.SMBIOSBIOSVersion}
$board=q1 "Win32_BaseBoard"
if($board){if(-not $r.serial_number){$r.serial_number=$board.SerialNumber};if(-not $r.part_number){$r.part_number=$board.Product}}
$adapters=@();foreach($a in qa "SELECT * FROM Win32_NetworkAdapterConfiguration WHERE IPEnabled=True"){$obj=@{name=$a.Description;mac=$a.MACAddress;dhcp=$a.DHCPEnabled};if($a.IPAddress){$obj.ips=@($a.IPAddress)};if($a.IPSubnet){$obj.subnets=@($a.IPSubnet)};if($a.DefaultIPGateway){$obj.gateway=@($a.DefaultIPGateway)};if($a.DNSServerSearchOrder){$obj.dns=@($a.DNSServerSearchOrder)};$adapters+=$obj};if($adapters.Count){$r.network_adapters=$adapters}
$mem=@();foreach($m in qa "Win32_PhysicalMemory"){$obj=@{};if($m.Capacity){$obj.size_gb=[int]($m.Capacity/1GB)};if($m.Speed){$obj.speed_mhz=$m.Speed};if($m.Manufacturer){$obj.manufacturer=$m.Manufacturer};if($obj.Count){$mem+=$obj}};if($mem.Count){$r.memory_modules=$mem}
if($r.is_server){$roles=@();foreach($f in qa "SELECT * FROM Win32_ServerFeature WHERE ParentID=0" 20){if($f.Name){$roles+=$f.Name}};if($roles.Count){$r.server_roles=$roles}}
$svc=@();$kw=@('SQL Server','Exchange','IIS','Active Directory','DNS','DHCP','Hyper-V','Print Spooler','Windows Update','Remote Desktop');foreach($s in qa "SELECT * FROM Win32_Service WHERE State='Running'" 100){$dn=$s.DisplayName;if($kw|?{$dn -match $_}){$svc+=@{name=$s.Name;display_name=$dn;state=$s.State;start_mode=$s.StartMode}}};if($svc.Count){$r.important_services=$svc}
$users=@();foreach($u in qa "SELECT * FROM Win32_UserAccount WHERE LocalAccount=True" 20){$users+=@{name=$u.Name;full_name=$u.FullName;disabled=$u.Disabled}};if($users.Count){$r.local_users=$users}
try{$av=Get-CimInstance -Namespace root/SecurityCenter2 AntivirusProduct -EA 0;if(-not $av){$av=Get-WmiObject -Namespace root/SecurityCenter2 AntivirusProduct -EA 0};$avList=@();foreach($a in $av){$avList+=@{name=$a.displayName;state=$a.productState}};if($avList.Count){$r.antivirus=$avList}}catch{}
if($os.LastBootUpTime){try{$boot=if($os.LastBootUpTime -is [datetime]){$os.LastBootUpTime}else{[Management.ManagementDateTimeConverter]::ToDateTime($os.LastBootUpTime)};$r.uptime_days=[int]((Get-Date)-$boot).TotalDays}catch{}}
$gpu=@();foreach($v in qa "Win32_VideoController" 4){if($v.Name){$obj=@{name=$v.Name};if($v.DriverVersion){$obj.driver_version=$v.DriverVersion};if($v.AdapterRAM -and $v.AdapterRAM -gt 0){$obj.ram_gb=[math]::Round($v.AdapterRAM/1GB,1)};$gpu+=$obj}};if($gpu.Count){$r.gpu=$gpu}
try{$lic=Get-CimInstance SoftwareLicensingProduct -EA 0|?{$_.PartialProductKey -and $_.LicenseStatus -ne $null}|Select-Object -First 1;if(-not $lic){$lic=Get-WmiObject SoftwareLicensingProduct -EA 0|?{$_.PartialProductKey -and $_.LicenseStatus -ne $null}|Select-Object -First 1};if($lic){$ls=@{0='Unlicensed';1='Licensed';2='OOBGrace';3='OOTGrace';4='NonGenuineGrace';5='Notification';6='ExtendedGrace'};$r.license_status=$ls[[int]$lic.LicenseStatus];$r.license_name=$lic.Name;$r.license_partial_key=$lic.PartialProductKey}}catch{}
$hf=@();foreach($h in qa "SELECT * FROM Win32_QuickFixEngineering" 30){if($h.HotFixID){$obj=@{id=$h.HotFixID};if($h.Description){$obj.description=$h.Description};if($h.InstalledOn){$obj.installed_on=$h.InstalledOn.ToString('yyyy-MM-dd')};$hf+=$obj}};if($hf.Count){$r.installed_hotfixes=$hf}
try{$sw=@();$paths=@('HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*','HKLM:\Software\Wow6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*');$all=foreach($p in $paths){Get-ItemProperty $p -EA 0|?{$_.DisplayName}};$r.installed_software_count=$all.Count;$kw=@('SQL Server','Office','Exchange','Visual Studio','.NET Framework','Java','Python','Node','IIS','Hyper-V','VMware','Citrix','Veeam','Adobe','AutoCAD','SAP');$ks=@();foreach($s in $all){$dn=$s.DisplayName;if($kw|?{$dn -match $_}){$ks+=@{name=$dn;version=$s.DisplayVersion;publisher=$s.Publisher}}};if($ks.Count){$r.key_software=$ks|Select-Object -First 20}}catch{}
$r | ConvertTo-Json -Depth 5 -Compress
`.trim();

    const out = await client.runCommand(psScript, true);
    const text = String(out ?? "").trim();

    // Parse JSON output
    let raw: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(text);
      raw = typeof parsed === "object" && parsed !== null ? parsed : {};
    } catch {
      return parseLegacyWinrmOutput(text);
    }

    const getStr = (v: unknown): string | null =>
      v != null && typeof v === "string" && v.trim() ? v.trim() : null;
    const getNum = (v: unknown): number | null =>
      typeof v === "number" && !Number.isNaN(v) ? v : null;

    const result: Partial<DeviceInfo> = {
      sysname: getStr(raw.hostname) ?? getStr(raw.sysname) ?? null,
      sysdescr: getStr(raw.os_name) ?? null,
      model: getStr(raw.model) ?? null,
      firmware: getStr(raw.os_version) ?? null,
      serial_number: getStr(raw.serial_number) ?? getStr(raw.bios_serial) ?? null,
      part_number: getStr(raw.part_number) ?? null,
    };

    // Campi estesi (DADude3)
    result.os_name = getStr(raw.os_name);
    result.os_version = getStr(raw.os_version);
    result.os_build = getStr(raw.os_build);
    result.architecture = getStr(raw.architecture);
    result.hostname = getStr(raw.hostname);
    result.domain = getStr(raw.domain);
    result.manufacturer = getStr(raw.manufacturer);
    result.ram_total_gb = getNum(raw.ram_total_gb);
    result.cpu_model = getStr(raw.cpu_model);
    result.cpu_cores = getNum(raw.cpu_cores);
    result.cpu_threads = getNum(raw.cpu_threads);
    result.cpu_speed_mhz = getNum(raw.cpu_speed_mhz);
    result.domain_role = getStr(raw.domain_role);
    result.is_domain_controller = raw.is_domain_controller === true;
    result.is_server = raw.is_server === true;

    if (Array.isArray(raw.disks)) {
      result.disks = raw.disks.map((d: unknown) => {
        const o = d as Record<string, unknown>;
        return {
          device: String(o.device ?? ""),
          size_gb: getNum(o.size_gb) ?? undefined,
          free_gb: getNum(o.free_gb) ?? undefined,
          filesystem: getStr(o.filesystem) ?? undefined,
          label: getStr(o.label) ?? undefined,
        };
      });
    }
    if (Array.isArray(raw.network_adapters)) {
      result.network_adapters = raw.network_adapters.map((a: unknown) => {
        const o = a as Record<string, unknown>;
        return {
          name: String(o.name ?? ""),
          mac: getStr(o.mac) ?? undefined,
          ips: Array.isArray(o.ips) ? o.ips.map(String) : undefined,
          dhcp: o.dhcp === true,
        };
      });
    }
    if (Array.isArray(raw.memory_modules)) {
      result.memory_modules = raw.memory_modules.map((m: unknown) => {
        const o = m as Record<string, unknown>;
        return {
          size_gb: getNum(o.size_gb) ?? undefined,
          speed_mhz: getNum(o.speed_mhz) ?? undefined,
          manufacturer: getStr(o.manufacturer) ?? undefined,
        };
      });
    }
    if (Array.isArray(raw.server_roles)) {
      result.server_roles = raw.server_roles.map(String).filter(Boolean);
    }
    if (Array.isArray(raw.important_services)) {
      result.important_services = raw.important_services.map((s: unknown) => {
        const o = s as Record<string, unknown>;
        return {
          name: String(o.name ?? ""),
          display_name: String(o.display_name ?? ""),
          state: String(o.state ?? ""),
          start_mode: String(o.start_mode ?? ""),
        };
      });
    }
    if (Array.isArray(raw.local_users)) {
      result.local_users = raw.local_users.map((u: unknown) => {
        const o = u as Record<string, unknown>;
        return {
          name: String(o.name ?? ""),
          full_name: getStr(o.full_name) ?? undefined,
          disabled: o.disabled === true,
        };
      });
    }
    if (Array.isArray(raw.antivirus)) {
      result.antivirus = raw.antivirus.map((a: unknown) => {
        const o = a as Record<string, unknown>;
        return {
          name: String(o.name ?? ""),
          state: getStr(o.state) ?? undefined,
        };
      });
    }

    // #region agent log
    fetch('http://127.0.0.1:7630/ingest/d99436e5-32dc-4da5-8bde-3d69579c9980',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'a53ed4'},body:JSON.stringify({sessionId:'a53ed4',location:'device-info.ts:parser',message:'raw WMI fields',data:{install_date:raw.install_date,last_boot:raw.last_boot,uptime_days:raw.uptime_days,license_status:raw.license_status,license_name:raw.license_name,license_partial_key:raw.license_partial_key,gpu:raw.gpu,installed_hotfixes_count:Array.isArray(raw.installed_hotfixes)?raw.installed_hotfixes.length:0,installed_software_count:raw.installed_software_count,key_software_count:Array.isArray(raw.key_software)?raw.key_software.length:0},timestamp:Date.now(),hypothesisId:'H1-H3-H4'})}).catch(()=>{});
    // #endregion
    // Campi sistema estesi
    result.system_type = getStr(raw.system_type);
    result.os_serial = getStr(raw.os_serial);
    result.registered_user = getStr(raw.registered_user);
    result.organization = getStr(raw.organization);
    const parseWmiDate = (v: unknown): string | null => {
      if (v == null) return null;
      const s = String(v);
      const m = s.match(/\/Date\((\d+)\)\//);
      if (m) return new Date(Number(m[1])).toISOString();
      if (/^\d{14}/.test(s)) {
        const y = s.slice(0,4), mo = s.slice(4,6), d = s.slice(6,8), h = s.slice(8,10), mi = s.slice(10,12), se = s.slice(12,14);
        return `${y}-${mo}-${d}T${h}:${mi}:${se}`;
      }
      return s;
    };
    result.install_date = parseWmiDate(raw.install_date);
    result.last_boot = parseWmiDate(raw.last_boot);
    // #region agent log
    fetch('http://127.0.0.1:7630/ingest/d99436e5-32dc-4da5-8bde-3d69579c9980',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'a53ed4'},body:JSON.stringify({sessionId:'a53ed4',location:'device-info.ts:parsed-dates',message:'after parseWmiDate',data:{install_date_raw:raw.install_date,install_date_parsed:result.install_date,last_boot_raw:raw.last_boot,last_boot_parsed:result.last_boot},timestamp:Date.now(),hypothesisId:'H1'})}).catch(()=>{});
    // #endregion
    result.uptime_days = getNum(raw.uptime_days);
    result.bios_version = getStr(raw.bios_version);
    result.bios_manufacturer = getStr(raw.bios_manufacturer);

    // HW aggiuntivo
    result.cpu_manufacturer = getStr(raw.cpu_manufacturer);
    result.processor_count = getNum(raw.processor_count);
    result.ram_total_mb = getNum(raw.ram_total_mb);
    result.disk_total_gb = getNum(raw.disk_total_gb);
    result.disk_free_gb = getNum(raw.disk_free_gb);
    if (Array.isArray(raw.gpu)) {
      result.gpu = raw.gpu.map((g: unknown) => {
        const o = g as Record<string, unknown>;
        return {
          name: String(o.name ?? ""),
          driver_version: getStr(o.driver_version) ?? undefined,
          ram_gb: getNum(o.ram_gb) ?? undefined,
        };
      });
    }

    // Licenza
    result.license_status = getStr(raw.license_status);
    result.license_name = getStr(raw.license_name);
    result.license_partial_key = getStr(raw.license_partial_key);

    // Hotfix
    if (Array.isArray(raw.installed_hotfixes)) {
      result.installed_hotfixes = raw.installed_hotfixes.map((h: unknown) => {
        const o = h as Record<string, unknown>;
        return {
          id: String(o.id ?? ""),
          description: getStr(o.description) ?? undefined,
          installed_on: getStr(o.installed_on) ?? undefined,
        };
      });
    }
    result.pending_updates_count = getNum(raw.pending_updates_count);

    // Software
    result.installed_software_count = getNum(raw.installed_software_count);
    if (Array.isArray(raw.key_software)) {
      result.key_software = raw.key_software.map((s: unknown) => {
        const o = s as Record<string, unknown>;
        return {
          name: String(o.name ?? ""),
          version: getStr(o.version) ?? undefined,
          publisher: getStr(o.publisher) ?? undefined,
        };
      });
    }

    const parts = [result.model, result.sysdescr].filter(Boolean);
    result.sysdescr = parts.length > 0 ? parts.join(" | ") : result.sysdescr;
    return result;
  } catch {
    return {};
  }
}

/** Fallback: parse output formato legacy chiave:valore */
function parseLegacyWinrmOutput(text: string): Partial<DeviceInfo> {
  const result: Partial<DeviceInfo> = { sysname: null, sysdescr: null, model: null, firmware: null, serial_number: null, part_number: null };
  for (const line of text.split("\n")) {
    const m = line.trim().match(/^([A-Z_]+):(.+)$/);
    if (!m) continue;
    const [, key, val] = m;
    const v = val?.trim() || null;
    if (!v) continue;
    switch (key) {
      case "SYSNAME": result.sysname = v; break;
      case "MODEL": result.model = v; break;
      case "OS_CAPTION": result.sysdescr = v; break;
      case "OS_VERSION": result.firmware = v; break;
      case "BIOS_SERIAL": result.serial_number = result.serial_number || v; break;
      case "BOARD_SERIAL": result.part_number = result.part_number || v; break;
      case "BOARD_PRODUCT": if (!result.part_number) result.part_number = v; break;
      default: break;
    }
  }
  const parts = [result.model, result.sysdescr].filter(Boolean);
  result.sysdescr = parts.length > 0 ? parts.join(" | ") : null;
  return result;
}

/**
 * Combina SNMP e SSH per ottenere info complete.
 * Prova SNMP se disponibile (community o protocollo SNMP), poi SSH per model/firmware.
 */
export async function getDeviceInfo(device: NetworkDevice): Promise<DeviceInfo> {
  let result: DeviceInfo = { sysname: null, sysdescr: null, model: null, firmware: null, serial_number: null, part_number: null };

  const hasSnmp = device.community_string || device.protocol === "snmp_v2" || device.protocol === "snmp_v3"
    || (device.snmp_credential_id ? !!getCredentialCommunityString(device.snmp_credential_id) : false)
    || (device.credential_id ? !!getCredentialCommunityString(device.credential_id) : false);
  const hasSsh = device.protocol === "ssh" && (device.username || getDeviceCredentials(device)?.username);
  const hasWinrm = device.protocol === "winrm" || device.vendor === "windows";

  if (hasWinrm) {
    try {
      const winrmInfo = await getDeviceInfoFromWinrm(device);
      result = { ...result, ...winrmInfo };
    } catch { /* WinRM info opzionale */ }
  }

  if (hasSnmp) {
    const snmpInfo = await getDeviceInfoFromSnmp(device);
    result = { ...result, ...snmpInfo };
  }

  if (hasSsh) {
    const sshInfo = await getDeviceInfoFromSsh(device);
    result = {
      sysname: sshInfo.sysname ?? result.sysname,
      sysdescr: sshInfo.sysdescr ?? result.sysdescr,
      model: sshInfo.model ?? result.model,
      firmware: sshInfo.firmware ?? result.firmware,
      serial_number: sshInfo.serial_number ?? result.serial_number,
      part_number: sshInfo.part_number ?? result.part_number,
    };
  }

  return result;
}
