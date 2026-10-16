/**
 * Le prove neutre per porta del modello per cavo (spec topologia §13.4.3-13.4.4, §13.5.7 «Chi legge che cosa»; T2 in ombra,
 * T3 a schermo). I lettori scrivono fatti, i traduttori (lettori/) portano le forme dei nomi in fatti neutri, e qui le righe
 * dei vicini di TUTTE le fonti, gli uplink del controller, i partner dei fasci, la tabella MAC, le VM e le correzioni a mano
 * diventano prove con le parole dello standard. Nessun prodotto, nessuna forma di porta di un prodotto, nessun valore del DB
 * che nomina un prodotto (prova I37): quei valori passano da lettori/fonti.ts. Logica pura.
 */
import { FUSO_UTENTI, parseDbDate } from "@/lib/db-date";
import { identifiesByName, isVirtualMac, realOui } from "@/lib/topology/identity";
import { classeDelProtocollo, dettoDelProtocollo, FONTE_CONTROLLER, lettoreDellaFonte } from "@/lib/topology/lettori/fonti";
import { eTunnelDiFabbrica, haTraduttore, haTraduttoreRemoto, macDelTelaio, traduciPorta } from "@/lib/topology/lettori/traduci";
import { MEDIA } from "@/lib/topology/link-attrs";
import { comeDi, portaLocale, righeUltimoGiro } from "@/lib/topology/links";
import type { LinkMedium, MapLink, ModelNeighborRow, TopologyModelInput } from "@/lib/topology/model-types";
import { canonical, nameKey, nodeFor, resolveNode, type NodeIndex } from "@/lib/topology/node-index";
import { normalizeMacForStorage } from "@/lib/utils";
import { chiavePorta, elencoDa, elenchiPorte, normale, type ElencoPorte, type Porta } from "./porte";

export type { Porta };
export type TipoProva = "cavo" | "senza_fili" | "tunnel" | "segmento" | "stessa_rete" | "verso" | "stato" | "bordo" | "a_mano";
/** Chi ha letto, mai la marca. */
export type Lettore = "apparato" | "controller" | "snmp" | "host" | "persona";
/** Che cosa vale l'annuncio per la logica: «collegamento» non attraversa un apparato gestito, «segmento» sì. */
export type Classe = "annuncio_collegamento" | "annuncio_segmento" | "uplink" | "spanning_tree" | "fascio" | "tabella_mac" | "vm" | "a_mano";

export interface Prova {
  tipo: TipoProva;
  /** Chi osserva, sulla sua porta. */
  da: Porta;
  /** L'altro capo, se la prova lo dice (nodo abbinato; porta non nota = chiave null). */
  altro: Porta | null;
  /** L'apparato annunciato, anche se non si abbina a un nodo. */
  telaio: string | null;
  classe: Classe;
  /** Il protocollo in parole, scritto da lettori/fonti.ts («LLDP», «CDP», «un annuncio di rete»…): solo per le frasi, mai per le regole. */
  detto: string;
  lettore: Lettore;
  stato?: "inoltra" | "bloccata" | "instradata" | "riserva_bond" | "giu" | "spenta";
  ruolo?: "root" | "designated" | "alternate" | "backup" | "disabled";
  albero?: number;
  vlan?: number[];
  appartiene?: { bridge?: string; fascio?: string };
  /** Ultima lettura (UTC, come nel DB). */
  visto: string | null;
  /** In italiano: «Perché questo collegamento». */
  frase: string;
  /** Le capacità annunciate attive (T2): servono a riconoscere le due radio di un ponte (§13.7.6). Quelle di un annuncio col
   * nome di sistema, se c'è; altrimenti di una riga qualunque. */
  capacita?: string | null;
  /** Le capacità annunciate SOLO dalle righe col nome di sistema: le sole che valgono come prova di ruolo (§13.8.2). Una riga
   * senza nome (l'LLDP del firmware delle schede) non le dà mai, anche se la riga col nome non ne ha (revisione del Task 3). */
  capacitaConNome?: string | null;
  /** Almeno una riga del gruppo ha il nome di sistema (non vuoto, non un IP né un MAC scritto al posto del nome): solo così le
   * capacità annunciate sono una prova (§13.8.2). */
  conNome?: boolean;
  /** La porta locale passa dal traduttore del suo prodotto (per le regole dei router, §13.7.1 passo 1). */
  traduttoreLocale?: boolean;
  /** L'apparato remoto annuncia da un'interfaccia senza fili (la radio lontana di un ponte, §13.7.6). */
  annunciaSenzaFili?: boolean;
  /** Uplink del controller: il figlio è un gateway (la porta è la sua WAN, §13.8.3 punto 1); da dove il controller lo ricava. */
  gateway?: boolean;
  origine?: string | null;
  /** Correzione a mano: il MAC dell'altro oggetto visto sulla porta dichiarata (§13.9; il cavo con le stesse porte lo guarda
   * collegamenti.ts). */
  confermato?: boolean;
  /** Correzione a mano: il tipo dichiarato («tunnel» da T3), se è un tipo noto. */
  medio?: LinkMedium | null;
  /** Prova dalle VM: quante VM accese passano dalla porta (§12.5, principale dell'hypervisor). */
  vm?: number;
}

export interface ViciniCaviRow extends ModelNeighborRow {
  remote_platform: string | null;
  discovered_by: string | null;
  local_port_index: number | null;
  remote_port_index: number | null;
  remote_caps: string | null;
}

export interface FattoPorta {
  device_id: number; source: string; port_key: string; port_name: string; port_index: number | null;
  if_kind: string | null; running: number | null; in_bridge: number | null; bridge: string | null;
  lag_group: string | null; lag_partner: string | null; lag_state: string | null;
  stp_role: string | null; stp_state: string | null; designated_bridge: string | null; designated_port: string | null;
  path_cost: number | null; edge: number | null; point_to_point: number | null; sending_rstp: number | null; bpdu_rx: number | null;
  seen_at: string;
}

export interface FattoBridge {
  device_id: number; source: string; bridge_name: string; instance: number; protocol: string | null; priority: number | null;
  bridge_id: string | null; root_id: string | null; regional_root_id: string | null; region_name: string | null;
  region_revision: number | null; config_digest: string | null; vlans: string | null; root_port: string | null;
  root_path_cost: number | null; seen_at: string;
}

/** L'ingresso del modello di oggi più ciò che legge solo il modello per cavo (spec §13.5.7, «Chi legge che cosa»). */
export interface IngressoCavi {
  t1: TopologyModelInput;
  /** Tutte le fonti, con le colonne nuove. */
  vicini: ViciniCaviRow[];
  /** Solo l'ultimo giro di ogni apparato e lettore. */
  fattiPorta: FattoPorta[];
  fattiBridge: FattoBridge[];
  /** `topology_device_macs` e le schede di `device_interfaces`: solo per l'identità. */
  macApparati: Array<{ device_id: number; mac: string; source: string }>;
  uplink: Array<{ device_id: number; uplink_local_port_idx: number | null; uplink_source: string | null }>;
  /** false = lo schema delle letture in più non c'è: gli elenchi sono vuoti, e la traccia lo dice. */
  schema: boolean;
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
function metti<K, V>(m: Map<K, V[]>, k: K, v: V): void {
  const x = m.get(k);
  if (x) x.push(v);
  else m.set(k, [v]);
}
function tempo(s: string | null | undefined): number | null {
  if (!s) return null;
  const t = parseDbDate(s).getTime();
  return Number.isNaN(t) ? null : t;
}
export function piuRecente(xs: ReadonlyArray<string | null>): string | null {
  return xs.reduce<string | null>((acc, s) => ((tempo(s) ?? -Infinity) > (tempo(acc) ?? -Infinity) ? s : acc), null);
}
function quando(utc: string | null): string {
  const t = tempo(utc);
  return t === null ? "in un momento non noto" : new Intl.DateTimeFormat("it-IT", { timeZone: FUSO_UTENTI, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(t));
}
/** Il giorno italiano di una data del DB (UTC). */
function giorno(utc: string): string | null {
  const t = tempo(utc);
  return t === null ? null : new Intl.DateTimeFormat("it-IT", { timeZone: FUSO_UTENTI, day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(t));
}

/** Una porta di cui si sa solo l'apparato. */
export function portaVuota(nodo: string): Porta {
  return { nodo, chiave: null, nome: "", certa: false, fisica: null, senzaFili: null, nelBridge: null };
}

export interface IndiceFatti {
  /** I fatti di una porta, di ogni lettore: per chiave e per nome normalizzato. */
  porta(nodo: string, p: Pick<Porta, "chiave" | "nome">): FattoPorta[];
  /** I bridge di un apparato. */
  bridge(nodo: string): FattoBridge[];
}

export function indiceFatti(ing: Pick<IngressoCavi, "fattiPorta" | "fattiBridge">): IndiceFatti {
  const perChiave = new Map<string, FattoPorta[]>(), perNome = new Map<string, FattoPorta[]>(), br = new Map<string, FattoBridge[]>();
  for (const f of ing.fattiPorta) {
    metti(perChiave, `dev:${f.device_id}|${f.port_key}`, f);
    metti(perNome, `dev:${f.device_id}|${normale(f.port_name)}`, f);
  }
  for (const b of ing.fattiBridge) metti(br, `dev:${b.device_id}`, b);
  return {
    porta: (nodo, p) => {
      const a = p.chiave ? (perChiave.get(`${nodo}|${p.chiave}`) ?? []) : [];
      const b = p.nome ? (perNome.get(`${nodo}|${normale(p.nome)}`) ?? []) : [];
      // §13.6.1, la chiave della porta (criterio D della misura del 16/10): due porte dello stesso apparato con lo stesso nome si
      // distinguono per indice. Se un lettore scrive quel nome per due porte (indici diversi), per nome valgono solo i suoi fatti
      // con l'indice della chiave; senza la chiave d'indice, nessuno: la porta è da completare, mai lo stato di una delle due. Sulla
      // rete B la porta 16 «SFP+ 15» accesa prendeva anche i fatti della 15 «SFP+ 15» spenta, e il cavo risultava giù.
      const i = p.chiave?.startsWith("i:") ? Number(p.chiave.slice(2)) : null;
      const indici = new Map<string, Set<number>>();
      for (const f of b) if (f.port_index !== null) indici.set(f.source, (indici.get(f.source) ?? new Set<number>()).add(f.port_index));
      const dellaPorta = b.filter((f) => f.port_index === null || (indici.get(f.source)?.size ?? 0) <= 1 || f.port_index === i);
      return [...new Set([...a, ...dellaPorta])];
    },
    bridge: (nodo) => br.get(nodo) ?? [],
  };
}

const FISICI = new Set(["physical", "lag"]);
/** Il tipo letto vince sul nome (spec §13.6.1): fisica, logica o senza fili da `if_kind`; nel bridge da `in_bridge`. */
export function conFatti(p: Porta, fatti: readonly FattoPorta[]): Porta {
  const tipo = fatti.find((f) => f.if_kind !== null)?.if_kind ?? null;
  const ponte = fatti.find((f) => f.in_bridge !== null)?.in_bridge ?? null;
  if (tipo === null && ponte === null) return p;
  return {
    ...p,
    ...(tipo !== null ? { fisica: FISICI.has(tipo), senzaFili: tipo === "wireless" } : {}),
    ...(ponte !== null ? { nelBridge: ponte === 1 } : {}),
  };
}

/**
 * Gli elenchi delle porte con la precedenza del §13.5.7: per un apparato del controller l'elenco del controller (i fatti di
 * quel lettore, con l'indice); per gli altri quello del loro lettore (SNMP, con l'ifIndex); `switch_ports` solo dove non ce
 * n'è un altro (un'interrogazione a mano riscrive switch_ports fino alla lettura notturna, ADR 0008 punto 4).
 */
export function elenchiCavi(ing: Pick<IngressoCavi, "t1" | "fattiPorta">): Map<string, ElencoPorte> {
  const out = elenchiPorte(ing.t1.ports ?? []);
  const perLettore = new Map<string, Map<Lettore, Array<{ port_index: number; port_name: string }>>>();
  for (const f of ing.fattiPorta) {
    if (f.port_index === null) continue;
    const nodo = `dev:${f.device_id}`;
    const m = perLettore.get(nodo) ?? new Map<Lettore, Array<{ port_index: number; port_name: string }>>();
    metti(m, lettoreDellaFonte(f.source), { port_index: f.port_index, port_name: f.port_name });
    perLettore.set(nodo, m);
  }
  for (const [nodo, m] of perLettore) {
    const righe = m.get("controller") ?? m.get("snmp");
    if (righe && righe.length > 0) out.set(nodo, elencoDa(righe));
  }
  return out;
}

export interface ContestoProve {
  idx: NodeIndex;
  elenchi: ReadonlyMap<string, ElencoPorte>;
  come: ReturnType<typeof comeDi>;
  fatti: IndiceFatti;
  /** Un MAC di `altro` visto non vecchio sulla porta `porta` di `nodo` (`macSullaPorta` di link-attrs.ts): la verifica a mano per
   * cavo (§13.9). Senza, una correzione è confermata come la dice la linea del modello di oggi. */
  macSullaPorta?: (nodo: string, porta: string, altro: string) => boolean;
}

interface Gruppo { osservatore: string; locale: Porta; righe: ViciniCaviRow[]; telaio: string; b: string | null; remota: Porta | null }

/** L'apparato remoto di una riga: il telaio (un MAC vero), altrimenti il nome (come il modello di oggi). */
function telaioDi(n: ModelNeighborRow): string {
  const mac = normalizeMacForStorage(n.remote_mac);
  if (mac && !isVirtualMac(mac)) return `mac:${mac}`;
  const nome = n.remote_device_name.trim().toLowerCase();
  return nome ? `nome:${nome}` : `riga:${n.remote_ip ?? ""}|${n.remote_port}`;
}

/** Righe di un'interfaccia (non del telaio) dello stesso apparato sulla stessa porta: unite col nome annunciato che identifica (§13.6.4, I60). */
function unisciPerNome(gruppi: Map<string, Gruppo>, diInterfaccia: (g: Gruppo) => boolean): void {
  const perNome = new Map<string, string[]>();
  for (const [k, g] of gruppi) {
    if (!diInterfaccia(g)) continue;
    const nome = g.righe.map((n) => nameKey(n.remote_device_name)).find((x): x is string => !!x && identifiesByName(x));
    if (nome) metti(perNome, `${g.osservatore}|${g.locale.chiave ?? `?${normale(g.locale.nome)}`}|${nome}`, k);
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

const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;
const MAC_SCRITTO = /^[0-9a-f]{2}([:-]?)[0-9a-f]{2}(?:\1[0-9a-f]{2}){4}$/i;

/**
 * L'abbinamento del modello per cavo (spec §13.6.4, ultimo punto; T3.6, I15): prima il telaio (i MAC delle righe), poi il
 * nome, poi l'IP, e l'IP solo dalle righe con una porta remota fisica (o non nota). Una riga VRRP o di una VLAN porta l'IP di
 * un'altra interfaccia, che l'inventario può aver messo su un altro apparato: provato per primo, come fa il modello di oggi
 * (resolveNode), l'IP mandava la riga sul nodo sbagliato. Il nome vale solo quando identifica (`identifiesByName`, I3): un
 * nome di fabbrica, corto o solo esadecimale lo portano tanti apparati (revisione del Task 3 di T3). Un MAC scritto al posto
 * del nome è un telaio; un IP scritto al posto del nome è un IP, con la stessa regola. Il modello di oggi resta com'è: spento
 * = T1 (piano di T3, «Scelte» 1).
 */
function abbina(g: Gruppo, idx: NodeIndex, come: ContestoProve["come"]): string | null {
  const fisica = (n: ViciniCaviRow): boolean => traduciPorta(n.remote_port, "remoto", come(null, n.source, n.remote_platform)).fisica !== false;
  const nomeIp = (n: ViciniCaviRow): string | null => (IPV4.test(n.remote_device_name.trim()) ? n.remote_device_name.trim() : null);
  for (const n of g.righe) {
    const scritto = MAC_SCRITTO.test(n.remote_device_name.trim()) ? n.remote_device_name.trim() : null;
    for (const mac of [n.remote_mac, scritto]) {
      const b = mac ? resolveNode(idx, { mac }) : null;
      if (b) return b;
    }
  }
  for (const n of g.righe) {
    const k = nameKey(n.remote_device_name);
    if (!k || !identifiesByName(k)) continue;
    const b = resolveNode(idx, { name: n.remote_device_name });
    if (b) return b;
  }
  for (const n of g.righe) {
    if (!fisica(n)) continue;
    for (const ip of [n.remote_ip, nomeIp(n)]) {
      const b = ip ? resolveNode(idx, { ip }) : null;
      if (b) return b;
    }
  }
  return null;
}

/**
 * Le prove dall'ingresso (spec §13.4.4). Vicini: una prova per apparato remoto e porta locale (le righe dello stesso
 * apparato sono una prova sola, §13.6.2), dall'ultimo giro (R-superata, come oggi), con la porta locale tradotta, la chiave
 * con l'indice del lettore e il tipo letto; la porta remota come oggi, con l'indice del lettore. Poi gli uplink del
 * controller (verso), i partner dei fasci, la tabella MAC e le VM (bordo, le regole di oggi) e le correzioni a mano.
 */
export function proveDaInput(ing: IngressoCavi, ctx: ContestoProve, t1: { links: readonly MapLink[] }): Prova[] {
  const { idx, elenchi, come, fatti } = ctx;
  const prove: Prova[] = [];
  const nome = (id: string | null): string => (id ? (idx.nodes.get(id)?.name ?? id) : "un apparato non censito");

  const righe = (righeUltimoGiro({ neighbors: ing.vicini, devices: ing.t1.devices }) as ViciniCaviRow[])
    .filter((n) => idx.nodes.has(`dev:${n.device_id}`))
    .sort((x, y) => x.device_id - y.device_id || cmp(x.local_port, y.local_port) || cmp(x.remote_device_name, y.remote_device_name)
      || cmp(x.remote_port, y.remote_port) || cmp(x.source, y.source));
  const gruppi = new Map<string, Gruppo>();
  for (const n of righe) {
    const oss = `dev:${n.device_id}`;
    const base = chiavePorta(oss, traduciPorta(n.local_port, "locale", come(oss, n.source, n.remote_platform)), "locale", elenchi.get(oss), n.local_port_index);
    const locale = conFatti(base, fatti.porta(oss, base));
    const t = telaioDi(n);
    const k = `${oss}|${locale.chiave ?? `?${normale(locale.nome)}`}|${t}`;
    const g = gruppi.get(k);
    if (g) g.righe.push(n);
    else gruppi.set(k, { osservatore: oss, locale, righe: [n], telaio: t, b: null, remota: null });
  }
  unisciPerNome(gruppi, (g) => !macDelTelaio(come(g.osservatore, g.righe[0].source, null)));
  for (const g of gruppi.values()) g.b = abbina(g, idx, come);

  // La porta remota: la certamente fisica fra le righe; per un apparato senza elenco il nome vale solo se è l'unico visto (I46).
  const nomiVisti = new Map<string, Set<string>>();
  /** «osservatore|apparato senza elenco»: l'osservatore dà un nome alla porta dell'apparato. */
  const nominata = new Set<string>();
  const vistoCome = (b: string, nome: string): void => {
    const s = nomiVisti.get(b) ?? new Set<string>();
    s.add(normale(nome));
    nomiVisti.set(b, s);
  };
  for (const g of gruppi.values()) {
    const b = g.b;
    if (!b || elenchi.has(b)) continue;
    for (const n of g.righe) {
      const l = traduciPorta(n.remote_port, "remoto", come(b, n.source, n.remote_platform));
      if (l.nome !== "" && l.fisica !== false) {
        vistoCome(b, l.nome);
        nominata.add(`${g.osservatore}|${b}`);
      }
    }
  }
  // §13.6.1 passo 5, con l'esempio dell'hub (H12): «il nome della scheda da una parte e un pezzo di MAC dall'altra» sono due nomi della stessa
  // porta, dati dai due capi dello stesso collegamento. Conta quindi anche il nome che l'apparato senza elenco dà alla sua porta
  // nella SUA riga verso un apparato che a sua volta nomina la porta di lui: con due nomi diversi la porta annunciata è da
  // completare (passo 6) e i cavi si fondono, col nome della riga dell'apparato. Solo lì: i nomi che l'apparato dà alle sue porte
  // verso chi non lo vede, o non ne nomina la porta, non sono nomi «visti verso di lui» (un router senza elenco ha tante porte
  // sue, e non per questo la porta che uno switch gli annuncia diventa non nota).
  for (const g of gruppi.values()) {
    if (!g.b || elenchi.has(g.osservatore) || !nominata.has(`${g.b}|${g.osservatore}`)) continue;
    if (g.locale.nome !== "" && g.locale.fisica !== false) vistoCome(g.osservatore, g.locale.nome);
  }
  const ordine = (f: boolean | null): number => (f === true ? 0 : f === null ? 1 : 2);
  for (const g of gruppi.values()) {
    const b = g.b;
    if (!b) continue;
    const lette = g.righe
      .map((n) => ({ n, l: traduciPorta(n.remote_port, "remoto", come(b, n.source, n.remote_platform)), t: tempo(n.timestamp) ?? 0 }))
      .filter((x) => x.l.nome !== "")
      .sort((x, y) => ordine(x.l.fisica) - ordine(y.l.fisica) || y.t - x.t || cmp(x.l.nome, y.l.nome));
    const s = lette[0];
    const scelto = s !== undefined && s.l.fisica === null && s.l.senzaFili !== true && haTraduttoreRemoto(come(b, s.n.source, s.n.remote_platform));
    if (!s || s.l.fisica === false || scelto) continue;
    // Un apparato senza elenco ma letto (MK2: i nomi delle sue interfacce): il nome è una sua porta, anche se lo si sente
    // su più porte (l'elenco del suo lettore, §13.5.7). Senza lettura vale la regola del nome unico (I46).
    const letta = !elenchi.has(b) && s.n.remote_port_index === null && fatti.porta(b, { chiave: null, nome: s.l.nome }).length > 0;
    const p = letta
      ? { nodo: b, chiave: `n:${normale(s.l.nome)}`, nome: s.l.nome, certa: true, fisica: s.l.fisica, senzaFili: s.l.senzaFili, nelBridge: s.l.nelBridge }
      : chiavePorta(b, s.l, "remoto", elenchi.get(b), s.n.remote_port_index, nomiVisti.get(b));
    g.remota = conFatti(p, fatti.porta(b, p));
  }

  for (const g of gruppi.values()) {
    const classe = g.righe.some((n) => classeDelProtocollo(n.protocol) === "annuncio_collegamento") ? "annuncio_collegamento" : "annuncio_segmento";
    const r0 = g.righe.find((n) => classeDelProtocollo(n.protocol) === classe) ?? g.righe[0];
    const visto = piuRecente(g.righe.map((n) => n.timestamp));
    const comeLocale = come(g.osservatore, r0.source, null);
    const tunnel = fatti.porta(g.osservatore, g.locale).some((f) => f.if_kind === "tunnel") || eTunnelDiFabbrica(g.locale.nome, comeLocale);
    const tipo: TipoProva = tunnel ? "tunnel" : g.locale.senzaFili === true ? "senza_fili"
      : g.locale.fisica === false || classe === "annuncio_segmento" ? "stessa_rete" : "cavo";
    const detto = dettoDelProtocollo(r0.protocol, r0.discovered_by);
    const annunciaSenzaFili = g.b !== null && g.righe.some((n) => traduciPorta(n.remote_port, "remoto", come(g.b, n.source, n.remote_platform)).senzaFili === true);
    // Le capacità di un annuncio col nome di sistema, se c'è (§13.8.2): lo stesso telaio sulla stessa porta può arrivare anche
    // dall'LLDP del firmware della scheda, senza nome e con capacità senza senso, e le righe senza nome vengono prima.
    const conNome = (n: ViciniCaviRow): boolean => nameKey(n.remote_device_name) !== null;
    const prima = (righe: readonly ViciniCaviRow[]): string | null => righe.map((n) => n.remote_caps).find((c): c is string => !!c) ?? null;
    const capacitaConNome = prima(g.righe.filter(conNome));
    prove.push({
      tipo, da: g.locale, altro: g.b ? (g.remota ?? portaVuota(g.b)) : null, telaio: g.telaio, classe, detto, lettore: lettoreDellaFonte(r0.source),
      visto, capacita: capacitaConNome ?? prima(g.righe), capacitaConNome, conNome: g.righe.some(conNome), traduttoreLocale: haTraduttore(comeLocale),
      annunciaSenzaFili,
      frase: `${nome(g.osservatore)} vede ${g.b ? nome(g.b) : (r0.remote_device_name || "un apparato non censito")} con ${detto} sulla porta ${g.locale.nome || "non nota"}${g.remota ? ` (porta remota ${g.remota.nome})` : ""}, letto il ${quando(visto)}.${g.righe.length > 1 ? ` Altre ${g.righe.length - 1} righe dello stesso apparato: contate una volta sola.` : ""}`,
    });
  }

  // Uplink del controller (§13.7.2 passo 4): una prova di verso; la porta locale per indice (`uplink_local_port_idx`, poi
  // `is_uplink`), quella del padre per indice. Per un gateway del controller è la WAN (§13.8.3 punto 1).
  const upCavi = new Map(ing.uplink.map((u) => [u.device_id, u]));
  const upPorta = new Map<number, { index: number; name: string }>();
  for (const p of [...ing.t1.uplinkPorts].sort((x, y) => x.device_id - y.device_id || x.port_index - y.port_index)) {
    if (!upPorta.has(p.device_id)) upPorta.set(p.device_id, { index: p.port_index, name: p.port_name });
  }
  for (const d of [...ing.t1.devices].sort((x, y) => x.id - y.id)) {
    if (!d.uplink_mac) continue;
    const a = `dev:${d.id}`;
    const b = resolveNode(idx, { mac: d.uplink_mac });
    if (!b || b === a || !idx.nodes.has(a)) continue;
    const i = upCavi.get(d.id)?.uplink_local_port_idx ?? upPorta.get(d.id)?.index ?? null;
    const nomeA = i !== null ? (elenchi.get(a)?.perIndice.get(i) ?? upPorta.get(d.id)?.name ?? `Port ${i}`) : "";
    const pa = i !== null ? chiavePorta(a, traduciPorta(nomeA, "locale", come(a, FONTE_CONTROLLER, null)), "locale", elenchi.get(a), i) : portaVuota(a);
    const da = i !== null ? conFatti(pa, fatti.porta(a, pa)) : pa;
    const j = d.uplink_remote_port;
    const nomeB = j !== null ? (elenchi.get(b)?.perIndice.get(j) ?? `Port ${j}`) : "";
    const altro = j !== null
      ? chiavePorta(b, traduciPorta(nomeB, "remoto", come(b, FONTE_CONTROLLER, null)), "remoto", elenchi.get(b), elenchi.get(b)?.perIndice.has(j) ? j : null)
      : portaVuota(b);
    prove.push({
      tipo: d.uplink_type === "wireless" ? "senza_fili" : "verso", da, altro, telaio: null, classe: "uplink", detto: "uplink del controller",
      lettore: "controller", visto: d.uplink_seen_at, gateway: d.controller_mac !== null && (d.device_type === "router" || d.device_type === "firewall"),
      origine: upCavi.get(d.id)?.uplink_source ?? null,
      frase: `Il controller dice che ${nome(a)} esce dalla porta ${da.nome || "non nota"} verso ${nome(b)}.`,
    });
  }

  // Il partner LACP di un membro di un fascio (§13.6.3): prova del fascio e dell'apparato dall'altra parte, abbinato coi MAC.
  for (const f of ing.fattiPorta) {
    if (!f.lag_partner || f.if_kind === "lag") continue;
    const a = `dev:${f.device_id}`;
    const b = idx.nodes.has(a) ? resolveNode(idx, { mac: f.lag_partner }) : null;
    if (!b || b === a) continue;
    const pa = chiavePorta(a, { nome: f.port_name, fisica: true, senzaFili: false, nelBridge: null, fascio: f.lag_group }, "locale", elenchi.get(a), f.port_index);
    prove.push({
      tipo: "cavo", da: conFatti(pa, [f]), altro: portaVuota(b), telaio: `mac:${f.lag_partner}`, classe: "fascio", detto: "partner LACP",
      lettore: lettoreDellaFonte(f.source), visto: f.seen_at, ...(f.lag_group ? { appartiene: { fascio: f.lag_group } } : {}),
      frase: `${nome(a)} ha la porta ${f.port_name} nel fascio ${f.lag_group ?? ""} con ${nome(b)}: lo dice il partner LACP.`,
    });
  }

  // Bordo (tabella MAC, ripiego del router, VM sulla porta): le regole di oggi (§13.7.2 passo 10), dalle linee del modello di
  // oggi, con le porte tradotte; il bordo per porta lo fa collegamenti.ts. Una linea di oggi che ha la tabella MAC e le VM sono
  // due prove: il MAC dell'hypervisor sulla porta è un'altra lettura, e quel collegamento non è «solo dalle VM» (§13.15 punto 4).
  const locale = portaLocale(ing.t1);
  const bordo = (n: string, porta: string, altro: string, classe: "vm" | "tabella_mac", visto: string | null, vm?: number): void => {
    prove.push({
      tipo: "bordo", da: (porta ? locale(n, porta) : null) ?? portaVuota(n), altro: portaVuota(altro), telaio: null, classe,
      detto: classe === "vm" ? "VM sulla porta" : "tabella MAC", lettore: "apparato", visto, ...(vm ? { vm } : {}),
      frase: `Dedotto: ${classe === "vm" ? "VM" : "MAC"} di ${nome(altro)} visto sulla porta ${porta || "non nota"} di ${nome(n)}.`,
    });
  };
  for (const l of t1.links) {
    if (l.sources.includes("manual")) {
      // La parte a mano sta sotto, una prova per correzione; le prove di bordo che vm-ports e la tabella MAC hanno messo sulla linea
      // della coppia restano (revisione del Task 4: senza, T1 diceva «✎ ✓» e la mappa nuova «a mano, non visto»). Dalla linea coi
      // passi del «Perché», che dicono apparato e porta; dagli altri cavi visti col lato che ha la porta (vm-ports lo scrive così).
      for (const x of l.perche ?? []) {
        if (x.tipo === "vm") bordo(x.da, x.porta, x.hypervisor, "vm", x.visto, x.vm);
        else if (x.tipo === "tabella_mac") bordo(x.da, x.porta, x.altro, "tabella_mac", x.visto);
      }
      for (const c of l.altriCavi ?? []) {
        const [n, porta, altro] = c.aPort ? [l.a, c.aPort, l.b] : [l.b, c.bPort, l.a];
        if (c.sources.includes("vm_mac")) bordo(n, porta, altro, "vm", c.lastSeen);
        if (c.sources.includes("mac_table")) bordo(n, porta, altro, "tabella_mac", c.lastSeen);
      }
      continue;
    }
    const vm = l.sources.includes("vm_mac"), mac = l.sources.includes("mac_table");
    if (!vm && !mac) continue;
    const pa = (l.aPort ? locale(l.a, l.aPort) : null) ?? portaVuota(l.a);
    const pb = (l.bPort ? locale(l.b, l.bPort) : null) ?? portaVuota(l.b);
    const base = { tipo: "bordo" as const, da: pa, altro: pb, telaio: null, lettore: "apparato" as const, visto: l.lastSeen };
    const dove = `visto sulla porta ${l.aPort || "non nota"} di ${nome(l.a)}.`;
    if (mac) prove.push({ ...base, classe: "tabella_mac", detto: "tabella MAC", frase: `Dedotto: MAC di ${nome(l.b)} ${dove}` });
    if (vm) prove.push({ ...base, classe: "vm", detto: "VM sulla porta", ...(l.vmCount ? { vm: l.vmCount } : {}), frase: `Dedotto: VM di ${nome(l.b)} ${dove}` });
  }

  // Correzioni «aggiungi» (§13.9, «Verifica» da T3): una prova per riga, con le porte come le scrive l'apparato (come il candidato
  // a mano di links.ts). Non dalla linea del modello di oggi, che è per coppia: una correzione senza porte vi prende le porte del
  // cavo scelto, e di due correzioni fra la stessa coppia ne resta una. Il cavo con le stesse porte che la conferma lo guarda
  // collegamenti.ts; qui il MAC dell'altro oggetto sulla porta dichiarata. Chi e quando nella frase; «confermato dai dati» o
  // «non visto dai dati» lo dice la conclusione.
  for (const o of [...ing.t1.overrides].sort((x, y) => x.id - y.id)) {
    if (o.action !== "add") continue;
    const a = nodeFor(idx, canonical(idx, o.a_node)), b = nodeFor(idx, canonical(idx, o.b_node));
    if (!a || !b || a === b) continue;
    const confermato = ctx.macSullaPorta
      ? ctx.macSullaPorta(a, o.a_port, b) || ctx.macSullaPorta(b, o.b_port, a)
      : t1.links.some((l) => l.sources.includes("manual") && ((l.a === a && l.b === b) || (l.a === b && l.b === a)) && l.manual?.confirmed === true);
    const il = o.created_at ? giorno(o.created_at) : null;
    prove.push({
      tipo: "a_mano", da: locale(a, o.a_port) ?? portaVuota(a), altro: locale(b, o.b_port) ?? portaVuota(b), telaio: null, classe: "a_mano",
      detto: "a mano", lettore: "persona", visto: null, confermato, medio: o.medium !== null && MEDIA.includes(o.medium) ? (o.medium as LinkMedium) : null,
      frase: `Collegato a mano${o.created_by ? ` da ${o.created_by}` : ""}${il ? ` il ${il}` : ""}.`,
    });
  }
  return prove;
}
