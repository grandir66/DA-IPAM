/**
 * Giro settimanale della matrice di segmentazione (Riccardo, 09/11/2026: acceso
 * di serie, spegnibile per cliente dalla levetta in Opzioni (`segmentazione.automatico = 0`).
 */
import cron from "node-cron";
import { getActiveTenants } from "@/lib/db-hub";
import { withTenant, getTenantSetting } from "@/lib/db-tenant";
import { avviaGiroSeg } from "./giro";

export const CRON_SEGMENTAZIONE = "23 3 * * 1";
export const CHIAVE_AUTOMATICO = "segmentazione.automatico";

const g = globalThis as typeof globalThis & { __jobSegmentazione?: boolean };

export function giroSegmentazioneTutti(): string[] {
  const avviati: string[] = [];
  for (const t of getActiveTenants()) {
    try {
      const acceso = withTenant(t.codice_cliente, () => (getTenantSetting(CHIAVE_AUTOMATICO) ?? "1").trim() !== "0");
      if (!acceso) continue;
      if (avviaGiroSeg(t.codice_cliente)) avviati.push(t.codice_cliente);
    } catch (e) {
      console.warn(`[segmentazione] ${t.codice_cliente}: giro non avviato: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return avviati;
}

export function avviaGiroSegmentazioneAutomatico(): void {
  if (g.__jobSegmentazione) return;
  g.__jobSegmentazione = true;
  cron.schedule(CRON_SEGMENTAZIONE, () => {
    giroSegmentazioneTutti();
  });
}
