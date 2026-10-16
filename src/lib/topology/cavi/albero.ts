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
import { altroCapo, capo, type Collegamento, type Fiducia, type StatoCollegamento } from "./collegamenti";
import { normale, stessaPorta, type Porta } from "./porte";

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
   * porta). Senza la chiave, «1/1/49» non trovava il cavo che l'altro capo chiama «49» (G16, lettura C).
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

/**
 * Una linea per il Prim: quello che la chiave del punto 3 guarda. Un Collegamento (in ombra) e un MapLink con `cavo` (a schermo,
 * Task 7) diventano la stessa cosa: così schermo e traccia scelgono con lo stesso codice.
 */
export interface LineaAlbero {
  id: string; a: string; b: string;
  nonVisto: boolean; stato: StatoCollegamento; fiducia: Fiducia;
  verso: string | null; velocitaMbps: number | null; vm?: number;
  /** Solo a mano: nessuna prova dei dati (le correzioni non scelgono il principale dell'hypervisor, §12.5). */
  aMano: boolean;
}

export interface IngressoPrim {
  /** La classe di ogni nodo; undefined = non è un nodo della vista (foglia). */
  classe: (id: string) => ClasseMappa | "segmento" | undefined;
  /** I capi dei ponti radio: fanno da ponte anche se la classe dice foglia (§13.7.6 punto 4). */
  ponti: ReadonlySet<string>;
  visibili: ReadonlySet<string>;
  linee: readonly LineaAlbero[];
  /** Le partenze in ordine: la testa della mappa automatica, o le partenze salvate di una mappa passo passo. */
  partenze: readonly string[];
  /** nodo → id della linea della sua porta radice o del suo uplink (punto 1). Un id che non è fra le linee non conta. */
  scelto: ReadonlyMap<string, string>;
  /** ★: nodo → id della linea scelta a mano, già risolta per collegamento (`risolviStelle`). */
  stelle: ReadonlyMap<string, string>;
  ipervisori: ReadonlySet<string>;
}

export interface EsitoPrim { radici: string[]; padri: Record<string, string | null>; via: Map<string, LineaAlbero>; profondita: Map<string, number> }

/** Una ★ salvata, risolta: la linea per cui vale; `diPrima` = senza porte, o con porte che non indicano più un collegamento. */
export interface Stella { nodo: string; altro: string; linea: string; diPrima: boolean }

export const RADICE = "radice";
/** L'ordine della fiducia nella chiave del punto 3 (vince il più piccolo); la pagina lo usa anche per le contrazioni. */
export const FIDUCIA: Readonly<Record<Fiducia, number>> = { certo: 0, probabile: 1, dedotto: 2, a_mano_confermato: 3, a_mano: 4 };
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const fermo = (c: { stato: StatoCollegamento }): boolean => c.stato === "bloccato" || c.stato === "bloccato_comune";
/**
 * Il membro di riserva di un bond (§13.5.5): non porta traffico finché l'altra scheda è su, come una porta bloccata, ma non lo
 * ferma lo spanning tree. Nell'albero vale come un bloccato (§13.8.3 punto 4: padre solo se non c'è altro); resta fuori da
 * `fermo`, che dice «bloccato dallo spanning tree» (la testa e l'uplink del controller).
 */
const diRiserva = (c: { stato: StatoCollegamento }): boolean => c.stato === "riserva_bond";
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

/** Punto 3: la chiave con cui Prim sceglie, confrontata elemento per elemento (vince la più piccola). */
export function chiaveCavo(c: LineaAlbero, da: string, to: string, ctx: { scelto: ReadonlyMap<string, string>; stella: (c: LineaAlbero, to: string) => boolean; profondita: ReadonlyMap<string, number> }): number[] {
  const versoSegmento = to.startsWith("seg:") || da.startsWith("seg:");
  return [
    ctx.stella(c, to) ? 0 : 1,
    ctx.scelto.get(to) === c.id ? 0 : 1,
    c.nonVisto ? 1 : 0,
    c.stato === "giu" ? 1 : 0,
    // Il posto della riserva del bond è quello del bloccato, e non un elemento suo: la spec non dà un ordine fra i due, e tutti e
    // due cedono a ogni collegamento che inoltra (G16, lettura D).
    fermo(c) || diRiserva(c) ? 1 : 0,
    c.stato === "instradato" && !versoSegmento ? 1 : 0,
    FIDUCIA[c.fiducia],
    versoSegmento ? 1 : 0,
    versoSegmento ? (ctx.profondita.get(da) ?? 0) : 0,
    c.verso !== null && c.verso === da ? 1 : 0,
    -(c.velocitaMbps ?? 0),
  ];
}

function confronta(x: readonly number[], y: readonly number[]): number {
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
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

/**
 * Il Prim del §13.8.3 (punti 3-6) sulle linee: le due passate (prima le scelte forzate, poi tutte), la chiave del punto 3, il
 * principale dell'hypervisor (punto 6), i capi dei ponti radio che fanno da ponte. Lo usano l'albero del modello per cavo
 * (`alberoCavi`) e la pagina (Task 7), con le stesse linee: stesso esito.
 */
export function primCavi(ing: IngressoPrim): EsitoPrim {
  // Le linee in ordine di id: due linee parallele con la stessa chiave si spareggiano su «da|a», uguale per tutte e due, e vinceva
  // la prima dell'elenco. Il modello le dà già in quest'ordine; la pagina no (revisione del Task 5, I39).
  const linee = [...ing.linee].sort((x, y) => cmp(x.id, y.id));
  const adj = new Map<string, LineaAlbero[]>();
  for (const c of linee) {
    if (!ing.visibili.has(c.a) || !ing.visibili.has(c.b)) continue;
    adj.set(c.a, [...(adj.get(c.a) ?? []), c]);
    adj.set(c.b, [...(adj.get(c.b) ?? []), c]);
  }
  // Foglie (come oggi): attaccati, client, hypervisor e «da sistemare» non fanno da ponte; il segmento sì; il capo di un ponte
  // radio sì, anche se è un server o un host (§13.7.6 punto 4: eccezione a tree.ts, dove sono foglie).
  const foglia = (id: string): boolean => {
    const k = ing.classe(id);
    if (k === undefined) return true;
    if (ing.ponti.has(id)) return false;
    return k === "att" || k === "client" || k === "hyper" || k === "da_sistemare";
  };
  const altro = (c: LineaAlbero, n: string): string => (c.a === n ? c.b : c.a);
  // ★ (I20): vince sempre, se raggiungibile. Forza solo una linea fra quelle visibili del nodo (come prima di T3): una ★ su una
  // linea che non c'è (fuori vista, o finita nei dettagli) non toglie all'hypervisor la sua regola. Caso limite (revisione del
  // Task 5): la ★ di un hypervisor su una linea «dalle VM» che non diventa `via` (l'altro capo si raggiunge solo da lui) finisce
  // nei dettagli: nel modello la linea c'è e la ★ spegne la regola dell'hypervisor, sulla pagina la linea non c'è e la regola
  // vale. Il padre può essere diverso fra traccia e schermo; con `DALLE_VM_SOLO_DETTAGLI` spenta (oggi) non succede.
  const forzati = new Map<string, string>();
  for (const [nodo, id] of ing.stelle) if ((adj.get(nodo) ?? []).some((c) => c.id === id)) forzati.set(nodo, id);
  // Punto 6: il principale dell'hypervisor (§12.5): prima il non vecchio, poi il non giù, poi il non di riserva del bond (§13.3.2
  // riga 17: gli altri membri del bond sono ridondanze «⇄»; prima, a pari velocità, l'id sceglieva la riserva: G16, lettura D),
  // poi il più veloce, poi più VM.
  for (const id of [...ing.ipervisori].sort()) {
    if (forzati.has(id)) continue;
    const cs = (adj.get(id) ?? []).filter((c) => !c.aMano && !foglia(altro(c, id)));
    if (cs.length < 2) continue;
    forzati.set(id, [...cs].sort((x, y) => Number(x.nonVisto) - Number(y.nonVisto) || Number(x.stato === "giu") - Number(y.stato === "giu")
      || Number(diRiserva(x)) - Number(diRiserva(y)) || (y.velocitaMbps ?? 0) - (x.velocitaMbps ?? 0) || (y.vm ?? 0) - (x.vm ?? 0) || cmp(x.id, y.id))[0].id);
  }
  const stella = (c: LineaAlbero, to: string): boolean => ing.stelle.get(to) === c.id;
  const profondita = new Map<string, number>();
  const padri: Record<string, string | null> = {};
  const via = new Map<string, LineaAlbero>();
  const radici: string[] = [];
  const preso = new Set<string>();
  const cresci = (r: string): void => {
    preso.add(r);
    profondita.set(r, 0);
    padri[r] = null;
    radici.push(r);
    const scegli = (stretto: boolean) => {
      let best: { k: number[]; da: string; to: string; c: LineaAlbero } | null = null;
      for (const x of [...preso].sort()) {
        if (foglia(x)) continue;
        for (const c of adj.get(x) ?? []) {
          const to = altro(c, x);
          if (preso.has(to)) continue;
          const f = forzati.get(to);
          if (stretto && f !== undefined && f !== c.id) continue;
          const k = chiaveCavo(c, x, to, { scelto: ing.scelto, stella, profondita });
          const d = best ? confronta(k, best.k) : -1;
          if (!best || d < 0 || (d === 0 && `${x}|${to}` < `${best.da}|${best.to}`)) best = { k, da: x, to, c };
        }
      }
      return best;
    };
    for (;;) {
      const b = scegli(true) ?? scegli(false);
      if (!b) return;
      preso.add(b.to);
      profondita.set(b.to, (profondita.get(b.da) ?? 0) + 1);
      padri[b.to] = b.da;
      via.set(b.to, b.c);
    }
  };
  for (const r of ing.partenze) if (ing.visibili.has(r) && ing.classe(r) !== undefined && !preso.has(r)) cresci(r);
  const resto = [...ing.visibili].filter((x) => !preso.has(x) && ing.classe(x) !== undefined).sort((a, b) =>
    Number(ing.classe(a) !== "infra") - Number(ing.classe(b) !== "infra") || (adj.get(b)?.length ?? 0) - (adj.get(a)?.length ?? 0) || cmp(a, b));
  for (const r of resto) if (!preso.has(r)) cresci(r);
  return { radici, padri, via, profondita };
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
