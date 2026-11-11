/**
 * Le funzioni si ricalcolano a fine scansione, sul cliente del contesto. Non lancia: un difetto qui non deve far
 * fallire la scansione. Scrive solo le righe del sistema (`a_mano = 0`): quelle di una persona non si toccano.
 */
import { getDb } from "@/lib/db";
import { ricalcolaFunzioni } from "./funzioni-db";

export function funzioniDopoScansione(): void {
  try {
    const r = ricalcolaFunzioni(getDb(), { applica: true });
    if (r.tolte > 0) console.info(`[funzioni] ${r.trovate.length} funzioni riconosciute, ${r.tolte} non più valide tolte`);
  } catch (e) {
    console.error("[funzioni] ricalcolo non riuscito:", e);
  }
}
