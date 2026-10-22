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
];
