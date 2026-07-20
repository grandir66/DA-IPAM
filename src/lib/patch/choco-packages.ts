/**
 * Generatori di PACCHETTI CHOCOLATEY per gli agenti, configurati per DA-IPAM.
 *
 * Perché così: né MeshCentral né il GLPI Agent hanno un pacchetto choco pubblico
 * adatto (l'agente MeshCentral è generato dal server con la config embedded; il
 * GLPI Agent va configurato per il push verso DA-IPAM). E ospitare un feed NuGet
 * interno è sproporzionato. Qui DA-IPAM genera uno **script PowerShell** che, sul
 * target Windows, scrive il pacchetto (`.nuspec` + `tools/chocolateyInstall.ps1`
 * + `chocolateyUninstall.ps1`), fa `choco pack` e `choco install` dalla cartella
 * locale. Risultato: un vero pacchetto Chocolatey (`choco list` lo mostra;
 * `choco upgrade` / `choco uninstall` funzionano), installato configurato, senza
 * feed server né librerie zip lato Node.
 *
 * Lo script esterno (pushato via WinRM) scrive i file del pacchetto con
 * here-string a virgolette singole `@'...'@` (contenuto LETTERALE): i valori di
 * config (URL/token/meshId) sono già interpolati qui in Node, mentre le variabili
 * PowerShell runtime del pacchetto (`$env:ProgramData`, `$exe`, `$LASTEXITCODE`)
 * restano letterali nel file ed espandono quando choco esegue lo script.
 *
 * VINCOLO: il contenuto interno NON deve mai contenere una riga che inizia con
 * `'@` (chiuderebbe l'here-string). URL/token/meshId non lo contengono.
 */
import { logFilePathForOperation } from "./ps-scripts";
import { PS_TRUST_SELF_SIGNED } from "@/lib/ps-tls";

/** Verifica difensiva: nessuna riga del contenuto interno inizia con `'@`. */
function assertHereStringSafe(content: string, label: string): void {
  if (/^\s*'@/m.test(content)) {
    throw new Error(`[choco-packages] ${label} contiene una riga che inizia con '@ (romperebbe l'here-string)`);
  }
}

interface ChocoPackageParams {
  opId: number;
  pkgId: string;
  version: string;
  title: string;
  description: string;
  /** Contenuto di tools/chocolateyInstall.ps1 (config già interpolata). */
  installPs: string;
  /** Contenuto di tools/chocolateyUninstall.ps1. */
  uninstallPs: string;
  /** Marker di log iniziale (es. MESHAGENT_CHOCO_START). */
  startMarker: string;
}

/**
 * Script esterno (WinRM): scrive il pacchetto, `choco pack`, `choco install`
 * dalla cartella locale. Emette EXIT_CODE=<n> sull'op-log come gli altri script
 * patch, così il parser dell'executor riconosce l'esito.
 */
function buildChocoPackageScript(p: ChocoPackageParams): string {
  assertHereStringSafe(p.installPs, `${p.pkgId} chocolateyInstall`);
  assertHereStringSafe(p.uninstallPs, `${p.pkgId} chocolateyUninstall`);
  const logPath = logFilePathForOperation(p.opId);

  const nuspec = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://schemas.microsoft.com/packaging/2015/06/nuspec.xsd">
  <metadata>
    <id>${p.pkgId}</id>
    <version>${p.version}</version>
    <title>${p.title}</title>
    <authors>Domarc</authors>
    <owners>Domarc</owners>
    <description>${p.description}</description>
    <tags>domarc da-ipam agent</tags>
  </metadata>
</package>`;

  return `$ErrorActionPreference='Continue'
$logPath = '${logPath}'
New-Item -ItemType Directory -Force -Path (Split-Path $logPath) | Out-Null
'${p.startMarker}' | Tee-Object -FilePath $logPath

$choco = (Get-Command choco -ErrorAction SilentlyContinue).Source
if (-not $choco) {
  'ERROR: Chocolatey non installato su questo host. Esegui prima un Bootstrap choco.' | Tee-Object -FilePath $logPath -Append
  'EXIT_CODE=127' | Tee-Object -FilePath $logPath -Append
  exit 127
}

$pkgId = '${p.pkgId}'
$pkgDir = Join-Path $env:ProgramData "Domarc\\choco\\$pkgId"
Remove-Item $pkgDir -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path (Join-Path $pkgDir 'tools') | Out-Null

# --- .nuspec ---
@'
${nuspec}
'@ | Set-Content -Path (Join-Path $pkgDir "$pkgId.nuspec") -Encoding UTF8

# --- tools/chocolateyInstall.ps1 (config embedded) ---
@'
${p.installPs}
'@ | Set-Content -Path (Join-Path $pkgDir 'tools\\chocolateyInstall.ps1') -Encoding UTF8

# --- tools/chocolateyUninstall.ps1 ---
@'
${p.uninstallPs}
'@ | Set-Content -Path (Join-Path $pkgDir 'tools\\chocolateyUninstall.ps1') -Encoding UTF8

# --- pack + install dalla cartella locale ---
'CHOCO_PACK' | Tee-Object -FilePath $logPath -Append
Push-Location $pkgDir
& choco pack 2>&1 | Out-String | Tee-Object -FilePath $logPath -Append
if ($LASTEXITCODE -ne 0) { Pop-Location; 'ERROR: choco pack fallito' | Tee-Object -FilePath $logPath -Append; "EXIT_CODE=$LASTEXITCODE" | Tee-Object -FilePath $logPath -Append; exit $LASTEXITCODE }
'CHOCO_INSTALL' | Tee-Object -FilePath $logPath -Append
& choco install $pkgId --source="'$pkgDir'" -y --force --no-progress 2>&1 | Out-String | Tee-Object -FilePath $logPath -Append
$ec = $LASTEXITCODE
Pop-Location
"EXIT_CODE=$ec" | Tee-Object -FilePath $logPath -Append
exit $ec`;
}

// ── MeshCentral Agent (pacchetto domarc-meshagent) ───────────────────────────

const MESHAGENT_PKG = "domarc-meshagent";
const MESHAGENT_SERVICE = "Mesh Agent";

/**
 * Pacchetto choco che installa il MeshAgent CONFIGURATO: scarica exe + `.msh`
 * per-gruppo dal server co-locato e installa il servizio. `--copy-msh=1` è
 * obbligatorio (senza, l'agente non si connette). Il `.msh` porta la config del
 * device group, quindi l'agente è già puntato al server giusto.
 */
export function buildMeshAgentChocoScript(
  opId: number,
  serverUrl: string,
  meshId: string,
  version = "1.0.0",
): string {
  const base = serverUrl.replace(/\/+$/, "");
  const agentUrl = `${base}/meshagents?id=3`;
  // /meshsettings vuole il meshId SENZA prefisso mesh// (altrimenti 401).
  const mshUrl = `${base}/meshsettings?id=${meshId.replace(/^mesh\/\//, "")}`;

  const installPs = `$ErrorActionPreference = 'Stop'
${PS_TRUST_SELF_SIGNED}
$dir = "$env:ProgramData\\Domarc\\meshagent"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$exe = Join-Path $dir 'meshagent.exe'
$msh = Join-Path $dir 'meshagent.msh'
Write-Host 'Download MeshAgent + configurazione .msh'
Invoke-WebRequest -Uri '${agentUrl}' -OutFile $exe -UseBasicParsing
Invoke-WebRequest -Uri '${mshUrl}' -OutFile $msh -UseBasicParsing
if (-not (Test-Path $exe) -or -not (Test-Path $msh)) { throw 'agent o .msh non scaricati' }
Write-Host 'Installazione servizio Mesh Agent'
& $exe -fullinstall --meshServiceName "${MESHAGENT_SERVICE}" --copy-msh=1
Start-Sleep -Seconds 3
$svc = Get-Service "${MESHAGENT_SERVICE}" -ErrorAction SilentlyContinue
if (-not $svc -or $svc.Status -ne 'Running') { if ($svc) { Start-Service "${MESHAGENT_SERVICE}" -ErrorAction SilentlyContinue }; Start-Sleep -Seconds 2; $svc = Get-Service "${MESHAGENT_SERVICE}" -ErrorAction SilentlyContinue }
if (-not $svc -or $svc.Status -ne 'Running') { throw "Mesh Agent non in esecuzione dopo l'installazione" }
Write-Host 'Mesh Agent installato e in esecuzione'`;

  const uninstallPs = `$ErrorActionPreference = 'Continue'
$svc = Get-CimInstance Win32_Service -Filter "Name='${MESHAGENT_SERVICE}'" -ErrorAction SilentlyContinue
if ($svc) {
  $exe = ($svc.PathName -replace '"','').Trim()
  if (Test-Path $exe) { & $exe -fulluninstall; Start-Sleep -Seconds 4 }
}
Remove-Item "$env:ProgramData\\Domarc\\meshagent" -Recurse -Force -ErrorAction SilentlyContinue
Write-Host 'Mesh Agent rimosso'`;

  return buildChocoPackageScript({
    opId,
    pkgId: MESHAGENT_PKG,
    version,
    title: "Domarc MeshCentral Agent",
    description: "MeshCentral agent configurato per DA-IPAM (controllo remoto).",
    installPs,
    uninstallPs,
    startMarker: "MESHAGENT_CHOCO_START",
  });
}

// ── GLPI Agent (pacchetto domarc-glpi-agent) ─────────────────────────────────

const GLPI_PKG = "domarc-glpi-agent";
const GLPI_TASK = "Domarc-InventoryAgent-Push";

export interface GlpiChocoParams {
  ingestUrl: string;
  ingestToken: string;
  intervalHours: number;
  msiUrl: string;
  msiVersion: string;
  /** Corpo dello script di push (Get inventario locale → POST ingest). */
  pushScriptBody: string;
}

/**
 * Pacchetto choco che installa il GLPI Agent CONFIGURATO per DA-IPAM: MSI
 * silenzioso (solo task Inventory locale, nessun server GLPI), script di push
 * dell'inventario verso l'endpoint ingest di DA-IPAM (token Bearer) e scheduled
 * task periodico. La config (URL ingest, token, intervallo) è embedded.
 */
export function buildGlpiAgentChocoScript(
  opId: number,
  p: GlpiChocoParams,
  version = "1.0.0",
): string {
  // NIENTE bypass del cert qui: l'MSI si scarica da GitHub (cert VALIDO). Il
  // callback ScriptBlock, sotto choco (non interattivo), si rompe e AVVELENA
  // anche il download valido → "underlying connection was closed" (colto su
  // DA-RDH il 2026-07-20). Serve solo abilitare TLS 1.2 per GitHub su Windows
  // vecchi. Il cert self-signed di DA-IPAM lo gestisce lo script di push (task),
  // con il tipo compilato di PS_TRUST_SELF_SIGNED — non uno ScriptBlock.
  const installPs = `$ErrorActionPreference = 'Stop'
[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072
$IngestUrl = '${p.ingestUrl}'
$IngestToken = '${p.ingestToken}'
$IntervalHours = ${p.intervalHours}
$DomarcDir = "$env:ProgramData\\Domarc\\inventory-agent"
$MsiUrl = '${p.msiUrl}'
$MsiPath = Join-Path $env:TEMP 'GLPI-Agent-${p.msiVersion}-x64.msi'
$PushScript = Join-Path $DomarcDir 'push-inventory-agent.ps1'
$TaskName = '${GLPI_TASK}'
New-Item -ItemType Directory -Force -Path $DomarcDir | Out-Null
Write-Host 'Download GLPI Agent MSI'
Invoke-WebRequest -Uri $MsiUrl -OutFile $MsiPath -UseBasicParsing
Write-Host 'Installazione silenziosa GLPI Agent (TASKS=Inventory)'
$proc = Start-Process msiexec.exe -ArgumentList @('/i', $MsiPath, '/qn', 'RUNNOW=0', 'ADD_FIREWALL_EXCEPTION=0', 'TASKS=Inventory') -Wait -PassThru
if ($proc.ExitCode -ne 0) { throw "msiexec exit $($proc.ExitCode)" }
Remove-Item $MsiPath -Force -ErrorAction SilentlyContinue
Write-Host 'Deploy script di push'
Set-Content -Path $PushScript -Value ${jsonPsLiteral(p.pushScriptBody)} -Encoding UTF8
Write-Host "Registrazione scheduled task ogni $IntervalHours h"
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File \\"$PushScript\\" -IngestUrl \\"$IngestUrl\\" -IngestToken \\"$IngestToken\\""
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(2) -RepetitionInterval (New-TimeSpan -Hours $IntervalHours) -RepetitionDuration ([TimeSpan]::MaxValue)
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Force | Out-Null
& $PushScript -IngestUrl $IngestUrl -IngestToken $IngestToken
Write-Host 'GLPI Agent installato e push configurato'`;

  const uninstallPs = `$ErrorActionPreference = 'Continue'
Unregister-ScheduledTask -TaskName '${GLPI_TASK}' -Confirm:$false -ErrorAction SilentlyContinue
# Disinstalla il GLPI Agent via il suo uninstall MSI (ProductName 'GLPI Agent').
$app = Get-CimInstance Win32_Product -Filter "Name LIKE 'GLPI Agent%'" -ErrorAction SilentlyContinue | Select-Object -First 1
if ($app) { & msiexec.exe /x $app.IdentifyingNumber /qn | Out-Null }
Remove-Item "$env:ProgramData\\Domarc\\inventory-agent" -Recurse -Force -ErrorAction SilentlyContinue
Write-Host 'GLPI Agent rimosso'`;

  return buildChocoPackageScript({
    opId,
    pkgId: GLPI_PKG,
    version,
    title: "Domarc GLPI Inventory Agent",
    description: "GLPI Agent configurato per il push inventario verso DA-IPAM.",
    installPs,
    uninstallPs,
    startMarker: "GLPIAGENT_CHOCO_START",
  });
}

/** Serializza una stringa come literal PowerShell single-quoted multilinea. */
function jsonPsLiteral(s: string): string {
  // Single-quoted PS string: raddoppia gli apici singoli. Va bene multilinea.
  return `'${s.replace(/'/g, "''")}'`;
}

export const CHOCO_PACKAGE_IDS = {
  meshagent: MESHAGENT_PKG,
  glpiAgent: GLPI_PKG,
} as const;
