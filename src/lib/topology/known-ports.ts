/**
 * Porte note di un oggetto, per scegliere le porte di un collegamento a mano
 * («Collega a…», spec §11.3; rotta GET /api/topology/ports, piano fase 2b Task 9).
 * Logica pura: le righe arrivano da `getTopologyKnownPorts` in db-tenant.
 *
 * - Uno switch (o un router, o un AP) ha le sue righe di `switch_ports`.
 * - Un hypervisor ha le schede della scansione Proxmox: quelle dell'host del
 *   cluster che è lui (per IP, poi per nome), anche se la scansione l'ha fatta un
 *   altro apparato dello stesso cluster.
 */
import { parseDbDate } from "@/lib/db-date";
import type { KnownPort } from "@/lib/topology/api-input";

export interface SwitchPortRow {
  port_name: string;
  speed: string | null;
  poe_power_mw: number | null;
  status: string | null;
  is_uplink: number;
  is_trunk: number | null;
}

const words = (parts: Array<string | false | null>): string | null => {
  const out = parts.filter((p): p is string => typeof p === "string" && p !== "");
  return out.length > 0 ? out.join(", ") : null;
};

export function switchPortsToKnown(rows: readonly SwitchPortRow[]): KnownPort[] {
  return rows.map((r) => ({
    name: r.port_name,
    speed: r.speed && r.speed.trim() !== "" ? r.speed.trim() : null,
    poeW: r.poe_power_mw != null && r.poe_power_mw > 0 ? r.poe_power_mw / 1000 : null,
    kind: "switch_port",
    note: words([r.is_uplink === 1 && "uplink", r.is_trunk === 1 && "trunk", r.status === "down" && "giù", r.status === "disabled" && "disabilitata"]),
  }));
}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** Schede delle VM e del firewall di Proxmox, e la loopback: non sono porte dove arriva un cavo. */
const VIRTUALI = /^(tap|fwbr|veth|fwpr|fwln|lo$)/;
/** Prima le schede fisiche, poi i bond, poi bridge e VLAN. */
const ORDINE: Record<string, number> = { eth: 0, bond: 1, bridge: 2, vlan: 3 };
const TIPO: Record<string, string> = { bond: "bond", bridge: "bridge", vlan: "VLAN" };

const ipsOf = (ifaces: Rec[]): string[] =>
  ifaces.flatMap((i) => text(i.ip_addresses).split(/[\s,;]+/)).map((x) => x.replace(/\/\d+$/, "")).filter(Boolean);
const nameKey = (s: string): string => s.trim().toLowerCase().split(".")[0];
const when = (s: unknown): number => {
  const t = typeof s === "string" && s ? parseDbDate(s).getTime() : NaN;
  return Number.isNaN(t) ? 0 : t;
};

/** Una scheda dell'host della scansione come porta nota. Stato e velocità solo se letti vivi (chiave `master`). */
function nicToKnown(i: Rec): KnownPort {
  const live = "master" in i;
  const type = text(i.type);
  const speed = live ? Number(text(i.speed_mbps)) : NaN;
  const master = live ? text(i.master) : "";
  return {
    name: text(i.name),
    speed: Number.isInteger(speed) && speed > 0 ? `${speed} Mbps` : null,
    poeW: null,
    kind: "hypervisor_nic",
    note: words([TIPO[type] ?? null, master && `membro di ${master}`, live && text(i.state) === "down" && "giù"]),
  };
}

/**
 * Le schede dell'hypervisor `device` (apparato `dev:<id>`) dalle scansioni salvate.
 * L'host giusto: quello con l'IP dell'apparato nelle sue schede, altrimenti quello
 * col suo nome (senza dominio), altrimenti, se la scansione dell'apparato stesso ha
 * un host solo, quello. Fra più scansioni dello stesso host vince quella
 * dell'apparato stesso, poi la più recente. Un JSON rovinato non conta (nessun errore).
 */
export function hypervisorNics(device: { id: number; host: string; name: string }, scans: ReadonlyArray<{ id: number; raw: string | null }>): KnownPort[] {
  type Cand = { ifaces: Rec[]; own: boolean; at: number; by: number };
  const cands: Cand[] = [];
  const ip = device.host.trim();
  const nk = nameKey(device.name);
  for (const s of scans) {
    let json: unknown;
    try {
      json = s.raw ? JSON.parse(s.raw) : null;
    } catch {
      continue; // scansione rovinata: non dice niente sulle schede
    }
    if (!isRec(json)) continue;
    const hosts = (Array.isArray(json.hosts) ? json.hosts : []).filter(isRec);
    const scannedAt = when(json.scanned_at);
    hosts.forEach((h) => {
      const ifaces = (Array.isArray(h.network_interfaces) ? h.network_interfaces : []).filter(isRec);
      const byIp = ip !== "" && ipsOf(ifaces).includes(ip);
      const byName = nk.length >= 4 && nameKey(text(h.hostname)) === nk;
      const alone = s.id === device.id && hosts.length === 1;
      const by = byIp ? 0 : byName ? 1 : alone ? 2 : -1;
      if (by >= 0) cands.push({ ifaces, own: s.id === device.id, at: Math.max(when(h.live_read_at), scannedAt), by });
    });
  }
  cands.sort((a, b) => a.by - b.by || Number(b.own) - Number(a.own) || b.at - a.at);
  const best = cands[0];
  if (!best) return [];
  return best.ifaces
    .filter((i) => text(i.name) !== "" && !VIRTUALI.test(text(i.name)))
    .map((i, n) => ({ i, n, o: ORDINE[text(i.type)] ?? 4 }))
    .sort((a, b) => a.o - b.o || text(a.i.name).localeCompare(text(b.i.name), "it", { numeric: true }) || a.n - b.n)
    .map(({ i }) => nicToKnown(i));
}
