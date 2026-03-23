/**
 * Recupera informazioni sul dispositivo via SNMP e SSH.
 * SNMP: sysName, sysDescr (standard MIB-2)
 * SSH: comandi vendor-specific per model, firmware
 */

import type { NetworkDevice } from "@/types";
import {
  getDeviceCredentials,
  getDeviceCommunityString,
  getDeviceSnmpV3Credentials,
  getCredentialCommunityString,
  getEffectiveSnmpPort,
} from "@/lib/db";
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
  /** Dischi fisici (Win32_DiskDrive / lsblk -d) — modello, seriale, interfaccia */
  physical_disks?: Array<{ device: string; model?: string; size_gb?: number; serial?: string; interface_type?: string; vendor?: string; rotational?: boolean }>;
  /** Numero pacchetti installati (dpkg/rpm su Linux; installed_software_count per Windows) */
  packages_count?: number | null;
  /** Host è membro di un dominio AD/Kerberos */
  domain_joined?: boolean;
  /** Ultimo utente che ha effettuato il login (da registro Windows) */
  last_logged_on_user?: string | null;
  /** Sessioni attive (console + RDP) */
  logged_on_users?: Array<{
    username: string;
    session_type?: string;
    logon_time?: string;
  }>;
  /** Profili utente presenti sul sistema + dati AD */
  user_profiles?: Array<{
    username: string;
    sid?: string;
    profile_path?: string;
    loaded?: boolean;
    last_use?: string;
    ad_display_name?: string;
    ad_email?: string;
    ad_department?: string;
    ad_title?: string;
    ad_enabled?: boolean;
    ad_last_logon?: string;
  }>;
  /** Inventario NAS Synology/QNAP (SNMP + SSH) */
  nas_inventory?: NasInventorySnapshot;
  /** Linux: porte TCP/UDP in ascolto (da ss -tlnp / ss -ulnp) */
  listening_ports?: Array<{
    port: number;
    protocol: "tcp" | "udp";
    process?: string;
    bind_address?: string;
  }>;
  /** Linux: stato firewall */
  firewall_active?: boolean;
  firewall_type?: "iptables" | "nftables" | "ufw" | null;
  firewall_rules_count?: number | null;
  /** Linux: cron jobs attivi */
  cron_jobs?: Array<{ user: string; schedule: string; command: string }>;
  /** MikroTik: conteggio regole firewall (filter + nat + mangle) */
  firewall_filter_count?: number | null;
  firewall_nat_count?: number | null;
  firewall_mangle_count?: number | null;
}

/** Snapshot strutturato per Synology / QNAP (serializzato in last_device_info_json) */
export interface NasInventorySnapshot {
  vendor: "synology" | "qnap";
  sources: ("snmp" | "ssh")[];
  snmp?: {
    temperature_c?: number | null;
    cpu_temperature_c?: number | null;
    system_status?: string | null;
    disks?: Array<{
      index?: string;
      id?: string;
      model?: string;
      type?: string;
      status?: string;
      temperature_c?: number | null;
      serial?: string;
      capacity_gb?: number | null;
      slot?: string;
      smart_health?: string;
    }>;
    raids?: Array<{
      index?: string;
      name?: string;
      status?: string;
      free_gb?: number | null;
      total_gb?: number | null;
    }>;
    volumes_snmp?: Array<{
      name?: string;
      size_gb?: number | null;
      free_gb?: number | null;
      status?: string | null;
      raid_type?: string | null;
    }>;
    storage_pools?: Array<{
      name?: string;
      status?: string | null;
      total_gb?: number | null;
      used_gb?: number | null;
    }>;
    volume_io?: Array<{ name?: string; read_bps?: string | null; write_bps?: string | null }>;
    ups?: { status?: string | null; battery_pct?: string | null };
    services?: Array<{ name?: string; state?: string | null }>;
    qts5_pool_rows?: number;
  };
  ssh?: {
    mdstat_summary?: string;
    cpu_model?: string | null;
    kernel?: string | null;
    synology_shares_preview?: string;
    synology_packages_count?: number | null;
    synology_storage_lines?: string;
    synology_temperature_lines?: string;
    qnap_raid_info_preview?: string;
    qnap_storage_cfg_preview?: string;
    qnap_qpkg_preview?: string;
  };
}

/**
 * Riconosce un NAS Synology/QNAP da vendor o da classification.
 * Se il vendor è ancora "generic" ma la classificazione è nas_synology / nas_qnap,
 * i percorsi SNMP/SSH NAS devono comunque attivarsi.
 */
export function resolveNasKind(device: NetworkDevice): "synology" | "qnap" | null {
  const v = (device.vendor ?? "").toLowerCase();
  if (v === "synology") return "synology";
  if (v === "qnap") return "qnap";
  const c = device.classification ?? "";
  if (c === "nas_synology") return "synology";
  if (c === "nas_qnap") return "qnap";
  return null;
}

/** Almeno un campo “inventario” utile per query WinRM/SNMP/SSH. */
function deviceInfoHasAnyData(r: DeviceInfo | Partial<DeviceInfo>): boolean {
  return !!(
    r.sysname ||
    r.sysdescr ||
    r.model ||
    r.firmware ||
    r.serial_number ||
    r.part_number ||
    r.os_name ||
    r.hostname
  );
}

/**
 * Recupera sysName e sysDescr via SNMP (MIB-2).
 * Usato per dispositivi con community_string o protocollo SNMP.
 */
export async function getDeviceInfoFromSnmp(device: NetworkDevice): Promise<DeviceInfo> {
  const isSnmpProtocol = device.protocol === "snmp_v2" || device.protocol === "snmp_v3";
  const snmpPort = isSnmpProtocol ? getEffectiveSnmpPort(device) : 161;
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

    const emptySnmp: DeviceInfo = {
      sysname: null,
      sysdescr: null,
      model: null,
      firmware: null,
      serial_number: null,
      part_number: null,
    };

    return new Promise((resolve) => {
      let settled = false;
      const safeClose = (): void => {
        try {
          session.close();
        } catch {
          /* Timeout e callback possono entrambi chiudere; net-snmp lancia ERR_SOCKET_DGRAM_NOT_RUNNING se il socket è già spento */
        }
      };
      const finish = (info: DeviceInfo): void => {
        if (settled) return;
        settled = true;
        clearTimeout(t);
        safeClose();
        resolve(info);
      };

      const t = setTimeout(() => {
        finish(emptySnmp);
      }, 8000);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (session as any).get(oids, (error: Error | null, varbinds: Array<{ oid: string; value: Buffer | string | number }>) => {
        if (settled) return;
        clearTimeout(t);
        if (error) {
          finish(emptySnmp);
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
        finish({ sysname, sysdescr, model, firmware: null, serial_number, part_number });
      });
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

  // Se il protocollo primario è SNMP, la porta configurata è quella SNMP (161): usa 22 per SSH
  const sshPort = (device.protocol === "snmp_v2" || device.protocol === "snmp_v3") ? 22 : (device.port || 22);
  const opts = {
    host: device.host,
    port: sshPort,
    username,
    password,
    timeout: 15000,
  };

  try {
    const nasKindSsh = resolveNasKind(device);
    if (nasKindSsh) {
      const { getNasDeviceInfoFromSsh } = await import("./nas-acquisition");
      return getNasDeviceInfoFromSsh(device, nasKindSsh);
    }

    if (device.vendor === "stormshield") {
      const r = await sshExec(opts, "show version 2>/dev/null; get system status 2>/dev/null; display version 2>/dev/null").catch(() => ({
        stdout: "",
      }));
      const serial =
        r.stdout.match(/serial\s*(?:number|#)?\s*[:#]\s*(\S+)/i)?.[1]?.trim()
        || r.stdout.match(/\bSerial\s*:\s*(\S+)/i)?.[1]?.trim()
        || r.stdout.match(/SerialNumber\s*=\s*(\S+)/i)?.[1]?.trim();
      const model = r.stdout.match(/(?:model|appliance|product)\s*[:#]\s*(.+)/i)?.[1]?.trim();
      const fw = r.stdout.match(/(?:firmware|version|Software)\s*[:#]\s*([^\n]+)/i)?.[1]?.trim();
      const name = r.stdout.match(/(?:hostname|Name)\s*[:#]\s*(\S+)/i)?.[1]?.trim();
      return {
        serial_number: serial || null,
        model: model || null,
        firmware: fw || null,
        sysname: name || null,
      };
    }

    if (device.vendor === "omada") {
      const [ver, serialOut, hn] = await Promise.all([
        sshExec(opts, "cat /etc/version 2>/dev/null || head -2 /etc/os-release 2>/dev/null").catch(() => ({ stdout: "" })),
        sshExec(opts, "cat /sys/class/dmi/id/product_serial 2>/dev/null; cat /sys/class/dmi/id/board_serial 2>/dev/null; dmidecode -s system-serial-number 2>/dev/null").catch(() => ({ stdout: "" })),
        sshExec(opts, "hostname 2>/dev/null").catch(() => ({ stdout: "" })),
      ]);
      const { isPlausibleHardwareSerial } = await import("@/lib/hardware-serial");
      let serial: string | null = null;
      for (const line of serialOut.stdout.split("\n")) {
        const t = line.trim();
        if (t && isPlausibleHardwareSerial(t)) {
          serial = t;
          break;
        }
      }
      const model = await sshExec(opts, "cat /sys/class/dmi/id/product_name 2>/dev/null").then((x) => x.stdout.trim() || null).catch(() => null);
      return {
        sysname: hn.stdout.trim() || null,
        firmware: ver.stdout.trim() || null,
        model: model || null,
        serial_number: serial,
      };
    }

    if (device.vendor === "mikrotik") {
      const r = await sshExec(opts, '/system resource print');
      const board = r.stdout.match(/board-name:\s*(.+)/)?.[1]?.trim();
      const version = r.stdout.match(/version:\s*(.+)/)?.[1]?.trim();
      const serial = r.stdout.match(/serial-number:\s*(.+)/)?.[1]?.trim();
      const [identity, rbInfo, fwFilter, fwNat, fwMangle] = await Promise.all([
        sshExec(opts, '/system identity print').then((x) => x.stdout.match(/name:\s*(.+)/)?.[1]?.trim()).catch(() => undefined),
        sshExec(opts, '/system routerboard print').catch(() => ({ stdout: "" })),
        sshExec(opts, '/ip firewall filter print count-only').then((x) => parseInt(x.stdout.trim(), 10)).catch(() => NaN),
        sshExec(opts, '/ip firewall nat print count-only').then((x) => parseInt(x.stdout.trim(), 10)).catch(() => NaN),
        sshExec(opts, '/ip firewall mangle print count-only').then((x) => parseInt(x.stdout.trim(), 10)).catch(() => NaN),
      ]);
      const partNumber = rbInfo.stdout.match(/model:\s*(.+)/i)?.[1]?.trim();
      return {
        model: board || null,
        firmware: version || null,
        sysname: identity || null,
        serial_number: serial || null,
        part_number: partNumber || null,
        firewall_filter_count: !Number.isNaN(fwFilter) ? fwFilter : null,
        firewall_nat_count: !Number.isNaN(fwNat) ? fwNat : null,
        firewall_mangle_count: !Number.isNaN(fwMangle) ? fwMangle : null,
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
      const exec = (cmd: string) => sshExec(opts, cmd).then((x) => x.stdout).catch(() => "");
      const [versionOut, boardInfo, serialRaw, showVersion, uptimeOut, cpuOut, memOut, hostnameOut] = await Promise.all([
        exec("cat /etc/version 2>/dev/null || cat /tmp/version 2>/dev/null"),
        exec("cat /etc/board.info 2>/dev/null"),
        exec("sh -c 'cat /sys/class/dmi/id/product_serial 2>/dev/null; cat /sys/class/dmi/id/board_serial 2>/dev/null; command -v ubntbox >/dev/null 2>&1 && ubntbox mca-status 2>/dev/null | head -80'"),
        exec("show version 2>/dev/null"),
        exec("uptime 2>/dev/null"),
        exec("grep -c processor /proc/cpuinfo 2>/dev/null"),
        exec("grep MemTotal /proc/meminfo 2>/dev/null | awk '{print $2}'"),
        exec("hostname 2>/dev/null"),
      ]);

      const version = versionOut.trim() || null;
      const fwModel = versionOut.match(/^(U[^\s]+)/)?.[1] || null;

      // board.info: board.name=, board.hwid=, board.serial=
      const boardName = boardInfo.match(/board\.name=(.+)/)?.[1]?.trim();
      const boardHwId = boardInfo.match(/board\.hwid=(.+)/)?.[1]?.trim();
      const boardSerial = boardInfo.match(/board\.serial=(.+)/)?.[1]?.trim();

      // show version (EdgeOS): HW/SW model, uptime, etc.
      const edgeModel = showVersion.match(/HW model:\s*(.+)/i)?.[1]?.trim()
        || showVersion.match(/Version:\s*(.+)/i)?.[1]?.trim();

      const { isPlausibleHardwareSerial } = await import("@/lib/hardware-serial");
      let serial_number: string | null = boardSerial || null;
      if (!serial_number) {
        for (const line of serialRaw.split("\n")) {
          const t = line.trim();
          const m = t.match(/(?:serial|SerialNo|serialNo|board\.serial)[\s:=#]+([^\s,]+)/i);
          if (m?.[1] && isPlausibleHardwareSerial(m[1])) { serial_number = m[1]; break; }
          if (t && isPlausibleHardwareSerial(t) && /[0-9A-Z]{4,}/i.test(t)) { serial_number = t; break; }
        }
      }

      const ramKb = parseInt(memOut.trim(), 10);
      const ramTotalGb = !Number.isNaN(ramKb) ? Math.round((ramKb / (1024 * 1024)) * 10) / 10 : null;
      const cpuCores = parseInt(cpuOut.trim(), 10);

      return {
        model: boardName || edgeModel || fwModel || null,
        firmware: version || null,
        serial_number,
        sysname: hostnameOut.trim() || null,
        hostname: hostnameOut.trim() || null,
        part_number: boardHwId || null,
        uptime: uptimeOut.trim() || null,
        ram_total_gb: ramTotalGb,
        cpu_cores: !Number.isNaN(cpuCores) ? cpuCores : null,
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
    const st = (device as { scan_target?: string | null }).scan_target;
    if (device.vendor === "linux" || device.vendor === "other" || st === "linux") {
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
 * Raccoglie: sistema, hardware (CPU completo, BIOS, RAM moduli, dischi fisici),
 * interfacce, filesystem, servizi, utenti, pacchetti, dominio.
 */
async function getDeviceInfoFromLinux(opts: SshOpts): Promise<Partial<DeviceInfo>> {
  const exec = (cmd: string) => sshExec(opts, cmd).then((r) => r.stdout).catch(() => "");
  const execSudo = (cmd: string) => sshExec(opts, `sudo ${cmd} 2>/dev/null`).then((r) => r.stdout).catch(() => "");

  // Esecuzione parallela dei comandi base + nuovi
  const [
    hostname,
    osRelease,
    kernel,
    arch,
    uptime,
    load,
    cpuInfo,
    lscpuOut,
    memTotal,
    memAvail,
    sysProduct,
    sysSerial,
    sysVendor,
    dmiProduct,
    dmiSerial,
    dmiVendor,
    virt,
    lastBoot,
    biosVersion,
    biosVendor,
    boardProduct,
  ] = await Promise.all([
    exec("hostname 2>/dev/null"),
    exec("cat /etc/os-release 2>/dev/null"),
    exec("uname -r 2>/dev/null"),
    exec("uname -m 2>/dev/null"),
    exec("uptime -p 2>/dev/null || uptime 2>/dev/null"),
    exec("cat /proc/loadavg 2>/dev/null"),
    exec("grep -m1 'model name' /proc/cpuinfo 2>/dev/null | cut -d: -f2"),
    exec("lscpu 2>/dev/null"),
    exec("grep MemTotal /proc/meminfo 2>/dev/null | awk '{print $2}'"),
    exec("grep MemAvailable /proc/meminfo 2>/dev/null | awk '{print $2}'"),
    exec("cat /sys/class/dmi/id/product_name 2>/dev/null"),
    exec("cat /sys/class/dmi/id/product_serial 2>/dev/null"),
    exec("cat /sys/class/dmi/id/sys_vendor 2>/dev/null"),
    execSudo("dmidecode -s system-product-name 2>/dev/null"),
    execSudo("dmidecode -s system-serial-number 2>/dev/null"),
    execSudo("dmidecode -s system-manufacturer 2>/dev/null"),
    exec("systemd-detect-virt 2>/dev/null || echo none"),
    exec("uptime -s 2>/dev/null"),
    execSudo("dmidecode -s bios-version 2>/dev/null"),
    execSudo("dmidecode -s bios-vendor 2>/dev/null"),
    execSudo("dmidecode -s baseboard-product-name 2>/dev/null"),
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
  const validSerial = serial && !["Not Specified", "None", "To Be Filled", "ToBeFilledByO.E.M."].includes(serial);

  // CPU dettagliato da lscpu
  const lscpuLine = (key: string): string | null =>
    lscpuOut.match(new RegExp(`^${key}\\s*:\\s*(.+)`, "mi"))?.[1]?.trim() ?? null;
  const threadsPerCore = parseInt(lscpuLine("Thread\\(s\\) per core") ?? "0", 10);
  const coresPerSocket = parseInt(lscpuLine("Core\\(s\\) per socket") ?? "0", 10);
  const sockets = parseInt(lscpuLine("Socket\\(s\\)") ?? "1", 10);
  const cpuThreads = threadsPerCore > 0 && coresPerSocket > 0 ? threadsPerCore * coresPerSocket * sockets : null;
  const cpuCores = coresPerSocket > 0 && sockets > 0 ? coresPerSocket * sockets : null;
  const cpuSpeedStr = lscpuLine("CPU max MHz") ?? lscpuLine("CPU MHz");
  const cpuSpeedMhz = cpuSpeedStr ? Math.round(parseFloat(cpuSpeedStr)) : null;
  const cpuVendorId = lscpuLine("Vendor ID");
  const cpuManufacturer = cpuVendorId
    ? cpuVendorId.replace("GenuineIntel", "Intel").replace("AuthenticAMD", "AMD")
    : null;
  const cpuModelFromLscpu = lscpuLine("Model name");
  const cpuModel = (cpuInfo?.trim() || cpuModelFromLscpu || "").trim() || null;

  // Numero CPU fisiche (socket) da lscpu
  const processorCount = sockets > 0 ? sockets : null;

  // BIOS e board
  const biosVer = biosVersion.trim().replace(/Not Specified|Unknown/gi, "").trim() || null;
  const biosMan = biosVendor.trim().replace(/Not Specified|Unknown/gi, "").trim() || null;
  const partNum = boardProduct.trim().replace(/Not Specified|Unknown/gi, "").trim() || null;

  // Ultimo boot (uptime -s → "2025-03-20 09:14:00")
  const lastBootStr = lastBoot.trim() || null;

  const result: Partial<DeviceInfo> = {
    sysname: hostname.trim() || null,
    hostname: hostname.trim() || null,
    model: hwProduct.trim() || hwManufacturer.trim() || null,
    firmware: osVersion || prettyName || null,
    sysdescr: prettyName || osName || null,
    serial_number: validSerial ? serial : null,
    part_number: partNum,
    manufacturer: hwManufacturer.trim() || null,
    os_name: osName || prettyName || null,
    os_version: osVersion || null,
    kernel_version: kernel.trim() || null,
    architecture: arch.trim() || null,
    uptime: uptime.trim() || null,
    last_boot: lastBootStr,
    load_average: load.trim() ? load.trim().split(/\s+/).slice(0, 3).join(", ") : null,
    cpu_model: cpuModel || null,
    cpu_cores: cpuCores ?? (lscpuOut ? null : null),
    cpu_threads: cpuThreads,
    cpu_speed_mhz: !Number.isNaN(cpuSpeedMhz ?? NaN) ? cpuSpeedMhz : null,
    cpu_manufacturer: cpuManufacturer,
    processor_count: processorCount,
    bios_version: biosVer,
    bios_manufacturer: biosMan,
    ram_total_gb: ramTotalGb,
    ram_free_mb: ramFreeMb,
    virtualization: virtLower !== "none" && virtLower ? virtLower : null,
    is_virtual: isVirtual,
  };

  // Se lscpu non ha fornito cores, fallback a nproc
  if (!result.cpu_cores) {
    const nproc = await exec("nproc 2>/dev/null || grep -c processor /proc/cpuinfo 2>/dev/null");
    result.cpu_cores = nproc && /^\d+$/.test(nproc.trim()) ? parseInt(nproc.trim(), 10) : null;
  }

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

  // Dischi fisici (lsblk)
  const lsblkOut = await exec("lsblk -d -o NAME,SIZE,MODEL,SERIAL,VENDOR,ROTA,TRAN --noheadings 2>/dev/null | grep -v loop");
  if (lsblkOut.trim()) {
    const physDisks = parseLinuxPhysicalDisks(lsblkOut);
    if (physDisks.length > 0) result.physical_disks = physDisks;
  }

  // Moduli RAM (dmidecode --type 17)
  const dmiMemOut = await execSudo("dmidecode --type 17 2>/dev/null");
  if (dmiMemOut && dmiMemOut.includes("Memory Device")) {
    const memModules = parseLinuxDmidecodeMemory(dmiMemOut);
    if (memModules.length > 0) result.memory_modules = memModules;
  }

  // Servizi in esecuzione (systemctl)
  const svcOutput = await exec("systemctl list-units --type=service --state=running --no-pager 2>/dev/null | head -30");
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

  // Dominio AD/Kerberos (realm/sssd/winbind)
  const realmOut = await exec("realm list 2>/dev/null | grep -i 'domain-name\\|realm-name' | head -2");
  if (realmOut.trim()) {
    result.domain_joined = true;
    const domMatch = realmOut.match(/(?:domain-name|realm-name)\s*:\s*(.+)/i);
    if (domMatch) result.domain = domMatch[1].trim();
  } else {
    const domainname = await exec("domainname 2>/dev/null");
    const dn = domainname.trim();
    if (dn && dn !== "(none)" && dn !== "localdomain") {
      result.domain_joined = true;
      result.domain = dn;
    }
  }

  // Conteggio pacchetti installati
  const pkgCount = await exec(
    "dpkg -l 2>/dev/null | grep -c '^ii' || rpm -qa 2>/dev/null | wc -l || apk info 2>/dev/null | wc -l || echo 0"
  );
  const pkgNum = parseInt(pkgCount.trim().split("\n")[0] ?? "0", 10);
  if (!Number.isNaN(pkgNum) && pkgNum > 0) result.packages_count = pkgNum;

  // Porte in ascolto (ss -tlnp + ss -ulnp)
  const [ssTcp, ssUdp] = await Promise.all([
    exec("ss -tlnp 2>/dev/null | tail -n +2 | head -50"),
    exec("ss -ulnp 2>/dev/null | tail -n +2 | head -30"),
  ]);
  const listeningPorts = parseListeningPorts(ssTcp, "tcp").concat(parseListeningPorts(ssUdp, "udp"));
  if (listeningPorts.length > 0) result.listening_ports = listeningPorts;

  // Firewall status (ufw → iptables → nftables)
  const ufwStatus = await exec("ufw status 2>/dev/null");
  if (ufwStatus.includes("Status: active")) {
    result.firewall_active = true;
    result.firewall_type = "ufw";
    const ufwRules = await exec("ufw status numbered 2>/dev/null | grep -c '^\\[' || echo 0");
    result.firewall_rules_count = parseInt(ufwRules.trim(), 10) || null;
  } else {
    // nftables prima di iptables (nft è il backend moderno)
    const nftCount = await exec("nft list ruleset 2>/dev/null | grep -c 'rule' || echo 0");
    const nftNum = parseInt(nftCount.trim(), 10);
    if (nftNum > 0) {
      result.firewall_active = true;
      result.firewall_type = "nftables";
      result.firewall_rules_count = nftNum;
    } else {
      const iptCount = await exec("iptables -L -n 2>/dev/null | grep -cE '^(ACCEPT|DROP|REJECT|LOG)' || echo 0");
      const iptNum = parseInt(iptCount.trim(), 10);
      if (iptNum > 0) {
        result.firewall_active = true;
        result.firewall_type = "iptables";
        result.firewall_rules_count = iptNum;
      } else {
        result.firewall_active = false;
      }
    }
  }

  // Cron jobs (utenti con shell + system crontabs)
  const cronOut = await exec(
    "for u in $(cut -f1 -d: /etc/passwd 2>/dev/null); do crontab -l -u $u 2>/dev/null | grep -v '^#\\|^$' | while read -r line; do echo \"$u|$line\"; done; done | head -30"
  );
  const systemCron = await exec(
    "cat /etc/crontab 2>/dev/null | grep -vE '^#|^$|^SHELL|^MAILTO|^PATH|^HOME' | head -20"
  );
  const cronJobs = parseLinuxCronJobs(cronOut, systemCron);
  if (cronJobs.length > 0) result.cron_jobs = cronJobs;

  return result;
}

function parseLinuxPhysicalDisks(
  output: string
): Array<{ device: string; model?: string; size_gb?: number; serial?: string; interface_type?: string; vendor?: string; rotational?: boolean }> {
  const disks: Array<{ device: string; model?: string; size_gb?: number; serial?: string; interface_type?: string; vendor?: string; rotational?: boolean }> = [];
  for (const line of output.split("\n")) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 2 || !parts[0]) continue;
    const [name, sizeStr, model, serial, vendor, rotaStr, tran] = parts;
    const sizeNum = parseFloat(sizeStr ?? "");
    let sizeGb: number | undefined;
    if (!Number.isNaN(sizeNum) && sizeStr) {
      if (sizeStr.endsWith("T")) sizeGb = Math.round(sizeNum * 1024);
      else if (sizeStr.endsWith("G")) sizeGb = Math.round(sizeNum);
      else if (sizeStr.endsWith("M")) sizeGb = Math.round(sizeNum / 1024);
    }
    disks.push({
      device: `/dev/${name}`,
      model: model && model !== "" ? model.replace(/_/g, " ").trim() : undefined,
      size_gb: sizeGb,
      serial: serial && serial !== "" ? serial : undefined,
      vendor: vendor && vendor !== "" ? vendor.trim() : undefined,
      interface_type: tran && tran !== "" ? tran.toUpperCase() : undefined,
      rotational: rotaStr === "1" ? true : rotaStr === "0" ? false : undefined,
    });
  }
  return disks;
}

function parseLinuxDmidecodeMemory(
  output: string
): Array<{ size_gb?: number; speed_mhz?: number; manufacturer?: string }> {
  const modules: Array<{ size_gb?: number; speed_mhz?: number; manufacturer?: string }> = [];
  const blocks = output.split(/\n\s*\n/);
  for (const block of blocks) {
    if (!block.includes("Memory Device")) continue;
    const sizeLine = block.match(/^\s*Size:\s*(.+)/m)?.[1]?.trim();
    if (!sizeLine || sizeLine === "No Module Installed" || sizeLine === "Unknown") continue;
    const sizeMatch = sizeLine.match(/^(\d+)\s*(MB|GB)/i);
    let sizeGb: number | undefined;
    if (sizeMatch) {
      const n = parseInt(sizeMatch[1], 10);
      sizeGb = sizeMatch[2].toUpperCase() === "GB" ? n : Math.round(n / 1024);
    }
    const speedLine = block.match(/^\s*Speed:\s*(.+)/m)?.[1]?.trim();
    const speedMatch = speedLine?.match(/(\d+)\s*(?:MT\/s|MHz)/i);
    const speedMhz = speedMatch ? parseInt(speedMatch[1], 10) : undefined;
    const mfr = block.match(/^\s*Manufacturer:\s*(.+)/m)?.[1]?.trim();
    const manufacturer = mfr && mfr !== "Unknown" && mfr !== "Not Specified" ? mfr : undefined;
    modules.push({ size_gb: sizeGb, speed_mhz: speedMhz, manufacturer });
  }
  return modules;
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

/** Parsing output di ss -tlnp / ss -ulnp per porte in ascolto */
function parseListeningPorts(
  output: string,
  proto: "tcp" | "udp"
): Array<{ port: number; protocol: "tcp" | "udp"; process?: string; bind_address?: string }> {
  const ports: Array<{ port: number; protocol: "tcp" | "udp"; process?: string; bind_address?: string }> = [];
  for (const line of output.split("\n")) {
    if (!line.trim()) continue;
    // ss format: LISTEN  0  128  0.0.0.0:22  0.0.0.0:*  users:(("sshd",pid=1234,fd=3))
    const localMatch = line.match(/\s+([\d.*:[\]]+):(\d+)\s/);
    if (!localMatch) continue;
    const port = parseInt(localMatch[2], 10);
    if (Number.isNaN(port)) continue;
    const bindAddr = localMatch[1].replace(/[\[\]]/g, "");
    const procMatch = line.match(/users:\(\("([^"]+)"/);
    ports.push({
      port,
      protocol: proto,
      process: procMatch?.[1] || undefined,
      bind_address: bindAddr || undefined,
    });
  }
  return ports;
}

/** Parsing cron jobs da output user crontab + /etc/crontab */
function parseLinuxCronJobs(
  userCronOut: string,
  systemCronOut: string
): Array<{ user: string; schedule: string; command: string }> {
  const jobs: Array<{ user: string; schedule: string; command: string }> = [];
  // User crontabs: "user|* * * * * /path/to/cmd"
  for (const line of userCronOut.split("\n")) {
    if (!line.trim()) continue;
    const pipeIdx = line.indexOf("|");
    if (pipeIdx < 0) continue;
    const user = line.substring(0, pipeIdx);
    const rest = line.substring(pipeIdx + 1).trim();
    // Cron schedule = primi 5 campi (o @reboot/@daily/etc)
    const atMatch = rest.match(/^(@\w+)\s+(.+)/);
    if (atMatch) {
      jobs.push({ user, schedule: atMatch[1], command: atMatch[2] });
      continue;
    }
    const fields = rest.split(/\s+/);
    if (fields.length >= 6) {
      jobs.push({ user, schedule: fields.slice(0, 5).join(" "), command: fields.slice(5).join(" ") });
    }
  }
  // System crontab: "* * * * * root /path/to/cmd"
  for (const line of systemCronOut.split("\n")) {
    if (!line.trim()) continue;
    const fields = line.trim().split(/\s+/);
    if (fields.length >= 7) {
      const schedule = fields.slice(0, 5).join(" ");
      const user = fields[5];
      const command = fields.slice(6).join(" ");
      jobs.push({ user, schedule, command });
    }
  }
  return jobs.slice(0, 30);
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
$pdisks=@();foreach($d in qa "SELECT * FROM Win32_DiskDrive" 20){$obj=@{device=$d.DeviceID;model=$d.Model};if($d.Size -and [long]$d.Size -gt 0){$obj.size_gb=[int]([long]$d.Size/1GB)};$sn=$d.SerialNumber;if($sn){$sn=$sn.Trim()};if($sn -and $sn -ne ''){$obj.serial=$sn};if($d.Manufacturer -and $d.Manufacturer -ne '(Standard disk drives)'){$obj.vendor=$d.Manufacturer};if($d.InterfaceType){$obj.interface_type=$d.InterfaceType};$pdisks+=$obj};if($pdisks.Count){$r.physical_disks=$pdisks}
$llu=(Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Authentication\LogonUI' -EA 0);$r.last_logged_on_user=if($llu -and $llu.LastLoggedOnUser){$llu.LastLoggedOnUser}elseif($llu -and $llu.LastLoggedOnSAMUser){$llu.LastLoggedOnSAMUser}elseif($cs.UserName){$cs.UserName}else{$null}
try{$sess=@();$seen2=@{};foreach($lu in Get-WmiObject Win32_LoggedOnUser -EA 0){if($lu.Antecedent -match 'Domain="([^"]+)",Name="([^"]+)"'){$dom=$Matches[1];$nam=$Matches[2];if($nam -and $nam -notmatch '^(SYSTEM|LOCAL SERVICE|NETWORK SERVICE|DWM-|UMFD-)'){$un="$dom\$nam";if(-not $seen2[$un]){$seen2[$un]=$true;$sess+=@{username=$un}}}}};if($sess.Count){$r.logged_on_users=$sess}}catch{}
try{$isDom=($cs -and $cs.PartOfDomain);$profs=@();$wup=Get-WmiObject Win32_UserProfile -EA 0;foreach($p in ($wup|?{!$_.Special -and $_.LocalPath -and $_.LocalPath -notmatch 'Windows\\(System|Default)|\\(Public|Default User)$'}|Select-Object -First 30)){$sid=$p.SID;$obj=@{profile_path=$p.LocalPath;loaded=[bool]$p.Loaded;sid=$sid};try{$obj.username=([Security.Principal.SecurityIdentifier]$sid).Translate([Security.Principal.NTAccount]).Value}catch{$obj.username=($p.LocalPath -split '\\')[-1]};try{if($p.LastUseTime){$obj.last_use=[Management.ManagementDateTimeConverter]::ToDateTime($p.LastUseTime).ToString('yyyy-MM-ddTHH:mm:ss')}}catch{};if($isDom){$sam=if($obj.username -match '\\'){($obj.username -split '\\')[-1]}else{$obj.username};if($sam -and $sam.Length -gt 1 -and $sam -notmatch '^S-1-'){try{$ds=New-Object System.DirectoryServices.DirectorySearcher;$ds.Filter="(&(objectClass=user)(sAMAccountName=$sam))";'displayName','mail','department','title','lastLogon','userAccountControl'|foreach{$ds.PropertiesToLoad.Add($_)|Out-Null};$res=$ds.FindOne();if($res){if($res.Properties['displayname'].Count){$obj.ad_display_name=[string]$res.Properties['displayname'][0]};if($res.Properties['mail'].Count){$obj.ad_email=[string]$res.Properties['mail'][0]};if($res.Properties['department'].Count){$obj.ad_department=[string]$res.Properties['department'][0]};if($res.Properties['title'].Count){$obj.ad_title=[string]$res.Properties['title'][0]};if($res.Properties['useraccountcontrol'].Count){$obj.ad_enabled=([int]$res.Properties['useraccountcontrol'][0] -band 2) -eq 0};if($res.Properties['lastlogon'].Count){$ll=[long]$res.Properties['lastlogon'][0];if($ll -gt 0){$obj.ad_last_logon=[datetime]::FromFileTime($ll).ToString('yyyy-MM-ddTHH:mm:ss')}}}}catch{}}};$profs+=$obj};if($profs.Count){$r.user_profiles=@($profs|Sort-Object{[int]$_.loaded} -Descending)}}catch{}
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
      const legacy = parseLegacyWinrmOutput(text);
      if (!deviceInfoHasAnyData(legacy)) {
        throw new Error(
          "Risposta WinRM non interpretabile (output non JSON). Controlla che lo script PowerShell sia eseguito e che l'utente abbia permessi di lettura CIM/WMI."
        );
      }
      return legacy;
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

    // Dischi fisici (Win32_DiskDrive)
    if (Array.isArray(raw.physical_disks)) {
      result.physical_disks = raw.physical_disks.map((d: unknown) => {
        const o = d as Record<string, unknown>;
        return {
          device: String(o.device ?? ""),
          model: getStr(o.model) ?? undefined,
          size_gb: getNum(o.size_gb) ?? undefined,
          serial: getStr(o.serial) ?? undefined,
          vendor: getStr(o.vendor) ?? undefined,
          interface_type: getStr(o.interface_type) ?? undefined,
        };
      });
    }

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

    // Utenti e sessioni
    result.last_logged_on_user = getStr(raw.last_logged_on_user);
    if (Array.isArray(raw.logged_on_users)) {
      result.logged_on_users = raw.logged_on_users.map((u: unknown) => {
        const o = u as Record<string, unknown>;
        return {
          username: String(o.username ?? ""),
          session_type: getStr(o.session_type) ?? undefined,
          logon_time: getStr(o.logon_time) ?? undefined,
        };
      });
    }
    if (Array.isArray(raw.user_profiles)) {
      result.user_profiles = raw.user_profiles.map((p: unknown) => {
        const o = p as Record<string, unknown>;
        return {
          username: String(o.username ?? ""),
          sid: getStr(o.sid) ?? undefined,
          profile_path: getStr(o.profile_path) ?? undefined,
          loaded: o.loaded === true,
          last_use: getStr(o.last_use) ?? undefined,
          ad_display_name: getStr(o.ad_display_name) ?? undefined,
          ad_email: getStr(o.ad_email) ?? undefined,
          ad_department: getStr(o.ad_department) ?? undefined,
          ad_title: getStr(o.ad_title) ?? undefined,
          ad_enabled: typeof o.ad_enabled === "boolean" ? o.ad_enabled : undefined,
          ad_last_logon: getStr(o.ad_last_logon) ?? undefined,
        };
      });
    }

    const parts = [result.model, result.sysdescr].filter(Boolean);
    result.sysdescr = parts.length > 0 ? parts.join(" | ") : result.sysdescr;

    if (!deviceInfoHasAnyData(result)) {
      throw new Error(
        "WinRM connesso ma nessun dato inventario (JSON vuoto o CIM senza risultati). Verifica account amministratore sul dominio o locale e policy di esecuzione."
      );
    }
    return result;
  } catch (e) {
    if (e instanceof Error) throw e;
    throw new Error(String(e));
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
 * Recupera info device via profilo vendor SNMP (OID specifici).
 * Usa il catalogo snmp-vendor-profiles.ts per identificare device e interrogare OID dedicati.
 * Questa funzione è alternativa a SSH/WinRM: se il profilo restituisce dati completi,
 * può essere usata come unica fonte (risparmia connessioni SSH).
 */
export async function getDeviceInfoViaSNMPProfile(
  ip: string,
  community: string,
  port: number = 161
): Promise<DeviceInfo & { vendorProfileId?: string | null; vendorProfileName?: string | null; vendorProfileExtra?: Record<string, string | null> }> {
  const baseResult: DeviceInfo = { sysname: null, sysdescr: null, model: null, firmware: null, serial_number: null, part_number: null };
  try {
    const { querySnmpInfoMultiCommunity } = await import("@/lib/scanner/snmp-query");
    const snmpInfo = await querySnmpInfoMultiCommunity(ip, [community], port);

    if (!snmpInfo.sysDescr && !snmpInfo.sysObjectID && !snmpInfo.sysName) {
      return baseResult;
    }

    return {
      sysname: snmpInfo.sysName ?? null,
      sysdescr: snmpInfo.sysDescr ?? null,
      model: snmpInfo.model ?? null,
      firmware: snmpInfo.vendorProfileFirmware ?? null,
      serial_number: snmpInfo.serialNumber ?? null,
      part_number: snmpInfo.partNumber ?? null,
      vendorProfileId: snmpInfo.vendorProfileId ?? null,
      vendorProfileName: snmpInfo.vendorProfileName ?? null,
      vendorProfileExtra: snmpInfo.vendorProfileExtra ?? undefined,
    };
  } catch {
    return baseResult;
  }
}

/**
 * Combina SNMP e SSH per ottenere info complete.
 * Prova SNMP se disponibile (community o protocollo SNMP), poi SSH per model/firmware.
 * Se il profilo SNMP vendor è completo (model + firmware + serial), può saltare SSH.
 */
export async function getDeviceInfo(device: NetworkDevice): Promise<DeviceInfo> {
  let result: DeviceInfo = { sysname: null, sysdescr: null, model: null, firmware: null, serial_number: null, part_number: null };
  let winrmFailure: Error | null = null;
  const nasKind = resolveNasKind(device);

  const snmpV3Creds = getDeviceSnmpV3Credentials(device);
  // Controlla se c'è un binding SNMP nella nuova tabella
  const { getDb: getDbForSnmpCheck } = await import("@/lib/db");
  const hasSnmpBinding = !!(getDbForSnmpCheck().prepare(
    "SELECT 1 FROM device_credential_bindings WHERE device_id = ? AND protocol_type = 'snmp' LIMIT 1"
  ).get(device.id));
  const hasSnmp =
    !!device.community_string ||
    device.protocol === "snmp_v2" ||
    device.protocol === "snmp_v3" ||
    (device.snmp_credential_id
      ? !!getCredentialCommunityString(device.snmp_credential_id) || !!snmpV3Creds
      : false) ||
    (device.credential_id ? !!getCredentialCommunityString(device.credential_id) : false) ||
    hasSnmpBinding;
  const scanTarget = (device as { scan_target?: string | null }).scan_target;
  const isLinuxVendorInfo =
    scanTarget === "linux" ||
    device.vendor === "linux" ||
    device.vendor === "other" ||
    device.vendor === "synology" ||
    device.vendor === "qnap" ||
    nasKind != null;
  const hasSsh =
    (device.protocol === "ssh" || isLinuxVendorInfo) &&
    !!(device.username || getDeviceCredentials(device)?.username);
  const hasWinrm =
    device.protocol === "winrm" || device.vendor === "windows" || scanTarget === "windows";

  // Prima WinRM se configurato
  if (hasWinrm) {
    try {
      const winrmInfo = await getDeviceInfoFromWinrm(device);
      result = { ...result, ...winrmInfo };
    } catch (e) {
      winrmFailure = e instanceof Error ? e : new Error(String(e));
    }
  }

  // SNMP con profilo vendor: prova a ottenere dati completi
  if (hasSnmp) {
    const community = getDeviceCommunityString(device);
    const snmpPort =
      device.protocol === "snmp_v2" || device.protocol === "snmp_v3" ? getEffectiveSnmpPort(device) : 161;

    // Prima prova il profilo vendor per dati specifici
    const profileInfo = await getDeviceInfoViaSNMPProfile(device.host, community, snmpPort);
    if (profileInfo.vendorProfileId) {
      result = {
        sysname: profileInfo.sysname ?? result.sysname,
        sysdescr: profileInfo.sysdescr ?? result.sysdescr,
        model: profileInfo.model ?? result.model,
        firmware: profileInfo.firmware ?? result.firmware,
        serial_number: profileInfo.serial_number ?? result.serial_number,
        part_number: profileInfo.part_number ?? result.part_number,
      };
      // Se il profilo ha fornito model + firmware + serial, possiamo saltare SSH (tranne NAS: serve SSH per volumi/utenti/rete)
      const snmpComplete = result.model && result.firmware && result.serial_number;
      if (snmpComplete && hasSsh && !nasKind) {
        return result;
      }
    } else {
      // Fallback: SNMP base (ENTITY-MIB)
      const snmpInfo = await getDeviceInfoFromSnmp(device);
      result = { ...result, ...snmpInfo };
    }

    // Synology / QNAP: walk MIB enterprise (dischi RAID/volumi SNMP) oltre al profilo
    if (nasKind) {
      const { getNasSnmpInventory } = await import("./nas-acquisition");
      const nasSnmp = await getNasSnmpInventory(device, nasKind);
      result = { ...result, ...nasSnmp };
    }

    // Ultimo tentativo SNMP v2c: walk ENTITY-MIB seriali (molti switch/router espongono il seriale solo su indici >2)
    if (!result.serial_number && device.protocol !== "snmp_v3") {
      const { trySnmpSerialFromEntityWalk } = await import("@/lib/scanner/snmp-query");
      const sn = await trySnmpSerialFromEntityWalk(device.host, community, snmpPort);
      if (sn) result.serial_number = sn;
    }
  } else if (nasKind) {
    // NAS solo SSH senza community esplicita: prova comunque SNMP (community default da getDeviceCommunityString, es. public) + profilo vendor
    const community = getDeviceCommunityString(device);
    const snmpPort =
      device.protocol === "snmp_v2" || device.protocol === "snmp_v3" ? getEffectiveSnmpPort(device) : 161;
    try {
      const profileInfo = await getDeviceInfoViaSNMPProfile(device.host, community, snmpPort);
      if (profileInfo.vendorProfileId) {
        result = {
          sysname: profileInfo.sysname ?? result.sysname,
          sysdescr: profileInfo.sysdescr ?? result.sysdescr,
          model: profileInfo.model ?? result.model,
          firmware: profileInfo.firmware ?? result.firmware,
          serial_number: profileInfo.serial_number ?? result.serial_number,
          part_number: profileInfo.part_number ?? result.part_number,
        };
      }
    } catch {
      /* SNMP non raggiungibile */
    }
    try {
      const { getNasSnmpInventory } = await import("./nas-acquisition");
      const nasOnlySnmp = await getNasSnmpInventory(device, nasKind);
      result = { ...result, ...nasOnlySnmp };
    } catch {
      /* walk NAS fallito */
    }
  }

  // SSH per completare i dati mancanti
  if (hasSsh) {
    const sshInfo = await getDeviceInfoFromSsh(device);
    const snmpNas = result.nas_inventory;
    result = { ...result, ...sshInfo };
    if (snmpNas && sshInfo.nas_inventory && nasKind) {
      const { mergeNasInventorySnapshots } = await import("./nas-acquisition");
      result.nas_inventory = mergeNasInventorySnapshots(snmpNas, sshInfo.nas_inventory);
    }
  }

  if (!deviceInfoHasAnyData(result) && winrmFailure) {
    throw winrmFailure;
  }

  return result;
}
