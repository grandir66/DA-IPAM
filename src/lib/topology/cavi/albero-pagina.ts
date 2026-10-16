/**
 * L'albero della pagina con la mappa nuova (spec topologia §13.7.7, §13.8.3 a schermo; T3, Task 7). Con `model.cavi` l'albero
 * della vista è lo stesso Prim del modello per cavo (`primCavi`, cavi/albero.ts) sulle linee della vista: schermo e traccia
 * scelgono con lo stesso codice e gli stessi dati (la porta radice, la ★ per collegamento, i capi dei ponti radio, il principale
 * dell'hypervisor). In una mappa passo passo un segmento o un ponte radio che non sta fra gli oggetti si contrae in linee fra gli
 * oggetti visibili che lega: senza, due membri legati solo attraverso di lui sarebbero due radici (I40). Una contrazione non è un
 * cavo: quelle che l'albero non usa non si disegnano e non contano nel «⇄ N» (piano di T3, «Scelte» 9).
 *
 * Finisce nel pacchetto del browser (lo importa tree.ts, che usa la pagina): logica pura, nessun import di db-tenant né di
 * moduli di Node, come albero.ts, collegamenti.ts e prove.ts.
 */
import { parseDbDate } from "@/lib/db-date";
import { nodeClass } from "@/lib/topology/identity";
import {
  LINK_ATTRS_DEFAULT,
  LINK_SOURCE_RANK,
  type ClasseMappa,
  type Fiducia,
  type LinkSource,
  type MapLink,
  type TopologyModel,
} from "@/lib/topology/model-types";
import type { TreeResult } from "@/lib/topology/tree";
import { primCavi, type LineaAlbero } from "./albero";

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
/** L'ordine di `FIDUCIA` di albero.ts: la contrazione vale quanto il suo tratto meno sicuro. */
const FIDUCIA_ORDINE: readonly Fiducia[] = ["certo", "probabile", "dedotto", "a_mano_confermato", "a_mano"];
const FRASE: Readonly<Record<"segmento" | "radio", string>> = {
  segmento: "via segmento non gestito: non è in questa mappa",
  radio: "via ponte radio: le radio non sono in questa mappa",
};

/** La porta di `nodo` sulla linea. */
const portaDi = (l: MapLink, nodo: string): string => (l.a === nodo ? l.aPort : l.bPort);
const minimo = (xs: ReadonlyArray<number | null>): number | null => {
  const v = xs.filter((x): x is number => x !== null);
  return v.length > 0 ? Math.min(...v) : null;
};
const massimo = (xs: ReadonlyArray<number | null>): number | null => {
  const v = xs.filter((x): x is number => x !== null);
  return v.length > 0 ? Math.max(...v) : null;
};

/**
 * La linea che contrae il tratto fra `x` e `y`: `lx` lega `x` alla parte contratta, `ly` lega `y`. Vale quanto il suo tratto
 * peggiore: la data più vecchia, la velocità più bassa, «non visto» o «giù» se uno dei due lo è, la fiducia peggiore. Le
 * porte sono quelle dei due oggetti visibili.
 */
function contratta(id: string, x: string, lx: MapLink, y: string, ly: MapLink, via: "segmento" | "radio"): MapLink {
  const sources = [...new Set([...lx.sources, ...ly.sources])].sort((p: LinkSource, q: LinkSource) => LINK_SOURCE_RANK[p] - LINK_SOURCE_RANK[q] || cmp(p, q));
  // Le date per istante, non per testo: un tratto può averla «AAAA-MM-GG HH:MM:SS» (UTC) e l'altro in ISO.
  const ms = (d: string): number => { const t = parseDbDate(d).getTime(); return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY; };
  const date = [lx.lastSeen, ly.lastSeen].filter((d): d is string => d !== null).sort((p, q) => ms(p) - ms(q));
  const fiducia = (l: MapLink): number => FIDUCIA_ORDINE.indexOf(l.cavo?.fiducia ?? "probabile");
  return {
    ...LINK_ATTRS_DEFAULT,
    id, a: x, aPort: portaDi(lx, x), b: y, bPort: portaDi(ly, y),
    source: sources[0], sources, uplinkFrom: null,
    lastSeen: date[0] ?? null, daysUnseen: massimo([lx.daysUnseen, ly.daysUnseen]), stale: lx.stale || ly.stale,
    speedMbps: minimo([lx.speedMbps, ly.speedMbps]),
    cavo: {
      genere: "contrazione", via,
      stato: lx.cavo?.stato === "giu" || ly.cavo?.stato === "giu" ? "giu" : "inoltra",
      fiducia: FIDUCIA_ORDINE[Math.max(fiducia(lx), fiducia(ly))],
      porteDaVerificare: false, detti: [], frasi: [FRASE[via]],
    },
  };
}

/**
 * §13.7.7: in una vista, un segmento o un ponte radio che non sta fra gli oggetti visibili si contrae in linee fra gli oggetti
 * visibili che lega, con la parola «segmento» o «≋ radio». Senza, Prim farebbe due radici (I40). Una linea per ogni coppia di
 * oggetti visibili sul bordo della parte contratta («Scelte» 9); la parte contratta è fatta degli oggetti di passaggio non
 * visibili legati fra loro (un segmento e le radio attaccate a lui sono una parte sola, «segmento»). Id
 * `contr:‹primo oggetto della parte›:‹x›~‹y›`, con x < y.
 */
export function contrazioni(model: TopologyModel, visible: ReadonlySet<string>): MapLink[] {
  const cavi = model.cavi;
  if (!cavi) return [];
  const passaggio = new Set([...cavi.segmenti.map((s) => s.id), ...cavi.ponti].filter((id) => !visible.has(id)));
  if (passaggio.size === 0) return [];
  const adj = new Map<string, MapLink[]>();
  for (const l of model.links) {
    for (const n of [l.a, l.b]) {
      const v = adj.get(n);
      if (v) v.push(l);
      else adj.set(n, [l]);
    }
  }
  const visti = new Set<string>();
  const out: MapLink[] = [];
  for (const inizio of [...passaggio].sort()) {
    if (visti.has(inizio)) continue;
    // La parte contratta (gli oggetti di passaggio non visibili legati fra loro) e gli oggetti visibili sul suo bordo, ciascuno
    // con la prima linea (in ordine di id del modello) che lo lega alla parte.
    const parte = new Set([inizio]);
    const coda = [inizio];
    const bordo = new Map<string, MapLink>();
    let via: "segmento" | "radio" = inizio.startsWith("seg:") ? "segmento" : "radio";
    while (coda.length > 0) {
      const x = coda.shift()!;
      for (const l of adj.get(x) ?? []) {
        const y = l.a === x ? l.b : l.a;
        if (passaggio.has(y)) {
          if (!parte.has(y)) { parte.add(y); coda.push(y); }
          if (y.startsWith("seg:")) via = "segmento";
        } else if (visible.has(y) && !bordo.has(y)) {
          bordo.set(y, l);
        }
      }
    }
    for (const x of parte) visti.add(x);
    const capi = [...bordo.keys()].sort();
    const radice = [...parte].sort()[0];
    for (let i = 0; i < capi.length; i++) {
      for (let j = i + 1; j < capi.length; j++) {
        out.push(contratta(`contr:${radice}:${capi[i]}~${capi[j]}`, capi[i], bordo.get(capi[i])!, capi[j], bordo.get(capi[j])!, via));
      }
    }
  }
  return out;
}

/**
 * La linea del Prim di una linea della vista: la stessa che `lineaDi` dà per il collegamento (stessi campi, stessi valori), così
 * schermo e traccia scelgono uguale. «Solo a mano» = tutte le fonti a mano, come le prove del collegamento (la pagina segna
 * `manual` anche quando la linea a mano è unita a un cavo visto, che ha prove dei dati: per l'hypervisor conta, §12.5).
 */
export function lineaDellaVista(l: MapLink): LineaAlbero {
  return {
    id: l.id, a: l.a, b: l.b, nonVisto: l.stale, stato: l.cavo?.stato ?? null, fiducia: l.cavo?.fiducia ?? "probabile",
    verso: l.uplinkFrom, velocitaMbps: l.speedMbps,
    ...(l.vmCount !== undefined ? { vm: l.vmCount } : {}),
    aMano: l.sources.length > 0 && l.sources.every((s) => s === "manual"),
  };
}

/**
 * L'albero della pagina con la mappa nuova: lo stesso Prim del modello per cavo (`primCavi`) sulle linee della vista, più le
 * contrazioni. Il risultato ha la forma di `buildTree`: i figli nell'ordine in cui l'albero li prende; fra le linee quelle coi due
 * capi visibili, annotate per questa vista (`primary` «auto» o «user» sulle usate, `redundant` sulle altre), tranne le
 * contrazioni che l'albero non usa; `via` sulle copie annotate. Il modello non cambia.
 */
export function alberoDellaPagina(model: TopologyModel, visible: ReadonlySet<string>, roots: readonly string[]): TreeResult {
  const nodes = new Map(model.nodes.map((n) => [n.id, n]));
  // La classe come la vede il modello per cavo: un segmento è «segmento» (nella pagina la sua classe è «infra», che per il
  // Prim vale lo stesso tranne nell'ordine delle radici che restano: lì il modello lo mette dopo gli apparati di rete).
  const classe = (id: string): ClasseMappa | "segmento" | undefined => {
    const n = nodes.get(id);
    if (!n) return undefined;
    return n.kind === "segmento" ? "segmento" : (model.classiMappa?.[id] ?? nodeClass(n));
  };
  const contratte = contrazioni(model, visible);
  const tutte = [...model.links, ...contratte];
  // ★ (§13.9): la linea scelta dall'admin per il suo nodo, già risolta per collegamento dal modello (`primary: "user"`).
  const stelle = new Map<string, string>();
  for (const l of model.links) if (l.primary === "user" && l.primaryFor) stelle.set(l.primaryFor, l.id);
  const ipervisori = new Set(model.nodes.filter((n) => classe(n.id) === "hyper").map((n) => n.id));
  for (const v of model.vms) if (v.hypervisorNodeId) ipervisori.add(v.hypervisorNodeId);
  // `scelto` può nominare un collegamento finito nei dettagli dell'hypervisor (`soloDettagli`): non è fra le linee, non conta.
  const e = primCavi({
    classe, ponti: new Set(model.cavi?.ponti ?? []), visibili: visible, linee: tutte.map(lineaDellaVista), partenze: roots,
    scelto: new Map(Object.entries(model.cavi?.scelto ?? {})), stelle, ipervisori,
  });

  const children = new Map<string, string[]>();
  // `profondita` ha i nodi nell'ordine in cui l'albero li ha presi: i figli escono in quell'ordine, come in buildTree.
  for (const n of e.profondita.keys()) {
    children.set(n, []);
    const p = e.padri[n];
    if (p !== null && p !== undefined) children.get(p)!.push(n);
  }
  const usate = new Set([...e.via.values()].map((l) => l.id));
  const links = tutte
    .filter((l) => visible.has(l.a) && visible.has(l.b) && nodes.has(l.a) && nodes.has(l.b))
    .filter((l) => l.cavo?.genere !== "contrazione" || usate.has(l.id))
    .map((l): MapLink => ({ ...l, primary: usate.has(l.id) ? (l.primary === "user" ? "user" : "auto") : l.primary, redundant: !usate.has(l.id) }));
  const perId = new Map(links.map((l) => [l.id, l]));
  const via = new Map<string, MapLink>();
  for (const [n, l] of e.via) via.set(n, perId.get(l.id)!);
  return { roots: e.radici, children, via, links };
}
