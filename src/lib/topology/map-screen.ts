// src/lib/topology/map-screen.ts
/**
 * La mappa a schermo nei due orientamenti (spec topologia §12.2) e le ridondanze a richiesta
 * (spec §12.5), in logica pura: la usano map-canvas, map-node, map-edge e la barra.
 *
 * - Maniglie con id fissi: in «Orizzontale» (`tb`) le linee escono dal fondo ed entrano
 *   dall'alto; in «Verticale» (`lr`) escono da destra ed entrano da sinistra; verso gli
 *   attaccati (elencati sotto il riquadro in `lr`) un tratto corto parte dal fondo.
 * - «Adatta» in verticale adatta la larghezza e porta in cima a sinistra (poi si scorre).
 * - Le ridondanze (collegamenti che l'albero non usa) non si disegnano: le mostra il clic
 *   sul riquadro (solo le sue) o «Mostra ridondanze» (tutte). I principali sempre.
 */
import type { MapLink, MapOrientation } from "@/lib/topology/model-types";
import { ATT_INDENT, ATT_MAX, ATT_ROW } from "@/lib/topology/tree-layout-consts";
import type { LayoutResult } from "@/lib/topology/tree-layout";

/**
 * Il livello (z-index) delle linee del nodo scelto (T3, §13.10.3) e delle loro parole. React Flow mette ogni linea in un suo
 * strato: le parole senza livello finivano sotto le altre linee evidenziate («10G · r…ndanza», verifica a schermo di T3). Allo
 * stesso livello vengono dopo le linee e prima dei riquadri. Le altre linee e parole restano senza livello, come prima.
 */
export const Z_EVIDENZA = 1;
export function livelloEvidenza(e: "su" | "giu" | undefined): number | undefined {
  return e === "su" ? Z_EVIDENZA : undefined;
}

/**
 * Il pulsante di un'azione che toglie qualcosa, con la mappa nuova: il «Danger» del design system Domarc, rosso scuro pieno e
 * testo bianco (9,0:1). Quello di shadcn qui è rosso #EF4444 su rosa pallido, 3,3:1 (verifica a schermo di T3: «Ignora i cavi
 * scelti»); Riccardo è daltonico, l'azione si legge dal testo. La classe intera sta qui, scritta, perché Tailwind la trovi.
 */
export const PERICOLO = { fondo: "#8E1B20", testo: "#FFFFFF" } as const;
export const CLASSE_PERICOLO = "bg-[#8E1B20] text-white hover:bg-[#8E1B20]/90 dark:bg-[#8E1B20] dark:hover:bg-[#8E1B20]/90";

/** Orizzontale: entrata in alto, uscita in basso (gli id di prima della verticale). */
export const HANDLE_IN = "su", HANDLE_OUT = "giu";
/** Verticale: entrata a sinistra, uscita a destra. */
export const HANDLE_IN_LR = "sx", HANDLE_OUT_LR = "dx";
/** Verticale: il tratto dal fondo del riquadro verso i suoi attaccati. */
export const HANDLE_ATT = "fondo";

export function lineHandles(o: MapOrientation): { source: string; target: string } {
  return o === "lr" ? { source: HANDLE_OUT_LR, target: HANDLE_IN_LR } : { source: HANDLE_OUT, target: HANDLE_IN };
}

interface At { id: string; x: number; y: number }

/**
 * Il verso di una ridondanza: in orizzontale scende dal riquadro più in alto, in verticale va da
 * quello più a sinistra a quello più a destra. A pari posto decide l'altro asse, poi l'id: stessi
 * dati, stessa linea.
 */
export function redundantEnds(o: MapOrientation, a: At, b: At): [string, string] {
  const key = (n: At): [number, number] => (o === "lr" ? [n.x, n.y] : [n.y, n.x]);
  const [a1, a2] = key(a), [b1, b2] = key(b);
  const aFirst = a1 !== b1 ? a1 < b1 : a2 !== b2 ? a2 < b2 : a.id < b.id;
  return aFirst ? [a.id, b.id] : [b.id, a.id];
}

export const FIT_MIN = 0.25, FIT_MAX = 1;

/** «Adatta» in verticale: la larghezza della disposizione nel riquadro della mappa, fra 0,25 e 1, in cima a sinistra. */
export function fitWidthViewport(layoutWidth: number, paneWidth: number): { x: number; y: number; zoom: number } {
  const zoom = layoutWidth > 0 && paneWidth > 0 ? Math.min(FIT_MAX, Math.max(FIT_MIN, paneWidth / layoutWidth)) : 1;
  return { x: 0, y: 0, zoom };
}

interface Box { x: number; y: number; w: number; h: number }

/**
 * Dove si apre la mappa (al 100 %) quando cambiano modo, mappa o orientamento: in orizzontale la
 * testa in mezzo e in alto, come prima; in verticale la testa a sinistra e a metà altezza, senza
 * scendere sopra la cima della mappa (una testa in alto non lascia una fascia vuota).
 */
export function centerViewport(o: MapOrientation, n: Box, pane: { width: number; height: number }): { x: number; y: number; zoom: number } {
  if (o === "tb") return { x: pane.width / 2 - (n.x + n.w / 2), y: 10, zoom: 1 };
  return { x: 20 - n.x, y: Math.min(10, pane.height / 2 - (n.y + n.h / 2)), zoom: 1 };
}

/** «+ altri N» dopo i primi ATT_MAX attaccati: accanto al riquadro in orizzontale, sotto l'ultimo attaccato in verticale. */
export function moreAttachedAt(o: MapOrientation, b: Box): { x: number; y: number } {
  return o === "lr"
    ? { x: b.x + ATT_INDENT, y: b.y + b.h + 4 + ATT_MAX * ATT_ROW }
    : { x: b.x + b.w + 14, y: b.y + ATT_MAX * ATT_ROW };
}

/**
 * In verticale il tronco verticale dei figli corre a LR_TRUNK px dal lato destro del genitore
 * (non a metà fra le colonne): così il tratto orizzontale che entra nel figlio è lungo e porta
 * l'etichetta (porte, velocità, ⚡, ★, «✎ ✓/?») senza coprire né il tronco né i riquadri.
 */
export const LR_TRUNK = 14;

/** Larghezza massima dell'etichetta di una linea in verticale: fra il tronco e il figlio (oltre, va a capo). */
export function lrLabelMaxWidth(sourceX: number, targetX: number): number {
  return Math.max(40, targetX - (sourceX + LR_TRUNK) - 8);
}

/** La pagina di stampa della mappa che si guarda (spec §12.3); null se non c'è una mappa scelta. */
export function printHref(mode: "auto" | "passo", mapId: number | null): string | null {
  if (mode === "auto") return "/topology/stampa?mappa=auto";
  return mapId === null ? null : `/topology/stampa?mappa=${mapId}`;
}

type Ends = Pick<MapLink, "a" | "b" | "redundant">;

/**
 * Le linee da disegnare (spec §12.5): i principali sempre; le ridondanze tutte con «Mostra
 * ridondanze», altrimenti solo quelle del riquadro scelto. La disposizione non cambia: usa già
 * solo i principali.
 */
export function visibleEdges<L extends Ends>(links: readonly L[], opts: { showAll: boolean; selected: string | null }): L[] {
  return links.filter((l) => !l.redundant || opts.showAll || (opts.selected !== null && (l.a === opts.selected || l.b === opts.selected)));
}

/**
 * I collegamenti fra due riquadri della disposizione: quelli che si possono disegnare (gli attaccati sono righe di
 * un elenco). «⇄ N» a schermo e «Cavi di ridondanza» in stampa partono da qui (revisione finale M-4: prima la stampa
 * contava anche i cavi verso gli attaccati, e lo stesso oggetto aveva «⇄ 1» a schermo e due righe sulla carta).
 */
export function drawableLinks<L extends Ends>(links: readonly L[], nodes: ReadonlyMap<string, { role: string }>): L[] {
  return links.filter((l) => {
    const a = nodes.get(l.a), b = nodes.get(l.b);
    return !!a && !!b && a.role !== "attached" && b.role !== "attached";
  });
}

/** «⇄ N» sul riquadro: quante ridondanze ha ogni oggetto (chi non ne ha non è nella mappa). */
export function redundancyCounts(links: readonly Ends[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const l of links) {
    if (!l.redundant) continue;
    out.set(l.a, (out.get(l.a) ?? 0) + 1);
    out.set(l.b, (out.get(l.b) ?? 0) + 1);
  }
  return out;
}

export type Rect = { x: number; y: number; w: number; h: number };
export type Pt = { x: number; y: number };

/** Alta quanto la riga delle porte scritta sopra un riquadro («Port 11 → SFP+ 1»). */
const PORT_ROW = 18;

/**
 * Dove una scritta non deve finire (Task 5): i riquadri con la riga delle porte sopra, gli
 * attaccati, i gruppi degli AP. Coordinate della disposizione.
 */
export function labelBoxes(
  nodes: Iterable<Rect & { role: "box" | "ap" | "attached" }>,
  groups: Iterable<Rect>,
): Rect[] {
  const out: Rect[] = [];
  for (const n of nodes) out.push(n.role === "box" ? { x: n.x, y: n.y - PORT_ROW, w: n.w, h: n.h + PORT_ROW } : { x: n.x, y: n.y, w: n.w, h: n.h });
  for (const g of groups) out.push({ x: g.x, y: g.y, w: g.w, h: g.h });
  return out;
}

/** Quanto la parola si può scostare dalla linea quando sulla linea non c'è posto (fra il bordo della parola e la linea). */
export const ACCANTO_MAX = 48;

/**
 * Il centro della parola di una ridondanza («1G · ridondanza», Task 5) o della linea di un figlio
 * spostato a mano. A metà percorso se lì non tocca niente; altrimenti il punto della linea più
 * vicino alla metà in cui la scritta non tocca nessun riquadro. Se la linea è tutta coperta, la
 * parola si accosta alla linea: sopra o sotto un tratto orizzontale, a destra o a sinistra di uno
 * verticale, a non più di ACCANTO_MAX px (verifica a schermo di T1, 15/10: un figlio spostato a
 * mano a 45 px dal genitore aveva la parola a metà della linea corta, dietro i due riquadri, e
 * «1G · ⚡ 6,9 W» si leggeva a pezzi). Se anche lì tocca un riquadro resta a metà: meglio sopra un
 * riquadro che sparita. Si prova un punto ogni 8 px.
 */
export function redundantLabelAt(points: readonly Pt[], size: { w: number; h: number }, avoid: readonly Rect[]): Pt {
  const segs: Array<{ a: Pt; b: Pt; len: number; from: number }> = [];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len === 0) continue;
    segs.push({ a, b, len, from: total });
    total += len;
  }
  /** Il punto a `s` px dall'inizio del percorso, e se il tratto lì è orizzontale. */
  const at = (s: number): { p: Pt; orizzontale: boolean } => {
    const seg = segs.find((g) => s <= g.from + g.len) ?? segs[segs.length - 1];
    if (!seg) return { p: points[0] ?? { x: 0, y: 0 }, orizzontale: true };
    const t = Math.min(1, Math.max(0, (s - seg.from) / seg.len));
    return {
      p: { x: seg.a.x + (seg.b.x - seg.a.x) * t, y: seg.a.y + (seg.b.y - seg.a.y) * t },
      orizzontale: Math.abs(seg.b.x - seg.a.x) >= Math.abs(seg.b.y - seg.a.y),
    };
  };
  const free = (p: Pt) => {
    const r = { x: p.x - size.w / 2 - 2, y: p.y - size.h / 2 - 2, w: size.w + 4, h: size.h + 4 };
    return !avoid.some((b) => r.x < b.x + b.w && b.x < r.x + r.w && r.y < b.y + b.h && b.y < r.y + r.h);
  };
  const tondo = (p: Pt): Pt => ({ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 });
  const mid = total / 2;
  const STEP = 8;
  /** Dalla metà verso i due capi: il primo punto del percorso per cui `prova` trova un posto. */
  const dallaMeta = (prova: (s: number) => Pt | undefined): Pt | undefined => {
    for (let d = 0; d <= mid; d += STEP) {
      for (const s of d === 0 ? [mid] : [mid - d, mid + d]) {
        const p = prova(s);
        if (p) return p;
      }
    }
    return undefined;
  };
  const sullaLinea = dallaMeta((s) => { const { p } = at(s); return free(p) ? p : undefined; });
  if (sullaLinea) return tondo(sullaLinea);
  // Accanto alla linea, a distanza crescente: prima sopra (o a destra), poi sotto (o a sinistra).
  for (let g = 0; g <= ACCANTO_MAX; g += STEP) {
    const accanto = dallaMeta((s) => {
      const { p, orizzontale } = at(s);
      const o = (orizzontale ? size.h : size.w) / 2 + 2 + g;
      const posti = orizzontale ? [{ x: p.x, y: p.y - o }, { x: p.x, y: p.y + o }] : [{ x: p.x + o, y: p.y }, { x: p.x - o, y: p.y }];
      return posti.find(free);
    });
    if (accanto) return tondo(accanto);
  }
  return tondo(at(mid).p);
}

// ─── Lato più vicino (spec §13.10.1, vincolo 5) ───────────────────────────────
// Una funzione sola per schermo, stampa e misura (ADR 0012, «cosa diventa difficile» 1; prova I31): i lati li sceglie
// solo `latiVicini`, il percorso lo traccia solo `percorso`. Le linee dell'albero restano a tronco, per scelta
// (confermato da Riccardo il 14/10 sera): il lato più vicino vale per ridondanze, linee a mano che non sono dell'albero
// e figli spostati a mano dall'altra parte.

/** Un lato del riquadro. */
export type Lato = "su" | "giu" | "sx" | "dx";

/** Le maniglie che mancavano: uscita in alto e a sinistra, entrata in basso e a destra. Id fissi. */
export const HANDLE_OUT_SU = "s-su", HANDLE_OUT_SX = "s-sx", HANDLE_IN_GIU = "t-giu", HANDLE_IN_DX = "t-dx";

const USCITA: Record<Lato, string> = { su: HANDLE_OUT_SU, giu: HANDLE_OUT, sx: HANDLE_OUT_SX, dx: HANDLE_OUT_LR };
const ENTRATA: Record<Lato, string> = { su: HANDLE_IN, giu: HANDLE_IN_GIU, sx: HANDLE_IN_LR, dx: HANDLE_IN_DX };

/** Le maniglie di React Flow di una linea che esce dal lato `da` ed entra dal lato `a`. */
export function maniglieLati(l: { da: Lato; a: Lato }): { source: string; target: string } {
  return { source: USCITA[l.da], target: ENTRATA[l.a] };
}

/** Il punto a metà di un lato (dove React Flow mette la maniglia). */
export function centroLato(r: Rect, l: Lato): Pt {
  switch (l) {
    case "su": return { x: r.x + r.w / 2, y: r.y };
    case "giu": return { x: r.x + r.w / 2, y: r.y + r.h };
    case "sx": return { x: r.x, y: r.y + r.h / 2 };
    case "dx": return { x: r.x + r.w, y: r.y + r.h / 2 };
  }
}

const orizzontale = (l: Lato): boolean => l === "sx" || l === "dx";
const arrotonda = (p: Pt): Pt => ({ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 });

/**
 * Il percorso ortogonale fra due punti di lato, con al massimo due curve e raggio 0 (come oggi): a «Z» fra lati
 * paralleli, girando a metà; a «L» fra lati perpendicolari; dritto se i due punti sono allineati.
 */
export function percorsoDaPunti(pa: Pt, la: Lato, pb: Pt, lb: Lato): Pt[] {
  if (orizzontale(la) && orizzontale(lb)) {
    if (pa.y === pb.y) return [arrotonda(pa), arrotonda(pb)];
    const mx = (pa.x + pb.x) / 2;
    return [pa, { x: mx, y: pa.y }, { x: mx, y: pb.y }, pb].map(arrotonda);
  }
  if (!orizzontale(la) && !orizzontale(lb)) {
    if (pa.x === pb.x) return [arrotonda(pa), arrotonda(pb)];
    const my = (pa.y + pb.y) / 2;
    return [pa, { x: pa.x, y: my }, { x: pb.x, y: my }, pb].map(arrotonda);
  }
  return (orizzontale(la) ? [pa, { x: pb.x, y: pa.y }, pb] : [pa, { x: pa.x, y: pb.y }, pb]).map(arrotonda);
}

/** Il percorso fra il lato `la` di A e il lato `lb` di B. */
export function percorso(a: Rect, la: Lato, b: Rect, lb: Lato): Pt[] {
  return percorsoDaPunti(centroLato(a, la), la, centroLato(b, lb), lb);
}

/**
 * I due lati si guardano: la linea esce da A verso B ed entra in B venendo da A, senza tornare indietro e senza
 * passare nel proprio riquadro (spec §13.10.1; misura C10). Fra lati paralleli B sta tutto oltre il lato di A; a «L»
 * il gomito sta fuori da tutti e due i riquadri.
 */
export function siGuardano(a: Rect, la: Lato, b: Rect, lb: Lato): boolean {
  if (orizzontale(la) && orizzontale(lb)) {
    return (la === "dx" && lb === "sx" && b.x >= a.x + a.w) || (la === "sx" && lb === "dx" && b.x + b.w <= a.x);
  }
  if (!orizzontale(la) && !orizzontale(lb)) {
    return (la === "giu" && lb === "su" && b.y >= a.y + a.h) || (la === "su" && lb === "giu" && b.y + b.h <= a.y);
  }
  const pa = centroLato(a, la), pb = centroLato(b, lb);
  if (orizzontale(la)) {
    const avanti = la === "dx" ? pb.x > pa.x : pb.x < pa.x;
    const entra = lb === "su" ? pa.y < pb.y : pa.y > pb.y;
    return avanti && entra;
  }
  const avanti = la === "giu" ? pb.y > pa.y : pb.y < pa.y;
  const entra = lb === "sx" ? pa.x < pb.x : pa.x > pb.x;
  return avanti && entra;
}

/** Un tratto orizzontale o verticale passa dentro un riquadro (il bordo non conta). */
function tagliaRiquadro(p: Pt, q: Pt, r: Rect): boolean {
  const x1 = Math.min(p.x, q.x), x2 = Math.max(p.x, q.x), y1 = Math.min(p.y, q.y), y2 = Math.max(p.y, q.y);
  return x1 < r.x + r.w && x2 > r.x && y1 < r.y + r.h && y2 > r.y;
}

/** Il percorso attraversa almeno un riquadro (scelta di `latiVicini`, misura C11). */
export function attraversa(punti: readonly Pt[], riquadri: readonly Rect[]): boolean {
  for (let i = 1; i < punti.length; i++) for (const r of riquadri) if (tagliaRiquadro(punti[i - 1], punti[i], r)) return true;
  return false;
}

function lunghezza(p: readonly Pt[]): number {
  let s = 0;
  for (let i = 1; i < p.length; i++) s += Math.abs(p[i].x - p[i - 1].x) + Math.abs(p[i].y - p[i - 1].y);
  return s;
}

/**
 * I quattro candidati (spec §13.10.1), in ordine: 1. la coppia di lati affacciati sull'asse dove il vuoto fra i due
 * riquadri è maggiore; 2. quella sull'altro asse; 3-4. le due coppie a «L», prima la più corta. Solo coppie di lati che
 * si guardano: una coppia che tornerebbe indietro non è un candidato. A pari vuoto vince l'asse dell'orientamento
 * (orizzontale in «Verticale», verticale in «Orizzontale»). Riquadri sovrapposti: nessun candidato.
 */
export function candidatiLati(a: Rect, b: Rect, o: MapOrientation): Array<{ da: Lato; a: Lato }> {
  const vuotoX = b.x >= a.x + a.w ? b.x - (a.x + a.w) : a.x >= b.x + b.w ? a.x - (b.x + b.w) : -1;
  const vuotoY = b.y >= a.y + a.h ? b.y - (a.y + a.h) : a.y >= b.y + b.h ? a.y - (b.y + b.h) : -1;
  const destra = b.x + b.w / 2 >= a.x + a.w / 2, sotto = b.y + b.h / 2 >= a.y + a.h / 2;
  const h: { da: Lato; a: Lato } = destra ? { da: "dx", a: "sx" } : { da: "sx", a: "dx" };
  const v: { da: Lato; a: Lato } = sotto ? { da: "giu", a: "su" } : { da: "su", a: "giu" };
  const assi = vuotoX > vuotoY || (vuotoX === vuotoY && o === "lr") ? [h, v] : [v, h];
  const elle = [{ da: h.da, a: v.a }, { da: v.da, a: h.a }]
    .filter((c) => siGuardano(a, c.da, b, c.a))
    .sort((x, y) => lunghezza(percorso(a, x.da, b, x.a)) - lunghezza(percorso(a, y.da, b, y.a)));
  return [...assi.filter((c) => siGuardano(a, c.da, b, c.a)), ...elle];
}

/**
 * Il lato più vicino: il primo candidato il cui percorso non attraversa un altro riquadro; se nessuno passa pulito,
 * quello col percorso più corto. Due riquadri sovrapposti usano i lati di oggi.
 */
export function latiVicini(a: Rect, b: Rect, o: MapOrientation, ostacoli: readonly Rect[]): { da: Lato; a: Lato } {
  const c = candidatiLati(a, b, o);
  if (c.length === 0) return o === "lr" ? { da: "dx", a: "sx" } : { da: "giu", a: "su" };
  return c.find((x) => !attraversa(percorso(a, x.da, b, x.a), ostacoli))
    ?? [...c].sort((x, y) => lunghezza(percorso(a, x.da, b, x.a)) - lunghezza(percorso(a, y.da, b, y.a)))[0];
}

/** Gli ostacoli di una linea: tutti i riquadri della disposizione tranne i suoi due capi. */
export function ostacoli(riquadri: Iterable<Rect & { id: string }>, tranne: readonly string[]): Rect[] {
  const via = new Set(tranne);
  const out: Rect[] = [];
  for (const r of riquadri) if (!via.has(r.id)) out.push({ x: r.x, y: r.y, w: r.w, h: r.h });
  return out;
}

/** I riquadri della disposizione con il loro id (i gruppi degli AP: «apg:‹padre›»). */
export function rettangoli(layout: LayoutResult): Array<Rect & { id: string }> {
  return [
    ...[...layout.nodes.values()].map((n) => ({ id: n.id, x: n.x, y: n.y, w: n.w, h: n.h })),
    ...layout.apGroups.map((g) => ({ id: `apg:${g.parent}`, x: g.x, y: g.y, w: g.w, h: g.h })),
  ];
}

/** Il figlio sta dalla sua parte: in «Verticale» a destra del tronco del genitore, in «Orizzontale» sotto il genitore. */
export function troncoPossibile(o: MapOrientation, padre: Rect, figlio: Rect): boolean {
  return o === "lr" ? figlio.x >= padre.x + padre.w + LR_TRUNK : figlio.y >= padre.y + padre.h;
}

/** La linea fra un genitore e un figlio: a tronco come oggi; un figlio spostato a mano dall'altra parte, sul lato più vicino. */
export function lineaAlbero(o: MapOrientation, padre: Rect, figlio: Rect, ostacoli: readonly Rect[]):
  { tronco: true } | { tronco: false; lati: { da: Lato; a: Lato } } {
  return troncoPossibile(o, padre, figlio) ? { tronco: true } : { tronco: false, lati: latiVicini(padre, figlio, o, ostacoli) };
}

// ─── Elenco a sinistra comprimibile (spec §13.10.2, vincolo 6) ────────────────
/** Elenco aperto o chiuso: si ricorda per chi guarda, in questo browser, come la barra dei dettagli. */
export const ELENCO_KEY = "da-ipam.topologia.elenco";

export function elencoAperto(leggi: () => string | null): boolean {
  try {
    return leggi() !== "chiuso";
  } catch {
    return true; // memoria non disponibile (navigazione privata, bloccata): aperto, come di base
  }
}

export function salvaElenco(scrivi: (v: string) => void, aperto: boolean): void {
  try {
    scrivi(aperto ? "aperto" : "chiuso");
  } catch {
    // memoria non disponibile: la scelta vale solo per questa visita
  }
}

/** La freccia dice dove va l'elenco: «◂ Elenco» quando è aperto (il clic lo chiude), «Elenco ▸» quando è chiuso. */
export function pulsanteElenco(aperto: boolean, passo: boolean): { etichetta: string; titolo: string } {
  if (aperto) return { etichetta: "◂ Elenco", titolo: "Chiude l'elenco degli oggetti: la mappa prende tutta la larghezza" };
  return { etichetta: "Elenco ▸", titolo: passo ? "Apre l'elenco per trascinare gli oggetti sulla mappa" : "Apre l'elenco degli oggetti a sinistra" };
}

/**
 * Il nodo scelto evidenzia i suoi collegamenti (T3, spec §13.10.3, aggiunta di Riccardo del 16/10): gli id delle linee con
 * `selected` a un capo, ridondanze comprese. Vuoto senza selezione. Solo a schermo: la stampa non ha selezione.
 */
export function evidenzaDellaSelezione(links: ReadonlyArray<Pick<MapLink, "id" | "a" | "b">>, selected: string | null): Set<string> {
  const out = new Set<string>();
  if (selected === null) return out;
  for (const l of links) if (l.a === selected || l.b === selected) out.add(l.id);
  return out;
}
