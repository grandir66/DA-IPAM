# Design — Integrazione nativa controller UniFi (arricchimento DB)

> Spec di progettazione. Stato: **bozza da approvare**. Data: 2026-10-12.
> Feature DA-IPAM: una integrazione **controller UniFi** di prima classe che
> **arricchisce il DB** (device, porte, adiacenze LLDP) coi dati del controller.
> A valle, la mappa `/topology` si popola da sola e ne beneficia tutto DA-IPAM.
> Driver: DTS (controller self-hosted `172.16.1.222`, 74 device, 72 con LLDP, oggi
> fuori da `network_devices`). Decisione di prodotto → ADR `0004` (DA-IPAM è
> l'appliance; i controller creano oggetti); scelte tecniche di questa integrazione →
> ADR `0005`. È la **tappa 2** del piano di miglioramento
> (`2026-10-12-piano-miglioramento-design.md`): correzioni in testa al piano.

## 1. Obiettivo

Se DA-IPAM conosce un controller UniFi, i suoi dati devono **entrare nel DB**:
switch/AP/gateway in `network_devices`, le loro **porte** in `switch_ports`, le
**adiacenze LLDP** in `device_neighbors`, con identità fisica in `physical_devices`.
Oggi gli apparati UniFi stanno nei `hosts` (classif. switch/access_point) e le
adiacenze mancano → la topologia è spoglia. Questa integrazione risolve **alla fonte**.

**Non** è un secondo "summary": la vista UniFi via SNMP esiste già
(`src/lib/scanner/snmp-query.ts` `summarizeUnifi`). Questa aggiunge il **layer API
controller** (inventario gestito AP/switch + porte + uplink LLDP) che SNMP non dà.

## 2. Architettura (conforme ai pattern DA-IPAM)

Si **copia la STRUTTURA da LibreNMS** (config/client/sync/cron/trigger/UI) e la
**DIREZIONE DATI da Wazuh** (`syncWazuhForTenant`: pull esterno → upsert nel tenant DB).

### 2.1 Config — hub-level key-value (non per-tenant, non una tabella)

Come le altre integrazioni, la config sta in `settings` (DB **hub**), chiavi
`integration_unifi_*`, gestite da `src/lib/integrations/config.ts`
(`getIntegrationConfig("unifi")` / `setIntegrationConfig`). Un'installazione = un
cliente, quindi un controller per install. Campi:

- `integration_unifi_mode`: `external` | `disabled`
- `integration_unifi_kind`: `self_hosted` | `udm` | `cloud`  *(nuovo campo, vedi §6)*
- `integration_unifi_url`: es. `https://172.16.1.222:8443` (self/udm) o vuoto (cloud)
- `integration_unifi_site`: site name (default per self-hosted; es. `3oumjv0i` per DTS)
- `integration_unifi_username` + `integration_unifi_password` (cifrato) — self-hosted
- `integration_unifi_api_token` (cifrato) — udm/cloud (`X-API-KEY`)

Estendere in **3 punti** (gotcha): `IntegrationComponent` (`types.ts`), `DEFAULTS`
(`config.ts`), `VALID_COMPONENTS` (`api/integrations/[component]/route.ts`).

### 2.2 Client API multi-backend — `src/lib/integrations/unifi-api.ts`

`createUnifiClient(cfg): UnifiClient` con `probe()` (stile `librenms-api.ts`:
distingue auth/network/server) e `listDevices(): Promise<UnifiDevice[]>`:

- **self_hosted** (Network App classica): `POST /api/login {username,password}` →
  cookie di sessione (+ CSRF) → `GET /api/s/<site>/stat/device`. Riuso del pattern
  cookie/session in `src/lib/integrations/librenms-web-session.ts`; pool HTTP
  `src/lib/integrations/http-pool.ts`.
- **udm** (UniFi OS locale): `GET /proxy/network/integration/v1/sites/<id>/devices`
  header `X-API-KEY`.
- **cloud** (Site Manager): `GET https://api.ui.com/v1/hosts|sites|devices` header `X-API-KEY`.

`UnifiDevice` normalizzato: `{ mac, model, name, type('usw'|'uap'|'ugw'|...), ip,
state, version, serial?, port_table?[], lldp_table?[] }`.

### 2.3 Sync — `src/lib/integrations/unifi-sync.ts`

`export async function syncUnifiForTenant(): Promise<UnifiSyncResult>` (firma e
gestione errori come `librenms-sync`: non lancia, accumula in `errors[]`, fa
`probe()` prima). Gira **dentro `withTenant(code, ...)`** (da cron) o
`withTenantFromSession` (manuale). **Import di `db-tenant` STATICI in testa**
(gotcha critico, presidiato da `no-dynamic-db-tenant-import.test.ts`).

Per ogni `UnifiDevice`:
1. **Device** → `network_devices`. Dedup: `resolveMacToNetworkDevice(mac)` →
   altrimenti `getNetworkDeviceByHost(ip)` → se trovato `updateNetworkDevice`, else
   `createNetworkDevice` (vendor `ubiquiti`, device_type `switch|access_point|router`,
   model, host=ip, protocol `api`).
2. **Identità fisica** → `resolvePhysicalDevice(device, probe)` (serial 100 / MAC 80),
   poi `setNetworkDevicePhysicalDevice` → dedup col record `hosts` dello stesso chassis.
3. **Porte** (da `port_table`) → `upsertSwitchPorts(deviceId, ports)` (DELETE+INSERT in
   transazione), portando `trunk_neighbor_name/port` dal `lldp_table` di porta.
4. **Adiacenze** (da `lldp_table`) → `upsertNeighbors(deviceId, neighbors)` (protocol
   `lldp`, remoteDevice/remotePort/remoteMac/remoteIp).

`UnifiSyncResult = { added, updated, portsUpserted, neighborsUpserted, skipped, errors[] }`.

### 2.4 Trigger manuale — `src/app/api/integrations/unifi/sync/route.ts`

`POST` identico a `/api/integrations/librenms/sync`: `withTenantFromSession` →
`requireAdmin` → `syncUnifiForTenant()` → `NextResponse.json(result)`.

### 2.5 Scheduler — job `unifi_sync`

- Estendere il **CHECK constraint** di `scheduled_jobs.job_type` con `'unifi_sync'`
  (migration: SQLite non altera CHECK → ricreazione tabella guardata, oppure verificare
  se i job si creano via API con validazione lato codice — vedi §9).
- `src/lib/cron/jobs.ts`: `case "unifi_sync": await syncUnifiForTenant(); break;` con
  **import statico** di `syncUnifiForTenant` (come LibreNMS, non come il dinamico Wazuh).
- Lo scheduler (`src/lib/cron/scheduler.ts`) è generico: nessuna modifica.

### 2.6 UI — `src/components/settings/`

Card nella tab "moduli" (`modules-tab.tsx`). `IntegrationCard` è generico su
`component`, ma UniFi ha il campo **`kind`** (self_hosted/udm/cloud) e campi
condizionati → serve una **`UnifiCard`** dedicata (precedente: `WazuhCard`), con:
selettore kind, url, site, username/password o api_token, pulsanti **Test** (→
`GET /api/integrations/unifi/test-connection`) e **Sincronizza** (→ `POST
/api/integrations/unifi/sync`). Salvataggio: `PUT /api/integrations/unifi` poi `load()`.

## 3. Mapping puro (testabile) — `src/lib/integrations/unifi-map.ts`

Funzioni **pure** (TDD node:test), separate da HTTP e DB:
- `mapUnifiDeviceType(unifiType): "switch"|"access_point"|"router"|null`
- `mapUnifiDevice(d): { name, host, device_type, vendor, model, serial, mac }`
- `mapUnifiPorts(d): Omit<SwitchPort,"id"|"device_id"|"timestamp">[]`
- `mapUnifiLldp(d): { localPort, remoteDevice, remotePort, protocol, remoteMac?, remoteIp? }[]`

## 4. Sicurezza

- Credenziali **cifrate** (`encrypt`/`safeDecrypt`, richiede `ENCRYPTION_KEY`); config
  secret solo via `writeSecret`. Account controller in **sola lettura** (DTS: `map`).
- Auth su ogni rotta (`requireAdmin` per PUT/sync); `JSON.parse` in try-catch.
- La sync **scrive** solo nel tenant DB (arricchimento), **mai** sul controller.

## 5. Non distruttività

Additivo: nuove chiavi `settings`, nuovo `job_type`, nuove rotte, nuova card UI, nuovi
file `unifi-*`. Upsert (niente DELETE dei dati esistenti se non il replace-in-transazione
di porte/vicini del device sincronizzato). Nessuna modifica a SNMP/discovery esistenti.

## 6. Multi-backend: il campo `kind`

A differenza di LibreNMS (solo token), UniFi ha 3 famiglie. Il `kind` seleziona
auth+endpoint nel client. DTS = `self_hosted` (session, account `map`). Domarc =
`cloud` (api.ui.com, key in vault `da-IPAM-accessi.md`, da ri-permessare in lettura).

## 7. Testing

- `unifi-map.ts`: unit test puri (node:test) — fixture di `UnifiDevice` di forma reale →
  network_device/porte/vicini attesi; type mapping; porte senza LLDP; device senza MAC.
- Client/sync/UI: build + lint + tsc verdi; verifica manuale di una sync reale su DTS
  (conta device/porte/vicini prima/dopo).

## 8. Fasi

- **A — config + client**: whitelist `unifi`, campi config, `unifi-api.ts` (self_hosted
  session) + `probe`, rotta config + test-connection.
- **B — mapping + sync**: `unifi-map.ts` (TDD) + `unifi-sync.ts` (pull→upsert) + trigger
  manuale. **È la fase che riempie il DB** → verificare sulla mappa DTS.
- **C — scheduler**: `unifi_sync` job (migration CHECK + jobs.ts).
- **D — backend udm/cloud**: estendere `unifi-api.ts` (X-API-KEY) + `kind`.
- **E — UI**: `UnifiCard` in modules-tab.
- **F — rifinitura mappa** (piano topologia, separato): scope host-as-device, archi
  dritti, icone, connessioni editabili via `physical-devices/link`.

## 9. Aperti / da confermare

- **Migration del CHECK `scheduled_jobs.job_type`**: verificare come viene creato il
  record `librenms_sync` (API con validazione lato codice? seed?) per scegliere tra
  ricreazione tabella vs validazione applicativa.
- **Client UniFi**: gli apparati UniFi espongono anche i **client Wi-Fi** (→ `hosts`): per
  ora **fuori scope** (solo apparati di rete); valutarlo come arricchimento host in F.
  *Deciso il 12/10 sera (ADR 0004, decisione 5): i client diventano host — tappa 4
  del piano di miglioramento, dopo le fondamenta della tappa 3, insieme al backend Omada.*
- **Endpoint esatti udm/cloud** e scoping della cloud API-key (Domarc) — da verificare in D.
- **Relazione Proxmox hypervisor→VM** sulla mappa: arricchimento separato (fase F).
