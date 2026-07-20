# Inventory Agent (GLPI) — DA-IPAM

## Scopo nel progetto

Modulo interno (`access: "native"`, chiave `inventory_agent`) che raccoglie
l'**inventario software e hardware** direttamente dagli endpoint tramite il
**GLPI Agent** (Windows/Linux/macOS), in **push** verso DA-IPAM. Nessun server
GLPI e nessun Wazuh: l'agente invia il proprio inventario in JSON a un endpoint
di ingest di DA-IPAM, autenticato con un token per-tenant. È una feature
opzionale per tenant.

Complementare a Patch Management e all'inventario da Wazuh: qui la sorgente è
l'agente GLPI, con priorità alta sui dati (sovrascrive i detect di scan).

## Funzioni principali

- **Feature flag + token di ingest per tenant**: stato su hub `tenant_features`
  (`feature_key='inventory_agent'`); alla generazione l'admin vede il token in
  chiaro una volta, poi resta cifrato (`src/lib/inventory-agent/feature.ts`).
- **Ingest inventario GLPI**: parsing del JSON dell'agente
  (`parse-glpi-inventory.ts`), con mascheramento delle license key
  (`mask-license.ts`).
- **Enrichment host**: i dati GLPI alimentano gli host con **priorità superiore**
  ai detect di scan (nmap/SNMP/ARP/DNS) — `enrich-host.ts`. Match endpoint→host
  IP-first (un device GLPI che cambia IP viene ricollegato, `db.ts`).
- **Script di install per piattaforma**: generati dalla UI e serviti come
  download (`install-scripts.ts`, `client-downloads.ts`) per Windows/Linux/macOS.

## Come si usa

1. **Installazione modulo**: `/settings?tab=moduli#module-inventory_agent` →
   abilita il flag e genera il token di ingest.
2. **Distribuire l'agente**: scarica lo script di install per la piattaforma
   dalla UI e installalo sugli endpoint (embedda URL di ingest + token).
3. **Raccolta**: gli agenti inviano l'inventario in push; DA-IPAM lo ingerisce,
   maschera le license key, arricchisce l'host corrispondente.

## Architettura e integrazioni

- DA-IPAM (systemd) espone gli endpoint di ingest sotto
  `/api/integrations/inventory-agent/**` e `/api/hosts/[id]/inventory-agent`.
- Auth via token per-tenant (`auth.ts`); token cifrato at-rest.
- Schema dati su DB tenant (`schema.ts`, `db.ts`); l'URL pubblico di ingest è
  risolto da `public-url.ts`.

## File chiave

- `src/lib/modules/registry.ts` — descrittore modulo `inventory_agent`.
- `src/lib/inventory-agent/feature.ts` — feature flag + token lifecycle.
- `src/lib/inventory-agent/parse-glpi-inventory.ts` — parser JSON GLPI.
- `src/lib/inventory-agent/enrich-host.ts` — propagazione dati verso host.
- `src/lib/inventory-agent/{db,schema,auth,mask-license,public-url,client-downloads,install-scripts}.ts`.
- `src/app/api/integrations/inventory-agent/**` — ingest, token, install-script,
  script per piattaforma.
