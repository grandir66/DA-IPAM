/**
 * La misura delle unioni a mano sulle copie (piano 2026-10-16, Task 3 Step 4 e Task 7; ADR 0021), pura. `misura-cavi --unisci`
 * e `--separa` aggiungono le righe in memoria all'ingresso letto (nessuno script scrive le tabelle nel DB di un cliente: «Solo a
 * mano»), così valgono per il modello di T1, per la mappa per cavo e per la traccia; il confronto dice che cosa cambierebbe;
 * le fusioni automatiche per motivo dicono che cosa «Separa…» potrebbe togliere.
 */
import type { TopologyModel, TopologyModelInput } from "@/lib/topology/model-types";
import type { NodeIndex } from "@/lib/topology/node-index";
import { ancoraDi } from "@/lib/topology/unioni";
import type { ComeFuso } from "@/lib/topology/unioni-tipi";

/**
 * L'ingresso con le unioni e le separazioni in memoria. Ogni gruppo di `unisci` è un gruppo negativo (-1, -2, …: nel DB i gruppi
 * sono positivi, non si confondono) coi membri scritti come li scriverebbe la rotta (l'ancora: per un apparato il suo host); le
 * coppie di `separa` così come sono. Si aggiungono alle righe che l'ingresso ha già. Senza niente da aggiungere, l'ingresso è
 * quello di prima (stesso oggetto: le impronte non cambiano).
 */
export function aggiungiScelte(input: TopologyModelInput, unisci: string[][], separa: Array<[string, string]>): TopologyModelInput {
  if (unisci.length === 0 && separa.length === 0) return input;
  const unioni = [
    ...(input.unioni ?? []),
    ...unisci.flatMap((g, i) => [...new Set(g.map((id) => ancoraDi(input, id) ?? id))].map((membro) => ({ gruppo: -(i + 1), membro }))),
  ];
  const separazioni = [...(input.separazioni ?? []), ...separa.map(([membro, altro]) => ({ membro, altro }))];
  return { ...input, ...(unioni.length > 0 ? { unioni } : {}), ...(separazioni.length > 0 ? { separazioni } : {}) };
}

const coppia = (a: string, b: string): string => (a < b ? `${a}–${b}` : `${b}–${a}`);

/**
 * Il modello senza e con le righe in memoria. `ripuntati`: linee del «dopo» con un capo che nel «prima» era un oggetto suo e ora
 * è un alias (i collegamenti passati al nodo unito). `coppieScomparse`: coppie del «prima», passate dal `canonical` del «dopo»,
 * che il «dopo» non ha più, esclusi gli `autoanelli` (i due capi finiti nello stesso nodo, come un collegamento a mano fra due
 * membri): ognuna è un collegamento perso, da spiegare prima del rilascio.
 */
export function confrontoUnione(prima: TopologyModel, dopo: TopologyModel): {
  nodiPrima: number; nodiDopo: number; ripuntati: number; coppieScomparse: string[]; autoanelli: number;
} {
  const canon = (id: string): string => dopo.canonical[id] ?? id;
  const eraSuo = (id: string): boolean => (prima.canonical[id] ?? id) === id;
  const nelDopo = new Set(dopo.links.map((l) => coppia(l.a, l.b)));
  const ripuntati = new Set<string>(), scomparse = new Set<string>(), anelli = new Set<string>();
  for (const l of prima.links) {
    const a = canon(l.a), b = canon(l.b);
    if (a === b) { anelli.add(coppia(l.a, l.b)); continue; }
    const k = coppia(a, b);
    if (!nelDopo.has(k)) { scomparse.add(k); continue; }
    if ((a !== l.a && eraSuo(l.a)) || (b !== l.b && eraSuo(l.b))) ripuntati.add(k);
  }
  return {
    nodiPrima: prima.nodes.length, nodiDopo: dopo.nodes.length, ripuntati: ripuntati.size,
    coppieScomparse: [...scomparse].sort(), autoanelli: anelli.size,
  };
}

/** Quanti host stanno nel nodo di un altro oggetto, per motivo (le regole di node-index.ts, e le unioni a mano). */
export function fusioniPerCome(idx: NodeIndex): Record<ComeFuso, number> {
  const conto: Record<ComeFuso, number> = { host_dell_apparato: 0, stesso_ip: 0, stesso_apparato_fisico: 0, stesso_mac: 0, stesso_nome: 0, a_mano: 0 };
  for (const c of idx.come.values()) conto[c]++;
  return conto;
}
