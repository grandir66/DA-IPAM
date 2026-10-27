/**
 * Job che non si toccano dalle rotte generiche `/api/jobs` (m6 della revisione finale, 20/10).
 *
 * `pulizia_host` toglie host del cliente senza anteprima: lo crea, lo accende e lo spegne solo l'interruttore della
 * sua scheda (Impostazioni → Sistema → Pulizia degli host assenti; decisione 4), che lo tiene a un giro al giorno
 * alle 04:00. L'elenco dei job lo mostra in sola lettura, ma senza questa guardia una chiamata a mano a PUT, DELETE o
 * «Esegui ora» lo lancerebbe di giorno o ne cambierebbe l'intervallo. Le rotte chiamano la guardia prima di scrivere.
 *
 * Lavora nel contesto tenant della rotta (`withTenantFromSession`). Import di `db-tenant` solo statico (ADR 0002).
 */
import { getScheduledJobById } from "@/lib/db-tenant";

const RISERVATI: Readonly<Record<string, string>> = {
  pulizia_host: "Si gestisce da Impostazioni → Sistema → Pulizia degli host assenti",
};

/** Un tipo di job che non si lancia a mano (Schedulazioni non gli mette «Esegui ora»). */
export function eJobRiservato(tipo: string): boolean {
  return tipo in RISERVATI;
}

/** 409 col posto da cui il job si gestisce, se `jobId` è un job riservato; null altrimenti (anche se non esiste). */
export function rifiutoJobRiservato(jobId: number): { status: 409; body: { error: string } } | null {
  const job = getScheduledJobById(jobId);
  const dove = job ? RISERVATI[job.job_type] : undefined;
  return dove ? { status: 409, body: { error: dove } } : null;
}
