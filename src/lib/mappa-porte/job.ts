/**
 * Ricalcolo della Mappa porte (piano 2026-11-07), avviato da `server.ts`: ogni 30 minuti, cinque minuti dopo il giro SNMP.
 * Il ricalcolo non chiede niente agli apparati e tocca solo le tabelle `mappa_porte_*`, per questo non ha una levetta.
 * Il giro dei parser, ogni 6 ore, sta dietro la lettura `mappa_dati`.
 * Stato su globalThis come `trunk/job.ts`: rotte e `server.ts` hanno istanze diverse.
 */
import cron from "node-cron";
import { getActiveTenants } from "@/lib/db-hub";
import { withTenant } from "@/lib/db-tenant";
import { ricalcolaMappaPorte } from "@/lib/mappa-porte/calcolo";
import { CRON_PARSER, giroParser } from "@/lib/mappa-porte/giro-parser";

export const CRON_MAPPA_PORTE = "5,35 * * * *";

interface StatoGiro { inCorso: boolean; avviato: boolean }
const g = globalThis as typeof globalThis & { __mappaPorte?: StatoGiro };
const stato = (): StatoGiro => (g.__mappaPorte ??= { inCorso: false, avviato: false });

export function ricalcolaTutti(): void {
  const s = stato();
  if (s.inCorso) return;
  s.inCorso = true;
  try {
    for (const t of getActiveTenants()) {
      try {
        withTenant(t.codice_cliente, () => {
          const esito = ricalcolaMappaPorte();
          if (!esito.ok) console.warn(`[mappa-porte] ${t.codice_cliente}: ${esito.motivo}`);
        });
      } catch (e) {
        console.warn(`[mappa-porte] ${t.codice_cliente}: calcolo non riuscito: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  } finally {
    s.inCorso = false;
  }
}

export function avviaMappaPorte(): void {
  const s = stato();
  if (s.avviato) return;
  s.avviato = true;
  cron.schedule(CRON_MAPPA_PORTE, ricalcolaTutti);
  cron.schedule(CRON_PARSER, () => void giroParser());
}
