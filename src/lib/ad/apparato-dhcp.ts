/**
 * L'apparato «Windows DHCP» del DC dell'Active Directory, che `ad_sync` crea
 * da solo per scrivere i lease nella tabella unificata `dhcp_leases` (senza
 * `source_device_id` l'UPSERT dei lease Windows non regge, v0.2.659).
 *
 * Dalla 2e (tappa 2 credenziali, T20, 16/10) nasce col binding WinRM
 * d'archivio verso la voce dell'AD, sulla 5985, non con la colonna
 * `credential_id`: la pagina dell'apparato non mostra la colonna e la 2g
 * smetterà di leggerla. Se l'apparato c'è già non si tocca.
 */
import { createNetworkDevice, getDb, getNetworkDeviceByHost, type AdIntegration } from "@/lib/db";
import { applicaVociApparatiDb } from "@/lib/credentials/apparato-archivio";
import { apparatoGiaPresente } from "@/lib/devices/apparato-del-cluster";

/**
 * L'id dell'apparato del DC: quello che c'è a quell'indirizzo, o uno nuovo col binding WinRM. null se l'IP del DC è
 * un altro IP di un apparato gestito (stesso device fisico, revisione finale 22/10): un secondo apparato sullo
 * stesso device è proprio ciò che «Rendi apparato» blocca; i lease restano in `ad_dhcp_leases`.
 */
export function apparatoDhcpDelDc(integration: Pick<AdIntegration, "name" | "dc_host" | "winrm_credential_id">): number | null {
  const esistente = getNetworkDeviceByHost(integration.dc_host);
  if (esistente) return esistente.id;
  const dbh = getDb();
  const gia = apparatoGiaPresente(dbh, integration.dc_host);
  if (gia) {
    if (gia.ip === integration.dc_host) return gia.network_device_id;
    // Niente nomi né IP nel log (regola 10).
    console.warn("[ad-client] l'IP del DC è un IP secondario di un apparato gestito: non si crea l'apparato DHCP");
    return null;
  }
  return dbh.transaction((): number => {
    const nuovo = createNetworkDevice({
      name: `${integration.name} — Windows DHCP`,
      host: integration.dc_host,
      device_type: "router",
      vendor: "windows",
      vendor_subtype: null,
      protocol: "winrm",
      api_url: null,
      port: 5985,
      enabled: 1,
    });
    if (integration.winrm_credential_id) {
      applicaVociApparatiDb(dbh, [nuovo.id], { credential_id: integration.winrm_credential_id }, { conferma: false, rigido: true });
    }
    return nuovo.id;
  })();
}
