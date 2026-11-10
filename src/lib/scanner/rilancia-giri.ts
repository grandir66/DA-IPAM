/**
 * All'avvio del servizio: fa ripartire i giri lanciati a mano che il riavvio ha interrotto.
 * Le regole (una volta sola, entro due ore, senza prove invasive) stanno in `giri-da-rilanciare.ts`.
 */
import { getActiveTenants } from "@/lib/db-hub";
import { getTenantSetting, setTenantSetting, withTenant } from "@/lib/db-tenant";
import { CHIAVE_GIRI_DA_RILANCIARE, corpoPerRilancio, daRilanciare, leggiSalvati } from "./giri-da-rilanciare";
import { lanciaGiro, type LancioGiro } from "./lancia-giro";

export async function rilanciaGiriInterrotti(): Promise<void> {
  for (const t of getActiveTenants()) {
    const tenant = t.codice_cliente;
    try {
      await withTenant(tenant, async () => {
        const salvati = leggiSalvati(getTenantSetting(CHIAVE_GIRI_DA_RILANCIARE));
        if (salvati.length === 0) return;
        // Si svuota prima di rilanciare: se anche il rilancio muore, non riparte una terza volta.
        setTenantSetting(CHIAVE_GIRI_DA_RILANCIARE, "[]");
        const voci = daRilanciare(salvati);
        for (const v of voci) {
          try {
            const esito = await lanciaGiro(corpoPerRilancio(v.corpo) as unknown as LancioGiro, {}, { rilanci: v.rilanci + 1 });
            console.warn(`[scans] ${tenant}: giro «${esito.tipo}» interrotto dal riavvio, rilanciato da capo (${esito.avvii.length} reti)`);
          } catch (e) {
            console.warn(`[scans] ${tenant}: giro interrotto non rilanciato: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
        if (salvati.length > voci.length) {
          console.warn(`[scans] ${tenant}: ${salvati.length - voci.length} giri interrotti non rilanciati (già ripartiti una volta o troppo vecchi)`);
        }
      });
    } catch (e) {
      console.warn(`[scans] ${tenant}: lettura dei giri interrotti fallita: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
