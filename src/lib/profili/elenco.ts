/**
 * Elenco dei profili cliente per la pagina «Profili» dell'installazione «tecnico» (ADR 0037).
 * Un profilo è un tenant attivo; per ognuno quanti host ha e quando è stata l'ultima scansione.
 * Un profilo che non si legge porta il suo errore: non diventa «0 host».
 */
import { getActiveTenants } from "@/lib/db-hub";
import { getTenantDb } from "@/lib/db-tenant";

export interface ProfiloInElenco {
  id: number;
  codice: string;
  ragioneSociale: string;
  host: number | null;
  /** `datetime('now')` di SQLite (UTC, «AAAA-MM-GG HH:MM:SS»), o null se mai scansionato. */
  ultimaScansione: string | null;
  errore: string | null;
}

export function elencoProfili(): ProfiloInElenco[] {
  return getActiveTenants().map((t) => {
    const base = { id: t.id, codice: t.codice_cliente, ragioneSociale: t.ragione_sociale };
    try {
      const db = getTenantDb(t.codice_cliente);
      const host = (db.prepare("SELECT COUNT(*) AS n FROM hosts").get() as { n: number }).n;
      const ultima = (db.prepare("SELECT MAX(timestamp) AS t FROM scan_history").get() as { t: string | null }).t;
      return { ...base, host, ultimaScansione: ultima, errore: null };
    } catch (e) {
      return { ...base, host: null, ultimaScansione: null, errore: e instanceof Error ? e.message : String(e) };
    }
  });
}
