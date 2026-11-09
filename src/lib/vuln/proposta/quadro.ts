/**
 * Il quadro delle famiglie di una rete per la pagina Scansioni VA (piano profili-per-device, Passo 5,
 * 06/11/2026). Funzione pura. Le colonne dicono cosa partirebbe davvero: la profondità viene da
 * `gruppiDaConfermate`, non da una tabella copiata qui, così pagina e lancio non possono divergere.
 */
import { gruppiDaConfermate, ORDINE, schedaDiFamiglia, valoriDiFamiglia, type NucleiGruppo } from "./gruppi";
import type { ModuliScelta, NucleiScelta, SceltaGruppo } from "./scelte-gruppo-regole";
import type { EdgeScanProfile } from "@/lib/vuln/edge-subnet-bridge";
import { ETICHETTE_FAMIGLIA, type Famiglia } from "./regole";
import type { RigaProposta } from "./store";

export interface RigaFamiglia {
  famiglia: Famiglia;
  nome: string;
  device: number;
  /** Passo 9: device forzati da «da chiarire» in questa famiglia. */
  forzati?: number;
  confermati: number;
  daRivedere: number;
  esclusi: number;
  inAttesa: number;
  greenbone: string;
  /** La profondità è più bassa della proposta: una persona ha scelto meno su un device. */
  scesa: boolean;
  nuclei: string;
  moduli: string;
  /** `mai`: impianti. `chiarire`: fuori finché non si dice cos'è. `null`: si può lanciare. */
  fuori: "mai" | "chiarire" | null;
  /** Tappa 09/11 (tavola 45): i valori dei menu (tabella + scelta), prima dell'abbassamento dei device. */
  valori?: { profile: EdgeScanProfile; nuclei: NucleiScelta; moduli: ModuliScelta };
  /** La scelta di una persona per questa famiglia sulla rete, con la firma; assente = vale la tabella. */
  scelta?: SceltaGruppo | null;
}

const NOMI_GREENBONE = { fast: "Veloce", balanced: "Bilanciato", deep: "Profondo" } as const;
const NOMI_NUCLEI: Record<NucleiGruppo, string> = { gestione: "Solo web di gestione", quick: "Rapido", standard: "Standard" };

export function quadroFamiglie(righe: readonly RigaProposta[], scelte: readonly SceltaGruppo[] = []): RigaFamiglia[] {
  const gruppi = gruppiDaConfermate(righe, [], scelte);
  // «da_chiarire» è anche in ORDINE (gruppo prudente, 08/11/2026): in tabella resta l'ultima riga, una volta sola.
  const famiglie: Famiglia[] = [...ORDINE.filter((f) => f !== "da_chiarire"), "impianti", "da_chiarire"];
  return famiglie.flatMap((famiglia): RigaFamiglia[] => {
    const sue = righe.filter((r) => r.famiglia === famiglia);
    if (sue.length === 0) return [];
    const scheda = schedaDiFamiglia(famiglia) ? valoriDiFamiglia(famiglia, scelte) : null;
    const comuni = { famiglia, nome: ETICHETTE_FAMIGLIA[famiglia], device: sue.length, forzati: sue.filter((r) => r.forzata_da_famiglia).length };
    if (!scheda) {
      const parola = famiglia === "impianti" ? "mai" : "no";
      return [{
        ...comuni, confermati: 0, daRivedere: 0, esclusi: 0, inAttesa: 0,
        greenbone: parola, scesa: false, nuclei: parola, moduli: parola,
        fuori: famiglia === "impianti" ? "mai" : "chiarire",
      }];
    }
    const profilo = gruppi.find((g) => g.famiglia === famiglia)?.profile ?? scheda.profile;
    const moduli = scheda.moduli === "completi" && profilo === "fast" ? "base" : scheda.moduli;
    return [{
      ...comuni,
      // Inclusione di serie (08/11/2026): «confermati» conta chi parte, cioè ogni riga non esclusa.
      confermati: sue.filter((r) => r.stato !== "escluso").length,
      daRivedere: sue.filter((r) => r.da_rivedere).length,
      esclusi: sue.filter((r) => r.stato === "escluso").length,
      inAttesa: sue.filter((r) => r.stato === "proposto").length,
      greenbone: NOMI_GREENBONE[profilo],
      scesa: profilo !== scheda.profile,
      nuclei: scheda.nuclei ? NOMI_NUCLEI[scheda.nuclei] : "Nessuno",
      moduli: moduli === "base" ? "Giro minimo" : moduli === "completi" ? "Giro completo" : "Nessuno",
      fuori: null,
      valori: { profile: scheda.profile, nuclei: scheda.nuclei ?? "nessuno", moduli: scheda.moduli ?? "nessuno" },
      scelta: scelte.find((s) => s.famiglia === famiglia) ?? null,
    }];
  });
}
