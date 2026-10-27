/**
 * Le soglie della pulizia degli host, per cliente (decisione di Riccardo del 23/10: si cambiano da Opzioni). Di serie
 * restano quelle decise il 20/10 (60 giorni di assenza, 90 d'archivio, `pulizia.ts` e `pulizia-archivio.ts`). Il minimo
 * è 30 giorni: la pulizia archivia di notte senza anteprima e l'archivio scaduto si cancella per sempre, un valore
 * scritto male non deve svuotare la rete. Un valore illeggibile vale quello di serie.
 */
import { dbCorrente } from "@/lib/hosts/db-corrente";

export const CHIAVI_SOGLIE_PULIZIA = {
  assenza: "pulizia.giorni_assenza",
  archivio: "pulizia.giorni_archivio",
} as const;

export const LIMITI_SOGLIE_PULIZIA = { min: 30, max: 365 } as const;

/** La soglia del cliente del contesto (`tenant_settings`), o `diSerie`; sempre dentro i limiti. */
export function sogliaPulizia(chiave: string, diSerie: number): number {
  const r = dbCorrente().prepare("SELECT value FROM tenant_settings WHERE key = ?").get(chiave) as { value: string } | undefined;
  const n = r ? parseInt(r.value, 10) : NaN;
  if (Number.isNaN(n)) return diSerie;
  return Math.min(LIMITI_SOGLIE_PULIZIA.max, Math.max(LIMITI_SOGLIE_PULIZIA.min, n));
}
