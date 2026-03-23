/**
 * Classificazioni predefinite per dispositivi di rete.
 * Elenco ampio dei tipi di device comunemente presenti in una rete informatica.
 */
export const DEVICE_CATEGORY_SLUGS = [
  "access_point",
  "firewall",
  "hypervisor",
  "iot",
  "notebook",
  "workstation",
  "vm",
  "router",
  "server",
  "server_windows",
  "server_linux",
  "stampante",
  "storage",
  "switch",
  "telecamera",
  "voip",
] as const;

export const DEVICE_CLASSIFICATIONS = [
  "router",
  "switch",
  "firewall",
  "access_point",
  "server",
  "server_windows",
  "server_linux",
  "workstation",
  "notebook",
  "vm",
  "stampante",
  "nas",
  "telecamera",
  "voip",
  "ups",
  "storage",
  "load_balancer",
  "vpn_gateway",
  "proxy",
  "dhcp_server",
  "dns_server",
  "nfs_server",
  "mail_server",
  "web_server",
  "database_server",
  "backup_server",
  "hypervisor",
  "iot",
  "smart_tv",
  "console",
  "tablet",
  "smartphone",
  "scanner",
  "fotocopiatrice",
  "multifunzione",
  "nas_synology",
  "nas_qnap",
  "rete_ot",
  "plc",
  "hmi",
  "sensore",
  "controller",
  "bridge",
  "repeater",
  "modem",
  "ont",
  "decoder",
  "media_player",
  "unknown",
] as const;

const categorySet = new Set<string>(DEVICE_CATEGORY_SLUGS);

/** Etichette per la visualizzazione: workstation→PC, vm→VM, ecc. */
const CLASSIFICATION_LABELS: Record<string, string> = {
  workstation: "PC",
  notebook: "Notebook",
  vm: "VM",
  server_windows: "Server Windows",
  server_linux: "Server Linux",
  access_point: "Access Point",
  storage: "Storage",
};

/** Restituisce l'etichetta leggibile per una classificazione (es. workstation → "PC") */
export function getClassificationLabel(classification: string): string {
  return CLASSIFICATION_LABELS[classification] ?? classification.replace(/_/g, " ");
}

/** Ordina gli slug di classificazione per etichetta visibile (locale it), per menu select. */
export function sortClassificationsByDisplayLabel(classifications: readonly string[]): string[] {
  return [...classifications].sort((a, b) =>
    getClassificationLabel(a).localeCompare(getClassificationLabel(b), "it", { sensitivity: "base" })
  );
}

/**
 * Macro-categoria per dashboard / filtri (raggruppa tipi tecnici).
 * - **infrastructure**: switching, routing, Wi‑Fi, sicurezza perimetrale
 * - **compute**: server, VM, hypervisor, DB, servizi
 * - **endpoints**: PC, notebook, mobile
 * - **peripheral**: stampanti, VoIP, cam, UPS, storage dedicato
 * - **iot_ot**: IoT, PLC, sensori
 * - **media**: TV, console, player
 * - **unknown**: non classificato
 */
export type DeviceCategoryGroup =
  | "infrastructure"
  | "compute"
  | "endpoints"
  | "peripheral"
  | "iot_ot"
  | "media"
  | "unknown";

const GROUP_BY_CLASSIFICATION: Record<string, DeviceCategoryGroup> = {
  router: "infrastructure",
  switch: "infrastructure",
  firewall: "infrastructure",
  access_point: "infrastructure",
  bridge: "infrastructure",
  repeater: "infrastructure",
  load_balancer: "infrastructure",
  vpn_gateway: "infrastructure",
  proxy: "infrastructure",
  modem: "infrastructure",
  ont: "infrastructure",
  dhcp_server: "compute",
  dns_server: "compute",
  nfs_server: "compute",
  mail_server: "compute",
  web_server: "compute",
  database_server: "compute",
  backup_server: "compute",
  server: "compute",
  server_windows: "compute",
  server_linux: "compute",
  hypervisor: "compute",
  vm: "compute",
  nas: "peripheral",
  nas_synology: "peripheral",
  nas_qnap: "peripheral",
  storage: "peripheral",
  workstation: "endpoints",
  notebook: "endpoints",
  tablet: "endpoints",
  smartphone: "endpoints",
  stampante: "peripheral",
  multifunzione: "peripheral",
  scanner: "peripheral",
  fotocopiatrice: "peripheral",
  telecamera: "peripheral",
  voip: "peripheral",
  ups: "peripheral",
  iot: "iot_ot",
  rete_ot: "iot_ot",
  plc: "iot_ot",
  hmi: "iot_ot",
  sensore: "iot_ot",
  controller: "iot_ot",
  smart_tv: "media",
  console: "media",
  media_player: "media",
  decoder: "media",
  unknown: "unknown",
};

/** Restituisce la macro-categoria per un tipo/classificazione (slug). */
export function getDeviceCategoryGroup(classification: string | null | undefined): DeviceCategoryGroup {
  if (!classification) return "unknown";
  return GROUP_BY_CLASSIFICATION[classification] ?? "unknown";
}

/** Etichetta italiana per la macro-categoria (UI). */
export const DEVICE_CATEGORY_GROUP_LABELS: Record<DeviceCategoryGroup, string> = {
  infrastructure: "Infrastruttura di rete",
  compute: "Server e virtualizzazione",
  endpoints: "Client e postazioni",
  peripheral: "Periferiche e servizi",
  iot_ot: "IoT / OT",
  media: "Media e intrattenimento",
  unknown: "Non classificato",
};

/** Classificazioni ordinate: prima le categorie dispositivi, poi il resto in ordine alfabetico */
export const DEVICE_CLASSIFICATIONS_ORDERED: readonly string[] = [
  ...DEVICE_CATEGORY_SLUGS,
  ...([...DEVICE_CLASSIFICATIONS].filter((c) => !categorySet.has(c)).sort()),
];
