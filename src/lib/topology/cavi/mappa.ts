/**
 * La mappa nuova (spec topologia §13.11.4, T3.1, T3.2, T3.7): il modello per cavo nella forma che la pagina e la stampa leggono
 * (`TopologyModel`). Una linea per collegamento, con l'id del collegamento (T3.1: «⇄ N» conta i collegamenti); i segmenti come
 * nodi, con gli alias dei loro membri in `canonical` (§13.7.3, Caso 1 del piano); `cavi` con ciò che serve all'albero e ai
 * dettagli. I nodi, le VM, le sedi e i client sono quelli del modello di oggi; classi, isolati, «Da sistemare», proposte e
 * conteggi si ricalcolano sulle linee nuove con le regole di `buildTopologyModel`. E «Candidati per porta» (§13.4.6). Logica
 * pura: nessun import di db-tenant (lo legge mappa-server.ts).
 */
import { parseDbDate } from "@/lib/db-date";
import { motivoDaSistemare } from "@/lib/topology/da-sistemare";
import { nodeClass, ruoloRete } from "@/lib/topology/identity";
import { FONTE_DELLA_CLASSE } from "@/lib/topology/lettori/fonti";
import { buildTopologyModel, PROMOTE_CLASSES } from "@/lib/topology/model";
import {
  LINK_SOURCE_RANK,
  type CandidatoPorta,
  type CavoLinea,
  type ClasseMappa,
  type Genere,
  type InfoCavi,
  type LinkMedium,
  type LinkSource,
  type MapLink,
  type MapNode,
  type ModelCounts,
  type TopologyModel,
} from "@/lib/topology/model-types";
import { normalizePortNameForMatch } from "@/lib/utils";
import { aliasDeiSegmenti, altroCapo, capo, type Collegamento, type Segmento } from "./collegamenti";
import { costruisciModelloCavi, type ModelloCavi } from "./modello";
import { normale, type Porta } from "./porte";
import { piuRecente, type IngressoCavi, type Prova } from "./prove";

export type MappaCavi = TopologyModel & { cavi: InfoCavi };

const DAY_MS = 86_400_000;
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
/** Gli apparati che un controllo dei tipi segna se non hanno porte (come `buildTopologyModel`). */
const TIPI_SOSPETTI = ["switch", "access_point"];
/** Il tipo di una linea quando la correzione a mano non lo dice: dal genere del collegamento. */
const MEDIO_DEL_GENERE: Partial<Record<Genere, LinkMedium>> = { senza_fili: "wireless", radio: "wireless", tunnel: "tunnel" };

interface ContestoLinea {
  nowMs: number;
  /** id della linea → il nodo per cui un admin l'ha scelta (★ risolte per collegamento). */
  stella: ReadonlyMap<string, string>;
  /** La potenza PoE di una porta (W), come la legge `enrichLinks`. */
  poe: (nodo: string, porta: string) => number | null;
}

/** Il collegamento dietro la linea, coi membri di un fascio orientati come la linea (a ↔ b). */
function cavoDi(c: Collegamento): CavoLinea {
  return {
    genere: c.genere, stato: c.stato, fiducia: c.fiducia,
    ...(c.attivoPerVlan ? { attivoPerVlan: [...c.attivoPerVlan] } : {}),
    ...(c.istanzeNonLette ? { istanzeNonLette: true } : {}),
    ...(c.wan ? { wan: true } : {}),
    ...(c.attraverso ? { attraverso: true } : {}),
    ...(c.oltre !== undefined ? { oltre: c.oltre } : {}),
    ...(c.membri ? {
      fascio: {
        // Un membro letto dall'altro capo ha a e b scambiati rispetto alla linea: la pagina li legge come la linea.
        membri: c.membri.map((m) => {
          const giro = m.a.nodo !== c.a.nodo;
          return { aPort: giro ? m.b.nome : m.a.nome, bPort: giro ? m.a.nome : m.b.nome, stato: m.stato, velocitaMbps: m.velocitaMbps };
        }),
        dedotto: c.fascioDedotto === true,
      },
    } : {}),
    porteDaVerificare: c.porteDaVerificare,
    ...(c.aManoDiverse ? { aManoDiverse: true } : {}),
    ...(c.unVerso ? { unVerso: true } : {}),
    ...(c.giuSu ? { giuSu: { ...c.giuSu } } : {}),
    detti: [...new Set(c.prove.map((p) => p.detto))],
    frasi: [...c.frasi],
  };
}

/** Una linea della pagina per un collegamento (§13.11.4, T3.1): una linea è un cavo, quindi niente «altri cavi» né «perché» di T1. */
function lineaDellaMappa(c: Collegamento, ctx: ContestoLinea): MapLink {
  // Le fonti di oggi solo per compatibilità (piano di T3, «Scelte» 2): senza doppi, nell'ordine di fiducia di T1. Almeno una:
  // `modelloMappaCavi` rifiuta prima un collegamento senza prove.
  const sources = [...new Set(c.prove.map((p) => FONTE_DELLA_CLASSE[p.classe]))]
    .sort((x: LinkSource, y: LinkSource) => LINK_SOURCE_RANK[x] - LINK_SOURCE_RANK[y] || cmp(x, y));
  const aMano = c.prove.some((p) => p.tipo === "a_mano");
  const lastSeen = piuRecente(c.prove.map((p) => p.visto));
  const t = lastSeen === null ? Number.NaN : parseDbDate(lastSeen).getTime();
  // Come T1 (links.ts): una linea a mano non invecchia, e senza una data non si sa da quanto non è vista.
  const daysUnseen = aMano || !Number.isFinite(t) ? null : Math.floor(Math.max(0, ctx.nowMs - t) / DAY_MS);
  const segmento = c.b.nodo.startsWith("seg:");
  const poe = [ctx.poe(c.a.nodo, c.a.nome), segmento ? null : ctx.poe(c.b.nodo, c.b.nome)].filter((v): v is number => v !== null);
  const primaryFor = ctx.stella.get(c.id) ?? null;
  return {
    id: c.id, a: c.a.nodo, aPort: c.a.nome, b: c.b.nodo, bPort: segmento ? "" : c.b.nome,
    source: sources[0], sources, uplinkFrom: c.verso, lastSeen, daysUnseen, stale: c.nonVisto,
    medium: c.medio ?? MEDIO_DEL_GENERE[c.genere] ?? null,
    manual: aMano ? { confirmed: c.fiducia === "a_mano_confermato" } : null,
    speedMbps: c.velocitaMbps, poeW: poe.length > 0 ? Math.max(...poe) : null,
    primary: primaryFor !== null ? "user" : null, primaryFor,
    // La ridondanza la mette l'albero della vista (tree.ts), come in T1.
    redundant: false,
    ...(c.vm !== undefined ? { vmCount: c.vm } : {}),
    cavo: cavoDi(c),
  };
}

/** Il membro gestito da cui il segmento prende l'id e la sede: l'apparato con l'id più piccolo (§13.7.3). */
function primoGestito(s: Segmento): Porta | null {
  return [...s.membri].filter((p) => p.nodo.startsWith("dev:")).sort((x, y) => Number(x.nodo.slice(4)) - Number(y.nodo.slice(4)))[0] ?? null;
}

/**
 * Il modello per cavo nella forma che la pagina e la stampa leggono (TopologyModel): un MapLink per collegamento, i segmenti come
 * nodi, `cavi` con ciò che serve all'albero e ai dettagli. I nodi, le VM, le sedi e i client sono quelli del modello di oggi; le
 * classi, gli isolati, «Da sistemare», le proposte e i conteggi si ricalcolano sulle linee nuove.
 */
export function modelloMappaCavi(t1: TopologyModel, m: ModelloCavi, ing: IngressoCavi): MappaCavi {
  // Un collegamento nasce sempre da una prova: senza, è un difetto del modello, e la rotta lo dice (Caso 3), non lo copre. Il
  // messaggio finisce nel journal: il numero, mai l'id (porta i nomi delle porte, anche quelli scelti dal cliente).
  const senzaProve = m.collegamenti.filter((c) => c.prove.length === 0).length;
  if (senzaProve > 0) throw new Error(`${senzaProve} ${senzaProve === 1 ? "collegamento" : "collegamenti"} senza prove`);
  const perId = new Map(t1.nodes.map((n) => [n.id, n]));
  // Il nodo del segmento (§13.7.3): calcolato, mai salvato; nella sede del suo primo membro gestito.
  const sedeDi = new Map<string, number | null>();
  const segmentiNodi: MapNode[] = m.segmenti.map((s) => {
    const primo = primoGestito(s);
    const siteId = primo ? (perId.get(primo.nodo)?.siteId ?? null) : null;
    sedeDi.set(s.id, siteId);
    return {
      id: s.id, kind: "segmento", refId: 0, name: "segmento", type: "segmento", mgmtIp: null, fusedHostIds: [], addresses: [], aliases: [],
      siteId, rackId: null, siteProposed: true, hidden: false, vendor: null,
    };
  });
  // Contratto del Task 10: con la mappa nuova il ruolo scritto «core» o «accesso» arriva alla pagina (il menu del ruolo lo segna).
  const ruoli = new Map<string, "core" | "accesso">(ing.t1.devices.flatMap((d) => { const r = ruoloRete(d.topology_role); return r ? [[`dev:${d.id}`, r] as const] : []; }));
  const nodes = [...t1.nodes.map((n) => { const r = ruoli.get(n.id); return r ? { ...n, ruolo: r } : n; }), ...segmentiNodi]
    .sort((a, b) => cmp(a.id, b.id));

  // Le classi del modello per cavo (§13.8.2); un nodo che è una VM sta dentro il suo hypervisor e non ha classe (come model.ts).
  const vm = new Set(t1.vms.flatMap((v) => (v.nodeId ? [v.nodeId] : [])));
  const classe = (n: MapNode): ClasseMappa => (n.kind === "segmento" ? "infra" : (m.classi.get(n.id) ?? t1.classiMappa?.[n.id] ?? nodeClass(n)));
  const classiMappa: Record<string, ClasseMappa> = {};
  for (const n of nodes) {
    if (vm.has(n.id)) continue;
    const k = classe(n);
    if (k !== nodeClass(n)) classiMappa[n.id] = k;
  }

  const alias = aliasDeiSegmenti(m.segmenti);
  const idDi = (id: string): string => alias.get(id) ?? t1.canonical[id] ?? id;
  const poePorta = new Map<string, number>();
  for (const p of ing.t1.portInfo) {
    const w = (p.poe_power_mw ?? 0) / 1000;
    if (w > 0) poePorta.set(`${p.device_id}|${normalizePortNameForMatch(p.port_name)}`, w);
  }
  const ctx: ContestoLinea = {
    nowMs: ing.t1.nowMs,
    stella: new Map(m.albero.stelle.map((s) => [s.linea, s.nodo])),
    poe: (nodo, porta) => {
      const d = /^dev:(\d+)$/.exec(nodo);
      return d && porta.trim() ? (poePorta.get(`${d[1]}|${normalizePortNameForMatch(porta)}`) ?? null) : null;
    },
  };
  const links = m.collegamenti.map((c) => lineaDellaMappa(c, ctx)).sort((a, b) => cmp(a.id, b.id));

  // Le stesse regole di buildTopologyModel (model.ts), sulle linee per cavo: il grado conta i collegamenti; un segmento non è mai
  // isolato né «da sistemare»; un nodo che è una VM non entra mai negli isolati. «Membro di un segmento» resta quello di T1.
  const grado = new Map<string, number>();
  for (const l of links) {
    grado.set(l.a, (grado.get(l.a) ?? 0) + 1);
    grado.set(l.b, (grado.get(l.b) ?? 0) + 1);
  }
  const membriDiSegmento = new Set(Object.values(t1.segmenti ?? {}).flat());
  const isolated = nodes
    .filter((n) => n.kind !== "segmento" && !n.hidden && !vm.has(n.id) && (grado.get(n.id) ?? 0) === 0
      && (n.kind === "device" || ["att", "hyper"].includes(nodeClass(n)) || membriDiSegmento.has(n.id)
        || (n.kind === "host" && ["infra", "ap"].includes(classe(n)))))
    .map((n) => n.id);
  const daSistemare = nodes
    .filter((n) => n.kind !== "segmento" && !n.hidden && classiMappa[n.id] === "da_sistemare")
    .map((n) => ({ id: n.id, motivo: motivoDaSistemare(n) }));
  const promote = nodes
    .filter((n) => n.kind === "host" && (PROMOTE_CLASSES as readonly string[]).includes(n.type) && (grado.get(n.id) ?? 0) > 0)
    .map((n) => ({ hostId: n.refId, name: n.name, ip: n.mgmtIp ?? "", classification: n.type, links: grado.get(n.id) ?? 0 }))
    .sort((a, b) => b.links - a.links || a.name.localeCompare(b.name, "it") || a.hostId - b.hostId);
  const porte = new Map(ing.t1.devices.map((d) => [`dev:${d.id}`, d.port_count]));
  const devices = nodes.filter((n) => n.kind === "device");
  const suspicious = isolated.filter((id) => {
    const n = perId.get(id);
    return n !== undefined && n.kind === "device" && TIPI_SOSPETTI.includes(n.type) && (porte.get(id) ?? 0) === 0;
  });
  const withoutSite = devices.filter((n) => !n.hidden && !vm.has(n.id) && n.siteId === null).map((n) => n.id);
  // Un segmento è un apparato di rete che non si legge (§13.7.3): una linea verso di lui è fra oggetti di rete, non un attaccato.
  const diRete = (id: string): boolean => id.startsWith("dev:") || id.startsWith("seg:");
  const isDev = (id: string): boolean => id.startsWith("dev:");
  const counts: ModelCounts = {
    nodes: nodes.length,
    devices: devices.length,
    links: links.length,
    linksBySource: Object.fromEntries((Object.keys(LINK_SOURCE_RANK) as LinkSource[]).map((s) => [s, links.filter((l) => l.source === s).length])) as Record<LinkSource, number>,
    deviceLinks: links.filter((l) => diRete(l.a) && diRete(l.b)).length,
    attachedLinks: links.filter((l) => diRete(l.a) !== diRete(l.b)).length,
    staleLinks: links.filter((l) => l.stale).length,
    unmatchedNeighbors: t1.unmatched.length,
    isolatedDevices: isolated.filter(isDev).length,
    fusedHosts: t1.counts.fusedHosts,
    mergedHosts: t1.counts.mergedHosts,
    devicesWithoutSite: withoutSite.length,
    sitesWithHead: t1.counts.sitesWithHead,
    promoteProposals: promote.length,
    suspiciousTypes: suspicious.length,
    vms: t1.counts.vms,
    hypervisors: t1.counts.hypervisors,
    vmsOnNodes: t1.counts.vmsOnNodes,
    senzaProve: daSistemare.length,
  };

  // Le sedi di oggi (la testa di una sede resta quella di T1, «Scelte» 4), col segmento fra i nodi della sede del primo membro.
  const sites = t1.sites.map((s) => {
    const qui = m.segmenti.filter((x) => sedeDi.get(x.id) === s.locationId).map((x) => x.id);
    return qui.length > 0 ? { ...s, nodeIds: [...s.nodeIds, ...qui] } : s;
  });
  // Caso 1 del piano (§13.7.3): l'id «seg:‹apparato›:‹porta›» di ogni membro gestito porta al segmento che oggi lo contiene.
  const canonical = Object.fromEntries([...Object.entries(t1.canonical), ...[...alias].filter(([k, v]) => k !== v)].sort(([x], [y]) => cmp(x, y)));

  const dalleVm: InfoCavi["dalleVm"] = {};
  for (const d of m.soloDettagli) dalleVm[d.ipervisore] = [...(dalleVm[d.ipervisore] ?? []), { altro: d.altro, porta: d.porta, vm: d.vm }];
  // ★ di prima (§13.9): quelle che `risolviStelle` fa valere per il migliore della coppia, più le ★ fra due oggetti che oggi non
  // hanno collegamenti (che `risolviStelle` salta): la pagina le dice «★ senza collegamento», mai perse in silenzio (Caso 2).
  const coppie = new Set([...m.collegamenti, ...m.soloDettagli.map((d) => d.collegamento)].flatMap((c) => [`${c.a.nodo}|${c.b.nodo}`, `${c.b.nodo}|${c.a.nodo}`]));
  const stelle = new Map<string, InfoCavi["stelleDiPrima"][number]>();
  for (const s of m.albero.stelle) if (s.diPrima) stelle.set(`${s.nodo}|${s.altro}`, { nodo: s.nodo, altro: s.altro, linea: s.linea });
  for (const p of ing.t1.primaries) {
    const nodo = idDi(p.node_id), altro = idDi(p.other_node);
    if (nodo !== altro && !coppie.has(`${nodo}|${altro}`)) stelle.set(`${nodo}|${altro}`, { nodo, altro, linea: "" });
  }
  const cavi: InfoCavi = {
    scelto: Object.fromEntries(m.albero.scelto),
    testa: m.albero.testa,
    anomalie: m.albero.anomalie.map((a) => ({ ...a, altri: [...a.altri] })),
    avvisi: m.albero.avvisi.map((a) => ({ ...a })),
    segmenti: m.segmenti.map((s) => ({ id: s.id, membri: s.membri.map((p) => ({ nodo: p.nodo, porta: p.nome })), altriApparati: s.altriApparati, frase: s.frase })),
    ponti: [...m.ponti].sort(),
    stelleDiPrima: [...stelle.values()].sort((x, y) => cmp(x.nodo, y.nodo) || cmp(x.altro, y.altro)),
    dalleVm,
    nonCalcolato: m.nonCalcolato,
  };
  return {
    nodes, links, sites, promote, unmatched: t1.unmatched, isolated, suspicious, withoutSite, counts,
    portClients: t1.portClients, clientCount: t1.clientCount, canonical, vms: t1.vms,
    correzioniOrfane: m.correzioniOrfane,
    ...(t1.segmenti ? { segmenti: t1.segmenti } : {}),
    classiMappa, daSistemare,
    ...(t1.gatewayDi ? { gatewayDi: t1.gatewayDi } : {}),
    cavi,
  };
}

/** Dall'ingresso alla mappa: il modello di oggi, quello per cavo e la mappa. La testa scelta passa dall'id canonico, e vale solo
 * se è un oggetto della mappa (come `computeMapView`: una testa salvata che non c'è più lascia la proposta). */
export function modelloMappaDaIngresso(ing: IngressoCavi, opz: { testaScelta: string | null }): { t1: TopologyModel; m: ModelloCavi; mappa: MappaCavi } {
  const t1 = buildTopologyModel(ing.t1);
  const id = opz.testaScelta ? (t1.canonical[opz.testaScelta] ?? opz.testaScelta) : null;
  const testa = id !== null && t1.nodes.some((n) => n.id === id) ? id : null;
  const m = costruisciModelloCavi(ing, t1, { testaScelta: testa });
  return { t1, m, mappa: modelloMappaCavi(t1, m, ing) };
}

/**
 * Il nome di ogni oggetto della mappa, per «Candidati per porta»: i nodi del modello di oggi col loro nome; un segmento coi suoi
 * membri («segmento con A, B e altri 2»), perché «segmento verso segmento» non dice niente.
 */
export function nomiDellaMappa(mappa: Pick<MappaCavi, "nodes" | "cavi">): (id: string) => string {
  const nomi = new Map(mappa.nodes.map((n) => [n.id, n.name]));
  const segmenti = new Map(mappa.cavi.segmenti.map((s) => [s.id, s]));
  return (id) => {
    const s = segmenti.get(id);
    if (!s) return nomi.get(id) ?? id;
    const membri = [...new Set(s.membri.map((p) => nomi.get(p.nodo) ?? p.nodo))];
    const mostrati = membri.slice(0, 3);
    const resto = membri.length - mostrati.length + s.altriApparati;
    return `segmento con ${mostrati.join(", ")}${resto > 0 ? ` e altri ${resto}` : ""}`;
  };
}

const NON_NOTA = "porta non nota";
/** Dentro una riga di «Candidati per porta»: al massimo tante prove e tanti scartati, gli altri si contano (revisione del Task 6). */
const PER_RIGA = 16;
const chiaveDi = (p: Pick<Porta, "chiave" | "nome">): string => p.chiave ?? `?${normale(p.nome)}`;

/** Chi è l'apparato di una riga che non si abbina a un oggetto censito: il nome o il MAC che la riga annuncia. */
function nonCensito(telaio: string | null): string {
  const t = (telaio ?? "").replace(/^(nome|mac|riga):/, "").split("|")[0].trim();
  return t ? `${t} (non censito)` : "un apparato non censito";
}

/** Perché una prova della stessa rete non è un cavo, in parole (§13.4.6, §13.7.2 passi 1 e 5, §13.7.5). */
function motivoStessaRete(p: Prova): string {
  if (p.tipo === "tunnel") return "tunnel spento o stato non letto";
  if (p.classe === "annuncio_segmento") return "sentito solo con un annuncio di rete: stessa rete";
  if (p.da.fisica === false) return "sentito da un'interfaccia logica (VLAN, VRRP, bridge): stessa rete";
  if (p.da.fisica === null && p.traduttoreLocale) return "nome scelto: non si sa se è una porta fisica";
  return "stessa rete, non un cavo";
}

/**
 * «Candidati per porta» di un nodo (§13.4.6): una riga per porta, con le prove (chi, con quale protocollo, quando), il collegamento
 * scelto e gli apparati scartati col motivo; un limite e quante righe restano fuori. Le prove sono tutte quelle che riguardano la
 * porta, dai due lati: quelle di chi osserva da lì e quelle di chi la vede come porta remota. Uno scartato compare una volta per
 * porta, col motivo più preciso («oltre» una radio, poi il bordo per porta, poi la stessa rete). Porte in ordine di nome coi numeri;
 * dentro una riga al massimo 16 prove e 16 scartati, con quanti restano fuori (`altreProve`, `altriScartati`).
 */
export function candidatiPerPorta(m: ModelloCavi, nodo: string, nomeDi: (id: string) => string, limite = 64): { righe: CandidatoPorta[]; altri: number } {
  interface Riga extends Omit<CandidatoPorta, "altreProve" | "altriScartati"> { chiave: string; daQui: boolean }
  const righe = new Map<string, Riga>();
  const riga = (p: Porta, daQui: boolean): Riga => {
    const k = chiaveDi(p);
    const nome = p.nome.trim();
    let r = righe.get(k);
    if (!r) {
      r = { chiave: k, porta: nome || NON_NOTA, prove: [], scelto: null, scartati: [], daQui };
      righe.set(k, r);
    } else if (nome && (r.porta === NON_NOTA || (daQui && !r.daQui))) {
      // Il nome come lo scrive l'apparato stesso vince su quello che ne dice l'altro capo.
      r.porta = nome;
      r.daQui = daQui;
    }
    return r;
  };
  const mia = (p: Prova): { porta: Porta; daQui: boolean } | null =>
    p.altro !== null && p.altro.nodo === p.da.nodo ? null
      : p.da.nodo === nodo ? { porta: p.da, daQui: true } : p.altro?.nodo === nodo ? { porta: p.altro, daQui: false } : null;
  const chiDi = (p: Prova): string => (p.da.nodo === nodo ? (p.altro ? nomeDi(p.altro.nodo) : nonCensito(p.telaio)) : nomeDi(p.da.nodo));

  for (const p of m.prove) {
    const x = mia(p);
    if (x) riga(x.porta, x.daQui).prove.push({ chi: chiDi(p), detto: p.detto, quando: p.visto });
  }
  // Il collegamento scelto di ogni porta: prima quello che l'albero usa, poi per id. Un fascio occupa le porte dei suoi membri.
  const usati = new Set([...m.albero.via.values()].map((c) => c.id));
  const suoi = m.collegamenti.filter((c) => c.a.nodo === nodo || c.b.nodo === nodo)
    .sort((x, y) => Number(usati.has(y.id)) - Number(usati.has(x.id)) || cmp(x.id, y.id));
  for (const c of suoi) {
    const porte = c.membri ? c.membri.map((x) => (x.a.nodo === nodo ? x.a : x.b)) : [capo(c, nodo)];
    for (const p of porte) {
      const r = riga(p, true);
      if (r.scelto === null) r.scelto = { linea: c.id, verso: nomeDi(altroCapo(c, nodo).nodo), genere: c.genere };
    }
  }
  const scarta = (p: Porta, daQui: boolean, chi: string, motivo: string): void => {
    const r = riga(p, daQui);
    if (!r.scartati.some((s) => s.chi === chi)) r.scartati.push({ chi, motivo });
  };
  for (const o of m.oltre) {
    if (o.porta.nodo !== nodo) continue;
    for (const a of o.apparati) scarta(o.porta, true, nomeDi(a), `Oltre ${nomeDi(o.radio)} ci sono ${o.apparati.length} apparati di rete: il salto non è letto`);
  }
  for (const b of m.scartateBordo) if (b.porta.nodo === nodo) scarta(b.porta, true, nomeDi(b.verso), b.motivo);
  for (const p of m.stessaRete) {
    const x = mia(p);
    if (x) scarta(x.porta, x.daQui, chiDi(p), motivoStessaRete(p));
  }

  const tutte = [...righe.values()].sort((x, y) => Number(x.porta === NON_NOTA) - Number(y.porta === NON_NOTA)
    || x.porta.localeCompare(y.porta, "it", { numeric: true }) || cmp(x.chiave, y.chiave));
  return {
    righe: tutte.slice(0, limite).map(({ porta, prove, scelto, scartati }) => ({
      porta, prove: prove.slice(0, PER_RIGA), altreProve: Math.max(0, prove.length - PER_RIGA),
      scelto, scartati: scartati.slice(0, PER_RIGA), altriScartati: Math.max(0, scartati.length - PER_RIGA),
    })),
    altri: Math.max(0, tutte.length - limite),
  };
}
