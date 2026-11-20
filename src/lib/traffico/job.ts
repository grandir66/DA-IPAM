/**
 * Lettura periodica dei collector di traffico (20/11/2026), avviata da `server.ts`.
 * Ogni 5 minuti, come la finestra di conteggio del collector; lavora solo per i clienti
 * che hanno almeno un collector attivo. Stato su globalThis come `trunk/job.ts`.
 */
import cron from "node-cron";
import { getActiveTenants } from "@/lib/db-hub";
import { withTenant } from "@/lib/db-tenant";
import { contaCollectorAttivi, sincronizzaTraffico } from "./lettura";

export const CRON_TRAFFICO = "*/5 * * * *";

interface StatoLettura {
  inCorso: boolean;
  avviato: boolean;
}
const g = globalThis as typeof globalThis & { __letturaTraffico?: StatoLettura };
const stato = (): StatoLettura => (g.__letturaTraffico ??= { inCorso: false, avviato: false });

export async function letturaTrafficoTutti(): Promise<void> {
  const s = stato();
  if (s.inCorso) return;
  s.inCorso = true;
  try {
    for (const t of getActiveTenants()) {
      try {
        await withTenant(t.codice_cliente, async () => {
          if (contaCollectorAttivi() === 0) return;
          const esito = await sincronizzaTraffico();
          if (esito.righe > 0 || esito.errori > 0) {
            console.info(`[traffico] ${t.codice_cliente}: ${esito.collector} collector, ${esito.righe} righe nuove, ${esito.errori} non letti`);
          }
        });
      } catch (e) {
        console.warn(`[traffico] ${t.codice_cliente}: collector non letti: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  } finally {
    s.inCorso = false;
  }
}

/** Avvia il cron; un secondo avvio (riavvio a caldo) non crea altri timer. */
export function avviaLetturaTraffico(): void {
  const s = stato();
  if (s.avviato) return;
  s.avviato = true;
  cron.schedule(CRON_TRAFFICO, () => void letturaTrafficoTutti());
}
