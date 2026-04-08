/**
 * Sincronizzazione inventario DA-INVENT → LibreNMS.
 *
 * Flusso per ogni rete:
 *  1. Carica tutti gli host del network_id (solo online o known)
 *  2. Per ogni host: controlla se c'è già un record in librenms_host_map
 *     - Se non esiste: addDevice() → salva mapping
 *     - Se esiste: updateDevice() con dati aggiornati (hostname, hardware, serial)
 *  3. Opzionale: per gli host eliminati dall'inventario locale → deleteDevice()
 */
import { getHostsByNetwork } from "../db-tenant";
import { getIntegrationConfig } from "./config";
import { createLibreNMSClient } from "./librenms-api";
import {
  upsertLibreNMSMap,
  getLibreNMSMapByIp,
  getLibreNMSMapForNetwork,
  deleteLibreNMSMap,
} from "./librenms-db";
import type { LibreNMSSyncResult } from "@/types";

/** Determina quale nome/IP passare a LibreNMS come hostname principale */
function pickHostname(ip: string, hostname?: string | null, customName?: string | null): string {
  if (hostname && hostname.trim()) return hostname.trim();
  if (customName && customName.trim()) return customName.trim();
  return ip;
}

/**
 * Sincronizza una singola rete verso LibreNMS.
 * Deve essere chiamata con contesto tenant attivo.
 */
export async function syncNetworkToLibreNMS(networkId: number): Promise<LibreNMSSyncResult> {
  const result: LibreNMSSyncResult = { networkId, added: 0, updated: 0, skipped: 0, errors: [] };

  const cfg = getIntegrationConfig("librenms");
  if (cfg.mode === "disabled" || !cfg.url || !cfg.apiToken) {
    result.errors.push("LibreNMS non configurato o disabilitato");
    return result;
  }

  const client = createLibreNMSClient(cfg.url, cfg.apiToken);

  // Verifica raggiungibilità
  const alive = await client.ping();
  if (!alive) {
    result.errors.push(`LibreNMS non raggiungibile a ${cfg.url}`);
    return result;
  }

  const hosts = getHostsByNetwork(networkId);
  if (!hosts.length) return result;

  // Ottieni i device già censiti in LibreNMS per confronto
  let existingLibreNMSDevices: Map<string, number> = new Map();
  try {
    const devices = await client.getDevices();
    for (const d of devices) {
      // Index per IP (se disponibile) e per hostname
      if (d.ip) existingLibreNMSDevices.set(d.ip, d.device_id);
      if (d.hostname) existingLibreNMSDevices.set(d.hostname, d.device_id);
    }
  } catch (err) {
    result.errors.push(`Errore fetch device LibreNMS: ${err instanceof Error ? err.message : String(err)}`);
    return result;
  }

  for (const host of hosts) {
    try {
      const hostname = pickHostname(host.ip, host.hostname, host.custom_name);
      const existing = getLibreNMSMapByIp(networkId, host.ip);

      if (existing) {
        // Aggiorna attributi se sono cambiati
        const updateFields: Record<string, unknown> = {};
        if (host.hostname && host.hostname !== existing.librenms_hostname) {
          updateFields.sysName = host.hostname;
        }
        if (host.model) updateFields.hardware = host.model;
        if (host.serial_number) updateFields.serial = host.serial_number;

        if (Object.keys(updateFields).length > 0) {
          await client.updateDevice(existing.librenms_device_id, updateFields);
        }

        upsertLibreNMSMap(
          networkId,
          host.ip,
          existing.librenms_device_id,
          hostname,
          host.status ?? null
        );
        result.updated++;
      } else {
        // Il device potrebbe già esistere in LibreNMS (aggiunto manualmente)
        const existingId = existingLibreNMSDevices.get(host.ip) ?? existingLibreNMSDevices.get(hostname);

        let deviceId: number;
        if (existingId != null) {
          deviceId = existingId;
          // Solo aggiorna il mapping
        } else {
          // Aggiungi il device a LibreNMS
          deviceId = await client.addDevice({
            hostname,
            snmp_disable: !host.snmp_data, // disabilita SNMP se non abbiamo dati
            force_add: true,
            sysName: host.hostname ?? undefined,
            hardware: host.model ?? undefined,
            serial: host.serial_number ?? undefined,
          });
        }

        upsertLibreNMSMap(networkId, host.ip, deviceId, hostname, host.status ?? null);
        result.added++;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`${host.ip}: ${msg}`);
      result.skipped++;
    }
  }

  // Rimuovi mapping per host non più presenti nell'inventario locale
  try {
    const hostIps = new Set(hosts.map((h) => h.ip));
    const allMaps = getLibreNMSMapForNetwork(networkId);
    for (const map of allMaps) {
      if (!hostIps.has(map.host_ip)) {
        try {
          await client.deleteDevice(map.librenms_device_id);
        } catch {
          // Se il device non esiste più in LibreNMS, ignora l'errore
        }
        deleteLibreNMSMap(networkId, map.host_ip);
      }
    }
  } catch (err) {
    result.errors.push(`Cleanup: ${err instanceof Error ? err.message : String(err)}`);
  }

  return result;
}

/**
 * Sincronizza tutte le reti del tenant corrente verso LibreNMS.
 * Deve essere chiamata con contesto tenant attivo.
 */
export async function syncAllNetworksToLibreNMS(): Promise<LibreNMSSyncResult[]> {
  const { getNetworks } = await import("../db-tenant");
  const networks = getNetworks();
  const results: LibreNMSSyncResult[] = [];
  for (const net of networks) {
    const r = await syncNetworkToLibreNMS(net.id);
    results.push(r);
  }
  return results;
}
