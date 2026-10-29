#Requires -Version 5.1
#Requires -Modules GroupPolicy, ActiveDirectory
<#
.SYNOPSIS
  Configura l'audit dei domain controller per la pagina "Sicurezza del dominio" di DA-IPAM.

.DESCRIPTION
  Da lanciare UNA volta, su un DC (o su un server con RSAT), in PowerShell come Domain Admin.
  Idempotente: si puo' rilanciare, rimette le stesse impostazioni.

  Crea (o riusa) una GPO dedicata "DA-IPAM - Audit DC", collegata all'OU Domain Controllers
  con precedenza 1, e la Default Domain Controllers Policy NON viene toccata. Nella GPO:
   1. Criteri di controllo avanzati (Advanced Audit Policy): le 15 sottocategorie che servono,
      per GUID, quindi valgono con Windows in qualsiasi lingua.
   2. "Audit: Force audit policy subcategory settings ... to override ... category settings" = Enabled.
   3. Registro Security: dimensione massima (di serie 1 GB) e sovrascrittura quando e' pieno.
  Poi, fuori dalla GPO:
   4. Controllo (SACL) sulla radice del dominio per vedere DCSync: Everyone, Success,
      "Replicating Directory Changes" e "Replicating Directory Changes All".
   5. (Facoltativo, -Account) mette l'account WinRM di DA-IPAM in "Event Log Readers" e
      "Remote Management Users".

  Con -Prova dice cosa farebbe senza cambiare niente.

.PARAMETER Account
  sAMAccountName dell'account usato da DA-IPAM per WinRM (es. svc-ipam). Facoltativo.

.PARAMETER DimensioneRegistroMB
  Dimensione massima del registro Security in MB (di serie 1024; con centinaia di utenti 2048-4096).

.PARAMETER Prova
  Non cambia niente: elenca le operazioni.

.EXAMPLE
  .\Configura-Audit-DC.ps1 -Account svc-ipam
  .\Configura-Audit-DC.ps1 -Prova
#>
[CmdletBinding()]
param(
  [string]$Account,
  [ValidateRange(64, 8192)][int]$DimensioneRegistroMB = 1024,
  [switch]$Prova
)

$ErrorActionPreference = 'Stop'
Import-Module GroupPolicy, ActiveDirectory

$NomeGpo = 'DA-IPAM - Audit DC'
$dominio = Get-ADDomain
$ouDc = $dominio.DomainControllersContainer
$dnsDominio = $dominio.DNSRoot

function Passo($testo) { Write-Host ("[*] " + $testo) -ForegroundColor Cyan }
function Fatto($testo) { Write-Host ("    " + $testo) -ForegroundColor Green }

# Sottocategorie: GUID (indipendente dalla lingua), nome inglese, valore (1 Success, 2 Failure, 3 entrambi).
$sottocategorie = @(
  @('{0cce923f-69ae-11d9-bed3-505054503030}', 'Audit Credential Validation', 3),
  @('{0cce9242-69ae-11d9-bed3-505054503030}', 'Audit Kerberos Authentication Service', 3),
  @('{0cce9240-69ae-11d9-bed3-505054503030}', 'Audit Kerberos Service Ticket Operations', 1),
  @('{0cce9235-69ae-11d9-bed3-505054503030}', 'Audit User Account Management', 3),
  @('{0cce9237-69ae-11d9-bed3-505054503030}', 'Audit Security Group Management', 1),
  @('{0cce9236-69ae-11d9-bed3-505054503030}', 'Audit Computer Account Management', 1),
  @('{0cce9215-69ae-11d9-bed3-505054503030}', 'Audit Logon', 3),
  @('{0cce9216-69ae-11d9-bed3-505054503030}', 'Audit Logoff', 1),
  @('{0cce9217-69ae-11d9-bed3-505054503030}', 'Audit Account Lockout', 2),
  @('{0cce922f-69ae-11d9-bed3-505054503030}', 'Audit Audit Policy Change', 1),
  @('{0cce9231-69ae-11d9-bed3-505054503030}', 'Audit Authorization Policy Change', 1),
  @('{0cce9230-69ae-11d9-bed3-505054503030}', 'Audit Authentication Policy Change', 1),
  @('{0cce9211-69ae-11d9-bed3-505054503030}', 'Audit Security System Extension', 1),
  @('{0cce923b-69ae-11d9-bed3-505054503030}', 'Audit Directory Service Access', 3),
  @('{0cce923c-69ae-11d9-bed3-505054503030}', 'Audit Directory Service Changes', 1)
)
$testoValore = @{ 1 = 'Success'; 2 = 'Failure'; 3 = 'Success and Failure' }

# --- 1. GPO dedicata, collegata all'OU Domain Controllers con precedenza 1 ---
Passo "GPO '$NomeGpo' collegata a $ouDc"
$gpo = $null
try { $gpo = Get-GPO -Name $NomeGpo } catch { }   # GPO non ancora creata
if ($Prova) {
  if ($gpo) { Fatto 'esiste gia: verrebbe riusata' } else { Fatto 'verrebbe creata' }
} else {
  if (-not $gpo) { $gpo = New-GPO -Name $NomeGpo -Comment 'Audit dei DC per DA-IPAM (Sicurezza del dominio). Creata da Configura-Audit-DC.ps1.' }
  $link = (Get-GPInheritance -Target $ouDc).GpoLinks | Where-Object { $_.GpoId -eq $gpo.Id }
  if (-not $link) { New-GPLink -Guid $gpo.Id -Target $ouDc -LinkEnabled Yes -Order 1 | Out-Null }
  else { Set-GPLink -Guid $gpo.Id -Target $ouDc -LinkEnabled Yes -Order 1 | Out-Null }
  Fatto "GPO $($gpo.Id), collegamento con precedenza 1"
}

# --- 2 e 3. Impostazioni di registro nella GPO (forzatura sottocategorie, registro Security) ---
$registro = @(
  @('HKLM\System\CurrentControlSet\Control\Lsa', 'SCENoApplyLegacyAuditPolicy', 'DWord', 1, 'forzatura delle sottocategorie'),
  @('HKLM\Software\Policies\Microsoft\Windows\EventLog\Security', 'MaxSize', 'DWord', ($DimensioneRegistroMB * 1024), "registro Security $DimensioneRegistroMB MB"),
  @('HKLM\Software\Policies\Microsoft\Windows\EventLog\Security', 'Retention', 'String', '0', 'sovrascrive gli eventi quando e'' pieno')
)
foreach ($r in $registro) {
  Passo $r[4]
  if ($Prova) { Fatto "$($r[0])\$($r[1]) = $($r[3])"; continue }
  Set-GPRegistryValue -Guid $gpo.Id -Key $r[0] -ValueName $r[1] -Type $r[2] -Value $r[3] | Out-Null
  Fatto 'impostato'
}

# --- 1. Advanced Audit Policy: audit.csv nella cartella della GPO in SYSVOL ---
Passo 'criteri di controllo avanzati (15 sottocategorie)'
$righe = @('Machine Name,Policy Target,Subcategory,Subcategory GUID,Inclusion Setting,Exclusion Setting,Setting Value')
foreach ($s in $sottocategorie) {
  $righe += ",System,$($s[1]),$($s[0]),$($testoValore[$s[2]]),,$($s[2])"
  if ($Prova) { Fatto "$($s[1]): $($testoValore[$s[2]])" }
}
if (-not $Prova) {
  $cartella = "\\$dnsDominio\SYSVOL\$dnsDominio\Policies\{$($gpo.Id)}\Machine\Microsoft\Windows NT\Audit"
  New-Item -ItemType Directory -Path $cartella -Force | Out-Null
  $righe | Set-Content -Path (Join-Path $cartella 'audit.csv') -Encoding ASCII

  # Il client applica audit.csv solo se la GPO dichiara l'estensione "Advanced Audit Policy".
  $cseAudit = '[{F3CCC681-B74C-4060-9F26-CD84525DCA2A}{0F3F3735-573D-9804-99E4-AB2A69BA5FD4}]'
  $dnGpo = "CN={$($gpo.Id)},CN=Policies,CN=System,$($dominio.DistinguishedName)"
  $oggetto = Get-ADObject -Identity $dnGpo -Properties gPCMachineExtensionNames
  $estensioni = [string]$oggetto.gPCMachineExtensionNames
  if ($estensioni -notlike '*F3CCC681-B74C-4060-9F26-CD84525DCA2A*') {
    # L'elenco va tenuto in ordine di GUID: lo si rimette in ordine dopo l'aggiunta.
    $voci = @([regex]::Matches($estensioni, '\[[^\]]+\]') | ForEach-Object { $_.Value }) + $cseAudit
    $nuovo = ($voci | Sort-Object -Unique) -join ''
    Set-ADObject -Identity $dnGpo -Replace @{ gPCMachineExtensionNames = $nuovo }
  }
  # Versione della GPO +1 (in AD e in GPT.INI, devono coincidere): i DC la riapplicano al prossimo aggiornamento.
  $versione = [int](Get-ADObject -Identity $dnGpo -Properties versionNumber).versionNumber + 1
  Set-ADObject -Identity $dnGpo -Replace @{ versionNumber = $versione }
  $gptIni = "\\$dnsDominio\SYSVOL\$dnsDominio\Policies\{$($gpo.Id)}\GPT.INI"
  (Get-Content -Path $gptIni) -replace '^Version=\d+', "Version=$versione" | Set-Content -Path $gptIni -Encoding ASCII
  Fatto "scritto $cartella\audit.csv"
}

# --- 4. SACL sulla radice del dominio per DCSync ---
Passo 'controllo sulla radice del dominio per DCSync'
$percorsoAd = "AD:\$($dominio.DistinguishedName)"
$everyone = New-Object System.Security.Principal.SecurityIdentifier('S-1-1-0')
$diritti = @(
  @('1131f6aa-9c07-11d1-f79f-00c04fc2dcd2', 'Replicating Directory Changes'),
  @('1131f6ad-9c07-11d1-f79f-00c04fc2dcd2', 'Replicating Directory Changes All')
)
$acl = Get-Acl -Path $percorsoAd -Audit
$cambiato = $false
foreach ($d in $diritti) {
  $guid = [guid]$d[0]
  $presente = $acl.GetAuditRules($true, $false, [System.Security.Principal.SecurityIdentifier]) | Where-Object {
    $_.IdentityReference -eq $everyone -and $_.ObjectType -eq $guid -and ($_.AuditFlags -band [System.Security.AccessControl.AuditFlags]::Success)
  }
  if ($presente) { Fatto "$($d[1]): gia presente"; continue }
  if ($Prova) { Fatto "$($d[1]): verrebbe aggiunto"; continue }
  $regola = New-Object System.DirectoryServices.ActiveDirectoryAuditRule(
    $everyone,
    [System.DirectoryServices.ActiveDirectoryRights]::ExtendedRight,
    [System.Security.AccessControl.AuditFlags]::Success,
    $guid,
    [System.DirectoryServices.ActiveDirectorySecurityInheritance]::None)
  $acl.AddAuditRule($regola)
  $cambiato = $true
  Fatto "$($d[1]): aggiunto"
}
if ($cambiato) { Set-Acl -Path $percorsoAd -AclObject $acl }

# --- 5. Account di DA-IPAM nei gruppi giusti ---
if ($Account) {
  foreach ($g in @('S-1-5-32-573', 'S-1-5-32-580')) {   # Event Log Readers, Remote Management Users
    $gruppo = Get-ADGroup -Identity $g
    Passo "account $Account in '$($gruppo.Name)'"
    $membro = Get-ADGroupMember -Identity $gruppo | Where-Object { $_.SamAccountName -eq $Account }
    if ($membro) { Fatto 'gia membro'; continue }
    if ($Prova) { Fatto 'verrebbe aggiunto'; continue }
    Add-ADGroupMember -Identity $gruppo -Members $Account
    Fatto 'aggiunto'
  }
}

Write-Host ''
if ($Prova) {
  Write-Host 'Prova finita: non e'' stato cambiato niente. Rilancia senza -Prova per applicare.' -ForegroundColor Yellow
} else {
  Write-Host 'Fatto. Ora su OGNI domain controller:' -ForegroundColor Yellow
  Write-Host '  gpupdate /force'
  Write-Host '  auditpol /get /category:*      (le voci sopra devono risultare accese)'
  Write-Host 'Entro 5 minuti la pagina "Sicurezza del dominio" di DA-IPAM legge i nuovi eventi.'
}
