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

/** Classificazioni ordinate: prima le categorie dispositivi, poi il resto in ordine alfabetico */
export const DEVICE_CLASSIFICATIONS_ORDERED: readonly string[] = [
  ...DEVICE_CATEGORY_SLUGS,
  ...([...DEVICE_CLASSIFICATIONS].filter((c) => !categorySet.has(c)).sort()),
];
