#Requires -Version 5.1
#Requires -Modules GroupPolicy, ActiveDirectory
<#
.SYNOPSIS
  Prepara il dominio per DA-IPAM: i due account, i loro diritti e WinRM sui PC e server con una GPO.

.DESCRIPTION
  Da lanciare UNA volta, su un DC (o su un server con RSAT), in PowerShell come Domain Admin.
  Idempotente: si puo' rilanciare. Con -Prova dice cosa farebbe senza cambiare niente.

  I diritti sono quelli della pagina "Cosa serve" di DA-IPAM (src/lib/credentials/diritti.ts):
   1. Account delle scansioni (di serie svc-ipam): utente di dominio, nel gruppo "DA-IPAM Scansioni".
      Quel gruppo diventa Administrators locale SOLO sui computer delle OU indicate (-OU).
   2. Account della sicurezza del dominio (di serie svc-ipam-dc): utente di dominio normale, in
      "Event Log Readers" e "Remote Management Users" (e "DHCP Administrators" se il gruppo esiste).
      Nessun diritto di amministrazione: legge AD, eventi e DHCP.
   3. GPO "DA-IPAM - WinRM", collegata alle OU indicate, che sui computer:
      - avvia il servizio WinRM in automatico e apre il listener HTTP 5985;
      - apre nel firewall WinRM (5985) e WMI (RPC), solo dall'IP di DA-IPAM se dato (-IpDaIpam);
      - mette "DA-IPAM Scansioni" in Administrators locale (senza togliere nessun altro membro).
   Mai Domain Admins. La GPO non si collega alla radice del dominio ne' all'OU Domain Controllers:
   sui DC l'Administrators locale non serve e non si da'.

  Le password si digitano al momento (due volte) e non restano scritte da nessuna parte.
  Un account che esiste gia' non viene toccato: ne' password ne' attributi.
  La GPO e' tutta di questo script: a ogni lancio le sue impostazioni (anche GptTmpl.inf) si riscrivono.
  Sui computer delle OU la policy WinRM prende il posto di altre configurazioni WinRM (RMM, Ansible):
  con -IpDaIpam il servizio risponde solo da quegli IP.
  Le scritture su AD e SYSVOL vanno tutte al PDC emulator, perche' versione e file restino coerenti.

.PARAMETER OU
  Una o piu' OU dei computer da scansionare (DN completo), es. "OU=Server,DC=cliente,DC=local".
  Obbligatoria: la GPO si collega solo qui.

.PARAMETER IpDaIpam
  IP dell'appliance DA-IPAM (uno o piu'). Se dato, WinRM e WMI accettano connessioni solo da li'.

.PARAMETER AccountScansioni
  sAMAccountName dell'account delle scansioni (di serie svc-ipam).

.PARAMETER AccountDc
  sAMAccountName dell'account della sicurezza del dominio (di serie svc-ipam-dc).

.PARAMETER Prova
  Non cambia niente: elenca le operazioni.

.EXAMPLE
  .\Configura-Dominio-DA-IPAM.ps1 -OU "OU=Server,DC=cliente,DC=local" -IpDaIpam 172.16.0.2 -Prova
  .\Configura-Dominio-DA-IPAM.ps1 -OU "OU=Server,DC=cliente,DC=local","OU=PC,DC=cliente,DC=local" -IpDaIpam 172.16.0.2
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][ValidateNotNullOrEmpty()][string[]]$OU,
  [ValidateScript({ $x = $null; [ipaddress]::TryParse($_, [ref]$x) -and $x.AddressFamily -eq 'InterNetwork' -and $_ -match '^\d{1,3}(\.\d{1,3}){3}\z' })][string[]]$IpDaIpam,
  [ValidatePattern('^[A-Za-z0-9._-]{1,20}\z')][string]$AccountScansioni = 'svc-ipam',
  [ValidatePattern('^[A-Za-z0-9._-]{1,20}\z')][string]$AccountDc = 'svc-ipam-dc',
  [switch]$Prova
)

$ErrorActionPreference = 'Stop'
Import-Module GroupPolicy, ActiveDirectory

$NomeGpo = 'DA-IPAM - WinRM'
$NomeGruppo = 'DA-IPAM Scansioni'
$dominio = Get-ADDomain
$dnsDominio = $dominio.DNSRoot
$pdc = $dominio.PDCEmulator

function Passo($testo) { Write-Host ("[*] " + $testo) -ForegroundColor Cyan }
function Fatto($testo) { Write-Host ("    " + $testo) -ForegroundColor Green }
function Avviso($testo) { Write-Host ("    ATTENZIONE: " + $testo) -ForegroundColor Yellow }

# --- 0. Le OU: esistono, e non sono la radice ne' i Domain Controllers ---
Passo 'controllo delle OU'
$ouNormali = @()
foreach ($o in $OU) {
  if ($o.Trim() -ieq $dominio.DistinguishedName) { throw "La GPO non si collega alla radice del dominio ($o): arriverebbe anche ai DC. Indica le OU dei computer." }
  try { $dn = (Get-ADOrganizationalUnit -Identity $o -Server $pdc).DistinguishedName } catch { throw "OU non trovata: ${o}" }
  if ($dn -ieq $dominio.DomainControllersContainer) { throw "La GPO non si collega a ${dn}: sui DC l'Administrators locale non si da'." }
  # Fallisce chiuso: se non si riesce a leggere l'OU non si collega niente. 516 = DC, 521 = RODC.
  try { $dcDentro = @(Get-ADComputer -Server $pdc -SearchBase $dn -Filter 'primaryGroupID -eq 516 -or primaryGroupID -eq 521') }
  catch { throw "Non riesco a controllare se in $dn ci sono domain controller: non collego niente. ($($_.Exception.Message))" }
  if ($dcDentro.Count -gt 0) { throw "Nell'OU $dn ci sono domain controller ($($dcDentro.Name -join ', ')): scegli un'OU senza DC." }
  $ouNormali += $dn
  Fatto "$dn"
}
if (-not $IpDaIpam) { Avviso 'senza -IpDaIpam WinRM e WMI rispondono da qualunque IP della rete: consigliato indicare l''IP di DA-IPAM' }

function Leggi-Password([string]$nome) {
  for ($i = 0; $i -lt 3; $i++) {
    $a = Read-Host "Password per $nome" -AsSecureString
    $b = Read-Host "Ripeti la password per $nome" -AsSecureString
    $pa = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($a)
    $pb = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($b)
    try {
      $uguali = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pa) -ceq [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pb)
    } finally {
      [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pa)
      [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pb)
    }
    if ($uguali -and $a.Length -gt 0) { return $a }
    Avviso 'le due password non coincidono (o sono vuote), riprova'
  }
  throw "Password per $nome non confermata."
}

function Assicura-Account([string]$nome, [string]$descrizione) {
  Passo "account $nome"
  $u = Get-ADUser -Filter "SamAccountName -eq '$nome'" -Properties MemberOf -Server $pdc
  if ($u) {
    Fatto 'esiste gia: non lo tocco (password e attributi restano come sono)'
  } elseif ($Prova) {
    Fatto "verrebbe creato in $($dominio.UsersContainer), con la password chiesta al momento"
  } else {
    $pw = Leggi-Password $nome
    New-ADUser -Name $nome -SamAccountName $nome -UserPrincipalName "$nome@$dnsDominio" `
      -AccountPassword $pw -PasswordNeverExpires $true -CannotChangePassword $true -Enabled $true `
      -Description $descrizione -Server $pdc
    $u = Get-ADUser -Identity $nome -Properties MemberOf -Server $pdc
    Fatto 'creato'
  }
  if ($u) {
    $da = Get-ADGroup -Identity "$($dominio.DomainSID)-512" -Server $pdc
    if ($u.MemberOf -contains $da.DistinguishedName) { Avviso "$nome e' in $($da.Name): DA-IPAM non ne ha bisogno, toglilo" }
  }
}

function Assicura-Membro($gruppo, [string]$nome) {
  Passo "$nome in '$($gruppo.Name)'"
  $u = Get-ADUser -Filter "SamAccountName -eq '$nome'" -Properties MemberOf -Server $pdc
  if (-not $u) { Fatto 'account non ancora creato (prova)'; return }
  if ($u.MemberOf -contains $gruppo.DistinguishedName) { Fatto 'gia membro'; return }
  if ($Prova) { Fatto 'verrebbe aggiunto'; return }
  Add-ADGroupMember -Identity $gruppo -Members $nome -Server $pdc
  Fatto 'aggiunto'
}

# --- 1. Account delle scansioni e suo gruppo ---
Assicura-Account $AccountScansioni 'DA-IPAM: scansioni di PC e server (Administrators locale tramite GPO DA-IPAM - WinRM)'
Passo "gruppo '$NomeGruppo'"
$gruppoScansioni = Get-ADGroup -Filter "Name -eq '$NomeGruppo'" -Server $pdc
if ($gruppoScansioni) { Fatto 'esiste gia' }
elseif ($Prova) { Fatto "verrebbe creato in $($dominio.UsersContainer)" }
else {
  $gruppoScansioni = New-ADGroup -Server $pdc -Name $NomeGruppo -GroupScope Global -GroupCategory Security `
    -Path $dominio.UsersContainer -Description 'DA-IPAM: Administrators locale sui computer delle OU della GPO DA-IPAM - WinRM' -PassThru
  Fatto 'creato'
}
if ($gruppoScansioni) { Assicura-Membro $gruppoScansioni $AccountScansioni }

# --- 2. Account della sicurezza del dominio e i suoi gruppi (tutti non amministrativi) ---
Assicura-Account $AccountDc 'DA-IPAM: lettura di AD, eventi dei DC e DHCP (nessun diritto di amministrazione)'
foreach ($sid in @('S-1-5-32-573', 'S-1-5-32-580')) {   # Event Log Readers, Remote Management Users
  Assicura-Membro (Get-ADGroup -Identity $sid -Server $pdc) $AccountDc
}
# Il gruppo DHCP non ha un SID noto e il nome dipende dalla lingua del DC che l'ha creato.
$dhcp = Get-ADGroup -Server $pdc -Filter "Name -eq 'DHCP Administrators' -or Name -eq 'Amministratori DHCP'"
if ($dhcp) { Assicura-Membro $dhcp $AccountDc }
else {
  Passo 'gruppo degli amministratori DHCP'
  $serverDhcp = @(Get-ADObject -Server $pdc -SearchBase "CN=NetServices,CN=Services,$((Get-ADRootDSE -Server $pdc).configurationNamingContext)" -Filter "objectClass -eq 'dHCPClass'" -ErrorAction SilentlyContinue | Where-Object { $_.Name -ne 'DhcpRoot' })
  if ($serverDhcp.Count -gt 0) { Avviso "ci sono server DHCP autorizzati ma non trovo il gruppo per nome: aggiungi $AccountDc a mano al gruppo degli amministratori DHCP" }
  else { Fatto 'nessun server DHCP di Windows autorizzato: salto' }
}

# --- 3. GPO WinRM: prima le impostazioni, poi i collegamenti (una GPO a meta' non si collega) ---
Passo "GPO '$NomeGpo'"
$gpo = $null
try { $gpo = Get-GPO -Name $NomeGpo -Server $pdc } catch { }   # GPO non ancora creata
if ($Prova) {
  if ($gpo) { Fatto 'esiste gia: verrebbe riusata' } else { Fatto 'verrebbe creata' }
} elseif (-not $gpo) {
  $gpo = New-GPO -Server $pdc -Name $NomeGpo -Comment 'WinRM, firewall e Administrators locale per DA-IPAM. Creata da Configura-Dominio-DA-IPAM.ps1.'
  Fatto "creata ($($gpo.Id))"
} else { Fatto "esiste gia ($($gpo.Id))" }

# Filtro WinRM: gli IP di DA-IPAM (separati da virgola, come vuole la policy) o * se non dati.
# Nelle regole del firewall invece ogni indirizzo remoto e' una chiave RA4 ripetuta.
$filtro4 = if ($IpDaIpam) { $IpDaIpam -join ',' } else { '*' }
$remoto = if ($IpDaIpam) { ($IpDaIpam | ForEach-Object { "RA4=$_|" }) -join '' } else { '' }
$regole = 'HKLM\Software\Policies\Microsoft\WindowsFirewall\FirewallRules'
$chiaveWinRM = 'HKLM\Software\Policies\Microsoft\Windows\WinRM\Service'
$registro = @(
  @('HKLM\SYSTEM\CurrentControlSet\Services\WinRM', 'Start', 'DWord', 2, 'servizio WinRM in avvio automatico'),
  @($chiaveWinRM, 'AllowAutoConfig', 'DWord', 1, 'listener WinRM (gestione remota)'),
  @($chiaveWinRM, 'IPv4Filter', 'String', $filtro4, "WinRM accetta IPv4 da: $filtro4"),
  @($regole, 'DA-IPAM-WinRM', 'String', "v2.10|Action=Allow|Active=TRUE|Dir=In|Protocol=6|LPort=5985|$($remoto)Name=DA-IPAM WinRM|Desc=Creata da Configura-Dominio-DA-IPAM.ps1|", 'firewall: WinRM 5985'),
  @($regole, 'DA-IPAM-WMI-EPMap', 'String', "v2.10|Action=Allow|Active=TRUE|Dir=In|Protocol=6|LPort=RPC-EPMap|App=%SystemRoot%\system32\svchost.exe|Svc=RpcSs|$($remoto)Name=DA-IPAM WMI (RPC 135)|Desc=Creata da Configura-Dominio-DA-IPAM.ps1|", 'firewall: RPC 135 per WMI'),
  @($regole, 'DA-IPAM-WMI', 'String', "v2.10|Action=Allow|Active=TRUE|Dir=In|Protocol=6|LPort=RPC|App=%SystemRoot%\system32\svchost.exe|Svc=winmgmt|$($remoto)Name=DA-IPAM WMI|Desc=Creata da Configura-Dominio-DA-IPAM.ps1|", 'firewall: WMI (porte RPC dinamiche)')
)
# IPv6: senza restrizione si accetta da tutti; con la restrizione il valore non si scrive (nessun ascolto IPv6).
if (-not $IpDaIpam) { $registro += , @($chiaveWinRM, 'IPv6Filter', 'String', '*', 'WinRM accetta IPv6 da: *') }
foreach ($r in $registro) {
  Passo $r[4]
  if ($Prova) { Fatto "$($r[0])\$($r[1])"; continue }
  Set-GPRegistryValue -Server $pdc -Guid $gpo.Id -Key $r[0] -ValueName $r[1] -Type $r[2] -Value $r[3] | Out-Null
  Fatto 'impostato'
}
if ($IpDaIpam -and -not $Prova) {
  # Un lancio precedente senza -IpDaIpam aveva scritto IPv6Filter = *: si toglie.
  try { Remove-GPRegistryValue -Server $pdc -Guid $gpo.Id -Key $chiaveWinRM -ValueName 'IPv6Filter' -ErrorAction Stop | Out-Null; Fatto 'tolto IPv6Filter di un lancio precedente' } catch { }
}

# Gruppi con restrizioni ("Membro di"): DA-IPAM Scansioni entra in Administrators locale, gli altri restano.
Passo "'$NomeGruppo' in Administrators locale sui computer delle OU"
if ($Prova) {
  Fatto 'verrebbe scritto GptTmpl.inf con *SID__Memberof = *S-1-5-32-544'
} else {
  $sidGruppo = $gruppoScansioni.SID.Value
  $radiceGpo = "\\$pdc\SYSVOL\$dnsDominio\Policies\{$($gpo.Id)}"
  $cartella = "$radiceGpo\Machine\Microsoft\Windows NT\SecEdit"
  New-Item -ItemType Directory -Path $cartella -Force | Out-Null
  @(
    '[Unicode]', 'Unicode=yes',
    '[Version]', 'signature="$CHICAGO$"', 'Revision=1',
    '[Group Membership]', "*$($sidGruppo)__Memberof = *S-1-5-32-544", "*$($sidGruppo)__Members ="
  ) | Set-Content -Path (Join-Path $cartella 'GptTmpl.inf') -Encoding Unicode

  # Il client applica GptTmpl.inf solo se la GPO dichiara l'estensione "Security".
  $cseSicurezza = '[{827D319E-6EAC-11D2-A4EA-00C04F79F83A}{803E14A0-B4FB-11D0-A0D0-00A0C90F574B}]'
  $dnGpo = "CN={$($gpo.Id)},CN=Policies,CN=System,$($dominio.DistinguishedName)"
  $estensioni = [string](Get-ADObject -Server $pdc -Identity $dnGpo -Properties gPCMachineExtensionNames).gPCMachineExtensionNames
  if ($estensioni -notlike '*827D319E-6EAC-11D2-A4EA-00C04F79F83A*') {
    # L'elenco va tenuto in ordine di GUID.
    $voci = @([regex]::Matches($estensioni, '\[[^\]]+\]') | ForEach-Object { $_.Value }) + $cseSicurezza
    Set-ADObject -Server $pdc -Identity $dnGpo -Replace @{ gPCMachineExtensionNames = (($voci | Sort-Object -Unique) -join '') }
  }
  # Versione della GPO +1, in AD e in GPT.INI sullo stesso DC (il PDC), che devono coincidere.
  $versione = [int](Get-ADObject -Server $pdc -Identity $dnGpo -Properties versionNumber).versionNumber + 1
  Set-ADObject -Server $pdc -Identity $dnGpo -Replace @{ versionNumber = $versione }
  $gptIni = "$radiceGpo\GPT.INI"
  (Get-Content -Path $gptIni) -replace '^Version=\d+', "Version=$versione" | Set-Content -Path $gptIni -Encoding ASCII
  Fatto "scritto $cartella\GptTmpl.inf"
}

# Collegamenti, solo alle OU controllate. Un collegamento che esiste ma e' disattivato non si riaccende.
foreach ($o in $ouNormali) {
  Passo "collegamento a $o"
  if ($Prova) { Fatto 'verrebbe collegata'; continue }
  $link = (Get-GPInheritance -Server $pdc -Target $o).GpoLinks | Where-Object { $_.GpoId -eq $gpo.Id }
  if (-not $link) { New-GPLink -Server $pdc -Guid $gpo.Id -Target $o -LinkEnabled Yes | Out-Null; Fatto 'collegata' }
  elseif ($link.Enabled) { Fatto 'gia collegata' }
  else { Avviso 'il collegamento c''e'' ma e'' disattivato: lo lascio cosi'', riaccendilo a mano se serve' }
}

Write-Host ''
if ($Prova) {
  Write-Host 'Prova finita: non e'' stato cambiato niente. Rilancia senza -Prova per applicare.' -ForegroundColor Yellow
} else {
  Write-Host 'Fatto. Su un computer di una delle OU:' -ForegroundColor Yellow
  Write-Host '  gpupdate /force'
  Write-Host '  Start-Service WinRM            (o un riavvio: sui PC WinRM era in avvio manuale, la GPO cambia solo il tipo di avvio)'
  Write-Host '  winrm enumerate winrm/config/listener        (deve esserci il listener HTTP 5985)'
  Write-Host "  net localgroup Administrators                (deve esserci $($dominio.NetBIOSName)\$NomeGruppo)"
  Write-Host "  Get-NetFirewallRule -PolicyStore ActiveStore -DisplayName 'DA-IPAM*'   (le tre regole)"
  Write-Host 'Se su quei computer un altro strumento usa WinRM (RMM, Ansible), da ora risponde solo dagli IP indicati.'
  Write-Host "In DA-IPAM: credenziale WinRM $($dominio.NetBIOSName)\$AccountScansioni per le scansioni, $($dominio.NetBIOSName)\$AccountDc per Active Directory."
}
