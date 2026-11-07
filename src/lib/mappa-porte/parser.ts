/**
 * Dallo snapshot di un parser alle righe della Mappa porte (Riccardo, 07/11: «per ogni tipologia venga utilizzato il parser
 * per ottenere tutto quanto possibile»). Ogni collector, MikroTik, HP, Aruba, QNAP, parla lo stesso schema: un adattatore solo,
 * niente regole per marca. Una sezione si usa solo se letta: `unsupported` o `error` vale «non so», non «vuoto». Logica pura.
 */
import type { AcquisitionSnapshot } from "@/lib/acquisition/schema";
import type { RigaArp, RigaMacPorta, RigaMkPorta, RigaMkVlan, RigaVicino } from "@/lib/mappa-porte/tipi";

export interface StratoPorta { device_id: number; fonte: string; port_index: number; port_name: string; valori: string; letto_il: string }
export interface DatiParser { macPorte: RigaMacPorta[]; arp: RigaArp[]; vicini: RigaVicino[]; mkPorte: RigaMkPorta[]; mkVlan: RigaMkVlan[]; porte: StratoPorta[] }

const letta = (s: { status: string } | undefined): boolean => s?.status === "ok" || s?.status === "partial";
const MAC = /^(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i;

export function dalloSnapshot(deviceId: number, s: AcquisitionSnapshot, quando: string): DatiParser {
  const nomi = new Map((s.interfaces.data ?? []).flatMap((i) => (i.if_index != null ? [[i.if_index, i.name] as const] : [])));
  const out: DatiParser = { macPorte: [], arp: [], vicini: [], mkPorte: [], mkVlan: [], porte: [] };
  if (letta(s.forwarding)) {
    for (const f of s.forwarding.data) {
      const port_name = f.port ?? (f.if_index != null ? nomi.get(f.if_index) : undefined);
      if (port_name) out.macPorte.push({ device_id: deviceId, mac: f.mac, port_name, vlan: f.vlan_id, timestamp: quando, source: "parser" });
    }
  }
  if (letta(s.network)) {
    for (const a of s.network.data.arp) {
      if (a.mac) out.arp.push({ device_id: deviceId, mac: a.mac, ip: a.address, interface_name: a.if_index != null ? nomi.get(a.if_index) ?? null : null, timestamp: quando, status: null });
    }
  }
  if (letta(s.neighbors)) {
    for (const n of s.neighbors.data) {
      out.vicini.push({
        device_id: deviceId, local_port: n.local_port, local_port_index: null, remote_device_name: n.system_name ?? n.remote_chassis, remote_port: n.remote_port, protocol: "lldp",
        remote_mac: MAC.test(n.remote_chassis) ? n.remote_chassis : null, source: "parser",
      });
    }
  }
  if (letta(s.vlans)) {
    for (const v of s.vlans.data) {
      if (v.tagged_ports.length > 0) out.mkVlan.push({ device_id: deviceId, vlan_ids: String(v.id), tagged: v.tagged_ports.join(","), current_tagged: null });
      for (const p of v.untagged_ports) out.mkPorte.push({ device_id: deviceId, interface: p, pvid: v.id });
    }
  }
  if (letta(s.interfaces)) {
    const poe = new Map(letta(s.poe) ? s.poe.data.map((p) => [p.port, p]) : []);
    s.interfaces.data.forEach((i, n) => {
      const p = poe.get(i.name);
      const velocita = i.speed_bps != null && i.speed_bps > 0 ? `${Math.round(i.speed_bps / 1e6)} Mbps` : null;
      const valori = {
        ...(i.oper_status ? { status: i.oper_status === "up" ? "up" : "down" } : {}), ...(velocita ? { speed: velocita } : {}), ...(i.duplex ? { duplex: i.duplex } : {}),
        ...(p?.status ? { poe_status: p.status.toLowerCase() } : {}), ...(p?.power_watts != null ? { poe_power_mw: Math.round(p.power_watts * 1000) } : {}),
      };
      out.porte.push({ device_id: deviceId, fonte: "parser", port_index: i.if_index ?? 100_000 + n, port_name: i.name, valori: JSON.stringify(valori), letto_il: quando });
    });
  }
  return out;
}
