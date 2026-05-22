# Plan — DA-IPAM Software Inventory (Windows + Linux, on-demand)

**Progetto**: DA-IPAM (`/Users/riccardo/Progetti/DA-IPAM`)
**Data**: 2026-05-22
**Stato**: bozza per approvazione

## Obiettivo

Aggiungere a DA-IPAM la capability di interrogare un host (Windows o Linux) e ottenerne l'**inventario applicativo installato**, con storicizzazione completa di ogni scan per audit NIS2 (delta install/uninstall/upgrade ricostruibili a posteriori).

Esecuzione **manuale on-demand** sul singolo host, ma con API e modello dati già pronti per esecuzione in background quando servirà.

## Non-goals (esplicitamente fuori scope)

- Scheduling automatico, retry policy, queue distribuita
- Sync cross-tenant verso un hub centrale
- Matching CVE / CPE (resta in DA-Vul-can, che consuma via HTTP)
- AI enrichment (DA-IPAM resta deterministico)
- macOS, ChromeOS, network appliances
- Esecuzione su `network_devices` (solo `hosts`)

## Architettura (riassunto)

Riuso massiccio di pattern esistenti, **nessuna nuova astrazione**:

| Pezzo | Stato attuale | Cosa fare |
|---|---|---|
| Multi-tenant DB | ✅ `withTenant()` + `TENANT_SCHEMA_SQL` | aggiungere 2 tabelle |
| Credentials vault | ✅ `credential_type IN ('windows','linux')` già presente | nessuna modifica schema |
| WinRM bridge Python | ✅ `src/lib/devices/winrm-bridge.py` + `winrm-run.ts` | riusare 1:1 |
| SSH bridge Python | 🔴 non esiste | creare `ssh-bridge.py` simmetrico a winrm-bridge |
| Probe pattern | ✅ vedi `test-snmp`, `test-arp` | seguire pattern (auth + tenant wrapper) |
| Jobs scheduler | ✅ `scheduled_jobs` table con `job_type` enum | aggiungere `'software_inventory_scan'` *per il futuro*, non usato oggi |

**Punti chiave di design (decisi in chat 2026-05-22)**:

1. **Endpoint sincrono ritorna `scan_id` non il risultato**. Client polla lo status. Questo permette di sostituire l'esecuzione inline con una coda senza cambiare il contratto API.
2. **Runner come funzione pura** `runSoftwareScan(hostId, scanId, opts)` — invocabile da inline, da cron, da queue.
3. **Logging strutturato fin da subito** in tabella dedicata (necessario per il debug oggi, indispensabile per il background domani).
4. **Snapshot completi immutabili** — niente "tabella corrente" deduplicata. Ogni scan = righe nuove. Il "current state" è la vista "ultimo scan per host".

## Schema (additivo, in `src/lib/db-tenant-schema.ts`)

Tre tabelle, da aggiungere a `TENANT_SCHEMA_SQL` + `TENANT_INDEXES_SQL`:

```sql
-- Master record per ogni scan eseguito
CREATE TABLE IF NOT EXISTS software_scans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  host_id INTEGER NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  started_at TEXT NOT NULL,                  -- ISO8601 UTC
  finished_at TEXT,                          -- NULL se status=running
  status TEXT NOT NULL CHECK(status IN ('running','ok','error','timeout','cancelled')),
  os_family TEXT NOT NULL CHECK(os_family IN ('windows','linux')),
  probe TEXT NOT NULL,                       -- 'winrm' | 'ssh-dpkg' | 'ssh-rpm' | 'ssh-apk' | 'ssh-mixed'
  apps_count INTEGER DEFAULT 0,
  timeout_ms INTEGER NOT NULL DEFAULT 60000,
  attempt INTEGER NOT NULL DEFAULT 1,        -- per futuri retry
  triggered_by_user_id INTEGER,              -- audit NIS2: chi ha lanciato lo scan
  triggered_by TEXT NOT NULL DEFAULT 'manual',  -- 'manual' | 'scheduled' | 'api'
  error_message TEXT,
  credential_id INTEGER REFERENCES credentials(id) ON DELETE SET NULL
);

-- Inventario applicativo: 1 riga per app per scan (snapshot immutabile)
CREATE TABLE IF NOT EXISTS software_inventory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_id INTEGER NOT NULL REFERENCES software_scans(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  version TEXT,
  publisher TEXT,
  install_date TEXT,                         -- ISO8601, NULL se non disponibile
  install_location TEXT,
  source TEXT NOT NULL,                      -- 'registry' | 'dpkg' | 'rpm' | 'snap' | 'flatpak' | 'apk'
  architecture TEXT,                         -- 'x64' | 'x86' | 'arm64' | NULL
  size_bytes INTEGER                         -- opzionale, NULL se non disponibile
);

-- Log strutturato per debug e (futuro) osservabilità in background
CREATE TABLE IF NOT EXISTS software_scan_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_id INTEGER NOT NULL REFERENCES software_scans(id) ON DELETE CASCADE,
  ts TEXT NOT NULL,                          -- ISO8601
  level TEXT NOT NULL CHECK(level IN ('info','warn','error','debug')),
  step TEXT,                                 -- 'connect' | 'auth' | 'query' | 'parse' | 'commit'
  message TEXT NOT NULL,
  details TEXT                               -- JSON opzionale
);
```

Indici in `TENANT_INDEXES_SQL`:

```sql
CREATE INDEX IF NOT EXISTS idx_software_scans_host ON software_scans(host_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_software_scans_status ON software_scans(status);
CREATE INDEX IF NOT EXISTS idx_software_inventory_scan ON software_inventory(scan_id);
CREATE INDEX IF NOT EXISTS idx_software_inventory_name_version ON software_inventory(name, version);
CREATE INDEX IF NOT EXISTS idx_software_scan_logs_scan ON software_scan_logs(scan_id, ts);
```

**Migrazione**: nessuna (idempotente IF NOT EXISTS). Al primo accesso tenant le tabelle vengono create.

## Backend — probe Windows (WinRM)

Nuovo file: `src/lib/probes/software-windows.ts`

Strategia: invocare PowerShell remoto via WinRM bridge esistente (`winrm-run.ts`), comando unico che legge i tre hive di registry e ritorna JSON.

```powershell
# Lo script è inviato come argument unico al bridge, usePowershell=true
$paths = @(
  'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
  'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
)
$apps = foreach ($p in $paths) {
  Get-ItemProperty $p -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName } | ForEach-Object {
    [PSCustomObject]@{
      name = $_.DisplayName
      version = $_.DisplayVersion
      publisher = $_.Publisher
      install_date = $_.InstallDate
      install_location = $_.InstallLocation
      source = 'registry'
      architecture = if ($p -like '*WOW6432Node*') { 'x86' } else { 'x64' }
      size_bytes = $_.EstimatedSize * 1024
    }
  }
}
# Per-user: enumera HKU
Get-ChildItem 'Registry::HKEY_USERS' -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'S-1-5-21' } | ForEach-Object {
  $userPath = "Registry::$($_.Name)\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*"
  Get-ItemProperty $userPath -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName } | ForEach-Object {
    # ... same shape, source='registry-user'
  }
}
$apps | ConvertTo-Json -Depth 3 -Compress
```

**Parser TS** (`software-windows.ts`):
- Riceve `stdout` dal bridge
- `JSON.parse` dentro try-catch (regola obbligatoria DA-Vul-can ma anche DA-IPAM la rispetta)
- Normalizza `install_date` (formato `yyyyMMdd` registry → ISO)
- Filtra entries senza `name` (rumore registry)
- Ritorna `SoftwarePackage[]`

**Esplicitamente vietato**: `Win32_Product` WMI (triggera msiexec /reconfigure su ogni MSI). Documentato come anti-pattern nel commento del file.

## Backend — probe Linux (SSH)

Due nuovi file:

### `src/lib/devices/ssh-bridge.py`

Sidecar Python simmetrico a `winrm-bridge.py`. Input JSON da stdin, output JSON su stdout.

```json
// input
{"host": "10.0.0.5", "port": 22, "username": "root", "password": "...",
 "command": "...", "timeout_sec": 60}
// output
{"stdout": "...", "stderr": "...", "exit_code": 0, "transport": "ssh-paramiko"}
```

**Decisione 2026-05-22**: oggi **solo password auth**. La colonna `credentials.encrypted_password` già esistente è sufficiente, nessuna modifica schema.

Auth chain:
1. Password auth (lettura `encrypted_password` da `credentials`, decrypt server-side, mai in log)
2. Nessun supporto per agent forwarding, known_hosts strict, key auth (per ora)

Key auth da valutare in fase successiva: richiederà colonna nuova `encrypted_private_key` su `credentials` + ALTER migration gestita esplicitamente.

Lib: `paramiko` (già usato altrove nell'ecosistema secondo memoria scanner-edge).

### `src/lib/probes/software-linux.ts`

Step 1 — distro detection (un comando):
```bash
cat /etc/os-release 2>/dev/null; uname -s
```
Parse `ID=` (debian/ubuntu/rhel/centos/fedora/rocky/alma/alpine/...) per scegliere il comando inventory.

Step 2 — inventory commands per distro:

| ID match | Comando |
|---|---|
| debian, ubuntu, raspbian | `dpkg-query -W -f='${Package}\t${Version}\t${Maintainer}\t${db:Status-Status}\n' \| grep -P '\tinstalled$'` |
| rhel, centos, fedora, rocky, alma, ol | `rpm -qa --queryformat '%{NAME}\t%{VERSION}-%{RELEASE}\t%{VENDOR}\t%{INSTALLTIME:date}\n'` |
| alpine | `apk info -vv \| awk '{print $1}'` → seconda chiamata `apk info -L <pkg>` se serve metadata (rinviabile) |
| sles, opensuse | rpm (stesso comando RHEL) |
| *altro* | `command -v dpkg && dpkg-query ... ; command -v rpm && rpm ...` come fallback |

Step 3 — snap/flatpak opzionali, eseguiti solo se presenti:
```bash
command -v snap && snap list --format=json 2>/dev/null
command -v flatpak && flatpak list --columns=application,version,branch
```

**Parser TS**: una funzione per ciascun output format (`parseDpkg`, `parseRpm`, `parseApk`, `parseSnap`, `parseFlatpak`), tutte ritornano `SoftwarePackage[]` con `source` corretto. `software-linux.ts` aggrega gli output e marca `probe = 'ssh-mixed'` se più source presenti, altrimenti `ssh-dpkg`/`ssh-rpm`/`ssh-apk`.

## Backend — runner orchestratore

Nuovo file: `src/lib/probes/software-runner.ts`

```ts
export interface SoftwareScanOptions {
  hostId: number;
  credentialId: number;
  timeoutMs?: number;
  triggeredByUserId?: number;
  triggeredBy?: 'manual' | 'scheduled' | 'api';
}

export async function runSoftwareScan(opts: SoftwareScanOptions): Promise<{ scanId: number }> {
  // 1. Crea row software_scans con status='running', started_at=now
  // 2. Risolve host + credential dal DB (decrypt user/pass)
  // 3. Detection OS:
  //    - se hostname/os-hint windows o cred kind=windows → winrm
  //    - se cred kind=linux → ssh + os-release detection
  //    - se nessun hint → tenta winrm prima, fallback ssh
  // 4. Invoca probe corrispondente con timeout
  // 5. Logga ogni step in software_scan_logs (level=info/warn/error)
  // 6. INSERT righe in software_inventory dentro transazione
  // 7. UPDATE software_scans status='ok'|'error'|'timeout', finished_at, apps_count, error_message
  // 8. Ritorna { scanId }
}
```

**Invocabile da**:
- Endpoint POST inline (oggi)
- Cron scheduler (futuro)
- Background queue (futuro)

Tutto il path è dentro `withTenant(tenantCode, () => runSoftwareScan(...))` — il runner non sa nulla di multi-tenancy, ci pensa il chiamante.

## Backend — API endpoints

Tutti dentro `withTenantFromSession()`, auth = `requireAdmin()` per le mutazioni, `requireAuth()` per le letture.

### `POST /api/hosts/[id]/software-scan`

Body: `{ credentialId: number, timeoutMs?: number }`
- Crea scan, esegue inline, ritorna `{ scanId, status }` quando finito o `{ scanId, status: 'running' }` se in futuro asincrono
- Auth: `requireAdmin()`
- Validazione: Zod schema

### `GET /api/hosts/[id]/software-scans`

Query: `?limit=20&offset=0`
- Lista scan storici per host (paginated, newest first)
- Auth: `requireAuth()`

### `GET /api/software-scans/[scanId]`

- Dettaglio scan + inventory list + opzionale `?withLogs=true`
- Auth: `requireAuth()`

### `GET /api/software-scans/[scanId]/diff?against=<otherScanId>`

- Diff fra due scan: ritorna `{ added: SoftwarePackage[], removed: SoftwarePackage[], upgraded: { name, fromVersion, toVersion }[] }`
- Logica diff in `src/lib/probes/software-diff.ts` (match by `name`, case-insensitive)
- Auth: `requireAuth()`

### `GET /api/hosts/[id]/software-current`

- Shortcut: ritorna `software_inventory` dell'ultimo scan `status='ok'` per quel host
- Auth: `requireAuth()`

## Frontend — UI

Pagina dettaglio host esistente: aggiungere tab "**Software**".

**Tab Software**:
- Header con stato ultimo scan: "Ultimo scan: 2026-05-22 14:30 — 247 applicazioni"
- Bottone primario "**Scansiona ora**" → modal con:
  - Dropdown "Credenziale" (filtrata per `credential_type IN ('windows','linux')`)
  - Campo "Timeout (s)" default 60
  - Bottone "Avvia"
- Durante scan: spinner + tail live degli ultimi log entries (polling `/software-scans/{id}?withLogs=true` ogni 2s finché `status='running'`)
- A scan completato:
  - Tabella applicazioni con colonne: Nome, Versione, Editore, Data installazione, Source
  - Filtro full-text su nome/editore
  - Export CSV
- Tab secondario "**Storico**":
  - Tabella scan: data, durata, esito, applicazioni
  - Riga cliccabile → dettaglio scan
  - Selettore "Confronta con…" per scegliere due scan e mostrare diff
- Tab terziario "**Log**" (per debug):
  - Per scan selezionato, mostra `software_scan_logs` con filtri level

**Stringhe UI**: italiano (convenzione DA-IPAM/DA-Vul-can). Errori utente-facing in italiano.

## Decisioni (2026-05-22)

1. **Detection OS**: ✅ **automatica dal `credential_type`** della credenziale selezionata (`windows` → probe WinRM, `linux` → probe SSH). Se mismatch in fase di esecuzione (es. cred linux ma host risponde solo a 5986) → log `level=error step=detection` + `status='error'` con messaggio chiaro all'utente.

2. **WinRM transport**: ✅ **default 5986 HTTPS**. Campo `port` opzionale nella modal scan, vuoto = 5986. Il bridge `winrm-bridge.py` esistente accetta entrambi, nessuna modifica.

3. **SSH auth**: ✅ **solo password** (riusa `credentials.encrypted_password` esistente). Key auth differita, nessuna modifica schema su `credentials`.

4. **Limite righe per scan**: ✅ **cap 2000** per scan. Se superato: tronca, log `level=warn step=parse message="apps_count exceeded cap, truncated"`, `software_scans.error_message` riporta il fatto. Costante in `src/lib/probes/software-runner.ts`: `MAX_APPS_PER_SCAN = 2000`.

5. **Retention scan storici**: ✅ **default 12 scan per host, editabile** via setting tenant.
   - Aggiungere riga in tabella settings esistente (verificare nome esatto in `db-tenant-schema.ts`, probabilmente `tenant_settings` o `app_settings`): chiave `software_scan_retention_per_host`, default `12`.
   - **Trigger cleanup**: al termine di ogni scan `status='ok'`, dentro la stessa transazione del runner: `DELETE FROM software_scans WHERE host_id=? AND id NOT IN (SELECT id FROM software_scans WHERE host_id=? ORDER BY started_at DESC LIMIT N)`. ON DELETE CASCADE pulisce automaticamente `software_inventory` e `software_scan_logs`.
   - UI: setting esposto in pagina settings tenant (input numerico, min 1, max 999, default 12).
   - Non si cancellano mai scan con `status='running'` (protezione concorrenza).

## Test plan

- **Schema migration**: avviare app, verificare creazione tabelle in `data/tenants/<test>.db` con `sqlite3 ... '.schema software_*'`
- **WinRM probe**: testare contro VM Windows 10/11 di test (disponibilità da chiedere all'utente)
- **Linux probe Debian**: testare contro container Ubuntu 22.04 / Debian 12
- **Linux probe RHEL**: testare contro Rocky 9 o AlmaLinux 9
- **Auth fail**: testare con credential sbagliata, verificare `status='error'` + entry log
- **Timeout**: testare con host irraggiungibile, verificare `status='timeout'` dopo `timeoutMs`
- **Diff**: eseguire 2 scan consecutivi (uno con app extra installata manualmente), verificare diff corretto
- **API auth**: verificare `requireAdmin()` su POST e `requireAuth()` su GET (curl senza session → 401/403)

## Fasi di esecuzione

| Fase | Cosa | Effort stimato |
|---|---|---|
| 1 | Schema migration (3 tabelle + 5 indici) + tipi TS | 0.5g |
| 2 | Runner orchestratore + log writer | 0.5g |
| 3 | Probe Windows (WinRM) — riuso bridge esistente | 0.5g |
| 4 | Probe Linux: ssh-bridge.py + parser per dpkg/rpm/apk/snap/flatpak | 1g |
| 5 | API endpoints (5 route) + Zod schemas | 0.5g |
| 6 | UI tab "Software" su dettaglio host (scan + tabella + storico) | 1g |
| 7 | UI diff fra scan | 0.5g |
| 8 | Test E2E su VM Windows + VM Linux | 0.5g |
| **Tot** | | **~5 giorni** |

## Hook per il futuro background mode (già predisposti oggi)

- Tabella `software_scans` ha già: `status='running'`, `timeout_ms`, `attempt`, `triggered_by`
- Endpoint POST ritorna `scanId` immediatamente: domani basta sostituire l'`await runSoftwareScan()` con `enqueue(runSoftwareScan)` + ritorno status=running
- Runner è funzione pura: chiamabile da cron, queue, manual
- Logging strutturato in `software_scan_logs` già pronto
- `scheduled_jobs.job_type` da estendere con `'software_inventory_scan'` quando si attiverà lo scheduling

Quando si vorrà attivare il background:
1. Aggiungere `'software_inventory_scan'` al CHECK constraint di `scheduled_jobs.job_type` (richiede migration ALTER)
2. Implementare worker che pesca `software_scans` con `status='running'` e nessun worker assegnato, oppure invocato da scheduler esistente di DA-IPAM
3. UI: aggiungere bottone "Pianifica scansione" oltre a "Scansiona ora"

Nessuna modifica al modello dati, contratti API o UI esistente.
