import { z } from "zod";
import { DEVICE_CLASSIFICATIONS } from "@/lib/device-classifications";

const cidrRegex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/;
const ipRegex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const macRegex = /^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/;

export const NetworkSchema = z.object({
  cidr: z.string().regex(cidrRegex, "CIDR non valido (es. 192.168.1.0/24)").refine((val) => {
    const match = val.match(cidrRegex);
    if (!match) return false;
    const octets = [parseInt(match[1]), parseInt(match[2]), parseInt(match[3]), parseInt(match[4])];
    const prefix = parseInt(match[5]);
    return octets.every((o) => o >= 0 && o <= 255) && prefix >= 1 && prefix <= 32;
  }, "Indirizzo IP o prefisso non valido"),
  name: z.string().min(1, "Nome richiesto").max(100),
  description: z.string().max(500).optional().default(""),
  gateway: z.string().regex(ipRegex, "Indirizzo IP gateway non valido").optional().or(z.literal("")),
  vlan_id: z.coerce.number().int().min(1).max(4094).optional().nullable(),
  location: z.string().max(200).optional().default(""),
  snmp_community: z.string().max(100).optional().nullable(),
  dns_server: z.union([z.string().regex(ipRegex, "Indirizzo IP DNS non valido"), z.literal("")]).optional().nullable(),
  router_id: z.coerce.number().int().positive().optional().nullable(),
});

/** Creazione rete + eventuali catene credenziali (stessa semantica della modifica). */
export const NetworkCreateSchema = NetworkSchema.extend({
  windows_credential_ids: z.array(z.number().int().positive()).optional(),
  linux_credential_ids: z.array(z.number().int().positive()).optional(),
  ssh_credential_ids: z.array(z.number().int().positive()).optional(),
  snmp_credential_ids: z.array(z.number().int().positive()).optional(),
});

/** Aggiornamento rete + credenziali detect (ordine = priorità tentativi, un solo accesso per credenziale in scan). */
export const NetworkUpdateSchema = NetworkSchema.partial().extend({
  windows_credential_ids: z.array(z.number().int().positive()).optional(),
  linux_credential_ids: z.array(z.number().int().positive()).optional(),
  ssh_credential_ids: z.array(z.number().int().positive()).optional(),
  snmp_credential_ids: z.array(z.number().int().positive()).optional(),
});

export const HostSchema = z.object({
  network_id: z.coerce.number().int().positive(),
  ip: z.string().regex(ipRegex, "Indirizzo IP non valido"),
  mac: z.string().regex(macRegex, "MAC address non valido").optional().or(z.literal("")),
  hostname: z.string().max(255).optional(),
  custom_name: z.string().max(200).optional(),
  classification: z.string().max(100).optional(),
  inventory_code: z.string().max(100).optional(),
  notes: z.string().max(2000).optional(),
});

export const HostUpdateSchema = z.object({
  custom_name: z.string().max(200).optional(),
  classification: z.string().max(100).optional(),
  inventory_code: z.string().max(100).optional(),
  notes: z.string().max(2000).optional(),
  mac: z.string().regex(macRegex, "MAC address non valido").optional().or(z.literal("")),
  known_host: z.union([z.literal(0), z.literal(1)]).optional(),
  monitor_ports: z.string().max(500).optional().nullable(),
});

/** Bulk operazioni host sulla stessa subnet (rete). */
export const HostsBulkBaseSchema = z.object({
  network_id: z.coerce.number().int().positive(),
  host_ids: z.array(z.coerce.number().int().positive()).min(1).max(2000),
});

export const HostsBulkKnownSchema = HostsBulkBaseSchema.extend({
  known_host: z.union([z.literal(0), z.literal(1)]),
});

export const KnownHostRunCheckSchema = z.object({
  network_id: z.coerce.number().int().positive().optional().nullable(),
});

export const NetworkDeviceSchema = z.object({
  name: z.string().min(1, "Nome richiesto").max(100),
  host: z.string().min(1, "Host richiesto").max(2000),
  device_type: z.enum(["router", "switch", "hypervisor"]),
  classification: z.string().max(100).optional().nullable(),
  vendor: z.enum(["mikrotik", "ubiquiti", "hp", "cisco", "omada", "stormshield", "proxmox", "vmware", "linux", "windows", "synology", "qnap", "other"]),
  vendor_subtype: z.enum(["procurve", "comware"]).optional().nullable(),
  protocol: z.enum(["ssh", "snmp_v2", "snmp_v3", "api", "winrm"]),
  credential_id: z.coerce.number().int().positive().optional().nullable(),
  snmp_credential_id: z.coerce.number().int().positive().optional().nullable(),
  username: z.string().max(100).optional(),
  password: z.string().max(200).optional(),
  community_string: z.string().max(100).optional(),
  api_token: z.string().max(500).optional(),
  api_url: z.string().url().optional().or(z.literal("")),
  port: z.coerce.number().int().min(1).max(65535).optional(),
});

export const CredentialSchema = z.object({
  name: z.string().min(1, "Nome richiesto").max(100),
  credential_type: z.enum(["ssh", "snmp", "api", "windows", "linux"]),
  username: z.string().max(100).optional(),
  password: z.string().max(200).optional(),
});

export const ScheduledJobSchema = z.object({
  network_id: z.coerce.number().int().positive().optional().nullable(),
  job_type: z.enum(["ping_sweep", "snmp_scan", "nmap_scan", "arp_poll", "dns_resolve", "cleanup", "known_host_check"]),
  interval_minutes: z.coerce.number().int().min(1).max(10080), // max 1 week
  config: z.record(z.string(), z.unknown()).optional(),
});

export const ScanTriggerSchema = z.object({
  network_id: z.coerce.number().int().positive(),
  scan_type: z.enum([
    "ping",
    "network_discovery",
    "snmp",
    "nmap",
    "arp_poll",
    "dhcp",
    "windows",
    "ssh",
    "dns",
  ]),
  nmap_profile_id: z.coerce.number().int().positive().optional(),
  /** Per azioni manuali: limita agli host selezionati (vista lista). */
  host_ids: z.array(z.coerce.number().int().positive()).optional(),
});

const inventoryCategoria = z.enum(["Desktop", "Laptop", "Server", "Switch", "Firewall", "NAS", "Stampante", "VM", "Licenza", "Access Point", "Router", "Other"]).optional().nullable();
const inventoryStato = z.enum(["Attivo", "In magazzino", "In riparazione", "Dismesso", "Rubato"]).optional().nullable();
const inventoryStorageTipo = z.enum(["SSD", "HDD", "NVMe"]).optional().nullable();
const inventoryClassificazioneDati = z.enum(["Pubblico", "Interno", "Confidenziale", "Riservato"]).optional().nullable();

export const InventoryAssetSchema = z.object({
  asset_tag: z.string().max(100).optional().nullable(),
  serial_number: z.string().max(200).optional().nullable(),
  network_device_id: z.coerce.number().int().positive().optional().nullable(),
  host_id: z.coerce.number().int().positive().optional().nullable(),
  hostname: z.string().max(255).optional().nullable(),
  nome_prodotto: z.string().max(200).optional().nullable(),
  categoria: inventoryCategoria,
  marca: z.string().max(100).optional().nullable(),
  modello: z.string().max(200).optional().nullable(),
  part_number: z.string().max(100).optional().nullable(),
  sede: z.string().max(200).optional().nullable(),
  reparto: z.string().max(100).optional().nullable(),
  utente_assegnatario_id: z.coerce.number().int().positive().optional().nullable(),
  asset_assignee_id: z.coerce.number().int().positive().optional().nullable(),
  location_id: z.coerce.number().int().positive().optional().nullable(),
  posizione_fisica: z.string().max(200).optional().nullable(),
  data_assegnazione: z.string().max(20).optional().nullable(),
  data_acquisto: z.string().max(20).optional().nullable(),
  data_installazione: z.string().max(20).optional().nullable(),
  data_dismissione: z.string().max(20).optional().nullable(),
  stato: inventoryStato,
  fine_garanzia: z.string().max(20).optional().nullable(),
  fine_supporto: z.string().max(20).optional().nullable(),
  vita_utile_prevista: z.coerce.number().int().min(1).max(50).optional().nullable(),
  sistema_operativo: z.string().max(100).optional().nullable(),
  versione_os: z.string().max(50).optional().nullable(),
  cpu: z.string().max(200).optional().nullable(),
  ram_gb: z.coerce.number().int().min(0).optional().nullable(),
  storage_gb: z.coerce.number().int().min(0).optional().nullable(),
  storage_tipo: inventoryStorageTipo,
  mac_address: z.string().max(100).optional().nullable(),
  ip_address: z.string().max(50).optional().nullable(),
  vlan: z.coerce.number().int().min(0).max(4094).optional().nullable(),
  firmware_version: z.string().max(100).optional().nullable(),
  prezzo_acquisto: z.coerce.number().min(0).optional().nullable(),
  fornitore: z.string().max(200).optional().nullable(),
  numero_ordine: z.string().max(100).optional().nullable(),
  numero_fattura: z.string().max(100).optional().nullable(),
  valore_attuale: z.coerce.number().min(0).optional().nullable(),
  metodo_ammortamento: z.enum(["Lineare", "Quote decrescenti"]).optional().nullable(),
  centro_di_costo: z.string().max(100).optional().nullable(),
  crittografia_disco: z.coerce.number().int().min(0).max(1).optional(),
  antivirus: z.string().max(100).optional().nullable(),
  gestito_da_mdr: z.coerce.number().int().min(0).max(1).optional(),
  classificazione_dati: inventoryClassificazioneDati,
  in_scope_gdpr: z.coerce.number().int().min(0).max(1).optional(),
  in_scope_nis2: z.coerce.number().int().min(0).max(1).optional(),
  ultimo_audit: z.string().max(20).optional().nullable(),
  contratto_supporto: z.string().max(200).optional().nullable(),
  tipo_garanzia: z.string().max(100).optional().nullable(),
  contatto_supporto: z.string().max(500).optional().nullable(),
  ultimo_intervento: z.string().max(20).optional().nullable(),
  prossima_manutenzione: z.string().max(20).optional().nullable(),
  note_tecniche: z.string().max(5000).optional().nullable(),
  technical_data: z.string().max(50000).optional().nullable(),
});

export const LoginSchema = z.object({
  username: z.string().min(1, "Username richiesto"),
  password: z.string().min(1, "Password richiesta"),
});

export const SetupSchema = z.object({
  username: z.string().min(3, "Username minimo 3 caratteri").max(50),
  password: z.string().min(8, "Password minimo 8 caratteri").max(100),
  confirm_password: z.string(),
}).refine((data) => data.password === data.confirm_password, {
  message: "Le password non corrispondono",
  path: ["confirm_password"],
});

const fingerprintClassEnum = z.enum(DEVICE_CLASSIFICATIONS as unknown as [string, ...string[]]);

export const FingerprintClassificationMapCreateSchema = z.object({
  match_kind: z.enum(["exact", "contains"]),
  pattern: z.string().min(1, "Pattern richiesto").max(500),
  classification: fingerprintClassEnum,
  priority: z.coerce.number().int().min(0).max(99999),
  enabled: z.boolean().optional().default(true),
  note: z.string().max(500).optional().nullable(),
});

export const FingerprintClassificationMapUpdateSchema = FingerprintClassificationMapCreateSchema.partial();
