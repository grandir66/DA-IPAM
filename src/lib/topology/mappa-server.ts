/**
 * La mappa che la pagina vede (spec topologia §13.11.4, T3.7), lato server: legge il DB del cliente (import statico di
 * db-tenant, ADR 0002; nessun componente della pagina importa questo modulo). Interruttore `topologia.mappa.cavi` spento — o
 * assente, o rovinato — : il modello di T1 com'era, senza leggere niente di T3. Acceso: la mappa per cavo (cavi/mappa.ts). Se il
 * calcolo nuovo cade, la mappa di prima, detta nel journal e a schermo (Caso 3 del piano): mai una pagina bianca, mai un ripiego
 * muto. Le fonti si possono passare (le prove contano le letture di T3); la rotta usa sempre quelle del DB.
 */
import { getAutoMap, getIngressoCavi, getTopologyModelInput } from "@/lib/db-tenant";
import { candidatiPerPorta, modelloMappaDaIngresso, nomiDellaMappa } from "@/lib/topology/cavi/mappa";
import type { IngressoCavi } from "@/lib/topology/cavi/prove";
import { mappaCaviAccesa } from "@/lib/topology/letture/mappa";
import { buildTopologyModel } from "@/lib/topology/model";
import type { CandidatoPorta, TopologyModel, TopologyModelInput } from "@/lib/topology/model-types";

export interface ModelloDellaMappa { model: TopologyModel; mappa: "oggi" | "cavi"; errore: string | null; nowMs: number }

/** Da dove la mappa legge: l'interruttore, l'ingresso del modello di oggi, quello del modello per cavo, la testa scelta. */
export interface FontiDellaMappa {
  accesa: () => boolean;
  ingressoT1: (staleDays: number, nowMs: number) => TopologyModelInput;
  ingressoCavi: (staleDays: number, nowMs: number) => IngressoCavi;
  /** La testa scelta da un admin per la mappa automatica (id salvato, anche di prima di una fusione). */
  testa: () => string | null;
}

export const FONTI_DELLA_MAPPA: FontiDellaMappa = {
  accesa: mappaCaviAccesa,
  ingressoT1: (staleDays, nowMs) => getTopologyModelInput(staleDays, nowMs),
  ingressoCavi: (staleDays, nowMs) => getIngressoCavi(staleDays, nowMs),
  testa: () => getAutoMap()?.head_node ?? null,
};

/** La scritta della pagina quando la mappa nuova non si è potuta calcolare (`mappaErrore` della rotta del modello). */
export const MAPPA_NON_CALCOLATA = "La mappa nuova non si è potuta calcolare: si vede quella di prima.";

export function modelloDellaMappa(staleDays: number, nowMs: number = Date.now(), fonti: FontiDellaMappa = FONTI_DELLA_MAPPA): ModelloDellaMappa {
  // Spento (o assente, o rovinato): la mappa di T1 com'era, senza leggere niente di T3 (spec §13.11.4, T3.7; R7).
  if (!fonti.accesa()) {
    const input = fonti.ingressoT1(staleDays, nowMs);
    return { model: buildTopologyModel(input), mappa: "oggi", errore: null, nowMs: input.nowMs };
  }
  try {
    // Anche la lettura di T3 sta qui dentro: una tabella dei fatti illeggibile non deve spegnere tutta la pagina.
    const ing = fonti.ingressoCavi(staleDays, nowMs);
    const { mappa } = modelloMappaDaIngresso(ing, { testaScelta: fonti.testa() });
    return { model: mappa, mappa: "cavi", errore: null, nowMs: ing.t1.nowMs };
  } catch (e) {
    // Caso 3: la mappa di prima, riletta da capo (nessuno stato del calcolo caduto), detta nel journal e a schermo.
    console.error(`[topology] mappa nuova non calcolata, si mostra quella di prima: ${e instanceof Error ? e.message : "errore"}`);
    const input = fonti.ingressoT1(staleDays, nowMs);
    return { model: buildTopologyModel(input), mappa: "oggi", errore: MAPPA_NON_CALCOLATA, nowMs: input.nowMs };
  }
}

export const CANDIDATI_SOLO_ACCESA = "«Candidati per porta» c'è solo con la mappa nuova accesa";

export type EsitoCandidati = { ok: true; righe: CandidatoPorta[]; altri: number } | { ok: false; status: 409; error: string };

/**
 * «Candidati per porta» di un oggetto (§13.4.6; piano di T3, «Scelte» 11: a richiesta, con una rotta sua, solo con la mappa
 * accesa). Lo stesso giro della rotta del modello (stessa testa), poi le righe dell'oggetto; un id fuso o il membro di un segmento
 * valgono per l'oggetto di oggi. Un errore del calcolo esce: la rotta lo dice (500), non mostra un elenco vuoto.
 */
export function candidatiDellaMappa(staleDays: number, nodo: string, nowMs: number = Date.now(), fonti: FontiDellaMappa = FONTI_DELLA_MAPPA): EsitoCandidati {
  if (!fonti.accesa()) return { ok: false, status: 409, error: CANDIDATI_SOLO_ACCESA };
  const { m, mappa } = modelloMappaDaIngresso(fonti.ingressoCavi(staleDays, nowMs), { testaScelta: fonti.testa() });
  return { ok: true, ...candidatiPerPorta(m, mappa.canonical[nodo] ?? nodo, nomiDellaMappa(mappa)) };
}
