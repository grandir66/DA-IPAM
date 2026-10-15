/**
 * La traccia «Cosa cambierebbe con la mappa nuova (una linea per cavo)» (spec topologia §13.11.3): il freno con la sua
 * traccia contabile. Confronta l'albero della mappa automatica di oggi con quello del modello per cavo calcolato in ombra:
 * quanti oggetti avrebbero un altro padre, quanti collegamenti per genere e quanti dei generi nuovi (bloccati, instradati,
 * fasci, tunnel, ponti radio), quanti segmenti, chi entra o esce dall'albero, quante anomalie; poi una riga per differenza
 * col perché, con un limite. Logica pura, in memoria: non scrive niente, non si calcola a ogni apertura della mappa.
 */
import type { TopologyModel } from "@/lib/topology/model-types";
import type { Collegamento, Genere } from "./collegamenti";
import type { ModelloCavi } from "./modello";

/**
 * Il padre di un oggetto oggi (`prima`) e con la mappa nuova (`dopo`): `null` = una partenza dell'albero, `undefined` = fuori
 * dall'albero (l'oggetto esce o entra). Nel JSON della rotta una chiave `undefined` manca, e la pagina la legge come tale.
 */
export interface Differenza { id: string; prima: string | null | undefined; dopo: string | null | undefined }
export interface RigaTraccia extends Differenza { perche: string }
export interface Traccia {
  schema: boolean;
  padriDiversi: number;
  entrano: string[];
  escono: string[];
  perGenere: Record<Genere, number>;
  nuovi: { bloccati: number; instradati: number; fasci: number; tunnel: number; radio: number };
  segmenti: number;
  anomalie: number;
  righe: RigaTraccia[];
  altri: number;
  avvisi: Array<{ nodo: string; testo: string }>;
  nonCalcolato: readonly string[];
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
/** Le VM appese dalla pagina e i segmenti non sono oggetti dell'inventario: non «entrano» né «escono». */
const oggetto = (id: string): boolean => !id.startsWith("vm:") && !id.startsWith("seg:");

export function confrontaAlberi(oggi: Readonly<Record<string, string | null>>, nuovo: Readonly<Record<string, string | null>>): Differenza[] {
  const ids = [...new Set([...Object.keys(oggi), ...Object.keys(nuovo)])].filter(oggetto).sort(cmp);
  return ids.filter((id) => oggi[id] !== nuovo[id]).map((id) => ({ id, prima: oggi[id], dopo: nuovo[id] }));
}

const GENERE: Readonly<Record<Genere, string>> = {
  cavo: "cavo", fascio: "fascio di cavi", tunnel: "tunnel", radio: "ponte radio", senza_fili: "collegamento senza fili", segmento: "appartenenza a un segmento",
};
const FIDUCIA: Readonly<Record<Collegamento["fiducia"], string>> = {
  certo: "certo", probabile: "probabile", dedotto: "dedotto", a_mano_confermato: "a mano, confermato", a_mano: "a mano",
};
const fra = (cs: readonly Collegamento[], x: string, y: string): Collegamento | undefined =>
  cs.find((c) => (c.a.nodo === x && c.b.nodo === y) || (c.a.nodo === y && c.b.nodo === x));

function perche(d: Differenza, m: ModelloCavi): string {
  if (d.dopo === undefined) return "nella mappa nuova non ha un collegamento verso l'albero";
  if (d.dopo === null) return "nella mappa nuova è una partenza dell'albero";
  const c = m.albero.via.get(d.id);
  const parti: string[] = [];
  if (c && m.albero.scelto.get(d.id) === c.id) parti.push("è la sua porta radice nello spanning tree");
  else if (d.dopo.startsWith("seg:")) parti.push("la sua porta sente più apparati: sta su un segmento");
  else if (c) parti.push(`${GENERE[c.genere]} ${FIDUCIA[c.fiducia]}${c.velocitaMbps ? `, ${c.velocitaMbps >= 1000 ? `${c.velocitaMbps / 1000}G` : `${c.velocitaMbps}M`}` : ""}; nessuna prova dello spanning tree: scelto per fiducia e velocità`);
  if (d.prima) {
    const vecchio = fra(m.collegamenti, d.id, d.prima);
    if (!vecchio) parti.push("il collegamento di oggi non c'è nel modello per cavo");
    else if (vecchio.stato === "bloccato" || vecchio.stato === "bloccato_comune") parti.push("il collegamento di oggi è bloccato dallo spanning tree");
    else if (vecchio.stato === "instradato") parti.push("il collegamento di oggi è instradato (fuori dal bridge)");
    else if (vecchio.stato === "giu") parti.push("il collegamento di oggi è giù");
  }
  return parti.join("; ");
}

export function calcolaTraccia(oggi: Readonly<Record<string, string | null>>, m: ModelloCavi, limite = 50): Traccia {
  const diff = confrontaAlberi(oggi, m.albero.padri);
  const perGenere: Record<Genere, number> = { cavo: 0, fascio: 0, tunnel: 0, radio: 0, senza_fili: 0, segmento: 0 };
  for (const c of m.collegamenti) perGenere[c.genere]++;
  return {
    schema: m.schema,
    padriDiversi: diff.filter((d) => d.prima !== undefined && d.dopo !== undefined).length,
    entrano: diff.filter((d) => d.prima === undefined).map((d) => d.id),
    escono: diff.filter((d) => d.dopo === undefined).map((d) => d.id),
    perGenere,
    nuovi: {
      bloccati: m.collegamenti.filter((c) => c.stato === "bloccato" || c.stato === "bloccato_comune").length,
      instradati: m.collegamenti.filter((c) => c.stato === "instradato").length,
      fasci: perGenere.fascio, tunnel: perGenere.tunnel, radio: perGenere.radio,
    },
    segmenti: m.segmenti.length,
    anomalie: m.albero.anomalie.length,
    righe: diff.slice(0, limite).map((d) => ({ ...d, perche: perche(d, m) })),
    altri: Math.max(0, diff.length - limite),
    avvisi: m.albero.avvisi,
    nonCalcolato: m.nonCalcolato,
  };
}

/** I nomi degli oggetti nominati dalla traccia (righe, padri, chi entra o esce, avvisi). Un segmento: «segmento su ‹membro› ‹porta›». */
export function nomiTraccia(t1: Pick<TopologyModel, "nodes">, m: ModelloCavi, tr: Traccia): Record<string, string> {
  const nodi = new Map(t1.nodes.map((n) => [n.id, n.name]));
  const seg = new Map(m.segmenti.map((s) => {
    const primo = s.membri.find((p) => p.nodo.startsWith("dev:")) ?? s.membri[0];
    return [s.id, `segmento su ${nodi.get(primo?.nodo ?? "") ?? primo?.nodo ?? "?"} ${primo?.nome ?? ""}`.trim()];
  }));
  const ids = new Set<string>([...tr.entrano, ...tr.escono, ...tr.avvisi.map((a) => a.nodo)]);
  for (const r of tr.righe) for (const x of [r.id, r.prima, r.dopo]) if (typeof x === "string") ids.add(x);
  return Object.fromEntries([...ids].sort(cmp).map((id) => [id, seg.get(id) ?? nodi.get(id) ?? id]));
}
