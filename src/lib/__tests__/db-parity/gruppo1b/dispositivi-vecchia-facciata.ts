/**
 * Copia CONGELATA delle funzioni del dominio «apparati, job e Proxmox» com'erano nella facciata
 * `db.ts` prima dello spostamento in `db-tenant.ts` (commit 7b25872, T3-06,
 * NUC-2 gruppo 1b). Dopo lo spostamento `db.ts` le riesporta: la parità si prova
 * contro questa copia, come per il gruppo 0. Testo identico all'originale, salvo
 * i moduli presi con `import("./x")` o `require("./x")`, che puntano a `@/lib/x` perché la copia vive
 * in un'altra cartella; non si modifica. Generata dal parser di TypeScript, con gli
 * aiutanti locali che usava.
 */
import { getDb } from "@/lib/db";
import type { NetworkDevice } from "@/types";

type CreateDeviceInput = Omit<NetworkDevice, "id" | "created_at" | "updated_at" | "sysname" | "sysdescr" | "model" | "firmware" | "serial_number" | "part_number" | "last_info_update" | "last_device_info_json" | "classification" | "stp_info" | "last_proxmox_scan_at" | "last_proxmox_scan_result" | "scan_target" | "product_profile" | "use_for_arp_poll" | "physical_device_id"> & {
  classification?: string | null;
  scan_target?: string | null;
  product_profile?: string | null;
  use_for_arp_poll?: number | boolean | null;
  /** F4: opzionale — se non passato, lookup automatico via IP. */
  host_id?: number | null;
};

export function createNetworkDevice(input: CreateDeviceInput): NetworkDevice {
  // F4: auto-lookup host_id da IP se non passato esplicitamente.
  let hostId: number | null = input.host_id ?? null;
  if (hostId === null && input.host) {
    const match = getDb().prepare("SELECT id FROM hosts WHERE ip = ? ORDER BY id LIMIT 1").get(input.host) as { id: number } | undefined;
    if (match) hostId = match.id;
  }

  const stmt = getDb().prepare(
    `INSERT INTO network_devices (name, host, device_type, vendor, vendor_subtype, protocol, credential_id, snmp_credential_id, username, encrypted_password, community_string, api_token, api_url, port, enabled, classification, scan_target, product_profile, use_for_arp_poll, host_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const result = stmt.run(
    input.name, input.host, input.device_type, input.vendor,
    input.vendor_subtype ?? null, input.protocol,
    input.credential_id ?? null, (input as { snmp_credential_id?: number | null }).snmp_credential_id ?? null,
    input.username, input.encrypted_password,
    input.community_string, input.api_token, input.api_url, input.port, input.enabled,
    (input as { classification?: string | null }).classification ?? null,
    (input as { scan_target?: string | null }).scan_target ?? null,
    (input as { product_profile?: string | null }).product_profile ?? null,
    ((): number => {
      const f = (input as { use_for_arp_poll?: number | boolean | null }).use_for_arp_poll;
      if (f === 1 || f === true) return 1;
      if (f === 0 || f === false) return 0;
      return input.device_type === "router" || input.device_type === "firewall" || input.vendor === "stormshield" ? 1 : 0;
    })(),
    hostId
  );
  return getDb().prepare("SELECT * FROM network_devices WHERE id = ?").get(result.lastInsertRowid) as NetworkDevice;
}
