/**
 * Risorse e hardware MikroTik dalle uscite di `/system resource print` e
 * `/system routerboard print` (scheda MikroTik, task 2); attributi di bridge, porte e bond dalle uscite `print terse`
 * che la lettura della topologia riceve già (task 8). Puro: niente rete, niente DB.
 */
import { parseRouterOsDurationSeconds } from "./router-client";
import { campiTerse, righeDiUscita } from "./mikrotik-vicini";
import { segni } from "./mikrotik-stp";

export interface RisorseMikrotik {
  uptime: string | null;
  uptime_s: number | null;
  versione: string | null;
  build: string | null;
  cpu: string | null;
  cpu_core: number | null;
  cpu_mhz: number | null;
  cpu_carico: number | null;
  memoria_totale_b: number | null;
  memoria_libera_b: number | null;
  disco_totale_b: number | null;
  disco_libero_b: number | null;
  architettura: string | null;
  board: string | null;
  piattaforma: string | null;
}

export interface HardwareMikrotik {
  routerboard: boolean | null;
  modello: string | null;
  seriale: string | null;
  revisione: string | null;
  firmware_tipo: string | null;
  firmware_factory: string | null;
  firmware_corrente: string | null;
  firmware_aggiornabile: string | null;
}

const MOLTIPLICATORE: Record<string, number> = { "": 1, B: 1, KIB: 1024, MIB: 1024 ** 2, GIB: 1024 ** 3, TIB: 1024 ** 4 };

/** «1024.0MiB», «1.0GiB», «47.0KiB», «4096» → byte; illeggibile → null. */
export function byteRouterOs(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = s.trim().match(/^(\d+(?:\.\d+)?)\s*([KMGT]iB|B)?$/i);
  if (!m) return null;
  const f = MOLTIPLICATORE[(m[2] ?? "").toUpperCase()];
  return f === undefined ? null : Math.round(parseFloat(m[1]) * f);
}

/** `chiave: valore`, una per riga (la prima occorrenza vince). */
function coppie(out: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const riga of out.split(/\r?\n/)) {
    const i = riga.indexOf(":");
    if (i < 0) continue;
    const k = riga.slice(0, i).trim();
    const v = riga.slice(i + 1).trim();
    if (k && v && !m.has(k)) m.set(k, v);
  }
  return m;
}

function intero(s: string | undefined): number | null {
  const m = s?.match(/^(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

export function parseRisorse(out: string): RisorseMikrotik {
  const c = coppie(out);
  const uptime = c.get("uptime") ?? null;
  const carico = intero(c.get("cpu-load"));
  return {
    uptime,
    uptime_s: parseRouterOsDurationSeconds(uptime),
    versione: c.get("version") ?? null,
    build: c.get("build-time") ?? null,
    cpu: c.get("cpu") ?? null,
    cpu_core: intero(c.get("cpu-count")),
    cpu_mhz: intero(c.get("cpu-frequency")),
    cpu_carico: carico === null ? null : Math.min(100, carico),
    memoria_totale_b: byteRouterOs(c.get("total-memory")),
    memoria_libera_b: byteRouterOs(c.get("free-memory")),
    disco_totale_b: byteRouterOs(c.get("total-hdd-space")),
    disco_libero_b: byteRouterOs(c.get("free-hdd-space")),
    architettura: c.get("architecture-name") ?? null,
    board: c.get("board-name") ?? null,
    piattaforma: c.get("platform") ?? null,
  };
}

export function parseRouterboard(out: string): HardwareMikrotik {
  const c = coppie(out);
  const rb = c.get("routerboard");
  return {
    routerboard: rb === "yes" ? true : rb === "no" ? false : null,
    modello: c.get("model") ?? null,
    seriale: c.get("serial-number") ?? null,
    revisione: c.get("revision") ?? null,
    firmware_tipo: c.get("firmware-type") ?? null,
    firmware_factory: c.get("factory-firmware") ?? null,
    firmware_corrente: c.get("current-firmware") ?? null,
    firmware_aggiornabile: c.get("upgrade-firmware") ?? null,
  };
}

// ── Bridge, porte e bond (task 8, ADR 0027) ──────────────────────────────────
// Una riga = le colonne della tabella con lo stesso nome (`mikrotik_bridge`, `mikrotik_bridge_port`, `mikrotik_bond`), senza
// device_id e seen_at. I valori com'è scritti da RouterOS (`priority=0x8000`, `mtu=auto`, `ageing-time=5m`): la scheda li
// mostra così. Le colonne 0/1 diventano boolean | null (yes/true → true, no/false → false, altro o assente → null); quelle
// che vengono dai segni in testa (R, X, I, D, H) sono sempre boolean.

export type RigaBridgeMk = {
  name: string; mac_address: string | null; mtu: string | null; actual_mtu: number | null; l2mtu: number | null;
  arp: string | null; arp_timeout: string | null; protocol_mode: string | null; priority: string | null; fast_forward: boolean | null;
  igmp_snooping: boolean | null; dhcp_snooping: boolean | null; vlan_filtering: boolean | null; pvid: number | null; frame_types: string | null;
  ingress_filtering: boolean | null; ether_type: string | null; ageing_time: string | null; forward_delay: string | null;
  max_message_age: string | null; comment: string | null; running: boolean; disabled: boolean;
};
export type RigaPortaBridgeMk = {
  interface: string; bridge: string; pvid: number | null; priority: string | null; path_cost: number | null;
  internal_path_cost: number | null; edge: string | null; point_to_point: string | null; horizon: string | null; hw: boolean | null;
  hw_offload: boolean; frame_types: string | null; ingress_filtering: boolean | null; bpdu_guard: boolean | null; trusted: boolean | null;
  inactive: boolean; disabled: boolean; dynamic: boolean; comment: string | null;
};
export type RigaBondMk = {
  name: string; mode: string | null; slaves: string[]; transmit_hash_policy: string | null; mlag_id: string | null;
  link_monitoring: string | null; mii_interval: string | null; lacp_rate: string | null; mtu: number | null; comment: string | null;
  running: boolean; disabled: boolean;
};

/** Una porta di bridge con il ruolo e lo stato STP dell'ultima lettura della topologia (`topology_port_facts`, fonte device). */
export type RigaPortaSchedaMk = RigaPortaBridgeMk & { stp_ruolo: string | null; stp_stato: string | null };

// Le righe delle letture di VLAN dei bridge, interfacce VLAN e DNS (Task 10): la forma è dichiarata qui dal Task 9 perché la
// scheda la usa già (matrice, nomi delle colonne); finché il Task 10 non le legge la rotta le dà null.
export type RigaVlanBridgeMk = {
  bridge: string; vlan_ids: string; tagged: string[]; untagged: string[]; current_tagged: string[]; current_untagged: string[];
  dynamic: boolean; disabled: boolean; comment: string | null;
};
export type RigaVlanMk = {
  name: string; vlan_id: number | null; interface: string | null; mtu: number | null; mac_address: string | null;
  running: boolean; disabled: boolean; comment: string | null;
};
export type RigaDnsMk = {
  servers: string[]; dynamic_servers: string[]; allow_remote_requests: boolean | null; cache_size: string | null;
  cache_used: string | null; max_concurrent_queries: number | null; use_doh_server: string | null;
};

const testo = (c: Map<string, string>, k: string): string | null => {
  const v = c.get(k)?.trim();
  return v ? v : null;
};
const numero = (c: Map<string, string>, k: string): number | null => {
  const v = c.get(k)?.trim() ?? "";
  return /^-?\d+$/.test(v) ? Number(v) : null;
};
const siNo = (c: Map<string, string>, k: string): boolean | null => {
  const v = (c.get(k) ?? "").trim().toLowerCase();
  return v === "yes" || v === "true" ? true : v === "no" || v === "false" ? false : null;
};

/** `/interface bridge print terse without-paging` (MK3). Segni: R attivo, X spento. */
export function parseBridgeScheda(out: string): RigaBridgeMk[] {
  const r: RigaBridgeMk[] = [];
  for (const riga of righeDiUscita(out)) {
    const c = campiTerse(riga);
    const name = testo(c, "name");
    if (!name) continue;
    const s = segni(riga);
    r.push({
      name, mac_address: testo(c, "mac-address"), mtu: testo(c, "mtu"), actual_mtu: numero(c, "actual-mtu"), l2mtu: numero(c, "l2mtu"),
      arp: testo(c, "arp"), arp_timeout: testo(c, "arp-timeout"), protocol_mode: testo(c, "protocol-mode"), priority: testo(c, "priority"),
      fast_forward: siNo(c, "fast-forward"), igmp_snooping: siNo(c, "igmp-snooping"), dhcp_snooping: siNo(c, "dhcp-snooping"),
      vlan_filtering: siNo(c, "vlan-filtering"), pvid: numero(c, "pvid"), frame_types: testo(c, "frame-types"),
      ingress_filtering: siNo(c, "ingress-filtering"), ether_type: testo(c, "ether-type"), ageing_time: testo(c, "ageing-time"),
      forward_delay: testo(c, "forward-delay"), max_message_age: testo(c, "max-message-age"), comment: testo(c, "comment"),
      running: s.includes("R"), disabled: s.includes("X"),
    });
  }
  return r;
}

/** `/interface bridge port print terse without-paging` (MK4). Segni: I inattiva, X spenta, D dinamica, H offload in hardware. */
export function parsePorteBridgeScheda(out: string): RigaPortaBridgeMk[] {
  const r: RigaPortaBridgeMk[] = [];
  for (const riga of righeDiUscita(out)) {
    const c = campiTerse(riga);
    const iface = testo(c, "interface"), bridge = testo(c, "bridge");
    if (!iface || !bridge) continue;
    const s = segni(riga);
    r.push({
      interface: iface, bridge, pvid: numero(c, "pvid"), priority: testo(c, "priority"), path_cost: numero(c, "path-cost"),
      internal_path_cost: numero(c, "internal-path-cost"), edge: testo(c, "edge"), point_to_point: testo(c, "point-to-point"),
      horizon: testo(c, "horizon"), hw: siNo(c, "hw"), hw_offload: s.includes("H"), frame_types: testo(c, "frame-types"),
      ingress_filtering: siNo(c, "ingress-filtering"), bpdu_guard: siNo(c, "bpdu-guard"), trusted: siNo(c, "trusted"),
      inactive: s.includes("I"), disabled: s.includes("X"), dynamic: s.includes("D"), comment: testo(c, "comment"),
    });
  }
  return r;
}

/** `/interface bonding print terse without-paging` (MK8). Segni: R attivo, X spento; `slaves` separati da virgola. */
export function parseBondScheda(out: string): RigaBondMk[] {
  const r: RigaBondMk[] = [];
  for (const riga of righeDiUscita(out)) {
    const c = campiTerse(riga);
    const name = testo(c, "name");
    if (!name) continue;
    const s = segni(riga);
    r.push({
      name, mode: testo(c, "mode"), slaves: (c.get("slaves") ?? "").split(",").map((x) => x.trim()).filter((x) => x !== ""),
      transmit_hash_policy: testo(c, "transmit-hash-policy"), mlag_id: testo(c, "mlag-id"), link_monitoring: testo(c, "link-monitoring"),
      mii_interval: testo(c, "mii-interval"), lacp_rate: testo(c, "lacp-rate"), mtu: numero(c, "mtu"), comment: testo(c, "comment"),
      running: s.includes("R"), disabled: s.includes("X"),
    });
  }
  return r;
}
