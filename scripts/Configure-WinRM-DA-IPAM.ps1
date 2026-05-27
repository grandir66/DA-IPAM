#Requires -Version 5.0
#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Configura WinRM su un host Windows per consentire a DA-IPAM di accederci.

.DESCRIPTION
  Script idempotente che gestisce 4 scenari principali:
   - Workgroup (Administrator builtin)
   - Workgroup + admin locale custom (es. 'da', 'manutenzione')
   - Server o postazione in dominio AD
   - Domain Controller

  Per ogni scenario applica le sole modifiche necessarie:
   - Abilita servizio WinRM in auto-start
   - Crea listener HTTP 5985 su tutte le interfacce
   - Configura regole firewall (anche Public se workgroup)
   - Se admin custom non-builtin: imposta LocalAccountTokenFilterPolicy=1
   - (Opzionale) Restringe accesso a IP DA-IPAM appliance via IPv4Filter

  Verifica al termine listener attivo + self-loopback.

.PARAMETER Mode
  Scenario di configurazione:
    Workgroup             — server standalone, account Administrator builtin
    WorkgroupCustomAdmin  — server standalone, admin custom non-builtin (es. 'da')
    Domain                — server o postazione in dominio AD
    DomainController      — DC (WinRM facoltativo, focalizzato sull'AD service)

.PARAMETER AllowFromIP
  IP o lista IP separati da virgola del DA-IPAM appliance. Restringe l'accesso
  WinRM solo a quegli IP. Opzionale: se omesso, accetta da qualunque host.

.PARAMETER WhatIf
  Mostra cosa farebbe lo script senza applicare modifiche.

.EXAMPLE
  .\Configure-WinRM-DA-IPAM.ps1 -Mode WorkgroupCustomAdmin
  Setup server workgroup con admin custom (caso più frequente cliente).

.EXAMPLE
  .\Configure-WinRM-DA-IPAM.ps1 -Mode Domain -AllowFromIP 192.168.4.8
  Setup server domain joined con accesso WinRM ristretto a un solo IP.

.EXAMPLE
  .\Configure-WinRM-DA-IPAM.ps1 -Mode Workgroup -WhatIf
  Dry-run: mostra modifiche senza applicarle.

.NOTES
  Versione: v0.2.656
  DA-IPAM project · https://github.com/grandir66/DA-IPAM
  Manuale completo: docs/MANUALE-WINRM.md
#>

[CmdletBinding(SupportsShouldProcess=$true)]
param(
    [Parameter(Mandatory=$true, Position=0)]
    [ValidateSet("Workgroup", "WorkgroupCustomAdmin", "Domain", "DomainController")]
    [string]$Mode,

    [Parameter(Mandatory=$false)]
    [string]$AllowFromIP = "",

    [Parameter(Mandatory=$false)]
    [switch]$SkipVerify
)

# ═══════════════════════════════════════════════════════════════════════════
# Helper functions
# ═══════════════════════════════════════════════════════════════════════════

$script:Failures = @()
$script:Changes = @()

function Write-Step {
    param([string]$Message)
    Write-Host ""
    Write-Host "[STEP] $Message" -ForegroundColor Cyan
}

function Write-Ok {
    param([string]$Message)
    Write-Host "  [OK] $Message" -ForegroundColor Green
}

function Write-Skip {
    param([string]$Message)
    Write-Host "  [SKIP] $Message" -ForegroundColor DarkGray
}

function Write-Change {
    param([string]$Message)
    Write-Host "  [CHANGE] $Message" -ForegroundColor Yellow
    $script:Changes += $Message
}

function Write-Fail {
    param([string]$Message)
    Write-Host "  [FAIL] $Message" -ForegroundColor Red
    $script:Failures += $Message
}

# ═══════════════════════════════════════════════════════════════════════════
# Banner
# ═══════════════════════════════════════════════════════════════════════════

Write-Host ""
Write-Host "============================================================" -ForegroundColor Magenta
Write-Host " DA-IPAM · WinRM Setup Script" -ForegroundColor Magenta
Write-Host " Mode: $Mode" -ForegroundColor Magenta
if ($AllowFromIP) {
    Write-Host " AllowFromIP: $AllowFromIP" -ForegroundColor Magenta
}
if ($WhatIfPreference) {
    Write-Host " (WHAT-IF: nessuna modifica verrà applicata)" -ForegroundColor Yellow
}
Write-Host "============================================================" -ForegroundColor Magenta

# ═══════════════════════════════════════════════════════════════════════════
# Pre-flight checks
# ═══════════════════════════════════════════════════════════════════════════

Write-Step "Pre-flight checks"

# Verifica privilegio admin
$current = [System.Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object System.Security.Principal.WindowsPrincipal($current)
if (-not $principal.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Fail "Lo script richiede PowerShell elevato (Run as Administrator)."
    exit 1
}
Write-Ok "PowerShell elevato confermato"

# Verifica versione PowerShell
if ($PSVersionTable.PSVersion.Major -lt 5) {
    Write-Fail "Richiede PowerShell 5.0+. Versione attuale: $($PSVersionTable.PSVersion)"
    exit 1
}
Write-Ok "PowerShell $($PSVersionTable.PSVersion)"

# Verifica join al dominio se Mode=Domain
$cs = Get-CimInstance Win32_ComputerSystem
$domainJoined = $cs.PartOfDomain
$domainName = if ($domainJoined) { $cs.Domain } else { "(workgroup)" }

if (($Mode -eq "Domain" -or $Mode -eq "DomainController") -and -not $domainJoined) {
    Write-Fail "Mode=$Mode richiede macchina in dominio, ma il sistema è in workgroup."
    Write-Host "    Suggerimento: usa -Mode Workgroup o -Mode WorkgroupCustomAdmin"
    exit 1
}
if (($Mode -eq "Workgroup" -or $Mode -eq "WorkgroupCustomAdmin") -and $domainJoined) {
    Write-Host "  [WARN] Sistema in dominio ma Mode=$Mode (workgroup). Continuo comunque." -ForegroundColor Yellow
}
Write-Ok "Membership: $domainName"

# ═══════════════════════════════════════════════════════════════════════════
# Step 1: LocalAccountTokenFilterPolicy (se admin custom non-builtin)
# ═══════════════════════════════════════════════════════════════════════════

if ($Mode -eq "WorkgroupCustomAdmin" -or $Mode -eq "Domain") {
    Write-Step "LocalAccountTokenFilterPolicy (Remote UAC Token Filter exception)"

    $regPath = "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System"
    $currentValue = (Get-ItemProperty -Path $regPath -Name LocalAccountTokenFilterPolicy -ErrorAction SilentlyContinue).LocalAccountTokenFilterPolicy

    if ($currentValue -eq 1) {
        Write-Ok "LocalAccountTokenFilterPolicy già = 1"
    } else {
        if ($PSCmdlet.ShouldProcess("HKLM\...\Policies\System\LocalAccountTokenFilterPolicy", "Set value to 1")) {
            try {
                Set-ItemProperty -Path $regPath -Name LocalAccountTokenFilterPolicy -Value 1 -Type DWord -Force
                Write-Change "LocalAccountTokenFilterPolicy impostato a 1 (era: $($currentValue -as [string]))"
            } catch {
                Write-Fail "Impossibile impostare LocalAccountTokenFilterPolicy: $($_.Exception.Message)"
            }
        } else {
            Write-Skip "[WhatIf] Setterei LocalAccountTokenFilterPolicy=1"
        }
    }
} else {
    Write-Step "LocalAccountTokenFilterPolicy (skip per Mode=$Mode)"
    Write-Skip "Non necessario per questo scenario"
}

# ═══════════════════════════════════════════════════════════════════════════
# Step 2: Enable-PSRemoting (listener WinRM + firewall + service)
# ═══════════════════════════════════════════════════════════════════════════

Write-Step "Enable-PSRemoting (servizio WinRM, listener, regole firewall)"

# In workgroup serve -SkipNetworkProfileCheck perché NIC è Public
$skipProfileCheck = ($Mode -eq "Workgroup" -or $Mode -eq "WorkgroupCustomAdmin")

if ($PSCmdlet.ShouldProcess("WinRM", "Enable-PSRemoting -Force $(if($skipProfileCheck){'-SkipNetworkProfileCheck'})")) {
    try {
        if ($skipProfileCheck) {
            Enable-PSRemoting -Force -SkipNetworkProfileCheck -ErrorAction Stop | Out-Null
            Write-Change "WinRM configurato (con -SkipNetworkProfileCheck per NIC Public)"
        } else {
            Enable-PSRemoting -Force -ErrorAction Stop | Out-Null
            Write-Change "WinRM configurato"
        }
    } catch {
        Write-Fail "Enable-PSRemoting fallito: $($_.Exception.Message)"
    }
} else {
    Write-Skip "[WhatIf] Eseguirei Enable-PSRemoting"
}

# ═══════════════════════════════════════════════════════════════════════════
# Step 3: Regole firewall su profilo Public (workgroup)
# ═══════════════════════════════════════════════════════════════════════════

if ($Mode -eq "Workgroup" -or $Mode -eq "WorkgroupCustomAdmin") {
    Write-Step "Regola firewall WinRM su profilo Public"

    $publicRule = Get-NetFirewallRule -Name "WINRM-HTTP-In-TCP-PUBLIC" -ErrorAction SilentlyContinue
    if ($publicRule -and $publicRule.Enabled -eq "True") {
        Write-Ok "Regola WINRM-HTTP-In-TCP-PUBLIC già abilitata"
    } else {
        if ($PSCmdlet.ShouldProcess("WINRM-HTTP-In-TCP-PUBLIC", "Enable firewall rule")) {
            try {
                Enable-NetFirewallRule -Name "WINRM-HTTP-In-TCP-PUBLIC" -ErrorAction Stop
                Write-Change "Regola firewall WINRM-HTTP-In-TCP-PUBLIC abilitata"
            } catch {
                # Fallback: crea regola manualmente
                Write-Host "    Regola predefinita non disponibile, creo regola custom" -ForegroundColor Yellow
                netsh advfirewall firewall add rule name="DA-IPAM WinRM-In Public" `
                    dir=in action=allow protocol=TCP localport=5985 profile=public | Out-Null
                Write-Change "Creata regola firewall custom 'DA-IPAM WinRM-In Public'"
            }
        }
    }
}

# ═══════════════════════════════════════════════════════════════════════════
# Step 4: IPv4Filter (whitelist IP DA-IPAM)
# ═══════════════════════════════════════════════════════════════════════════

if ($AllowFromIP) {
    Write-Step "Restrizione accesso WinRM a IP specifici: $AllowFromIP"

    $currentFilter = (Get-Item WSMan:\localhost\Service\IPv4Filter -ErrorAction SilentlyContinue).Value
    if ($currentFilter -eq $AllowFromIP) {
        Write-Ok "IPv4Filter già impostato a $AllowFromIP"
    } else {
        if ($PSCmdlet.ShouldProcess("WSMan:\localhost\Service\IPv4Filter", "Set value")) {
            try {
                Set-Item WSMan:\localhost\Service\IPv4Filter -Value $AllowFromIP -Force
                Write-Change "IPv4Filter impostato a $AllowFromIP (era: '$currentFilter')"
            } catch {
                Write-Fail "Impossibile impostare IPv4Filter: $($_.Exception.Message)"
            }
        }
    }
} else {
    Write-Step "Restrizione IP (skip: -AllowFromIP non specificato)"
    Write-Skip "WinRM accetta da qualunque host autenticato. Considera -AllowFromIP per hardening."
}

# ═══════════════════════════════════════════════════════════════════════════
# Step 5: Restart WinRM se ci sono state modifiche
# ═══════════════════════════════════════════════════════════════════════════

if ($script:Changes.Count -gt 0 -and -not $WhatIfPreference) {
    Write-Step "Restart servizio WinRM (per applicare modifiche)"
    try {
        Restart-Service winrm -Force -ErrorAction Stop
        Write-Ok "Servizio WinRM riavviato"
    } catch {
        Write-Fail "Restart WinRM fallito: $($_.Exception.Message)"
    }
}

# ═══════════════════════════════════════════════════════════════════════════
# Step 6: Verifica finale
# ═══════════════════════════════════════════════════════════════════════════

if (-not $SkipVerify -and -not $WhatIfPreference) {
    Write-Step "Verifica configurazione"

    # Listener su 5985
    $listener = netstat -ano | Select-String ":5985.*LISTENING" | Select-Object -First 1
    if ($listener) {
        Write-Ok "Listener attivo su porta 5985"
    } else {
        Write-Fail "Nessun listener su 5985. Controlla 'winrm enumerate winrm/config/listener'"
    }

    # Self-loopback
    try {
        $test = Test-NetConnection -ComputerName localhost -Port 5985 -WarningAction SilentlyContinue
        if ($test.TcpTestSucceeded) {
            Write-Ok "Self-loopback localhost:5985 OK"
        } else {
            Write-Fail "Self-loopback fallito (firewall o listener non bindato)"
        }
    } catch {
        Write-Fail "Test-NetConnection fallito: $($_.Exception.Message)"
    }

    # Auth providers (Negotiate=true per NTLM/Kerberos)
    try {
        $authXml = winrm get winrm/config/service/auth 2>&1
        if ($authXml -match "Negotiate\s*=\s*true") {
            Write-Ok "Negotiate auth abilitato (NTLM/Kerberos OK)"
        } else {
            Write-Fail "Negotiate auth NON abilitato — verifica 'winrm get winrm/config/service/auth'"
        }
    } catch {
        Write-Host "  [WARN] Impossibile leggere auth providers: $($_.Exception.Message)" -ForegroundColor Yellow
    }

    # Network profile (info diagnostica)
    try {
        $profile = Get-NetConnectionProfile | Select-Object -First 1
        Write-Host "  [INFO] Network profile primario: $($profile.NetworkCategory) (interface: $($profile.InterfaceAlias))" -ForegroundColor Gray
    } catch { }
}

# ═══════════════════════════════════════════════════════════════════════════
# Sommario finale
# ═══════════════════════════════════════════════════════════════════════════

Write-Host ""
Write-Host "============================================================" -ForegroundColor Magenta
Write-Host " RIEPILOGO" -ForegroundColor Magenta
Write-Host "============================================================" -ForegroundColor Magenta

if ($script:Changes.Count -eq 0) {
    Write-Host "  Sistema già configurato correttamente. Nessuna modifica applicata." -ForegroundColor Green
} else {
    Write-Host "  Modifiche applicate: $($script:Changes.Count)" -ForegroundColor Green
    foreach ($c in $script:Changes) { Write-Host "    - $c" -ForegroundColor Green }
}

if ($script:Failures.Count -gt 0) {
    Write-Host ""
    Write-Host "  ERRORI: $($script:Failures.Count)" -ForegroundColor Red
    foreach ($f in $script:Failures) { Write-Host "    - $f" -ForegroundColor Red }
}

Write-Host ""
Write-Host "  Prossimo passo: imposta la credenziale in DA-IPAM" -ForegroundColor Cyan
$hostname = $env:COMPUTERNAME
switch ($Mode) {
    "Workgroup" {
        Write-Host "    Username: .\Administrator" -ForegroundColor White
    }
    "WorkgroupCustomAdmin" {
        Write-Host "    Username: .\<nomeutente>      (esempio: .\$($env:USERNAME))" -ForegroundColor White
    }
    "Domain" {
        Write-Host "    Username: <user>@$domainName     (esempio UPN, preferito Kerberos)" -ForegroundColor White
        Write-Host "        oppure: $($domainName.Split('.')[0].ToUpper())\<user>" -ForegroundColor White
    }
    "DomainController" {
        Write-Host "    Username: <DomainAdmin>@$domainName" -ForegroundColor White
    }
}
Write-Host ""

if ($script:Failures.Count -gt 0) {
    exit 1
}
exit 0
