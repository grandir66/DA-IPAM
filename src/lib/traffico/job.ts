/**
 * Lettura periodica dei collector di traffico (20/11/2026), avviata da `server.ts`.
 * Ogni 5 minuti, come la finestra di conteggio del collector; lavora solo per i clienti
 * che hanno almeno un collector attivo. Stato su globalThis come `trunk/job.ts`.
 */
import cron from "node-cron";
import { getActiveTenants } from "@/lib/db-hub";
import { withTenant } from "@/lib/db-tenant";
import { aggiornaGeoSeServe } from "./geo";
import { aggiornaListe, statoListe } from "./liste";
import { contaCollectorAttivi, sincronizzaTraffico } from "./lettura";
import { sondeNote } from "./sonde";

export const CRON_TRAFFICO = "*/5 * * * *";
/** Le liste di DA-GEO si rigenerano alle 4:10: si scaricano dopo. */
export const CRON_LISTE = "41 5 * * *";
/** Ogni mattina si guarda se manca l'archivio DB-IP del mese; si scarica una volta al mese. */
export const CRON_GEO = "23 5 * * *";

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
          const esito = await sincronizzaTraffico(undefined, undefined, sondeNote());
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

/** Archivio dei paesi: solo dove almeno un cliente ha un collector attivo. Un errore si scrive e si ritenta domani. */
export async function aggiornamentoGeo(): Promise<void> {
  try {
    let collector = 0;
    for (const t of getActiveTenants()) collector += await withTenant(t.codice_cliente, async () => contaCollectorAttivi());
    if (collector === 0) return;
    const fatto = await aggiornaGeoSeServe();
    if (fatto) console.info(`[traffico] archivio dei paesi aggiornato a ${fatto.mese}: ${fatto.paesi} paesi, ${fatto.fornitori} fornitori`);
  } catch (e) {
    console.warn(`[traffico] archivio dei paesi non aggiornato, si ritenta domani: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Liste di DA-GEO: una volta al giorno, solo i clienti che le hanno configurate. Un errore si scrive nello stato e si ritenta domani. */
export async function aggiornamentoListe(): Promise<void> {
  for (const t of getActiveTenants()) {
    try {
      await withTenant(t.codice_cliente, async () => {
        if (!statoListe().configurato) return;
        const s = await aggiornaListe();
        if (s.errore) console.warn(`[traffico] ${t.codice_cliente}: liste di DA-GEO: ${s.errore}`);
        else console.info(`[traffico] ${t.codice_cliente}: ${s.liste.length} liste di DA-GEO aggiornate`);
      });
    } catch (e) {
      console.warn(`[traffico] ${t.codice_cliente}: liste di DA-GEO non aggiornate: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

/** Avvia il cron; un secondo avvio (riavvio a caldo) non crea altri timer. */
export function avviaLetturaTraffico(): void {
  const s = stato();
  if (s.avviato) return;
  s.avviato = true;
  cron.schedule(CRON_TRAFFICO, () => void letturaTrafficoTutti());
  cron.schedule(CRON_GEO, () => void aggiornamentoGeo());
  cron.schedule(CRON_LISTE, () => void aggiornamentoListe());
}
