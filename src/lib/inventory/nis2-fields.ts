/**
 * Catalogo campi inventario: distinzione NIS2 vs ITAM.
 * Fonte unica per export, filtri UI e validazione futura.
 */

export type InventoryFieldScope = "nis2" | "itam" | "system";

export type InventoryFieldSection =
  | "identificazione"
  | "ubicazione"
  | "responsabilita"
  | "ciclo_vita"
  | "tecnico"
  | "compliance"
  | "protezione"
  | "note"
  | "economico"
  | "supporto_itam"
  | "gdpr";

export interface InventoryFieldMeta {
  /** Chiave colonna DB / form */
  key: string;
  label: string;
  scope: InventoryFieldScope;
  section: InventoryFieldSection;
  /** Incluso nell'export CSV NIS2 */
  exportNis2: boolean;
}

/** Campi con metadati noti; i campi system non sono editabili in UI. */
export const INVENTORY_FIELD_CATALOG: InventoryFieldMeta[] = [
  { key: "asset_id", label: "UUID asset", scope: "system", section: "identificazione", exportNis2: true },
  { key: "asset_tag", label: "Asset tag", scope: "nis2", section: "identificazione", exportNis2: true },
  { key: "serial_number", label: "Serial number", scope: "nis2", section: "identificazione", exportNis2: true },
  { key: "hostname", label: "Hostname", scope: "nis2", section: "identificazione", exportNis2: true },
  { key: "nome_prodotto", label: "Nome / descrizione", scope: "nis2", section: "identificazione", exportNis2: true },
  { key: "categoria", label: "Categoria", scope: "nis2", section: "identificazione", exportNis2: true },
  { key: "marca", label: "Marca", scope: "nis2", section: "identificazione", exportNis2: true },
  { key: "modello", label: "Modello", scope: "nis2", section: "identificazione", exportNis2: true },
  { key: "part_number", label: "Part number", scope: "nis2", section: "identificazione", exportNis2: false },

  { key: "sede", label: "Sede", scope: "nis2", section: "ubicazione", exportNis2: true },
  { key: "reparto", label: "Reparto", scope: "nis2", section: "ubicazione", exportNis2: true },
  { key: "location_id", label: "Ubicazione", scope: "nis2", section: "ubicazione", exportNis2: false },
  { key: "posizione_fisica", label: "Posizione fisica", scope: "nis2", section: "ubicazione", exportNis2: true },
  { key: "ip_address", label: "IP", scope: "nis2", section: "ubicazione", exportNis2: true },
  { key: "vlan", label: "VLAN", scope: "nis2", section: "ubicazione", exportNis2: true },
  { key: "mac_address", label: "MAC", scope: "nis2", section: "tecnico", exportNis2: true },

  { key: "asset_assignee_id", label: "Proprietario business (legacy)", scope: "nis2", section: "responsabilita", exportNis2: false },
  { key: "business_owner_id", label: "Business owner", scope: "nis2", section: "responsabilita", exportNis2: true },
  { key: "technical_owner_id", label: "Technical owner", scope: "nis2", section: "responsabilita", exportNis2: true },
  { key: "utente_assegnatario_id", label: "Utente sistema", scope: "itam", section: "responsabilita", exportNis2: false },
  { key: "data_assegnazione", label: "Data assegnazione", scope: "itam", section: "responsabilita", exportNis2: false },

  { key: "stato", label: "Stato operativo", scope: "nis2", section: "ciclo_vita", exportNis2: true },
  { key: "data_acquisto", label: "Data acquisto", scope: "nis2", section: "ciclo_vita", exportNis2: true },
  { key: "data_installazione", label: "Data installazione", scope: "nis2", section: "ciclo_vita", exportNis2: true },
  { key: "data_dismissione", label: "Data dismissione", scope: "nis2", section: "ciclo_vita", exportNis2: true },
  { key: "fine_supporto", label: "Fine supporto (EOL)", scope: "nis2", section: "ciclo_vita", exportNis2: true },
  { key: "fine_garanzia", label: "Fine garanzia", scope: "itam", section: "ciclo_vita", exportNis2: false },
  { key: "vita_utile_prevista", label: "Vita utile prevista", scope: "itam", section: "ciclo_vita", exportNis2: false },

  { key: "sistema_operativo", label: "Sistema operativo", scope: "nis2", section: "tecnico", exportNis2: true },
  { key: "versione_os", label: "Versione OS", scope: "nis2", section: "tecnico", exportNis2: true },
  { key: "firmware_version", label: "Firmware", scope: "nis2", section: "tecnico", exportNis2: true },
  { key: "cpu", label: "CPU", scope: "itam", section: "tecnico", exportNis2: false },
  { key: "ram_gb", label: "RAM (GB)", scope: "itam", section: "tecnico", exportNis2: false },
  { key: "storage_gb", label: "Storage (GB)", scope: "itam", section: "tecnico", exportNis2: false },
  { key: "storage_tipo", label: "Tipo storage", scope: "itam", section: "tecnico", exportNis2: false },

  { key: "categoria_nis2", label: "Categoria NIS2", scope: "nis2", section: "compliance", exportNis2: true },
  { key: "criticita_nis2", label: "Criticità", scope: "nis2", section: "compliance", exportNis2: true },
  { key: "dati_trattati", label: "Dati trattati", scope: "nis2", section: "compliance", exportNis2: true },
  { key: "data_review_nis2", label: "Ultima review NIS2", scope: "nis2", section: "compliance", exportNis2: true },
  { key: "in_scope_nis2", label: "In scope NIS2", scope: "nis2", section: "compliance", exportNis2: true },
  { key: "classificazione_dati", label: "Classificazione dati", scope: "nis2", section: "compliance", exportNis2: true },
  { key: "ultimo_audit", label: "Ultimo audit", scope: "nis2", section: "compliance", exportNis2: true },
  { key: "in_scope_gdpr", label: "In scope GDPR", scope: "itam", section: "gdpr", exportNis2: false },

  { key: "antivirus", label: "Antivirus / EDR", scope: "nis2", section: "protezione", exportNis2: true },
  { key: "crittografia_disco", label: "Crittografia disco", scope: "nis2", section: "protezione", exportNis2: true },
  { key: "gestito_da_mdr", label: "Gestito da MDR", scope: "nis2", section: "protezione", exportNis2: true },
  { key: "supporto_rimovibile", label: "Supporto rimovibile (USB/SD)", scope: "nis2", section: "protezione", exportNis2: true },
  // NIS2 Fase 2 — Checklist art. 21
  { key: "backup_configurato", label: "Backup configurato", scope: "nis2", section: "protezione", exportNis2: true },
  { key: "backup_ultimo_test", label: "Ultimo test restore", scope: "nis2", section: "protezione", exportNis2: true },
  { key: "patching_automatico", label: "Patching automatico", scope: "nis2", section: "protezione", exportNis2: true },
  { key: "mfa_admin", label: "MFA su admin", scope: "nis2", section: "protezione", exportNis2: true },
  { key: "log_centralizzati", label: "Log centralizzati (SIEM)", scope: "nis2", section: "protezione", exportNis2: true },
  { key: "hardening_baseline", label: "Hardening baseline", scope: "nis2", section: "protezione", exportNis2: true },
  { key: "dr_plan_documentato", label: "DR plan documentato", scope: "nis2", section: "protezione", exportNis2: true },
  { key: "incident_response_documentata", label: "Incident response", scope: "nis2", section: "protezione", exportNis2: true },

  { key: "note_tecniche", label: "Note / remediation", scope: "nis2", section: "note", exportNis2: true },

  { key: "prezzo_acquisto", label: "Prezzo acquisto", scope: "itam", section: "economico", exportNis2: false },
  { key: "valore_attuale", label: "Valore attuale", scope: "itam", section: "economico", exportNis2: false },
  { key: "metodo_ammortamento", label: "Metodo ammortamento", scope: "itam", section: "economico", exportNis2: false },
  { key: "centro_di_costo", label: "Centro di costo", scope: "itam", section: "economico", exportNis2: false },
  { key: "numero_ordine", label: "Numero ordine", scope: "itam", section: "economico", exportNis2: false },
  { key: "numero_fattura", label: "Numero fattura", scope: "itam", section: "economico", exportNis2: false },
  { key: "fornitore", label: "Fornitore", scope: "itam", section: "economico", exportNis2: false },

  { key: "contratto_supporto", label: "Contratto supporto", scope: "itam", section: "supporto_itam", exportNis2: false },
  { key: "tipo_garanzia", label: "Tipo garanzia", scope: "itam", section: "supporto_itam", exportNis2: false },
  { key: "contatto_supporto", label: "Contatto supporto", scope: "itam", section: "supporto_itam", exportNis2: false },
  { key: "ultimo_intervento", label: "Ultimo intervento", scope: "itam", section: "supporto_itam", exportNis2: false },
  { key: "prossima_manutenzione", label: "Prossima manutenzione", scope: "itam", section: "supporto_itam", exportNis2: false },

  { key: "network_device_id", label: "Device collegato", scope: "system", section: "identificazione", exportNis2: false },
  { key: "host_id", label: "Host collegato", scope: "system", section: "identificazione", exportNis2: false },
  { key: "technical_data", label: "Dati discovery", scope: "nis2", section: "tecnico", exportNis2: false },
];

const catalogByKey = new Map(INVENTORY_FIELD_CATALOG.map((f) => [f.key, f]));

export function getInventoryFieldMeta(key: string): InventoryFieldMeta | undefined {
  return catalogByKey.get(key);
}

export function isNis2Scope(scope: InventoryFieldScope): boolean {
  return scope === "nis2";
}

export function getFieldsByScope(scope: InventoryFieldScope): InventoryFieldMeta[] {
  return INVENTORY_FIELD_CATALOG.filter((f) => f.scope === scope);
}

/** Chiavi incluse nell'export CSV NIS2 (+ colonne derivate aggiunte lato export). */
export const NIS2_EXPORT_KEYS: readonly string[] = INVENTORY_FIELD_CATALOG
  .filter((f) => f.exportNis2)
  .map((f) => f.key);

export const NIS2_SECTION_LABELS: Record<InventoryFieldSection, string> = {
  identificazione: "Identificazione",
  ubicazione: "Ubicazione",
  responsabilita: "Responsabilità",
  ciclo_vita: "Ciclo di vita",
  tecnico: "Software e rete",
  compliance: "Compliance NIS2",
  protezione: "Misure di protezione",
  note: "Note e remediation",
  economico: "Dati economici",
  supporto_itam: "Supporto vendor",
  gdpr: "GDPR",
};

export const NIS2_DETAIL_SECTIONS: InventoryFieldSection[] = [
  "identificazione",
  "ubicazione",
  "responsabilita",
  "ciclo_vita",
  "tecnico",
  "compliance",
  "protezione",
  "note",
];

export const ITAM_EXTRA_SECTIONS: InventoryFieldSection[] = [
  "gdpr",
  "economico",
  "supporto_itam",
];
