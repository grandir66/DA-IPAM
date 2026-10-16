/**
 * Hypervisor dalle VM sulla porta (spec §12.5, fonte `vm_mac`, «dalle VM»). Sulle porte degli switch centrali
 * dove arrivano i cavi 10G degli hypervisor passano solo i MAC delle schede (sconosciuti finché la lettura
 * delle schede vive non li porta) e quelli delle VM; il MAC di gestione mai. Le VM però parlano chiaro: una porta
 * di bordo di uno switch o AP — non uplink, non porta di un collegamento verso un altro oggetto — su cui, entro la
 * soglia «non visto», passano MAC di VM **accese** e **tutte** dello stesso hypervisor H (almeno una) propone il
 * collegamento porta ↔ H. VM di due hypervisor sulla stessa porta (o di un hypervisor che non si sa) = porta di
 * passaggio: niente. Le VM spente e le letture vecchie non contano né per il conto né per guastare la porta.
 * Se la coppia switch–H è già collegata da un'altra fonte, si fonde (`sources`) sulla stessa porta della linea, o se la
 * linea non la dice (senza riempirla); su un'altra porta è un altro cavo visto (spec §13.7.1 passo 5).
 *
 * Revisione finale del ramo: ogni MAC di VM sta su UNA porta, come i client in attach.ts. (I-1) Una porta di
 * passaggio — il centrale verso un accesso il cui collegamento non dice la porta del centrale — vede le stesse VM
 * della porta di bordo e prima creava un collegamento 10G falso, che diventava il principale dell'hypervisor.
 * Ora, fra le porte del MAC, vince la porta di un cavo già noto del suo hypervisor (la gestione sull'accesso: la VM
 * esce da lì), poi quella con meno MAC distinti freschi (tutti, non solo quelli delle VM), poi la lettura più
 * recente, poi nodo e porta. (I-2) Contano solo le letture dell'ultimo giro del MAC (entro
 * GIRO_MS dalla sua lettura più recente): dopo una migrazione la riga della porta vecchia resta fresca fino a
 * 2 giorni, e creava un collegamento falso verso l'hypervisor nuovo o toglieva il cavo al vecchio.
 * La porta di un cavo ignorato a mano («Ignora questo cavo…») resta occupata verso quell'oggetto (spec §13.9, I-3 e I9).
 * Fra una VM e il suo hypervisor nessun collegamento, e i MAC propri dell'apparato che osserva non sono VM sulla sua
 * porta (spec §13.7.8, regola «vm-e-mac-propri»).
 * Logica pura.
 */
import { parseDbDate } from "@/lib/db-date";
import { LINK_ATTRS_DEFAULT, LINK_SOURCE_RANK, type MapLink, type MapVm, type TopologyModelInput } from "@/lib/topology/model-types";
import { nessunIgnorato, portaOccupata, type Ignorati } from "@/lib/topology/ignorati";
import { portaLocale } from "@/lib/topology/links";
import { canonical, type NodeIndex } from "@/lib/topology/node-index";
import { REGOLE_T1, type Regole } from "@/lib/topology/regole";
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

/** Per ogni nodo che è una VM, il suo hypervisor (spec §13.7.8): fra i due nessun collegamento. */
export type IpervisoriDi = ReadonlyMap<string, ReadonlySet<string>>;

export function ipervisoriDelleVm(vms: readonly MapVm[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const v of vms) {
    if (!v.nodeId || !v.hypervisorNodeId) continue;
    const s = out.get(v.nodeId);
    if (s) s.add(v.hypervisorNodeId);
    else out.set(v.nodeId, new Set([v.hypervisorNodeId]));
  }
  return out;
}

/**
 * Spec §13.7.8 (G9, I62): fra una VM e il suo hypervisor non c'è un collegamento — la VM sta dentro. Nessuna prova lo crea:
 * né dalle VM, né dalla tabella MAC, né dal ripiego. Rete B: l'hypervisor appeso alla scheda del suo firewall virtuale.
 */
export function vmEIpervisore(ip: IpervisoriDi, x: string, y: string): boolean {
  return ip.get(x)?.has(y) === true || ip.get(y)?.has(x) === true;
}

/**
 * Spec §13.7.8 (G9): il MAC è dell'apparato che lo osserva — uno dei MAC noti che si abbinano a lui (controller, MAC noti,
 * host fusi). Un apparato non è vicino, client né VM di sé stesso. Senza creare nodi (`idx.byMac`, non `resolveNode`).
 */
export function macProprio(idx: NodeIndex, mac: string, nodo: string): boolean {
  const id = idx.byMac.get(mac);
  return typeof id === "string" && canonical(idx, id) === nodo;
}

interface PortSeen { node: string; port: string; hypers: Set<string | null>; vms: Set<string>; ms: number; ts: string }

const pairKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

/**
 * I collegamenti nuovi «dalle VM». Quelli fra una coppia già collegata in `known` non sono nuovi: sulla stessa porta si
 * fondono lì (sul posto, come `enrichLinks`), con `vmCount`; con la porta della linea vuota si fondono senza riempirla e
 * senza `vmCount`; su un'altra porta sono un altro cavo visto (`altriCavi`).
 */
export function vmPortLinks(
  input: TopologyModelInput,
  idx: NodeIndex,
  known: MapLink[],
  running: RunningVmMacs,
  ignorati: Ignorati = nessunIgnorato(),
  /** Spec §13.7.8: le VM e i loro hypervisor; `regole` dice se la regola «vm-e-mac-propri» è accesa (misura C19). */
  vm: { ipervisori?: IpervisoriDi; regole?: Regole } = {},
): MapLink[] {
  const { ipervisori = new Map(), regole = REGOLE_T1 } = vm;
  const vmEMacPropri = regole.has("vm-e-mac-propri");
  if (running.size === 0) return [];
  const portaDi = portaLocale(input);
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
    // Spec §13.7.8 (G9): i MAC propri dell'apparato che osserva non sono VM sulla sua porta. Rete B: il firewall virtuale vede
    // nella sua tabella il MAC della sua scheda, che è il MAC della VM, e da lì l'hypervisor gli finiva sotto.
    if (vmEMacPropri && macProprio(idx, mac, node)) continue;
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
    if (vmEMacPropri && vmEIpervisore(ipervisori, s.node, h)) continue; // una VM non fa da padre al suo hypervisor (§13.7.8)
    const pk = pairKey(s.node, h);
    if (portaOccupata(ignorati, s.node, portaDi(s.node, s.port), h)) continue; // «Ignora» per cavo (§13.9, I9)
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
        perche: [{ tipo: "vm", da: s.node, porta: s.port, hypervisor: h, vm: s.vms.size, visto: s.ts }],
      });
      continue;
    }
    const side = l.a === s.node ? "aPort" : "bPort";
    const portaLinea = l[side];
    if (portaLinea && key(s.node, portaLinea) !== k) {
      // Un'altra porta dello stesso switch: un altro cavo visto (spec §13.7.1 passo 5). Non riempie e non rinfresca.
      l.altriCavi = [...(l.altriCavi ?? []), { aPort: side === "aPort" ? s.port : "", bPort: side === "bPort" ? s.port : "", sources: ["vm_mac"], lastSeen: s.ts }];
      continue;
    }
    l.perche = [...(l.perche ?? []), { tipo: "vm", da: s.node, porta: s.port, hypervisor: h, vm: s.vms.size, visto: s.ts }];
    if (!l.sources.includes("vm_mac")) {
      l.sources.push("vm_mac");
      l.sources.sort((x, y) => LINK_SOURCE_RANK[x] - LINK_SOURCE_RANK[y] || (x < y ? -1 : x > y ? 1 : 0));
    }
    // La porta vuota non si riempie: le porte di una linea vengono da una prova sola (prima la riempiva, C4).
    if (portaLinea) l.vmCount = s.vms.size;
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
