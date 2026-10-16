// Tassonomia Attribution v2 — spec §4.1. Radici da Fingerbank, foglie da LibreNMS.

export const CATEGORY_TAXONOMY = {
  network: ["router", "switch", "access_point", "firewall", "controller", "modem"],
  compute: ["server", "workstation", "hypervisor", "vm", "laptop"],
  storage: ["nas", "san", "tape"],
  peripheral: ["printer", "scanner", "mfp"],
  av: ["camera", "nvr", "display", "speaker"],
  voip: ["phone", "pbx", "gateway"],
  power: ["ups", "pdu"],
  iot: ["sensor", "thermostat", "plug", "other"],
  mobile: ["phone", "tablet", "wearable"],
} as const;

export type CategoryLevel1 = keyof typeof CATEGORY_TAXONOMY | "unknown";

type Leaf<K extends keyof typeof CATEGORY_TAXONOMY> =
  `${K}.${(typeof CATEGORY_TAXONOMY)[K][number]}`;
export type CategorySlug =
  | CategoryLevel1
  | { [K in keyof typeof CATEGORY_TAXONOMY]: Leaf<K> }[keyof typeof CATEGORY_TAXONOMY];

const ALL_SLUGS: ReadonlySet<string> = new Set([
  "unknown",
  ...Object.keys(CATEGORY_TAXONOMY),
  ...Object.entries(CATEGORY_TAXONOMY).flatMap(([l1, leaves]) =>
    leaves.map((leaf) => `${l1}.${leaf}`)
  ),
]);

export function isValidCategory(s: string): s is CategorySlug {
  return ALL_SLUGS.has(s);
}

/** Tutti gli slug validi (radici + foglie), ordine stabile di `CATEGORY_TAXONOMY`.
 *  Per popolare select in UI senza duplicare la costruzione dell'insieme sopra. */
export const ALL_CATEGORY_SLUGS: readonly string[] = Array.from(ALL_SLUGS);

export function categoryDepth(s: CategorySlug): 1 | 2 {
  return s.includes(".") ? 2 : 1;
}

export function categoryParent(s: CategorySlug): CategoryLevel1 {
  return (s.includes(".") ? s.split(".")[0] : s) as CategoryLevel1;
}

/** Antenato comune: stesso slug → sé; stesso livello 1 → livello 1; altrimenti null. */
export function commonAncestor(a: CategorySlug, b: CategorySlug): CategorySlug | null {
  if (a === b) return a;
  const pa = categoryParent(a);
  const pb = categoryParent(b);
  return pa === pb ? pa : null;
}

/**
 * Mappa i 52 slug legacy di DeviceClassification (device-classifications.ts) sulla
 * tassonomia v2. `server_windows`/`server_linux` sono due dimensioni in un valore:
 * la parte OS esce come os_family.
 */
const LEGACY_MAP: Record<string, { category: CategorySlug; os_family?: "windows" | "linux" }> = {
  router: { category: "network.router" },
  switch: { category: "network.switch" },
  firewall: { category: "network.firewall" },
  access_point: { category: "network.access_point" },
  modem: { category: "network.modem" },
  ont: { category: "network.modem" },
  bridge: { category: "network" },
  repeater: { category: "network" },
  controller: { category: "network.controller" },
  controller_wifi: { category: "network.controller" },
  network_controller: { category: "network.controller" },
  load_balancer: { category: "network" },
  vpn_gateway: { category: "network.firewall" },
  proxy: { category: "compute.server" },
  server: { category: "compute.server" },
  server_windows: { category: "compute.server", os_family: "windows" },
  server_linux: { category: "compute.server", os_family: "linux" },
  dhcp_server: { category: "compute.server" },
  dns_server: { category: "compute.server" },
  nfs_server: { category: "compute.server" },
  mail_server: { category: "compute.server" },
  web_server: { category: "compute.server" },
  database_server: { category: "compute.server" },
  backup_server: { category: "compute.server" },
  hypervisor: { category: "compute.hypervisor" },
  vm: { category: "compute.vm" },
  workstation: { category: "compute.workstation" },
  notebook: { category: "compute.laptop" },
  stampante: { category: "peripheral.printer" },
  fotocopiatrice: { category: "peripheral.mfp" },
  multifunzione: { category: "peripheral.mfp" },
  scanner: { category: "peripheral.scanner" },
  nas: { category: "storage.nas" },
  nas_synology: { category: "storage.nas" },
  nas_qnap: { category: "storage.nas" },
  storage: { category: "storage" },
  telecamera: { category: "av.camera" },
  smart_tv: { category: "av.display" },
  decoder: { category: "av.display" },
  media_player: { category: "av.display" },
  voip: { category: "voip.phone" },
  ups: { category: "power.ups" },
  iot: { category: "iot.other" },
  domotica: { category: "iot.other" },
  console: { category: "iot.other" },
  rete_ot: { category: "iot" },
  plc: { category: "iot.sensor" },
  hmi: { category: "iot.sensor" },
  sensore: { category: "iot.sensor" },
  tablet: { category: "mobile.tablet" },
  smartphone: { category: "mobile.phone" },
};

export function mapLegacyClassification(
  slug: string
): { category: CategorySlug | null; os_family: "windows" | "linux" | null } {
  const hit = LEGACY_MAP[slug];
  if (!hit) return { category: null, os_family: null };
  return { category: hit.category, os_family: hit.os_family ?? null };
}
