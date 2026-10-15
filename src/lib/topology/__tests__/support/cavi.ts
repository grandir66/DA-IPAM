// Costruttori per le prove del modello per cavo (piano di T2, Task 9-13): righe dei vicini con le colonne nuove, fatti di
// porta e di bridge con tutti i campi, l'ingresso del modello per cavo da un ingresso del modello di oggi.
import type { FattoBridge, FattoPorta, IngressoCavi, ViciniCaviRow } from "@/lib/topology/cavi/prove";
import type { ModelNeighborRow, TopologyModelInput } from "@/lib/topology/model-types";

export const ORA_T2 = "2026-10-13 11:00:00";

export function vic(r: Partial<ViciniCaviRow> & Pick<ViciniCaviRow, "device_id" | "local_port">): ViciniCaviRow {
  return {
    remote_device_name: "", remote_port: "", protocol: "lldp", remote_ip: null, remote_mac: null, remote_platform: null,
    timestamp: ORA_T2, source: "unifi", discovered_by: null, local_port_index: null, remote_port_index: null, remote_caps: null, ...r,
  };
}

export function daRiga(n: ModelNeighborRow): ViciniCaviRow {
  return { ...n, remote_platform: n.remote_platform ?? null, discovered_by: null, local_port_index: null, remote_port_index: null, remote_caps: null };
}

export function fp(device_id: number, port_key: string, port_name: string, over: Partial<FattoPorta> = {}): FattoPorta {
  return {
    device_id, source: "controller", port_key, port_name, port_index: port_key.startsWith("i:") ? Number(port_key.slice(2)) : null,
    if_kind: "physical", running: 1, in_bridge: null, bridge: null, lag_group: null, lag_partner: null, lag_state: null,
    stp_role: null, stp_state: null, designated_bridge: null, designated_port: null, path_cost: null, edge: null,
    point_to_point: null, sending_rstp: null, bpdu_rx: null, seen_at: ORA_T2, ...over,
  };
}

export function fb(device_id: number, over: Partial<FattoBridge> = {}): FattoBridge {
  return {
    device_id, source: "device", bridge_name: "", instance: 0, protocol: "rstp", priority: 32768, bridge_id: null, root_id: null,
    regional_root_id: null, region_name: null, region_revision: null, config_digest: null, vlans: null, root_port: null,
    root_path_cost: null, seen_at: ORA_T2, ...over,
  };
}

/** L'ingresso del modello per cavo: le righe di oggi più `vicini` (le fonti nuove), i fatti, i MAC, gli uplink per indice. */
export function ingresso(t1: TopologyModelInput, over: Partial<Omit<IngressoCavi, "t1">> = {}): IngressoCavi {
  const { vicini = [], ...resto } = over;
  return { t1, vicini: [...t1.neighbors.map(daRiga), ...vicini], fattiPorta: [], fattiBridge: [], macApparati: [], uplink: [], schema: true, ...resto };
}
