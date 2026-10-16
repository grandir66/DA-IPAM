/**
 * «Ignora» per cavo (spec topologia §13.9, D3). Una correzione «ignora» toglie solo il cavo con quelle due porte,
 * confrontate per chiave (dopo il completamento dell'uplink, §13.7.1 passo 3a): una porta vuota vale per qualunque porta
 * su quel lato; con tutte e due le porte vuote toglie solo un cavo senza porte fra quei due oggetti (l'uplink senza fili
 * di un access point in mesh), mai un cavo con le porte. Vale per ogni fonte di quel cavo: vicini, uplink,
 * tabella MAC, ripiego del router e VM (la regola I-3 della fase 2b, prima per coppia). Incidente del 14/10: un «Ignora»
 * sulla linea cucita «porta 10 ↔ ether8» toglieva la coppia, e con lei il cavo vero a 10G. Le correzioni salvate prima
 * non si convertono (D3): quelle che non tolgono niente sono orfane, si vedono in «Dati della mappa» e le toglie una
 * persona. Logica pura.
 */
import { normale, type Porta } from "@/lib/topology/cavi/porte";
import type { LinkOverrideRow } from "@/lib/topology/model-types";
import { canonical, nodeFor, type NodeIndex } from "@/lib/topology/node-index";

export interface RegolaIgnora { id: number; a: string; aPorta: Porta | null; b: string; bPorta: Porta | null }

export interface Ignorati {
  regole: readonly RegolaIgnora[];
  /** Le regole che hanno tolto qualcosa: le altre «ignora» sono le correzioni orfane. Si riempie mentre si calcola il modello. */
  usate: Set<number>;
}

export function nessunIgnorato(): Ignorati {
  return { regole: [], usate: new Set() };
}

/**
 * Le correzioni «ignora», coi nodi passati dall'id canonico (un host poi promosso è l'apparato) e le porte con la chiave.
 * `segmenti: true` solo dal modello per cavo (§13.9, «Togli ‹A› dal segmento»): un capo «seg:…» resta com'è, con la porta
 * null, e chi chiama lo risolve nel segmento di oggi (alias dei membri). Il modello di T1 non lo passa: una correzione su un
 * segmento resta fuori dalle sue regole come prima (e orfana per lui).
 */
export function regoleIgnora(overrides: readonly LinkOverrideRow[], idx: NodeIndex, porta: (nodo: string, nome: string) => Porta | null,
  opz: { segmenti?: boolean } = {}): Ignorati {
  const regole: RegolaIgnora[] = [];
  const diSegmento = (id: string): boolean => opz.segmenti === true && id.startsWith("seg:");
  for (const o of [...overrides].sort((x, y) => x.id - y.id)) {
    if (o.action !== "ignore") continue;
    const a = diSegmento(o.a_node) ? o.a_node : nodeFor(idx, canonical(idx, o.a_node));
    const b = diSegmento(o.b_node) ? o.b_node : nodeFor(idx, canonical(idx, o.b_node));
    if (!a || !b || a === b) continue;
    regole.push({ id: o.id, a, aPorta: diSegmento(a) ? null : porta(a, o.a_port), b, bPorta: diSegmento(b) ? null : porta(b, o.b_port) });
  }
  return { regole, usate: new Set() };
}

/** Un lato: la porta vuota della regola vale per ogni porta; una porta della regola vuole la stessa porta del cavo. */
function stessoLato(regola: Porta | null, cavo: Pick<Porta, "chiave" | "nome"> | null): boolean {
  if (!regola) return true;
  if (!cavo || cavo.nome.trim() === "") return false;
  return regola.chiave !== null && cavo.chiave !== null ? regola.chiave === cavo.chiave : normale(regola.nome) === normale(cavo.nome);
}

const vuota = (p: Pick<Porta, "nome"> | null): boolean => !p || p.nome.trim() === "";

/** Il cavo x:xPorta ↔ y:yPorta è ignorato a mano? Se sì, la regola si segna come usata (non è orfana). */
export function ignorato(ig: Ignorati, x: string, xPorta: Pick<Porta, "chiave" | "nome"> | null, y: string, yPorta: Pick<Porta, "chiave" | "nome"> | null): boolean {
  let tolto = false;
  for (const r of ig.regole) {
    const coppia = (r.a === x && r.b === y) || (r.a === y && r.b === x);
    // Senza porte (revisione finale di T1): toglie solo un cavo senza porte fra quei due oggetti, l'uplink senza fili di un
    // access point in mesh. Prima era sempre orfana: su una linea senza porte «Ignora questo cavo…» scriveva una correzione
    // che non toglieva niente, e «Scegli il cavo da ignorare…» riproponeva lo stesso cavo. Un cavo con le porte resta: una
    // correzione di prima senza porte non toglie un cavo vero.
    const senzaPorte = !r.aPorta && !r.bPorta;
    const diritto = !senzaPorte && r.a === x && r.b === y && stessoLato(r.aPorta, xPorta) && stessoLato(r.bPorta, yPorta);
    const rovescio = !senzaPorte && r.a === y && r.b === x && stessoLato(r.aPorta, yPorta) && stessoLato(r.bPorta, xPorta);
    if (diritto || rovescio || (senzaPorte && coppia && vuota(xPorta) && vuota(yPorta))) {
      ig.usate.add(r.id);
      tolto = true;
    }
  }
  return tolto;
}

/**
 * La porta `porta` di `nodo` è quella di un cavo ignorato verso `altro`? Per la tabella MAC, il ripiego del router e le VM,
 * che sanno una porta sola (spec §13.9: «le porte di un cavo ignorato restano occupate verso quell'oggetto»). La porta
 * dell'altro capo della regola non conta: su una linea LLDP o uplink la pagina scrive tutte e due le porte, e con
 * `ignorato(…, null)` la porta restava libera, così il MAC di accesso A sulla porta 9 di core 1 rifaceva subito la linea
 * (revisione del piano, 15/10). Se sì, la regola si segna come usata.
 */
export function portaOccupata(ig: Ignorati, nodo: string, porta: Pick<Porta, "chiave" | "nome"> | null, altro: string): boolean {
  let occupata = false;
  for (const r of ig.regole) {
    // Senza porte toglie solo un cavo senza porte (`ignorato`): tabella MAC, ripiego e VM sanno sempre una porta.
    if (!r.aPorta && !r.bPorta) continue;
    const diritto = r.a === nodo && r.b === altro && stessoLato(r.aPorta, porta);
    const rovescio = r.b === nodo && r.a === altro && stessoLato(r.bPorta, porta);
    if (diritto || rovescio) {
      ig.usate.add(r.id);
      occupata = true;
    }
  }
  return occupata;
}

/** Gli id delle correzioni «ignora» che non tolgono niente (C5): anche quelle che citano un oggetto che non c'è più. */
export function correzioniOrfane(ig: Ignorati, overrides: readonly LinkOverrideRow[]): number[] {
  return overrides.filter((o) => o.action === "ignore" && !ig.usate.has(o.id)).map((o) => o.id).sort((x, y) => x - y);
}
