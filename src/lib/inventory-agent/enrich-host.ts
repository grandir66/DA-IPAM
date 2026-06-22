/**
 * Propaga dati GLPI Agent verso hosts (campi anagrafica) con preserve_existing.
 */
import { getHostById, getTenantDb, getCurrentTenantCode } from "@/lib/db-tenant";
import { lookupVendorSync } from "@/lib/scanner/mac-vendor";
import { normalizeMacForStorage } from "@/lib/utils";
import type { ParsedGlpiInventory } from "@/lib/inventory-agent/parse-glpi-inventory";
import { formatGlpiOsInfo } from "@/lib/inventory-agent/parse-glpi-inventory";

const HOSTNAME_PRIORITY: Record<string, number> = {
  manual: 6,
  dhcp: 5,
  glpi_agent: 5,
  snmp: 4,
  nmap: 3,
  dns: 2,
  arp: 1,
};

function db() {
  const code = getCurrentTenantCode();
  if (!code) throw new Error("Nessun contesto tenant attivo");
  return getTenantDb(code);
}

function isPlaceholderOsInfo(value: string | null | undefined): boolean {
  if (!value?.trim()) return true;
  return /^(linux generico|unknown|sconosciuto|n\/a|generico)$/i.test(value.trim());
}

/** Aggiorna hosts.* con dati agent quando il campo è vuoto o la sorgente hostname ha priorità inferiore. */
export function enrichHostFromInventoryAgent(hostId: number, parsed: ParsedGlpiInventory): void {
  const host = getHostById(hostId);
  if (!host) return;

  const hw = parsed.profile.hardware;
  const bios = parsed.profile.bios;
  const model =
    hw.model ?? bios?.system_model ?? bios?.motherboard_model ?? null;
  const serial =
    hw.serial ?? bios?.system_serial ?? bios?.motherboard_serial ?? null;
  const manufacturer =
    hw.manufacturer ?? bios?.system_manufacturer ?? bios?.motherboard_manufacturer ?? null;
  const osInfo = formatGlpiOsInfo(parsed.os_name, parsed.os_version);

  const fields: string[] = ["updated_at = datetime('now')", "last_seen = datetime('now')"];
  const values: unknown[] = [];

  const macNorm = parsed.primary_mac
    ? normalizeMacForStorage(parsed.primary_mac)
    : null;
  if (macNorm && !host.mac) {
    fields.push("mac = ?");
    values.push(macNorm);
    const vendor = lookupVendorSync(macNorm);
    if (vendor && !host.vendor) {
      fields.push("vendor = ?");
      values.push(vendor);
    }
  }

  if (parsed.hostname) {
    const existingSource = host.hostname_source ?? null;
    const newPriority = HOSTNAME_PRIORITY.glpi_agent;
    const oldPriority = HOSTNAME_PRIORITY[existingSource ?? ""] ?? 0;
    if (!host.hostname || newPriority >= oldPriority) {
      fields.push("hostname = ?", "hostname_source = ?");
      values.push(parsed.hostname, "glpi_agent");
    }
  }

  if (osInfo && (isPlaceholderOsInfo(host.os_info) || !host.os_info)) {
    fields.push("os_info = ?");
    values.push(osInfo);
  }
  if (model && !host.model) {
    fields.push("model = ?");
    values.push(model);
  }
  if (serial && !host.serial_number) {
    fields.push("serial_number = ?");
    values.push(serial);
  }
  if (manufacturer && (!host.device_manufacturer || host.device_manufacturer === "Apple" && !host.model)) {
    fields.push("device_manufacturer = ?");
    values.push(manufacturer);
  }

  const firmware =
    parsed.profile.firmwares.find((f) => f.version)?.version ??
    parsed.profile.bios?.version ??
    null;
  if (firmware && !host.firmware) {
    fields.push("firmware = ?");
    values.push(firmware);
  }

  const osFamilyMap: Record<ParsedGlpiInventory["os_family"], string> = {
    windows: "windows",
    linux: "linux",
    macos: "macos",
    other: "unknown",
  };
  const inferred = osFamilyMap[parsed.os_family];
  if (inferred && inferred !== "unknown" && !host.inferred_os_family) {
    fields.push("inferred_os_family = ?", "inferred_at = datetime('now')");
    values.push(inferred);
  }

  if (fields.length <= 2) return;

  values.push(hostId);
  db()
    .prepare(`UPDATE hosts SET ${fields.join(", ")} WHERE id = ?`)
    .run(...values);
}
