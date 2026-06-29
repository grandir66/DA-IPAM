# MDM Mobile (Headwind) — DA-IPAM

## Scopo nel progetto

Connettore interno verso **Headwind MDM** (`hmdm-server`) per portare i
dispositivi mobili Android gestiti dentro l'inventario DA-IPAM. I mobili
confluiscono in `hosts` come asset di prima classe su una **rete sintetica
"Mobile (MDM)"** non instradata, così da essere correlati e gestiti come gli
altri host. Non è uno dei 6 moduli base del registry: è un'integrazione
attivabile per tenant, con UI in `/settings/mdm`.

## Funzioni principali

- **Client REST Headwind** (`hmdm-client.ts`), contratto verificato su hmdm 0.1.8:
  - login con `password = MD5(plaintext)` hex **UPPERCASE**; token in `id_token`;
  - device search con `pageNum` **1-based**;
  - `model` + lista app completa solo dal plugin deviceinfo (`DeviceInfoView`).
- **Sync mobili → host** (`mdm-sync.ts`): mapper Headwind → DA-IPAM. Pseudo-IP =
  device `number` (stabile/unico), CIDR sentinella `192.0.2.0/32` (RFC5737
  TEST-NET-1, mai instradato). Dedup per snapshot; diff append-only in
  `mobile_inventory_history`.
- **Rete sintetica idempotente**: `getOrCreateMobileNetwork()` crea/recupera la
  rete "Mobile (MDM)".
- **Config cifrata + runner**: configurazione MDM in `mdm_config`, esecuzione
  sync via `runMdmSync()` (schedulabile da cron, job `mdm_sync`).
- **Lookup per host**: dettaglio mobile per host via `/api/mdm/by-host/[hostId]`.

## Come si usa

1. **Configurazione**: in `/settings/mdm` (UI `MdmSettingsClient`) si imposta
   `baseUrl`, utente e password dell'istanza Headwind; credenziali cifrate.
2. **Test/Sync**: `/api/mdm/config` salva la config; `/api/mdm/sync` lancia il
   sync manuale; il cron `mdm_sync` lo esegue periodicamente.
3. **Consultazione**: i device compaiono come host nella rete "Mobile (MDM)" e
   nel dettaglio oggetto/host; storico in `mobile_inventory_history`.

## Architettura e integrazioni

- DA-IPAM gira in **systemd**; Headwind MDM è un server esterno raggiunto via
  REST + JWT (`id_token`).
- I mobili sono modellati come `hosts` su rete sintetica non instradata: nessuna
  scansione di rete, dati 100% pull dall'API Headwind.
- Storage su DB tenant: `mdm_config`, `mobile_inventory_history`, `hosts`,
  `networks`.
- Pattern: pull periodico (no push), diff snapshot-based per tracciare i cambi.

## File chiave

- `src/lib/integrations/hmdm-client.ts` — client REST Headwind (auth MD5-UPPER, paging).
- `src/lib/integrations/mdm-sync.ts` — mapper Headwind → host + rete sintetica.
- `src/lib/integrations/mdm-runner.ts` — `runMdmSync()` (entrypoint cron/API).
- `src/lib/integrations/mdm-config.ts` — config cifrata MDM.
- `src/app/(dashboard)/settings/mdm/page.tsx` + `MdmSettingsClient.tsx`.
- `src/app/api/mdm/{config,sync}/route.ts` + `by-host/[hostId]/route.ts`.
- `src/lib/cron/jobs.ts` — job `mdm_sync`.
- `src/lib/db-tenant-schema.ts` — tabelle `mdm_config`, `mobile_inventory_history`.
