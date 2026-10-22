/**
 * Sincronizzazione inventario DA-INVENT → LibreNMS.
 *
 * Regole:
 * - Solo gli host con SNMP attivo (snmp_data non null) vengono aggiunti a LibreNMS
 * - I parametri SNMP (community, versione, porta) vengono letti da snmp_data
 * - Fallback: community dalla rete (snmp_community)
 * - Gli host senza SNMP vengono ignorati (non aggiunti, non rimossi)
 * - Gli host rimossi dall'inventario locale vengono rimossi anche da LibreNMS
 * - Mai `force_add` (piano 2026-10-22 LibreNMS, task 1): LibreNMS prova l'SNMP (o il ping) e rifiuta chi non risponde; il
 *   rifiuto si scrive col motivo (`scriviRifiutoLibrenms`) e non lascia una riga di mappa nuova
 */
import { credenzialeSnmpApparato, getHostsByNetwork, getNetworkById, getHostById, getNetworkDeviceById, getNetworks, haSnmpApparato } from "../db-tenant";
import { getIntegrationConfig } from "./config";
import { createLibreNMSClient, LibreNMSApiError, type CampiAggiuntaLibreNms } from "./librenms-api";
import {
  upsertLibreNMSMap,
  getLibreNMSMapByIp,
  getLibreNMSMapByDeviceIp,
  getLibreNMSMapForNetwork,
  deleteLibreNMSMap,
  scriviRifiutoLibrenms,
  togliRifiutoLibrenms,
  type CodiceRifiuto,
} from "./librenms-db";
import type { SceltaSnmpApparato } from "@/lib/credentials/resolve";
import type { LibreNMSSyncResult, HostSnmpData, NetworkDevice } from "@/types";

/** Esito di un'aggiunta (o aggiornamento) di un oggetto in LibreNMS. */
export type EsitoAggiunta =
  | { ok: true; librenms_device_id: number; aggiunto: boolean }
  | { ok: false; codice: CodiceRifiuto; messaggio: string };

/**
 * Un errore di LibreNMS in un esito. LibreNMS rifiuta un'aggiunta con HTTP 500 (o 422) e un messaggio: «Could not connect
 * to …, please check the snmp details and snmp reachability» → `snmp_non_risponde`; «Already have device …» →
 * `gia_presente`; ogni altro rifiuto (anche «Could not ping …» di un oggetto ping-only) → `rifiutato`. Senza risposta
 * HTTP (rete, timeout) → `rete`.
 */
export function esitoDaErroreLibreNms(err: unknown): { ok: false; codice: CodiceRifiuto; messaggio: string } {
  if (err instanceof LibreNMSApiError && err.status > 0) {
    const m = err.messaggioLibrenms ?? `HTTP ${err.status}`;
    if (/already (have|exists)|duplicate/i.test(m)) return { ok: false, codice: "gia_presente", messaggio: m };
    if (/snmp/i.test(m)) return { ok: false, codice: "snmp_non_risponde", messaggio: m };
    return { ok: false, codice: "rifiutato", messaggio: m };
  }
  return { ok: false, codice: "rete", messaggio: err instanceof Error ? err.message : String(err) };
}

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
  // Per gli host senza apparato non c'è altra informazione sulla versione: v2c (piano 2026-10-22 LibreNMS, task 1).
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

  // v0.2.638 audit B6: probe diagnostico (token scaduto vs server down vs altro)
  const probe = await client.probe();
  if (!probe.ok) {
    result.errors.push(`LibreNMS ${cfg.url}: ${probe.message}`);
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
  const existingLibreNMSDevices = new Map<string, number>();
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

  // Throttle intra-batch: piccolo jitter tra chiamate API per non saturare
  // LibreNMS quando il numero di host SNMP del network è grande. 50-150ms
  // tra host è invisibile all'utente ma evita burst su 50+ device.
  for (let hi = 0; hi < snmpHosts.length; hi++) {
    const host = snmpHosts[hi];
    if (hi > 0) {
      await new Promise((r) => setTimeout(r, 50 + Math.floor(Math.random() * 100)));
    }
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
          try {
            deviceId = await client.addDevice({
              hostname,
              ...snmpParams,          // community, snmpver, port
              snmp_disable: false,
              sysName:  sysName              ?? undefined,
              hardware: host.model           ?? undefined,
              serial:   host.serial_number   ?? undefined,
            });
          } catch (err) {
            // Rifiutato da LibreNMS (SNMP che non risponde, …): il motivo si scrive, nessuna riga di mappa nuova.
            const e = esitoDaErroreLibreNms(err);
            if (e.codice !== "rete") scriviRifiutoLibrenms(host.ip, { hostId: host.id, codice: e.codice, motivo: e.messaggio });
            throw err;
          }
          togliRifiutoLibrenms(host.ip);
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

/** I campi di un'aggiunta o di un aggiornamento senza `motivo` (che resta a DA-IPAM: a LibreNMS parte solo `snmp_disable`). */
function campiDaInviare(c: CampiSnmpLibreNms): Omit<CampiAggiuntaLibreNms, "hostname"> {
  if (c.snmp_disable) return { snmp_disable: true };
  return c;
}

/**
 * Aggiunge o aggiorna un singolo host in LibreNMS. Senza SNMP l'host va in ping-only (`snmp_disable: true`), come prima,
 * ma senza `force_add`: un oggetto che non risponde LibreNMS lo rifiuta, e il rifiuto torna come esito col motivo (scritto
 * in `librenms_rifiuto`), non come eccezione. Lancia solo per un errore di DA-IPAM (host assente, LibreNMS non configurato).
 */
export async function addSingleHostToLibreNMS(hostId: number): Promise<EsitoAggiunta> {
  const cfg = getIntegrationConfig("librenms");
  if (cfg.mode === "disabled" || !cfg.url || !cfg.apiToken) {
    throw new Error("LibreNMS non configurato o disabilitato");
  }

  const host = getHostById(hostId);
  if (!host) throw new Error("Host non trovato");

  const network = getNetworkById(host.network_id);
  const networkCommunity = network?.snmp_community ?? null;

  const snmpData   = parseSnmpData(host.snmp_data ?? null);
  const snmpParams = resolveSnmpParams(snmpData, networkCommunity);
  // snmpParams può essere null: in quel caso aggiungiamo a LibreNMS in modalità ping-only

  const client = createLibreNMSClient(cfg.url, cfg.apiToken);
  // v0.2.638 audit B6: messaggio chiaro al caller (UI) invece di generico.
  const probe = await client.probe();
  if (!probe.ok) return { ok: false, codice: "rete", messaggio: `LibreNMS ${cfg.url}: ${probe.message}` };

  const hostname = pickHostname(host.ip);
  const sysName  = pickSysName(host.hostname, host.custom_name);
  const existing = getLibreNMSMapByIp(host.network_id, host.ip);

  // Campi SNMP da aggiornare/inviare (vuoto se ping-only)
  const snmpFields: Omit<CampiAggiuntaLibreNms, "hostname"> = snmpParams
    ? { community: snmpParams.community, snmpver: snmpParams.snmpver, port: snmpParams.port, snmp_disable: false }
    : { snmp_disable: true };
  const metadati = {
    ...(sysName            ? { sysName }                        : {}),
    ...(host.model         ? { hardware: host.model }           : {}),
    ...(host.serial_number ? { serial: host.serial_number }     : {}),
  };

  try {
    if (existing) {
      await client.updateDevice(existing.librenms_device_id, { ...snmpFields, ...metadati });
      upsertLibreNMSMap(host.network_id, host.ip, existing.librenms_device_id, hostname, host.status ?? null);
      return { ok: true, librenms_device_id: existing.librenms_device_id, aggiunto: false };
    }

    // Controlla se il device è già in LibreNMS per IP
    const existingDevice = await client.getDeviceByHostname(host.ip);
    let deviceId: number;
    if (existingDevice) {
      deviceId = existingDevice.device_id;
      await client.updateDevice(deviceId, { ...snmpFields, ...metadati });
    } else {
      deviceId = await client.addDevice({ hostname, ...snmpFields, ...metadati });
      togliRifiutoLibrenms(host.ip);
    }

    upsertLibreNMSMap(host.network_id, host.ip, deviceId, hostname, host.status ?? null);
    return { ok: true, librenms_device_id: deviceId, aggiunto: !existingDevice };
  } catch (err) {
    const e = esitoDaErroreLibreNms(err);
    if (e.codice !== "rete") scriviRifiutoLibrenms(host.ip, { hostId: host.id, codice: e.codice, motivo: e.messaggio });
    return e;
  }
}

/** I campi SNMP di un apparato per LibreNMS, o perché non si mandano (`motivo`, resta a DA-IPAM). */
export type CampiSnmpLibreNms =
  | { snmpver: "v1" | "v2c"; community: string; port: number; snmp_disable: false }
  | {
      snmpver: "v3"; authlevel: "noAuthNoPriv" | "authNoPriv" | "authPriv"; authname: string;
      authpass?: string; authalgo?: string; cryptopass?: string; cryptoalgo?: string; port: number; snmp_disable: false;
    }
  | { snmp_disable: true; motivo: string };

/**
 * Algoritmi SNMPv3 di DA-IPAM (`SNMP_V3_AUTH_PROTOCOLS`, `SNMP_V3_PRIV_PROTOCOLS` in `protocols/snmp-sessione.ts`) nei
 * valori che LibreNMS accetta. AES256C (AES-256 di Reeder, «Cisco») non c'è: LibreNMS non lo dichiara, e un valore fuori
 * tabella non si manda (piano 2026-10-22 LibreNMS, task 1, caso 5).
 */
const AUTH_LIBRENMS: Readonly<Record<string, string>> = {
  MD5: "MD5", SHA: "SHA", SHA224: "SHA-224", SHA256: "SHA-256", SHA384: "SHA-384", SHA512: "SHA-512",
};
const PRIV_LIBRENMS: Readonly<Record<string, string>> = { DES: "DES", AES: "AES", AES192: "AES-192", AES256: "AES-256" };

/**
 * Traduzione pura della credenziale SNMP di un apparato (`credenzialeSnmpApparato`) nei campi di LibreNMS. La versione
 * viene dalla credenziale: una community è v1 se l'apparato è `snmp_version = '1'` (gli airFiber), altrimenti v2c; una v3
 * parte come v3 con utente, livello e algoritmi. Una scelta non riuscita, la «public» di ripiego, un livello o un algoritmo
 * che LibreNMS non accetta, una chiave mancante → `snmp_disable` col motivo.
 */
export function campiSnmpDaScelta(scelta: SceltaSnmpApparato, snmpVersion: string | null | undefined): CampiSnmpLibreNms {
  if (!scelta.ok) return { snmp_disable: true, motivo: scelta.motivo };
  if (scelta.fonte === "snmp_ripiego") return { snmp_disable: true, motivo: "solo la community «public» di ripiego" };
  const port = scelta.port;
  if (scelta.cred.forma === "community") {
    return { snmpver: snmpVersion === "1" ? "v1" : "v2c", community: scelta.cred.community, port, snmp_disable: false };
  }
  const r = scelta.cred.record;
  const livello = r.securityLevel;
  if (livello !== "noAuthNoPriv" && livello !== "authNoPriv" && livello !== "authPriv") {
    return { snmp_disable: true, motivo: `livello SNMPv3 «${livello}» non accettato da LibreNMS` };
  }
  if (!r.username) return { snmp_disable: true, motivo: "utente SNMPv3 vuoto" };
  const out: CampiSnmpLibreNms = { snmpver: "v3", authlevel: livello, authname: r.username, port, snmp_disable: false };
  if (livello === "noAuthNoPriv") return out;
  const authalgo = AUTH_LIBRENMS[(r.authProtocol ?? "").toUpperCase()];
  if (!authalgo) return { snmp_disable: true, motivo: `algoritmo di autenticazione «${r.authProtocol ?? ""}» non accettato da LibreNMS` };
  if (!r.authKey) return { snmp_disable: true, motivo: "chiave di autenticazione SNMPv3 assente" };
  out.authalgo = authalgo;
  out.authpass = r.authKey;
  if (livello === "authNoPriv") return out;
  const cryptoalgo = PRIV_LIBRENMS[(r.privProtocol ?? "").toUpperCase()];
  if (!cryptoalgo) return { snmp_disable: true, motivo: `algoritmo di cifratura «${r.privProtocol ?? ""}» non accettato da LibreNMS` };
  if (!r.privKey) return { snmp_disable: true, motivo: "chiave di cifratura SNMPv3 assente" };
  out.cryptoalgo = cryptoalgo;
  out.cryptopass = r.privKey;
  return out;
}

/**
 * Campi SNMP di un apparato per LibreNMS (aggiunta e aggiornamento), dal motore unico (tappa 2 credenziali, T8): la
 * credenziale decifrata parte solo se l'apparato ha una fonte SNMP sua e la scelta non è «public» di ripiego; altrimenti
 * `snmp_disable: true` (ping-only) col motivo. Dal 22/10 anche v1 e v3 (prima tutto partiva come v2c e una v3 non partiva).
 */
export function campiSnmpPerLibreNms(device: NetworkDevice): CampiSnmpLibreNms {
  if (!haSnmpApparato(device)) return { snmp_disable: true, motivo: "nessuna credenziale SNMP dell'apparato" };
  return campiSnmpDaScelta(credenzialeSnmpApparato(device), device.snmp_version);
}

/**
 * Aggiunge o aggiorna un singolo NetworkDevice (router/switch) in LibreNMS.
 * Usa network_id = 0 come sentinella nella mappa locale. Senza SNMP va in ping-only, senza `force_add`: un rifiuto torna
 * come esito col motivo (scritto in `librenms_rifiuto`).
 */
export async function addSingleNetworkDeviceToLibreNMS(deviceId: number): Promise<EsitoAggiunta> {
  const cfg = getIntegrationConfig("librenms");
  if (cfg.mode === "disabled" || !cfg.url || !cfg.apiToken) {
    throw new Error("LibreNMS non configurato o disabilitato");
  }

  const device = getNetworkDeviceById(deviceId);
  if (!device) throw new Error("Dispositivo non trovato");

  const client = createLibreNMSClient(cfg.url, cfg.apiToken);
  // v0.2.638 audit B6: messaggio chiaro al caller (UI) invece di generico.
  const probe = await client.probe();
  if (!probe.ok) return { ok: false, codice: "rete", messaggio: `LibreNMS ${cfg.url}: ${probe.message}` };

  const hostname = device.host; // IP come hostname per polling affidabile
  const sysName  = device.sysname || device.name || undefined;

  // Parametri SNMP se disponibili (gli stessi per aggiornamento e aggiunta)
  const snmpFields = campiDaInviare(campiSnmpPerLibreNms(device));
  const metadati = {
    ...(sysName              ? { sysName }                       : {}),
    ...(device.model         ? { hardware: device.model }        : {}),
    ...(device.serial_number ? { serial: device.serial_number }  : {}),
  };

  const existing = getLibreNMSMapByDeviceIp(device.host);

  try {
    if (existing) {
      await client.updateDevice(existing.librenms_device_id, { ...snmpFields, ...metadati });
      upsertLibreNMSMap(0, device.host, existing.librenms_device_id, hostname, null);
      return { ok: true, librenms_device_id: existing.librenms_device_id, aggiunto: false };
    }

    // Controlla se il device è già in LibreNMS per IP
    const existingDevice = await client.getDeviceByHostname(device.host);
    let librenmsId: number;
    if (existingDevice) {
      librenmsId = existingDevice.device_id;
      await client.updateDevice(librenmsId, { ...snmpFields, ...metadati });
    } else {
      librenmsId = await client.addDevice({ hostname, ...snmpFields, ...metadati });
      togliRifiutoLibrenms(device.host);
    }

    upsertLibreNMSMap(0, device.host, librenmsId, hostname, null);
    return { ok: true, librenms_device_id: librenmsId, aggiunto: !existingDevice };
  } catch (err) {
    const e = esitoDaErroreLibreNms(err);
    if (e.codice !== "rete") scriviRifiutoLibrenms(device.host, { networkDeviceId: device.id, codice: e.codice, motivo: e.messaggio });
    return e;
  }
}

/**
 * Sincronizza tutte le reti del tenant verso LibreNMS in modo NON-contemporaneo.
 *
 * Pattern (post-incident 2026-05-25):
 * - Sequenziale tra network (mai 2 sync in parallelo).
 * - Inter-network jitter randomico 500-2000 ms tra una rete e la successiva,
 *   per spalmare le chiamate API verso LibreNMS e ridurre il rischio di rate-limit
 *   o picchi locali quando il numero di reti cresce.
 * - Pre-jitter iniziale (0-1000 ms) per evitare burst contemporaneo se più
 *   tenant lanciano il sync allo stesso minuto di scheduling.
 *
 * Deve essere chiamata con contesto tenant attivo.
 */
export async function syncAllNetworksToLibreNMS(): Promise<LibreNMSSyncResult[]> {
  // getNetworks va importato STATICAMENTE (riga 11). Con `await import()` tsx
  // restituisce una SECONDA istanza del modulo, con la propria AsyncLocalStorage
  // vuota: getCurrentTenantCode() torna null e ogni accesso al DB tenant muore
  // con "Nessun contesto tenant". Non si vede sui build Next (il bundler
  // deduplica), solo sulle installazioni che girano da sorgente con tsx —
  // dove il job schedulato librenms_sync falliva a ogni esecuzione.
  const networks = getNetworks();
  const results: LibreNMSSyncResult[] = [];

  // Pre-jitter: spalma l'avvio su 1s se più tenant cadono sullo stesso slot cron.
  await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 1000)));

  for (let i = 0; i < networks.length; i++) {
    const net = networks[i];
    const r = await syncNetworkToLibreNMS(net.id);
    results.push(r);

    // Jitter tra network successive (escluso dopo l'ultima).
    if (i < networks.length - 1) {
      const jitterMs = 500 + Math.floor(Math.random() * 1500);
      await new Promise((res) => setTimeout(res, jitterMs));
    }
  }
  return results;
}
