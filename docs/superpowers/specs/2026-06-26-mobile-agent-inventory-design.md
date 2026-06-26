# Mobile Agent Inventory — Backend DA-IPAM + contratto API

> Data: 2026-06-26 · Stato: design approvato (brainstorming) · Scope: **solo backend DA-IPAM + contratto API**. L'app Android DPC è una spec separata che si sviluppa contro questo contratto.

## 1. Problema e obiettivo

DA-IPAM oggi classifica i device via discovery agentless (nmap/SNMP/ARP/MAC OUI) e via agente
(Wazuh/GLPI), ma entrambi i percorsi agente assumono un OS desktop/server (Windows/Linux/macOS).
I **device mobili aziendali (Android, e marginalmente iOS)** restano `unknown` o privi di
inventario profondo.

Vincoli tecnici accertati durante il brainstorming:

- Seriale HW, lista app, profilo utente di un mobile **non sono ottenibili dalla rete** (niente
  SNMP/porte/WMI). Esistono solo on-device.
- Su **Android**, seriale HW (`Build.getSerial()`) + **lista completa app** richiedono che l'app
  sia **Device Owner (Fully Managed)** — Android 10+. I device sono 100% aziendali, quindi il
  provisioning Device Owner (QR/NFC) è accettabile.
- Su **iOS** un'app normale non può leggere seriale né app installate (muro Apple: serve essere un
  MDM con Apple Business Manager). iOS resta quindi **best-effort** (modello/OS/nome device) e
  non bloccante per questa spec.

**Obiettivo**: i mobili aziendali compaiono nell'inventario **come PC/server (host first-class)**,
con un **profilo dati dedicato** (seriale, modello, OS, security patch level, app installate,
utente), e con **storico delle modifiche nel tempo** (per requisiti NIS2). I dati arrivano via
**push dell'agente quando il device è sulla rete aziendale**.

### Non-goal (esplicitamente fuori scope)

- L'app Android DPC (build Kotlin, provisioning, firma, distribuzione) → spec separata.
- Scansione VA sui mobili (basso valore: i telefoni espongono pochissimo).
- MDM completo (policy push, wipe, configurazione) — qui solo **inventario**.
- iOS deep inventory (richiede essere MDM ABM).

## 2. Architettura d'insieme

Tre attori:

1. **App Android DPC (Device Owner)** — client, fuori scope. Raccoglie inventario e fa **push
   HTTPS** verso DA-IPAM quando rileva la rete aziendale. Mantiene coda offline + retry (lato app).
2. **Backend DA-IPAM** (questa spec): enrollment, ingest idempotente, data model, storico, UI.
3. **Inventario host/device esistente**: i mobili confluiscono nelle tabelle `hosts`/`devices`
   già presenti. `os_family` esteso a `android`/`ios`; `device_type` = `smartphone`/`tablet`
   (categorie già esistenti in `device-classifications.ts`). Le info profonde vanno in **tabelle
   mobile dedicate** collegate all'host.

Direzione dati: **push** (il telefono è dietro NAT/rete mobile, non pollabile). Modello di
sicurezza **riusato da scanner-edge** (Bearer token per-device, bcrypt hash sul hub), ma direzione
opposta (agent→hub invece di hub→edge).

**Esposizione di rete**: il hub è raggiungibile **solo sulla LAN aziendale**. Nessun endpoint
pubblico, niente NAT traversal. La push avviene opportunisticamente quando l'app vede la rete
aziendale; `last_seen_at` riflette l'ultimo contatto sulla LAN.

### Risoluzione tenant (decisione architetturale)

Una push da mobile **non ha sessione NextAuth**, quindi il token deve risolvere il tenant.
Introduciamo un **indice globale `mobile_agent_registry`** (DB condiviso, non tenant) che mappa
`token_hash → tenant_id + agent_id`. Il middleware autentica la push contro l'indice, poi entra nel
contesto tenant (`withTenant`) per scrivere l'inventario. Il record completo dell'agente vive nel
**DB del tenant** (`mobile_agents`). Su appliance single-tenant l'indice collassa sul tenant
`DEFAULT` (nessuna complessità aggiunta in quel deployment).

## 3. Enrollment

- Admin, in `/settings` del tenant, crea un **Mobile Agent**:
  - Genera token: `crypto.randomBytes(32).toString("base64url")` (mostrato **una volta**).
  - Salva `token_hash` (bcrypt cost 12) + `token_encrypted` (AES-GCM, per re-display) nel DB tenant.
  - Inserisce riga in `mobile_agent_registry` (token_hash → tenant + agent_id), `state='active'`.
- La UI mostra un **QR di enrollment** che incapsula: `{ hub_base_url, enrollment_token, cert_pin }`.
  L'app Android lo scansiona durante il provisioning Device Owner.
- **Revoca** per-device: `state='revoked'` su `mobile_agents` + registry → il bearer successivo dà 401.

## 4. Transport / Auth

Endpoint (nessun layer NextAuth, come `edge-bridges`):

| Endpoint | Metodo | Auth | Scopo |
|---|---|---|---|
| `/api/mobile-agents/enroll` | POST | enrollment token | One-shot: l'app conferma enrollment, riceve metadata (agent_id, config push interval). |
| `/api/mobile-agents/inventory` | POST | Bearer per-device | Push periodica dell'inventario (JSON). Idempotente. |
| `/api/mobile-agents/heartbeat` | POST | Bearer per-device | (opt) keepalive leggero, solo `last_seen_at`. |

Middleware `authenticateMobileAgent(req)` — clone di `authenticateBridge` (DA-Vul-can
`src/lib/edge-bridges/auth.ts`):

1. Estrae `Authorization: Bearer <token>`.
2. Lookup in `mobile_agent_registry` (solo `state='active'`).
3. `bcrypt.compare(plaintext, token_hash)`.
4. Match → risolve `tenant_id`, aggiorna `last_seen_at`, ritorna `{ tenantId, agentId }`.
5. No match → `401` + `WWW-Authenticate: Bearer`.

TLS: nginx davanti al hub; TOFU/SPKI pinning lato app (riuso pattern
`scanner-edge-client.ts`), cert pin distribuito nel QR di enrollment.

**Idempotenza ingest**: ogni payload porta uno `snapshot_sha256`. Dedup come
`edge_uploads UNIQUE(sha256, agent_id)`: una push ripetuta (retry coda offline) non duplica storico.

## 5. Data model

### Indice globale (DB condiviso)

```sql
CREATE TABLE mobile_agent_registry (
  token_hash   TEXT PRIMARY KEY,   -- bcrypt
  tenant_id    TEXT NOT NULL,
  agent_id     INTEGER NOT NULL,   -- FK logica verso mobile_agents nel DB tenant
  state        TEXT NOT NULL DEFAULT 'active',  -- 'active' | 'revoked'
  created_at   TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_mobile_registry_state ON mobile_agent_registry(state);
```

### DB tenant (migrazioni in `db-tenant-schema.ts` → `applyMigrations()`)

```sql
-- Agente registrato (1:1 con un host mobile)
CREATE TABLE mobile_agents (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  label             TEXT NOT NULL,
  host_id           INTEGER REFERENCES hosts(id) ON DELETE SET NULL,
  token_hash        TEXT NOT NULL,
  token_encrypted   TEXT NOT NULL,
  platform          TEXT,            -- 'android' | 'ios'
  enrollment_mode   TEXT,            -- 'device_owner' | 'work_profile' | 'unmanaged'
  agent_version     TEXT,
  state             TEXT NOT NULL DEFAULT 'active',  -- 'active' | 'revoked'
  enrolled_at       TEXT,
  last_seen_at      TEXT,
  last_inventory_at TEXT,
  created_at        TEXT DEFAULT (datetime('now')),
  updated_at        TEXT DEFAULT (datetime('now'))
);

-- Snapshot corrente del profilo device (1:1 con agente)
CREATE TABLE mobile_device_inventory (
  agent_id            INTEGER PRIMARY KEY REFERENCES mobile_agents(id) ON DELETE CASCADE,
  serial              TEXT,
  model               TEXT,
  manufacturer        TEXT,
  os_family           TEXT,          -- 'android' | 'ios'
  os_version          TEXT,
  security_patch      TEXT,          -- es. '2026-05-01'
  user_profile        TEXT,          -- utente/owner assegnato
  imei                TEXT,          -- opzionale
  storage_total_mb    INTEGER,
  storage_free_mb     INTEGER,
  primary_mac         TEXT,          -- per merge con host di rete
  snapshot_sha256     TEXT,          -- ultimo snapshot applicato (idempotenza)
  last_inventory_at   TEXT
);

-- Lista completa app installate (stato corrente)
CREATE TABLE mobile_device_apps (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id      INTEGER NOT NULL REFERENCES mobile_agents(id) ON DELETE CASCADE,
  package_name  TEXT NOT NULL,
  app_name      TEXT,
  version_name  TEXT,
  version_code  INTEGER,
  system_app    INTEGER DEFAULT 0,
  first_seen    TEXT,
  last_seen     TEXT,
  UNIQUE(agent_id, package_name)
);

-- Storico append-only delle modifiche (NIS2)
CREATE TABLE mobile_inventory_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id    INTEGER NOT NULL REFERENCES mobile_agents(id) ON DELETE CASCADE,
  changed_at  TEXT DEFAULT (datetime('now')),
  change_type TEXT NOT NULL,    -- 'os_update'|'patch_update'|'app_added'|'app_removed'|'user_change'|'field_change'
  field       TEXT,             -- nome campo o package_name
  old_value   TEXT,
  new_value   TEXT
);
CREATE INDEX idx_mobile_history_agent ON mobile_inventory_history(agent_id, changed_at);
```

`os_family` deve accettare `android`/`ios`: estendere `auto-classify.ts` (oggi iOS→macos) e i
mapping di `device-classifications.ts` per riconoscerli come valori first-class.

## 6. Ingest & tracking

Su `POST /api/mobile-agents/inventory`:

1. Auth via `authenticateMobileAgent` → `{ tenantId, agentId }`.
2. `try/catch` su `req.json()`; validazione **Zod v4** del payload.
3. Calcolo/confronto `snapshot_sha256`: se identico all'ultimo applicato → `200 { deduped: true }`,
   aggiorna solo `last_seen_at`/`last_inventory_at`, nessuna scrittura storico.
4. Diff vs stato precedente:
   - Campi profilo (`os_version`, `security_patch`, `user_profile`, …) cambiati → riga
     `mobile_inventory_history` (`field_change`/`os_update`/`patch_update`/`user_change`).
   - App: confronto per `package_name` → `app_added` / `app_removed` / aggiornamento `version`.
5. Upsert `mobile_device_inventory` + `mobile_device_apps`.
6. **Merge host first-class**: trova/crea `hosts` per `primary_mac`/`serial` (riuso pattern
   `enrichHost*`), setta `os_family`, `device_type`, lega `mobile_agents.host_id`. Il mobile
   appare in inventario/subnet come un PC.

Tutte le scritture in transazione singola per push.

## 7. UI

- **Inventario**: i mobili compaiono nella lista host/device esistente (badge `smartphone`/`tablet`,
  `os_family` android/ios), filtrabili come gli altri.
- **Dettaglio host mobile**: pannello/profilo dedicato con seriale, modello, OS, security patch,
  utente, **lista app completa**, e **timeline modifiche** da `mobile_inventory_history`.
- **`/settings` → Mobile Agents**: crea agente (mostra QR + token one-time), lista agenti con
  `last_seen_at`/versione/stato, azione **revoca**.

## 8. Error handling

- `req.json()` sempre in `try/catch` → `400 Invalid JSON`.
- Validazione Zod → `400 { error: issues }` (`.issues`, non `.errors`).
- Auth fallita → `401` + `WWW-Authenticate: Bearer`.
- `decrypt()` token via `safeDecrypt()` nei path non critici.
- Tutte le route sotto `withTenantFromSession`/contesto tenant esplicito per evitare il fallback
  silenzioso su `DEFAULT.db` (vedi reference getDb tenant fallback).

## 9. Testing (senza app)

`scripts/test-mobile-agent.ts` (o curl) simula l'intero flusso contro un dev server:

1. Admin crea agente → ottiene token.
2. `enroll` con enrollment token.
3. `inventory` push #1 (profilo + 50 app) → verifica host creato, profilo popolato, app inserite.
4. Push #2 identica → `deduped: true`, nessuna riga storico.
5. Push #3 con OS aggiornato + 1 app aggiunta + 1 rimossa → verifica 3 righe `mobile_inventory_history`.
6. Revoca agente → push successiva `401`.

## 10. Sequenza implementazione suggerita

1. Migrazioni schema (registry globale + 4 tabelle tenant) in `applyMigrations()`.
2. `os_family` android/ios in `auto-classify.ts` + `device-classifications.ts`.
3. Middleware `authenticateMobileAgent` + helper DB (registry + tenant).
4. Endpoint enroll / inventory / heartbeat con Zod + dedup + diff/history.
5. Merge host first-class.
6. UI: settings (CRUD agenti + QR) + profilo mobile + timeline nel dettaglio host.
7. `scripts/test-mobile-agent.ts`.

> Branch governance DA-IPAM: sviluppo su `dev`, mai push diretta su `main` (promote via UI).
