/**
 * Il Prim del modello per cavo (spec topologia §13.8.3, punti 3-6) e la sua chiave, a sé: lo usano l'albero del modello per cavo
 * (`alberoCavi`, albero.ts) e l'albero della pagina (`alberoDellaPagina`, albero-pagina.ts) con le stesse linee, quindi lo stesso
 * esito (schermo = traccia). Sta in un modulo che importa solo tipi perché finisce nel pacchetto del browser anche a mappa spenta
 * (lo importa tree.ts): prima, da albero.ts, si portava dietro il resto del modello per cavo e links.ts (revisione finale di T3,
 * M8). Logica pura, deterministica.
 */
import type { ClasseMappa, Fiducia, StatoCollegamento } from "@/lib/topology/model-types";

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

/** L'ordine della fiducia nella chiave del punto 3 (vince il più piccolo); la pagina lo usa anche per le contrazioni. */
export const FIDUCIA: Readonly<Record<Fiducia, number>> = { certo: 0, probabile: 1, dedotto: 2, a_mano_confermato: 3, a_mano: 4 };
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
/** Bloccato dallo spanning tree, nell'albero comune o del tutto. */
export const fermo = (c: { stato: StatoCollegamento }): boolean => c.stato === "bloccato" || c.stato === "bloccato_comune";
/**
 * Tracciato a mano (con o senza prove dei dati): vince su ogni collegamento solo dedotto o letto, dopo la ★ (Riccardo, 22/10:
 * «il collegamento manuale deve sempre vincere»; prima la fiducia «a mano» era l'ultima e il cavo finiva fra le ridondanze).
 */
export const tracciatoAMano = (c: { fiducia: Fiducia }): boolean => c.fiducia === "a_mano" || c.fiducia === "a_mano_confermato";
/**
 * Il membro di riserva di un bond (§13.5.5): non porta traffico finché l'altra scheda è su, come una porta bloccata, ma non lo
 * ferma lo spanning tree. Nell'albero vale come un bloccato (§13.8.3 punto 4: padre solo se non c'è altro); resta fuori da
 * `fermo`, che dice «bloccato dallo spanning tree» (la testa e l'uplink del controller).
 */
const diRiserva = (c: { stato: StatoCollegamento }): boolean => c.stato === "riserva_bond";

/** Punto 3: la chiave con cui Prim sceglie, confrontata elemento per elemento (vince la più piccola). */
export function chiaveCavo(c: LineaAlbero, da: string, to: string, ctx: { scelto: ReadonlyMap<string, string>; stella: (c: LineaAlbero, to: string) => boolean; profondita: ReadonlyMap<string, number> }): number[] {
  const versoSegmento = to.startsWith("seg:") || da.startsWith("seg:");
  return [
    ctx.stella(c, to) ? 0 : 1,
    tracciatoAMano(c) ? 0 : 1,
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
  // vale. Il padre può essere diverso fra traccia e schermo; con `DALLE_VM_SOLO_DETTAGLI` spenta non succede (accesa dal 16/10).
  const forzati = new Map<string, string>();
  for (const [nodo, id] of ing.stelle) if ((adj.get(nodo) ?? []).some((c) => c.id === id)) forzati.set(nodo, id);
  // Il cavo tracciato a mano di un oggetto finale (server, hypervisor, attaccato, client) verso chi può fargli da padre: è il suo
  // principale anche se un altro switch lo vede prima nella tabella MAC (22/10). Fra due apparati di rete basta la chiave: forzare
  // tutti e due i capi li farebbe aspettare l'uno l'altro.
  const ordine = (x: LineaAlbero, y: LineaAlbero): number => Number(x.nonVisto) - Number(y.nonVisto) || Number(x.stato === "giu") - Number(y.stato === "giu")
    || Number(diRiserva(x)) - Number(diRiserva(y)) || (y.velocitaMbps ?? 0) - (x.velocitaMbps ?? 0) || (y.vm ?? 0) - (x.vm ?? 0) || cmp(x.id, y.id);
  for (const id of [...adj.keys()].sort()) {
    if (forzati.has(id) || !foglia(id)) continue;
    const cs = (adj.get(id) ?? []).filter((c) => tracciatoAMano(c) && !foglia(altro(c, id)));
    if (cs.length > 0) forzati.set(id, [...cs].sort(ordine)[0].id);
  }
  // Punto 6: il principale dell'hypervisor (§12.5): prima il non vecchio, poi il non giù, poi il non di riserva del bond (§13.3.2
  // riga 17: gli altri membri del bond sono ridondanze «⇄»; prima, a pari velocità, l'id sceglieva la riserva: G16, lettura D),
  // poi il più veloce, poi più VM.
  for (const id of [...ing.ipervisori].sort()) {
    if (forzati.has(id)) continue;
    const cs = (adj.get(id) ?? []).filter((c) => !c.aMano && !foglia(altro(c, id)));
    if (cs.length < 2) continue;
    forzati.set(id, [...cs].sort(ordine)[0].id);
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
  // Una partenza che è un oggetto finale non cresce niente: se parte per prima resta sola, e il cavo verso il suo switch (anche
  // tracciato a mano) finisce fra le ridondanze (PX-NAS, 22/10: trascinato in una mappa prima di collegarlo). Fa da radice solo
  // se nessuno la raggiunge, col resto.
  for (const r of ing.partenze) if (ing.visibili.has(r) && ing.classe(r) !== undefined && !foglia(r) && !preso.has(r)) cresci(r);
  const resto = [...ing.visibili].filter((x) => !preso.has(x) && ing.classe(x) !== undefined).sort((a, b) =>
    Number(ing.classe(a) !== "infra") - Number(ing.classe(b) !== "infra") || (adj.get(b)?.length ?? 0) - (adj.get(a)?.length ?? 0) || cmp(a, b));
  for (const r of resto) if (!preso.has(r)) cresci(r);
  return { radici, padri, via, profondita };
}
