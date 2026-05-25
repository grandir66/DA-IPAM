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
  return `$ErrorActionPreference='Continue'
$logPath = '${logPath}'
New-Item -ItemType Directory -Force -Path (Split-Path $logPath) | Out-Null
& choco upgrade ${packageId} -y --no-progress --limit-output ${verArg} 2>&1 | Tee-Object -FilePath $logPath
$ec = $LASTEXITCODE
"EXIT_CODE=$ec" | Tee-Object -FilePath $logPath -Append
exit $ec`;
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
