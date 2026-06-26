# wazuh-agent-install.ps1
# Deploy Wazuh agent su endpoint Windows del dominio domarc.it.
# Pensato per GPO Computer Configuration > Startup Scripts (gira come SYSTEM).
#
# Idempotente: se WazuhSvc è già installato e running, esce senza fare nulla.
# Manager target: da-wazuh.domarc.it
# Porte richieste in uscita dal client: 1514/tcp (events), 1515/tcp (enrollment).
# Log: %WINDIR%\Temp\wazuh-install.log (utile per audit GPO via gpresult).

$ErrorActionPreference = 'Stop'
$LogFile = Join-Path $env:WINDIR 'Temp\wazuh-install.log'
$MsiUrl = 'https://packages.wazuh.com/4.x/windows/wazuh-agent-4.14.5-1.msi'
$MsiPath = Join-Path $env:WINDIR 'Temp\wazuh-agent-4.14.5-1.msi'
$Manager = 'da-wazuh.domarc.it'

function Log($msg) {
  $ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
  Add-Content -Path $LogFile -Value "[$ts] $msg"
}

try {
  Log "Run start (host=$env:COMPUTERNAME user=$env:USERNAME)"

  $svc = Get-Service -Name 'WazuhSvc' -ErrorAction SilentlyContinue
  if ($svc -and $svc.Status -eq 'Running') {
    Log "WazuhSvc già installato e running. Skip."
    exit 0
  }
  if ($svc -and $svc.Status -ne 'Running') {
    Log "WazuhSvc installato ma stato=$($svc.Status). Tento Start-Service."
    Start-Service -Name 'WazuhSvc' -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 5
    $svc = Get-Service -Name 'WazuhSvc'
    if ($svc.Status -eq 'Running') { Log "WazuhSvc avviato senza reinstall."; exit 0 }
    Log "Start-Service fallito. Procedo a reinstall."
  }

  # TLS 1.2 obbligatorio per packages.wazuh.com
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

  if (-not (Test-Path $MsiPath)) {
    Log "Download MSI da $MsiUrl"
    Invoke-WebRequest -Uri $MsiUrl -OutFile $MsiPath -UseBasicParsing
  } else {
    Log "MSI già presente in $MsiPath, skip download."
  }

  Log "Install msiexec /qn WAZUH_MANAGER=$Manager"
  $proc = Start-Process -FilePath 'msiexec.exe' `
    -ArgumentList @('/i', "`"$MsiPath`"", '/qn', "WAZUH_MANAGER=$Manager", "WAZUH_REGISTRATION_SERVER=$Manager") `
    -Wait -PassThru -NoNewWindow
  if ($proc.ExitCode -ne 0) {
    Log "msiexec exit code $($proc.ExitCode) — abort"
    exit $proc.ExitCode
  }

  Log "Install OK. Start-Service WazuhSvc"
  Start-Service -Name 'WazuhSvc'
  Start-Sleep -Seconds 5

  $svc = Get-Service -Name 'WazuhSvc' -ErrorAction SilentlyContinue
  if ($svc -and $svc.Status -eq 'Running') {
    Log "WazuhSvc Running. Done."
    exit 0
  } else {
    Log "WazuhSvc NON Running (status=$($svc.Status)). Investigare con: sc query WazuhSvc; type %ProgramFiles(x86)%\ossec-agent\ossec.log"
    exit 1
  }
}
catch {
  Log "EXCEPTION: $($_.Exception.Message)"
  exit 1
}
