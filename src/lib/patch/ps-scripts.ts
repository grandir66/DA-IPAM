/**
 * Builder script PowerShell per il modulo Patch Management.
 *
 * Tutti gli script:
 *  - Loggano su `C:\ProgramData\DA-IPAM\op-<id>.log` via `Tee-Object`.
 *  - Sono single-shot: nessuno stato lato Windows fra invocazioni.
 *  - Usano `choco` (Chocolatey). Win32_Product WMI VIETATO (reinstall msiexec).
 *
 * Input untrusted (`packageId`, `version`) PASSA da validazione strict prima
 * di essere inserito nello script — vedi `assertSafeIdentifier`. Eventuale
 * carattere fuori whitelist => throw, l'executor segna l'operation come failed.
 */
import { PS_TRUST_SELF_SIGNED } from "@/lib/ps-tls";

const SAFE_IDENTIFIER_RE = /^[a-zA-Z0-9._-]+$/;

/**
 * Permette solo `[a-zA-Z0-9._-]` (set sufficiente per choco package id + version).
 * Rifiuta esplicitamente: spazi, quotes, `;`, `&`, `|`, `$`, backtick, newline,
 * tutti i caratteri che potrebbero rompere il quoting PowerShell e introdurre
 * command injection.
 */
export function assertSafeIdentifier(value: string, label: string): void {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`[patch/ps-scripts] ${label} vuoto o non stringa`);
  }
  if (value.length > 128) {
    throw new Error(`[patch/ps-scripts] ${label} troppo lungo (>128 char)`);
  }
  if (!SAFE_IDENTIFIER_RE.test(value)) {
    throw new Error(
      `[patch/ps-scripts] ${label} contiene caratteri non ammessi (whitelist: [a-zA-Z0-9._-])`
    );
  }
}

/**
 * Path log file su Windows: `C:\ProgramData\DA-IPAM\op-<id>.log`.
 * Esposto come funzione per consentire mock/test e riuso fra script e tailer.
 */
export function logFilePathForOperation(opId: number): string {
  if (!Number.isInteger(opId) || opId <= 0) {
    throw new Error(`[patch/ps-scripts] opId non valido: ${opId}`);
  }
  return `C:\\ProgramData\\DA-IPAM\\op-${opId}.log`;
}

/**
 * Probe: verifica presenza Chocolatey + lista pacchetti outdated.
 *
 * Output format:
 *   - Se choco assente: stampa `CHOCO_MISSING` e exit 1.
 *   - Altrimenti: `CHOCO_VERSION=<ver>` + N righe `pkg|currentVer|availableVer|pinned`.
 */
export function buildProbeScript(opId: number): string {
  const logPath = logFilePathForOperation(opId);
  return `$ErrorActionPreference='Continue'
$logPath = '${logPath}'
New-Item -ItemType Directory -Force -Path (Split-Path $logPath) | Out-Null
$choco = (Get-Command choco -ErrorAction SilentlyContinue).Source
if (-not $choco) {
  'CHOCO_MISSING' | Tee-Object -FilePath $logPath
  exit 1
}
$ver = & choco --version 2>&1 | Select-Object -Last 1
"CHOCO_VERSION=$ver" | Tee-Object -FilePath $logPath -Append
& choco outdated --limit-output 2>&1 | Tee-Object -FilePath $logPath -Append
exit $LASTEXITCODE`;
}

/**
 * Bootstrap: scarica e installa Chocolatey dall'URL ufficiale.
 *
 * Output format:
 *   - Riga finale `CHOCO_VERSION=<ver>` se installato OK.
 */
export function buildBootstrapScript(opId: number): string {
  const logPath = logFilePathForOperation(opId);
  return `$ErrorActionPreference='Stop'
$logPath = '${logPath}'
New-Item -ItemType Directory -Force -Path (Split-Path $logPath) | Out-Null
'BOOTSTRAP_START' | Tee-Object -FilePath $logPath
Set-ExecutionPolicy Bypass -Scope Process -Force
[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072
$installScript = (New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1')
Invoke-Expression $installScript 2>&1 | Tee-Object -FilePath $logPath -Append
$ver = & choco --version 2>&1 | Select-Object -Last 1
"CHOCO_VERSION=$ver" | Tee-Object -FilePath $logPath -Append
exit $LASTEXITCODE`;
}

/**
 * Upgrade: esegue `choco upgrade <pkg> -y --no-progress --limit-output [--version=X]`.
 *
 * Exit code semantics (parse lato executor):
 *   0    → success
 *   3010 → reboot pending
 *   1641 → reboot initiated by choco
 *   else → failed
 *
 * SICUREZZA: `packageId` e `version` passano per `assertSafeIdentifier`. Se
 * presenti caratteri fuori whitelist → throw IMMEDIATO (no script costruito).
 */
export function buildUpgradeScript(
  opId: number,
  packageId: string,
  version?: string | null
): string {
  assertSafeIdentifier(packageId, "packageId");
  const verArg = version ? `--version=${version}` : "";
  if (version) {
    assertSafeIdentifier(version, "version");
  }
  const logPath = logFilePathForOperation(opId);
  // Pre-check: se choco non esiste, errore esplicito (exit 127) — altrimenti
  // PowerShell CommandNotFoundException lascia $LASTEXITCODE vuoto e i log
  // non riportano la causa.
  return `$ErrorActionPreference='Continue'
$logPath = '${logPath}'
New-Item -ItemType Directory -Force -Path (Split-Path $logPath) | Out-Null
$choco = (Get-Command choco -ErrorAction SilentlyContinue).Source
if (-not $choco) {
  'ERROR: Chocolatey non installato su questo host. Esegui prima un Bootstrap choco.' | Tee-Object -FilePath $logPath
  'EXIT_CODE=127' | Tee-Object -FilePath $logPath -Append
  exit 127
}
& choco upgrade ${packageId} -y --no-progress --limit-output ${verArg} 2>&1 | Tee-Object -FilePath $logPath
$ec = $LASTEXITCODE
"EXIT_CODE=$ec" | Tee-Object -FilePath $logPath -Append
# v0.2.654: leggi versione effettivamente installata dopo l'upgrade.
# choco list --limit-output produce \`<id>|<version>\` (es. \`notepadplusplus|8.7.0\`).
# Filtriamo esattamente il pacchetto richiesto per evitare match parziali.
$listOut = & choco list ${packageId} --limit-output --exact 2>&1 | Select-String '^[^|]+\\|[^|]+$' | Select-Object -First 1
if ($listOut) {
  $parts = $listOut.ToString() -split '\\|', 2
  if ($parts.Length -eq 2) {
    "PKG_VERSION_AFTER=$($parts[1].Trim())" | Tee-Object -FilePath $logPath -Append
  }
}
exit $ec`;
}

/**
 * Uninstall di un software su Windows.
 *   - `chocoId` presente → `choco uninstall <id> -y` (lifecycle Chocolatey).
 *   - altrimenti → uninstall SILENZIOSO da registro per DisplayName == `name`:
 *       · MSI (ProductCode {GUID})     → msiexec /x {code} /qn /norestart
 *       · EXE con QuietUninstallString  → eseguito così com'è (già silenzioso)
 *       · nessuno dei due               → EXIT_CODE=3, NON eseguiamo la
 *         UninstallString interattiva (aprirebbe una UI e bloccherebbe WinRM).
 *
 * `chocoId` passa per assertSafeIdentifier. `name` NON è un identifier (ha
 * spazi/apostrofi): entra come literal PS single-quoted (apici raddoppiati) e
 * viene solo confrontato con -eq nel registro, mai eseguito → no injection.
 * Exit: 0=ok, 2=non trovato, 3=uninstall silenzioso non disponibile.
 */
export function buildUninstallScript(
  opId: number,
  name: string,
  chocoId?: string | null,
): string {
  const logPath = logFilePathForOperation(opId);
  const nameLit = "'" + name.replace(/'/g, "''") + "'";

  // Disinstallazione da REGISTRO per DisplayName == name: funziona per QUALSIASI
  // software installato (MSI /qn oppure QuietUninstallString), a prescindere da
  // come è stato installato. È anche il fallback quando 'choco uninstall' fallisce
  // perché il pacchetto non è gestito da Chocolatey (es. FortiClient installato
  // col suo installer → 'is not installed'). Tutti i Tee in -Append per non
  // sovrascrivere l'eventuale output di choco.
  const registryBlock = `$name = ${nameLit}
$keys = @(
  'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
  'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
  'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'
)
$app = Get-ItemProperty $keys -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -eq $name } | Select-Object -First 1
if (-not $app) {
  "Software non trovato nel registro (DisplayName == $name)" | Tee-Object -FilePath $logPath -Append
  'EXIT_CODE=2' | Tee-Object -FilePath $logPath -Append
  exit 2
}
$ec = 3
if ($app.PSChildName -match '^\\{[0-9A-Fa-f-]+\\}$') {
  "Uninstall MSI: $($app.DisplayName) $($app.PSChildName)" | Tee-Object -FilePath $logPath -Append
  $p = Start-Process msiexec.exe -ArgumentList "/x $($app.PSChildName) /qn /norestart" -Wait -PassThru
  $ec = $p.ExitCode
} elseif ($app.QuietUninstallString) {
  "Uninstall silenzioso: $($app.DisplayName)" | Tee-Object -FilePath $logPath -Append
  $p = Start-Process cmd.exe -ArgumentList '/c', $app.QuietUninstallString -Wait -PassThru
  $ec = $p.ExitCode
} else {
  "Uninstall silenzioso non disponibile per '$name'. UninstallString: $($app.UninstallString). Disinstallare manualmente sull'host." | Tee-Object -FilePath $logPath -Append
  $ec = 3
}
"EXIT_CODE=$ec" | Tee-Object -FilePath $logPath -Append
exit $ec`;

  const head = `$ErrorActionPreference='Continue'
$logPath = '${logPath}'
New-Item -ItemType Directory -Force -Path (Split-Path $logPath) | Out-Null`;

  if (chocoId) {
    assertSafeIdentifier(chocoId, "chocoId");
    return `${head}
$choco = (Get-Command choco -ErrorAction SilentlyContinue).Source
if ($choco) {
  & choco uninstall ${chocoId} -y --no-progress --limit-output 2>&1 | Tee-Object -FilePath $logPath
  if ($LASTEXITCODE -eq 0) { 'EXIT_CODE=0' | Tee-Object -FilePath $logPath -Append; exit 0 }
  "Pacchetto '${chocoId}' non gestito da Chocolatey su questo host — provo la disinstallazione dal registro." | Tee-Object -FilePath $logPath -Append
}
${registryBlock}`;
  }
  return `${head}
${registryBlock}`;
}

// Hostname valido: lettere/digit/dot/dash, max 253, almeno 1 dot oppure puro IPv4.
const SAFE_HOSTNAME_RE = /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)*[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/;
const SAFE_IPV4_RE = /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)$/;

/**
 * Valida hostname o IPv4 per Wazuh manager. Throw se non valido — non costruisce script.
 */
export function assertSafeManagerHost(value: string): void {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`[patch/ps-scripts] manager host vuoto`);
  }
  if (value.length > 253) {
    throw new Error(`[patch/ps-scripts] manager host troppo lungo (>253 char)`);
  }
  if (!SAFE_HOSTNAME_RE.test(value) && !SAFE_IPV4_RE.test(value)) {
    throw new Error(
      `[patch/ps-scripts] manager host non valido: deve essere hostname o IPv4`
    );
  }
}

/**
 * Wazuh agent install: scarica MSI ufficiale (packages.wazuh.com), installa con
 * WAZUH_MANAGER specificato, avvia il servizio. Idempotente: se WazuhSvc è già
 * running, exit 0 senza reinstallare.
 *
 * Exit code:
 *   0   → success (installato o già presente e running)
 *   1   → download MSI failed
 *   2   → service NOT running dopo install
 *   N   → exit code msiexec (se !=0)
 *
 * `managerHost` passa per `assertSafeManagerHost` per evitare PS injection.
 */
/**
 * URL MSI agent Wazuh. L'URL GENERICO `wazuh-agent.msi` non è più servito
 * (packages.wazuh.com → 403); solo gli URL VERSIONATI funzionano. Pin su una
 * versione ≤ manager (da-wazuh è 4.14.x): un agent versionato non va mai in 403.
 * Overridabile per matchare la versione del manager quando serve.
 */
export const DEFAULT_WAZUH_AGENT_MSI =
  "https://packages.wazuh.com/4.x/windows/wazuh-agent-4.14.5-1.msi";

export function buildWazuhInstallScript(
  opId: number,
  managerHost: string,
  msiUrl: string = DEFAULT_WAZUH_AGENT_MSI,
): string {
  assertSafeManagerHost(managerHost);
  if (!/^https:\/\/packages\.wazuh\.com\/[\w./-]+\.msi$/.test(msiUrl)) {
    throw new Error(`[patch/ps-scripts] URL MSI Wazuh non valido: ${msiUrl}`);
  }
  const logPath = logFilePathForOperation(opId);
  return `$ErrorActionPreference='Continue'
$logPath = '${logPath}'
New-Item -ItemType Directory -Force -Path (Split-Path $logPath) | Out-Null
'WAZUH_INSTALL_START' | Tee-Object -FilePath $logPath
# Skip se già installato e running
$existing = Get-Service WazuhSvc -ErrorAction SilentlyContinue
if ($existing -and $existing.Status -eq 'Running') {
  'WAZUH_ALREADY_INSTALLED_AND_RUNNING' | Tee-Object -FilePath $logPath -Append
  'EXIT_CODE=0' | Tee-Object -FilePath $logPath -Append
  exit 0
}
# Download MSI ufficiale (TLS 1.2 forzato per OS legacy)
$msi = "$env:TEMP\\wazuh-agent.msi"
'DOWNLOADING_MSI from packages.wazuh.com' | Tee-Object -FilePath $logPath -Append
try {
  [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072
  Invoke-WebRequest -Uri '${msiUrl}' -OutFile $msi -UseBasicParsing 2>&1 | Out-String | Tee-Object -FilePath $logPath -Append
} catch {
  "ERROR: Download MSI failed: $_" | Tee-Object -FilePath $logPath -Append
  'EXIT_CODE=1' | Tee-Object -FilePath $logPath -Append
  exit 1
}
if (-not (Test-Path $msi)) {
  'ERROR: MSI non scaricato' | Tee-Object -FilePath $logPath -Append
  'EXIT_CODE=1' | Tee-Object -FilePath $logPath -Append
  exit 1
}
# Install con WAZUH_MANAGER hardcoded (validato lato server)
'INSTALLING_MSI' | Tee-Object -FilePath $logPath -Append
$proc = Start-Process msiexec.exe -Wait -PassThru -ArgumentList ('/i', $msi, '/qn', 'WAZUH_MANAGER=${managerHost}', 'WAZUH_AGENT_GROUP=default')
$installExit = $proc.ExitCode
"MSI_EXIT=$installExit" | Tee-Object -FilePath $logPath -Append
if ($installExit -ne 0) {
  "ERROR: msiexec exit $installExit" | Tee-Object -FilePath $logPath -Append
  "EXIT_CODE=$installExit" | Tee-Object -FilePath $logPath -Append
  exit $installExit
}
# Start service
'STARTING_SERVICE' | Tee-Object -FilePath $logPath -Append
Start-Service WazuhSvc 2>&1 | Out-String | Tee-Object -FilePath $logPath -Append
Start-Sleep -Seconds 3
$svc = Get-Service WazuhSvc -ErrorAction SilentlyContinue
if ($svc -and $svc.Status -eq 'Running') {
  'WAZUH_INSTALLED_AND_RUNNING' | Tee-Object -FilePath $logPath -Append
  "WAZUH_MANAGER=${managerHost}" | Tee-Object -FilePath $logPath -Append
  'EXIT_CODE=0' | Tee-Object -FilePath $logPath -Append
  exit 0
} else {
  $status = if ($svc) { $svc.Status } else { 'NOT_FOUND' }
  "ERROR: WazuhSvc status=$status dopo install" | Tee-Object -FilePath $logPath -Append
  'EXIT_CODE=2' | Tee-Object -FilePath $logPath -Append
  exit 2
}`;
}

/**
 * Tail: legge il delta del log file a partire da `offset` (byte).
 *
 * Output format:
 *   OFFSET=<nuovo_offset>
 *   ---
 *   <delta testuale>
 */
export function buildTailScript(opId: number, offset: number): string {
  if (!Number.isInteger(offset) || offset < 0) {
    throw new Error(`[patch/ps-scripts] offset non valido: ${offset}`);
  }
  const logPath = logFilePathForOperation(opId);
  return `$logPath = '${logPath}'
$offset = ${offset}
if (Test-Path $logPath) {
  $content = Get-Content -Raw $logPath
  if ($content.Length -gt $offset) {
    $delta = $content.Substring($offset)
    Write-Output "OFFSET=$($content.Length)"
    Write-Output '---'
    Write-Output $delta
  } else {
    Write-Output "OFFSET=$offset"
    Write-Output '---'
  }
} else {
  Write-Output "OFFSET=0"
  Write-Output '---'
}`;
}

/** Escapa una stringa per inclusione in un literal single-quote PowerShell. */
function psQuoteInline(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * MeshCentral agent install via WinRM. Scarica il binario MeshAgent generico
 * (`/meshagents?id=3`, Windows x64) + il file di config per-gruppo `.msh`
 * (`/meshsettings?id=<meshId>`), installa il servizio "Mesh Agent" con
 * `--meshServiceName` FISSO così che il probe `Get-Service` sia deterministico.
 *
 * Idempotente: se il servizio "Mesh Agent" è già Running → exit 0 senza
 * reinstallare, marker `MESHAGENT_ALREADY_INSTALLED_AND_RUNNING`.
 *
 * `--copy-msh=1` è OBBLIGATORIO: copia il `.msh` adiacente all'exe dentro la dir
 * di servizio (`C:\Program Files (x86)\Mesh Agent`). Senza, l'agente si installa,
 * il servizio parte e lo script dichiara SUCCESSO — ma l'agente non ha la config
 * del gruppo, non si connette mai e il nodo non compare in MeshCentral: un falso
 * positivo silenzioso. Verificato su RGSERVER il 2026-07-17: service Running, dir
 * di installazione con MeshAgent.exe + MeshAgent.db (0 byte) e NESSUN .msh, zero
 * connessioni verso :4443. Lo script della UI aveva già il flag: era l'ennesima
 * divergenza fra i due generatori — la blocca il test "push e UI concordano".
 *
 * Exit code:
 *   0 → success (installato o già presente e running)
 *   1 → download agent/.msh failed
 *   2 → service NOT running dopo install
 *
 * serverUrl/meshId sono psQuoted per evitare PS injection.
 */
export function buildMeshAgentInstallScript(
  opId: number,
  serverUrl: string,
  meshId: string,
): string {
  const logPath = logFilePathForOperation(opId);
  const base = serverUrl.replace(/\/+$/, "");
  const agentUrl = psQuoteInline(`${base}/meshagents?id=3`);
  // /meshsettings vuole il meshId base64 SENZA prefisso `mesh//` (altrimenti 401, verificato sul vivo).
  const mshUrl = psQuoteInline(`${base}/meshsettings?id=${meshId.replace(/^mesh\/\//, "")}`);
  return `$ErrorActionPreference='Continue'
$logPath = '${logPath}'
New-Item -ItemType Directory -Force -Path (Split-Path $logPath) | Out-Null
'MESHAGENT_INSTALL_START' | Tee-Object -FilePath $logPath
$ServiceName = 'Mesh Agent'
# Skip se già installato e running
$existing = Get-Service "$ServiceName" -ErrorAction SilentlyContinue
if ($existing -and $existing.Status -eq 'Running') {
  'MESHAGENT_ALREADY_INSTALLED_AND_RUNNING' | Tee-Object -FilePath $logPath -Append
  'EXIT_CODE=0' | Tee-Object -FilePath $logPath -Append
  exit 0
}
${PS_TRUST_SELF_SIGNED}
$dir = "$env:ProgramData\\Domarc\\meshagent"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$exe = Join-Path $dir 'meshagent.exe'
$msh = Join-Path $dir 'meshagent.msh'
# Download MeshAgent generico + .msh per-gruppo
'DOWNLOADING_AGENT' | Tee-Object -FilePath $logPath -Append
try {
  Invoke-WebRequest -Uri ${agentUrl} -OutFile $exe -UseBasicParsing 2>&1 | Out-String | Tee-Object -FilePath $logPath -Append
  Invoke-WebRequest -Uri ${mshUrl} -OutFile $msh -UseBasicParsing 2>&1 | Out-String | Tee-Object -FilePath $logPath -Append
} catch {
  "ERROR: Download failed: $_" | Tee-Object -FilePath $logPath -Append
  'EXIT_CODE=1' | Tee-Object -FilePath $logPath -Append
  exit 1
}
if (-not (Test-Path $exe) -or -not (Test-Path $msh)) {
  'ERROR: agent o .msh non scaricati' | Tee-Object -FilePath $logPath -Append
  'EXIT_CODE=1' | Tee-Object -FilePath $logPath -Append
  exit 1
}
# Install servizio con nome FISSO
'INSTALLING_AGENT' | Tee-Object -FilePath $logPath -Append
& $exe -fullinstall --meshServiceName "$ServiceName" --copy-msh=1 2>&1 | Out-String | Tee-Object -FilePath $logPath -Append
Start-Sleep -Seconds 3
$svc = Get-Service "$ServiceName" -ErrorAction SilentlyContinue
if ($svc -and $svc.Status -ne 'Running') { Start-Service "$ServiceName" 2>&1 | Out-String | Tee-Object -FilePath $logPath -Append; Start-Sleep -Seconds 2; $svc = Get-Service "$ServiceName" -ErrorAction SilentlyContinue }
if ($svc -and $svc.Status -eq 'Running') {
  'MESHAGENT_INSTALLED_AND_RUNNING' | Tee-Object -FilePath $logPath -Append
  'EXIT_CODE=0' | Tee-Object -FilePath $logPath -Append
  exit 0
} else {
  $status = if ($svc) { $svc.Status } else { 'NOT_FOUND' }
  "ERROR: '$ServiceName' status=$status dopo install" | Tee-Object -FilePath $logPath -Append
  'EXIT_CODE=2' | Tee-Object -FilePath $logPath -Append
  exit 2
}`;
}
