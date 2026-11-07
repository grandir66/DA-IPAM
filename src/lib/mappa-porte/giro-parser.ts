/**
 * I parser sugli apparati di rete, a giro (Riccardo, 07/11). Finora partivano solo dal pulsante «Interroga»: sull'hub 0 snapshot,
 * quindi MikroTik, HP, Aruba e QNAP avevano parser scritti che nessuno usava. Dietro `mappa_dati`, spenta di serie: comandi in
 * sola lettura, uno per apparato, col lucchetto del giro. Un apparato senza collector o senza credenziale si salta.
 */
import { getActiveTenants } from "@/lib/db-hub";
import { getCurrentTenantCode, getNetworkDevices, getTenantDb, withTenant } from "@/lib/db-tenant";
import { conLucchettoApparato, entroTempoApparato, TEMPO_APPARATO_MS } from "@/lib/devices/lucchetto-apparato";
import { DIPENDENZE_VERE, eseguiAcquisizioneModulare, prendiLucchetto, lasciaLucchetto, type DipendenzeEsecuzione } from "@/lib/acquisizione-modulare/esegui";
import { dipendenzeDb, valutaFonte } from "@/lib/acquisizione-modulare/fonte";
import { lettoreDb } from "@/lib/acquisizione-modulare/richiesta";
import { letturaAccesa } from "@/lib/topology/letture/interruttori";

export const CRON_PARSER = "25 */6 * * *";
const TIPI = new Set(["switch", "router", "firewall", "access_point"]);

export interface EsitoGiroParser { letti: number; saltati: number; falliti: number }

export async function giroParserDelTenant(dipendenze?: Pick<DipendenzeEsecuzione, "collect" | "adesso">): Promise<EsitoGiroParser> {
  const esito: EsitoGiroParser = { letti: 0, saltati: 0, falliti: 0 };
  if (!letturaAccesa("mappa_dati")) return esito;
  const code = getCurrentTenantCode();
  if (!code) throw new Error("Contesto tenant assente");
  // `mappa_dati` accesa vale anche se l'acquisizione modulare manuale è spenta: 70151 non l'ha mai accesa.
  const fonte = { ...dipendenzeDb(), accesa: () => true };
  // `winrm`: sull'hub 8 PC sono registrati come switch; il parser di rete non è per loro.
  for (const device of getNetworkDevices().filter((d) => d.enabled && TIPI.has(d.device_type) && d.protocol !== "winrm")) {
    const v = valutaFonte(device, fonte);
    if (v.esito !== "pronta") { esito.saltati++; continue; }
    if (!prendiLucchetto(device.id)) { esito.saltati++; continue; }
    try {
      const r = await conLucchettoApparato(device.id, () => entroTempoApparato(eseguiAcquisizioneModulare(
        { deviceId: device.id, device, collector: v.collector, credenziali: v.credenziali, utente: null },
        { ...(dipendenze ?? DIPENDENZE_VERE), leggi: lettoreDb(getTenantDb(code)) },
      ), TEMPO_APPARATO_MS));
      if (r.stato !== "fatto") { lasciaLucchetto(device.id); esito.saltati++; continue; }
      if (r.valore.status === "error") esito.falliti++; else esito.letti++;
    } catch (e) {
      lasciaLucchetto(device.id);
      esito.falliti++;
      console.warn(`[mappa-porte] apparato #${device.id}: parser non riuscito (${e instanceof Error ? e.name : "errore"})`);
    }
  }
  return esito;
}

export async function giroParser(): Promise<void> {
  for (const t of getActiveTenants()) {
    try {
      await withTenant(t.codice_cliente, () => giroParserDelTenant());
    } catch (e) {
      console.warn(`[mappa-porte] ${t.codice_cliente}: giro dei parser non riuscito: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
