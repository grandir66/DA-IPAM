# Graylog — DA-IPAM

## Scopo nel progetto

Integrazione con **Graylog** (log management enterprise) come sistema **esterno**
(`access: "external"`, chiave `graylog`). DA-IPAM non gestisce i log al suo
interno: provisiona/avvia lo stack Graylog (Graylog + OpenSearch + MongoDB) e ne
lancia la dashboard come URL esterno dal launchpad. È un modulo opzionale: se
non configurato, mostra solo la nota di setup.

## Funzioni principali

- **Provisioning stack Docker** (`graylog.ts`): orchestrazione dei container
  - Graylog `graylog/graylog:6.0`
  - OpenSearch `opensearchproject/opensearch:2.12.0`
  - MongoDB `mongo:6.0`
  con wait di readiness (ping MongoDB, ecc.), log job-store e
  `setIntegrationConfig` a fine installazione.
- **Launch dashboard**: la UI Graylog è raggiunta come URL esterno, risolto
  dalla config integrazione o dalla entry vault launchpad
  (`findLaunchpadEntry(creds, "graylog", "Graylog")`).
- **Stato modulo**: `getIntegrationConfig("graylog")` (mode disabled/...) +
  presenza entry launchpad determinano `installed` / `configured` / `enabled`
  in `resolveModules()`.

## Come si usa

1. **Configurazione/Installazione**: dalla card
   `/settings?tab=moduli#module-graylog` si imposta `mode` ≠ disabled + URL,
   oppure si importa il JSON dell'installer; l'installer Docker avvia lo stack.
2. **Accesso**: dal launchpad / card "Apri" si lancia la dashboard Graylog in una
   nuova tab.

## Architettura e integrazioni

- Lo stack Graylog gira in **Docker** (Graylog + OpenSearch + MongoDB).
  DA-IPAM gira in **systemd** e funge da provisioner/launcher, non da consumer
  dei log.
- Config integrazione su hub (`integration_graylog_*`), modi disabled/internal/
  esterni gestiti via `getIntegrationConfig` / `setIntegrationConfig`.
- L'accesso è puro launch esterno (nuova tab): nessun dato Graylog è importato
  nel DB DA-IPAM (a differenza di Wazuh, che invece sincronizza agent/CVE).

## File chiave

- `src/lib/modules/registry.ts` — descrittore modulo `graylog` (external).
- `src/lib/integrations/graylog.ts` — provisioning stack Docker + readiness.
- `src/lib/integrations/{docker,docker-install,job-store}.ts` — esecuzione
  container e log job.
- `src/lib/integrations/config.ts` — config integrazione (mode/url).
- `src/lib/integrations/public-url-server.ts` — risoluzione URL pubblico.
