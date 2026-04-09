/**
 * Sincronizzazione inventario DA-INVENT → LibreNMS.
 *
 * Regole:
 * - Solo gli host con SNMP attivo (snmp_data non null) vengono aggiunti a LibreNMS
 * - I parametri SNMP (community, versione, porta) vengono letti da snmp_data
 * - Fallback: community dalla rete (snmp_community)
 * - Gli host senza SNMP vengono ignorati (non aggiunti, non rimossi)
 * - Gli host rimossi dall'inventario locale vengono rimossi anche da LibreNMS
 */
import { getHostsByNetwork, getNetworkById, getHostById } from "../db-tenant";
import { getIntegrationConfig } from "./config";
import { createLibreNMSClient } from "./librenms-api";
import {
  upsertLibreNMSMap,
  getLibreNMSMapByIp,
  getLibreNMSMapForNetwork,
  deleteLibreNMSMap,
} from "./librenms-db";
import type { LibreNMSSyncResult, HostSnmpData } from "@/types";

/**
 * LibreNMS usa "hostname" come indirizzo di polling SNMP/ICMP.
 * Usiamo sempre l'IP per garantire raggiungibilità,
 * il nome DNS/custom va in sysName come attributo descrittivo.
 */
function pickHostname(ip: string): string {
  return ip;
}

/** Ritorna il sysName da passare a LibreNMS come nome visualizzato */
function pickSysName(hostname?: string | null, customName?: string | null): string | undefined {
  if (hostname && hostname.trim()) return hostname.trim();
  if (customName && customName.trim()) return customName.trim();
  return undefined;
}

/** Parsa il JSON snmp_data in modo sicuro */
function parseSnmpData(raw: string | null): HostSnmpData | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as HostSnmpData;
  } catch {
    return null;
  }
}

/**
 * Ricava i parametri SNMP da passare a LibreNMS.
 * Priorità: snmp_data.community > network.snmp_community > "public"
 */
function resolveSnmpParams(
  snmpData: HostSnmpData | null,
  networkCommunity: string | null | undefined
): { community: string; snmpver: "v2c"; port: number } | null {
  // Se non c'è snmp_data, non abbiamo conferma che SNMP sia attivo su questo host
  if (!snmpData) return null;

  const community =
    (snmpData.community && snmpData.community.trim()) ||
    (networkCommunity && networkCommunity.trim()) ||
    null;

  if (!community) return null; // Nessuna community disponibile → skip

  return {
    community,
    snmpver: "v2c",
    port: snmpData.port ?? 161,
  };
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

  const alive = await client.ping();
  if (!alive) {
    result.errors.push(`LibreNMS non raggiungibile a ${cfg.url}`);
    return result;
  }

  // Recupera la rete per avere snmp_community di fallback
  const network = getNetworkById(networkId);
  const networkCommunity = network?.snmp_community ?? null;

  const allHosts = getHostsByNetwork(networkId);
  if (!allHosts.length) return result;

  // Solo host con SNMP attivo (snmp_data presente e con community risolvibile)
  const snmpHosts = allHosts.filter((h) => {
    const snmpData = parseSnmpData(h.snmp_data);
    return resolveSnmpParams(snmpData, networkCommunity) !== null;
  });

  if (snmpHosts.length === 0) {
    result.errors.push(
      `Nessun host con SNMP attivo trovato nella rete. ` +
      `Esegui una scansione SNMP prima di sincronizzare.`
    );
    return result;
  }

  // Device già censiti in LibreNMS (per evitare duplicati)
  let existingLibreNMSDevices = new Map<string, number>();
  try {
    const devices = await client.getDevices();
    for (const d of devices) {
      if (d.ip) existingLibreNMSDevices.set(d.ip, d.device_id);
      if (d.hostname) existingLibreNMSDevices.set(d.hostname, d.device_id);
    }
  } catch (err) {
    result.errors.push(`Errore fetch device LibreNMS: ${err instanceof Error ? err.message : String(err)}`);
    return result;
  }

  for (const host of snmpHosts) {
    try {
      const snmpData   = parseSnmpData(host.snmp_data)!;
      const snmpParams = resolveSnmpParams(snmpData, networkCommunity)!;
      const hostname   = pickHostname(host.ip);  // sempre IP per polling affidabile
      const sysName    = pickSysName(host.hostname, host.custom_name);
      const existing   = getLibreNMSMapByIp(networkId, host.ip);

      if (existing) {
        // Aggiorna parametri SNMP + metadati (community aggiornabile via PATCH)
        const updateFields: Record<string, unknown> = {
          community: snmpParams.community,
          snmpver:   snmpParams.snmpver,
          port:      snmpParams.port,
          snmp_disable: false,
        };
        if (sysName)            updateFields.sysName  = sysName;
        if (host.model)         updateFields.hardware = host.model;
        if (host.serial_number) updateFields.serial   = host.serial_number;

        await client.updateDevice(existing.librenms_device_id, updateFields);
        upsertLibreNMSMap(networkId, host.ip, existing.librenms_device_id, hostname, host.status ?? null);
        result.updated++;
      } else {
        const existingId = existingLibreNMSDevices.get(host.ip);

        let deviceId: number;
        if (existingId != null) {
          // Device già in LibreNMS (aggiunto manualmente): aggiorna le credenziali SNMP
          deviceId = existingId;
          await client.updateDevice(deviceId, {
            community:    snmpParams.community,
            snmpver:      snmpParams.snmpver,
            port:         snmpParams.port,
            snmp_disable: false,
            ...(sysName            ? { sysName }            : {}),
            ...(host.model         ? { hardware: host.model }         : {}),
            ...(host.serial_number ? { serial: host.serial_number } : {}),
          });
        } else {
          deviceId = await client.addDevice({
            hostname,
            ...snmpParams,          // community, snmpver, port
            snmp_disable: false,
            force_add: true,
            sysName:  sysName              ?? undefined,
            hardware: host.model           ?? undefined,
            serial:   host.serial_number   ?? undefined,
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

  // Rimuovi da LibreNMS gli host che non sono più nell'inventario locale
  try {
    const snmpIps = new Set(snmpHosts.map((h) => h.ip));
    const allMaps = getLibreNMSMapForNetwork(networkId);
    for (const map of allMaps) {
      if (!snmpIps.has(map.host_ip)) {
        try {
          await client.deleteDevice(map.librenms_device_id);
        } catch { /* già rimosso da LibreNMS */ }
        deleteLibreNMSMap(networkId, map.host_ip);
      }
    }
  } catch (err) {
    result.errors.push(`Cleanup: ${err instanceof Error ? err.message : String(err)}`);
  }

  return result;
}

/**
 * Aggiunge o aggiorna un singolo host in LibreNMS.
 * Ritorna il device_id LibreNMS assegnato.
 * Lancia eccezione in caso di errore (SNMP non disponibile, LibreNMS non raggiungibile, ecc.).
 */
export async function addSingleHostToLibreNMS(
  hostId: number
): Promise<{ librenms_device_id: number; added: boolean }> {
  const cfg = getIntegrationConfig("librenms");
  if (cfg.mode === "disabled" || !cfg.url || !cfg.apiToken) {
    throw new Error("LibreNMS non configurato o disabilitato");
  }

  const host = getHostById(hostId);
  if (!host) throw new Error("Host non trovato");

  const network = getNetworkById(host.network_id);
  const networkCommunity = network?.snmp_community ?? null;

  const snmpData = parseSnmpData(host.snmp_data ?? null);
  const snmpParams = resolveSnmpParams(snmpData, networkCommunity);
  if (!snmpParams) {
    throw new Error("Host senza dati SNMP. Esegui prima una scansione SNMP.");
  }

  const client = createLibreNMSClient(cfg.url, cfg.apiToken);
  const alive = await client.ping();
  if (!alive) throw new Error(`LibreNMS non raggiungibile a ${cfg.url}`);

  const hostname = pickHostname(host.ip);
  const sysName  = pickSysName(host.hostname, host.custom_name);
  const existing = getLibreNMSMapByIp(host.network_id, host.ip);

  if (existing) {
    await client.updateDevice(existing.librenms_device_id, {
      community:    snmpParams.community,
      snmpver:      snmpParams.snmpver,
      port:         snmpParams.port,
      snmp_disable: false,
      ...(sysName            ? { sysName }                        : {}),
      ...(host.model         ? { hardware: host.model }           : {}),
      ...(host.serial_number ? { serial: host.serial_number }     : {}),
    });
    upsertLibreNMSMap(host.network_id, host.ip, existing.librenms_device_id, hostname, host.status ?? null);
    return { librenms_device_id: existing.librenms_device_id, added: false };
  }

  // Controlla se il device è già in LibreNMS per IP
  const existingDevice = await client.getDeviceByHostname(host.ip);
  let deviceId: number;
  if (existingDevice) {
    deviceId = existingDevice.device_id;
    await client.updateDevice(deviceId, {
      community:    snmpParams.community,
      snmpver:      snmpParams.snmpver,
      port:         snmpParams.port,
      snmp_disable: false,
      ...(sysName            ? { sysName }                        : {}),
      ...(host.model         ? { hardware: host.model }           : {}),
      ...(host.serial_number ? { serial: host.serial_number }     : {}),
    });
  } else {
    deviceId = await client.addDevice({
      hostname,
      ...snmpParams,
      snmp_disable: false,
      force_add:    true,
      sysName:      sysName            ?? undefined,
      hardware:     host.model         ?? undefined,
      serial:       host.serial_number ?? undefined,
    });
  }

  upsertLibreNMSMap(host.network_id, host.ip, deviceId, hostname, host.status ?? null);
  return { librenms_device_id: deviceId, added: !existingDevice };
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
