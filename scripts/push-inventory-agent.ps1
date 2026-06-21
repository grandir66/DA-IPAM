# Push inventario GLPI Agent → DA-IPAM (Windows).
# Richiede: GLPI Agent (glpi-inventory.exe), PowerShell 5.1+
#
# Variabili ambiente o param:
#   $env:INGEST_URL   — es. https://da-ipam.example/api/inventory/ingest
#   $env:INGEST_TOKEN — Bearer token da Impostazioni → Inventory Agent
#
# Scheduled Task esempio (ogni 6h):
#   schtasks /Create /TN "DA-IPAM Inventory Push" /SC HOURLY /MO 6 /TR "powershell -NoProfile -File C:\Domarc\push-inventory-agent.ps1"

param(
    [string]$IngestUrl = $env:INGEST_URL,
    [string]$IngestToken = $env:INGEST_TOKEN
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($IngestUrl)) { throw "INGEST_URL obbligatorio" }
if ([string]::IsNullOrWhiteSpace($IngestToken)) { throw "INGEST_TOKEN obbligatorio" }

$glpiPaths = @(
    "${env:ProgramFiles}\GLPI-Agent\glpi-inventory.exe",
    "${env:ProgramFiles(x86)}\GLPI-Agent\glpi-inventory.exe"
)
$glpi = $glpiPaths | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $glpi) { throw "glpi-inventory.exe non trovato — installa GLPI Agent (task Inventory only)" }

$tmp = [System.IO.Path]::GetTempFileName()
try {
    & $glpi --json 2>$null | Set-Content -Path $tmp -Encoding UTF8
    if (-not (Get-Item $tmp).Length) { throw "glpi-inventory ha prodotto output vuoto" }

    $headers = @{
        Authorization = "Bearer $IngestToken"
        "Content-Type" = "application/json"
    }
    $body = Get-Content -Path $tmp -Raw -Encoding UTF8
    $resp = Invoke-WebRequest -Uri $IngestUrl -Method POST -Headers $headers -Body $body -UseBasicParsing
    if ($resp.StatusCode -ne 200) { throw "Ingest HTTP $($resp.StatusCode)" }
    Write-Host "Inventario inviato OK"
}
finally {
    Remove-Item -Path $tmp -Force -ErrorAction SilentlyContinue
}
