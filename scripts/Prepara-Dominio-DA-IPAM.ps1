#Requires -Version 5.1
#Requires -RunAsAdministrator
#Requires -Modules ActiveDirectory, GroupPolicy
<#
.SYNOPSIS
  Prepara il dominio per DA-IPAM in un colpo solo: i due account, i gruppi, l'audit dei DC e la GPO
  che apre WMI e WinRM sui PC e server.

.DESCRIPTION
  Da lanciare UNA volta su un domain controller (o su un server con RSAT), in PowerShell aperto
  "come amministratore", con un utente Domain Admins. Idempotente: si puo' rilanciare, trova
  quello che c'e' gia' e fa solo quello che manca.

  DI SERIE NON CAMBIA NIENTE: dice cosa farebbe. Per applicare si aggiunge -Applica.

  I diritti sono quelli della pagina "Cosa serve" di DA-IPAM (src/lib/credentials/diritti.ts):
  due account separati, mai Domain Admins.

   1. Account della sicurezza del dominio (di serie svc-ipam-dc): utente di dominio normale.
      Lo crea se manca (la password si digita al momento, non sta scritta da nessuna parte).
   2. Lo mette in "Event Log Readers" e "Remote Management Users" (eventi dei DC via WinRM) e,
      se nel dominio c'e' il gruppo "DHCP Administrators", anche li' (lease DHCP).
   3. Audit dei DC: lancia Configura-Audit-DC.ps1, che deve stare nella stessa cartella
      (GPO "DA-IPAM - Audit DC" sull'OU Domain Controllers, SACL per DCSync, registro Security).
   4. Account delle scansioni (di serie svc-ipam): utente di dominio, dentro il gruppo globale
      "DA-IPAM Scansioni". Lo crea se manca.
   5. GPO "DA-IPAM - Scansioni PC e server", collegata SOLO alle OU passate con -OuComputer
      (mai all'OU Domain Controllers ne' alla radice del dominio):
       - "DA-IPAM Scansioni" membro di Administrators locale (Gruppi con restrizioni, solo
         "Membro di": non toglie nessuno dagli Administrators che ci sono);
       - servizio WinRM automatico, listener abilitato, filtro sugli IP di -AllowFromIP;
       - regole firewall in ingresso per WinRM (5985) e WMI (RPC), dai soli IP di -AllowFromIP.
      Senza -OuComputer il passo 5 non si fa: lo si dice alla fine.

  Alla fine: riepilogo e cosa scrivere in DA-IPAM.

.PARAMETER Applica
  Applica le modifiche. Senza, lo script elenca soltanto cosa farebbe.

.PARAMETER OuComputer
  DN di una o piu' OU con i PC e i server da scansionare (es. "OU=Computer,OU=Sede,DC=ditta,DC=local").

.PARAMETER AllowFromIP
  IP (o piu' IP separati da virgola) dell'appliance DA-IPAM. Limita WinRM e WMI a quegli indirizzi.
  Se manca si apre a tutta la rete interna: lo script lo dice.

.PARAMETER AccountDc
  sAMAccountName dell'account della sicurezza del dominio. Di serie svc-ipam-dc.

.PARAMETER AccountScansioni
  sAMAccountName dell'account delle scansioni. Di serie svc-ipam.

.PARAMETER SenzaAudit
  Salta il passo 3 (audit dei DC).

.PARAMETER DimensioneRegistroMB
  Dimensione del registro Security dei DC, passata a Configura-Audit-DC.ps1 (di serie 1024).

.EXAMPLE
  .\Prepara-Dominio-DA-IPAM.ps1 -OuComputer "OU=Computer,DC=ditta,DC=local" -AllowFromIP 192.168.1.50
  Prova: dice cosa farebbe.

.EXAMPLE
  .\Prepara-Dominio-DA-IPAM.ps1 -OuComputer "OU=Computer,DC=ditta,DC=local" -AllowFromIP 192.168.1.50 -Applica
  Applica.

.NOTES
  DA-IPAM, 08/11/2026. Cosa fa e i passi a mano: docs/PREPARA-DOMINIO.md.
#>
[CmdletBinding()]
param(
  [switch]$Applica,
  [string[]]$OuComputer = @(),
  [string]$AllowFromIP = '',
  [string]$AccountDc = 'svc-ipam-dc',
  [string]$AccountScansioni = 'svc-ipam',
  [switch]$SenzaAudit,
  [ValidateRange(64, 8192)][int]$DimensioneRegistroMB = 1024
)

$ErrorActionPreference = 'Stop'
Import-Module ActiveDirectory, GroupPolicy

$Prova = -not $Applica

# Nomi scritti una volta, qui. I gruppi sono quelli di diritti.ts (GRUPPI); quelli predefiniti si
# cercano per SID, cosi' lo script vale anche con un dominio in un'altra lingua.
$GruppoLettoriRegistri = 'Event Log Readers'        # S-1-5-32-573
$GruppoGestioneRemota  = 'Remote Management Users'  # S-1-5-32-580
$GruppoDhcp            = 'DHCP Administrators'      # creato dal ruolo DHCP, senza SID fisso
$GruppoDomainAdmins    = 'Domain Admins'            # <SID del dominio>-512
$SidLettoriRegistri    = 'S-1-5-32-573'
$SidGestioneRemota     = 'S-1-5-32-580'
$GruppoScansioni       = 'DA-IPAM Scansioni'
$NomeGpoScansioni      = 'DA-IPAM - Scansioni PC e server'
$SidAdministrators     = 'S-1-5-32-544'
# Estensione lato client "Security" (Gruppi con restrizioni) della GPO.
$CseSicurezza          = '[{827D319E-6EAC-11D2-A4EA-00C04F79F83A}{803E14A0-B4FB-11D0-A0D0-00A0C90F574B}]'

$dominio    = Get-ADDomain
$dnsDominio = $dominio.DNSRoot
$ouDc       = $dominio.DomainControllersContainer
$radice     = $dominio.DistinguishedName
$avvisi     = New-Object System.Collections.Generic.List[string]
$SidDomainAdmins = "$($dominio.DomainSID.Value)-512"

function Passo($testo)  { Write-Host ''; Write-Host ("[*] " + $testo) -ForegroundColor Cyan }
function Fatto($testo)  { Write-Host ("    " + $testo) -ForegroundColor Green }
function Farei($testo)  { Write-Host ("    farei: " + $testo) -ForegroundColor Yellow }
function Avviso($testo) { Write-Host ("    ATTENZIONE: " + $testo) -ForegroundColor Magenta; $avvisi.Add($testo) }
function Ferma($testo)  { Write-Host ''; Write-Host ("[X] " + $testo) -ForegroundColor Red; exit 1 }

# Esegue un cambiamento solo con -Applica; senza, lo descrive.
function Cambia([string]$descrizione, [scriptblock]$azione) {
  if ($Prova) { Farei $descrizione; return }
  & $azione
  Fatto $descrizione
}

function Chiedi-Password([string]$account) {
  $p1 = Read-Host "Password nuova per $account" -AsSecureString
  $p2 = Read-Host "Ripeti la password di $account" -AsSecureString
  $t1 = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($p1))
  $t2 = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($p2))
  if ($t1 -ne $t2) { Ferma "le due password di $account non coincidono: niente creato, rilancia" }
  if ($t1.Length -lt 16) { Ferma "password di $account troppo corta (almeno 16 caratteri): niente creato, rilancia" }
  return $p1
}

function Assicura-Account([string]$account, [string]$descrizione) {
  $u = Get-ADUser -Filter "SamAccountName -eq '$account'" -Properties Enabled, MemberOf
  if ($u) {
    Fatto "l'account $account c'e' gia'"
    if (-not $u.Enabled) { Cambia "riattivo l'account $account (era disattivato)" { Enable-ADAccount -Identity $account } }
  } else {
    Cambia "creo l'account $account ($descrizione), password chiesta adesso, non scade" {
      $password = Chiedi-Password $account
      New-ADUser -Name $account -SamAccountName $account -UserPrincipalName "$account@$dnsDominio" `
        -AccountPassword $password -PasswordNeverExpires $true -CannotChangePassword $true -Enabled $true `
        -Description $descrizione
    }
  }
  # Mai Domain Admins (regola di diritti.ts): se lo e', ci si ferma e lo si dice.
  if ($u) {
    $da = Get-ADGroupMember -Identity $SidDomainAdmins -Recursive | Where-Object { $_.SamAccountName -eq $account }
    if ($da) { Ferma "$account e' in $GruppoDomainAdmins: nessuna funzione di DA-IPAM lo richiede. Toglilo e rilancia." }
  }
}

# $gruppo: nome per i messaggi; $identita: SID del gruppo se ne ha uno fisso, altrimenti il nome.
function Assicura-Membro([string]$gruppo, [string]$membro, [string]$identita = '') {
  $g = $null
  if ($identita -like 'S-1-*') { $g = Get-ADGroup -Filter "SID -eq '$identita'" }
  else { $g = Get-ADGroup -Filter "Name -eq '$gruppo'" }
  if (-not $g) { return $false }
  $gruppo = $g.Name
  $c = Get-ADGroupMember -Identity $g | Where-Object { $_.SamAccountName -eq $membro }
  if ($c) { Fatto "$membro e' gia' in '$gruppo'" }
  else { Cambia "metto $membro in '$gruppo'" { Add-ADGroupMember -Identity $g -Members $membro } }
  return $true
}

# --- 0. Controlli prima di toccare qualcosa ---
Passo "controlli"
$io = [Security.Principal.WindowsIdentity]::GetCurrent()
$daMembri = Get-ADGroupMember -Identity $SidDomainAdmins -Recursive | Select-Object -ExpandProperty SID | ForEach-Object { $_.Value }
if (-not ($io.Groups | Where-Object { $daMembri -contains $_.Value }) -and -not ($daMembri -contains $io.User.Value)) {
  Ferma "lancia lo script con un utente $GruppoDomainAdmins (ora: $($io.Name))"
}
Fatto "utente $($io.Name), dominio $dnsDominio"
foreach ($ou in $OuComputer) {
  if ($ou -ieq $ouDc) { Ferma "-OuComputer non puo' essere l'OU Domain Controllers: l'account delle scansioni diventerebbe amministratore dei DC" }
  if ($ou -ieq $radice) { Ferma "-OuComputer non puo' essere la radice del dominio: la GPO arriverebbe anche ai DC. Indica le OU dei PC e dei server" }
  try { Get-ADOrganizationalUnit -Identity $ou | Out-Null } catch { Ferma "OU non trovata: $ou" }
  $dcDentro = Get-ADComputer -SearchBase $ou -Filter 'PrimaryGroupID -eq 516'
  if ($dcDentro) { Ferma "nell'OU $ou ci sono domain controller ($($dcDentro.Name -join ', ')): la GPO delle scansioni non va su di loro" }
  Fatto "OU dei computer: $ou"
}
if ($AllowFromIP) { Fatto "WinRM e WMI aperti solo da: $AllowFromIP" }
elseif ($OuComputer.Count -gt 0) { Avviso "manca -AllowFromIP: WinRM e WMI si aprono a tutta la rete. Meglio indicare l'IP dell'appliance DA-IPAM." }
if ($Prova) { Write-Host '    PROVA: non cambio niente. Per applicare rilancia con -Applica.' -ForegroundColor Yellow }

# --- 1-2. Account della sicurezza del dominio e i suoi gruppi ---
Passo "account della sicurezza del dominio: $AccountDc"
Assicura-Account $AccountDc 'DA-IPAM: lettura di AD, eventi dei DC e DHCP. Mai Domain Admins.'
Passo "gruppi di $AccountDc"
foreach ($gr in @(@($GruppoLettoriRegistri, $SidLettoriRegistri), @($GruppoGestioneRemota, $SidGestioneRemota))) {
  if (-not (Assicura-Membro $gr[0] $AccountDc $gr[1])) { Avviso "gruppo '$($gr[0])' ($($gr[1])) non trovato: e' un gruppo predefinito dei DC" }
}
if (-not (Assicura-Membro $GruppoDhcp $AccountDc)) {
  Fatto "nessun gruppo '$GruppoDhcp': niente DHCP Microsoft nel dominio, passo saltato"
}

# --- 3. Audit dei DC ---
Passo "audit dei domain controller"
if ($SenzaAudit) {
  Fatto 'saltato (-SenzaAudit)'
} else {
  $audit = Join-Path $PSScriptRoot 'Configura-Audit-DC.ps1'
  if (-not (Test-Path $audit)) {
    Avviso "Configura-Audit-DC.ps1 non e' nella cartella dello script: scaricalo da DA-IPAM (Sicurezza del dominio > Come configurare i DC) e rilancia, oppure usa -SenzaAudit"
  } elseif ($Prova) {
    & $audit -Account $AccountDc -DimensioneRegistroMB $DimensioneRegistroMB -Prova
  } else {
    & $audit -Account $AccountDc -DimensioneRegistroMB $DimensioneRegistroMB
  }
}

# --- 4. Account delle scansioni e il suo gruppo ---
Passo "account delle scansioni: $AccountScansioni"
Assicura-Account $AccountScansioni 'DA-IPAM: inventario, software e patch su PC e server (Administrators locale via GPO).'
$gs = Get-ADGroup -Filter "Name -eq '$GruppoScansioni'"
if ($gs) { Fatto "il gruppo '$GruppoScansioni' c'e' gia'" }
else {
  Cambia "creo il gruppo globale '$GruppoScansioni'" {
    New-ADGroup -Name $GruppoScansioni -SamAccountName $GruppoScansioni -GroupScope Global -GroupCategory Security `
      -Description 'DA-IPAM: membri Administrators locali sui PC e server (GPO DA-IPAM - Scansioni PC e server)'
  }
}
if ($gs -or -not $Prova) { Assicura-Membro $GruppoScansioni $AccountScansioni | Out-Null }
else { Farei "metto $AccountScansioni in '$GruppoScansioni'" }

# --- 5. GPO delle scansioni ---
Passo "GPO '$NomeGpoScansioni'"
if ($OuComputer.Count -eq 0) {
  Avviso "nessuna -OuComputer: la GPO delle scansioni non e' stata creata. Senza, $AccountScansioni non e' amministratore su nessun PC: rilancia con -OuComputer"
} else {
  $gpo = Get-GPO -Name $NomeGpoScansioni -ErrorAction SilentlyContinue
  if ($gpo) { Fatto "la GPO c'e' gia'" }
  else {
    Cambia "creo la GPO" { $script:gpo = New-GPO -Name $NomeGpoScansioni -Comment 'Creata da Prepara-Dominio-DA-IPAM.ps1: Administrators locale per DA-IPAM Scansioni, WinRM e WMI.' }
  }
  $filtro = if ($AllowFromIP) { $AllowFromIP } else { '*' }
  $remoti = if ($AllowFromIP) { $AllowFromIP.Split(',') | ForEach-Object { $_.Trim() } } else { @('LocalSubnet') }

  # WinRM: servizio automatico, listener dalla policy, filtro IP.
  $registro = @(
    @('HKLM\SYSTEM\CurrentControlSet\Services\WinRM', 'Start', 'DWord', 2),
    @('HKLM\SOFTWARE\Policies\Microsoft\Windows\WinRM\Service', 'AllowAutoConfig', 'DWord', 1),
    @('HKLM\SOFTWARE\Policies\Microsoft\Windows\WinRM\Service', 'IPv4Filter', 'String', $filtro),
    @('HKLM\SOFTWARE\Policies\Microsoft\Windows\WinRM\Service', 'IPv6Filter', 'String', $(if ($AllowFromIP) { '' } else { '*' }))
  )
  foreach ($r in $registro) {
    Cambia "GPO: $($r[0])\$($r[1]) = $($r[3])" {
      Set-GPRegistryValue -Name $NomeGpoScansioni -Key $r[0] -ValueName $r[1] -Type $r[2] -Value $r[3] | Out-Null
    }
  }

  # Firewall nella GPO: WinRM 5985 e WMI (mappatore RPC + porte dinamiche del servizio winmgmt).
  $negozio = "$dnsDominio\$NomeGpoScansioni"
  $regole = @(
    @{ Name = 'DA-IPAM-WinRM';     DisplayName = 'DA-IPAM - WinRM (HTTP 5985)';    LocalPort = '5985';     Service = $null },
    @{ Name = 'DA-IPAM-WMI-RPCEP'; DisplayName = 'DA-IPAM - WMI (mappatore RPC)';  LocalPort = 'RPCEPMap'; Service = 'rpcss' },
    @{ Name = 'DA-IPAM-WMI';       DisplayName = 'DA-IPAM - WMI (RPC dinamico)';   LocalPort = 'RPC';      Service = 'winmgmt' }
  )
  foreach ($rg in $regole) {
    Cambia "GPO firewall: $($rg.DisplayName), da $($remoti -join ', ')" {
      $c = Get-NetFirewallRule -PolicyStore $negozio -Name $rg.Name -ErrorAction SilentlyContinue
      if ($c) {
        Set-NetFirewallRule -PolicyStore $negozio -Name $rg.Name -RemoteAddress $remoti -Enabled True | Out-Null
      } else {
        $arg = @{ PolicyStore = $negozio; Name = $rg.Name; DisplayName = $rg.DisplayName; Direction = 'Inbound'; Action = 'Allow';
                  Protocol = 'TCP'; LocalPort = $rg.LocalPort; RemoteAddress = $remoti; Profile = 'Domain'; Enabled = 'True' }
        if ($rg.Service) { $arg.Service = $rg.Service }
        New-NetFirewallRule @arg | Out-Null
      }
    }
  }

  # Gruppi con restrizioni: "DA-IPAM Scansioni" membro di Administrators (solo "Membro di", additivo).
  Cambia "GPO: '$GruppoScansioni' membro di Administrators locale (Gruppi con restrizioni)" {
    $g = Get-GPO -Name $NomeGpoScansioni
    $sidGruppo = (Get-ADGroup -Identity $GruppoScansioni).SID.Value
    $cartella = "\\$dnsDominio\SYSVOL\$dnsDominio\Policies\{$($g.Id)}"
    $secedit = Join-Path $cartella 'Machine\Microsoft\Windows NT\SecEdit'
    New-Item -ItemType Directory -Force -Path $secedit | Out-Null
    $inf = @(
      '[Unicode]', 'Unicode=yes',
      '[Version]', 'signature="$CHICAGO$"', 'Revision=1',
      '[Group Membership]', "*$($sidGruppo)__Memberof = *$SidAdministrators"
    )
    Set-Content -Path (Join-Path $secedit 'GptTmpl.inf') -Value $inf -Encoding Unicode
    # L'estensione "Security" fra quelle della GPO (in ordine), poi la versione del computer +1
    # in AD e in GPT.INI, perche' i client rileggano la GPO.
    $dnGpo = "CN={$($g.Id)},CN=Policies,CN=System,$radice"
    $ad = Get-ADObject -Identity $dnGpo -Properties gPCMachineExtensionNames, versionNumber
    $estensioni = @()
    if ($ad.gPCMachineExtensionNames) { $estensioni = [regex]::Matches($ad.gPCMachineExtensionNames, '\[[^\]]+\]') | ForEach-Object { $_.Value } }
    if ($estensioni -notcontains $CseSicurezza) { $estensioni += $CseSicurezza }
    $estensioni = $estensioni | Sort-Object -Unique
    $gptIni = Join-Path $cartella 'GPT.INI'
    $verIni = 0
    if (Test-Path $gptIni) { $m = Select-String -Path $gptIni -Pattern '^Version=(\d+)'; if ($m) { $verIni = [int]$m.Matches[0].Groups[1].Value } }
    $nuova = [Math]::Max([int]$ad.versionNumber, $verIni) + 1
    Set-ADObject -Identity $dnGpo -Replace @{ gPCMachineExtensionNames = ($estensioni -join ''); versionNumber = $nuova }
    Set-Content -Path $gptIni -Value @('[General]', "Version=$nuova") -Encoding ASCII
  }

  foreach ($ou in $OuComputer) {
    $collegata = (Get-GPInheritance -Target $ou).GpoLinks | Where-Object { $_.DisplayName -eq $NomeGpoScansioni }
    if ($collegata) { Fatto "GPO gia' collegata a $ou" }
    else { Cambia "collego la GPO a $ou" { New-GPLink -Name $NomeGpoScansioni -Target $ou -LinkEnabled Yes | Out-Null } }
  }
}

# --- Riepilogo ---
Write-Host ''
if ($Prova) {
  Write-Host 'PROVA finita: non e'' stato cambiato niente. Rilancia con -Applica per applicare.' -ForegroundColor Yellow
} else {
  Write-Host 'Fatto.' -ForegroundColor Green
  Write-Host "In DA-IPAM:" -ForegroundColor Green
  Write-Host "  - Active Directory > Nuova integrazione: account $AccountDc@$dnsDominio (voce 'Active Directory' delle credenziali)"
  Write-Host "  - Credenziali > Windows: account $AccountScansioni@$dnsDominio, per le scansioni di PC e server"
  Write-Host '  - I PC prendono la GPO al prossimo aggiornamento (al massimo 90 minuti, o gpupdate /force).'
}
if ($avvisi.Count -gt 0) {
  Write-Host ''
  Write-Host 'Da guardare:' -ForegroundColor Magenta
  $avvisi | ForEach-Object { Write-Host "  - $_" -ForegroundColor Magenta }
}
