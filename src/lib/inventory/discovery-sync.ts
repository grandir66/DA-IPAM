/**
 * NIS2 Fase 3 — Engine di sync inventory da dati di discovery.
 *
 * Popola i campi di `inventory_assets` a partire dalle informazioni raccolte
 * dagli scanner (host) e dai device di rete (network_devices), evitando
 * data-entry manuale per i dati tecnici (firmware, OS, MAC, serial, ecc.).
 *
 * Regola di base: i campi vengono sovrascritti SOLO se vuoti/null nell'asset,
 * a meno di `force=true`. `auto_sync_discovery=0` blocca completamente il sync
 * (asset marcato come "valori curati manualmente").
 *
 * Sorgenti consultate, in ordine di priorità:
 *   1. network_device collegato (a.network_device_id)  → fingerprint device-level
 *   2. host collegato (a.host_id)                       → dati host (ICMP/SNMP/Nmap)
 */

import type { InventoryAsset, InventoryAssetInput, Host, NetworkDevice } from "@/types";

export interface SyncResult {
  asset_id: number;
  updated: boolean;
  fields_updated: string[];
  skipped_reason?: "auto_sync_disabled" | "no_source";
  source: string | null;
}

/** Restituisce true se il valore corrente è considerato "vuoto" (sovrascrivibile). */
function isEmpty(v: unknown): boolean {
  return v == null || v === "" || (typeof v === "number" && v === 0);
}

/** Estrae porte aperte come stringa "tcp:22,80,443 | udp:161" dal JSON open_ports dell'host. */
export function summarizeOpenPorts(openPortsJson: string | null | undefined): string | null {
  if (!openPortsJson) return null;
  try {
    const arr = JSON.parse(openPortsJson) as Array<{ port: number; protocol?: string }>;
    if (!Array.isArray(arr) || arr.length === 0) return null;
    const tcp = arr.filter((p) => (p.protocol ?? "tcp") === "tcp").map((p) => p.port).sort((a, b) => a - b);
    const udp = arr.filter((p) => p.protocol === "udp").map((p) => p.port).sort((a, b) => a - b);
    const parts: string[] = [];
    if (tcp.length > 0) parts.push(`tcp:${tcp.join(",")}`);
    if (udp.length > 0) parts.push(`udp:${udp.join(",")}`);
    return parts.length > 0 ? parts.join(" | ") : null;
  } catch { return null; }
}

/** Mapping host → InventoryAssetInput (parziale). */
function buildPatchFromHost(host: Host): Partial<InventoryAssetInput> & { open_ports_summary?: string | null } {
  return {
    hostname: host.custom_name ?? host.hostname ?? host.ip,
    ip_address: host.ip,
    mac_address: host.mac ?? null,
    marca: host.vendor ?? host.device_manufacturer ?? null,
    modello: host.model ?? null,
    serial_number: host.serial_number ?? null,
    firmware_version: host.firmware ?? null,
    sistema_operativo: host.os_info ?? null,
    open_ports_summary: summarizeOpenPorts(host.open_ports),
  };
}

/** Mapping network_device → InventoryAssetInput (parziale). */
function buildPatchFromDevice(device: NetworkDevice): Partial<InventoryAssetInput> {
  return {
    hostname: device.name,
    nome_prodotto: device.name,
    marca: device.vendor ?? null,
    modello: device.model ?? null,
    serial_number: device.serial_number ?? null,
    part_number: device.part_number ?? null,
    firmware_version: device.firmware ?? null,
    ip_address: device.host,
  };
}

/**
 * Costruisce il merge finale da applicare all'asset.
 *
 * Strategia campo-per-campo:
 *   - se `force=true` → applica sempre il valore della sorgente
 *   - altrimenti → applica solo se il campo dell'asset è vuoto/null
 *
 * Le `open_ports_summary` finiscono nelle `note_tecniche` se vuote, accodate altrimenti.
 */
export function buildSyncMerge(
  asset: InventoryAsset,
  patches: Array<Partial<InventoryAssetInput> & { open_ports_summary?: string | null }>,
  force: boolean,
): { merge: InventoryAssetInput; updated: string[] } {
  const merge: Record<string, unknown> = {};
  const updated: string[] = [];

  // Unisci tutti i patch (last-write-wins per chiave, ma device viene PRIMA in input array)
  const combined: Record<string, unknown> = {};
  for (const p of patches) {
    for (const [k, v] of Object.entries(p)) {
      if (v != null && (combined[k] == null || combined[k] === "")) {
        combined[k] = v;
      }
    }
  }

  // Open ports summary: campo virtuale, lo accodiamo a note_tecniche
  const openPortsSummary = combined.open_ports_summary as string | undefined;
  delete combined.open_ports_summary;

  const assetRec = asset as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(combined)) {
    if (force || isEmpty(assetRec[k])) {
      if (v !== assetRec[k]) {
        merge[k] = v;
        updated.push(k);
      }
    }
  }

  // open_ports → annotazione in note_tecniche
  if (openPortsSummary) {
    const tag = "[discovery]";
    const existing = (asset.note_tecniche ?? "").trim();
    const newLine = `${tag} Porte aperte: ${openPortsSummary}`;
    if (!existing.includes(newLine)) {
      const cleaned = existing
        .split("\n")
        .filter((l) => !l.startsWith(`${tag} Porte aperte:`))
        .join("\n")
        .trim();
      const next = cleaned ? `${cleaned}\n${newLine}` : newLine;
      if (next !== existing) {
        merge.note_tecniche = next;
        updated.push("note_tecniche");
      }
    }
  }

  return { merge: merge as InventoryAssetInput, updated };
}

/** Costruisce la stringa identificativa della sorgente per audit/log. */
export function buildSourceLabel(assetHostId: number | null, assetDeviceId: number | null): string | null {
  const parts: string[] = [];
  if (assetDeviceId != null) parts.push(`device:${assetDeviceId}`);
  if (assetHostId != null) parts.push(`host:${assetHostId}`);
  return parts.length > 0 ? parts.join("+") : null;
}

export { buildPatchFromHost, buildPatchFromDevice };
