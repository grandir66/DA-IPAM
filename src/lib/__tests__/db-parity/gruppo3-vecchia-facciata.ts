/**
 * Copia CONGELATA delle ultime tre funzioni dati della facciata `db.ts`
 * (`resolveMacToNetworkDevice`, `resolveMacToDevice`, `updateHostIfExists`)
 * com'erano prima dello spostamento in `db-tenant.ts` (T3-08, NUC-2 gruppo 3).
 * Dopo lo spostamento `db.ts` le riesporta: la parità si prova contro questa
 * copia. Testo identico all'originale, compreso l'aiutante locale `MAC_HEX`; le
 * funzioni che l'originale prendeva da `./db-tenant` (`getHostByMac`,
 * `upsertHost`, già spostate in T3-07) e gli aiutanti puntano a `@/lib/…`
 * perché la copia vive in un'altra cartella. Non si modifica.
 */
import { getDb } from "@/lib/db";
import { getHostByMac, upsertHost } from "@/lib/db-tenant";
import { macToHex } from "@/lib/utils";
import type { Host, HostInput } from "@/types";

/** Confronto MAC normalizzato (ignora : - .) per match cross-vendor */
const MAC_HEX = (col: string) => `UPPER(REPLACE(REPLACE(REPLACE(COALESCE(${col},''), ':', ''), '-', ''), '.', ''))`;


/** Resolve MAC to a registered network device (router/switch) via ARP or hosts. Used to identify trunk peer when LLDP/CDP unavailable. */
export function resolveMacToNetworkDevice(mac: string, excludeDeviceId?: number): { device_id: number; device_name: string; device_type: string } | null {
  let ip: string | null = null;
  const host = getHostByMac(mac);
  if (host) ip = host.ip;
  if (!ip) {
    const hex = macToHex(mac);
    const arp = getDb().prepare(
      `SELECT ip FROM arp_entries WHERE ${MAC_HEX("mac")} = ? AND ip IS NOT NULL ORDER BY timestamp DESC LIMIT 1`
    ).get(hex) as { ip: string } | undefined;
    ip = arp?.ip ?? null;
  }
  if (!ip) return null;
  const nd = getDb().prepare(
    "SELECT id, name, device_type FROM network_devices WHERE host = ? AND (enabled = 1 OR enabled IS NULL)"
  ).get(ip) as { id: number; name: string; device_type: string } | undefined;
  if (!nd || (excludeDeviceId != null && nd.id === excludeDeviceId)) return null;
  return { device_id: nd.id, device_name: nd.name, device_type: nd.device_type };
}

/** Resolve MAC to device info from hosts (IPAM), arp_entries e mac_ip_mapping, per switch port e tabella ARP */
export function resolveMacToDevice(mac: string): { ip: string | null; hostname: string | null; vendor: string | null; host_id: number | null } {
  const host = getHostByMac(mac);
  if (host) {
    return {
      ip: host.ip,
      hostname: host.custom_name || host.hostname,
      vendor: host.vendor,
      host_id: host.id,
    };
  }
  const hex = macToHex(mac);
  const arp = getDb().prepare(
    `SELECT ip FROM arp_entries WHERE ${MAC_HEX("mac")} = ? AND ip IS NOT NULL ORDER BY timestamp DESC LIMIT 1`
  ).get(hex) as { ip: string } | undefined;
  if (arp?.ip) {
    return { ip: arp.ip, hostname: null, vendor: null, host_id: null };
  }
  const mapping = getDb().prepare(
    "SELECT ip, hostname, vendor, host_id FROM mac_ip_mapping WHERE mac_normalized = ?"
  ).get(hex) as { ip: string; hostname: string | null; vendor: string | null; host_id: number | null } | undefined;
  return {
    ip: mapping?.ip ?? null,
    hostname: mapping?.hostname ?? null,
    vendor: mapping?.vendor ?? null,
    host_id: mapping?.host_id ?? null,
  };
}

/**
 * UPDATE-only: aggiorna solo host già esistenti (network_id+ip). MAI inserisce.
 * Da usare nelle fonti passive (ARP/DHCP/AD/DNS): un router risponde con entry ARP
 * o lease DHCP anche per dispositivi spenti/dismessi — non vogliamo che riempiano
 * il DB. Solo i probe attivi (ICMP/TCP/nmap di discovery.ts) creano host nuovi.
 * Ritorna null se l'host non esiste.
 */
export function updateHostIfExists(input: HostInput & { mac?: string; vendor?: string; hostname?: string; hostname_source?: string; dns_forward?: string; dns_reverse?: string; status?: "online" | "offline" | "unknown"; os_info?: string; model?: string; serial_number?: string; firmware?: string | null; device_manufacturer?: string | null }): Host | null {
  const existing = getDb()
    .prepare("SELECT id FROM hosts WHERE network_id = ? AND ip = ?")
    .get(input.network_id, input.ip) as { id: number } | undefined;
  if (!existing) return null;
  return upsertHost(input) as Host;
}
