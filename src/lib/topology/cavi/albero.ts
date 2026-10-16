/**
 * L'albero del modello per cavo (spec topologia §13.8.3; T2 in ombra, T3 a schermo): lo decide lo spanning tree. Il
 * collegamento scelto di ogni bridge è quello sulla sua porta radice dell'albero comune; per un apparato del controller la
 * porta di uplink, se non è ferma; il gateway del controller non sceglie (la sua uscita è la WAN). Prim con le due passate
 * di oggi e la chiave del punto 3; la testa dalle prove; l'anomalia «core che esce da uno switch di accesso». Il bridge
 * designato non sceglie e non crea: conferma (collegamenti.ts). Da T3: la ★ vale per il collegamento con le sue porte (§13.9),
 * i ruoli «Core» e «Accesso» a mano decidono l'anomalia, i capi dei ponti radio fanno da ponte (§13.7.6 punto 4), e il Prim
 * (`primCavi`) lavora su linee che la pagina costruisce uguali (Task 7). Logica pura, deterministica.
 */
import type { ClasseMappa, ModelPrimaryRow } from "@/lib/topology/model-types";
import { altroCapo, capo, type Collegamento } from "./collegamenti";
import { normale, stessaPorta, type Porta } from "./porte";
import { FIDUCIA, fermo, primCavi, type LineaAlbero } from "./prim";

// Il Prim e la sua chiave stanno in prim.ts (revisione finale di T3, M8): qui si riesportano per chi li legge da albero.ts.
export { FIDUCIA, chiaveCavo, primCavi } from "./prim";
export type { EsitoPrim, IngressoPrim, LineaAlbero } from "./prim";

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export interface NodoCavi { id: string; classe: ClasseMappa | "segmento"; tipo: string; numero: number; hidden: boolean }
/** «core che esce da uno switch di accesso» (§13.8.3 punto 8); `porta` è la porta del padre sul collegamento scelto (testo di D2). */
export interface Anomalia { nodo: string; padre: string; porta: string; altri: string[] }
type Primario = Pick<ModelPrimaryRow, "node_id" | "other_node" | "node_port" | "other_port">;

export interface IngressoAlbero {
  nodi: ReadonlyMap<string, NodoCavi>;
  visibili: ReadonlySet<string>;
  collegamenti: readonly Collegamento[];
  /** La testa confermata (della mappa automatica o della sede); null = la propone il sistema. */
  testaConfermata: string | null;
  /**
   * La porta radice dell'albero comune letta dal bridge del nodo («radice» = il nodo è la radice): il nome come lo scrive il
   * bridge e la chiave che quel nome dà con l'elenco delle porte (§13.6.1, come ogni altra porta; null = il nome non dice una
   * porta). Senza la chiave, il nome d'interfaccia scritto dal bridge non trovava il cavo che l'altro capo chiama col solo numero (G16, lettura C).
   */
  portaRadice: ReadonlyMap<string, Pick<Porta, "chiave" | "nome"> | typeof RADICE>;
  /** La porta di uplink del controller per i suoi apparati. */
  portaUplink: ReadonlyMap<string, Pick<Porta, "chiave" | "nome">>;
  /** Gli apparati del controller che fanno da router: la loro uscita è la WAN, non scelgono il padre. */
  gateway: ReadonlySet<string>;
  gatewayDi: Readonly<Record<string, number>>;
  /** Le ★ salvate, con le loro porte (id canonici). */
  primari: ReadonlyArray<Primario>;
  /** La porta scritta in una ★ (`portaSalvata` di links.ts, come per le correzioni: anche la forma di prima di T1). */
  portaSalvata: (nodo: string, nome: string) => Porta | null;
  ipervisori: ReadonlySet<string>;
  /** I ruoli «Core» e «Accesso» scelti a mano (§13.9): valgono solo per l'anomalia del punto 8. */
  ruoli: ReadonlyMap<string, "core" | "accesso">;
  /** I capi dei ponti radio (§13.7.6 punto 4): fanno da ponte anche se la classe dice foglia. */
  ponti: ReadonlySet<string>;
}

export interface AlberoCavi {
  radici: string[];
  /** Il padre di ogni oggetto dell'albero (le radici: null). */
  padri: Record<string, string | null>;
  via: Map<string, Collegamento>;
  profondita: Map<string, number>;
  /** nodo → id del collegamento scelto dallo spanning tree (punto 1). */
  scelto: ReadonlyMap<string, string>;
  anomalie: Anomalia[];
  /** In parole, senza dati: «uplink del controller su una porta ferma», «la porta radice non ha un collegamento». */
  avvisi: Array<{ nodo: string; testo: string }>;
  testa: string | null;
  /** Le ★ salvate, risolte per collegamento (§13.9); `diPrima` = vale per il migliore della coppia, e i dettagli lo dicono. */
  stelle: Stella[];
}

/** Una ★ salvata, risolta: la linea per cui vale; `diPrima` = senza porte, o con porte che non indicano più un collegamento. */
export interface Stella { nodo: string; altro: string; linea: string; diPrima: boolean }

export const RADICE = "radice";
const migliore = (cs: readonly Collegamento[]): Collegamento | undefined =>
  [...cs].sort((x, y) => Number(x.nonVisto) - Number(y.nonVisto) || FIDUCIA[x.fiducia] - FIDUCIA[y.fiducia] || cmp(x.id, y.id))[0];

/** Il collegamento sta su quella porta del nodo: per chiave, per nome, per chiave «n:», o perché è il fascio con quel nome. */
function suPorta(c: Collegamento, nodo: string, porta: Pick<Porta, "chiave" | "nome">): boolean {
  const p = capo(c, nodo);
  const n = normale(porta.nome);
  const fascio = c.fascio ? (c.a.nodo === nodo ? c.fascio.a : c.fascio.b) : null;
  return (porta.chiave !== null && p.chiave === porta.chiave) || normale(p.nome) === n || p.chiave === `n:${n}` || (fascio !== null && normale(fascio) === n);
}

/** Punto 1: il collegamento scelto di ogni nodo. */
export function scelte(ing: IngressoAlbero): { scelto: Map<string, string>; avvisi: Array<{ nodo: string; testo: string }>; radiciStp: Set<string> } {
  const scelto = new Map<string, string>();
  const avvisi: Array<{ nodo: string; testo: string }> = [];
  const radiciStp = new Set<string>();
  const di = (nodo: string) => ing.collegamenti.filter((c) => c.a.nodo === nodo || c.b.nodo === nodo);
  for (const [nodo, rp] of [...ing.portaRadice].sort(([a], [b]) => cmp(a, b))) {
    if (rp === RADICE) { radiciStp.add(nodo); continue; }
    const c = migliore(di(nodo).filter((x) => suPorta(x, nodo, rp)));
    if (!c) { avvisi.push({ nodo, testo: "la porta radice non ha un collegamento visto: decide il ripiego" }); continue; }
    if (c.nonVisto) { avvisi.push({ nodo, testo: "il collegamento della porta radice non è visto da giorni: decide il ripiego" }); continue; }
    scelto.set(nodo, c.id);
  }
  for (const [nodo, p] of [...ing.portaUplink].sort(([a], [b]) => cmp(a, b))) {
    if (scelto.has(nodo) || ing.portaRadice.has(nodo) || ing.gateway.has(nodo)) continue;
    const c = migliore(di(nodo).filter((x) => (p.chiave !== null && capo(x, nodo).chiave === p.chiave) || (p.nome !== "" && normale(capo(x, nodo).nome) === normale(p.nome))));
    if (!c || c.nonVisto) continue;
    if (fermo(c)) { avvisi.push({ nodo, testo: "uplink del controller su una porta ferma" }); continue; }
    scelto.set(nodo, c.id);
  }
  return { scelto, avvisi, radiciStp };
}

/** Punto 7: la testa confermata; altrimenti il router o firewall di rete che raggiunge più nodi coi collegamenti visti e non bloccati; a pari, il gateway di più reti, poi la radice dello spanning tree, l'id solo per ultimo. */
export function testaCavi(ing: IngressoAlbero, radiciStp: ReadonlySet<string>): string | null {
  if (ing.testaConfermata && ing.visibili.has(ing.testaConfermata)) return ing.testaConfermata;
  const vivi = new Map<string, string[]>();
  for (const c of ing.collegamenti) {
    if (c.nonVisto || fermo(c)) continue;
    vivi.set(c.a.nodo, [...(vivi.get(c.a.nodo) ?? []), c.b.nodo]);
    vivi.set(c.b.nodo, [...(vivi.get(c.b.nodo) ?? []), c.a.nodo]);
  }
  const reti = (id: string | null): number => (id ? (ing.gatewayDi[id] ?? 0) : 0);
  const radice = (id: string | null): number => (id && radiciStp.has(id) ? 1 : 0);
  let best: string | null = null;
  let size = -1;
  const candidati = [...ing.nodi.values()].filter((n) => (n.tipo === "router" || n.tipo === "firewall") && n.classe === "infra" && ing.visibili.has(n.id))
    .sort((a, b) => a.numero - b.numero);
  for (const n of candidati) {
    const visti = new Set([n.id]);
    const coda = [n.id];
    while (coda.length) for (const y of vivi.get(coda.shift()!) ?? []) if (!visti.has(y)) { visti.add(y); coda.push(y); }
    const s = visti.size;
    if (s > size || (s === size && (reti(n.id) > reti(best) || (reti(n.id) === reti(best) && radice(n.id) > radice(best))))) {
      size = s;
      best = n.id;
    }
  }
  return best;
}

/** La linea del Prim di un collegamento del modello per cavo. */
export function lineaDi(c: Collegamento): LineaAlbero {
  return {
    id: c.id, a: c.a.nodo, b: c.b.nodo, nonVisto: c.nonVisto, stato: c.stato, fiducia: c.fiducia, verso: c.verso, velocitaMbps: c.velocitaMbps,
    ...(c.vm !== undefined ? { vm: c.vm } : {}),
    // «Solo a mano» come in T1 (`tree.ts`, fonti tutte «manual»): una linea a mano unita a un cavo visto, o confermata da una prova
    // di bordo, ha prove dei dati e concorre al principale dell'hypervisor (§12.5: «fra i collegamenti dai dati»).
    aMano: c.prove.length > 0 && c.prove.every((p) => p.tipo === "a_mano"),
  };
}

/**
 * Le ★ salvate, per collegamento (§13.9, I20). Da T3 la ★ vale per il collegamento con quelle porte (una porta vuota vale per
 * qualunque porta su quel lato); una ★ di prima (senza porte, o con porte che non indicano più un collegamento fra i due) vale
 * per il migliore della coppia, e i dettagli lo dicono (`diPrima`). Con tutte e due le porte vuote, come «Ignora» a porte vuote,
 * vale per il collegamento senza porte della coppia, se c'è (l'uplink senza fili di un AP in mesh: la pagina scrive così la sua
 * ★, e prima tornava sempre «di prima», con «Scegli il cavo» che riscriveva la stessa ★; revisione del Task 5); se non c'è, è
 * una ★ di prima. Una ★ fra due oggetti che oggi non hanno collegamenti qui non c'è: la dice il pannello («★ senza
 * collegamento»). Le porte si confrontano per chiave, calcolata alla lettura (`portaSalvata`), come le correzioni: una porta senza
 * chiave non indica un collegamento.
 */
export function risolviStelle(cs: readonly Collegamento[], primari: ReadonlyArray<Primario>, portaSalvata: (nodo: string, nome: string) => Porta | null): Stella[] {
  const out: Stella[] = [];
  for (const s of primari) {
    const fra = cs.filter((c) => (c.a.nodo === s.node_id && c.b.nodo === s.other_node) || (c.b.nodo === s.node_id && c.a.nodo === s.other_node));
    if (fra.length === 0) continue;
    const pn = s.node_port.trim() ? portaSalvata(s.node_id, s.node_port) : null;
    const po = s.other_port.trim() ? portaSalvata(s.other_node, s.other_port) : null;
    const combacia = (c: Collegamento): boolean => (pn === null || stessaPorta(pn, capo(c, s.node_id)))
      && (po === null || stessaPorta(po, altroCapo(c, s.node_id)));
    const senzaPorte = (c: Collegamento): boolean => capo(c, s.node_id).nome.trim() === "" && altroCapo(c, s.node_id).nome.trim() === "";
    // `portaSalvata` dà null solo per una porta vuota: pn e po null = tutte e due le porte vuote.
    const esatto = migliore(fra.filter(pn === null && po === null ? senzaPorte : combacia));
    out.push({ nodo: s.node_id, altro: s.other_node, linea: (esatto ?? migliore(fra)!).id, diPrima: esatto === undefined });
  }
  return out;
}

export function alberoCavi(ing: IngressoAlbero): AlberoCavi {
  const { scelto, avvisi, radiciStp } = scelte(ing);
  const testa = testaCavi(ing, radiciStp);
  const stelle = risolviStelle(ing.collegamenti, ing.primari, ing.portaSalvata);
  const e = primCavi({
    classe: (id) => ing.nodi.get(id)?.classe, ponti: ing.ponti, visibili: ing.visibili, linee: ing.collegamenti.map(lineaDi),
    partenze: testa ? [testa] : [], scelto, stelle: new Map(stelle.map((s) => [s.nodo, s.linea])), ipervisori: ing.ipervisori,
  });
  const perId = new Map(ing.collegamenti.map((c) => [c.id, c]));
  const via = new Map([...e.via].map(([n, l]) => [n, perId.get(l.id)!]));
  const vicini = new Map<string, Set<string>>();
  for (const c of ing.collegamenti) {
    if (!ing.visibili.has(c.a.nodo) || !ing.visibili.has(c.b.nodo)) continue;
    vicini.set(c.a.nodo, (vicini.get(c.a.nodo) ?? new Set<string>()).add(c.b.nodo));
    vicini.set(c.b.nodo, (vicini.get(c.b.nodo) ?? new Set<string>()).add(c.a.nodo));
  }

  // Punto 8: uno switch X con padre P ha l'anomalia se ha cavi, anche bloccati, verso almeno altri due switch che stanno allo
  // stesso livello di P. Due soli uplink verso due switch dello stesso livello non la fanno scattare. Con i ruoli a mano (§13.9:
  // «Core · Accesso», solo per correggere l'anomalia; Scelta 8 del piano di T3) un «accesso» non ha mai l'anomalia, e un «core»
  // con il padre «accesso» ce l'ha anche se la struttura non basta; senza ruoli vale la regola dei due switch.
  const anomalie: Anomalia[] = [];
  for (const [x, p] of Object.entries(e.padri).sort(([a], [b]) => cmp(a, b))) {
    if (p === null || p.startsWith("seg:")) continue;
    const n = ing.nodi.get(x);
    const livello = e.profondita.get(p);
    const c = via.get(x);
    if (!n || n.tipo !== "switch" || n.classe !== "infra" || livello === undefined || !c) continue;
    if (ing.ruoli.get(x) === "accesso") continue;
    const altri = [...(vicini.get(x) ?? [])].filter((y) => y !== p && ing.nodi.get(y)?.tipo === "switch" && e.profondita.get(y) === livello).sort();
    if (altri.length >= 2 || (ing.ruoli.get(x) === "core" && ing.ruoli.get(p) === "accesso")) anomalie.push({ nodo: x, padre: p, porta: capo(c, p).nome, altri });
  }
  return { radici: e.radici, padri: e.padri, via, profondita: e.profondita, scelto, anomalie, avvisi, testa, stelle };
}
