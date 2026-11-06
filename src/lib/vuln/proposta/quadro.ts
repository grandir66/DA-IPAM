/**
 * Il quadro delle famiglie di una rete per la pagina Scansioni VA (piano profili-per-device, Passo 5,
 * 06/11/2026). Funzione pura. Le colonne dicono cosa partirebbe davvero: la profondità viene da
 * `gruppiDaConfermate`, non da una tabella copiata qui, così pagina e lancio non possono divergere.
 */
import { gruppiDaConfermate, ORDINE, schedaDiFamiglia, type NucleiGruppo } from "./gruppi";
import { ETICHETTE_FAMIGLIA, type Famiglia } from "./regole";
import type { RigaProposta } from "./store";

export interface RigaFamiglia {
  famiglia: Famiglia;
  nome: string;
  device: number;
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
}

const NOMI_GREENBONE = { fast: "Veloce", balanced: "Bilanciato", deep: "Profondo" } as const;
const NOMI_NUCLEI: Record<NucleiGruppo, string> = { gestione: "Solo web di gestione", quick: "Rapido", standard: "Standard" };

export function quadroFamiglie(righe: readonly RigaProposta[]): RigaFamiglia[] {
  const gruppi = gruppiDaConfermate(righe);
  const famiglie: Famiglia[] = [...ORDINE, "impianti", "da_chiarire"];
  return famiglie.flatMap((famiglia): RigaFamiglia[] => {
    const sue = righe.filter((r) => r.famiglia === famiglia);
    if (sue.length === 0) return [];
    const scheda = schedaDiFamiglia(famiglia);
    const comuni = { famiglia, nome: ETICHETTE_FAMIGLIA[famiglia], device: sue.length };
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
      confermati: sue.filter((r) => r.stato === "confermato" && !r.da_rivedere).length,
      daRivedere: sue.filter((r) => r.da_rivedere).length,
      esclusi: sue.filter((r) => r.stato === "escluso" && !r.da_rivedere).length,
      inAttesa: sue.filter((r) => r.stato === "proposto" && !r.da_rivedere).length,
      greenbone: NOMI_GREENBONE[profilo],
      scesa: profilo !== scheda.profile,
      nuclei: scheda.nuclei ? NOMI_NUCLEI[scheda.nuclei] : "Nessuno",
      moduli: moduli === "base" ? "Giro minimo" : moduli === "completi" ? "Giro completo" : "Nessuno",
      fuori: null,
    }];
  });
}
