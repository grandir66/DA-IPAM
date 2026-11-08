/**
 * Profilo cliente nuovo sull'installazione «tecnico» (ADR 0037, piano 2026-11-08, Task 3).
 *
 * - Il codice del profilo è il `codcli` del gestionale (regola `CODCLI` di DA-Link): il centrale
 *   riconoscerà i dati di ogni profilo senza tabelle di traduzione.
 * - Un profilo creato è pronto subito: `preparaProfilo` fa per quel tenant quello che l'avvio fa
 *   per tutti (`applySchedulerBootMigration` + `initializeScheduler`). Senza, il tenant nuovo
 *   restava senza job fino al riavvio (misura dell'08/11).
 * - Sulle installazioni dai clienti la creazione resta com'è oggi (decisione D1 dell'08/11).
 */
import { applyTenantSchedulerDefaults, withTenant } from "@/lib/db-tenant";
import { seminaJobDiSerie } from "@/lib/opzioni/job-di-serie";
import { activeJobKeys, reloadTenantScheduler } from "@/lib/cron/scheduler";
import { CODCLI } from "@/lib/dalink/config";
import type { Profilo } from "@/lib/profilo";

export type RegolaCreazione = { ok: true; prepara: boolean } | { ok: false; errore: string };

export function regolaCreazioneProfilo(profilo: Profilo, codice: string): RegolaCreazione {
  if (profilo !== "tecnico") return { ok: true, prepara: false };
  if (!CODCLI.test(codice.trim())) {
    return { ok: false, errore: "Il codice del profilo è il codice cliente del gestionale: solo cifre, da 3 a 8." };
  }
  return { ok: true, prepara: true };
}

export function preparaProfilo(codice: string): { jobSeminati: number; jobCaricati: number } {
  const jobSeminati = withTenant(codice, () => {
    const r = applyTenantSchedulerDefaults();
    return r.jobsSeeded + seminaJobDiSerie().creati;
  });
  reloadTenantScheduler(codice);
  const jobCaricati = activeJobKeys().filter((k) => k.startsWith(`${codice}:`)).length;
  return { jobSeminati, jobCaricati };
}
