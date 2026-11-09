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
import type { EdgeAssessmentProfile } from "@/lib/vuln/edge-profiles";
import { avviaGruppoEdge, ipImpiantiDellaRete } from "@/lib/vuln/edge-subnet-bridge";
import { getActiveEdgeScanner } from "@/lib/vuln/edge-scanner-db";
import { listEdgeProfiles } from "@/lib/vuln/scanner-edge-client";
import type { EsitoGruppoEdge, GruppoPerEdge } from "@/lib/vuln/gruppi-edge";
import { valutaConfermate, type TolloDalLancio } from "./ammessi";
import { gruppiDaConfermate, type GruppoDaLanciare } from "./gruppi";
import { ETICHETTE_FAMIGLIA, type Famiglia, type HostPerProposta } from "./regole";
import { contesiDiRete, leggiProposte, registraGruppiLanciati, type GruppoLanciato, type RigaProposta } from "./store";
import { leggiScelte, type SceltaGruppo } from "./scelte-gruppo";

export interface DipendenzeLancio {
  proposte: (networkId: number) => RigaProposta[];
  host: (networkId: number) => Array<HostPerProposta & { id: number }>;
  /** Host con fonti in disaccordo, per ricalcolare la famiglia sul dato di oggi. */
  contesi: (networkId: number) => Set<number>;
  /** `errore` = la lettura è fallita: il lancio non parte. `profili` vuoto senza errore = catalogo davvero vuoto. */
  catalogo: () => Promise<{ profili: EdgeAssessmentProfile[]; avviso: string | null; errore?: string }>;
  avvia: (networkId: number, gruppo: GruppoPerEdge) => Promise<EsitoGruppoEdge>;
  /** Ricorda quale scansione è quale gruppo, per l'avanzamento gruppo per gruppo. */
  registra: (networkId: number, gruppi: Array<Pick<GruppoLanciato, "scan_id" | "famiglia" | "device">>, il: string) => void;
  /** Passo 9: gli impianti della rete; la sonda tiene solo quelli del consenso valido. */
  impianti: (networkId: number) => string[];
  /** 09/11/2026: la scelta per gruppo della rete (tavola 45-48). */
  scelte: (networkId: number) => SceltaGruppo[];
}

export type EsitoGruppoLancio = EsitoGruppoEdge | { stato: "non_tentato"; messaggio: string };

export interface EsitoLancio {
  gruppi: Array<GruppoDaLanciare & { esito: EsitoGruppoLancio }>;
  /** Host confermati che NON sono entrati in nessun gruppo, col motivo. */
  tolti: TolloDalLancio[];
  avvisi: string[];
  /** Il lancio non è partito perché una lettura necessaria è fallita (catalogo assessment): nessun gruppo tentato. */
  errore: string | null;
  /** true se un esito ha fermato il lancio (da aggiornare, non so, guasto): i gruppi dopo sono `non_tentato`. */
  fermato: boolean;
}

async function catalogoDaEdge(): Promise<{ profili: EdgeAssessmentProfile[]; avviso: string | null; errore?: string }> {
  const scanner = getActiveEdgeScanner();
  if (!scanner || scanner.enabled !== 1) return { profili: [], avviso: null, errore: "Sonda non configurata o disabilitata: nessun profilo assessment letto" };
  try {
    return { profili: (await listEdgeProfiles(scanner)).profiles, avviso: null };
  } catch (e) {
    // Un errore non è un catalogo vuoto: senza sapere quali profili ha la sonda il lancio non parte.
    return { profili: [], avviso: null, errore: `Profili assessment non letti dalla sonda (${e instanceof Error ? e.message : "errore"}): il lancio non parte` };
  }
}

const REALI: DipendenzeLancio = {
  proposte: leggiProposte,
  host: (n) => getHostsByNetwork(n) as ReturnType<DipendenzeLancio["host"]>,
  contesi: (n) => contesiDiRete(n),
  catalogo: catalogoDaEdge,
  avvia: avviaGruppoEdge,
  registra: registraGruppiLanciati,
  impianti: ipImpiantiDellaRete,
  scelte: leggiScelte,
};

/** Dopo questi esiti si va avanti col gruppo dopo: è andato, o Edge ha rifiutato proprio quel gruppo. */
const CONTINUA = new Set<EsitoGruppoEdge["stato"]>(["lanciato", "non_partito", "rifiutato", "gia_in_corso"]);

/** `famiglie`: i gruppi spuntati nella pagina (la rotta li pretende); le altre famiglie non partono. */
export async function lanciaGruppiConfermati(
  networkId: number,
  deps: Partial<DipendenzeLancio> = {},
  opzioni: { famiglie?: readonly Famiglia[]; chi?: string } = {},
): Promise<EsitoLancio> {
  const d = { ...REALI, ...deps };
  const confermate = d.proposte(networkId).filter((r) => r.stato !== "escluso");
  const host = new Map(d.host(networkId).map((h) => [h.id, h]));

  const { buone, tolti } = valutaConfermate(confermate, host, d.contesi(networkId), opzioni.famiglie);

  const avvisi: string[] = [];
  let profili: EdgeAssessmentProfile[] = [];
  if (buone.length > 0) {
    const cat = await d.catalogo();
    if (cat.errore) return { gruppi: [], tolti, avvisi, errore: cat.errore, fermato: true };
    profili = cat.profili;
    if (cat.avviso) avvisi.push(cat.avviso);
    if (profili.length === 0) avvisi.push("Il catalogo dei profili assessment della sonda è vuoto: i gruppi partono senza assessment.");
  }
  const gruppi: Array<GruppoDaLanciare & { anche_impianti?: boolean }> = gruppiDaConfermate(buone, profili, d.scelte(networkId));
  for (const g of gruppi) if (g.avviso) avvisi.push(`${ETICHETTE_FAMIGLIA[g.famiglia]}: ${g.avviso}`);
  // Passo 9 (Riccardo, 08/11/2026): gli impianti partono solo se chiesti, col consenso valido della rete, e solo con
  // Greenbone Veloce. Il consenso lo controlla la sonda (`consensi.richiesto`): senza, risponde 409 e il gruppo non parte.
  if (opzioni.famiglie?.includes("impianti")) {
    const ips = d.impianti(networkId);
    if (ips.length > 0) {
      gruppi.push({ famiglia: "impianti", ips, profile: "fast", nuclei_profilo: null, assessment_profile_id: null, avviso: null, anche_impianti: true });
    } else {
      avvisi.push("IoT e OT: nessun impianto in questa rete.");
    }
  }
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
      ...(g.anche_impianti ? { anche_impianti: true, chi: opzioni.chi ?? "IPAM" } : {}),
    };
    // Un'eccezione qui non deve perdere i gruppi già partiti: si ferma il giro e si dice che non si sa.
    const esito: EsitoGruppoEdge = await d.avvia(networkId, perEdge).catch((e: unknown) => ({
      stato: "non_so" as const,
      messaggio: e instanceof Error ? e.message : "errore sconosciuto",
    }));
    esiti.push({ ...g, esito });
    if (!CONTINUA.has(esito.stato)) {
      motivoStop = `non tentato: il gruppo «${ETICHETTE_FAMIGLIA[g.famiglia]}» si è fermato (${esito.stato})`;
    }
  }
  const lanciati = esiti.flatMap((g) => (g.esito.stato === "lanciato"
    ? [{ scan_id: g.esito.scan_id, famiglia: g.famiglia, device: g.ips.length - g.esito.ip_tolti.length }]
    : []));
  if (lanciati.length > 0) {
    try {
      d.registra(networkId, lanciati, new Date().toISOString());
    } catch (e) {
      // I gruppi sono partiti: un guasto qui non deve far credere il contrario, si perde solo il consuntivo.
      avvisi.push(`Avanzamento per gruppo non disponibile: ${e instanceof Error ? e.message : "scrittura non riuscita"}`);
    }
  }
  return { gruppi: esiti, tolti, avvisi, errore: null, fermato: motivoStop !== null };
}
