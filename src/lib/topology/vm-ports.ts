/**
 * Hypervisor dalle VM sulla porta (spec §12.5, fonte `vm_mac`, «dalle VM»). Sulle porte degli switch centrali
 * dove arrivano i cavi 10G degli hypervisor passano solo i MAC delle schede (sconosciuti finché la lettura
 * delle schede vive non li porta) e quelli delle VM; il MAC di gestione mai. Le VM però parlano chiaro: una porta
 * di bordo di uno switch o AP — non uplink, non porta di un collegamento verso un altro oggetto — su cui, entro la
 * soglia «non visto», passano MAC di VM **accese** e **tutte** dello stesso hypervisor H (almeno una) propone il
 * collegamento porta ↔ H. VM di due hypervisor sulla stessa porta (o di un hypervisor che non si sa) = porta di
 * passaggio: niente. Le VM spente e le letture vecchie non contano né per il conto né per guastare la porta.
 * Se la coppia switch–H è già collegata da un'altra fonte, si fonde (`sources`) come fanno le altre fonti.
 *
 * Revisione finale del ramo: ogni MAC di VM sta su UNA porta, come i client in attach.ts. (I-1) Una porta di
 * passaggio — il centrale verso un accesso il cui collegamento non dice la porta del centrale — vede le stesse VM
 * della porta di bordo e prima creava un collegamento 10G falso, che diventava il principale dell'hypervisor.
 * Ora, fra le porte del MAC, vince la porta di un cavo già noto del suo hypervisor (la gestione sull'accesso: la VM
 * esce da lì), poi quella con meno MAC distinti freschi (tutti, non solo quelli delle VM), poi la lettura più
 * recente, poi nodo e porta. (I-2) Contano solo le letture dell'ultimo giro del MAC (entro
 * GIRO_MS dalla sua lettura più recente): dopo una migrazione la riga della porta vecchia resta fresca fino a
 * 2 giorni, e creava un collegamento falso verso l'hypervisor nuovo o toglieva il cavo al vecchio.
 * Le coppie ignorate a mano («Ignora il collegamento…») non si propongono (I-3).
 * Logica pura.
 */
import { parseDbDate } from "@/lib/db-date";
import { LINK_ATTRS_DEFAULT, LINK_SOURCE_RANK, type MapLink, type TopologyModelInput } from "@/lib/topology/model-types";
import type { NodeIndex } from "@/lib/topology/node-index";
import { normalizeMacForStorage, normalizePortNameForMatch } from "@/lib/utils";

const DAY = 86_400_000;
/**
 * L'ultimo giro di letture di un MAC: le tabelle MAC si leggono ogni ora (cliente A, 14/10), e switch diversi a
 * ore diverse. Sei ore tengono insieme le letture dello stesso giro anche con uno switch letto di rado, e lasciano
 * fuori la porta di prima di una migrazione di ieri.
 */
export const GIRO_MS = 6 * 3_600_000;
/** Come la tabella MAC per porta (spec §10.5): le porte di bordo di switch e AP. */
const EDGE_TYPES = ["switch", "access_point"];

export type RunningVmMacs = ReadonlyMap<string, { vm: string; hypervisor: string | null }>;

interface PortSeen { node: string; port: string; hypers: Set<string | null>; vms: Set<string>; ms: number; ts: string }

const pairKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

/**
 * I collegamenti nuovi «dalle VM». Quelli fra una coppia già collegata in `known` non sono nuovi: si fondono
 * lì (sul posto, come `enrichLinks`), con `vmCount` se la porta è la stessa (o non era nota).
 */
export function vmPortLinks(
  input: TopologyModelInput,
  idx: NodeIndex,
  known: MapLink[],
  running: RunningVmMacs,
  ignored: ReadonlySet<string> = new Set(),
): MapLink[] {
  if (running.size === 0) return [];
  const key = (node: string, port: string) => `${node}|${normalizePortNameForMatch(port)}`;
  // Chi sta già su ogni porta: l'altro capo dei collegamenti noti; l'uplink UniFi di un apparato conta come «altro».
  const owners = new Map<string, Set<string>>();
  const own = (k: string, other: string) => owners.set(k, (owners.get(k) ?? new Set()).add(other));
  for (const l of known) {
    if (l.aPort) own(key(l.a, l.aPort), l.b);
    if (l.bPort) own(key(l.b, l.bPort), l.a);
  }
  for (const u of input.uplinkPorts) own(key(`dev:${u.device_id}`, u.port_name), "uplink");

  const soglia = input.staleDays * DAY;
  const fresh = (ms: number) => !Number.isNaN(ms) && input.nowMs - ms <= soglia;
  // MAC distinti freschi per porta di bordo: tutti, VM e non (una porta di passaggio ne ha più della porta di bordo).
  const perPort = new Map<string, Set<string>>();
  interface Lettura { node: string; port: string; k: string; ms: number; ts: string; diH: boolean }
  const letture = new Map<string, Lettura[]>(); // MAC di VM accesa → sue letture fresche su porte libere
  const ultima = new Map<string, number>(); // MAC di VM accesa → la sua lettura fresca più recente
  for (const r of input.macPorts) {
    const mac = normalizeMacForStorage(r.mac);
    const node = `dev:${r.device_id}`;
    if (!mac || !EDGE_TYPES.includes(idx.nodes.get(node)?.type ?? "")) continue;
    const ms = parseDbDate(r.timestamp).getTime();
    if (!fresh(ms)) continue;
    const k = key(node, r.port_name);
    perPort.set(k, (perPort.get(k) ?? new Set()).add(mac));
    const vm = running.get(mac);
    if (!vm) continue; // non è una VM accesa
    ultima.set(mac, Math.max(ultima.get(mac) ?? ms, ms)); // anche su una porta occupata: il MAC è stato visto
    const o = owners.get(k);
    if (o && [...o].some((x) => x !== vm.hypervisor)) continue; // porta di un altro collegamento o uplink
    const diH = !!o && vm.hypervisor !== null && o.has(vm.hypervisor); // la porta di un cavo già noto di H
    letture.set(mac, [...(letture.get(mac) ?? []), { node, port: r.port_name, k, ms, ts: r.timestamp, diH }]);
  }
  const macsOn = (l: Lettura) => perPort.get(l.k)?.size ?? 0;
  const seen = new Map<string, PortSeen>();
  for (const mac of [...letture.keys()].sort()) {
    const latest = ultima.get(mac)!;
    const best = letture.get(mac)!
      .filter((l) => latest - l.ms <= GIRO_MS) // l'ultimo giro di questo MAC
      .sort((x, y) => Number(y.diH) - Number(x.diH) || macsOn(x) - macsOn(y) || y.ms - x.ms || (x.node < y.node ? -1 : x.node > y.node ? 1 : 0) || x.port.localeCompare(y.port))[0];
    if (!best) continue; // l'ultimo giro l'ha visto solo su porte occupate
    const vm = running.get(mac)!;
    const s = seen.get(best.k) ?? { node: best.node, port: best.port, hypers: new Set(), vms: new Set(), ms: best.ms, ts: best.ts };
    s.hypers.add(vm.hypervisor);
    s.vms.add(vm.vm);
    if (best.ms > s.ms) { s.ms = best.ms; s.ts = best.ts; }
    seen.set(best.k, s);
  }

  // Per coppia switch–H, la porta con più VM (poi il nome della porta): un collegamento per coppia.
  const best = new Map<string, { s: PortSeen; h: string; k: string }>();
  for (const [k, s] of seen) {
    if (s.hypers.size !== 1) continue;
    const h = [...s.hypers][0];
    if (h === null || h === s.node || !idx.nodes.has(h)) continue;
    const pk = pairKey(s.node, h);
    if (ignored.has(pk)) continue; // «Ignora il collegamento…» (I-3)
    const cur = best.get(pk);
    if (!cur || s.vms.size > cur.s.vms.size || (s.vms.size === cur.s.vms.size && s.port.localeCompare(cur.s.port, "it", { numeric: true }) < 0)) {
      best.set(pk, { s, h, k });
    }
  }

  const byPair = new Map(known.map((l) => [pairKey(l.a, l.b), l]));
  const out: MapLink[] = [];
  for (const [pk, { s, h, k }] of [...best.entries()].sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))) {
    const daysUnseen = Math.max(0, Math.floor((input.nowMs - s.ms) / DAY));
    const l = byPair.get(pk);
    if (!l) {
      out.push({
        id: `vmmac:${pk}`, a: s.node, aPort: s.port, b: h, bPort: "", source: "vm_mac", sources: ["vm_mac"], uplinkFrom: h,
        lastSeen: s.ts, daysUnseen, stale: false, ...LINK_ATTRS_DEFAULT, vmCount: s.vms.size,
      });
      continue;
    }
    if (!l.sources.includes("vm_mac")) {
      l.sources.push("vm_mac");
      l.sources.sort((x, y) => LINK_SOURCE_RANK[x] - LINK_SOURCE_RANK[y] || (x < y ? -1 : x > y ? 1 : 0));
    }
    const side = l.a === s.node ? "aPort" : "bPort";
    if (!l[side]) l[side] = s.port;
    if (key(s.node, l[side]) === k) l.vmCount = s.vms.size;
    if (l.uplinkFrom === null) l.uplinkFrom = h;
    const t = l.lastSeen ? parseDbDate(l.lastSeen).getTime() : NaN;
    if (!l.sources.includes("manual") && (Number.isNaN(t) || s.ms > t)) {
      l.lastSeen = s.ts;
      l.daysUnseen = daysUnseen;
      l.stale = false;
    }
  }
  return out;
}
