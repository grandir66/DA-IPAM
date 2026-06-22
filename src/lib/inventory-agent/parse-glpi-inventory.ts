/**
 * Parser JSON inventario GLPI Agent (inventory_format).
 * @see https://github.com/glpi-project/inventory_format
 */

export interface ParsedGlpiSoftware {
  name: string;
  version: string | null;
  publisher: string | null;
  install_date: string | null;
  install_location: string | null;
  source: string | null;
  architecture: string | null;
  size_bytes: number | null;
}

export interface ParsedGlpiBios {
  manufacturer: string | null;
  system_manufacturer: string | null;
  system_model: string | null;
  system_serial: string | null;
  motherboard_manufacturer: string | null;
  motherboard_model: string | null;
  motherboard_serial: string | null;
  version: string | null;
  date: string | null;
  asset_tag: string | null;
}

export interface ParsedGlpiHardwareProfile {
  name: string | null;
  uuid: string | null;
  chassis_type: string | null;
  memory_mb: number | null;
  swap_mb: number | null;
  default_gateway: string | null;
  dns: string | null;
  last_logged_user: string | null;
  workgroup: string | null;
  vm_system: string | null;
  manufacturer: string | null;
  model: string | null;
  serial: string | null;
}

export interface ParsedGlpiCpu {
  name: string | null;
  manufacturer: string | null;
  cores: number | null;
  threads: number | null;
  speed_mhz: number | null;
}

export interface ParsedGlpiMemory {
  capacity_mb: number | null;
  caption: string | null;
  manufacturer: string | null;
  model: string | null;
  speed: string | null;
  type: string | null;
}

export interface ParsedGlpiStorage {
  name: string | null;
  model: string | null;
  manufacturer: string | null;
  size_mb: number | null;
  type: string | null;
  interface: string | null;
  serial: string | null;
  firmware: string | null;
}

export interface ParsedGlpiNetwork {
  name: string | null;
  ip: string | null;
  mac: string | null;
  gateway: string | null;
  dhcp: boolean | null;
  description: string | null;
}

export interface ParsedGlpiUser {
  login: string | null;
  domain: string | null;
  status: string | null;
}

export interface ParsedGlpiAntivirus {
  name: string | null;
  company: string | null;
  enabled: boolean | null;
  version: string | null;
  uptodate: boolean | null;
}

export interface ParsedGlpiMonitor {
  name: string | null;
  manufacturer: string | null;
  serial: string | null;
  description: string | null;
  width: number | null;
  height: number | null;
}

export interface ParsedGlpiLicense {
  name: string;
  full_name: string | null;
  product_id: string | null;
  license_key: string | null;
  components: string | null;
  trial: boolean | null;
  activation_date: string | null;
}

export type ParsedGlpiRuntimeCategory = "database" | "remote_mgmt" | "firewall" | "process";

export interface ParsedGlpiRuntimeItem {
  category: ParsedGlpiRuntimeCategory;
  name: string;
  version: string | null;
  status: string | null;
  port: number | null;
  user_name: string | null;
  command_line: string | null;
  is_active: boolean | null;
}

export interface ParsedGlpiController {
  name: string | null;
  manufacturer: string | null;
  type: string | null;
  version: string | null;
}

export interface ParsedGlpiFirmware {
  name: string | null;
  manufacturer: string | null;
  version: string | null;
  type: string | null;
  date: string | null;
}

export interface ParsedGlpiBattery {
  name: string | null;
  manufacturer: string | null;
  chemistry: string | null;
  capacity_mwh: number | null;
  real_capacity_mwh: number | null;
}

export interface ParsedGlpiInventoryProfile {
  hardware: ParsedGlpiHardwareProfile;
  bios: ParsedGlpiBios | null;
  cpus: ParsedGlpiCpu[];
  memories: ParsedGlpiMemory[];
  storages: ParsedGlpiStorage[];
  networks: ParsedGlpiNetwork[];
  users: ParsedGlpiUser[];
  antivirus: ParsedGlpiAntivirus[];
  monitors: ParsedGlpiMonitor[];
  controllers: ParsedGlpiController[];
  firmwares: ParsedGlpiFirmware[];
  batteries: ParsedGlpiBattery[];
  licenses: ParsedGlpiLicense[];
  runtime: ParsedGlpiRuntimeItem[];
  process_count: number;
}

export interface ParsedGlpiInventory {
  device_id: string;
  hostname: string | null;
  primary_ip: string | null;
  primary_mac: string | null;
  os_family: "windows" | "linux" | "macos" | "other";
  os_name: string | null;
  os_version: string | null;
  agent_tag: string | null;
  agent_version: string | null;
  software: ParsedGlpiSoftware[];
  profile: ParsedGlpiInventoryProfile;
}

/** Limite processi persistiti per report (payload GLPI può essere molto grande). */
export const GLPI_MAX_STORED_PROCESSES = 300;

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

function normalizeMac(mac: string | null): string | null {
  if (!mac) return null;
  const hex = mac.replace(/[^a-fA-F0-9]/g, "").toLowerCase();
  if (hex.length !== 12) return mac.toLowerCase();
  return hex.match(/.{2}/g)?.join(":") ?? mac.toLowerCase();
}

function pickIp(networks: unknown): string | null {
  if (!Array.isArray(networks)) return null;
  for (const n of networks) {
    const row = asRecord(n);
    if (!row) continue;
    const ip = str(row.ipaddress ?? row.ip ?? row.ipAddress);
    if (ip && ip !== "127.0.0.1" && !ip.startsWith("169.254.")) return ip;
  }
  return null;
}

function pickMac(networks: unknown): string | null {
  if (!Array.isArray(networks)) return null;
  for (const n of networks) {
    const row = asRecord(n);
    if (!row) continue;
    const mac = normalizeMac(str(row.mac ?? row.macaddr));
    if (mac && mac !== "00:00:00:00:00:00") return mac;
  }
  return null;
}

function mapOsFamily(name: string | null, kernel: string | null): ParsedGlpiInventory["os_family"] {
  const blob = `${name ?? ""} ${kernel ?? ""}`.toLowerCase();
  if (blob.includes("windows") || blob.includes("microsoft")) return "windows";
  if (blob.includes("darwin") || blob.includes("macos") || blob.includes("mac os")) return "macos";
  if (
    blob.includes("linux") ||
    blob.includes("ubuntu") ||
    blob.includes("debian") ||
    blob.includes("rhel") ||
    blob.includes("centos") ||
    blob.includes("fedora")
  ) {
    return "linux";
  }
  return "other";
}

function int(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (v != null) {
    const n = Number(v);
    if (Number.isFinite(n)) return Math.trunc(n);
  }
  return null;
}

function bool(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (v === "1" || v === 1 || v === "true") return true;
  if (v === "0" || v === 0 || v === "false") return false;
  return null;
}

function parseArray<T>(raw: unknown, map: (row: Record<string, unknown>) => T | null): T[] {
  if (!Array.isArray(raw)) return [];
  const out: T[] = [];
  for (const item of raw) {
    const row = asRecord(item);
    if (!row) continue;
    const parsed = map(row);
    if (parsed) out.push(parsed);
  }
  return out;
}

function parseBios(raw: Record<string, unknown> | null): ParsedGlpiBios | null {
  if (!raw) return null;
  return {
    manufacturer: str(raw.bmanufacturer),
    system_manufacturer: str(raw.smanufacturer),
    system_model: str(raw.smodel),
    system_serial: str(raw.ssn ?? raw.biosserial ?? raw.enclosureserial),
    motherboard_manufacturer: str(raw.mmanufacturer),
    motherboard_model: str(raw.mmodel),
    motherboard_serial: str(raw.msn),
    version: str(raw.bversion),
    date: str(raw.bdate),
    asset_tag: str(raw.assettag),
  };
}

function parseHardwareProfile(hw: Record<string, unknown> | null, bios: ParsedGlpiBios | null): ParsedGlpiHardwareProfile {
  return {
    name: str(hw?.name),
    uuid: str(hw?.uuid),
    chassis_type: str(hw?.chassis_type ?? hw?.type),
    memory_mb: int(hw?.memory),
    swap_mb: int(hw?.swap),
    default_gateway: str(hw?.defaultgateway),
    dns: str(hw?.dns),
    last_logged_user: str(hw?.lastloggeduser),
    workgroup: str(hw?.workgroup),
    vm_system: str(hw?.vmsystem),
    manufacturer: str(bios?.system_manufacturer ?? bios?.motherboard_manufacturer),
    model: str(bios?.system_model ?? bios?.motherboard_model ?? hw?.description),
    serial: str(bios?.system_serial ?? bios?.motherboard_serial ?? hw?.uuid),
  };
}

function parseInventoryProfile(content: Record<string, unknown>): ParsedGlpiInventoryProfile {
  const hw = asRecord(content.hardware);
  const bios = parseBios(asRecord(content.bios));
  const licenses = parseArray(content.licenseinfos, (row) => {
    const name = str(row.name ?? row.fullname);
    if (!name) return null;
    return {
      name,
      full_name: str(row.fullname),
      product_id: str(row.productid),
      license_key: str(row.key),
      components: str(row.components),
      trial: bool(row.trial),
      activation_date: str(row.activation_date ?? row.update),
    };
  });

  const runtime: ParsedGlpiRuntimeItem[] = [];
  for (const item of parseArray(content.databases_services, (row) => row)) {
    const name = str(item.name);
    if (!name) continue;
    runtime.push({
      category: "database",
      name,
      version: str(item.version),
      status: item.is_active === true ? "active" : item.is_active === false ? "inactive" : null,
      port: int(item.port),
      user_name: null,
      command_line: str(item.path),
      is_active: bool(item.is_active),
    });
  }
  for (const item of parseArray(content.remote_mgmt, (row) => row)) {
    const name = str(item.type) ?? str(item.id);
    if (!name) continue;
    runtime.push({
      category: "remote_mgmt",
      name,
      version: str(item.version),
      status: "detected",
      port: null,
      user_name: null,
      command_line: str(item.id),
      is_active: true,
    });
  }
  for (const item of parseArray(content.firewalls, (row) => row)) {
    const profile = str(item.profile) ?? str(item.description) ?? "firewall";
    runtime.push({
      category: "firewall",
      name: profile,
      version: null,
      status: str(item.status),
      port: null,
      user_name: null,
      command_line: str(item.ipaddress ?? item.ipaddress6),
      is_active: str(item.status)?.toLowerCase() === "on" ? true : null,
    });
  }

  const processesRaw = Array.isArray(content.processes) ? content.processes : [];
  const process_count = processesRaw.length;
  const processRows = processesRaw
    .map((item) => asRecord(item))
    .filter((row): row is Record<string, unknown> => row != null)
    .slice(0, GLPI_MAX_STORED_PROCESSES);
  for (const row of processRows) {
    const cmd = str(row.cmd);
    if (!cmd) continue;
    runtime.push({
      category: "process",
      name: cmd.split(/\s+/)[0]?.split("/").pop() ?? cmd.slice(0, 64),
      version: null,
      status: str(row.mem) ? `mem ${str(row.mem)}%` : null,
      port: int(row.pid),
      user_name: str(row.user),
      command_line: cmd.length > 500 ? `${cmd.slice(0, 497)}…` : cmd,
      is_active: true,
    });
  }

  return {
    hardware: parseHardwareProfile(hw, bios),
    bios,
    cpus: parseArray(content.cpus, (row) => ({
      name: str(row.name ?? row.type),
      manufacturer: str(row.manufacturer),
      cores: int(row.cores ?? row.nbcores),
      threads: int(row.threads ?? row.nbthreads),
      speed_mhz: int(row.speed ?? row.frequency),
    })),
    memories: parseArray(content.memories, (row) => ({
      capacity_mb: int(row.capacity),
      caption: str(row.caption),
      manufacturer: str(row.manufacturer),
      model: str(row.model),
      speed: str(row.speed),
      type: str(row.type),
    })),
    storages: parseArray(content.storages, (row) => ({
      name: str(row.name),
      model: str(row.model),
      manufacturer: str(row.manufacturer),
      size_mb: int(row.disksize),
      type: str(row.type),
      interface: str(row.interface),
      serial: str(row.serial),
      firmware: str(row.firmware),
    })),
    networks: parseArray(content.networks, (row) => ({
      name: str(row.description ?? row.name ?? row.ipaddress),
      ip: str(row.ipaddress ?? row.ip ?? row.ipAddress),
      mac: normalizeMac(str(row.mac ?? row.macaddr)),
      gateway: str(row.gateway),
      dhcp: bool(row.dhcp),
      description: str(row.description),
    })),
    users: parseArray(content.users, (row) => ({
      login: str(row.login ?? row.userid),
      domain: str(row.domain),
      status: str(row.status),
    })),
    antivirus: parseArray(content.antivirus, (row) => ({
      name: str(row.name),
      company: str(row.company),
      enabled: bool(row.enabled),
      version: str(row.version),
      uptodate: bool(row.uptodate),
    })),
    monitors: parseArray(content.monitors, (row) => ({
      name: str(row.name ?? row.caption),
      manufacturer: str(row.manufacturer),
      serial: str(row.serial),
      description: str(row.description),
      width: int(row.width),
      height: int(row.height),
    })),
    controllers: parseArray(content.controllers, (row) => ({
      name: str(row.name),
      manufacturer: str(row.manufacturer),
      type: str(row.type ?? row.subsystem),
      version: str(row.firmware ?? row.version),
    })),
    firmwares: parseArray(content.firmwares, (row) => ({
      name: str(row.name),
      manufacturer: str(row.manufacturer),
      version: str(row.version),
      type: str(row.type),
      date: str(row.date),
    })),
    batteries: parseArray(content.batteries, (row) => ({
      name: str(row.name),
      manufacturer: str(row.manufacturer),
      chemistry: str(row.chemistry),
      capacity_mwh: int(row.capacity),
      real_capacity_mwh: int(row.real_capacity),
    })),
    licenses,
    runtime,
    process_count,
  };
}

function parseSoftwareItem(raw: Record<string, unknown>): ParsedGlpiSoftware | null {
  const name = str(raw.name);
  if (!name) return null;
  const sizeRaw = raw.filesize ?? raw.size;
  let size_bytes: number | null = null;
  if (typeof sizeRaw === "number" && Number.isFinite(sizeRaw)) size_bytes = sizeRaw;
  else if (sizeRaw != null) {
    const n = Number(sizeRaw);
    if (Number.isFinite(n)) size_bytes = n;
  }
  return {
    name,
    version: str(raw.version),
    publisher: str(raw.publisher ?? raw.manufacturer),
    install_date: str(raw.install_date ?? raw.installdate),
    install_location: str(raw.folder ?? raw.install_location),
    source: str(raw.from ?? raw.helplink ?? raw.system_category),
    architecture: str(raw.arch ?? raw.architecture),
    size_bytes,
  };
}

export function unwrapGlpiPayload(body: unknown): Record<string, unknown> | null {
  if (Array.isArray(body)) {
    return body.length ? asRecord(body[0]) : null;
  }
  const root = asRecord(body);
  if (!root) return null;
  if (asRecord(root.content)) return root;
  if (Array.isArray(root.items) && root.items.length) {
    const first = asRecord(root.items[0]);
    if (first) return first;
  }
  return root;
}

export function parseGlpiInventory(body: unknown): ParsedGlpiInventory {
  const root = unwrapGlpiPayload(body);
  if (!root) throw new Error("Payload JSON non valido");

  const content = asRecord(root.content) ?? root;
  const hw = asRecord(content.hardware) ?? asRecord(root.hardware);
  const os = asRecord(content.operatingsystem) ?? asRecord(content.operatingsystem) ?? asRecord(root.operatingsystem);
  const versionBlock = asRecord(root.version) ?? asRecord(content.version);

  const device_id =
    str(root.deviceid) ??
    str(hw?.uuid) ??
    str(hw?.name) ??
    str(content.name) ??
    str(root.name) ??
    `unknown-${Date.now()}`;

  const hostname =
    str(os?.hostname) ??
    str(hw?.name) ??
    str(content.name) ??
    str(root.name);

  const networks = content.networks ?? root.networks;
  const primary_ip = pickIp(networks);
  const primary_mac = pickMac(networks);

  const os_name = str(os?.fullname ?? os?.name ?? os?.osname);
  const os_version = str(os?.version ?? os?.kernel_version);
  const os_family = mapOsFamily(os_name, str(os?.kernel_name));

  const profile = parseInventoryProfile(content);

  const softwaresRaw = content.softwares ?? content.software ?? root.softwares;
  const software: ParsedGlpiSoftware[] = [];
  if (Array.isArray(softwaresRaw)) {
    for (const item of softwaresRaw) {
      const row = asRecord(item);
      if (!row) continue;
      const parsed = parseSoftwareItem(row);
      if (parsed) software.push(parsed);
    }
  }

  return {
    device_id,
    hostname,
    primary_ip,
    primary_mac,
    os_family,
    os_name,
    os_version,
    agent_tag: str(root.tag ?? content.tag),
    agent_version: str(versionBlock?.agent ?? versionBlock?.content ?? root.agentversion),
    software,
    profile,
  };
}
