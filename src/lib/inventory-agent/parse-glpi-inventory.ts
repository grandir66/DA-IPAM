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
}

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
  };
}
