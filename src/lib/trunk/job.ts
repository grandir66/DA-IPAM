/**
 * Lettura periodica del sensore trunk (25/10/2026), avviata da `server.ts`.
 *
 * Prima la lettura stava in coda al giro ARP del cliente: con molti switch il giro
 * dura e la pagina «Reti dal trunk» restava ferma anche mezz'ora. Ora si legge ogni
 * 2 minuti, solo per i clienti con «Sensore trunk» acceso in Opzioni. La lettura è
 * incrementale (cursore): un giro senza novità costa due chiamate al socket.
 * Dal 28/10 un'appliance da un cliente con la sonda locale accende la lettura da sola al
 * primo giro (`accendiLetturaSeSondaLocale`): il wizard trova già le reti del trunk.
 * Stato su globalThis come `assegnatari/job.ts`: rotte e `server.ts` hanno istanze diverse.
 */
import cron from "node-cron";
import { getActiveTenants } from "@/lib/db-hub";
import { withTenant } from "@/lib/db-tenant";
import { accendiLetturaSeSondaLocale, sincronizzaTrunk, trunkLetturaAttiva } from "./sensore-trunk";

export const CRON_TRUNK = "*/2 * * * *";

interface StatoLettura {
  inCorso: boolean;
  avviato: boolean;
}
const g = globalThis as typeof globalThis & { __letturaTrunk?: StatoLettura };
const stato = (): StatoLettura => (g.__letturaTrunk ??= { inCorso: false, avviato: false });

export async function letturaTrunkTutti(): Promise<void> {
  const s = stato();
  if (s.inCorso) return;
  s.inCorso = true;
  try {
    const clienti = getActiveTenants();
    for (const t of clienti) {
      try {
        await withTenant(t.codice_cliente, async () => {
          if (accendiLetturaSeSondaLocale(clienti.length)) {
            console.info(`[trunk] ${t.codice_cliente}: sonda locale trovata, lettura accesa`);
          }
          if (!trunkLetturaAttiva()) return;
          const esito = await sincronizzaTrunk();
          if (esito.osservazioni > 0) {
            console.info(`[trunk] ${t.codice_cliente} (${esito.fonte}): ${esito.vlan} VLAN, ${esito.osservazioni} osservazioni nuove`);
          }
        });
      } catch (e) {
        console.warn(`[trunk] ${t.codice_cliente}: sensore non letto: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  } finally {
    s.inCorso = false;
  }
}

/** Avvia il cron; un secondo avvio (riavvio a caldo) non crea altri timer. */
export function avviaLetturaTrunk(): void {
  const s = stato();
  if (s.avviato) return;
  s.avviato = true;
  cron.schedule(CRON_TRUNK, () => void letturaTrunkTutti());
}
