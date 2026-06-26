import {
  getGlpiClientDownloads,
  type InventoryInstallPlatform,
} from "@/lib/inventory-agent/client-downloads";

export interface InstallScriptParams {
  ingestUrl: string;
  ingestToken: string;
  hubOrigin: string;
  intervalHours?: number;
}

function bashQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function normalizePushIntervalHours(h?: number): number {
  const n = h ?? 6;
  if (!Number.isFinite(n) || n < 1) return 6;
  return Math.min(168, Math.max(1, Math.floor(n)));
}

export function buildPersonalizedOneLiner(
  platform: InventoryInstallPlatform,
  params: InstallScriptParams,
): string {
  const interval = normalizePushIntervalHours(params.intervalHours);
  const { ingestUrl, ingestToken, hubOrigin } = params;
  if (platform === "windows") {
    return [
      `[System.Net.ServicePointManager]::ServerCertificateValidationCallback = { $true }`,
      `$env:INGEST_URL = ${psQuote(ingestUrl)}`,
      `$env:INGEST_TOKEN = ${psQuote(ingestToken)}`,
      `$env:PUSH_INTERVAL_HOURS = '${interval}'`,
      `irm ${hubOrigin}/api/integrations/inventory-agent/install/windows.ps1 | iex`,
    ].join("\n");
  }
  const scriptPath =
    platform === "macos"
      ? `${hubOrigin}/api/integrations/inventory-agent/install/macos.sh`
      : `${hubOrigin}/api/integrations/inventory-agent/install/linux.sh`;
  return [
    `curl -fsSk ${bashQuote(scriptPath)} \\`,
    `  | sudo INGEST_URL=${bashQuote(ingestUrl)} \\`,
    `       INGEST_TOKEN=${bashQuote(ingestToken)} \\`,
    `       PUSH_INTERVAL_HOURS='${interval}' \\`,
    `       bash`,
  ].join("\n");
}

/** Script Linux (template: env INGEST_URL/INGEST_TOKEN; oppure valori embedded). */
export function buildLinuxInstallScript(params?: Partial<InstallScriptParams>): string {
  const dl = getGlpiClientDownloads();
  const embed = Boolean(params?.ingestUrl && params?.ingestToken);
  const interval = normalizePushIntervalHours(params?.intervalHours);
  const urlAssign = embed
    ? `INGEST_URL=${bashQuote(params!.ingestUrl!)}`
    : 'INGEST_URL="${INGEST_URL:?INGEST_URL obbligatorio}"';
  const tokAssign = embed
    ? `INGEST_TOKEN=${bashQuote(params!.ingestToken!)}`
    : 'INGEST_TOKEN="${INGEST_TOKEN:?INGEST_TOKEN obbligatorio}"';
  const intAssign = embed
    ? `PUSH_INTERVAL_HOURS=${interval}`
    : 'PUSH_INTERVAL_HOURS="${PUSH_INTERVAL_HOURS:-6}"';
  const cronUrl = embed ? bashQuote(params!.ingestUrl!) : '"$INGEST_URL"';
  const cronTok = embed ? bashQuote(params!.ingestToken!) : '"$INGEST_TOKEN"';

  return `#!/usr/bin/env bash
# GLPI Agent ${dl.version} + push inventario → DA-IPAM (Linux)
set -euo pipefail

${urlAssign}
${tokAssign}
${intAssign}
DOMARC_DIR="/opt/domarc/inventory-agent"
GLPI_INSTALLER_URL="${dl.linux[0]!.url}"
PUSH_SCRIPT="$DOMARC_DIR/push-inventory-agent.sh"
CRON_FILE="/etc/cron.d/domarc-inventory-agent"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Esegui come root: sudo bash" >&2
  exit 1
fi

mkdir -p "$DOMARC_DIR"
echo ">>> [1/4] Download GLPI Agent"
TMP_INSTALLER="$(mktemp)"
curl -fsSL "$GLPI_INSTALLER_URL" -o "$TMP_INSTALLER"

echo ">>> [2/4] Installazione (task Inventory, no server GLPI)"
if ! command -v perl >/dev/null 2>&1; then
  echo "perl non trovato" >&2
  exit 1
fi
perl "$TMP_INSTALLER" --task Inventory --quiet || perl "$TMP_INSTALLER" --quiet
rm -f "$TMP_INSTALLER"

echo ">>> [3/4] Script push"
cat >"$PUSH_SCRIPT" <<'PUSH_EOF'
#!/usr/bin/env bash
set -euo pipefail
: "\${INGEST_URL:?}"
: "\${INGEST_TOKEN:?}"
command -v glpi-inventory >/dev/null 2>&1 || { echo "glpi-inventory non trovato" >&2; exit 1; }
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT
glpi-inventory --json >"$TMP" 2>/dev/null
HTTP="$(curl -fsSk -o /dev/null -w '%{http_code}' -X POST \\
  -H "Authorization: Bearer \${INGEST_TOKEN}" \\
  -H "Content-Type: application/json" \\
  --data-binary @"$TMP" \\
  "\${INGEST_URL}" || echo 000)"
[[ "$HTTP" == "200" ]] || { echo "Ingest HTTP $HTTP" >&2; exit 1; }
PUSH_EOF
chmod +x "$PUSH_SCRIPT"

echo ">>> [4/4] Cron ogni \${PUSH_INTERVAL_HOURS}h"
cat >"$CRON_FILE" <<CRON_EOF
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/sbin:/bin:/usr/sbin:/usr/bin
0 */\${PUSH_INTERVAL_HOURS} * * * root INGEST_URL=${cronUrl} INGEST_TOKEN=${cronTok} "$PUSH_SCRIPT" >> /var/log/domarc-inventory-agent.log 2>&1
CRON_EOF
chmod 644 "$CRON_FILE"

echo ">>> Primo push"
INGEST_URL="$INGEST_URL" INGEST_TOKEN="$INGEST_TOKEN" "$PUSH_SCRIPT"
echo ">>> OK — log: /var/log/domarc-inventory-agent.log"
`;
}

const WINDOWS_PUSH_SCRIPT_BODY = [
  "param([string]$IngestUrl, [string]$IngestToken)",
  '$ErrorActionPreference = "Stop"',
  "if ($env:DA_IPAM_INSECURE_SSL -ne '0') {",
  "  [System.Net.ServicePointManager]::ServerCertificateValidationCallback = { $true }",
  "}",
  "$glpi = @(",
  '  "$env:ProgramFiles\\GLPI-Agent\\glpi-inventory.exe",',
  '  "${env:ProgramFiles(x86)}\\GLPI-Agent\\glpi-inventory.exe"',
  ") | Where-Object { Test-Path $_ } | Select-Object -First 1",
  'if (-not $glpi) { throw "glpi-inventory.exe non trovato" }',
  "$tmp = [IO.Path]::GetTempFileName()",
  "try {",
  "  & $glpi --json 2>$null | Set-Content -Path $tmp -Encoding UTF8",
  '  $headers = @{ Authorization = "Bearer $IngestToken"; "Content-Type" = "application/json" }',
  "  Invoke-WebRequest -Uri $IngestUrl -Method POST -Headers $headers -Body (Get-Content $tmp -Raw) -UseBasicParsing | Out-Null",
  "} finally { Remove-Item $tmp -Force -ErrorAction SilentlyContinue }",
].join("\n");

export function buildWindowsInstallScript(params?: Partial<InstallScriptParams>): string {
  const dl = getGlpiClientDownloads();
  const embed = Boolean(params?.ingestUrl && params?.ingestToken);
  const interval = normalizePushIntervalHours(params?.intervalHours);
  const initBlock = embed
    ? `$IngestUrl = ${psQuote(params!.ingestUrl!)}
$IngestToken = ${psQuote(params!.ingestToken!)}
$IntervalHours = ${interval}`
    : `if (-not $env:INGEST_URL) { throw "INGEST_URL obbligatorio" }
if (-not $env:INGEST_TOKEN) { throw "INGEST_TOKEN obbligatorio" }
$IngestUrl = $env:INGEST_URL
$IngestToken = $env:INGEST_TOKEN
$IntervalHours = if ($env:PUSH_INTERVAL_HOURS) { [int]$env:PUSH_INTERVAL_HOURS } else { 6 }`;

  return `# GLPI Agent ${dl.version} + push inventario → DA-IPAM (Windows)
#Requires -RunAsAdministrator
$ErrorActionPreference = "Stop"
if ($env:DA_IPAM_INSECURE_SSL -ne '0') {
  [System.Net.ServicePointManager]::ServerCertificateValidationCallback = { $true }
}

${initBlock}
$DomarcDir = "C:\\ProgramData\\Domarc\\inventory-agent"
$MsiUrl = "${dl.windows[0]!.url}"
$MsiPath = Join-Path $env:TEMP "GLPI-Agent-${dl.version}-x64.msi"
$PushScript = Join-Path $DomarcDir "push-inventory-agent.ps1"
$TaskName = "Domarc-InventoryAgent-Push"

Write-Host ">>> [1/4] Download GLPI Agent MSI"
New-Item -ItemType Directory -Force -Path $DomarcDir | Out-Null
Invoke-WebRequest -Uri $MsiUrl -OutFile $MsiPath -UseBasicParsing

Write-Host ">>> [2/4] Installazione silenziosa (TASKS=Inventory)"
$p = Start-Process msiexec.exe -ArgumentList @("/i", $MsiPath, "/qn", "RUNNOW=0", "ADD_FIREWALL_EXCEPTION=0", "TASKS=Inventory") -Wait -PassThru
if ($p.ExitCode -ne 0) { throw "msiexec exit $($p.ExitCode)" }
Remove-Item $MsiPath -Force -ErrorAction SilentlyContinue

Write-Host ">>> [3/4] Script push"
Set-Content -Path $PushScript -Value ${JSON.stringify(WINDOWS_PUSH_SCRIPT_BODY)} -Encoding UTF8

Write-Host ">>> [4/4] Scheduled Task ogni $IntervalHours h"
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File \`"$PushScript\`" -IngestUrl \`"$IngestUrl\`" -IngestToken \`"$IngestToken\`""
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(2) -RepetitionInterval (New-TimeSpan -Hours $IntervalHours) -RepetitionDuration ([TimeSpan]::MaxValue)
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Force | Out-Null
& $PushScript -IngestUrl $IngestUrl -IngestToken $IngestToken
Write-Host ">>> OK — task: $TaskName"
`;
}

export function buildMacosInstallScript(params?: Partial<InstallScriptParams>): string {
  const dl = getGlpiClientDownloads();
  const embed = Boolean(params?.ingestUrl && params?.ingestToken);
  const interval = normalizePushIntervalHours(params?.intervalHours);
  const intervalSec = interval * 3600;
  const urlAssign = embed
    ? `INGEST_URL=${bashQuote(params!.ingestUrl!)}`
    : 'INGEST_URL="${INGEST_URL:?INGEST_URL obbligatorio}"';
  const tokAssign = embed
    ? `INGEST_TOKEN=${bashQuote(params!.ingestToken!)}`
    : 'INGEST_TOKEN="${INGEST_TOKEN:?INGEST_TOKEN obbligatorio}"';
  const plistCmd = embed
    ? `INGEST_URL=${bashQuote(params!.ingestUrl!)} INGEST_TOKEN=${bashQuote(params!.ingestToken!)} "$PUSH_SCRIPT"`
    : 'INGEST_URL="$INGEST_URL" INGEST_TOKEN="$INGEST_TOKEN" "$PUSH_SCRIPT"';

  return `#!/usr/bin/env bash
# GLPI Agent ${dl.version} + push inventario → DA-IPAM (macOS)
set -euo pipefail

${urlAssign}
${tokAssign}
PUSH_INTERVAL_HOURS=${interval}
DOMARC_DIR="/usr/local/domarc/inventory-agent"
LAUNCH_LABEL="it.domarc.inventory-agent.push"
PUSH_SCRIPT="$DOMARC_DIR/push-inventory-agent.sh"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Esegui come root: sudo bash" >&2
  exit 1
fi

ARCH="$(uname -m)"
if [[ "$ARCH" == "arm64" ]]; then
  PKG_URL="${dl.macos[0]!.url}"
else
  PKG_URL="${dl.macos[1]!.url}"
fi

mkdir -p "$DOMARC_DIR"
echo ">>> [1/4] Download GLPI Agent ($ARCH)"
TMP_PKG="$(mktemp).pkg"
curl -fsSL "$PKG_URL" -o "$TMP_PKG"

echo ">>> [2/4] Installazione pkg"
installer -pkg "$TMP_PKG" -target /
rm -f "$TMP_PKG"

echo ">>> [3/4] Script push"
cat >"$PUSH_SCRIPT" <<'PUSH_EOF'
#!/usr/bin/env bash
set -euo pipefail
: "\${INGEST_URL:?}"
: "\${INGEST_TOKEN:?}"
if [[ -x "/Applications/GLPI-Agent/bin/glpi-inventory" ]]; then
  GLPI="/Applications/GLPI-Agent/bin/glpi-inventory"
else
  GLPI="$(command -v glpi-inventory || true)"
fi
[[ -n "$GLPI" ]] || { echo "glpi-inventory non trovato" >&2; exit 1; }
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT
"$GLPI" --json >"$TMP" 2>/dev/null
HTTP="$(curl -fsSk -o /dev/null -w '%{http_code}' -X POST \\
  -H "Authorization: Bearer \${INGEST_TOKEN}" \\
  -H "Content-Type: application/json" \\
  --data-binary @"$TMP" \\
  "\${INGEST_URL}" || echo 000)"
[[ "$HTTP" == "200" ]] || { echo "Ingest HTTP $HTTP" >&2; exit 1; }
PUSH_EOF
chmod +x "$PUSH_SCRIPT"

echo ">>> [4/4] LaunchDaemon ogni \${PUSH_INTERVAL_HOURS}h"
PLIST="/Library/LaunchDaemons/\${LAUNCH_LABEL}.plist"
cat >"$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>\${LAUNCH_LABEL}</string>
  <key>ProgramArguments</key>
  <array><string>/bin/bash</string><string>-lc</string><string>${plistCmd}</string></array>
  <key>StartInterval</key><integer>${intervalSec}</integer>
  <key>StandardOutPath</key><string>/var/log/domarc-inventory-agent.log</string>
  <key>StandardErrorPath</key><string>/var/log/domarc-inventory-agent.log</string>
</dict>
</plist>
PLIST_EOF
launchctl bootout system/\${LAUNCH_LABEL} 2>/dev/null || true
launchctl bootstrap system "$PLIST"

echo ">>> Primo push"
INGEST_URL="$INGEST_URL" INGEST_TOKEN="$INGEST_TOKEN" "$PUSH_SCRIPT"
echo ">>> OK"
`;
}

export function buildInstallScript(
  platform: InventoryInstallPlatform,
  params?: Partial<InstallScriptParams>,
): string {
  switch (platform) {
    case "windows":
      return buildWindowsInstallScript(params);
    case "macos":
      return buildMacosInstallScript(params);
    default:
      return buildLinuxInstallScript(params);
  }
}

export function installScriptFilename(platform: InventoryInstallPlatform): string {
  switch (platform) {
    case "windows":
      return "domarc-inventory-agent-install.ps1";
    case "macos":
      return "domarc-inventory-agent-install-macos.sh";
    default:
      return "domarc-inventory-agent-install.sh";
  }
}

export function installScriptContentType(platform: InventoryInstallPlatform): string {
  return platform === "windows"
    ? "text/plain; charset=utf-8"
    : "text/x-shellscript; charset=utf-8";
}

export function isInventoryInstallPlatform(v: string): v is InventoryInstallPlatform {
  return v === "windows" || v === "linux" || v === "macos";
}
