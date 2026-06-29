# Patch Management — DA-IPAM

## Scopo nel progetto

Modulo interno (`access: "native"`, chiave `patch_management`) per il patching
Windows **CVE-driven** via Chocolatey. Partendo dai CVE rilevati (Wazuh /
software inventory) il modulo li mappa ai pacchetti software installati e
permette di lanciare upgrade mirati sugli host Windows via WinRM. UI nativa in
`/patch-management`. È una **feature opzionale per tenant**: quando spenta non
ha alcun impatto sul core.

## Funzioni principali

- **Feature flag per tenant**: stato gestito su hub `tenant_features`
  (`feature_key='patch_management'`), con cache in-memory TTL 60s.
  `isPatchEnabled(tenantCode)` / `getFeatureStatus()`.
- **Probe**: rileva su un host lo stato di Chocolatey e i pacchetti outdated
  (senza usare `Win32_Product` WMI).
- **Bootstrap**: installa/abilita Chocolatey sull'host Windows target.
- **Upgrade**: esegue l'upgrade di un pacchetto. Fire-and-forget: ritorna subito
  un `operationId`, prosegue in background e aggiorna la riga DB a fine run; la
  UI polla i log via `/api/patch/operations/[id]/logs`.
- **Matcher CVE → software**: associa un CVE a una riga `software_inventory` con
  strategia in cascata: `wazuh-package` (0.9) → `dictionary` (0.8) → `manual`
  (1.0, mai sovrascritto) → `name-fuzzy` (0.5, Levenshtein ≤2). UPSERT idempotente
  su `(cve_id, software_id)`.
- **Macchina a stati operazioni**: `patch_operations` con stati
  `queued → running → success | failed | reboot_pending`; stdout/stderr di
  Chocolatey loggati su file Windows (`C:\ProgramData\DA-IPAM\op-<id>.log`).
- **Install agent ausiliari**: script per installare Wazuh agent e MeshAgent
  sull'host (`install-wazuh`, `install-meshagent`).

## Come si usa

1. **Installazione modulo**: dalla card `/settings?tab=moduli#module-patch_management`
   o importando il JSON dell'installer (abilita il flag su `tenant_features`).
2. **Probe device**: `/api/patch/probe` su un host Windows per vedere lo stato
   Chocolatey e i pacchetti aggiornabili.
3. **Bootstrap**: se Chocolatey non presente, `/api/patch/bootstrap`.
4. **Matching CVE**: `/api/patch/matcher/run` popola le associazioni CVE→software;
   override manuale dalla UI.
5. **Upgrade**: dalla pagina `/patch-management` (o `/api/patch/operations`) si
   avvia l'upgrade; i log si seguono in tempo reale.

## Architettura e integrazioni

- DA-IPAM gira in **systemd**. L'esecuzione remota avviene via **WinRM**
  (`runWinrmCommand` / `loadWinrmCredentialsForHost`) verso gli host Windows.
- Credenziali WinRM mai loggate; decifrate solo con `safeDecrypt`.
- Sorgente CVE: tabelle `wazuh_vuln` (sync Wazuh) e dizionario interno per il
  mapping al package Chocolatey.
- Stato modulo: hub `tenant_features`; dati operativi su DB tenant
  (`patch_operations`, dictionary, log).
- Cron: il job patch può girare schedulato (vedi `src/lib/cron/jobs.ts`).

## File chiave

- `src/lib/modules/registry.ts` — descrittore modulo `patch_management`.
- `src/lib/patch/feature.ts` — feature flag (`isPatchEnabled`, `getFeatureStatus`).
- `src/lib/patch/executor.ts` — probe / bootstrap / upgrade via WinRM, stati operazione.
- `src/lib/patch/matcher.ts` — match CVE → `software_inventory` (cascata strategie).
- `src/lib/patch/dictionary.ts` — lookup nome software → package Chocolatey.
- `src/lib/patch/ps-scripts.ts` — script PowerShell (no `Win32_Product`).
- `src/lib/patch/{credentials,log-tailer,route-guard,schema,types}.ts`.
- `src/app/(dashboard)/patch-management/` — UI nativa.
- `src/app/api/patch/**` — probe, bootstrap, operations, cve, software, matcher,
  install-wazuh, install-meshagent.
