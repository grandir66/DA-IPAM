/**
 * Copia CONGELATA delle funzioni del dominio «inventario e licenze» com'erano nella facciata
 * `db.ts` prima dello spostamento in `db-tenant.ts` (commit 38ddee0, T3-06,
 * NUC-2 gruppo 1b). Dopo lo spostamento `db.ts` le riesporta: la parità si prova
 * contro questa copia, come per il gruppo 0. Testo identico all'originale; non si
 * modifica. Generata dal parser di TypeScript, con gli aiutanti locali che usava.
 */
import { getDb, updateInventoryAsset } from "@/lib/db";
import type { NetworkDevice, Host } from "@/types";
import { getInventoryAssetByNetworkDevice, getInventoryAssetByHost } from "@/lib/db-tenant";
import { randomUUID } from "crypto";

const INVENTORY_COLUMNS = [
  "asset_id", "asset_tag", "serial_number", "network_device_id", "host_id", "hostname", "nome_prodotto",
  "categoria", "marca", "modello", "part_number", "sede", "reparto", "utente_assegnatario_id", "asset_assignee_id", "location_id", "posizione_fisica",
  "data_assegnazione", "data_acquisto", "data_installazione", "data_dismissione", "stato", "fine_garanzia",
  "fine_supporto", "vita_utile_prevista", "sistema_operativo", "versione_os", "cpu", "ram_gb", "storage_gb",
  "storage_tipo", "mac_address", "ip_address", "vlan", "firmware_version", "prezzo_acquisto", "fornitore",
  "numero_ordine", "numero_fattura", "valore_attuale", "metodo_ammortamento", "centro_di_costo",
  "crittografia_disco", "antivirus", "gestito_da_mdr", "classificazione_dati", "in_scope_gdpr", "categoria_nis2", "business_owner_id", "technical_owner_id", "criticita_nis2", "dati_trattati", "supporto_rimovibile", "data_review_nis2", "auto_sync_discovery", "last_sync_at", "last_sync_source", "backup_configurato", "backup_ultimo_test", "patching_automatico", "mfa_admin", "log_centralizzati", "hardening_baseline", "dr_plan_documentato", "incident_response_documentata", "in_scope_nis2",
  "ultimo_audit", "contratto_supporto", "tipo_garanzia", "contatto_supporto", "ultimo_intervento",
  "prossima_manutenzione", "note_tecniche", "technical_data",
];

function extractProxmoxTechData(
  lastResult: string | null
): Partial<import("@/types").InventoryAssetInput> & { technical_data?: string } {
  const out: Partial<import("@/types").InventoryAssetInput> & { technical_data?: string } = {};
  if (!lastResult?.trim()) return out;

  try {
    const parsed = JSON.parse(lastResult) as {
      hosts?: Array<{
        hostname?: string;
        cpu_model?: string;
        cpu_mhz?: number;
        cpu_sockets?: number;
        cpu_cores?: number;
        memory_total_gb?: number;
        proxmox_version?: string;
        kernel_version?: string;
        rootfs_total_gb?: number;
        hardware_serial?: string;
        hardware_model?: string;
        hardware_manufacturer?: string;
        subscription?: {
          status?: string;
          productname?: string;
          key?: string;
          nextduedate?: string;
          serverid?: string;
        };
        storage?: Array<{ total_gb?: number; used_gb?: number; type?: string }>;
      }>;
      vms?: unknown[];
      scanned_at?: string;
    };

    out.technical_data = lastResult;

    const host = parsed?.hosts?.[0];
    if (!host) return out;

    if (host.cpu_model) {
      const parts = [host.cpu_model];
      if (host.cpu_mhz) parts.push(`${host.cpu_mhz} MHz`);
      if (host.cpu_sockets != null) parts.push(`${host.cpu_sockets} socket`);
      if (host.cpu_cores != null) parts.push(`${host.cpu_cores} core`);
      out.cpu = parts.join(", ");
    }
    if (host.memory_total_gb != null) out.ram_gb = Math.round(host.memory_total_gb);
    if (host.proxmox_version) out.firmware_version = host.proxmox_version;
    if (host.kernel_version) out.versione_os = host.kernel_version;
    if (host.hardware_serial) out.serial_number = host.hardware_serial;
    if (host.hardware_model) out.modello = host.hardware_model;
    if (host.hardware_manufacturer) out.marca = host.hardware_manufacturer;
    if (host.rootfs_total_gb != null) {
      const storageTotal = host.storage?.reduce((s, st) => s + (st.total_gb ?? 0), 0) ?? 0;
      out.storage_gb = Math.round(Math.max(host.rootfs_total_gb, storageTotal));
    }
    out.sistema_operativo = "Proxmox VE";
  } catch {
    /* ignore parse errors */
  }
  return out;
}

export function syncInventoryFromDevice(device: NetworkDevice): import("@/types").InventoryAsset | null {
  const asset = getInventoryAssetByNetworkDevice(device.id);
  if (!asset) return null;

  const marca = mapVendorToMarca(device.vendor);
  const categoria = mapClassificationToInventoryCategoria(device.classification, device.device_type, device.vendor);

  const base: Partial<import("@/types").InventoryAssetInput> = {
    hostname: device.name,
    nome_prodotto: device.name,
    categoria: categoria ?? asset.categoria,
    marca: marca ?? asset.marca,
    modello: device.model ?? asset.modello,
    serial_number: device.serial_number ?? asset.serial_number,
    part_number: device.part_number ?? asset.part_number,
    ip_address: device.host,
    firmware_version: device.firmware ?? asset.firmware_version,
  };

  const dev = device as { last_proxmox_scan_result?: string | null };
  const proxmox = extractProxmoxTechData(dev.last_proxmox_scan_result ?? null);

  // Per device non-Proxmox: archivia sysname, sysdescr, model, firmware come technical_data
  let technicalData = proxmox.technical_data;
  if (!technicalData && (device.sysname || device.sysdescr || device.model || device.firmware)) {
    technicalData = JSON.stringify({
      source: "device",
      sysname: device.sysname,
      sysdescr: device.sysdescr,
      model: device.model,
      firmware: device.firmware,
      serial_number: device.serial_number,
      part_number: device.part_number,
      last_info_update: (device as { last_info_update?: string | null }).last_info_update,
    });
  }

  const merged: import("@/types").InventoryAssetInput = {
    ...base,
    ...proxmox,
    technical_data: technicalData ?? undefined,
  };

  const updated = updateInventoryAsset(asset.id, merged);
  return updated ?? null;
}

function mapClassificationToInventoryCategoria(classification: string | null, deviceType: string, vendor?: string | null): import("@/types").InventoryAssetCategoria | null {
  const c = (classification ?? "").toLowerCase().trim();
  const dt = (deviceType ?? "").toLowerCase().trim();
  const v = (vendor ?? "").toLowerCase().trim();

  // 1) Classification (fonte primaria, esplicita dall'utente o dal classifier)
  if (c === "firewall") return "Firewall";
  if (c === "access_point") return "Access Point";
  if (["router", "load_balancer", "vpn_gateway"].includes(c)) return "Router";
  if (c === "switch") return "Switch";
  if (["server", "web_server", "database_server", "mail_server", "backup_server", "nfs_server", "linux_server", "windows_server", "server_linux", "server_windows"].includes(c)) return "Server";
  if (c === "hypervisor") return "Server";
  if (["workstation", "desktop", "pc"].includes(c)) return "Desktop";
  if (["notebook", "laptop"].includes(c)) return "Laptop";
  if (c === "vm") return "VM";
  if (["nas", "nas_synology", "nas_qnap", "storage"].includes(c)) return "NAS";
  if (["stampante", "scanner", "fotocopiatrice", "multifunzione"].includes(c)) return "Stampante";
  if (["telecamera", "voip", "iot"].includes(c)) return "Other";

  // 2) device_type fallback — ma attenzione: device_type='switch' è un WORKAROUND
  //    di schema per host non-router (firewall, server Linux, ecc.). Usarlo da
  //    solo per assegnare "Switch" produce errori (vedi Linux server).
  if (dt === "router") return "Router";
  if (dt === "firewall") return "Firewall";
  if (dt === "hypervisor") return "Server";
  if (dt === "switch") {
    // device_type=switch può nascondere un server/NAS: usa vendor come hint
    if (["linux", "windows"].includes(v)) return "Server";
    if (["proxmox", "vmware"].includes(v)) return "Server";
    if (["synology", "qnap"].includes(v)) return "NAS";
    if (v === "stormshield") return "Firewall";
    // Solo qui è un vero switch (vendor di rete: cisco, hp, ubiquiti, ecc.)
    return "Switch";
  }

  // 3) vendor come ultimo indizio se manca tutto il resto
  if (["linux", "windows"].includes(v)) return "Server";
  if (["proxmox", "vmware"].includes(v)) return "Server";
  if (["synology", "qnap"].includes(v)) return "NAS";

  // 4) Fallback safe: NON inventare "Switch". Lascia che l'utente classifichi.
  return "Other";
}

function mapVendorToMarca(vendor: string): string | null {
  const v = vendor?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    mikrotik: "MikroTik",
    ubiquiti: "Ubiquiti",
    hp: "HP",
    cisco: "Cisco",
    omada: "TP-Link",
    stormshield: "Stormshield",
    proxmox: "Proxmox",
    vmware: "VMware",
    linux: "Linux",
    windows: "Windows",
  };
  return map[v] ?? null;
}

function mapHostClassificationToInventoryCategoria(classification: string | null): import("@/types").InventoryAssetCategoria | null {
  const c = (classification ?? "").toLowerCase();
  if (["workstation", "desktop", "pc"].includes(c)) return "Desktop";
  if (["notebook", "laptop"].includes(c)) return "Laptop";
  if (["vm"].includes(c)) return "VM";
  if (["server", "hypervisor", "web_server", "database_server", "mail_server", "backup_server", "nfs_server"].includes(c)) return "Server";
  if (["switch"].includes(c)) return "Switch";
  if (["router", "load_balancer", "vpn_gateway"].includes(c)) return "Router";
  if (["firewall"].includes(c)) return "Firewall";
  if (["access_point"].includes(c)) return "Access Point";
  if (["nas", "nas_synology", "nas_qnap", "storage"].includes(c)) return "NAS";
  if (["stampante", "scanner", "fotocopiatrice", "multifunzione"].includes(c)) return "Stampante";
  if (["iot", "smart_tv", "telecamera", "voip", "phone"].includes(c)) return "Other";
  return null;
}

export function syncInventoryFromHost(host: Host): import("@/types").InventoryAsset | null {
  const asset = getInventoryAssetByHost(host.id);
  if (!asset) return null;

  const categoria = mapHostClassificationToInventoryCategoria(host.classification ?? null) ?? asset.categoria;

  const merged: import("@/types").InventoryAssetInput = {
    hostname: host.custom_name ?? host.hostname ?? host.ip,
    nome_prodotto: host.model ?? host.hostname ?? asset.nome_prodotto,
    categoria,
    marca: host.vendor ?? asset.marca,
    modello: host.model ?? asset.modello,
    serial_number: host.serial_number ?? asset.serial_number,
    ip_address: host.ip,
    mac_address: host.mac ?? asset.mac_address,
    sistema_operativo: host.os_info ?? asset.sistema_operativo,
  };

  const updated = updateInventoryAsset(asset.id, merged);
  return updated ?? null;
}

export function createInventoryAsset(input: import("@/types").InventoryAssetInput): import("@/types").InventoryAsset {
  const assetId = randomUUID();
  const cols = ["asset_id", ...INVENTORY_COLUMNS.slice(1)];
  const placeholders = cols.map(() => "?").join(", ");
  const values = [
    assetId,
    input.asset_tag ?? null,
    input.serial_number ?? null,
    input.network_device_id ?? null,
    input.host_id ?? null,
    input.hostname ?? null,
    input.nome_prodotto ?? null,
    input.categoria ?? null,
    input.marca ?? null,
    input.modello ?? null,
    input.part_number ?? null,
    input.sede ?? null,
    input.reparto ?? null,
    input.utente_assegnatario_id ?? null,
    input.asset_assignee_id ?? null,
    input.location_id ?? null,
    input.posizione_fisica ?? null,
    input.data_assegnazione ?? null,
    input.data_acquisto ?? null,
    input.data_installazione ?? null,
    input.data_dismissione ?? null,
    input.stato ?? null,
    input.fine_garanzia ?? null,
    input.fine_supporto ?? null,
    input.vita_utile_prevista ?? null,
    input.sistema_operativo ?? null,
    input.versione_os ?? null,
    input.cpu ?? null,
    input.ram_gb ?? null,
    input.storage_gb ?? null,
    input.storage_tipo ?? null,
    input.mac_address ?? null,
    input.ip_address ?? null,
    input.vlan ?? null,
    input.firmware_version ?? null,
    input.prezzo_acquisto ?? null,
    input.fornitore ?? null,
    input.numero_ordine ?? null,
    input.numero_fattura ?? null,
    input.valore_attuale ?? null,
    input.metodo_ammortamento ?? null,
    input.centro_di_costo ?? null,
    input.crittografia_disco ?? 0,
    input.antivirus ?? null,
    input.gestito_da_mdr ?? 0,
    input.classificazione_dati ?? null,
    input.in_scope_gdpr ?? 0,
    input.categoria_nis2 ?? null,
    input.business_owner_id ?? null,
    input.technical_owner_id ?? null,
    input.criticita_nis2 ?? null,
    input.dati_trattati ?? null,
    input.supporto_rimovibile ? 1 : 0,
    input.data_review_nis2 ?? null,
    input.auto_sync_discovery !== undefined ? (input.auto_sync_discovery ? 1 : 0) : 1,
    input.last_sync_at ?? null,
    input.last_sync_source ?? null,
    input.backup_configurato ? 1 : 0,
    input.backup_ultimo_test ?? null,
    input.patching_automatico ? 1 : 0,
    input.mfa_admin ? 1 : 0,
    input.log_centralizzati ? 1 : 0,
    input.hardening_baseline ? 1 : 0,
    input.dr_plan_documentato ? 1 : 0,
    input.incident_response_documentata ? 1 : 0,
    input.in_scope_nis2 ?? 0,
    input.ultimo_audit ?? null,
    input.contratto_supporto ?? null,
    input.tipo_garanzia ?? null,
    input.contatto_supporto ?? null,
    input.ultimo_intervento ?? null,
    input.prossima_manutenzione ?? null,
    input.note_tecniche ?? null,
    input.technical_data ?? null,
  ];
  const result = getDb().prepare(`INSERT INTO inventory_assets (${cols.join(", ")}) VALUES (${placeholders})`).run(...values);
  const newId = result.lastInsertRowid as number;
  return getDb().prepare("SELECT * FROM inventory_assets WHERE id = ?").get(newId) as import("@/types").InventoryAsset;
}

export function getLicenses(): (import("@/types").License & { used_seats?: number; free_seats?: number })[] {
  const rows = getDb().prepare(`
    SELECT l.*, COALESCE(ls.cnt, 0) as used_seats
    FROM licenses l
    LEFT JOIN (SELECT license_id, COUNT(*) as cnt FROM license_seats GROUP BY license_id) ls
      ON ls.license_id = l.id
    ORDER BY l.name
  `).all() as (import("@/types").License & { used_seats: number })[];
  return rows.map((row) => {
    const used = row.used_seats || 0;
    return { ...row, used_seats: used, free_seats: Math.max(0, row.seats - used) };
  });
}

export function getLicenseById(id: number): (import("@/types").License & { used_seats?: number; free_seats?: number }) | undefined {
  const row = getDb().prepare(`
    SELECT l.*, COALESCE(ls.cnt, 0) as used_seats
    FROM licenses l
    LEFT JOIN (SELECT license_id, COUNT(*) as cnt FROM license_seats WHERE license_id = ? GROUP BY license_id) ls
      ON ls.license_id = l.id
    WHERE l.id = ?
  `).get(id, id) as (import("@/types").License & { used_seats: number }) | undefined;
  if (!row) return undefined;
  const used = row.used_seats || 0;
  return { ...row, used_seats: used, free_seats: Math.max(0, row.seats - used) };
}
