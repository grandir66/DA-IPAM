# Changelog

Tutte le modifiche notevoli al progetto DA-INVENT (alias DA-IPAM) sono documentate qui.
Formato: [Keep a Changelog](https://keepachangelog.com/it/1.1.0/) — versioni hub semver
incrementale, versioni agent indipendenti (`agent-vX.Y.Z`).

## [Unreleased] — branch `feature/remote-agents`

Aggiunge l'architettura **hub + agenti remoti via Tailscale**: l'hub IPAM
orchestra agenti Python installati presso i clienti, mantenendo invariato
il flusso per i tenant gestiti localmente.

### Added

#### Hub (Next.js)

- **Tabella `tenant_agents`** (`db-hub-schema.ts`): supporta **N agenti per
  tenant** (sedi diverse dello stesso cliente). Colonne: id, tenant_id FK,
  label, hostname, port, token_hash, token_encrypted, version, last_seen_at,
  subnet_match (riservato a routing per-subnet futuro), timestamps.
  Migrazione idempotente in `initializeHubDb()`: per ogni tenant con
  `agent_hostname` non-null, crea una riga in `tenant_agents` etichettata
  "Sede principale".
- **Pagina `/agents`** (`src/app/(dashboard)/agents/page.tsx`): overview
  cross-tenant di tutti gli agenti. Colonne: cliente, label/sede,
  hostname:porta, versione, ultimo heartbeat, stato live (online/error_code),
  azioni (Test, Configura, Elimina). Pulsanti "Ricarica", "Testa tutti".
- **Wizard "Nuovo agente"** (dialog 2-step + token):
  - Step 1: scelta cliente esistente (dropdown) o creazione cliente nuovo
    inline (codice + ragione sociale).
  - Step 2: configurazione agente (label/sede, hostname Tailscale, porta,
    subnet_match opzionale). Imposta automaticamente `agent_mode='remote'`.
  - Step 3: mostra token plaintext (una sola volta) + campo opzionale
    Tailscale auth-key + comando di install one-liner pre-popolato.
- **`Executor` abstraction** (`src/lib/executor/`):
  - `Executor` interface (`index.ts`): primitive ping/nmap/dns/macVendor.
  - `LocalExecutor` (`local.ts`): delega ai moduli `src/lib/scanner/*`.
  - `RemoteExecutor` (`remote.ts`): client HTTP verso agent via Tailscale,
    timeout per metodo, error envelope strutturato (`RemoteExecutorError`).
  - `getExecutor(tenantCode)`: legge `tenants.agent_mode` e pesca il primo
    agente da `tenant_agents` per i tenant remote.
- **`discoverNetwork`/`runDiscovery` instradano via executor** del tenant:
  shadowing trasparente di `pingSweep`/`nmapDiscoverHosts`/`nmapPortScan` —
  zero modifiche ai call site interni. Skip del check `isNmapAvailable` locale
  quando l'executor è remoto (l'hub si fida dell'agent).
- **Bottone "Testa connessione"** in `/tenants/[id]/agent` con badge
  esito (online + latency / error_code).
- **API tenant-agents** (per-agent CRUD):
  - `GET/POST /api/tenant-agents` (lista cross-tenant o filtrata; create).
  - `GET/PUT/DELETE /api/tenant-agents/[id]` (singolo).
  - `POST /api/tenant-agents/[id]/token` (genera, sovrascrive precedente).
  - `POST /api/tenant-agents/[id]/token/import` (importa token plaintext esistente).
  - `POST /api/tenant-agents/[id]/test` (call `/whoami` su agent).
- **API back-compat** `/api/tenants/[id]/agent*`: continuano a funzionare
  puntando al primo agent del tenant; le scritture creano l'agent se assente.
- **API `GET /api/agents`**: lista one-row-per-agent cross-tenant.
- **Endpoint pubblico `/agent-install.sh`**: serve lo script con
  `Content-Type: text/x-shellscript`, esente da auth middleware
  (consumabile via `curl|bash` da macchine senza sessione).
- **`scripts/hub-install.sh`** idempotente: apt-installs (nmap, snmpwalk,
  fping, arping, Kerberos, build-essential), `setcap` su nmap, crea venv
  pywinrm in `/root/.da-invent-venv`. Da usare dopo migrazioni LXC→VM.
- **Sidebar**: voce "Agenti remoti" (solo superadmin) con icona `ServerCog`.
- **Validazione hostname Tailscale** lato API (`PUT /agent`): regex
  MagicDNS short-name o FQDN, niente schemi `http://` o path.
- **Frontend `Tenant` interface** allineata: campi `agent_*` opzionali nel
  tipo della pagina `/tenants`.

#### Agent (Python / FastAPI)

- **v0.2.0** — riscrittura completa Phase 3:
  - Multi-token auth con `DA_INVENT_AGENT_TOKENS` (lista JSON di
    `{label, token_hash, scopes}`). Drop totale di `DA_INVENT_AGENT_TOKEN_HASH`.
  - **Scope enforcement**: `exec:network`, `exec:device`, `admin:update` o
    wildcard `*`. Dependency `require_scope(...)` per endpoint.
  - **Endpoint nuovi**:
    - `GET /whoami` — info token autenticato.
    - `POST /exec/snmp-walk` — wrapper `snmpwalk -Oqn`, v1/v2c/v3.
    - `POST /exec/arp-poll` — OID `1.3.6.1.2.1.4.22.1.2`, parser MAC
      robusto a 3 formati (colon, hex-string, RouterOS CHR quoted) +
      filtro MAC vuoti/zero.
    - `POST /exec/snmp-routes` — ipAddrTable + ipCidrRouteTable in
      parallelo, filtri `/32`, `/0`, link-local, multicast, loopback,
      dedup per CIDR.
    - `POST /exec/ssh-exec` — asyncssh con password o key, trunc stdout
      1 MiB / stderr 256 KiB.
    - `POST /exec/winrm-exec` — subprocess `winrm_bridge.py` (copia
      dell'hub), Kerberos auto-fallback NTLM→CredSSP→Basic.
  - **Error contract uniforme**: `{error: {code, message, retriable, details?}}`
    con codes: `tool_missing`, `auth_invalid`, `scope_denied`, `invalid_input`,
    `target_unreachable`, `timeout`, `parse_error`, `internal`.
  - **`/healthz` esteso**: `tools` (nmap, snmpwalk, ping, ssh), `network`
    (tailscale ok + tailscale_ip), cache 60s.
  - **OpenAPI export**: `agent/scripts/dump_openapi.py` +
    `check_openapi_fresh.sh` + pre-commit hook locale.
- **v0.2.1** — fix bug asyncssh: rimosso kwarg invalido `client_keys_load_path`,
  sostituito con `client_keys=[]` per disabilitare pickup automatico delle
  chiavi locali.
- **v0.2.2** — **UDP port scan** attivo (in v0.2.0/v0.2.1 era stubbato).
  Seconda fase nmap `-sU` con porte default (53,67,68,69,123,137,138,161,
  162,500,514,520,1900,4500,5060,5353) override-abili. Merge TCP+UDP senza
  duplicati su (port, protocol).
- **v0.2.3** — UDP scan funzionante in produzione:
  - `nmap.py` antepone `sudo -n /usr/bin/nmap` per il path UDP
    (nmap 7.94 su Ubuntu 24.04 hard-checka euid==0).
  - Systemd unit aggiornato: omesso `NoNewPrivileges` (per sudo +
    file caps), omesso `CapabilityBoundingSet` (impediva CAP_SETUID a
    sudo), omesso `MemoryDenyWriteExecute` (interferiva con runtime
    Python), aggiunto `AF_PACKET` a `RestrictAddressFamilies` (per
    libpcap).
  - Installer scrive `/etc/sudoers.d/da-invent-agent` con NOPASSWD
    limitato a `/usr/bin/nmap`, validato con `visudo -cf`.
- **v0.2.4** — installer one-liner ora gestisce Tailscale:
  - `install.sh` installa Tailscale (script ufficiale `tailscale.com/install.sh`)
    se mancante.
  - `tailscale up` con `TAILSCALE_AUTH_KEY` se fornito (fully automated)
    o interattivo (stampa URL da aprire nel browser).
  - Variabile `TAILSCALE_HOSTNAME` opzionale.

### Changed

- `getExecutor(tenantCode)` ora pesca il primo agent dal nuovo
  `tenant_agents` invece che dai campi `tenants.agent_*` (rimangono per
  back-compat ma deprecati).
- Endpoint `GET /api/agents` ritorna un row per agente (era un row per
  tenant in modalità remote).
- UI `/agents`: dropdown stati e azioni rifatti per multi-agent.

### Fixed

- **Reset password hash** corrotto da shell interpolation del `$` bcrypt
  attraverso doppio SSH. Procedura ora usa `ssh -J` + script via scp con
  parameter binding (vedi memo `feedback_no_shell_concat_hashes.md`).
- **Build hub su VM 533** mancava `nmap`, `snmpwalk`, `fping`, `arping`,
  Kerberos, venv pywinrm. `scripts/hub-install.sh` chiude il gap.
- **Rate limiter login** in-memory si pulisce al restart del servizio.

### Security

- Token plaintext mai persistiti né loggati: solo bcrypt hash + ciphertext
  AES-GCM (chiave da `ENCRYPTION_KEY`).
- Agent: redact di community SNMP, password SSH/WinRM nei subprocess args
  loggati (`SecretStr` pydantic).
- Origin check CGNAT (100.64.0.0/10) **prima** della verifica token
  sull'agent.
- Sudo NOPASSWD limitato esclusivamente a `/usr/bin/nmap` per l'agent user.

### Deploy notes

- Hub: dopo `git pull`, eseguire `bash scripts/hub-install.sh` su host nuovi
  o migrati per garantire le dipendenze di sistema.
- Agent: il flusso d'installazione completo è ora un singolo `curl|bash`
  generato dalla UI hub (pagina `/agents` → "Nuovo agente" → step 3).
- Migrazione dati: tenant esistenti con `agent_hostname` configurato
  vengono migrati automaticamente in `tenant_agents` al primo restart del
  hub (idempotente, no perdita).

### Note architetturali

- L'**aggiunta di un agente richiede un cliente esistente** (1 agente
  appartiene sempre a un tenant). Il wizard può crearne uno inline.
- Il **routing subnet→agent** è schematizzato (campo `subnet_match`) ma
  non ancora valutato: oggi il primo agente del tenant gestisce tutte le
  scansioni. Phase 7 introdurrà il dispatch per CIDR.

---

## Storico versioni (commit log)

| Tag/Versione | Commit | Note |
|---|---|---|
| `agent-v0.2.4` | `7501732` | installer gestisce Tailscale |
| (hub) | `43d5380` | aggiunto `scripts/hub-install.sh` |
| (hub v0.2.421) | `a9cb244` | skip isNmapAvailable locale per remote |
| `agent-v0.2.3` | `9ec4130` | UDP scan attivo + sudo fallback |
| (hub v0.2.420) | `103a952` | RemoteExecutor + scan flow wiring |
| `agent-v0.2.2` | `4e28670` | UDP scan implementato |
| (hub v0.2.419) | `543970c` | overview /agents + test endpoint |
| `agent-v0.2.1` | `01f7bb3` | fix asyncssh kwarg |
| `agent-v0.2.0` | `638b13b` | Phase 3 endpoints + multi-token |
| (hub v0.2.418) | `a660d6c` | Phase 2 agent skeleton |
| (hub v0.2.417) | `4c07873` | Phase 1 schema + Executor abstraction |

---

# 📘 Handoff — onboarding per la prossima istanza Claude

Sezione operativa per chi raccoglie lo sviluppo da qui in poi. Non sostituisce
[CLAUDE.md](CLAUDE.md) (regole stack/anti-regressione invarianti), ma copre
contesto di sessione, decisioni del branch `feature/remote-agents` e gotchas.

## 1. Contesto progetto in due paragrafi

**DA-INVENT** (alias DA-IPAM) è un IPAM multi-tenant Next.js 16 + better-sqlite3
con architettura **hub + spoke**: un DB SQLite per tenant (`data/tenants/<code>.db`)
e un hub condiviso (`data/hub.db`). Da Phase 1 il sistema supporta anche
**agenti Python remoti** installati presso i clienti, raggiunti via Tailscale,
che eseguono le primitive di rete (ping/nmap/SNMP/SSH/WinRM) dentro la rete
del cliente. L'hub orchestrazione resta uguale; l'`Executor` decide a runtime
se eseguire localmente o tramite agent.

Stato produzione (2026-05-12): hub su **VM 533** (Proxmox PX-04, IP interno
`192.168.4.8`, accessibile da chi sta sulla 192.168.4.0/24 o via jump host
`root@192.168.40.4`). Un agent live su `bridge-domarc-ovh` (Tailscale IP
`100.89.234.89`) servente il tenant `70791a` (DOMARC-OVH).

## 2. Architettura agenti remoti — modello mentale

```
┌────────────────┐                         ┌─────────────────────┐
│   DA-INVENT    │   HTTPS via Tailscale   │  da-invent-agent    │
│  hub (Next.js) │ ──────────────────────▶ │  (Python/FastAPI)   │
│   VM 533       │   Bearer token          │   N istanze per     │
│                │                         │   tenant possibili  │
└───────┬────────┘                         └──────────┬──────────┘
        │                                             │
        ▼                                             ▼
    hub.db                                      rete del cliente
  (orchestrazione)                            (scan, SNMP, SSH...)
```

- **1 tenant** può avere **N agenti** (es. sedi diverse). Tabella
  `tenant_agents` 1:N su `tenants`.
- Selezione agent: oggi `getExecutor()` usa il **primo** agent. Routing
  per-subnet via campo `subnet_match` è schematizzato ma **non** dispatched.
- Token: ogni agent ha 1 token plaintext, salvato hub-side come hash bcrypt
  (verifica) + ciphertext AES-GCM (per re-trasmetterlo all'agent al test).
  Il plaintext non è mai persistito. L'agent ha la sua copia (hash bcrypt
  in `/etc/da-invent-agent/config.yml`).

## 3. File map — dove vivono le cose

### Hub Next.js

```
src/lib/executor/             ← astrazione (introdotta in questo branch)
  ├── types.ts                ← interfacce I/O (PingResult, NmapResult, …)
  ├── index.ts                ← Executor interface + getExecutor(tenantCode)
  ├── local.ts                ← LocalExecutor (wrap src/lib/scanner/*)
  └── remote.ts               ← RemoteExecutor (HTTP → agent via Tailscale)

src/lib/db-hub-schema.ts      ← include `tenants` (con agent_* deprecati)
                                e `tenant_agents` (autorità)
src/lib/db-hub.ts             ← include CRUD su tenant_agents + back-compat
                                tenant.agent_* helpers
src/lib/scanner/discovery.ts  ← runDiscovery() shadowa pingSweep/nmap*
                                con executor del tenant (function-local consts)

src/app/api/tenant-agents/                ← API canoniche (multi-agent)
  ├── route.ts                            ← GET list + POST create
  ├── [id]/route.ts                       ← GET/PUT/DELETE
  ├── [id]/token/route.ts                 ← POST genera nuovo
  ├── [id]/token/import/route.ts          ← POST importa esistente
  └── [id]/test/route.ts                  ← POST test connessione

src/app/api/tenants/[id]/agent/           ← API back-compat (puntano al primo agent)
src/app/api/agents/route.ts               ← lista cross-tenant per UI overview
src/app/agent-install.sh/route.ts         ← serve agent/scripts/install.sh
                                            con Content-Type shellscript
                                            (esente da auth, vedi auth.config.ts)

src/app/(dashboard)/agents/page.tsx       ← UI overview + Wizard 3-step
src/app/(dashboard)/tenants/[id]/agent/page.tsx ← UI per-tenant (back-compat)
src/components/shared/sidebar.tsx         ← link "Agenti remoti" (solo superadmin)

scripts/hub-install.sh                    ← bootstrap deps di sistema hub
```

### Agent Python

```
agent/
├── pyproject.toml              ← Python 3.11+, FastAPI, asyncssh, pywinrm[kerberos]
├── da_invent_agent/
│   ├── __version__.py          ← single source of truth versione agent
│   ├── main.py                 ← FastAPI app + lifespan + error handlers
│   ├── config.py               ← pydantic-settings, sorgenti env + YAML
│   ├── auth.py                 ← bearer token + origin CGNAT + require_scope()
│   ├── scopes.py               ← Scope enum (exec:network|device, admin:update)
│   ├── errors.py               ← AgentException + error envelope uniforme
│   ├── system_probe.py         ← _which() + probe Tailscale, cache 60s
│   ├── models.py               ← pydantic models speculari a executor/types.ts
│   └── exec/
│       ├── ping.py             ← subprocess ping (cross-platform)
│       ├── nmap.py             ← TCP -sT + UDP -sU via sudo, parser XML
│       ├── dns.py              ← socket.getaddrinfo + getnameinfo
│       ├── snmp.py             ← subprocess snmpwalk -Oqn + parsers (walk, routes)
│       ├── arp.py              ← parser MAC 3 formati (colon, hex-string, RouterOS CHR)
│       ├── ssh.py              ← asyncssh wrapper, trunc stdout/stderr
│       ├── winrm.py            ← subprocess winrm_bridge.py, classify_error
│       └── winrm_bridge.py     ← copia di src/lib/devices/winrm-bridge.py (hardenato)
├── scripts/
│   ├── install.sh              ← installer one-liner (apt, Tailscale, venv, systemd)
│   ├── da-invent-agent.service ← systemd unit (no NoNewPrivileges per sudo+caps)
│   ├── dump_openapi.py         ← rigenera openapi.json
│   └── check_openapi_fresh.sh  ← pre-commit drift check
├── tests/                      ← 56 test pytest (parser ARP/routes + auth + endpoints)
└── openapi.json                ← snapshot OpenAPI 3.1 schema (commitato)
```

## 4. Comandi essenziali

```bash
# Dev hub locale
npm run dev:server                # custom server con scheduler cron
npm run lint && npx tsc --noEmit && npm run build  # verifica completa
npm run version:release           # bump patch + commit "release: vX.Y.Z"
git push origin <branch>          # produzione fa git pull

# Dev agent locale
cd agent
.venv/bin/pytest                  # 56/56 attesi (Python 3.11+, testato 3.14)
.venv/bin/python scripts/dump_openapi.py
./scripts/check_openapi_fresh.sh

# Pre-commit hook locale (installato manualmente, vedi sotto)
ls .git/hooks/pre-commit          # check_openapi_fresh.sh chiamato se tocchi agent/

# Deploy hub su VM 533 (jump via Proxmox)
ssh root@192.168.40.4 'cd /tmp/da-invent-deploy && git fetch && git reset --hard origin/feature/remote-agents && \
  rsync -az --delete --exclude=/data/ --exclude=/.env.local --exclude=/.next/ --exclude=/node_modules/ \
    /tmp/da-invent-deploy/ root@192.168.4.8:/opt/da-invent/'
ssh -J root@192.168.40.4 root@192.168.4.8 'cd /opt/da-invent && npm run build && systemctl restart da-invent'

# Deploy agent su un host nuovo (cliente)
# 1. genera token dalla UI hub → wizard /agents
# 2. copia il one-liner dal step 3 del wizard, esegui come root sull'host
```

## 5. Accesso operativo

| Risorsa | Come |
|---|---|
| Web app hub | `https://192.168.4.8` (login: admin / **DaInvent2026** — cambia al primo uso) |
| SSH hub VM 533 | `ssh -J root@192.168.40.4 root@192.168.4.8` (chiave già autorizzata su entrambi) |
| Proxmox host | `ssh root@192.168.40.4` (chiave già autorizzata) |
| Agent OVH | `ssh root@100.89.234.89` (direct via Tailscale, chiave autorizzata) |
| Agent OVH (config) | `/etc/da-invent-agent/config.yml`, service `systemctl status da-invent-agent` |
| Tailscale visibility | hub `100.124.2.70` (da-invent), agent `100.89.234.89` (bridge-domarc-ovh) |

## 6. Lezioni dure imparate (memorie persistenti)

Tutte in `~/.claude/projects/-Users-riccardo-Progetti-DA-IPAM/memory/`:

- **`feedback_no_shell_concat_hashes.md`**: mai passare hash bcrypt via shell
  concatenation attraverso doppio SSH. I `$` di `$2b$10$...` vengono
  interpolati dalla shell remota → hash troncato a 2 char → admin lockout.
  Usare `ssh -J` + script file via scp con parameter binding.
- **`feedback_verify_system_deps_on_deploy.md`**: il check `/api/health`
  ritorna OK anche se mancano `nmap`/`snmpwalk` di sistema. Sempre eseguire
  `scripts/hub-install.sh` dopo migrazione/clone host.
- **`feedback_bundle_tool_calls.md`**: bundle tool call invece di N parallele
  (ognuna genera prompt di permesso).
- **`feedback_prod_debug_no_confirm.md`**: per debug **non distruttivo** su
  Proxmox/PCT/VM (SSH, sqlite read-only, pct exec, restart servizio, push
  file fixato) procedere senza chiedere. Per **distruttivo** (DROP, modifiche
  env, distruzione container, push su `main`, credenziali in chiaro) chiedere.
- **`project_remote_agents.md`**: decisioni architetturali approvate.

## 7. Gotchas tecniche scoperte in questa sessione

### Tailscale + agent
- Agent **DEVE** girare con CGNAT origin check (100.64.0.0/10): il middleware
  rifiuta richieste da fuori la tailnet.
- Tailscale **MagicDNS short name** e FQDN entrambi accettati. La validazione
  hostname hub-side usa regex permissiva: niente schemi `http://`, niente path.
- Tailscale `up` interattivo: stampa URL, lo script aspetta. Con
  `TAILSCALE_AUTH_KEY` (reusable) → fully automated.

### nmap + capabilities (Ubuntu 24.04)
- **nmap 7.94 hard-checka `euid==0`** per `-sU`/`-sS` ANCHE con
  `CAP_NET_RAW` ambient + setcap +eip. La soluzione operativa è
  `sudo -n /usr/bin/nmap` con sudoers fragment NOPASSWD limitato. Vedi
  `agent/da_invent_agent/exec/nmap.py:_nmap_cmd()`.
- `NoNewPrivileges=true` nel systemd unit blocca sudo (non può ottenere
  CAP_SETUID). Lasciato OFF per l'agent. Mitigation: agent gira come utente
  non-root `da-invent-agent`.
- `CapabilityBoundingSet` deve essere **omesso** (non limita): se lo
  restringi a `CAP_NET_RAW` ecc., sudo non può elevare.
- `RestrictAddressFamilies` deve includere `AF_PACKET` (libpcap UDP scan).

### asyncssh
- NON passare `client_keys_load_path` (kwarg inventato — bug pre-v0.2.1).
- Per **disabilitare il pickup automatico** delle chiavi locali, passare
  `client_keys=[]` esplicito. L'autenticazione deve venire solo da `auth.*`
  del payload.

### NextAuth tenant switching
- I tenant nel JWT sono **iniettati al login** in `auth.ts:authorize()`.
  Non si aggiornano per JWT refresh. Se aggiungi un tenant mentre l'utente
  è loggato, **fagli fare logout+login** per vederlo.
- Variabile `NEXTAUTH_URL` su VM 533 può finire a `https://0.0.0.0` —
  comporta redirect post-login strani ma non blocca l'auth. Da fixare via
  `.env.local`.

### Rate limit login
- In-memory `Map` con sliding window 15 min. **Restart del servizio** è
  l'unico modo per ripulirlo. Nessuna UI/CLI di reset.

### Hub deploy (cosa NON ti aspetti)
- VM 533 (migrata da LXC 333) NON aveva di base: `nmap`, `snmpwalk`,
  `fping`, `arping`, Kerberos packages, venv `/root/.da-invent-venv`.
  Eseguire `bash scripts/hub-install.sh` dopo ogni migrazione.
- `/opt/da-invent` su VM **NON è git repo** — deploy via rsync da
  `/tmp/da-invent-deploy` su Proxmox host.

## 8. Phase residue e backlog

| Phase | Cosa | Note |
|---|---|---|
| **6** | Heartbeat + observability persistenti | Tabella `agent_heartbeats` su hub.db, agente fa POST a hub `/api/agents/heartbeat` ogni 60s. Per ora abbiamo solo on-demand test. |
| **7** | Routing **subnet → agent** | Quando un tenant ha N agent con subnet diverse, decidere quale chiamare in base al target IP. Campo `subnet_match` (CSV CIDR) già nello schema. `getExecutor()` accetta optional targetIp param. |
| **7+** | TLS end-to-end | Oggi HTTP plain via Tailscale (WireGuard cifra). Per compliance: Tailscale Serve con cert LetsEncrypt OR self-signed con TOFU pinning hub-side. |
| **8** | Auto-update agent dall'hub | Endpoint agent `/admin/update` (token-protetto, scope `admin:update`) scarica tarball + verifica SHA256 + atomic swap + systemctl restart. Tabella `agent_releases` hub-side. |
| **9** | UI tenant per-tenant agents | Oggi `/tenants/[id]/agent` mostra solo il primo agent (back-compat). Trasformare in `/tenants/[id]/agents` con lista multi-agent. |
| **dep** | Rimuovere campi `tenants.agent_*` | Sono deprecati dalla migrazione. Lasciati per back-compat di route esistenti. Dopo 1-2 release di stabilità si possono droppare. |

## 9. Pull request e merge

- PR aperta: <https://github.com/grandir66/DA-IPAM/pull/2> — `feature/remote-agents` → `main`.
- **Non è ancora mergeata.** Riepilogo PR descrive il breaking change agent
  (drop `DA_INVENT_AGENT_TOKEN_HASH`). Hub NON ha breaking change.
- Quando si merge: verificare che lo script `npm run version:release` non
  rimbalzi su file mai versionati (`.claude/scheduled_tasks.lock` deve restare
  in `.gitignore`).

## 10. Pre-commit hook locale (non versionato)

`.git/hooks/pre-commit` installato manualmente per evitare drift
`openapi.json` quando si toccano endpoint agent. Contenuto:

```sh
#!/bin/sh
if git diff --cached --name-only | grep -qE '^agent/(da_invent_agent/|scripts/dump_openapi\.py)'; then
  agent/scripts/check_openapi_fresh.sh || {
    echo 'OpenAPI drift: rigenera con `python agent/scripts/dump_openapi.py`'
    exit 1
  }
fi
```

Quando si condividerà il branch con altri sviluppatori: creare
`agent/scripts/install-hooks.sh` versionato che fa il symlink (vedi memo
sessione 2026-05-11).

## 11. Pattern di codice da non rompere

In aggiunta a quanto in [CLAUDE.md](CLAUDE.md):

- **`getExecutor(tenantCode)` può throware `ExecutorNotConfiguredError`**
  per tenant remote non configurati. Chi lo chiama dentro un cron job
  deve **catchare** e degradare con grace (es. log + skip iteration),
  vedi pattern in `src/lib/scanner/discovery.ts:_exec`.
- **`safeDecrypt()`** se cerchi di leggere `agent_token_encrypted` (e in
  generale qualunque ciphertext): tornare null/error gracefully se la
  ENCRYPTION_KEY è cambiata.
- **Le route agent token** ritornano il plaintext **solo in response**, mai
  in DB. La response NON deve essere loggata.
- **Pydantic SecretStr** lato agent: usare per password/community/token —
  fa redact su repr() e log automatici.
- **Errori dall'agent**: hanno **error envelope uniforme** `{error: {code,
  message, retriable, details?}}`. `RemoteExecutor` lo traduce in
  `RemoteExecutorError` typed. I call site possono ispezionare `.retriable`.
- **OpenAPI freshness**: ogni modifica a endpoint/model in `agent/da_invent_agent/`
  o `agent/scripts/dump_openapi.py` richiede rigenerazione di `agent/openapi.json`.
  Il pre-commit lo blocca; CI lo bloccherà se aggiunto.

## 12. Variabili d'ambiente critiche

### Hub (.env.local su VM 533)

- `ENCRYPTION_KEY` — **non perdere**: senza, tutti i token encrypted
  diventano inutilizzabili (test connection ritorna `decrypt_failed`).
- `AUTH_SECRET` — NextAuth JWT signing key.
- `DOMARC_USERNAME` / `DOMARC_PASSWORD` — utente di servizio
  (incondizionato, vede tutti i tenant).

### Agent (/etc/da-invent-agent/config.yml su host cliente)

```yaml
tenant_code: "70791a"        # MUST match hub tenants.codice_cliente
hub_url: "https://192.168.4.8"
port: 8443
host: "0.0.0.0"               # bind, l'origin check filtra a CGNAT
dev_mode: false
log_level: "INFO"
tokens:
  - label: "hub-prod"
    token_hash: "$2b$12$..."  # bcrypt — generato in-process, mai shell concat
    scopes:
      - "exec:network"
      - "exec:device"
      - "admin:update"
```

`DA_INVENT_AGENT_*` env vars overridano YAML (per testing). Vedi
`agent/.env.example`.

## 13. Debug rapido — playbook

- **"Le scansioni non trovano porte"** → verificare in ordine:
  1. `tenants.agent_mode` del tenant è `'remote'`?
  2. `tenant_agents` ha una riga per il tenant con token configurato?
  3. Sull'host hub: `which nmap`. Se manca: `bash scripts/hub-install.sh`.
  4. Sull'host agent: `systemctl status da-invent-agent`. Log:
     `journalctl -u da-invent-agent -n 50`.
  5. Test diretto: `curl http://<agent-ip>:8443/whoami -H "Authorization: Bearer <token>"` dalla VM hub.
- **"Login non funziona"** →
  1. `[Auth] Rate limit raggiunto` nei log: `systemctl restart da-invent`.
  2. Hash corrotto: verificare con node `bcrypt.compareSync` (mai shell
     interpolation del `$`).
  3. JWT obsoleto (tenant nuovo non visibile): logout + login.
- **"Test connessione mostra `decrypt_failed`"** → ENCRYPTION_KEY è cambiata.
  Rigenera il token dall'UI (sovrascriverà il nuovo ciphertext).
- **"UDP scan non trova porte"** → controlla `/etc/sudoers.d/da-invent-agent`
  esiste e nmap ha `setcap cap_net_raw,cap_net_admin=eip`.

