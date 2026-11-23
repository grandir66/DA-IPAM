/**
 * Dove passano i cavi della tavola (spec tavola §3, la parte che a mano ha chiesto più lavoro). Fra due file adiacenti
 * il cavo scende dalla porta, corre in una corsia del corridoio e risale; fra file non adiacenti non attraversa gli
 * apparati in mezzo: va al bordo più vicino alla x media dei due capi, scende in una corsia di bordo e rientra nel
 * corridoio sopra la fila d'arrivo; dentro la stessa fila usa il corridoio sotto. Ogni corridoio ha tante corsie quanti
 * cavi lo attraversano insieme (altezza 30 + 8 × corsie), assegnate a intervalli: si ordina per x di partenza e si
 * prende la prima corsia libera, così due cavi non stanno mai sullo stesso tratto. Uscita: polilinee ortogonali, in
 * coordinate della tavola intera. Logica pura.
 */
import type { ApparatoComposto, CavoComposto } from "./tipi";
import { disponi, type Riga } from "./righe";

export type Punto = [number, number];

export interface Linea {
  id: string;
  collegamento: string;
  punti: Punto[];
  /** Passa dal bordo: si disegna un po' più sottile. */
  lungo: boolean;
}

export interface Disegno {
  /** Spostamento orizzontale del contenuto (la corsia di bordo sinistra). */
  dx: number;
  /** y di ogni riga. */
  yRighe: number[];
  linee: Linea[];
  larghezza: number;
  altezza: number;
  /** id della porta → punto d'attacco del cavo (sul bordo del telaio). */
  attacchi: Record<string, Punto>;
}

const CORSIA = 8;
const BORDO_CORRIDOIO = 15;
const DISTANZA = 6;

interface Intervallo { da: number; a: number; corsia: number }

/** La prima corsia libera per ogni intervallo, nell'ordine di partenza. Restituisce quante corsie servono. */
function assegna(int: Intervallo[], distanza: number): number {
  const fine: number[] = [];
  for (const i of [...int].sort((x, y) => x.da - y.da || x.a - y.a)) {
    let c = fine.findIndex((f) => f + distanza < i.da);
    if (c < 0) {
      c = fine.length;
      fine.push(i.a);
    } else fine[c] = i.a;
    i.corsia = c;
  }
  return fine.length;
}

interface Capo { riga: number; x: number; alto: number; basso: number }

export function instrada(righe: readonly Riga[], cavi: readonly CavoComposto[]): Disegno {
  const n = righe.length;
  const larghezzaContenuto = Math.max(0, ...righe.map((r) => r.w));
  const capi = new Map<string, Capo>();
  righe.forEach((r, ri) => {
    for (const a of r.apparati) for (const p of a.porte) capi.set(p.id, { riga: ri, x: a.x + p.cx, alto: 0, basso: a.h });
  });

  type Piano =
    | { tipo: "corto"; id: string; collegamento: string; idA: string; idB: string; A: Capo; B: Capo; k: number; h: Intervallo; aSu: boolean; bSu: boolean }
    | { tipo: "lungo"; id: string; collegamento: string; idA: string; idB: string; A: Capo; B: Capo; sinistra: boolean; h1: Intervallo; h2: Intervallo; v: Intervallo };
  const piani: Piano[] = [];
  const corridoi: Intervallo[][] = Array.from({ length: n + 1 }, () => []);
  const bordi: { sinistra: Intervallo[]; destra: Intervallo[] } = { sinistra: [], destra: [] };
  const visti = new Set<string>();
  for (const c of cavi) {
    if (visti.has(c.id)) continue;
    let A = capi.get(c.da), B = capi.get(c.a);
    if (!A || !B) continue;
    visti.add(c.id);
    let idA = c.da, idB = c.a;
    if (A.riga > B.riga || (A.riga === B.riga && A.x > B.x)) {
      [A, B] = [B, A];
      [idA, idB] = [idB, idA];
    }
    if (B.riga - A.riga <= 1) {
      const k = A.riga + 1;
      const h: Intervallo = { da: Math.min(A.x, B.x), a: Math.max(A.x, B.x), corsia: 0 };
      corridoi[k].push(h);
      piani.push({ tipo: "corto", id: c.id, collegamento: c.collegamento, idA, idB, A, B, k, h, aSu: false, bSu: B.riga !== A.riga });
    } else {
      const sinistra = (A.x + B.x) / 2 < larghezzaContenuto / 2;
      const h1: Intervallo = sinistra ? { da: -1, a: A.x, corsia: 0 } : { da: A.x, a: larghezzaContenuto + 1, corsia: 0 };
      const h2: Intervallo = sinistra ? { da: -1, a: B.x, corsia: 0 } : { da: B.x, a: larghezzaContenuto + 1, corsia: 0 };
      const v: Intervallo = { da: A.riga + 1, a: B.riga, corsia: 0 };
      corridoi[A.riga + 1].push(h1);
      corridoi[B.riga].push(h2);
      (sinistra ? bordi.sinistra : bordi.destra).push(v);
      piani.push({ tipo: "lungo", id: c.id, collegamento: c.collegamento, idA, idB, A, B, sinistra, h1, h2, v });
    }
  }

  const corsie = corridoi.map((int) => assegna(int, DISTANZA));
  const corsieS = assegna(bordi.sinistra, 0);
  const corsieD = assegna(bordi.destra, 0);
  const hCorridoio = corsie.map((c, k) => (c === 0 ? (k === 0 || k === n ? 12 : 30) : 2 * BORDO_CORRIDOIO + CORSIA * c));
  const dx = 16 + CORSIA * corsieS;
  const larghezza = dx + larghezzaContenuto + 16 + CORSIA * corsieD;

  const yCorridoio: number[] = [];
  const yRighe: number[] = [];
  let y = 0;
  for (let k = 0; k <= n; k++) {
    yCorridoio.push(y);
    y += hCorridoio[k];
    if (k < n) {
      yRighe.push(y);
      y += righe[k].h;
    }
  }
  const yCorsia = (k: number, c: number) => yCorridoio[k] + BORDO_CORRIDOIO + CORSIA * c;
  const xBordo = (sinistra: boolean, c: number) => (sinistra ? dx - 12 - CORSIA * c : dx + larghezzaContenuto + 12 + CORSIA * c);
  const yAlto = (c: Capo) => yRighe[c.riga] + c.alto;
  const yBasso = (c: Capo) => yRighe[c.riga] + c.basso;

  const attacchi: Record<string, Punto> = {};
  const linee: Linea[] = piani.map((p) => {
    const xa = dx + p.A.x, xb = dx + p.B.x;
    if (p.tipo === "corto") {
      const ya = p.aSu ? yAlto(p.A) : yBasso(p.A);
      const yb = p.bSu ? yAlto(p.B) : yBasso(p.B);
      const yc = yCorsia(p.k, p.h.corsia);
      return { id: p.id, collegamento: p.collegamento, lungo: false, punti: [[xa, ya], [xa, yc], [xb, yc], [xb, yb]] };
    }
    const ya = yBasso(p.A), yb = yAlto(p.B);
    const y1 = yCorsia(p.A.riga + 1, p.h1.corsia), y2 = yCorsia(p.B.riga, p.h2.corsia);
    const xs = xBordo(p.sinistra, p.v.corsia);
    return { id: p.id, collegamento: p.collegamento, lungo: true, punti: [[xa, ya], [xa, y1], [xs, y1], [xs, y2], [xb, y2], [xb, yb]] };
  });
  piani.forEach((p, i) => {
    const pt = linee[i].punti;
    attacchi[p.idA] = pt[0];
    attacchi[p.idB] = pt[pt.length - 1];
  });
  return { dx, yRighe, linee, larghezza, altezza: y, attacchi };
}

/**
 * Righe e cavi entro `larghezza`, corsie di bordo comprese (Riccardo, 23/11: la tavola scorreva perché le corsie si
 * aggiungevano dopo l'a capo). Due giri: il primo conta le corsie di bordo, il secondo va a capo con la larghezza utile
 * meno quelle. Se il secondo giro chiede più corsie del primo se ne fa un terzo con le sue. Oltre resta più larga solo
 * quando un apparato da solo non ci sta.
 */
export function disponiEInstrada(apparati: readonly ApparatoComposto[], cavi: readonly CavoComposto[], larghezza: number): { righe: Riga[]; disegno: Disegno } {
  let utile = larghezza;
  let righe = disponi(apparati, utile);
  let disegno = instrada(righe, cavi);
  for (let giro = 0; giro < 2; giro++) {
    const bordi = disegno.larghezza - Math.max(0, ...righe.map((r) => r.w));
    if (Math.max(0, ...righe.map((r) => r.w)) + bordi <= larghezza) break;
    utile = Math.max(1, larghezza - bordi);
    righe = disponi(apparati, utile);
    disegno = instrada(righe, cavi);
  }
  return { righe, disegno };
}
