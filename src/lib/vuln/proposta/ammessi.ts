/**
 * Chi una scansione può toccare (72729, 06/11/2026; Riccardo: «non posso distruggere una rete per una va»).
 *
 * Rovesciata da Riccardo l'08/11/2026 (tavola 40-44): di serie entrano tutti gli host della proposta che una persona
 * non ha escluso; gli impianti mai (solo col consenso, gruppo a parte). Edge riceve questo elenco e su una rete non
 * pubblica non tocca nient'altro: un host nuovo, non ancora in proposta, resta fuori fino alla rigenerazione. La
 * stessa regola decide il lancio dei gruppi (`lancio.ts`), così le due strade non divergono.
 */
import { getHostsByNetwork } from "@/lib/db";
import { eImpianto } from "@/lib/vuln/impianti-in-rete";
import { ETICHETTE_FAMIGLIA, proponiProfilo, type Famiglia, type HostPerProposta } from "./regole";
import { contesiDiRete, leggiProposte, type RigaProposta } from "./store";

export interface TolloDalLancio {
  host_id: number;
  ip: string;
  motivo: string;
}

export function valutaConfermate(
  confermate: readonly RigaProposta[],
  host: ReadonlyMap<number, HostPerProposta>,
  contesi: ReadonlySet<number>,
  famiglie?: readonly Famiglia[],
): { buone: RigaProposta[]; tolti: TolloDalLancio[] } {
  const tolti: TolloDalLancio[] = [];
  const buone: RigaProposta[] = [];
  for (const r of confermate) {
    const h = host.get(r.host_id);
    if (famiglie && !famiglie.includes(r.famiglia)) continue;
    const togli = (motivo: string) => tolti.push({ host_id: r.host_id, ip: r.ip, motivo });
    if (!h) togli("host non più presente nella rete");
    else if (eImpianto(h)) togli("è un impianto o un apparato di campo: non si scansiona");
    else if (r.famiglia === "impianti") togli(`famiglia «${ETICHETTE_FAMIGLIA[r.famiglia]}»: solo col consenso`);
    else if (proponiProfilo(h, { conteso: contesi.has(r.host_id) }).famiglia === "impianti") togli("oggi risulta un impianto: solo col consenso");
    // Riccardo, 08/11/2026: una scelta vale fino a modifica manuale. Un tipo cambiato resta un avviso nella pagina,
    // non toglie l'host; resta il freno degli impianti, qui sopra e sulla sonda.
    else buone.push(r);
  }
  return { buone, tolti };
}

export function ipAmmessiDellaRete(networkId: number): string[] {
  const host = new Map((getHostsByNetwork(networkId) as Array<HostPerProposta & { id: number }>).map((h) => [h.id, h]));
  const incluse = leggiProposte(networkId).filter((r) => r.stato !== "escluso");
  return valutaConfermate(incluse, host, contesiDiRete(networkId)).buone.map((r) => r.ip);
}
