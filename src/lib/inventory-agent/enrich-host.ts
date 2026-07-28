/**
 * Propaga dati GLPI Agent verso hosts — priorità superiore ai detect di scan (nmap/SNMP/ARP/DNS).
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
  ad: 5,
  snmp: 4,
  nmap: 3,
  scan: 3,
  dns: 2,
  arp: 1,
};

function hostnameSourcePriority(source: string | null | undefined): number {
  return HOSTNAME_PRIORITY[source ?? ""] ?? 0;
}

/** L'agent GLPI ha priorità sui detect (nmap/SNMP/ARP/DNS); il solo hostname manuale resta intoccabile. */
function shouldAgentSetHostname(
  existing: string | null | undefined,
  existingSource: string | null | undefined,
  _agentHostname: string,
): boolean {
  if (existingSource === "manual") return false;
  if (!existing?.trim()) return true;
  return hostnameSourcePriority("glpi_agent") >= hostnameSourcePriority(existingSource);
}

function shouldAgentSetAnagraphic(agentValue: string | null | undefined): boolean {
  return Boolean(agentValue?.trim());
}

function db() {
  const code = getCurrentTenantCode();
  if (!code) throw new Error("Nessun contesto tenant attivo");
  return getTenantDb(code);
}

/** Aggiorna hosts.* con dati agent (priorità superiore ai detect di scan). */
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
  if (macNorm && shouldAgentSetAnagraphic(macNorm)) {
    fields.push("mac = ?");
    values.push(macNorm);
    const vendor = lookupVendorSync(macNorm);
    if (vendor && shouldAgentSetAnagraphic(vendor)) {
      fields.push("vendor = ?");
      values.push(vendor);
    }
  }

  if (
    parsed.hostname &&
    shouldAgentSetHostname(host.hostname, host.hostname_source, parsed.hostname)
  ) {
    fields.push("hostname = ?", "hostname_source = ?");
    values.push(parsed.hostname, "glpi_agent");
  }

  if (osInfo && shouldAgentSetAnagraphic(osInfo)) {
    fields.push("os_info = ?");
    values.push(osInfo);
  }
  if (model && shouldAgentSetAnagraphic(model)) {
    fields.push("model = ?");
    values.push(model);
  }
  if (serial && shouldAgentSetAnagraphic(serial)) {
    fields.push("serial_number = ?");
    values.push(serial);
  }
  if (manufacturer && shouldAgentSetAnagraphic(manufacturer)) {
    fields.push("device_manufacturer = ?");
    values.push(manufacturer);
  }

  const firmware =
    parsed.profile.firmwares.find((f) => f.version)?.version ??
    parsed.profile.bios?.version ??
    null;
  if (firmware && shouldAgentSetAnagraphic(firmware)) {
    fields.push("firmware = ?");
    values.push(firmware);
  }

  // Fase 4 (ritiro legacy): la scrittura diretta di inferred_os_family/inferred_at
  // è stata rimossa — un solo scrittore (attribution v2). L'evidenza "inv_agent"
  // emessa più sotto (dimension os, autoritativa su OS) copre lo stesso segnale
  // e viene proiettata su inferred_os_family da applyAttribution.
  if (fields.length > 2) {
    values.push(hostId);
    db()
      .prepare(`UPDATE hosts SET ${fields.join(", ")} WHERE id = ?`)
      .run(...values);
  }

  // Attribution v2: l'inventario agent è evidenza autoritativa su OS (spec §4.3).
  // Va tentata anche se l'UPDATE anagrafico sopra è stato saltato (es. sync che
  // riporta solo os_family, nessun campo anagrafico nuovo): altrimenti quel
  // segnale sparirebbe del tutto.
  try {
    // require sincrono: enrichHostFromInventoryAgent non è async (vedi .claude/rules).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { recordEvidence } = require("@/lib/attribution/evidence") as typeof import("@/lib/attribution/evidence");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { recomputeAttributionSafe } = require("@/lib/attribution/recompute") as typeof import("@/lib/attribution/recompute");
    const code = getCurrentTenantCode();
    if (code) {
      const inputs: import("@/lib/attribution/types").EvidenceInput[] = [];
      if (parsed.os_family && parsed.os_family !== "other") {
        inputs.push({
          source: "inv_agent", phase: "integration", dimension: "os",
          claim: parsed.os_family === "macos" ? "macos" : parsed.os_family,
          confidence: 0.95, raw_value: parsed.os_name ?? null,
        });
      }
      inputs.push({ source: "inv_agent", phase: "integration", dimension: "category", claim: "compute", confidence: 0.6, raw_value: "agent GLPI presente" });
      if (inputs.length > 0) recordEvidence(getTenantDb(code), hostId, inputs);
      recomputeAttributionSafe(hostId, "scan");
    }
  } catch (e) {
    console.error("[attribution] evidenza inv_agent fallita:", e);
  }
}
