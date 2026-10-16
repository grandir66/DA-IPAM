// L'impronta del modello di T1 (piano di T2, Task 13): un'unica funzione per le prove di tappa e per chi la calcola sul commit di
// PRIMA di T2. Importa solo codice che esisteva già prima di T2 (il modello di T1 e le sue prove), così lo stesso file si copia
// in un checkout vecchio e dà le stesse impronte: `node --import tsx <script che chiama improntaT1>` (vedi il commento in
// cavi-ombra.test.ts, «letture spente»).
import crypto from "node:crypto";
import { buildTopologyModel } from "@/lib/topology/model";
import type { TopologyModelInput } from "@/lib/topology/model-types";
import { autoVisible, buildTree, proposeHead } from "@/lib/topology/tree";

/** JSON stabile: Map e Set diventano elenchi di voci, l'ordine è quello di inserimento (il modello è deterministico, I39). */
export function serializza(x: unknown): string {
  return JSON.stringify(x, (_k, v: unknown) => (v instanceof Map ? { __map: [...v.entries()] } : v instanceof Set ? { __set: [...v.values()] } : v));
}

/** SHA-256 abbreviato a 24 cifre esadecimali: 96 bit bastano a vedere un bit che cambia, e stanno in una riga. */
export function impronta(x: unknown): string {
  return crypto.createHash("sha256").update(serializza(x)).digest("hex").slice(0, 24);
}

/** Il modello di T1 e l'albero della mappa automatica, in due impronte: ciò che oggi sta a schermo. */
export function improntaT1(input: TopologyModelInput): { modello: string; albero: string } {
  const m = buildTopologyModel(input);
  const testa = proposeHead(m);
  return { modello: impronta(m), albero: impronta(buildTree(m, autoVisible(m), testa ? [testa] : [])) };
}
