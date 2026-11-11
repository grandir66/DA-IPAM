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
  // 11/11/2026 (Riccardo: categorie e sottocategorie): cinque classi che il motore distingueva già
  // (voip.pbx, voip.gateway, av.nvr, power.pdu) o che mancavano fra le postazioni.
  "centralino",
  "gateway_voip",
  "nvr",
  "pdu",
  "thin_client",
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
  voip: "Telefono VoIP",
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
  centralino: "Centralino",
  gateway_voip: "Convertitore VoIP",
  nvr: "Videoregistratore",
  pdu: "PDU",
  thin_client: "Thin client",
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
 * Categoria (primo livello) di ogni classe, per menu e filtri (Riccardo, 11/11/2026: «le categorie dovrebbero
 * essere raggruppate tipo OT → PLC, HMI… POSTAZIONI → PC, Notebook… manca anche il gruppo Telefonia»; «teniamo
 * separato IoT da OT»). Prima i gruppi erano sei, e «Periferiche e servizi» teneva insieme NAS, stampanti, VoIP,
 * telecamere e UPS. Le classi nel database non cambiano nome: cambia solo a quale categoria appartengono.
 */
export type DeviceCategoryGroup =
  | "postazioni"
  | "telefonia"
  | "server"
  | "archiviazione"
  | "rete"
  | "stampa"
  | "video"
  | "ot"
  | "iot"
  | "alimentazione"
  | "unknown";

/** L'ordine in cui le categorie si mostrano. */
export const DEVICE_CATEGORY_GROUP_ORDER: readonly DeviceCategoryGroup[] = [
  "postazioni", "telefonia", "server", "archiviazione", "rete", "stampa", "video", "ot", "iot", "alimentazione",
];

const GROUP_BY_CLASSIFICATION: Record<string, DeviceCategoryGroup> = {
  workstation: "postazioni",
  notebook: "postazioni",
  tablet: "postazioni",
  thin_client: "postazioni",
  voip: "telefonia",
  smartphone: "telefonia",
  centralino: "telefonia",
  gateway_voip: "telefonia",
  server: "server",
  server_windows: "server",
  server_linux: "server",
  dhcp_server: "server",
  dns_server: "server",
  nfs_server: "server",
  mail_server: "server",
  web_server: "server",
  database_server: "server",
  backup_server: "server",
  hypervisor: "server",
  vm: "server",
  nas: "archiviazione",
  nas_synology: "archiviazione",
  nas_qnap: "archiviazione",
  storage: "archiviazione",
  router: "rete",
  switch: "rete",
  firewall: "rete",
  access_point: "rete",
  network_controller: "rete",
  controller_wifi: "rete",
  modem: "rete",
  ont: "rete", // vecchio slug: i dati non ancora convertiti restano raggruppati
  bridge: "rete",
  repeater: "rete",
  load_balancer: "rete",
  vpn_gateway: "rete",
  proxy: "rete",
  stampante: "stampa",
  multifunzione: "stampa",
  fotocopiatrice: "stampa",
  scanner: "stampa",
  telecamera: "video",
  nvr: "video",
  smart_tv: "video",
  decoder: "video",
  media_player: "video",
  console: "video",
  plc: "ot",
  hmi: "ot",
  rete_ot: "ot",
  controller: "ot",
  iot: "iot",
  sensore: "iot",
  domotica: "iot",
  ups: "alimentazione",
  pdu: "alimentazione",
  unknown: "unknown",
};

/** Restituisce la macro-categoria per un tipo/classificazione (slug). */
export function getDeviceCategoryGroup(classification: string | null | undefined): DeviceCategoryGroup {
  if (!classification) return "unknown";
  return GROUP_BY_CLASSIFICATION[classification] ?? "unknown";
}

/** Etichetta italiana per la macro-categoria (UI). */
export const DEVICE_CATEGORY_GROUP_LABELS: Record<DeviceCategoryGroup, string> = {
  postazioni: "Postazioni",
  telefonia: "Telefonia",
  server: "Server",
  archiviazione: "Archiviazione",
  rete: "Rete",
  stampa: "Stampa",
  video: "Video",
  ot: "OT (impianti)",
  iot: "IoT (oggetti connessi)",
  alimentazione: "Alimentazione",
  unknown: "Non classificato",
};

/** Una riga che dice cosa sta in ogni categoria: serve dove due categorie si confondono (OT e IoT). */
export const DEVICE_CATEGORY_GROUP_COSA: Record<DeviceCategoryGroup, string> = {
  postazioni: "i computer su cui lavora una persona",
  telefonia: "telefoni, cellulari, centralini",
  server: "server, macchine virtuali e chi le ospita",
  archiviazione: "dove stanno i dati",
  rete: "ciò che collega gli altri apparati",
  stampa: "stampanti e scanner",
  video: "telecamere, registratori, schermi",
  ot: "le macchine dell'impianto: PLC, pannelli operatore, la loro rete",
  iot: "piccoli oggetti collegati: sensori, prese, domotica",
  alimentazione: "gruppi di continuità e prese comandate",
  unknown: "non ancora riconosciuto",
};

/** Classificazioni ordinate: prima le categorie dispositivi, poi il resto in ordine alfabetico */
export const DEVICE_CLASSIFICATIONS_ORDERED: readonly string[] = [
  ...DEVICE_CATEGORY_SLUGS,
  ...([...DEVICE_CLASSIFICATIONS].filter((c) => !categorySet.has(c)).sort()),
];
