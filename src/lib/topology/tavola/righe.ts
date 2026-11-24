/**
 * In che ordine e dove stanno gli apparati della tavola (spec tavola §3): per armadio, e dentro l'armadio per ruolo
 * (router e firewall, nucleo, accesso, hypervisor, il resto). Un apparato con più di 28 porte va su una riga sua; gli
 * altri si affiancano finché la riga non supera la larghezza. Più di 24 porte: due file, dispari sopra e pari sotto,
 * come sul fronte dell'apparato. Logica pura: solo misure, nessun disegno.
 */
import type { ApparatoComposto } from "./tipi";

export const GEO = {
  /** Lato del quadrato della porta. */
  porta: 24,
  /** Distanza fra due colonne o due file di porte. */
  passo: 28,
  /** Nome, modello e IP in cima al telaio. */
  testata: 50,
  /** La fascia sotto le porte con le destinazioni ruotate di 90°. */
  etichette: 124,
  margine: 10,
  /** La fascia col nome dell'armadio sopra la sua prima riga. */
  testaArmadio: 34,
  /** L'elenco delle VM sotto le etichette: colonna, riga, titolo. */
  vmColonna: 216,
  vmRiga: 20,
  vmTesta: 28,
  /** Spazio fra due apparati della stessa riga. */
  spazio: 24,
  larghezzaMin: 190,
  /** Oltre: riga sua. */
  porteRigaSua: 28,
  /** Oltre: due file. */
  porteDueFile: 24,
} as const;

export interface PortaPosta {
  id: string;
  /** Posizione del quadrato rispetto al telaio. */
  x: number;
  y: number;
  /** Centro della colonna: da qui scende l'etichetta e parte il cavo. */
  cx: number;
  /** Dove sta l'etichetta (centro x, rispetto al telaio): con due file, due etichette affiancate nella colonna. */
  ex: number;
}

export interface ApparatoPosto {
  nodo: string;
  x: number;
  w: number;
  h: number;
  file: 1 | 2;
  porte: PortaPosta[];
  /** Quante colonne ha l'elenco delle VM (0 = nessuna VM). */
  vmColonne?: number;
}

export interface Riga {
  armadio: number | null;
  /** La prima riga di un armadio porta il suo nome. */
  primaDellArmadio: boolean;
  apparati: ApparatoPosto[];
  /** Altezza della fascia col nome dell'armadio in cima alla riga (compresa in `h`); assente = 0. */
  testa?: number;
  h: number;
  w: number;
}

/** L'ordine della tavola: armadio per nome (senza armadio in fondo), ruolo, nome. */
export function ordina(apparati: readonly ApparatoComposto[]): ApparatoComposto[] {
  return [...apparati].sort((a, b) =>
    Number(a.rackId === null) - Number(b.rackId === null)
    || (a.armadio ?? "").localeCompare(b.armadio ?? "", "it", { numeric: true })
    || (a.rackId ?? 0) - (b.rackId ?? 0)
    || a.rango - b.rango
    || a.nome.localeCompare(b.nome, "it", { numeric: true }));
}

export function posaApparato(a: ApparatoComposto): Omit<ApparatoPosto, "x"> {
  const n = a.porte.length;
  const file: 1 | 2 = n > GEO.porteDueFile ? 2 : 1;
  const colonne = Math.max(1, Math.ceil(n / file));
  const porte = a.porte.map((p, i): PortaPosta => {
    const col = file === 2 ? Math.floor(i / 2) : i;
    const fila = file === 2 ? i % 2 : 0;
    const cx = GEO.margine + col * GEO.passo + GEO.porta / 2;
    return { id: p.id, x: cx - GEO.porta / 2, y: GEO.testata + fila * GEO.passo, cx, ex: file === 2 ? cx + (fila === 0 ? -7 : 7) : cx };
  });
  const nVm = a.vms?.length ?? 0;
  const vmColonne = nVm === 0 ? 0 : Math.max(Math.min(4, Math.ceil(nVm / 5)), Math.min(4, Math.floor((colonne * GEO.passo) / GEO.vmColonna)));
  return {
    nodo: a.nodo,
    w: Math.max(GEO.larghezzaMin, colonne * GEO.passo + 2 * GEO.margine, vmColonne * GEO.vmColonna + 2 * GEO.margine),
    h: GEO.testata + file * GEO.passo + GEO.etichette + GEO.margine + (nVm === 0 ? 0 : GEO.vmTesta + Math.ceil(nVm / vmColonne) * GEO.vmRiga),
    file,
    vmColonne,
    porte,
  };
}

/** Le righe della tavola entro `larghezza` (px): una riga non mescola due armadi. */
export function disponi(apparati: readonly ApparatoComposto[], larghezza: number): Riga[] {
  const righe: Riga[] = [];
  let cur: Riga | null = null;
  // Senza nessun armadio definito non c'è niente da intitolare.
  const conArmadi = apparati.some((a) => a.rackId !== null);
  let armadioPrima: number | null | undefined = undefined;
  for (const a of ordina(apparati)) {
    const posto = posaApparato(a);
    const nuovoArmadio = a.rackId !== armadioPrima;
    const sua = a.porte.length > GEO.porteRigaSua;
    const nonCi = cur !== null && cur.w + GEO.spazio + posto.w > larghezza;
    if (cur === null || nuovoArmadio || sua || nonCi || cur.apparati.length === 1 && cur.apparati[0].porte.length > GEO.porteRigaSua) {
      cur = { armadio: a.rackId, primaDellArmadio: nuovoArmadio, apparati: [], testa: conArmadi && nuovoArmadio ? GEO.testaArmadio : 0, h: 0, w: 0 };
      righe.push(cur);
    }
    armadioPrima = a.rackId;
    const x = cur.apparati.length === 0 ? 0 : cur.w + GEO.spazio;
    cur.apparati.push({ ...posto, x });
    cur.w = x + posto.w;
    cur.h = Math.max(cur.h, posto.h + (cur.testa ?? 0));
  }
  return righe;
}
