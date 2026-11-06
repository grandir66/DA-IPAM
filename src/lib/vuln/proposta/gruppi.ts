/**
 * Dalle proposte confermate ai gruppi da lanciare su Edge (piano profili-per-device, Passo 4,
 * 06/11/2026). Funzione pura: nessuna lettura di database né di rete.
 *
 * Perché esiste: al 72729 nove PLC sono spariti dentro una scansione della loro rete (05-06/11/2026).
 * La causa NON è accertata: gli orari somigliano anche a una macchina accesa a turni, e il cliente non
 * ha ancora detto ora e sintomo. Il piano non dipende dalla causa: ai device di campo non si mandano i
 * controlli di un server. Qui l'elenco degli IP di ogni gruppo nasce solo da righe `confermato` di
 * famiglie scansionabili; IoT/OT e «Da chiarire» non producono mai un gruppo. È la prima barriera: la
 * seconda è il freno `protetti` di Edge, che resta acceso anche se questo file sbagliasse.
 *
 * Regole che non si discutono (piano): nel dubbio si scende; le credenziali deboli restano fuori da
 * Windows, domini, router e firewall; niente parte da solo.
 */
import type { EdgeAssessmentProfile } from "@/lib/vuln/edge-profiles";
import type { EdgeScanProfile } from "@/lib/vuln/edge-subnet-bridge";
import { vocePaginaDelProfilo } from "@/lib/vuln/profili-assessment-testi";
import { VOCI_BASE } from "@/lib/vuln/scansioni-va-regole";
import type { Famiglia } from "./regole";
import type { RigaProposta } from "./store";

/** Profilo nuclei di un gruppo: `gestione` = solo web di gestione (Edge ≥ Passo 4), il resto è il suo. */
export type NucleiGruppo = "gestione" | "quick" | "standard";

export interface GruppoDaLanciare {
  famiglia: Famiglia;
  ips: string[];
  profile: EdgeScanProfile;
  nuclei_profilo: NucleiGruppo | null;
  assessment_profile_id: string | null;
}

type Moduli = "base" | "completi" | null;

interface Scheda {
  profile: EdgeScanProfile;
  nuclei: NucleiGruppo | null;
  moduli: Moduli;
  /** Windows, domini, router e firewall: nessun modulo con credenziali deboli (regola 5). */
  senzaCredenzialiDeboli: boolean;
}

/**
 * Tabella famiglia → profili. Assessment: «base» è il giro minimo (impronta dei servizi), «completi» il
 * giro intero. Rete e Windows restano sul base perché il giro completo fa anche l'interrogazione SNMP con
 * la community di serie: è una credenziale debole e la regola 5 la esclude. Web non ha un profilo che
 * faccia solo TLS: nessuno. Un profilo che non si traduce senza ambiguità scende, non sale.
 */
const SCHEDE: Partial<Record<Famiglia, Scheda>> = {
  rete: { profile: "balanced", nuclei: "gestione", moduli: "base", senzaCredenzialiDeboli: true },
  windows: { profile: "balanced", nuclei: "quick", moduli: "base", senzaCredenzialiDeboli: true },
  linux: { profile: "balanced", nuclei: "standard", moduli: "completi", senzaCredenzialiDeboli: false },
  web: { profile: "balanced", nuclei: "standard", moduli: null, senzaCredenzialiDeboli: false },
  periferiche: { profile: "fast", nuclei: "gestione", moduli: "base", senzaCredenzialiDeboli: false },
};

/** Ordine di lancio: quello della tabella del piano. Chi non c'è qui (impianti, da_chiarire) non parte. */
const ORDINE: Famiglia[] = ["rete", "windows", "linux", "web", "periferiche"];

/** Moduli del catalogo di Edge che provano credenziali di serie (`snmp-enum`: community «public»). */
const MODULI_CREDENZIALI_DEBOLI = ["snmp-enum"];

const GRADINI: EdgeScanProfile[] = ["fast", "balanced", "deep"];

function gradino(p: EdgeScanProfile): number {
  return GRADINI.indexOf(p);
}

/** La profondità che una persona ha scelto per il device; `null` se non c'è una scelta leggibile. */
function profonditaScelta(voce: RigaProposta["voce"]): EdgeScanProfile | null {
  return VOCI_BASE.find((v) => v.id === voce)?.greenbone ?? null;
}

function idAssessment(
  moduli: Moduli,
  scheda: Scheda,
  catalogo: readonly EdgeAssessmentProfile[],
): string | null {
  const ordine: Array<"moduli-base" | "moduli-completi"> =
    moduli === "completi" ? ["moduli-completi", "moduli-base"] : moduli === "base" ? ["moduli-base"] : [];
  for (const voce of ordine) {
    const p = catalogo.find((c) => vocePaginaDelProfilo(c.id) === voce);
    if (!p) continue;
    if (p.requires_authorization) continue; // serve l'autorizzazione scritta del cliente: mai da qui
    if (scheda.senzaCredenzialiDeboli && p.steps.some((s) => MODULI_CREDENZIALI_DEBOLI.includes(s))) continue;
    return p.id;
  }
  return null;
}

/**
 * Una riga per famiglia, solo da righe `confermato` non da rivedere. `catalogo` è quello letto da Edge
 * (`GET /api/v1/profiles`): gli id degli assessment non si scrivono qui; senza catalogo nessun gruppo
 * ha un assessment. Una scelta più bassa di una persona su un host abbassa il gruppo, una più alta no.
 */
export function gruppiDaConfermate(
  righe: readonly RigaProposta[],
  catalogo: readonly EdgeAssessmentProfile[] = [],
): GruppoDaLanciare[] {
  const gruppi: GruppoDaLanciare[] = [];
  for (const famiglia of ORDINE) {
    const scheda = SCHEDE[famiglia];
    if (!scheda) continue;
    const sue = righe.filter((r) => r.famiglia === famiglia && r.stato === "confermato" && !r.da_rivedere && r.ip.trim() !== "");
    if (sue.length === 0) continue;
    const ips = [...new Set(sue.map((r) => r.ip.trim()))];
    let profile = scheda.profile;
    for (const r of sue) {
      const scelta = profonditaScelta(r.voce);
      if (scelta !== null && gradino(scelta) < gradino(profile)) profile = scelta;
    }
    const moduli: Moduli = scheda.moduli === "completi" && profile === "fast" ? "base" : scheda.moduli;
    gruppi.push({
      famiglia,
      ips,
      profile,
      nuclei_profilo: scheda.nuclei,
      assessment_profile_id: idAssessment(moduli, scheda, catalogo),
    });
  }
  return gruppi;
}
