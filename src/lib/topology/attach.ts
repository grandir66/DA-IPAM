/**
 * Dove è attaccato un MAC (spec §10.5): sulla porta di bordo — non uplink, non
 * porta di un collegamento fra apparati — di uno switch o AP; un router solo se
 * nessuno switch lo vede (e allora non conta client: il suo bridge vede tutta la
 * rete). Contano solo le letture dell'ultimo giro di quel MAC (entro la soglia
 * «non visto» dalla più recente: un MAC passato dall'AP1 all'AP2 sta sull'AP2).
 * Fra quelle, la porta con meno MAC distinti e freschi (una porta di passaggio
 * ne ha tanti), poi la lettura più recente, poi nodo e porta. Il MAC di un nodo noto che non è un client (apparato,
 * server) diventa un collegamento «mac_table»; gli altri sono client contati
 * sulla porta, con nome e IP se l'host è noto; il numero sul riquadro conta
 * solo i client freschi, i vecchi restano nell'elenco «visto l'ultima volta».
 * I MAC delle VM (vmMacs) non sono client e non creano collegamenti.
 *
 * Router (Task 1b): una riga del router su una porta fisica (bridge host: ether, sfp, bond) propone
 * un collegamento solo come RIPIEGO, per un apparato che nessuno switch o AP vede su una porta di
 * bordo, e solo se (1) l'apparato non ha già un padre da una fonte più forte — uplink UniFi, uno switch
 * che lo vede, un LLDP/CDP verso un apparato di rete fuori da quel ramo — e (2) ogni altro apparato
 * di rete (switch, AP, router) visto su quella porta del router gli sta sotto nei collegamenti noti;
 * se due apparati di rete passano la prova sulla stessa porta (un LLDP non dice chi sta sopra), niente.
 * Perché: una porta del router verso un ramo vede decine di switch, AP e server, e nel DB gli switch
 * UniFi non registrano i MAC degli altri apparati; trattare ogni MAC su una porta fisica come un cavo
 * dava ~230 collegamenti falsi sul cliente A. Il router non conta client. Logica pura.
 */
import { LINK_ATTRS_DEFAULT, type MapLink, type PortClients, type TopologyModelInput } from "@/lib/topology/model-types";
import { type NodeIndex, resolveNode } from "@/lib/topology/node-index";
import { nodeClass } from "@/lib/topology/identity";
import { isPhysicalPort } from "@/lib/topology/links";
import { normalizeMacForStorage, normalizePortNameForMatch } from "@/lib/utils";
import { parseDbDate } from "@/lib/db-date";

const CLIENT_COUNTING = ["switch", "access_point"];
const DAY = 86_400_000;

interface Cand { node: string; port: string; ts: string; ms: number; counting: boolean; fisica: boolean }

export function attachMacs(
  input: TopologyModelInput,
  idx: NodeIndex,
  links: MapLink[],
  vmMacs: ReadonlySet<string> = new Set(),
): { portClients: PortClients[]; clientCount: Record<string, number>; attachLinks: MapLink[] } {
  const portKey = (node: string, port: string) => `${node}|${normalizePortNameForMatch(port)}`;
  const linkPorts = new Set<string>();
  for (const l of links) {
    if (l.aPort) linkPorts.add(portKey(l.a, l.aPort));
    if (l.bPort) linkPorts.add(portKey(l.b, l.bPort));
  }
  for (const u of input.uplinkPorts) linkPorts.add(portKey(`dev:${u.device_id}`, u.port_name));
  const linked = new Set(links.map((l) => [l.a, l.b].sort().join("|")));

  const soglia = input.staleDays * DAY;
  const perPort = new Map<string, Set<string>>(); // porta → MAC distinti visti entro la soglia
  const cand = new Map<string, Cand[]>();
  for (const r of input.macPorts) {
    const node = `dev:${r.device_id}`;
    const n = idx.nodes.get(node);
    const mac = normalizeMacForStorage(r.mac);
    if (!n || !mac || linkPorts.has(portKey(node, r.port_name))) continue;
    // Spec §11.5: il MAC di una VM sta dentro il suo hypervisor, non su una porta dello switch.
    if (vmMacs.has(mac)) continue;
    const k = portKey(node, r.port_name);
    const ms = parseDbDate(r.timestamp).getTime();
    if (input.nowMs - ms <= soglia) perPort.set(k, (perPort.get(k) ?? new Set()).add(mac));
    const fisica = (n.type === "router" || n.type === "firewall") && isPhysicalPort(r.port_name);
    cand.set(mac, [...(cand.get(mac) ?? []), { node, port: r.port_name, ts: r.timestamp, ms, counting: CLIENT_COUNTING.includes(n.type), fisica }]);
  }
  const macsOn = (c: Cand): number => perPort.get(portKey(c.node, c.port))?.size ?? 0;
  const ordine = (x: Cand, y: Cand) =>
    macsOn(x) - macsOn(y)
    || y.ms - x.ms
    || (x.node < y.node ? -1 : x.node > y.node ? 1 : 0)
    || x.port.localeCompare(y.port);
  const sullaPortaDelRouter = new Map<string, Set<string>>(); // porta fisica del router → apparati visti lì
  const ripiego: Array<{ node: string; c: Cand }> = [];

  const byPort = new Map<string, PortClients>();
  const clientCount: Record<string, number> = {};
  const attachLinks: MapLink[] = [];
  for (const mac of [...cand.keys()].sort()) {
    const latest = Math.max(...cand.get(mac)!.map((c) => c.ms));
    const recent = cand.get(mac)!.filter((c) => latest - c.ms <= soglia); // l'ultimo giro di questo MAC
    const pool = recent.some((c) => c.counting) ? recent.filter((c) => c.counting) : recent;
    pool.sort(ordine);
    const best = pool[0];
    const daysUnseen = Math.max(0, Math.floor((input.nowMs - best.ms) / DAY));
    const stale = input.nowMs - best.ms > soglia;
    const otherId = resolveNode(idx, { mac });
    const other = otherId ? idx.nodes.get(otherId) : undefined;
    const apparato = other && nodeClass(other) !== "client" ? other : undefined;
    if (apparato) {
      for (const c of recent) {
        if (!c.fisica || c.node === apparato.id) continue;
        const k = portKey(c.node, c.port);
        sullaPortaDelRouter.set(k, (sullaPortaDelRouter.get(k) ?? new Set()).add(apparato.id));
      }
    }
    if (other && other.id !== best.node && nodeClass(other) !== "client") {
      // Spec §11.1: ciò che un router vede sul bridge o su una VLAN non prova nessun cavo. Una porta
      // fisica del router sì, ma solo come ripiego: si decide sotto, quando tutti i padri noti ci sono.
      if (!best.counting) {
        const fisiche = recent.filter((c) => c.fisica && c.node !== other.id).sort(ordine);
        if (fisiche.length > 0) ripiego.push({ node: other.id, c: fisiche[0] });
        continue;
      }
      const key = [best.node, other.id].sort().join("|");
      if (!linked.has(key)) {
        linked.add(key);
        attachLinks.push({
          id: `mac:${key}`, a: best.node, aPort: best.port, b: other.id, bPort: "", source: "mac_table", sources: ["mac_table"],
          uplinkFrom: other.id, lastSeen: best.ts, daysUnseen, stale, ...LINK_ATTRS_DEFAULT,
        });
      }
      continue;
    }
    if (!best.counting) continue;
    const pk = `${best.node}|${best.port}`;
    const pc = byPort.get(pk) ?? { nodeId: best.node, port: best.port, clients: [] };
    pc.clients.push({ mac, nodeId: other?.id ?? null, name: other?.name ?? null, ip: other?.mgmtIp ?? null, lastSeen: best.ts, stale });
    byPort.set(pk, pc);
    if (!stale) clientCount[best.node] = (clientCount[best.node] ?? 0) + 1;
  }
  attachLinks.push(...ripiegoRouter(idx, [...links, ...attachLinks], ripiego, sullaPortaDelRouter, linked, portKey, input.nowMs, soglia));
  const portClients = [...byPort.values()].sort((a, b) =>
    (a.nodeId < b.nodeId ? -1 : a.nodeId > b.nodeId ? 1 : 0) || a.port.localeCompare(b.port, "it", { numeric: true }));
  attachLinks.sort((a, b) => (a.id < b.id ? -1 : 1));
  return { portClients, clientCount, attachLinks };
}

/** Apparati di rete: possono stare sopra un altro apparato (lo switch, l'AP, un altro router). */
function diRete(idx: NodeIndex, id: string): boolean {
  const n = idx.nodes.get(id);
  if (!n) return false;
  const k = nodeClass(n);
  return k === "infra" || k === "ap";
}

/**
 * Il ripiego del router (Task 1b): vedi il commento in testa. `noti` sono i collegamenti da fonti
 * più forti (correzioni, uplink UniFi, LLDP/CDP/MNDP, tabella MAC degli switch). Un collegamento con
 * `uplinkFrom` ha un verso (figlio → padre); gli altri no.
 */
function ripiegoRouter(
  idx: NodeIndex,
  noti: MapLink[],
  ripiego: Array<{ node: string; c: Cand }>,
  sullaPorta: ReadonlyMap<string, ReadonlySet<string>>,
  linked: Set<string>,
  portKey: (node: string, port: string) => string,
  nowMs: number,
  soglia: number,
): MapLink[] {
  const padri = new Map<string, Set<string>>();
  const figli = new Map<string, Set<string>>();
  const senzaVerso = new Map<string, Set<string>>();
  const cavoProvato = new Map<string, Set<string>>(); // LLDP/CDP o correzione: un cavo vero, verso ignoto
  const aggiungi = (m: Map<string, Set<string>>, k: string, v: string) => m.set(k, (m.get(k) ?? new Set()).add(v));
  for (const l of noti) {
    if (l.uplinkFrom === l.a || l.uplinkFrom === l.b) {
      const figlio = l.uplinkFrom;
      const padre = figlio === l.a ? l.b : l.a;
      aggiungi(padri, figlio, padre);
      aggiungi(figli, padre, figlio);
    } else {
      aggiungi(senzaVerso, l.a, l.b);
      aggiungi(senzaVerso, l.b, l.a);
      if (l.sources.some((x) => x === "lldp" || x === "cdp" || x === "manual")) {
        aggiungi(cavoProvato, l.a, l.b);
        aggiungi(cavoProvato, l.b, l.a);
      }
    }
  }
  /** Chi sta sotto x nei collegamenti noti, senza passare dal router della porta. */
  const sotto = (x: string, router: string): Set<string> => {
    const visti = new Set([x]);
    const coda = [x];
    while (coda.length > 0) {
      const y = coda.shift()!;
      for (const z of [...(figli.get(y) ?? []), ...(senzaVerso.get(y) ?? [])]) {
        if (z === router || visti.has(z)) continue;
        visti.add(z);
        coda.push(z);
      }
    }
    return visti;
  };

  const buoni = new Map<string, Array<{ node: string; c: Cand }>>(); // porta del router → chi passa la prova
  for (const r of [...ripiego].sort((x, y) => (x.node < y.node ? -1 : x.node > y.node ? 1 : 0))) {
    const router = r.c.node;
    if (linked.has([router, r.node].sort().join("|"))) continue;
    const k = portKey(router, r.c.port);
    const qui = sullaPorta.get(k) ?? new Set<string>();
    // (1) un padre da una fonte più forte: un verso noto (uplink UniFi, uno switch che lo vede), o un
    // cavo LLDP/CDP verso un apparato di rete fuori da questo ramo. Non per un router: i suoi vicini
    // stanno sulle sue porte (sono i suoi figli), non sopra di lui. MNDP non conta: attraversa gli switch.
    if ((padri.get(r.node)?.size ?? 0) > 0) continue;
    const t = idx.nodes.get(r.node)?.type;
    if (t !== "router" && t !== "firewall"
      && [...(cavoProvato.get(r.node) ?? [])].some((z) => z !== router && !qui.has(z) && diRete(idx, z))) continue;
    // (2) ogni altro apparato di rete su questa porta gli sta sotto.
    const giu = sotto(r.node, router);
    if ([...qui].some((y) => y !== r.node && diRete(idx, y) && !giu.has(y))) continue;
    buoni.set(k, [...(buoni.get(k) ?? []), r]);
  }

  const out: MapLink[] = [];
  for (const gruppo of buoni.values()) {
    // Due apparati di rete che passano la prova sulla stessa porta: non si sa chi sta sopra.
    const rete = gruppo.filter((r) => diRete(idx, r.node));
    const validi = rete.length > 1 ? gruppo.filter((r) => !diRete(idx, r.node)) : gruppo;
    for (const { node, c } of validi) {
      const key = [c.node, node].sort().join("|");
      if (linked.has(key)) continue;
      linked.add(key);
      out.push({
        id: `mac:${key}`, a: c.node, aPort: c.port, b: node, bPort: "", source: "mac_table", sources: ["mac_table"],
        uplinkFrom: node, lastSeen: c.ts, daysUnseen: Math.max(0, Math.floor((nowMs - c.ms) / DAY)), stale: nowMs - c.ms > soglia,
        ...LINK_ATTRS_DEFAULT,
      });
    }
  }
  return out;
}
