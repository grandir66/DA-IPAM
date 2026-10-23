/**
 * Le voci del censimento del 22/10 che NON stanno nel catalogo delle opzioni, ciascuna col perché (spec §3.6). La prova
 * di completezza accetta una chiave solo se è nel catalogo o qui.
 */
import type { FuoriCatalogo } from "./tipi";

export const FUORI_CATALOGO: readonly FuoriCatalogo[] = [
  { chiave: "tenants.active", motivo: "è l'anagrafica dei clienti dell'hub (/tenants), non un'opzione del cliente" },
  { chiave: "controllers.enabled", motivo: "è un dato del singolo controller: si accende dalla sua finestra in /controllers" },
  { chiave: "identificazione", motivo: "le levette di /settings?tab=identificazione sono regole (impronte, MAC→prodotto, sysObjectID), cioè dati" },
  { chiave: "networks.probes_enabled", motivo: "è un dato della singola rete, non una funzione" },
  { chiave: "edge-scan", motivo: "la scansione Edge pianificata è un dato della singola rete (/networks/[id])" },
  { chiave: "known_host", motivo: "«host conosciuto» è un dato del singolo host" },
  { chiave: "modulo.unifi", motivo: "i controller UniFi hanno le loro righe fra i job: lettura degli apparati e dei client, per controller" },
  { chiave: "modulo.appliance", motivo: "è la scheda dell'appliance stessa: non si accende né si spegne" },
  { chiave: "notify_smtp_secure", motivo: "TLS sulla porta 465 è un parametro del canale email, non una funzione" },
  // Parametri (23/10): i dati restano nelle schede, qui solo i valori con un «di serie».
  ...["notify_smtp_host", "notify_smtp_port", "notify_smtp_user", "notify_smtp_password_encrypted", "notify_smtp_from", "notify_smtp_to"].map(
    (chiave) => ({ chiave, motivo: "dato del canale email (server, utente, mittente, destinatari): resta in Impostazioni › Notifiche" }),
  ),
  ...["notify_webhook_url", "notify_webhook_auth_encrypted"].map(
    (chiave) => ({ chiave, motivo: "dato del canale webhook (indirizzo e intestazione): resta in Impostazioni › Notifiche" }),
  ),
  { chiave: "wazuh_alerts_self_ips", motivo: "elenco dei nostri IP e reti: è un dato, resta in Impostazioni › Alert sicurezza" },
  { chiave: "wazuh_alerts_self_accounts", motivo: "elenco dei nostri account di servizio: è un dato, resta in Impostazioni › Alert sicurezza" },
  { chiave: "integration_wazuh_device_rule_ids", motivo: "le regole degli apparati da raccogliere sono un elenco di dati, resta in Impostazioni › Alert sicurezza" },
  ...["quick_scan_concurrency", "quick_scan_host_timeout_s", "quick_scan_exec_limit_ms"].map((chiave) => ({
    chiave,
    motivo: "scritta dalla vecchia scheda Scansione e mai letta dallo scanner: ignorata apposta (le chiavi vere sono scansione_veloce.*)",
  })),
  { chiave: "MDM_SYNC_INTERVALLO_MINUTI", motivo: "è il ritmo del job mdm_sync creato all'accensione: si vede in Schedulazioni" },
  { chiave: "GIORNI_REGISTRO_PULIZIA", motivo: "conservazione tecnica del registro delle pulizie, non regola cosa si archivia" },
];
