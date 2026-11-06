/**
 * Chi una scansione può toccare (72729, 06/11/2026; Riccardo: «non posso distruggere una rete per una va»).
 *
 * Solo gli host che una persona ha confermato nella scheda «Per device» e che oggi sono ancora quello che
 * erano: un impianto, un tipo cambiato o una conferma da rivedere restano fuori. Edge riceve questo elenco
 * e su una rete non pubblica non tocca nient'altro: niente conferme, niente scansione. Il via della persona è
 * il freno stesso. La stessa regola decide il lancio dei gruppi (`lancio.ts`), così le due strade non divergono.
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
    else if (r.famiglia === "impianti" || r.famiglia === "da_chiarire") togli(`famiglia «${ETICHETTE_FAMIGLIA[r.famiglia]}»: non si scansiona`);
    else if (r.da_rivedere) togli("la conferma è da rivedere: il tipo è cambiato");
    // La famiglia salvata è quella di quando si è confermato: si ricalcola sul dato di oggi, contesi compresi.
    // Se differisce l'host resta fuori. Non si riscrive va_proposte: la rilettura la fa una persona.
    else if (proponiProfilo(h, { conteso: contesi.has(r.host_id) }).famiglia !== r.famiglia) togli("tipo cambiato, da rivedere");
    else buone.push(r);
  }
  return { buone, tolti };
}

export function ipAmmessiDellaRete(networkId: number): string[] {
  const host = new Map((getHostsByNetwork(networkId) as Array<HostPerProposta & { id: number }>).map((h) => [h.id, h]));
  const confermate = leggiProposte(networkId).filter((r) => r.stato === "confermato");
  return valutaConfermate(confermate, host, contesiDiRete(networkId)).buone.map((r) => r.ip);
}
