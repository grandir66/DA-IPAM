/**
 * Dati della scheda switch letti dal contesto, e il testo «cosa c'è attaccato» a una porta (usato da Panoramica,
 * Porte e dal riquadro dettaglio). Senza React: solo forma dei dati.
 */
import type { SwitchPort } from "@/types";
import type { ContestoScheda } from "../../contesto";
import { numeroPorta } from "@/lib/scheda/porte-da-guardare";

export const porteDi = (ctx: ContestoScheda): SwitchPort[] =>
  [...(ctx.device?.switch_ports ?? [])].sort((a, b) => a.port_index - b.port_index);

export interface Vicino {
  chiave: string;
  portaLocale: string;
  nome: string;
  portaRemota: string | null;
  protocollo: string;
  ip: string | null;
  piattaforma: string | null;
}

/** Vicini LLDP/CDP: la rotta ripete la riga per ogni MAC visto dietro la porta; qui una riga per (porta, nome, porta remota). */
export function viciniDi(ctx: ContestoScheda): Vicino[] {
  const visti = new Set<string>();
  const r: Vicino[] = [];
  for (const n of ctx.device?.neighbors ?? []) {
    const nome = (n.remote_device_name ?? "").trim() || n.remote_mac || n.remote_ip || "";
    if (!nome) continue;
    const chiave = `${n.local_port}|${nome}|${n.remote_port ?? ""}`;
    if (visti.has(chiave)) continue;
    visti.add(chiave);
    r.push({
      chiave,
      portaLocale: n.local_port ?? "—",
      nome,
      portaRemota: n.remote_port || null,
      protocollo: (n.protocol ?? "").toLowerCase(),
      ip: n.remote_ip ?? null,
      piattaforma: n.remote_platform ?? null,
    });
  }
  return r;
}

export interface Attaccato {
  testo: string;
  /** Se l'host è nell'inventario: `/objects/<hostId>`. */
  hostId: number | null;
  /** Secondo rigo (produttore, MAC). */
  dettaglio?: string;
}

/** Cosa c'è attaccato: un trunk ha il suo vicino (LLDP/CDP o peer principale), una porta con un MAC il suo host. */
export function attaccatoA(p: SwitchPort): Attaccato {
  if (p.is_trunk) {
    const vicino = [p.trunk_neighbor_name, p.trunk_neighbor_port].filter(Boolean).join(" · porta ");
    if (vicino) return { testo: vicino, hostId: null };
    if (p.trunk_primary_name) return { testo: `→ ${p.trunk_primary_name}`, hostId: null };
    return { testo: `trunk · ${p.mac_count} MAC`, hostId: null };
  }
  if (p.mac_count === 1 && p.single_mac) {
    const nome = p.single_mac_hostname || p.single_mac_ip || p.single_mac;
    const dett = [p.single_mac_vendor, p.single_mac_hostname || p.single_mac_ip ? p.single_mac : null].filter(Boolean).join(" · ");
    return { testo: nome, hostId: p.host_id, ...(dett ? { dettaglio: dett } : {}) };
  }
  if (p.mac_count > 1) return { testo: `${p.mac_count} MAC`, hostId: null };
  if (p.status === "up") return { testo: "nessun MAC", hostId: null };
  return { testo: "—", hostId: null };
}

/** Etichetta corta della porta per il testo («17»). */
export const nomeCorto = (p: SwitchPort): string => String(numeroPorta(p));
