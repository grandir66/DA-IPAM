# Wazuh SIEM — DA-IPAM

## Scopo nel progetto

Integrazione con **Wazuh** (XDR/SIEM: Manager + Indexer/OpenSearch + Dashboard)
come sistema **esterno** (`access: "external"`, chiave `wazuh`). A differenza di
Graylog, Wazuh non è solo un launch: DA-IPAM **importa** dal Wazuh dati di agent,
hardware, OS, software e **vulnerabilità (CVE)**, correlandoli agli host del
tenant. È singolo per il deployment Domarc (es. `da-wazuh.domarc.it`): ogni
tenant vede solo i propri agent dopo il matching. La dashboard si lancia come URL
esterno.

## Funzioni principali

- **Config hub-level** (`wazuh-config.ts`): credenziali del Manager REST API
  (es. `https://da-wazuh.domarc.it:55000`, utente RBAC read-only "da-ipam") e
  dell'Indexer/OpenSearch (es. `:9200`, utente "da-ipam-os"). Password cifrate
  AES-GCM. Flag `verifyTls` per cert self-signed.
- **Client Manager** (`wazuh-api.ts`): REST 4.x, Basic Auth → JWT (cache ~15min,
  rinnovo su 401), `node:https` raw. Endpoint `/agents`,
  `/syscollector/{id}/{hardware|os|packages|netiface}`, `/vulnerability/{id}`.
- **Client Indexer** (`wazuh-indexer-api.ts`): CVE da OpenSearch (Wazuh 4.8+),
  conversione documento → `wazuh_vuln`.
- **Sync → DB tenant** (`wazuh-sync.ts`): per ogni agent match host nell'ordine
  IP > MAC (netiface) > hostname; persiste agent meta, HW, OS, software,
  vulnerabilità, ports, hotfix, netiface/netaddr, process, service, netproto
  (strategia replace); elimina gli agent non più presenti su Wazuh; arricchisce
  l'host (`enrichHostFromWazuh`).
- **Sorgente CVE per Patch Management**: le righe `wazuh_vuln` alimentano il
  matcher CVE→software del modulo Patch Management (strategia `wazuh-package`,
  confidence 0.9).
- **Launch dashboard**: la UI Wazuh (Dashboard, non il Manager API:55000) è
  raggiunta come URL esterno dal launchpad/card.

## Come si usa

1. **Configurazione**: dalla card `/settings?tab=moduli#module-wazuh` (o
   `/settings/integrations`) si abilita Wazuh, si inseriscono URL Manager +
   credenziali RBAC e URL Indexer + credenziali OpenSearch.
2. **Sync**: il job cron `wazuh_sync` (`syncWazuhForTenant`) importa agent e CVE,
   matchandoli agli host; log con `matchedHosts/totalAgents`.
3. **Consultazione**: i CVE/agent arricchiscono le schede device DA-IPAM;
   alimentano il Patch Management.
4. **Dashboard**: dal launchpad si apre la UI Wazuh completa.

## Architettura e integrazioni

- Wazuh è un **server esterno** (cluster Manager + Indexer + Dashboard), non in
  Docker locale all'appliance. DA-IPAM gira in **systemd** e fa solo da consumer
  via API.
- Correlazione su `hosts` via IP/MAC/hostname; dati Wazuh in tabelle dedicate
  (`wazuh_agent`, `wazuh_hw`, `wazuh_os`, `wazuh_software`, `wazuh_vuln`,
  `wazuh_ports`, `wazuh_hotfix`, `wazuh_netiface`, `wazuh_netaddr`,
  `wazuh_process`, `wazuh_service`, `wazuh_netproto`).
- Config/credenziali su hub (`integration_wazuh_*`), password cifrate AES-GCM,
  mai inviate ad AI.
- Integrazione bidirezionale a livello dati: alimenta Patch Management (CVE) e
  l'arricchimento host.

## File chiave

- `src/lib/modules/registry.ts` — descrittore modulo `wazuh` (external).
- `src/lib/integrations/wazuh-config.ts` — config hub (Manager + Indexer, cifrata).
- `src/lib/integrations/wazuh-api.ts` — client Manager REST (JWT, syscollector).
- `src/lib/integrations/wazuh-indexer-api.ts` — client OpenSearch (CVE).
- `src/lib/integrations/wazuh-sync.ts` — `syncWazuhForTenant()` sync → DB tenant.
- `src/lib/integrations/wazuh-db.ts` — upsert/replace tabelle wazuh, enrich host.
- `src/lib/cron/jobs.ts` — job `wazuh_sync`.
- `src/lib/db-tenant-schema.ts` — tabelle `wazuh_*`.
