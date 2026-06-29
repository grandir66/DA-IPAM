# RMM — Modulo Remote Control integrato (MeshCentral) in DA-IPAM

> Data: 2026-06-29 · Stato: design approvato (brainstorming) · Pattern: **adopt invece di build**.
> Decisione: NON costruiamo un agente RMM proprietario (rischio security endpoint non sostenibile).
> Adottiamo **MeshCentral** (Apache-2.0) come modulo Docker co-locato sull'appliance, una istanza
> per cliente. DA-IPAM orchestra: deploy agente, mappatura nodo↔host, **launch-out remote control**
> via login token SSO, e mini-icone presenza agenti. Esecuzione comandi e patch via MeshCentral =
> fasi successive.

## 1. Problema e obiettivo

DA-IPAM oggi fa inventory agentless + via agente (Wazuh/GLPI) e patch Windows via WinRM+Chocolatey,
ma **non ha controllo remoto interattivo né un canale comandi cross-NAT**. WinRM richiede
raggiungibilità diretta + credenziali per host; Wazuh è sola lettura (Active Response non
implementato). Manca la capability RMM richiesta: **controllo remoto, gestione patch, esecuzione
comandi remoti**.

Vincoli accertati nel brainstorming + verifica sui sorgenti:

- **Un agente proprietario è il pezzo a più alto rischio** (gira come SYSTEM/root con canale
  command-down): code-signing, integrità update, auth canale, anti-replay, risposta CVE → un prodotto
  di security a sé. L'utente non ha competenze per garantirne la security → **scartato**.
- **MeshCentral è Apache-2.0** (verificato: MeshCentral *e* MeshAgent) → uso MSP commerciale,
  integrazione da prodotto terzo e redistribuzione dell'agente ai client tutti permessi. **TacticalRMM
  scartato**: licenza proprietaria che vieta l'uso MSP senza licenza commerciale a pagamento.
- MeshCentral copre da solo **remote desktop/terminale + esecuzione comandi/script + file + power
  actions**, cross-NAT (agente in uscita, come Wazuh).
- Il **login token** per SSO è riproducibile offline: codec `encodeCookie` (AES-256-GCM) documentato
  nel sorgente MeshCentral, confermato dall'autore (issue #2932). Deep-link al nodo via
  `?login=<token>&node=<nodeid>&viewmode=11`.

**Obiettivo MVP**: dalla scheda device di DA-IPAM, un operatore avvia una **sessione di controllo
remoto** su quel device con un click (launch-out SSO), gli agenti arrivano sugli endpoint via script
UI + push WinRM, i nodi MeshCentral sono mappati agli host, e la lista discovery mostra **mini-icone
di presenza** (GLPI/Choco/Mesh/Wazuh).

### Non-goal (MVP)

- Costruire un agente RMM o un canale comandi proprietario (lo fa MeshCentral).
- Esecuzione comandi arbitrari da UI DA-IPAM (Fase 2, via MeshCtrl RunCommand).
- Patch dispatch via MeshCentral (Fase 3; il modulo Chocolatey/WinRM resta invariato).
- Embed iframe della UI MeshCentral (solo launch-out top-level navigation in MVP).
- Identità per-operatore dentro MeshCentral (MVP = service account, B-ready).

## 2. Decisioni di design (log)

| # | Decisione | Scelta |
|---|---|---|
| D1 | Topologia | **Una MeshCentral per appliance cliente** (Docker co-locato, dietro nginx TLS appliance, single domain). Isolamento massimo, nessun asset cross-cliente. |
| D2 | Modello UI | **Ibrido**: launch-out SSO per il remote desktop (MVP); ricostruzione UI via API per lista nodi/comandi (Fase 2). Il desktop interattivo resta sempre launch-out. |
| D3 | Scope MVP | Deploy agente + mappatura nodo↔host + **launch-out remote control** + mini-icone presenza + **manual-bind UI** per nodi unmatched. |
| D4 | Deploy agente | **Entrambi**: script install dalla UI (pattern inventory-agent) + push WinRM (pattern install-wazuh). |
| D5 | Auth handshake | **A — service account + login token**, progettato B-ready (passaggio a per-operatore = cambio dello `u=` nel token, non rewrite). |
| D6 | Config | **Per-tenant cifrata** (pattern MDM), AES-GCM via `crypto.ts`. |
| D7 | Icone presenza | **3 stati**: assente (grigio) / attivo (colorato) / stale (ambra). |
| D8 | Codec login-token | Port offline in `login-token.ts` con **self-check interop all'avvio** + fallback subprocess `node meshcentral.js --logintoken`. |
| D9 | Token launch-out | TTL **3 min + single-use (`once`)**, HTTPS-only, `Referrer-Policy: no-referrer`, nginx strip del param `login` dai log. |
| D10 | Provisioning | **Deploy-Appliance** possiede generazione chiave + un binario generico + `.msh` per-gruppo. |
| D11 | Scope spec | Spec unica DA-IPAM **+ sezione Deploy-Appliance** come dipendenza esplicita; due piani di implementazione separati (un repo ciascuno). |

## 3. Architettura d'insieme

```
APPLIANCE CLIENTE
┌────────────────────────────────────────────────────────────┐
│  DA-IPAM (Next.js, systemd)                                 │
│    modulo RMM ──┬── login-token (logintokenkey, offline)    │
│                 └── control.ashx WS client (nodes, addmesh) │
│  MeshCentral (Docker)  ◄── nginx TLS appliance (WS passthru)│
│    single domain = questo cliente                           │
└──────────────▲─────────────────────────────────────────────┘
               │ MeshAgent in uscita (cross-NAT, WSS)
       ┌───────┴────────┬───────────────┐
   endpoint Win     endpoint Linux   endpoint mac
   (MeshAgent)      (MeshAgent)      (MeshAgent)
```

Due canali DA-IPAM↔MeshCentral: (a) **control.ashx WebSocket** (management) per `nodes`/`addmesh`/
`meshes`; (b) **minting login token** offline con la `logintokenkey` condivisa, per il launch-out.
Config (URL, service user, `logintokenkey`, MeshID) in **settings tenant cifrati**.

## 4. Provisioning & prerequisiti (Deploy-Appliance — dipendenza bloccante)

L'ordine è load-bearing: ogni step abilita il successivo.

1. **Deploy container MeshCentral** — nuovo modulo `modules/meshcentral.sh` in Deploy-Appliance
   (sibling di `wazuh.sh`/`librenms.sh`). **Pin della versione esatta** (il codec è sorgente interno,
   non API stabile). Includere licenza Apache-2.0 + NOTICE Intel con il binario MeshAgent.
2. **`config.json` scritto UNA volta, deterministico** (non lasciare auto-generare i secret):
   - `settings.LoginCookieEncryptionKey` = chiave **pinned 160-hex (80 byte)**, generata una sola
     volta → rebuild/reset NON la rigenera (rischio #1, §9). Salvata cifrata lato DA-IPAM.
   - `settings.AllowLoginToken: true`.
   - `settings.CookieEncoding` = default base64 (registrare il valore: determina il branch encoder).
   - Reverse proxy: `tlsOffload: "127.0.0.1"` + `trustedProxy`; per-domain `certUrl`, `port`,
     `aliasPort: 443`, `redirPort`.
   - `lockAgentDownload: true`.
   - `userConsentFlags` (prompt desktop+terminal+file = 8+16+32, privacy bar 64),
     `consentMessages.autoAcceptOnTimeout: false`.
   - `sessionRecording { filepath, index:true, protocols:[1,2,101], maxRecordingDays }` — attivo,
     l'operatore non può disattivarlo.
3. **nginx WebSocket pass-through** sulla location MeshCentral: `proxy_http_version 1.1`,
   `Upgrade $http_upgrade`, `Connection "upgrade"`, `proxy_read/send_timeout >= 330s`. Senza, gli
   agenti si connettono ma le sessioni desktop/terminale muoiono in silenzio.
4. **Service account** (`svc-daipam`) **least-privilege** — solo i device group che deve raggiungere.
5. **Device group (mesh) creato PRIMA di script/token** (chicken-and-egg): via `control.ashx`
   `addmesh`, grant rights al svc account, **cattura il MeshID**, persisti in config tenant. Validare
   via `meshes` prima che qualunque route install-script ritorni.

DA-IPAM ottiene URL/chiave/MeshID dalla config tenant cifrata: scritti dall'install script
dell'appliance, o inseriti dall'admin nella settings page.

## 5. Componenti DA-IPAM (file da creare)

### `src/lib/integrations/meshcentral/`

| File | Scopo |
|---|---|
| `config.ts` | `getMeshConfig/saveMeshConfig/getMeshCreds` — config per-tenant (serverUrl, meshId, admin creds + `loginTokenKey` cifrati). Pattern `mdm-config.ts`. |
| `feature.ts` | `getMeshState/installMeshFeature/uninstallMeshFeature` — lifecycle feature-flag. Pattern `inventory-agent/feature.ts`. |
| `login-token.ts` | Codec AES-256-GCM **isolato** (port `encodeCookie`) + self-check interop. Rischio #1 — §9. |
| `control-client.ts` | Client `control.ashx` WS: `addmesh`, `meshes`, `nodes`, `getnetworkinfo`. Auth login-key cookie. |
| `mesh-sync.ts` | `syncMeshForTenant(): SyncResult` — una `nodes` call → resolve → upsert `mc_node`. Pattern `wazuh-sync.ts`. |
| `node-resolver.ts` | `resolveNodeToHostId(node)` — MAC→IP→hostname su TUTTE le iface, `isVirtualMac()` filter, `preferIp`. §7. |
| `deep-link.ts` | Costruisce `?login=<token>&node=<nodeid>&viewmode=11&hide=15` (case-sensitive, `node=` server-resolved). |
| `install-scripts.ts` | `buildMeshInstallScript(platform, params)` — meshagent generico + `.msh` per-gruppo. Pattern `inventory-agent/install-scripts.ts`. |
| `presence.ts` | `getEndpointAgentsForHosts(hostIds[])` — query batch (GLPI/Choco/Mesh/Wazuh). §8. |
| `schema.ts` | `applyMcSchemaMigrations/dropMcSchema` — `mc_node`, `mc_remote_session`, `mc_node_bind` (idempotente, FK order). §6. |

### `src/app/api/integrations/meshcentral/`

| Route | Scopo |
|---|---|
| `config/route.ts` | GET (requireAuth, public-safe) / POST (requireAdmin); su save semina cron `meshcentral_sync`. |
| `install-script/route.ts` | POST (requireAdmin) → `.msh` + script; valida MeshID esistente prima. |
| `host/[hostId]/remote-session/route.ts` | **POST (requireAdmin)** launch-out: minta token → URL deep-link, audit in `mc_remote_session`. §10. |
| `host/[hostId]/route.ts` | GET (requireAuth) stato Mesh singolo host (card). |
| `host-status/route.ts` | POST (requireAuth) presenza batch ≤1000 host_id → `Record<host_id, status|null>`. §8. |
| `nodes/route.ts` | GET (requireAuth) lista nodi (inclusi unmatched) per la UI manual-bind. |
| `bind/route.ts` | POST (requireAdmin) associa manualmente un nodo a un host → upsert `mc_node.host_id` + audit. §7. |

### Altri file nuovi

- `src/app/api/patch/install-meshagent/route.ts` — POST (requireAdmin + patchModuleGuard) push WinRM.
- `src/components/settings/meshcentral-card.tsx` — settings card (clone `inventory-agent-card.tsx`).
- `src/components/hosts/host-meshcentral-card.tsx` — host detail card (bottone "Controllo remoto").
- `src/components/integrations/meshcentral-host-badge.tsx` — mini-icona presenza (clone `wazuh-host-badge.tsx`).
- `src/components/integrations/meshcentral-unmatched.tsx` — UI manual-bind nodi unmatched.

## 6. Data model (DDL)

Parent prima di child (reverse su DROP). Timestamp `TEXT` ISO8601 `DEFAULT (datetime('now'))`,
niente CHECK rigidi su campi volatili, FK indicizzate.

```sql
CREATE TABLE IF NOT EXISTS mc_node (
  node_id        TEXT PRIMARY KEY,            -- nodeid MeshCentral
  host_id        INTEGER REFERENCES hosts(id) ON DELETE SET NULL,  -- nullable = unmatched
  mesh_id        TEXT NOT NULL,
  name           TEXT,
  rname          TEXT,                        -- computer name
  primary_ip     TEXT,
  primary_mac    TEXT,                        -- lowercase, non-virtual anchor
  osdesc         TEXT,
  conn           INTEGER DEFAULT 0,           -- conn&1 = online
  last_connect   TEXT,
  match_status   TEXT,                        -- 'matched' | 'unmatched' | 'manual'
  synced_at      TEXT DEFAULT (datetime('now')),
  created_at     TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_mc_node_host ON mc_node(host_id);
CREATE INDEX IF NOT EXISTS idx_mc_node_mesh ON mc_node(mesh_id);

CREATE TABLE IF NOT EXISTS mc_remote_session (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  host_id          INTEGER NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  node_id          TEXT REFERENCES mc_node(node_id) ON DELETE SET NULL,
  operator         TEXT NOT NULL,             -- operatore DA-IPAM reale (B-ready)
  mesh_user        TEXT NOT NULL,             -- 'user/<domain>/<svc|operator>'
  viewmode         INTEGER,                   -- 11 desktop / 12 terminale / 13 file
  token_expire_min INTEGER,
  token_once       INTEGER DEFAULT 1,
  status           TEXT DEFAULT 'minted',     -- minted | failed
  created_at       TEXT DEFAULT (datetime('now'))
  -- NESSUN token, NESSUNA chiave salvata qui.
);
CREATE INDEX IF NOT EXISTS idx_mc_remote_session_host_ts ON mc_remote_session(host_id, created_at DESC);

-- audit del binding manuale (chi ha associato cosa)
CREATE TABLE IF NOT EXISTS mc_node_bind (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  node_id     TEXT NOT NULL,
  host_id     INTEGER NOT NULL,
  operator    TEXT NOT NULL,
  created_at  TEXT DEFAULT (datetime('now'))
);
```

## 7. Mappatura nodo→host + manual-bind UI (MVP)

**Auto-resolve** (`node-resolver.ts`): riusa i primitivi esistenti `getHostByMac`/`getHostByIp`
(`src/lib/db-tenant.ts`) in ordine **MAC → IP → hostname**, iterando **tutte** le iface del nodo,
passando SEMPRE l'IP primario come `preferIp` per disambiguare collisioni MAC (bug B4 noto, fix
2026-06-23), ed escludendo MAC virtuali (`isVirtualMac()`: VRRP `00:00:5E:00:01:xx`, HSRP). Nessun
anchor deterministico → `match_status='unmatched'`, niente guessing.

**Manual-bind UI**: i nodi `unmatched` compaiono in `meshcentral-unmatched.tsx`; l'admin associa a
mano nodo→host via `POST .../bind` → upsert `mc_node.host_id`, `match_status='manual'`, riga in
`mc_node_bind`. Un re-sync NON sovrascrive un bind manuale.

## 8. Indicatori presenza agenti (batch, anti N+1)

Funzione unica `getEndpointAgentsForHosts(hostIds: number[]): Map<number, EndpointAgentCapabilities>`
— UNA query per sorgente, **mai** `getXxxById` dentro `.map()` (anti-regressione #8).

```ts
interface EndpointAgentCapabilities {
  glpi:  { present: boolean; lastSeen?: string };
  choco: { present: boolean; lastProbed?: string; probeStatus?: string };
  mesh:  { present: boolean; nodeId?: string; conn?: number; syncedAt?: string };
  wazuh: { present: boolean; agentId?: string; status?: string };
}
```

Sorgenti e freschezza (3 stati assente/attivo/stale):
- **Mesh**: `mc_node` JOIN su `host_id`. attivo = `conn&1` AND `synced_at > now-14d`; stale = matched ma vecchio/offline.
- **Wazuh**: `wazuh_agent` (`getWazuhAgentsByHostIds`). attivo = `status='active'` + sync fresco.
- **GLPI**: `inv_agent_endpoint.last_seen_at > now-7d`.
- **Choco**: ultimo probe via `patch_operations` MAX(id) GROUP BY host_id; attivo = exit_code 0.

Endpoint batch `host-status/route.ts` (cap ≤1000), prefetch unico in `discovery/page.tsx:695-709`,
Map passata a `renderCell` (`:1660-1783`). Nessuna fetch per-riga.

## 9. Login-token codec (rischio #1 — isolato)

Il codec è sorgente interno MeshCentral (`obj.encodeCookie`), non API pubblica; il fallimento è
**silenzioso** (login screen che ritorna). Layout: `iv[12] | authTag[16] | ciphertext`, base64
URL-safe con `+`→`@` e `/`→`$`, AES-256-GCM con `key.slice(0,32)`. Campi `{u:'user/<domain>/<user>',
a:3, time, expire, once}`. La chiave si carica come `Buffer.from(key,'hex')` (NON base64 — bug #2932).

Piano di resilienza:
1. **Isolamento** totale in `login-token.ts`.
2. **Golden-vector test**: al provisioning, `node meshcentral.js --logintoken user//<svc>` → fixture
   committata; il port deve riprodurre un token che il server round-trippa.
3. **Self-check interop all'avvio/health**: minta un token e verifica il login del svc user;
   **fallisce rumorosamente** (abort, niente launch-out rotto).
4. **Branch su `CookieEncoding`** (base64+`@$` vs hex), letto dalla config.
5. **Fallback subprocess**: se il codec risulta fragile su una versione, shell-out a
   `node meshcentral.js --logintoken ...` come minter canonico.

## 10. Flusso launch-out

`POST /api/integrations/meshcentral/host/[hostId]/remote-session`

1. `requireAdmin()` + `withTenantFromSession()`.
2. `req.json()` in **try-catch**; Zod-valida `{ viewmode?: 11|12|13 }`.
3. Risolvi `mc_node` per `hostId`; 404 se nessun nodo matched, warn se offline (`conn&1`==0).
4. Carica `loginTokenKey` via `safeDecrypt()`. **Mai loggato.**
5. Minta token: `u='user/<domain>/<svc>'` (B: `<operator>`), `a:3`, **`expire:3` min, `once` set**.
6. Deep-link: `https://<fqdn>/?login=<token>&node=<nodeid>&viewmode=<vm>&hide=15`. Usa `node=`
   (server-resolved), non `gotonode` (cold-link safe). Case-sensitive.
7. **Audit** in `mc_remote_session` (operator, mesh_user, node_id, viewmode, expire, once). No token, no key.
8. Ritorna `{ url }`. Client apre come **top-level navigation nel gesture utente** (pre-mint prima del
   click o `window.open` sincrono) per evitare il popup blocker. `rel=noreferrer`.

## 11. File esistenti da modificare

| File:linea | Modifica |
|---|---|
| `src/app/(dashboard)/discovery/page.tsx:1660-1783` | Aggiungi mini-icona Mesh (3 stati) dopo le 5 esistenti; legge solo dalla Map prefetchata. |
| `src/app/(dashboard)/discovery/page.tsx:695-709` | Aggiungi `POST .../host-status` nel `Promise.all` esistente → state Map. No fetch per-riga. |
| `src/app/(dashboard)/discovery/page.tsx:1391-1400` | Estendi il bitmask di sort "Profilo" per la presenza Mesh. |
| `src/lib/db-tenant-schema.ts` (CHECK `scheduled_jobs`) | Aggiungi `'meshcentral_sync'` alla lista `job_type IN (...)`. |
| `src/lib/db-tenant-schema.ts` (`TENANT_SCHEMA_SQL`/`TENANT_INDEXES_SQL`) | Hook `mc_node`/`mc_remote_session`/`mc_node_bind` CREATE-IF-NOT-EXISTS + indici. |
| `src/lib/cron/jobs.ts:106-115` | `case 'meshcentral_sync'`: import dinamico `syncMeshForTenant()`. |
| `src/lib/patch/ps-scripts.ts:176-232` | `buildMeshAgentInstallScript()` (clone `buildWazuhInstallScript`): `--meshServiceName` fisso, `Get-Service` deterministico, marker `MESHAGENT_ALREADY_INSTALLED_AND_RUNNING`. |
| `src/lib/patch/executor.ts:479-558` | `executeMeshAgentInstall()` (clone `executeWazuhInstall`): lifecycle DB, `packageId='meshagent'`, idempotenza, riusa `loadWinrmCredentialsForHost`/`runWinrmCommand`. |
| settings integrations page | Monta `<MeshCentralCard/>`. |
| Deploy-Appliance `modules/` + `deploy.sh --profile` | Nuovo `meshcentral.sh` + wiring profilo (§4). |

## 12. Sicurezza (mappata sulle regole)

- **api-auth (#2)**: `requireAdmin()` su token-mint, install-script, install-meshagent, bind,
  config-POST; `requireAuth()` su status/nodes GET.
- **crypto**: `loginTokenKey` + admin creds MeshCentral cifrati `encrypt()` AES-GCM in config tenant,
  letti `safeDecrypt()`, vault appliance **fuori da git** (incident 2026-06-16). Pin
  `LoginCookieEncryptionKey` (regen = tutti i token revocati → runbook tipo `ENCRYPTION_KEY`).
- **no secret in log/AI**: mai `console.log` di chiave/token; redazione negli error message; verifica
  il redactor/anonymizer di DA-IPAM includa `loginTokenKey`.
- **token**: TTL 3 min + `once`, HTTPS-only, `Referrer-Policy: no-referrer`, nginx strip `login` dai log.
- **MeshCentral side**: svc least-privilege; consent prompt + privacy bar; `sessionRecording` on;
  `lockAgentDownload:true`; template install pubblici senza token/MeshID (embed solo su
  `download=true`+`useStoredToken`, `bashQuote`/`psQuote`).
- **JSON.parse (#5)**: `req.json()` sempre in try-catch.

## 13. Fasi

- **MVP (Fase 1)**: provisioning (§4) + deploy agente (script + WinRM) + sync/mapping + **manual-bind UI**
  + **launch-out remote control** + audit + **mini-icone presenza (3 stati)**.
- **Fase 2**: esecuzione comandi via MeshCtrl RunCommand (job async + output + audit) + ricostruzione
  UI in DA-IPAM + identità per-operatore (B) + session recording per-operatore.
- **Fase 3**: patch dispatch via canale MeshCentral (trasporto alternativo a WinRM nell'executor →
  cross-NAT, niente cred per-host, apre Linux/mac).

## 14. Test plan

**Unit**: codec `login-token.ts` (golden-vector + byte-layout + sostituzione `@`/`$` + chiave hex);
`node-resolver.ts` (multi-NIC, virtual-MAC, collisione→`preferIp`, no-MAC→unmatched);
`applyMcSchemaMigrations` idempotente (run x2 su `:memory:`) + drop reverse; `presence.ts` (hostIds
vuoto → Map vuota, soglie freschezza); redactor (`loginTokenKey` assente).

**Integration**: feature install → tabelle esistono + job `meshcentral_sync` seminato +
`reloadTenantScheduler()` chiamato; `mesh-sync.ts` su mock `control.ashx`; remote-session route
(requireAdmin, audit scritto, no token persistito); `bind` route (manual override + no sovrascrittura
da re-sync); WinRM idempotenza (secondo `install-meshagent` → marker, no re-install).

**E2E smoke (appliance)**: provisioning group/key → install agente (UI + WinRM) → nodo compare → mappa
su host → icona Mesh verde → launch-out apre desktop (viewmode 11) via nginx WS → consent prompt →
sessione registrata. Self-check interop passa; rebuild MeshCentral con chiave pinned → token ancora validi.

## 15. Rischi & decisioni risolte

| Rischio | Sev | Mitigazione / decisione |
|---|---|---|
| `LoginCookieEncryptionKey` regen rompe i token in silenzio | alta | Pin chiave al provisioning (Deploy-Appliance) + self-check interop rumoroso (D8/D10). |
| Codec version-drift / `CookieEncoding=hex` | alta | Pin versione MeshCentral, golden-vector, branch su encoding, fallback subprocess (D8). |
| `loginTokenKey` = secret di impersonazione | alta | Cifrato at-rest, mint solo backend, mai a browser/log/AI (§12). |
| Token in URL leaka (history/referrer/proxy) | alta | TTL 3min + `once`, no-referrer, log strip (D9). |
| Launch-out browser fail (popup/CSP/WS) | alta | Top-level nav nel gesture, `node=`, nginx WS pass-through (§4/§10). |
| Group prima di script/token (chicken-egg) | alta | Provisioning ordinato: mesh+rights+MeshID prima di tutto (§4). |
| node→host ambiguo (multi-NIC/virtual MAC) | media | Resolver MAC→IP→hostname su tutte le iface + `preferIp` + unmatched→manual-bind (§7). |
| N+1 nelle icone presenza | media | Endpoint batch + Map prefetchata (§8). |
| Idempotenza push WinRM MeshAgent | media | Binario generico + `.msh` per-gruppo + `--meshServiceName` fisso + marker (§11). |
| Service account = confused-deputy | media | Least-privilege + consent prompt + audit operatore reale + token-mint con param `operator` (B-ready) (D5). |

## 16. Anti-regressione (checklist obbligatoria)

`requireAuth/Admin` su ogni route · migrazioni in `applyMigrations()`/CREATE IF NOT EXISTS (FK order) ·
`JSON.parse` server-side in try-catch · scheduler: chiamare `reloadTenantScheduler()` dopo seed job
(trap in-memory) · `npm run version:release` dopo la modifica · branch governance DA-IPAM: push solo
su `dev`, main solo via promote UI.
