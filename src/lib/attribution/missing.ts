import type { AttributionResult } from "./fuse";
import { categoryDepth } from "./taxonomy";
import type { CategorySlug } from "./taxonomy";
import { isValidCategory } from "./taxonomy";

/**
 * Suggerisce la prossima fase utile (spec §3: "per migliorare questo host serve SNMP"
 * invece di un vuoto). Regole fase 1:
 * - categoria assente e min_phase < scan_snmp_verify → suggerisci SNMP;
 * - categoria a livello 1 → SNMP (sysObjectID/LLDP distinguono la foglia);
 * - os assente → suggerisci Nmap base o credenziali;
 * - tutto risolto → null.
 */
export function buildMissingSuggestion(result: AttributionResult): string | null {
  const cat = result.category.claim;
  if (cat == null) {
    return "Nessuna categoria attribuibile: esegui la scansione SNMP (sysObjectID) o una fase porte per portare nuove evidenze.";
  }
  if (isValidCategory(cat) && categoryDepth(cat as CategorySlug) === 1) {
    return `Categoria ferma al livello 1 (${cat}): esegui SNMP per distinguere il tipo esatto (es. AP vs switch).`;
  }
  if (result.os.claim == null) {
    return "OS non attribuito: esegui Nmap base o valida credenziali SSH/WinRM.";
  }
  return null;
}
