/**
 * Finestra «Per device» (tappa 3 del piano profili per device, Riccardo 08/11/2026, tavola oggetto 43).
 *
 * La pianificata «Per device» la lancia DA-IPAM all'ora fissata; la finestra invece la esegue la sonda, perché è lei
 * che si ferma a fine fascia e riprende alla fascia dopo da dove era. Le servono quindi gli IP: si mandano i gruppi
 * dei device confermati, ognuno col profilo della sua famiglia, e si rimandano quando una persona cambia qualcosa
 * (il giro dei minuti confronta la firma). Gli impianti viaggiano come gruppo a parte: la sonda li fa entrare solo se
 * un consenso li copre in quel momento.
 *
 * Solo Greenbone: nella finestra nuclei e moduli non partono (la finestra della sonda non li ha mai avuti).
 */
import { getHostsByNetwork } from "@/lib/db";
import { ipImpiantiDellaRete, type EdgeScanProfile } from "@/lib/vuln/edge-subnet-bridge";
import { valutaConfermate } from "./ammessi";
import { gruppiDaConfermate } from "./gruppi";
import type { Famiglia, HostPerProposta } from "./regole";
import { contesiDiRete, leggiProposte, type RigaProposta } from "./store";
import { leggiScelte, type SceltaGruppo } from "./scelte-gruppo";

export interface GruppoFinestra {
  nome: Famiglia;
  profile: EdgeScanProfile;
  ips: string[];
  impianti: boolean;
}

export interface DipendenzeGruppi {
  proposte: (networkId: number) => RigaProposta[];
  host: (networkId: number) => Array<HostPerProposta & { id: number }>;
  contesi: (networkId: number) => Set<number>;
  impianti: (networkId: number) => string[];
  scelte: (networkId: number) => SceltaGruppo[];
}

const REALI: DipendenzeGruppi = {
  proposte: leggiProposte,
  host: (n) => getHostsByNetwork(n) as ReturnType<DipendenzeGruppi["host"]>,
  contesi: (n) => contesiDiRete(n),
  impianti: ipImpiantiDellaRete,
  scelte: leggiScelte,
};

/** I gruppi da mandare alla sonda: gli stessi del lancio (stesse conferme, stesse barriere), più gli impianti. */
export function gruppiFinestra(networkId: number, famiglie: readonly Famiglia[], deps: Partial<DipendenzeGruppi> = {}): GruppoFinestra[] {
  const d = { ...REALI, ...deps };
  const confermate = d.proposte(networkId).filter((r) => r.stato !== "escluso");
  const host = new Map(d.host(networkId).map((h) => [h.id, h]));
  const { buone } = valutaConfermate(confermate, host, d.contesi(networkId), famiglie);
  const gruppi: GruppoFinestra[] = gruppiDaConfermate(buone, [], d.scelte(networkId)).map((g) => ({ nome: g.famiglia, profile: g.profile, ips: g.ips, impianti: false }));
  if (famiglie.includes("impianti")) {
    const ips = d.impianti(networkId);
    if (ips.length > 0) gruppi.push({ nome: "impianti", profile: "fast", ips, impianti: true });
  }
  return gruppi;
}

/** Firma stabile dei gruppi: stessi gruppi, stessa firma, qualunque sia l'ordine degli IP. Pura. */
export function firmaGruppi(gruppi: readonly GruppoFinestra[]): string {
  return JSON.stringify([...gruppi].sort((a, b) => a.nome.localeCompare(b.nome)).map((g) => [g.nome, g.profile, g.impianti, [...g.ips].sort()]));
}
