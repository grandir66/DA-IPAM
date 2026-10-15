/**
 * Collegamenti della mappa (spec §3 e §13.7.1, tappa T1): correzioni a mano, uplink del controller, LLDP/CDP/MNDP. Una
 * linea per coppia di oggetti (lo resta fino a T3), con le DUE PORTE PRESE DA UNA PROVA SOLA: il 14/10 la linea
 * «porta 10 ↔ ether8» cuciva la porta di core 1 dell'uplink con la prima riga del router in ordine, e l'«Ignora» su quella
 * linea ha tolto anche il cavo vero a 10G (D1, D3). Passi (§13.7.1): 0. solo l'ultimo giro di ogni vicino (R-superata);
 * 1. la porta locale per chiave, sul nome tradotto: da un'interfaccia logica nessun cavo; 2. una porta che sente due o
 * più apparati via LLDP o CDP è di segmento: non dà cavi, non presta porte, non conferma; 3. i candidati, con l'uplink
 * completato dalla riga del figlio, le righe raggruppate per apparato e la conferma per porta dei router; 5. una linea
 * per coppia con le porte di un candidato solo, gli altri cavi nei dettagli («Altri cavi visti fra questi due oggetti»).
 * I nomi dei prodotti stanno nei traduttori (lettori/): qui solo fatti neutri. Un collegamento che sparisce non si
 * cancella: dopo `staleDays` è «non visto». Logica pura.
 */
import { parseDbDate } from "@/lib/db-date";
import { chiavePorta, elenchiPorte, normale, type Porta } from "@/lib/topology/cavi/porte";
import { identifiesByName, isVirtualMac, realOui } from "@/lib/topology/identity";
import { haTraduttore, haTraduttoreRemoto, macDelTelaio, traduciPorta, type ComeLetto } from "@/lib/topology/lettori/traduci";
import {
  LINK_ATTRS_DEFAULT, LINK_SOURCE_RANK,
  type AltroCavo, type LinkSource, type MapLink, type ModelNeighborRow, type TopologyModelInput, type UnmatchedNeighbor,
} from "@/lib/topology/model-types";
import { canonical, nameKey, nodeFor, resolveNode, type NodeIndex } from "@/lib/topology/node-index";
import { REGOLE_T1, type Regole } from "@/lib/topology/regole";
import type { RunningVmMacs } from "@/lib/topology/vm-ports";
import { normalizeMacForStorage } from "@/lib/utils";

export const DEFAULT_STALE_DAYS = 2;
const DAY_MS = 86_400_000;
/** Il margine di un giro di letture, come NEIGHBORS_LATEST_ROUND_SQL (db-tenant.ts): 5 minuti. */
const GIRO_MS = 5 * 60_000;

export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function timeOf(s: string | null): number | null {
  if (!s) return null;
  const t = parseDbDate(s).getTime();
  return Number.isNaN(t) ? null : t;
}

function sourceOfProtocol(p: string): LinkSource {
  if (p === "cdp") return "cdp";
  if (p === "mndp") return "mndp";
  return "lldp";
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const perRango = (x: LinkSource, y: LinkSource): number => LINK_SOURCE_RANK[x] - LINK_SOURCE_RANK[y] || cmp(x, y);

function isRouterNode(idx: NodeIndex, id: string): boolean {
  const t = idx.nodes.get(id)?.type;
  return t === "router" || t === "firewall";
}

function aggiungiA<V>(m: Map<string, V[]>, k: string, v: V): void {
  const x = m.get(k);
  if (x) x.push(v);
  else m.set(k, [v]);
}

function aggiungiIn<V>(m: Map<string, Set<V>>, k: string, v: V): void {
  const x = m.get(k);
  if (x) x.add(v);
  else m.set(k, new Set([v]));
}

/** Come si è letta una porta (spec §13.6.1): `vendor` e `via` sono dell'apparato a cui la porta appartiene. */
export function comeDi(input: Pick<TopologyModelInput, "devices">): (nodo: string | null, fonte: string, piattaforma: string | null) => ComeLetto {
  const d = new Map(input.devices.map((x) => [`dev:${x.id}`, x]));
  return (nodo, fonte, piattaforma) => {
    const r = nodo ? d.get(nodo) : undefined;
    return { vendor: r?.vendor ?? null, via: r?.via ?? null, fonte, piattaforma };
  };
}

/**
 * La porta di un apparato come la scrive lui (correzioni a mano, tabella MAC, VM): tradotta e con la chiave. Le porte di
 * un apparato del controller col traduttore del controller.
 */
export function portaLocale(input: TopologyModelInput): (nodo: string, nome: string) => Porta | null {
  const come = comeDi(input);
  const elenchi = elenchiPorte(input.ports ?? []);
  const delController = new Set(input.devices.filter((d) => d.controller_mac).map((d) => `dev:${d.id}`));
  return (nodo, nome) => (nome.trim() === ""
    ? null
    : chiavePorta(nodo, traduciPorta(nome, "locale", come(nodo, delController.has(nodo) ? "unifi" : "device", null)), "locale", elenchi.get(nodo)));
}

/** L'apparato remoto di una riga: il telaio (un MAC vero; un MAC VRRP non identifica nessuno), altrimenti il nome. */
function telaio(n: ModelNeighborRow): string {
  const mac = normalizeMacForStorage(n.remote_mac);
  if (mac && !isVirtualMac(mac)) return `mac:${mac}`;
  const nome = n.remote_device_name.trim().toLowerCase();
  return nome ? `nome:${nome}` : `riga:${n.remote_ip ?? ""}|${n.remote_port}`;
}

/**
 * Passo 0, R-superata: per apparato, fonte, porta locale (tradotta) e apparato remoto contano solo le righe dell'ultimo
 * giro di quel gruppo, dal timestamp più recente meno 5 minuti. Una riga troncata («Port») è superata dalla riga nuova
 * («Port 47») dello stesso apparato sulla stessa porta. Un vicino sparito del tutto non è superato: invecchia e diventa
 * «non visto» (ADR 0008). Una riga senza data leggibile resta.
 */
export function righeUltimoGiro(input: Pick<TopologyModelInput, "neighbors" | "devices">): ModelNeighborRow[] {
  const come = comeDi(input);
  const gruppi = new Map<string, ModelNeighborRow[]>();
  for (const n of input.neighbors) {
    const locale = traduciPorta(n.local_port, "locale", come(`dev:${n.device_id}`, n.source, n.remote_platform ?? null));
    aggiungiA(gruppi, `${n.device_id}|${n.source}|${normale(locale.nome)}|${telaio(n)}`, n);
  }
  const out: ModelNeighborRow[] = [];
  for (const g of gruppi.values()) {
    const tempi = g.map((n) => timeOf(n.timestamp)).filter((t): t is number => t !== null);
    const max = tempi.length > 0 ? Math.max(...tempi) : null;
    for (const n of g) {
      const t = timeOf(n.timestamp);
      if (t === null || max === null || t >= max - GIRO_MS) out.push(n);
    }
  }
  return out;
}

/** Le righe di un apparato remoto sulla stessa porta locale (spec §13.6.2): una prova sola. */
interface Gruppo {
  osservatore: string;
  locale: Porta;
  righe: ModelNeighborRow[];
  telaio: string;
  b: string | null;
  /** La porta remota (la certamente fisica fra le righe); null = non nota, l'apparato annuncia solo da una VLAN o una VRRP. */
  remota: Porta | null;
  /** LLDP o CDP (o un valore sconosciuto, che vale come LLDP): un annuncio che non attraversa un apparato gestito. */
  collegamento: boolean;
  source: LinkSource;
  lastSeen: string | null;
}

interface Candidato {
  a: string;
  aPorta: Porta | null;
  b: string;
  bPorta: Porta | null;
  source: LinkSource;
  lastSeen: string | null;
  uplinkFrom: string | null;
  senzaFili: boolean;
}

export interface RisultatoCollegamenti {
  links: MapLink[];
  unmatched: UnmatchedNeighbor[];
  /** Le coppie ignorate a mano: per coppia fino al Task 9 del piano di T1, che le porta al cavo. */
  ignored: ReadonlySet<string>;
  /** Le porte di segmento (passo 2): «nodo|porta normalizzata» → gli oggetti abbinati che la porta sente via LLDP o CDP. */
  segmenti: ReadonlyMap<string, ReadonlySet<string>>;
}

const piuRecente = (xs: ReadonlyArray<string | null>): string | null =>
  xs.reduce<string | null>((acc, s) => ((timeOf(s) ?? -Infinity) > (timeOf(acc) ?? -Infinity) ? s : acc), null);

/**
 * Unisce i gruppi di righe di RouterOS dello stesso apparato sulla stessa porta locale (spec §13.6.4): stesso nome annunciato
 * che identifica e OUI dei MAC veri compatibili (al più uno). Il gruppo unito conta come un apparato (telaio «nome:…|OUI»);
 * due gruppi col nome uguale e OUI diversi restano due, ognuno col suo telaio.
 */
function unisciPerNome(gruppi: Map<string, Gruppo>, diInterfaccia: (g: Gruppo) => boolean): void {
  const perNome = new Map<string, string[]>();
  for (const [k, g] of gruppi) {
    if (!diInterfaccia(g)) continue;
    const nome = g.righe.map((n) => nameKey(n.remote_device_name)).find((x): x is string => !!x && identifiesByName(x));
    if (nome) aggiungiA(perNome, `${g.osservatore}|${g.locale.chiave ?? `?${normale(g.locale.nome)}`}|${nome}`, k);
  }
  const ouiDi = (g: Gruppo): Set<string> => new Set(g.righe.flatMap((n) => { const o = realOui(normalizeMacForStorage(n.remote_mac)); return o ? [o] : []; }));
  for (const [chiave, chiavi] of perNome) {
    if (chiavi.length < 2) continue;
    const nome = chiave.slice(chiave.lastIndexOf("|") + 1);
    const uniti: Gruppo[] = [];
    for (const k of chiavi) {
      const g = gruppi.get(k)!;
      const dove = uniti.find((u) => new Set([...ouiDi(u), ...ouiDi(g)]).size <= 1);
      if (!dove) {
        uniti.push(g);
        continue;
      }
      dove.righe.push(...g.righe);
      dove.telaio = `nome:${nome}|${[...ouiDi(dove)].sort().join(",")}`;
      gruppi.delete(k);
    }
  }
}

/** `regole`: le regole del passaggio universale accese (spec §13.16); le spegne solo la misura (C19). */
export function buildLinks(input: TopologyModelInput, idx: NodeIndex, vmAccese: RunningVmMacs = new Map(), regole: Regole = REGOLE_T1): RisultatoCollegamenti {
  const come = comeDi(input);
  const elenchi = elenchiPorte(input.ports ?? []);
  const locale = portaLocale(input);
  const unmatched: UnmatchedNeighbor[] = [];
  const candidati: Candidato[] = [];
  const ignored = new Set<string>();

  // Correzioni: «aggiungi» è un candidato a mano e vince sempre; «ignora» toglie la coppia (per cavo dal Task 9).
  for (const o of [...input.overrides].sort((x, y) => x.id - y.id)) {
    const a = nodeFor(idx, canonical(idx, o.a_node));
    const b = nodeFor(idx, canonical(idx, o.b_node));
    if (!a || !b || a === b) continue;
    if (o.action === "ignore") {
      ignored.add(pairKey(a, b));
      continue;
    }
    // Senza fili dalle porte tradotte, come per le righe dei vicini: con `false` fisso la porta «wifi» di un collegamento a
    // mano non era più sulla linea e il tipo «wireless» si perdeva (prova di oggi in link-attrs.test.ts, verifica del 15/10).
    const aPorta = locale(a, o.a_port), bPorta = locale(b, o.b_port);
    candidati.push({ a, aPorta, b, bPorta, source: "manual", lastSeen: null, uplinkFrom: null, senzaFili: aPorta?.senzaFili === true || bPorta?.senzaFili === true });
  }

  // Passi 0 e 3b: le righe dell'ultimo giro, raggruppate per apparato remoto (telaio) sulla stessa porta locale. Per
  // telaio e non per nodo abbinato: la riga VRRP della porta 10 di core 1 si abbinerebbe per IP a un altro nodo.
  const righe = righeUltimoGiro(input)
    .filter((n) => idx.nodes.has(`dev:${n.device_id}`))
    .sort((x, y) => x.device_id - y.device_id || cmp(x.local_port, y.local_port) || cmp(x.remote_device_name, y.remote_device_name)
      || cmp(x.remote_port, y.remote_port) || cmp(x.source, y.source));
  const gruppi = new Map<string, Gruppo>();
  for (const n of righe) {
    const osservatore = `dev:${n.device_id}`;
    const loc = chiavePorta(osservatore, traduciPorta(n.local_port, "locale", come(osservatore, n.source, n.remote_platform ?? null)), "locale", elenchi.get(osservatore));
    const t = telaio(n);
    const k = `${osservatore}|${loc.chiave ?? `?${normale(loc.nome)}`}|${t}`;
    const g = gruppi.get(k);
    if (g) g.righe.push(n);
    else gruppi.set(k, { osservatore, locale: loc, righe: [n], telaio: t, b: null, remota: null, collegamento: false, source: "mndp", lastSeen: null });
  }

  // Passo 3b, righe di RouterOS (spec §13.6.4, I60; regola «conto-per-apparato»): il MAC è quello dell'interfaccia che ha
  // mandato l'annuncio, non il telaio, e lo stesso router compare sulla stessa porta con più MAC (rete B: il router di
  // frontiera con quattro). Il gruppo si completa col nome annunciato, quando identifica (`identifiesByName`: niente nomi di
  // fabbrica, corti o esadecimali), salvo due gruppi con MAC veri di OUI diversi, che restano due (la regola di node-index.ts).
  // Le righe col MAC virtuale (VRRP) non hanno un OUI e si uniscono al nome. Il controller e SNMP danno il telaio: niente cambia.
  if (regole.has("conto-per-apparato")) unisciPerNome(gruppi, (g) => !macDelTelaio(come(g.osservatore, g.righe[0].source, null)));

  // L'abbinamento (§13.6.2, I15). Una riga sola da una porta remota fisica o non nota: come prima (IP, MAC, nome). Più righe
  // dello stesso apparato, o una riga sola da una VLAN o da una VRRP: telaio, poi nome; l'IP solo dalle righe la cui porta
  // remota non è un'interfaccia logica. La riga VRRP porta l'IP virtuale, che è di un altro nodo: anche da sola non si
  // abbina per IP (revisione del piano, 15/10).
  const abbina = (g: Gruppo): string | null => {
    const fisica = (n: ModelNeighborRow): boolean => traduciPorta(n.remote_port, "remoto", come(null, n.source, n.remote_platform ?? null)).fisica !== false;
    const r0 = g.righe[0];
    if (g.righe.length === 1 && fisica(r0)) return resolveNode(idx, { ip: r0.remote_ip, mac: r0.remote_mac, name: r0.remote_device_name });
    for (const n of g.righe) {
      const b = resolveNode(idx, { mac: n.remote_mac });
      if (b) return b;
    }
    for (const n of g.righe) {
      const b = resolveNode(idx, { name: n.remote_device_name });
      if (b) return b;
    }
    for (const n of g.righe) {
      if (!n.remote_ip || !fisica(n)) continue;
      const b = resolveNode(idx, { ip: n.remote_ip });
      if (b) return b;
    }
    return null;
  };
  for (const g of gruppi.values()) {
    g.b = abbina(g);
    g.collegamento = g.righe.some((n) => sourceOfProtocol(n.protocol) !== "mndp");
    g.source = g.righe.some((n) => sourceOfProtocol(n.protocol) === "lldp") ? "lldp" : g.collegamento ? "cdp" : "mndp";
    g.lastSeen = piuRecente(g.righe.map((n) => n.timestamp));
    if (g.b === null) {
      const r0 = g.righe[0];
      unmatched.push({ deviceNodeId: g.osservatore, localPort: r0.local_port, remoteName: r0.remote_device_name, remoteIp: r0.remote_ip, remoteMac: r0.remote_mac });
    }
  }

  // La porta remota: la certamente fisica fra le righe del gruppo; se le righe vengono solo da VLAN o VRRP, non è nota (il
  // router di riserva sulla porta 16 di accesso B). Per un apparato senza elenco, il nome vale come chiave solo se è
  // l'unico visto verso di lui (I46).
  const nomiVisti = new Map<string, Set<string>>();
  for (const g of gruppi.values()) {
    const b = g.b;
    if (!b || elenchi.has(b)) continue;
    for (const n of g.righe) {
      const l = traduciPorta(n.remote_port, "remoto", come(b, n.source, n.remote_platform ?? null));
      if (l.nome !== "" && l.fisica !== false) aggiungiIn(nomiVisti, b, normale(l.nome));
    }
  }
  const ordineFisica = (f: boolean | null): number => (f === true ? 0 : f === null ? 1 : 2);
  for (const g of gruppi.values()) {
    const b = g.b;
    if (!b) continue;
    const lette = g.righe
      .map((n) => ({ n, l: traduciPorta(n.remote_port, "remoto", come(b, n.source, n.remote_platform ?? null)), t: timeOf(n.timestamp) ?? 0 }))
      .filter((x) => x.l.nome !== "")
      .sort((x, y) => ordineFisica(x.l.fisica) - ordineFisica(y.l.fisica) || y.t - x.t || cmp(x.l.nome, y.l.nome));
    const scelta = lette[0];
    // G2 (spec §13.6.1): dal lato di un MikroTik un nome che il traduttore non riconosce (scelto dal cliente, «non noto») non è
    // una porta fisica: la porta remota resta non nota, come per una VLAN o una VRRP (regola «nome-scelto-non-fisico»).
    const sceltoRemoto = scelta !== undefined && scelta.l.fisica === null && scelta.l.senzaFili !== true && regole.has("nome-scelto-non-fisico")
      && haTraduttoreRemoto(come(b, scelta.n.source, scelta.n.remote_platform ?? null));
    g.remota = scelta && scelta.l.fisica !== false && !sceltoRemoto ? chiavePorta(b, scelta.l, "remoto", elenchi.get(b), null, nomiVisti.get(b)) : null;
  }

  // Passo 2: apparati per porta, via LLDP o CDP, entro la soglia «non visto» dalla lettura più recente dello stesso
  // apparato e della stessa fonte, uno per apparato (un hypervisor e le sue VM sono uno solo). Due o più: porta di
  // segmento (decisa in T1, §13.15 punto 2). Senza la finestra, dopo un ricablaggio la porta sentirebbe per 90 giorni il
  // vicino di ieri e quello di oggi, e diventerebbe di segmento togliendo il cavo vero (I43). Su una porta non nota non
  // si conta (I13).
  const ultima = new Map<string, number>();
  for (const n of righe) {
    const t = timeOf(n.timestamp);
    const k = `${n.device_id}|${n.source}`;
    if (t !== null) ultima.set(k, Math.max(ultima.get(k) ?? t, t));
  }
  const finestra = input.staleDays * DAY_MS;
  const fresca = (n: ModelNeighborRow): boolean => {
    const t = timeOf(n.timestamp);
    const u = ultima.get(`${n.device_id}|${n.source}`);
    return t === null || u === undefined || t >= u - finestra;
  };
  const ipervisori = new Set([...vmAccese.values()].flatMap((v) => (v.hypervisor ? [v.hypervisor] : [])));
  const apparato = (g: Gruppo): string => {
    const mac = g.telaio.startsWith("mac:") ? g.telaio.slice(4) : null;
    const h = (mac ? vmAccese.get(mac)?.hypervisor : null) ?? (g.b !== null && ipervisori.has(g.b) ? g.b : null);
    return h ? `nodo:${h}` : g.b ? `nodo:${g.b}` : g.telaio;
  };
  const contabile = (p: Porta): boolean => p.certa && (p.fisica === true || p.senzaFili === true);
  const sentiti = new Map<string, Set<string>>();
  const membri = new Map<string, Set<string>>();
  for (const g of gruppi.values()) {
    if (!contabile(g.locale) || g.b === g.osservatore) continue;
    if (!g.righe.some((n) => sourceOfProtocol(n.protocol) !== "mndp" && fresca(n))) continue;
    aggiungiIn(sentiti, `${g.osservatore}|${g.locale.chiave}`, apparato(g));
    if (g.b) aggiungiIn(membri, `${g.osservatore}|${normale(g.locale.nome)}`, g.b);
  }
  const diSegmento = new Set([...sentiti].filter(([, s]) => s.size >= 2).map(([k]) => k));
  const sulSegmento = (g: Gruppo): boolean => diSegmento.has(`${g.osservatore}|${g.locale.chiave}`);
  const segmenti = new Map<string, ReadonlySet<string>>();
  for (const g of gruppi.values()) {
    const k = `${g.osservatore}|${normale(g.locale.nome)}`;
    if (sulSegmento(g)) segmenti.set(k, membri.get(k) ?? new Set());
  }

  // Passo 3a: uplink del controller, dal figlio (chi esce) al padre. Se il controller non sa la porta del padre (un padre
  // che non è del controller, come il router), la porta viene dalla riga LLDP che il figlio ha sulla sua porta di uplink
  // verso lo stesso nodo: mai da un'altra porta, mai da una porta di segmento, mai da MNDP; se quella riga non c'è,
  // resta vuota. Prima la riempiva la prima riga del router in ordine (`ether8`): la porta cucita del 14/10 (I6).
  const uplinkPort = new Map<number, { index: number; name: string }>();
  for (const p of [...input.uplinkPorts].sort((x, y) => x.device_id - y.device_id || x.port_index - y.port_index)) {
    if (!uplinkPort.has(p.device_id)) uplinkPort.set(p.device_id, { index: p.port_index, name: p.port_name });
  }
  const gruppiDi = new Map<string, Gruppo[]>();
  for (const g of gruppi.values()) aggiungiA(gruppiDi, g.osservatore, g);
  for (const d of [...input.devices].sort((x, y) => x.id - y.id)) {
    if (!d.uplink_mac) continue;
    const a = `dev:${d.id}`;
    const b = resolveNode(idx, { mac: d.uplink_mac });
    if (!b || b === a) continue;
    const up = uplinkPort.get(d.id);
    // La porta di uplink è una riga dell'elenco delle porte (switch_ports): il suo indice è la chiave.
    const aPorta = up ? chiavePorta(a, traduciPorta(up.name, "locale", come(a, "unifi", null)), "locale", elenchi.get(a), up.index) : null;
    let bPorta: Porta | null = null;
    if (d.uplink_remote_port != null) {
      const nomeInElenco = elenchi.get(b)?.perIndice.get(d.uplink_remote_port);
      bPorta = chiavePorta(b, traduciPorta(nomeInElenco ?? `Port ${d.uplink_remote_port}`, "remoto", come(b, "unifi", null)), "remoto",
        elenchi.get(b), nomeInElenco !== undefined ? d.uplink_remote_port : null);
    } else if (aPorta?.chiave) {
      const k = aPorta.chiave;
      bPorta = (gruppiDi.get(a) ?? []).find((g) => g.b === b && g.collegamento && g.locale.chiave === k && !sulSegmento(g))?.remota ?? null;
    }
    candidati.push({ a, aPorta, b, bPorta, source: "unifi_uplink", lastSeen: d.uplink_seen_at, uplinkFrom: a, senzaFili: false });
  }

  // Passo 3c, conferma per porta (completa §11.1): una riga del router sulla sua porta P verso B è candidata se B è l'unico
  // oggetto su P (contando tutte le righe, MNDP compreso, come prima), oppure se B vede il router via LLDP, CDP o uplink del
  // controller su una sua porta che non è di segmento e con porta remota uguale a P. MNDP non conferma mai (M-5). Prima la
  // conferma era per coppia: la riga su `ether8` passava perché core 1 vede il router… sulla porta 10 (I4).
  const chiaveSu = (g: Gruppo): string => `${g.osservatore}|${g.locale.chiave ?? `?${normale(g.locale.nome)}`}`;
  const logica = (p: Porta): boolean => p.fisica === false && p.senzaFili !== true;
  /**
   * Passo 1 per le righe di un router (spec §13.6.1, §13.7.1; I58, H7; regola «nome-scelto-non-fisico»): per un router letto
   * col traduttore del suo prodotto (un MikroTik via SSH) «porta fisica» vuol dire `fisica: true` — un nome scelto dal
   * cliente («non noto») non lo è, né per l'«unico vicino» né per la conferma. Col traduttore generico (un router di un'altra
   * marca, letto via SNMP in T1) vale «non logica», come prima: senza fatti dal nome, un router di un'altra marca non perde i
   * cavi che ha. Le porte senza fili hanno le loro regole (sotto). Rete B: la linea fra il router e il router di frontiera
   * passava da una VLAN dal nome scelto, dove il secondo era l'unico vicino.
   */
  const portaDelRouter = (g: Gruppo): boolean => {
    if (g.locale.senzaFili === true) return true;
    const conTraduttore = regole.has("nome-scelto-non-fisico") && haTraduttore(come(g.osservatore, g.righe[0].source, null));
    return conTraduttore ? g.locale.fisica === true : g.locale.fisica !== false;
  };
  const vedeDaPortaFisica = (g: Gruppo): boolean => !logica(g.locale) && (!isRouterNode(idx, g.osservatore) || portaDelRouter(g));
  const nodiSu = new Map<string, Set<string>>();
  for (const g of gruppi.values()) if (g.b && g.b !== g.osservatore) aggiungiIn(nodiSu, chiaveSu(g), g.b);
  const conferme = new Set<string>(); // «router|chiave della sua porta|chi lo vede»
  for (const g of gruppi.values()) {
    if (g.b && g.collegamento && !sulSegmento(g) && vedeDaPortaFisica(g) && g.remota?.chiave) conferme.add(`${g.b}|${g.remota.chiave}|${g.osservatore}`);
  }
  for (const c of candidati) if (c.source === "unifi_uplink" && c.bPorta?.chiave) conferme.add(`${c.b}|${c.bPorta.chiave}|${c.a}`);
  for (const g of gruppi.values()) {
    const b = g.b;
    if (!b || b === g.osservatore || logica(g.locale) || sulSegmento(g)) continue; // passo 1 (I5) e passo 2 (I7)
    if (isRouterNode(idx, g.osservatore)) {
      if (g.locale.nome === "" || !portaDelRouter(g)) continue;
      const diretto = (nodiSu.get(chiaveSu(g))?.size ?? 0) === 1;
      const confermato = g.locale.chiave !== null && conferme.has(`${g.osservatore}|${g.locale.chiave}|${b}`);
      // Una porta senza fili del router ha le regole di una porta fisica, ma vuole la conferma (§13.6.2).
      if (!confermato && (!diretto || g.locale.senzaFili === true)) continue;
    }
    candidati.push({
      a: g.osservatore, aPorta: g.locale.nome ? g.locale : null, b, bPorta: g.remota, source: g.source, lastSeen: g.lastSeen,
      uplinkFrom: null, senzaFili: g.locale.senzaFili === true || g.remota?.senzaFili === true,
    });
  }

  // Passo 5: una linea per coppia, con le porte di un candidato solo (sostituisce ADR 0008 punto 11).
  const perCoppia = new Map<string, Candidato[]>();
  for (const c of candidati) {
    const k = pairKey(c.a, c.b);
    if (!ignored.has(k)) aggiungiA(perCoppia, k, c);
  }
  const links = [...perCoppia].map(([k, cs]) => lineaDellaCoppia(k, cs)).sort((x, y) => cmp(x.id, y.id));
  for (const l of links) {
    const t = timeOf(l.lastSeen);
    if (l.sources.includes("manual") || t === null) {
      l.stale = false;
      l.daysUnseen = null;
      continue;
    }
    const age = Math.max(0, input.nowMs - t);
    l.daysUnseen = Math.floor(age / DAY_MS);
    l.stale = age > input.staleDays * DAY_MS;
  }
  return { links, unmatched, ignored, segmenti };
}

const chiaveDi = (p: Porta | null): string | null => p?.chiave ?? null;
const compatibili = (x: Porta | null, y: Porta | null): boolean => {
  const a = chiaveDi(x), b = chiaveDi(y);
  return a === null || b === null || a === b;
};
const piena = (p: Porta | null): boolean => !!p && p.nome.trim() !== "";

/**
 * La linea di una coppia (§13.7.1, passo 5): le due porte vengono da UN candidato — il migliore per rango fra quelli che
 * le hanno tutte e due; se nessuno, il migliore con una; a pari rango il cavo visto da più prove, poi il più recente.
 * Fonti e «visto» raccolgono solo i candidati dello stesso cavo (stesse porte, o porta vuota compatibile); gli altri sono
 * «Altri cavi visti fra questi due oggetti». Il verso (uplinkFrom) è della coppia. Il capo «a» è quello del primo
 * candidato, come prima.
 */
function lineaDellaCoppia(key: string, cs: readonly Candidato[]): MapLink {
  const a = cs[0].a, b = cs[0].b;
  const lati = (c: Candidato): { pa: Porta | null; pb: Porta | null } => (c.a === a ? { pa: c.aPorta, pb: c.bPorta } : { pa: c.bPorta, pb: c.aPorta });
  const stesso = (x: Candidato, y: Candidato): boolean => {
    const X = lati(x), Y = lati(y);
    return compatibili(X.pa, Y.pa) && compatibili(X.pb, Y.pb);
  };
  const livello = (c: Candidato): number => (piena(c.aPorta) && piena(c.bPorta) ? 0 : piena(c.aPorta) || piena(c.bPorta) ? 1 : 2);
  const firma = (c: Candidato): string => {
    const X = lati(c);
    return `${X.pa?.chiave ?? X.pa?.nome ?? ""}|${X.pb?.chiave ?? X.pb?.nome ?? ""}|${c.source}`;
  };
  const prove = (c: Candidato): number => cs.filter((d) => stesso(c, d)).length;
  const scelto = [...cs].sort((x, y) =>
    livello(x) - livello(y) || LINK_SOURCE_RANK[x.source] - LINK_SOURCE_RANK[y.source] || prove(y) - prove(x)
    || (timeOf(y.lastSeen) ?? 0) - (timeOf(x.lastSeen) ?? 0) || cmp(firma(x), firma(y)))[0];
  const stessi = cs.filter((c) => stesso(scelto, c));
  const sources = [...new Set(stessi.map((c) => c.source))].sort(perRango);
  const altri = new Map<string, AltroCavo>();
  for (const c of cs) {
    if (stesso(scelto, c)) continue;
    const X = lati(c);
    const k = `${X.pa?.chiave ?? X.pa?.nome ?? ""}|${X.pb?.chiave ?? X.pb?.nome ?? ""}`;
    const cur = altri.get(k) ?? { aPort: X.pa?.nome ?? "", bPort: X.pb?.nome ?? "", sources: [], lastSeen: null };
    if (!cur.sources.includes(c.source)) cur.sources = [...cur.sources, c.source].sort(perRango);
    cur.lastSeen = piuRecente([cur.lastSeen, c.lastSeen]);
    altri.set(k, cur);
  }
  const S = lati(scelto);
  const altriCavi = [...altri.values()].sort((x, y) => cmp(x.aPort, y.aPort) || cmp(x.bPort, y.bPort));
  return {
    id: `link:${key}`, a, aPort: S.pa?.nome ?? "", b, bPort: S.pb?.nome ?? "", source: sources[0], sources,
    uplinkFrom: cs.find((c) => c.uplinkFrom !== null)?.uplinkFrom ?? null, lastSeen: piuRecente(stessi.map((c) => c.lastSeen)),
    daysUnseen: null, stale: false, ...LINK_ATTRS_DEFAULT,
    ...(stessi.some((c) => c.senzaFili) ? { medium: "wireless" as const } : {}),
    ...(altriCavi.length > 0 ? { altriCavi } : {}),
  };
}
