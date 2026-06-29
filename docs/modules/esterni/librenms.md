# LibreNMS — DA-IPAM

## Scopo nel progetto

Integrazione con **LibreNMS** (NMS, SNMP polling) come sistema **esterno**
(`access: "external"`, chiave `librenms`). DA-IPAM non gestisce LibreNMS al suo
interno: sincronizza i propri host SNMP verso LibreNMS, embedda i grafici nelle
pagine device e lancia la dashboard LibreNMS completa (nuova tab / autologin
proxato). LibreNMS gira tipicamente in **Docker** (web + dispatcher sidecar);
DA-IPAM in systemd.

## Funzioni principali

- **Sync inventario → LibreNMS** (`librenms-sync.ts`): aggiunge a LibreNMS solo
  gli host con SNMP attivo (`snmp_data` non null); usa l'IP come hostname di
  polling e il nome DNS/custom come `sysName`. Gli host rimossi localmente
  vengono rimossi anche da LibreNMS; gli host senza SNMP sono ignorati.
  Mapping persistito in `librenms_host_map`.
- **Client API** (`librenms-api.ts`): wrapper REST sull'API LibreNMS
  (add/remove device, lookup).
- **Grafici embeddati**: le pagine device DA-IPAM incorporano i grafici LibreNMS
  via proxy autenticato (`librenms-proxy-auth.ts`, `librenms-web-session.ts`),
  con autologin web (cookie Laravel) e Host header per upstream loopback.
- **Launch dashboard**: la dashboard completa LibreNMS è raggiunta come URL
  esterno (`resolveLibreNMSOperatorUrl`), risolto dalla config integrazione o
  dalla entry vault launchpad.
- **Install Docker** (`docker-install.ts` / `docker.ts`): provisioning del
  container LibreNMS (richiede anche il sidecar dispatcher per il polling).

## Come si usa

1. **Configurazione**: in `/settings?tab=moduli#module-librenms` si imposta
   `mode` ≠ disabled + URL + API token (o si importa il JSON dell'installer).
2. **Sync**: il job cron `librenms_sync` (per rete o globale) spinge gli host
   SNMP verso LibreNMS; `syncNetworkToLibreNMS` / `syncAllNetworksToLibreNMS`.
3. **Grafici**: nelle schede device i grafici LibreNMS appaiono embeddati.
4. **Dashboard**: dal launchpad / card si apre la UI LibreNMS completa.

## Architettura e integrazioni

- LibreNMS gira in **Docker** (container web + container dispatcher con
  `SIDECAR_DISPATCHER=1` — il solo web NON fa polling). DA-IPAM in **systemd**.
- DA-IPAM mantiene il mapping host↔device LibreNMS nel DB tenant
  (`librenms_host_map`) e correla via IP.
- Config integrazione su hub (`getIntegrationConfig("librenms")`, modi
  disabled/...); URL pubblico risolto via `resolveIntegrationBrowserUrl`.
- Trasporto API e proxy via client dedicati; autologin per embedding sicuro.

## File chiave

- `src/lib/modules/registry.ts` — descrittore modulo `librenms` (external).
- `src/lib/integrations/librenms-sync.ts` — sync inventario → LibreNMS.
- `src/lib/integrations/librenms-api.ts` — client REST LibreNMS.
- `src/lib/integrations/librenms-db.ts` — mapping `librenms_host_map`.
- `src/lib/integrations/librenms-proxy-auth.ts`, `librenms-web-session.ts` —
  embedding grafici + autologin.
- `src/lib/integrations/{docker,docker-install}.ts` — provisioning container.
- `src/lib/integrations/config.ts` — config integrazione (modes).
- `src/lib/cron/jobs.ts` — job `librenms_sync`.
- `src/lib/db-tenant-schema.ts` — tabella `librenms_host_map`.
