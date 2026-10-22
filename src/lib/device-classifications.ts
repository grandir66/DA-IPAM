import { canonicalizza } from "./classification/canonico";

/**
 * Classificazioni predefinite per dispositivi di rete.
 * Elenco ampio dei tipi di device comunemente presenti in una rete informatica.
 */
export const DEVICE_CATEGORY_SLUGS = [
  "access_point",
  "firewall",
  "hypervisor",
  "iot",
  "nas",
  "notebook",
  "workstation",
  "vm",
  "router",
  "server",
  "stampante",
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
  "workstation",
  "notebook",
  "vm",
  "stampante",
  "nas",
  "telecamera",
  "voip",
  "ups",
  "load_balancer",
  "vpn_gateway",
  "proxy",
  "hypervisor",
  "iot",
  "smart_tv",
  "console",
  "tablet",
  "smartphone",
  "scanner",
  "multifunzione",
  "rete_ot",
  "plc",
  "hmi",
  "sensore",
  "domotica",
  "network_controller",
  "bridge",
  "repeater",
  "modem",
  "decoder",
  "media_player",
  "unknown",
] as const;

const categorySet = new Set<string>(DEVICE_CATEGORY_SLUGS);

/**
 * Etichette per la visualizzazione (catalogo canonico, 21/10): iniziale maiuscola e sigle giuste.
 * Gli slug vecchi non hanno etichetta propria: `getClassificationLabel` usa quella del canonico.
 */
const CLASSIFICATION_LABELS: Record<string, string> = {
  router: "Router",
  switch: "Switch",
  firewall: "Firewall",
  access_point: "Access Point",
  server: "Server",
  workstation: "PC",
  notebook: "Notebook",
  vm: "VM",
  stampante: "Stampante",
  nas: "NAS / Storage",
  telecamera: "Telecamera",
  voip: "VoIP",
  ups: "UPS",
  load_balancer: "Load balancer",
  vpn_gateway: "VPN gateway",
  proxy: "Proxy",
  hypervisor: "Hypervisor",
  iot: "IoT",
  smart_tv: "Smart TV",
  console: "Console",
  tablet: "Tablet",
  smartphone: "Smartphone",
  scanner: "Scanner",
  multifunzione: "Stampante multifunzione",
  rete_ot: "Rete OT",
  plc: "PLC",
  hmi: "HMI",
  sensore: "Sensore",
  domotica: "Domotica",
  network_controller: "Controller di rete",
  bridge: "Bridge",
  repeater: "Repeater",
  modem: "Modem / ONT",
  decoder: "Decoder",
  media_player: "Media player",
  unknown: "Non classificato",
};

/** Restituisce l'etichetta leggibile per una classificazione (es. workstation → "PC"); gli slug vecchi → etichetta del canonico. */
export function getClassificationLabel(classification: string): string {
  const slug = canonicalizza(classification).classificazione;
  if (CLASSIFICATION_LABELS[slug]) return CLASSIFICATION_LABELS[slug];
  const testo = slug.replace(/_/g, " ");
  return testo.charAt(0).toUpperCase() + testo.slice(1);
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
  ont: "infrastructure", // vecchio slug: i dati non ancora convertiti restano raggruppati
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
  domotica: "iot_ot",
  controller_wifi: "infrastructure",
  network_controller: "infrastructure",
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
