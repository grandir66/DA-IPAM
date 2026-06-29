/**
 * MeshCentral agent install scripts.
 *
 * Mirror di `src/lib/inventory-agent/install-scripts.ts`: scarica il binario
 * MeshAgent GENERICO dal server (`/meshagents?id=...`) e applica il file di
 * configurazione per-gruppo `.msh` ottenuto da `/meshsettings?id=<meshId>`.
 * serverUrl + meshId sono EMBEDDED nello script (il template UI non porta token).
 *
 * Il MeshID è validato come esistente dalla route (control.ashx `meshes`) PRIMA
 * che lo script venga emesso — qui assumiamo l'input già verificato.
 */

export type MeshInstallPlatform = "windows" | "linux" | "macos";

export interface MeshInstallScriptParams {
  serverUrl: string;
  meshId: string;
}

function bashQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** Rimuove lo slash finale dal serverUrl per evitare `//meshsettings`. */
function normalizeServerUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

// MeshAgent IDs ufficiali (server-side architecture selector).
// 3 = Windows x64, 6 = Linux x64, 16 = macOS universal.
const MESH_AGENT_ARCH = { windows: 3, linux: 6, macos: 16 } as const;

/**
 * Windows: scarica meshagent.exe generico + .msh, installa come servizio
 * ("Mesh Agent") con `--meshServiceName` fisso così che il path WinRM possa
 * fare un `Get-Service` deterministico (vedi ps-scripts.ts).
 */
function buildWindowsMeshScript(p: MeshInstallScriptParams): string {
  const base = normalizeServerUrl(p.serverUrl);
  const agentUrl = `${base}/meshagents?id=${MESH_AGENT_ARCH.windows}`;
  const mshUrl = `${base}/meshsettings?id=${p.meshId}`;
  return `# MeshCentral Agent install → DA-IPAM (Windows)
#Requires -RunAsAdministrator
$ErrorActionPreference = "Stop"
[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072
if ($env:DA_IPAM_INSECURE_SSL -ne '0') {
  [System.Net.ServicePointManager]::ServerCertificateValidationCallback = { $true }
}
$ServerUrl = ${psQuote(base)}
$MeshId = ${psQuote(p.meshId)}
$Dir = "C:\\ProgramData\\Domarc\\meshagent"
$Exe = Join-Path $Dir "meshagent.exe"
$Msh = Join-Path $Dir "meshagent.msh"
$ServiceName = "Mesh Agent"

New-Item -ItemType Directory -Force -Path $Dir | Out-Null
Write-Host ">>> [1/3] Download MeshAgent generico"
Invoke-WebRequest -Uri ${psQuote(agentUrl)} -OutFile $Exe -UseBasicParsing
Write-Host ">>> [2/3] Download configurazione .msh ($MeshId)"
Invoke-WebRequest -Uri ${psQuote(mshUrl)} -OutFile $Msh -UseBasicParsing
Write-Host ">>> [3/3] Installazione servizio ($ServiceName)"
& $Exe -fullinstall --meshServiceName "$ServiceName"
Start-Sleep -Seconds 3
$svc = Get-Service "$ServiceName" -ErrorAction SilentlyContinue
if ($svc -and $svc.Status -ne 'Running') { Start-Service "$ServiceName" }
Write-Host ">>> OK — servizio: $ServiceName"
`;
}

/** Linux/macOS condividono la struttura bash; differiscono per arch id. */
function buildUnixMeshScript(
  platform: "linux" | "macos",
  p: MeshInstallScriptParams,
): string {
  const base = normalizeServerUrl(p.serverUrl);
  const agentUrl = `${base}/meshagents?id=${MESH_AGENT_ARCH[platform]}`;
  const mshUrl = `${base}/meshsettings?id=${p.meshId}`;
  return `#!/usr/bin/env bash
# MeshCentral Agent install → DA-IPAM (${platform})
set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Esegui come root: sudo bash" >&2
  exit 1
fi

SERVER_URL=${bashQuote(base)}
MESH_ID=${bashQuote(p.meshId)}
DOMARC_DIR="/usr/local/mesh_services/meshagent"
AGENT_BIN="$DOMARC_DIR/meshagent"
MSH_FILE="$DOMARC_DIR/meshagent.msh"

mkdir -p "$DOMARC_DIR"
echo ">>> [1/3] Download MeshAgent generico"
curl -fsSk ${bashQuote(agentUrl)} -o "$AGENT_BIN"
chmod +x "$AGENT_BIN"
echo ">>> [2/3] Download configurazione .msh ($MESH_ID)"
curl -fsSk ${bashQuote(mshUrl)} -o "$MSH_FILE"
echo ">>> [3/3] Installazione"
"$AGENT_BIN" -fullinstall
echo ">>> OK — server: $SERVER_URL"
`;
}

export function buildMeshInstallScript(
  platform: MeshInstallPlatform,
  params: MeshInstallScriptParams,
): string {
  switch (platform) {
    case "windows":
      return buildWindowsMeshScript(params);
    case "macos":
      return buildUnixMeshScript("macos", params);
    default:
      return buildUnixMeshScript("linux", params);
  }
}

export function meshInstallScriptFilename(platform: MeshInstallPlatform): string {
  switch (platform) {
    case "windows":
      return "domarc-meshagent-install.ps1";
    case "macos":
      return "domarc-meshagent-install-macos.sh";
    default:
      return "domarc-meshagent-install.sh";
  }
}

export function meshInstallScriptContentType(platform: MeshInstallPlatform): string {
  return platform === "windows"
    ? "text/plain; charset=utf-8"
    : "text/x-shellscript; charset=utf-8";
}

export function isMeshInstallPlatform(v: string): v is MeshInstallPlatform {
  return v === "windows" || v === "linux" || v === "macos";
}
