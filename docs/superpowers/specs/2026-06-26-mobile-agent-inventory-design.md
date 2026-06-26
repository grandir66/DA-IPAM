# Mobile Device Inventory — Modulo MDM integrato (Headwind) in DA-IPAM

> Data: 2026-06-26 · Stato: design approvato (brainstorming) · Revisione 2: **adopt invece di build**.
> Decisione: NON costruiamo un agente/MDM custom. Adottiamo **Headwind MDM** (Apache-2.0) come
> modulo Docker integrato di default nell'appliance, e DA-IPAM consuma l'inventario via REST pull.
> Apple = fase futura, candidato **Commandment** (MIT).

## 1. Problema e obiettivo

DA-IPAM classifica i device via discovery agentless e via agente (Wazuh/GLPI), ma quei percorsi
assumono OS desktop/server. I **device mobili aziendali (Android)** restano `unknown` o privi di
inventario profondo (seriale, modello, OS, app, utente) — dati richiesti per asset management / NIS2.

Vincoli accertati nel brainstorming:

- Seriale/modello/app/utente di un mobile **non sono ottenibili dalla rete**: esistono solo on-device.
- Su Android serve un **agente Device Owner** (provisioning QR/zero-touch) per seriale + lista app completa.
- **Google Play Protect (2026)** blocca i launcher DPC custom sui device GMS: vale per *qualunque*
  agente custom, **incluso uno costruito da noi** → costruire da zero non dà vantaggi, solo lavoro.
- Esiste già una soluzione open-source matura e self-hostable: **Headwind MDM** (agente + server,
  Apache-2.0, v6.36 maggio 2026, Docker ufficiale). Flyve MDM scartato (archiviato 2021, solo Android ≤7).

**Obiettivo**: i mobili aziendali compaiono nell'inventario DA-IPAM **come PC/server (host
first-class)** con un **profilo dati dedicato** (seriale, modello, OS, security patch, app, utente) e
**storico modifiche**. La gestione device (enrollment, policy) la fa Headwind; **DA-IPAM consuma
l'inventario** via pull REST e lo fonde nell'asset inventory.

### Non-goal

- Costruire un agente Android o un MDM da zero (lo fa Headwind).
- Policy/wipe/kiosk management dentro DA-IPAM (resta nel pannello Headwind; DA-IPAM ci linka).
- Apple/iOS in questa fase (candidato futuro: Commandment, vedi §10).

## 2. Architettura d'insieme

```
[Android Device Owner]──HTTPS 443 + 31000──►[hmdm-server (Tomcat9)]──►[Postgres hmdm]
  (agente Headwind)                                ▲
                                                   │ REST + JWT (pull cron)
                                       [DA-IPAM connettore MDM]──► mobile_* tables + hosts (first-class)
```

Due sotto-progetti, repo separati (regola separazione progetti):

- **A — Modulo Docker `mdm`** (repo Deploy-Appliance): porta su nel container `hmdm-server` + Postgres
  dedicato, integrato di default nello stack appliance, togglabile.
- **B — Connettore MDM DA-IPAM** (repo DA-IPAM, questa spec è focalizzata qui): pull REST/JWT dal
  server hmdm, data model mobile, merge host first-class, UI inventario + timeline, link al pannello hmdm.

Topologia: appliance single-tenant su LAN aziendale. Headwind richiede Postgres (separato dallo
SQLite di DA-IPAM). I device si arruolano quando sono in rete aziendale (combacia col requisito utente).

### Esposizione di rete (decisione)

**Stesso dominio, porta dedicata.** hmdm-server è servito su `https://<dominio-appliance>:8443`
(pannello/REST) + porta **31000** per device comms, accanto a DA-IPAM su `:443`. Nessun DNS extra;
si aprono/instradano le due porte sulla LAN. Cert: riuso del cert appliance esistente (SAN copre il
dominio). Device port 31000 raggiungibile sulla LAN aziendale.

## 3. Componente A — Modulo Docker appliance (sintesi; spec dettagliata in Deploy-Appliance)

- Service `hmdm` (immagine ufficiale `headwindmdm/hmdm`, Ubuntu22+Tomcat9) + service `hmdm-postgres`.
- Env richiesti: `SQL_HOST/SQL_BASE/SQL_USER/SQL_PASS`, `BASE_DOMAIN`, `PROTOCOL=https`, `ADMIN_EMAIL`.
- DB Postgres creato esternamente + init automatica al primo avvio (entrypoint hmdm).
- Cert: monta il cert appliance (no certbot, già gestito a monte) o certbot opzionale.
- Toggle modulo come edge/wazuh/net-services; default ON nel profilo appliance.
- Healthcheck su `:8443/swagger-ui.html` (o endpoint health hmdm).

> Questa spec (DA-IPAM) tratta A solo come dipendenza. Il piano dettagliato del modulo Docker è una
> spec separata nel repo Deploy-Appliance.

## 4. Componente B — Connettore MDM DA-IPAM (focus di questa spec)

### 4.1 Configurazione

Tabella `mdm_config` (DB tenant): `base_url`, `username`, `password_encrypted` (AES-GCM via
`encrypt()`), `jwt_cached`, `jwt_expires_at`, `enabled`, `last_sync_at`, `last_error`,
`consecutive_errors`. Default `base_url` = service Docker locale.

### 4.2 Autenticazione

Login JWT verso hmdm (`POST /rest/public/jwt/login` o equivalente — confermare su Swagger del server
installato), cache del token + refresh on 401. Password cifrata at-rest, mai loggata.

### 4.3 Pull

Cron staggered su `scheduled_jobs` (riuso pattern Wazuh/LibreNMS), ogni N minuti:

1. GET lista device (`DeviceResource`) → per ciascun device: numero seriale, IMEI, modello,
   manufacturer, versione OS/Android, utente/employee, last seen.
2. GET app installate per device (`ApplicationResource` o campo del device sync).
3. Map → `mobile_device_inventory` + `mobile_device_apps`, diff → `mobile_inventory_history`,
   merge host first-class.

### 4.4 Data model (DB tenant — migrazioni in `db-tenant-schema.ts`)

```sql
CREATE TABLE IF NOT EXISTS mdm_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  base_url TEXT, username TEXT, password_encrypted TEXT,
  jwt_cached TEXT, jwt_expires_at TEXT,
  user_field TEXT DEFAULT 'description',   -- 'description'|'custom1'|'custom2'|'custom3': da dove leggere l'utente
  enabled INTEGER DEFAULT 0, last_sync_at TEXT, last_error TEXT,
  consecutive_errors INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS mobile_devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hmdm_device_id TEXT UNIQUE,        -- id/number del device su Headwind (chiave di sync)
  host_id INTEGER REFERENCES hosts(id) ON DELETE SET NULL,
  label TEXT, last_seen_at TEXT, last_sync_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Campi allineati a ciò che Headwind ESPONE realmente (DeviceInfo DTO).
-- NON disponibili da Headwind: manufacturer, security_patch, storage_*, MAC → omessi (no colonne fantasma).
CREATE TABLE IF NOT EXISTS mobile_device_inventory (
  device_id INTEGER PRIMARY KEY REFERENCES mobile_devices(id) ON DELETE CASCADE,
  serial TEXT, model TEXT,
  os_family TEXT, os_version TEXT,        -- os_family derivato ('android'); os_version = androidVersion
  user_profile TEXT,                      -- da Device.description o customN (configurabile)
  imei TEXT, imei2 TEXT, phone TEXT, cpu TEXT, battery_level INTEGER,
  snapshot_sha256 TEXT, last_inventory_at TEXT
);

-- Per-app limitato ai 4 campi di DeviceInfoApplication (plugin deviceinfo).
CREATE TABLE IF NOT EXISTS mobile_device_apps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id INTEGER NOT NULL REFERENCES mobile_devices(id) ON DELETE CASCADE,
  package_name TEXT NOT NULL,             -- applicationPkg
  app_name TEXT,                          -- applicationName
  version_name TEXT,                      -- versionInstalled (stringa, no versionCode)
  first_seen TEXT, last_seen TEXT,
  UNIQUE(device_id, package_name)
);

CREATE TABLE IF NOT EXISTS mobile_inventory_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id INTEGER NOT NULL REFERENCES mobile_devices(id) ON DELETE CASCADE,
  changed_at TEXT DEFAULT (datetime('now')),
  change_type TEXT NOT NULL,   -- 'os_update'|'patch_update'|'app_added'|'app_removed'|'user_change'|'field_change'
  field TEXT, old_value TEXT, new_value TEXT
);
```

`hosts.os_family` è una colonna **GENERATED VIRTUAL** derivata da `os_info` (oggi solo
Windows/Apple/Linux/Unknown). Va esteso il CASE per emettere `Android`/`iOS` quando `os_info` contiene
android/ios — operazione che tocca il noto "os_family ALTER bomb" (recovery via rebuild hosts, già
presente in `db-tenant.ts`). L'ingest scrive `os_info = "Android 15"`.

### 4.5 Ingest & tracking

Per device pullato: dedup per `snapshot_sha256` (no scrittura se invariato); diff campi/app →
`mobile_inventory_history`; upsert inventory+apps; merge in `hosts` per `primary_mac`/`serial`
(riuso `upsertHost`), set `os_info`/`os_family`, lega `mobile_devices.host_id`. Tutto in transazione.

### 4.6 UI

- **Inventario**: i mobili nella lista host esistente (badge smartphone/tablet, os_family android/ios).
- **Dettaglio host mobile**: profilo dedicato (seriale/modello/OS/patch/utente) + lista app + timeline storico.
- **`/settings/mdm`**: config connessione hmdm (URL/credenziali/enable), stato sync (`last_sync_at`,
  errori), **link al pannello Headwind** per gestione device/enrollment (QR lo genera hmdm, non DA-IPAM).

## 5. Error handling

- `req.json()` in try/catch → 400. Zod `.issues`. Route admin con `requireAdmin()`; route lettura `requireAuth()`.
- Connettore: timeout + retry su pull; `consecutive_errors` con auto-disable (pattern `vuln_scanners`);
  JWT refresh on 401; password via `safeDecrypt()`; nessun PII/credenziale nei log.
- Tutte le scritture tenant dentro `withTenant`/`withTenantFromSession` (no fallback `DEFAULT.db`).

## 6. Testing

`scripts/test-mdm-connector.ts`: contro un hmdm-server (Docker locale o mock) con ≥1 device arruolato,
verifica login JWT, pull, creazione host first-class, popolamento inventory+apps, dedup su 2° pull,
diff/history su device modificato. Mapping campi `DeviceResource` confermato leggendo lo Swagger reale.

## 7. Sequenza implementazione (componente B)

1. Migrazioni schema (`mdm_config` + 4 tabelle mobile) + estensione os_family android/ios.
2. Client hmdm (`src/lib/integrations/hmdm-client.ts`): login JWT, list devices, get apps.
3. Mapper + ingest (dedup/diff/history/host-merge) in `src/lib/integrations/mdm-sync.ts`.
4. Cron job staggered + registrazione in `scheduled_jobs`.
5. Endpoint `/api/mdm/*` (config CRUD admin, trigger sync manuale).
6. UI `/settings/mdm` + profilo mobile + timeline nel dettaglio host.
7. `scripts/test-mdm-connector.ts`.

## 8. Dipendenza dal componente A

Lo sviluppo del connettore (B) richiede un hmdm-server raggiungibile. Per sbloccare B in parallelo ad
A: avviare hmdm via Docker ufficiale in locale (un comando) e arruolare un device/emulatore di test, OPPURE
mockare le risposte REST a partire dallo Swagger. Il modulo appliance (A) finalizza il deploy di produzione.

## 9. Mapping campi (CONFERMATO dai DTO sorgente hmdm-server master, 2026-06-26)

Fonti: `common/.../rest/json/DeviceInfo.java`, `.../persistence/domain/Device.java`,
`plugins/deviceinfo/.../rest/json/DeviceInfoApplication.java`.

L'entità `Device` espone `info` come **stringa JSON serializzata** → va parsata (try/catch) per
ottenere il `DeviceInfo`. La lista app completa richiede il **plugin `deviceinfo` abilitato**.

| DA-IPAM | Headwind (campo reale) | Note |
|---|---|---|
| hmdm_device_id | Device.id / Device.number | `number` è l'id univoco device |
| serial | DeviceInfo.serial | dentro `info` JSON |
| model | DeviceInfo.model | manufacturer NON esiste |
| os_family | derivato = `'android'` | Headwind è Android-only |
| os_version | DeviceInfo.androidVersion | |
| imei / imei2 / phone | DeviceInfo.imei / imei2 / phone | |
| cpu / battery_level | DeviceInfo.cpu / batteryLevel | |
| user_profile | Device.description o customN | NON nativo → configurabile in `mdm_config` |
| last_seen_at | Device.lastUpdate (epoch ms) | convertire in ISO |
| apps[].package_name | DeviceInfoApplication.applicationPkg | plugin deviceinfo |
| apps[].app_name | DeviceInfoApplication.applicationName | |
| apps[].version_name | DeviceInfoApplication.versionInstalled | stringa, niente versionCode/system flag |

**Conseguenze architetturali:**
- **Merge host first-class per `serial` (primario) → `imei` → `number`**, NON per MAC (Headwind non
  espone il MAC). Se l'host già esiste con quel serial/imei lo si arricchisce; altrimenti si crea.
- Campi non disponibili da Headwind (manufacturer, security_patch, storage, MAC) restano `null`:
  eventualmente arricchibili in futuro incrociando con la discovery di rete (stesso host).
- `mdm_config` aggiunge `user_field` (`description` | `custom1` | `custom2` | `custom3`) per scegliere
  da dove leggere l'utente assegnato.
- Dipendenza: il connettore richiede gli endpoint del **plugin deviceinfo** (`DeviceInfoResource`) per
  l'inventario esteso + app; la lista app dei soli managed-apps via core non basta per "lista completa".

## 10. Fase futura — Apple/iOS

Candidato: **Commandment** (`cmdmnt/commandment`, **MIT**, Python+TS). Copre iOS/macOS via protocollo
Apple MDM + APNs (unica via sanzionata da Apple). Richiede **Apple MDM Push Certificate** +
TLS fidato + (per supervisione piena) Apple Business Manager. Manutenzione viva ma senza release
recenti → **valutarne la maturità quando si apre la fase Apple**. Architettura prevista identica:
Commandment come modulo Docker appliance + connettore pull DA-IPAM che riusa lo stesso data model
mobile (os_family già pronto per `iOS`). Nessun lavoro Apple in questa fase.
