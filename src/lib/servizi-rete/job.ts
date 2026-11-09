/**
 * Giro automatico dei servizi di rete (Riccardo, 09/11/2026: «vorrei il massimo automatismo»).
 *
 * Avviato da `server.ts`: tre minuti dopo l'avvio e poi ogni 6 ore, per ogni cliente attivo,
 * prova le porte comuni sugli host senza porte note e rilegge con le sonde tutte le porte,
 * le più vecchie per prime. Si spegne per un cliente dalla levetta in Opzioni
 * (`servizi_rete.automatico = 0`). Il freno su campo e stampa vale sempre (`daSaltare`).
 */
import cron from "node-cron";
import { getActiveTenants } from "@/lib/db-hub";
import { withTenant, getTenantSetting } from "@/lib/db-tenant";
import { avviaGiro } from "./giro";

export const CRON_SERVIZI_RETE = "17 */6 * * *";
export const CHIAVE_AUTOMATICO = "servizi_rete.automatico";
const RITARDO_AVVIO_MS = 3 * 60_000;

const g = globalThis as typeof globalThis & { __jobServiziRete?: boolean };

/** Un giro per ogni cliente attivo che non l'ha spento. Ritorna i clienti avviati. */
export function giroServiziTutti(): string[] {
  const avviati: string[] = [];
  for (const t of getActiveTenants()) {
    try {
      const acceso = withTenant(t.codice_cliente, () => (getTenantSetting(CHIAVE_AUTOMATICO) ?? "1").trim() !== "0");
      if (!acceso) continue;
      if (avviaGiro(t.codice_cliente, null, { porteComuni: "senza-porte" })) avviati.push(t.codice_cliente);
    } catch (e) {
      console.warn(`[servizi-rete] ${t.codice_cliente}: giro automatico non avviato: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return avviati;
}

export function avviaGiroServiziAutomatico(): void {
  if (g.__jobServiziRete) return;
  g.__jobServiziRete = true;
  setTimeout(() => {
    const a = giroServiziTutti();
    if (a.length > 0) console.info(`[servizi-rete] giro all'avvio: ${a.join(", ")}`);
  }, RITARDO_AVVIO_MS).unref?.();
  cron.schedule(CRON_SERVIZI_RETE, () => {
    giroServiziTutti();
  });
}
