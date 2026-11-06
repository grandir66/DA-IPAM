/**
 * Giro notturno del riconoscimento degli `unknown` (06/11/2026), avviato da `server.ts`. Spento di serie: si accende per
 * cliente in Opzioni (`automatismo.riconoscimento`). Stato su globalThis come `trunk/job.ts`.
 */
import cron from "node-cron";
import { getActiveTenants } from "@/lib/db-hub";
import { withTenant } from "@/lib/db-tenant";
import { giroSconosciuti } from "./sconosciuti";

export const CRON_RICONOSCIMENTO = "23 2 * * *";

interface StatoGiro {
  inCorso: boolean;
  avviato: boolean;
}
const g = globalThis as typeof globalThis & { __giroSconosciuti?: StatoGiro };
const stato = (): StatoGiro => (g.__giroSconosciuti ??= { inCorso: false, avviato: false });

export async function giroSconosciutiTutti(): Promise<void> {
  const s = stato();
  if (s.inCorso) return;
  s.inCorso = true;
  try {
    for (const t of getActiveTenants()) {
      try {
        await withTenant(t.codice_cliente, async () => {
          const e = await giroSconosciuti(t.codice_cliente);
          if (e.provati > 0 || e.retiOccupate > 0) {
            console.info(`[riconoscimento] ${t.codice_cliente}: ${e.provati} host provati, ${e.campiRiempiti} campi, ${e.retiOccupate} reti occupate`);
          }
        });
      } catch (e) {
        console.warn(`[riconoscimento] ${t.codice_cliente}: giro non riuscito: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  } finally {
    s.inCorso = false;
  }
}

/** Avvia il cron; un secondo avvio (riavvio a caldo) non crea altri timer. */
export function avviaGiroSconosciuti(): void {
  const s = stato();
  if (s.avviato) return;
  s.avviato = true;
  cron.schedule(CRON_RICONOSCIMENTO, () => void giroSconosciutiTutti());
}
