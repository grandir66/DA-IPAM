/**
 * Lancio dei gruppi dalle proposte confermate (piano profili-per-device, Passo 4, 06/11/2026).
 * Si chiama solo a mano, dalla rotta `POST /api/networks/[id]/proposte-va/lancia`: nessun automatismo.
 *
 * Perché rilegge tutto: al 72729 nove PLC sono spariti dentro una scansione della loro rete (05-06/11/2026;
 * la causa NON è accertata). Le conferme si leggono dal database, mai dal client, e gli host si
 * rileggono com'è oggi: un impianto confermato per errore, o diventato impianto dopo la conferma, si
 * toglie qui prima del lancio. È la seconda barriera dopo `gruppiDaConfermate`; il freno `protetti`
 * di Edge resta sotto e non dipende da questo file.
 *
 * I gruppi partono uno dopo l'altro: la coda è di Edge (una scansione alla volta). Al primo esito che non
 * sa dire «parte» o «rifiutato per questo gruppo» ci si ferma: niente altro viene lanciato, e i gruppi
 * non tentati si elencano come tali.
 */
import { getHostsByNetwork } from "@/lib/db";
import { eImpianto } from "@/lib/vuln/impianti-in-rete";
import type { EdgeAssessmentProfile } from "@/lib/vuln/edge-profiles";
import { avviaGruppoEdge } from "@/lib/vuln/edge-subnet-bridge";
import { getActiveEdgeScanner } from "@/lib/vuln/edge-scanner-db";
import { listEdgeProfiles } from "@/lib/vuln/scanner-edge-client";
import type { EsitoGruppoEdge, GruppoPerEdge } from "@/lib/vuln/gruppi-edge";
import { gruppiDaConfermate, type GruppoDaLanciare } from "./gruppi";
import { ETICHETTE_FAMIGLIA } from "./regole";
import { leggiProposte, type RigaProposta } from "./store";

export interface DipendenzeLancio {
  proposte: (networkId: number) => RigaProposta[];
  host: (networkId: number) => Array<Parameters<typeof eImpianto>[0] & { id: number }>;
  catalogo: () => Promise<{ profili: EdgeAssessmentProfile[]; avviso: string | null }>;
  avvia: (networkId: number, gruppo: GruppoPerEdge) => Promise<EsitoGruppoEdge>;
}

export interface TolloDalLancio {
  host_id: number;
  ip: string;
  motivo: string;
}

export type EsitoGruppoLancio = EsitoGruppoEdge | { stato: "non_tentato"; messaggio: string };

export interface EsitoLancio {
  gruppi: Array<GruppoDaLanciare & { esito: EsitoGruppoLancio }>;
  /** Host confermati che NON sono entrati in nessun gruppo, col motivo. */
  tolti: TolloDalLancio[];
  avvisi: string[];
  /** true se un esito ha fermato il lancio (da aggiornare, non so, guasto): i gruppi dopo sono `non_tentato`. */
  fermato: boolean;
}

async function catalogoDaEdge(): Promise<{ profili: EdgeAssessmentProfile[]; avviso: string | null }> {
  const scanner = getActiveEdgeScanner();
  if (!scanner || scanner.enabled !== 1) return { profili: [], avviso: "Sonda non configurata: nessun profilo assessment letto" };
  try {
    return { profili: (await listEdgeProfiles(scanner)).profiles, avviso: null };
  } catch (e) {
    return { profili: [], avviso: `Profili assessment non letti dalla sonda (${e instanceof Error ? e.message : "errore"}): i gruppi partono senza assessment` };
  }
}

const REALI: DipendenzeLancio = {
  proposte: leggiProposte,
  host: (n) => getHostsByNetwork(n) as ReturnType<DipendenzeLancio["host"]>,
  catalogo: catalogoDaEdge,
  avvia: avviaGruppoEdge,
};

/** Dopo questi esiti si va avanti col gruppo dopo: è andato, o Edge ha rifiutato proprio quel gruppo. */
const CONTINUA = new Set<EsitoGruppoEdge["stato"]>(["lanciato", "non_partito", "rifiutato"]);

export async function lanciaGruppiConfermati(networkId: number, deps: Partial<DipendenzeLancio> = {}): Promise<EsitoLancio> {
  const d = { ...REALI, ...deps };
  const confermate = d.proposte(networkId).filter((r) => r.stato === "confermato");
  const host = new Map(d.host(networkId).map((h) => [h.id, h]));

  const tolti: TolloDalLancio[] = [];
  const buone: RigaProposta[] = [];
  for (const r of confermate) {
    const h = host.get(r.host_id);
    const togli = (motivo: string) => tolti.push({ host_id: r.host_id, ip: r.ip, motivo });
    if (!h) togli("host non più presente nella rete");
    else if (eImpianto(h)) togli("è un impianto o un apparato di campo: non si scansiona");
    else if (r.famiglia === "impianti" || r.famiglia === "da_chiarire") togli(`famiglia «${ETICHETTE_FAMIGLIA[r.famiglia]}»: non si scansiona`);
    else if (r.da_rivedere) togli("la conferma è da rivedere: il tipo è cambiato");
    else buone.push(r);
  }

  const avvisi: string[] = [];
  const { profili, avviso } = await d.catalogo();
  if (avviso) avvisi.push(avviso);
  const gruppi = gruppiDaConfermate(buone, profili);
  if (gruppi.length === 0) avvisi.push("Nessuna proposta confermata da lanciare.");

  const esiti: EsitoLancio["gruppi"] = [];
  let motivoStop: string | null = null;
  for (const g of gruppi) {
    if (motivoStop !== null) {
      esiti.push({ ...g, esito: { stato: "non_tentato", messaggio: motivoStop } });
      continue;
    }
    const perEdge: GruppoPerEdge = {
      ips: g.ips, profile: g.profile, nuclei_profilo: g.nuclei_profilo, assessment_profile_id: g.assessment_profile_id,
    };
    const esito = await d.avvia(networkId, perEdge);
    esiti.push({ ...g, esito });
    if (!CONTINUA.has(esito.stato)) {
      motivoStop = `non tentato: il gruppo «${ETICHETTE_FAMIGLIA[g.famiglia]}» si è fermato (${esito.stato})`;
    }
  }
  return { gruppi: esiti, tolti, avvisi, fermato: motivoStop !== null };
}
