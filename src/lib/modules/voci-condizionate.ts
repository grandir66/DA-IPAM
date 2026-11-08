/**
 * Voci del menu che diventano grigie quando manca chi le alimenta (Riccardo, 08/11/2026, sulla
 * ridotta 79993-ipam-7). Modulo puro: lo usa `shared/sidebar.tsx`, la prova è
 * `__tests__/voci-condizionate.test.ts`.
 *
 * - Vulnerabilità, Scansioni VA, Inventario, Applicativi: grigie se mancano Scanner-Edge **e** NIS2.
 *   Edge c'è se è registrato (`installed`: una riga in `vuln_scanners`, anche spenta per un
 *   momento); NIS2 c'è se è acceso (Opzioni → Modulo NIS2, acceso di serie: sulla ridotta si
 *   spegne da lì, decisione di Riccardo dell'08/11).
 * - Alert sicurezza: grigia se Wazuh non è configurato (nell'appliance, in una VM sua o del
 *   cliente: conta la configurazione dell'integrazione, non dove gira).
 *
 * Solo il menu: le pagine restano raggiungibili dall'indirizzo.
 */
import type { ModuloPerMenu } from "./voci-applicativi";

export interface Presenze {
  edge: boolean;
  nis2: boolean;
  wazuh: boolean;
}

export type VoceCondizionata = "vulnerabilita" | "scansioni_va" | "inventario" | "applicativi" | "alert_sicurezza";

export function presenzeDaModuli(moduli: readonly ModuloPerMenu[]): Presenze {
  const mod = (k: string) => moduli.find((x) => x.key === k);
  return {
    edge: mod("edge")?.installed === true,
    nis2: mod("nis2_inventory")?.enabled === true,
    wazuh: mod("wazuh")?.enabled === true,
  };
}

const SENZA_EDGE_NIS2 =
  "Serve Scanner-Edge o il modulo NIS2: questa appliance è installata senza. NIS2 si accende da Opzioni.";
const SENZA_WAZUH = "Serve l'integrazione Wazuh: non è configurata (Impostazioni → Moduli).";

/** Il motivo per cui la voce è grigia, o `null` se è attiva. `null` come presenze = non ancora lette: niente grigio. */
export function motivoBlocco(voce: VoceCondizionata, p: Presenze | null): string | null {
  if (!p) return null;
  if (voce === "alert_sicurezza") return p.wazuh ? null : SENZA_WAZUH;
  return p.edge || p.nis2 ? null : SENZA_EDGE_NIS2;
}
