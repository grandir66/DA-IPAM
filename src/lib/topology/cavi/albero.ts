/**
 * L'albero del modello per cavo (spec topologia §13.8.3; T2 in ombra, T3 a schermo): lo decide lo spanning tree. Il
 * collegamento scelto di ogni bridge è quello sulla sua porta radice dell'albero comune; per un apparato del controller la
 * porta di uplink, se non è ferma; il gateway del controller non sceglie (la sua uscita è la WAN). Prim con le due passate
 * di oggi e la chiave del punto 3; la testa dalle prove; l'anomalia «core che esce da uno switch di accesso». Il bridge
 * designato non sceglie e non crea: conferma (collegamenti.ts). Logica pura, deterministica.
 */
import type { ClasseMappa } from "@/lib/topology/model-types";
import { altroCapo, capo, type Collegamento, type Fiducia } from "./collegamenti";
import { normale, type Porta } from "./porte";

export interface NodoCavi { id: string; classe: ClasseMappa | "segmento"; tipo: string; numero: number; hidden: boolean }
export interface Anomalia { nodo: string; padre: string; altri: string[] }

export interface IngressoAlbero {
  nodi: ReadonlyMap<string, NodoCavi>;
  visibili: ReadonlySet<string>;
  collegamenti: readonly Collegamento[];
  /** La testa confermata (della mappa automatica o della sede); null = la propone il sistema. */
  testaConfermata: string | null;
  /** La porta radice dell'albero comune letta dal bridge del nodo («radice» = il nodo è la radice). */
  portaRadice: ReadonlyMap<string, string>;
  /** La porta di uplink del controller per i suoi apparati. */
  portaUplink: ReadonlyMap<string, Pick<Porta, "chiave" | "nome">>;
  /** Gli apparati del controller che fanno da router: la loro uscita è la WAN, non scelgono il padre. */
  gateway: ReadonlySet<string>;
  gatewayDi: Readonly<Record<string, number>>;
  primari: ReadonlyArray<{ node_id: string; other_node: string }>;
  ipervisori: ReadonlySet<string>;
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
}

const RADICE = "radice";
const FIDUCIA: Readonly<Record<Fiducia, number>> = { certo: 0, probabile: 1, dedotto: 2, a_mano_confermato: 3, a_mano: 4 };
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const fermo = (c: Collegamento): boolean => c.stato === "bloccato" || c.stato === "bloccato_comune";
const migliore = (cs: readonly Collegamento[]): Collegamento | undefined =>
  [...cs].sort((x, y) => Number(x.nonVisto) - Number(y.nonVisto) || FIDUCIA[x.fiducia] - FIDUCIA[y.fiducia] || cmp(x.id, y.id))[0];

/** Il collegamento sta su quella porta del nodo: per nome, per chiave «n:», o perché è il fascio con quel nome. */
function suPorta(c: Collegamento, nodo: string, nome: string): boolean {
  const p = capo(c, nodo);
  const n = normale(nome);
  const fascio = c.fascio ? (c.a.nodo === nodo ? c.fascio.a : c.fascio.b) : null;
  return normale(p.nome) === n || p.chiave === `n:${n}` || (fascio !== null && normale(fascio) === n);
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
export function chiaveCavo(c: Collegamento, da: string, to: string, ctx: { scelto: ReadonlyMap<string, string>; stella: (c: Collegamento, to: string) => boolean; profondita: ReadonlyMap<string, number> }): number[] {
  const versoSegmento = to.startsWith("seg:") || da.startsWith("seg:");
  return [
    ctx.stella(c, to) ? 0 : 1,
    ctx.scelto.get(to) === c.id ? 0 : 1,
    c.nonVisto ? 1 : 0,
    c.stato === "giu" ? 1 : 0,
    fermo(c) ? 1 : 0,
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

export function alberoCavi(ing: IngressoAlbero): AlberoCavi {
  const { scelto, avvisi, radiciStp } = scelte(ing);
  const testa = testaCavi(ing, radiciStp);
  const adj = new Map<string, Collegamento[]>();
  for (const c of ing.collegamenti) {
    if (!ing.visibili.has(c.a.nodo) || !ing.visibili.has(c.b.nodo)) continue;
    adj.set(c.a.nodo, [...(adj.get(c.a.nodo) ?? []), c]);
    adj.set(c.b.nodo, [...(adj.get(c.b.nodo) ?? []), c]);
  }
  // Foglie (come oggi): attaccati, client, hypervisor e «da sistemare» non fanno da ponte; il segmento sì.
  const foglia = (id: string): boolean => {
    const k = ing.nodi.get(id)?.classe;
    return k === undefined || k === "att" || k === "client" || k === "hyper" || k === "da_sistemare";
  };
  const forzati = new Map<string, string>();
  // ★ (I20): vince sempre, se raggiungibile.
  for (const s of ing.primari) {
    const c = migliore((adj.get(s.node_id) ?? []).filter((x) => altroCapo(x, s.node_id).nodo === s.other_node));
    if (c) forzati.set(s.node_id, c.id);
  }
  // Punto 6: il principale dell'hypervisor (§12.5): prima il non vecchio, poi il non giù, poi il più veloce, poi più VM.
  for (const id of ing.ipervisori) {
    if (forzati.has(id)) continue;
    const cs = (adj.get(id) ?? []).filter((c) => c.fiducia !== "a_mano" && c.fiducia !== "a_mano_confermato" && !foglia(altroCapo(c, id).nodo));
    if (cs.length < 2) continue;
    const c = [...cs].sort((x, y) => Number(x.nonVisto) - Number(y.nonVisto) || Number(x.stato === "giu") - Number(y.stato === "giu")
      || (y.velocitaMbps ?? 0) - (x.velocitaMbps ?? 0) || (y.vm ?? 0) - (x.vm ?? 0) || cmp(x.id, y.id))[0];
    forzati.set(id, c.id);
  }
  const stella = (c: Collegamento, to: string): boolean => ing.primari.some((s) => s.node_id === to && altroCapo(c, to).nodo === s.other_node);
  const profondita = new Map<string, number>();
  const padri: Record<string, string | null> = {};
  const via = new Map<string, Collegamento>();
  const radici: string[] = [];
  const preso = new Set<string>();
  const cresci = (r: string): void => {
    preso.add(r);
    profondita.set(r, 0);
    padri[r] = null;
    radici.push(r);
    const scegli = (stretto: boolean) => {
      let best: { k: number[]; da: string; to: string; c: Collegamento } | null = null;
      for (const x of [...preso].sort()) {
        if (foglia(x)) continue;
        for (const c of adj.get(x) ?? []) {
          const to = altroCapo(c, x).nodo;
          if (preso.has(to)) continue;
          const f = forzati.get(to);
          if (stretto && f !== undefined && f !== c.id) continue;
          const k = chiaveCavo(c, x, to, { scelto, stella, profondita });
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
  if (testa) cresci(testa);
  const resto = [...ing.visibili].filter((x) => !preso.has(x) && ing.nodi.has(x)).sort((a, b) =>
    Number(ing.nodi.get(a)?.classe !== "infra") - Number(ing.nodi.get(b)?.classe !== "infra")
    || (adj.get(b)?.length ?? 0) - (adj.get(a)?.length ?? 0) || cmp(a, b));
  for (const r of resto) if (!preso.has(r)) cresci(r);

  // Punto 8: uno switch X con padre P ha l'anomalia se ha cavi, anche bloccati, verso almeno altri due switch che stanno allo
  // stesso livello di P. Due soli uplink verso due switch dello stesso livello non la fanno scattare.
  const anomalie: Anomalia[] = [];
  for (const [x, p] of Object.entries(padri).sort(([a], [b]) => cmp(a, b))) {
    if (p === null || p.startsWith("seg:")) continue;
    const n = ing.nodi.get(x);
    const livello = profondita.get(p);
    if (!n || n.tipo !== "switch" || n.classe !== "infra" || livello === undefined) continue;
    const altri = [...new Set((adj.get(x) ?? []).map((c) => altroCapo(c, x).nodo))]
      .filter((y) => y !== p && ing.nodi.get(y)?.tipo === "switch" && profondita.get(y) === livello).sort();
    if (altri.length >= 2) anomalie.push({ nodo: x, padre: p, altri });
  }
  return { radici, padri, via, profondita, scelto, anomalie, avvisi, testa };
}
