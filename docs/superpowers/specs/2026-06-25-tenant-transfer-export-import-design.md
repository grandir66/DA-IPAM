# DA-IPAM Tenant Transfer — Export/Import per-tenant

Data: 2026-06-25
Stato: design approvato (brainstorming) — pronto per writing-plans
Branch: dev

## Obiettivo

Sistema efficace per **esportare tutto ciò che serve da un'installazione DA-IPAM**
(credenziali, subnet, discovery config, device, integrazioni/API, moduli, inventario)
in un **bundle unico portabile**, per:

1. **Disaster recovery / migrazione 1:1** — ricaricare un tenant identico su un nuovo server.
2. **Migrazione portabile** — importare su un install con `ENCRYPTION_KEY` **diversa** (re-key all'import).
3. **Feed verso collector centrale** — un altro DA-IPAM su cui si importano i bundle (per ora import manuale; push automatico e aggregazione dedicata = fase futura).

Un **solo formato** serve tutti e tre i casi.

## Contesto architetturale (stato attuale)

- **Multi-tenant hub-spoke**: `hub.db` (tenant, utenti, vault `system_credentials`, profili nmap/snmp/fingerprint/sysobj) + un DB per tenant `data/tenants/<codice>.db` (~63 tabelle).
- **Cifratura**: AES-256-GCM, `key = scrypt(ENCRYPTION_KEY, "da-ipam-salt", 32)`, formato `iv:tag:ct` ([src/lib/crypto.ts](../../../src/lib/crypto.ts)). La stessa `ENCRYPTION_KEY` (env) decifra hub.db e tutti i tenant DB. **Senza la chiave i secret esportati sono inutilizzabili.**
- **Data dir**: `resolveDataDir()` in [src/lib/data-dir.ts](../../../src/lib/data-dir.ts) (rispetta `DA_INVENT_DATA_DIR`).
- **Già esistente**: `/api/export` (CSV solo host), `/api/backup` (download raw DB — **bug**: path hard-coded `process.cwd()/data/ipam.db`, ignora `DA_INVENT_DATA_DIR`), `/api/inventory/ingest` (GLPI). Nessun export/import strutturato completo.

## Decisioni di design (prese in brainstorming)

| Tema | Decisione |
|---|---|
| Unità di export | **Per-tenant** (DB tenant + righe hub correlate + profili globali). Il DR del server intero = export in loop di ogni tenant. |
| Formato | **Unico bundle** `.dab` (tar.gz), logico tabella-per-tabella (NDJSON), **non** file SQLite grezzo. |
| Import mode | **Replace su tenant vuoto** (rifiuta o wipe-and-load esplicito se non vuoto). Upsert/merge idempotente = fase futura. |
| Cifratura | **Envelope** con passphrase di trasporto (re-key all'import) — vedi sotto. |
| Collector | Per ora = un DA-IPAM su cui si importa manualmente. Push/aggregazione = fase futura. |

### Livelli di dati (tier)

- **Tier 1 — Config & verità curata** (SEMPRE): `networks`, `credentials`, `network_credentials`, `host_credentials`, `device_credential_bindings`, `network_devices`, `network_router`, `ad_integrations`, `vuln_scanners`, `librenms_host_map` (config), config Wazuh, `scheduled_jobs`, `tenant_features`, `tenant_settings`, `excluded_ips`, `physical_devices`/`device_interfaces`/`device_interface_addresses`/`multihomed_links` (topologia), + profili globali hub (nmap/snmp/fingerprint/sysobj).
- **Tier 2 — Asset & inventario curato** (default ON): `hosts` (con `custom_name`/`classification_manual`/`notes`/`inventory_code`), `inventory_assets`, `asset_assignees`, `locations`, `services`, `service_asset_dependencies`, `licenses`, `license_seats`, `inventory_audit_log`.
- **Tier 3 — Storia discovery** (default OFF, opzionale): `scan_history`, `status_history`, `scan_logs`. Rigenerabile, pesante.
- **Tier 4 — Mirror esterni** (default ON): `wazuh_*`, `ad_computers`/`ad_users`/`ad_groups`/`ad_dhcp_leases`, `vuln_findings`, `dhcp_leases`.

> La classificazione esatta di OGNI tabella vive nel **registry** (vedi sotto); l'elenco qui è indicativo e va riconciliato con lo schema reale in fase di plan.

## Formato bundle `.dab` (tar.gz)

```
manifest.json          # vedi sotto
tenant.json            # metadata tenant (riga hub.tenants)
tables/<tabella>.ndjson  # una riga JSON per record; un file per tabella
profiles/<profilo>.ndjson  # tabelle globali hub (merge-by-name all'import)
```

### `manifest.json`

```json
{
  "format": "da-ipam-tenant-bundle",
  "formatVersion": 1,
  "appVersion": "0.3.x",
  "schemaVersion": <intero migrazioni tenant>,
  "tenantCode": "DEFAULT",
  "ragioneSociale": "...",
  "exportedAt": "<ISO, iniettato dal chiamante, non da Date.now nel core>",
  "tiers": ["config", "asset", "mirror"],
  "tables": { "networks": 12, "hosts": 340, ... },
  "encryption": {
    "scheme": "envelope-aes-256-gcm",
    "saltHex": "...",
    "sourceKeyFingerprint": "<encryptionKeyFingerprint() sorgente>"
  }
}
```

- **Generazione schema-driven**: si introspetta `sqlite_master` + `PRAGMA table_info`; ogni tabella DEVE essere classificata nel registry. **Colonne GENERATED escluse** dall'export e mai scritte all'import (es. `hosts.os_family` — vedi memoria *os_family ALTER bomb*).
- `exportedAt` e ogni timestamp sono passati dall'esterno (no `Date.now()` nel core, per testabilità/determinismo).

## Cifratura envelope (cuore del design)

`transportKey = scrypt(passphrase, randomSalt, 32)` (salt in `manifest.encryption.saltHex`).

Doppio strato:
1. **Outer** — l'intero archivio è cifrato con `transportKey` (protegge anche la PII: IP, hostname, dominio AD, share path).
2. **Inner (secret)** — ogni campo secret è **ri-wrappato**: decifrato con la `ENCRYPTION_KEY` sorgente → ri-cifrato con `transportKey`. Il plaintext non tocca mai il disco.

**Import**: passphrase → `transportKey` → decifra archivio → ogni secret decifrato con `transportKey` → **ri-cifrato con la `ENCRYPTION_KEY` di destinazione** → inserito. Funziona con chiave **diversa** (migrazione portabile) e **identica** (DR). Il collector potrà scartare i secret.

**Campi secret** (dichiarati per-tabella nel registry):
`credentials.encrypted_username`, `credentials.encrypted_password`,
`network_devices.encrypted_password`, `device_credential_bindings.inline_encrypted_password`,
`ad_integrations.encrypted_username`, `ad_integrations.encrypted_password`,
`vuln_scanners.token_encrypted`,
`system_credentials.password_enc`, `system_credentials.api_token_enc`, `system_credentials.extra_json_enc`.

> Conformità regola progetto: nessun secret in chiaro su disco/log; passphrase mai loggata; il bundle è cifrato at-rest.

## Engine condiviso + due superfici

- **Core** (`src/lib/transfer/`): `export.ts`, `import.ts`, `table-registry.ts`, `envelope.ts`. Pura logica, nessuna dipendenza da Next/runtime. Riceve i path DB e i secret-helper per dependency injection.
- **CLI** (`scripts/export-tenant.ts`, `scripts/import-tenant.ts`): funziona **a server spento**, risolve i DB via `resolveDataDir()`. Percorso DR robusto (l'app può essere rotta proprio quando serve ripristinare).
- **API + UI** (thin wrapper, admin-only): `POST /api/tenant/export`, `POST /api/tenant/import`, pagina in `/settings`. Stesso core. Rispetta le regole DA-IPAM: `requireAdmin()`, `withTenantFromSession`, Zod v4 (`.issues`), `JSON.parse`/`req.json()` in try-catch.

## Import: integrità e sicurezza

- **Una transazione** con `PRAGMA foreign_keys=OFF` durante il bulk load → poi `PRAGMA foreign_key_check` + `PRAGMA integrity_check` → rollback se fallisce (evita topo-sort delle FK).
- **Compatibilità schema**: rifiuta bundle con `schemaVersion` > target (l'app migra avanti, non indietro). Bundle più vecchio: ammesso (lo schema target è già migrato).
- **Tenant non vuoto**: rifiuta di default; richiede flag esplicito `--wipe` (CLI) / conferma UI per wipe-and-load.
- **Profili globali hub**: **merge-by-name** anche in replace mode (condivisi tra tenant, non azzerabili).
- **Registry completo garantito da test**: un test asserisce che ogni tabella di `sqlite_master` (tenant + hub-globali rilevanti) sia classificata nel registry → niente tabelle dimenticate o secret non dichiarati quando lo schema evolve.

## Fix collaterali

- `/api/backup`: sostituire path hard-coded con `resolveDataDir()` (stesso PR, basso rischio).
- **Da risolvere in plan**: scoping di `system_credentials` (hub-level, apparentemente senza `tenant_code`). Su appliance single-tenant è banale (tutte le righe = il tenant); multi-tenant va deciso quali righe appartengono al tenant esportato.

## Fuori scope (ora)

Upsert/merge idempotente · push automatico verso collector · UI aggregazione cross-tenant · storia discovery di default · export whole-install in un singolo file (si ottiene con N export per-tenant).

## Fasi

1. **Core + registry + envelope** + test "ogni tabella classificata".
2. **Export** (CLI → poi API/UI).
3. **Import replace** (CLI → poi API/UI) con verifica integrità + re-key.
4. **Smoke E2E**: export tenant DEFAULT → import su install con `ENCRYPTION_KEY` diversa → secret decifrabili, `integrity_check` verde, conteggi righe coerenti col manifest.

## Criteri di successo

- Export di un tenant produce un `.dab` cifrato con passphrase, conteggi nel manifest = righe reali.
- Import su install fresco con chiave diversa → tutti i secret decifrabili e usabili (connessioni/integrazioni funzionanti), `foreign_key_check` e `integrity_check` puliti.
- Nessun plaintext di secret né passphrase su disco o nei log.
- Aggiungere una tabella allo schema senza classificarla nel registry → il test fallisce.
