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
