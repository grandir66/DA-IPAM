# Prova di Configura-Dominio-DA-IPAM.ps1 senza Active Directory (Riccardo, 08/11/2026).
# Gira con pwsh anche su macOS o Linux: i comandi di AD e GPO sono finti, quelli che scrivono
# fanno fallire la prova. Controlla che -Prova arrivi in fondo senza scrivere e che le OU vietate
# (radice, Domain Controllers, OU con un DC, OU inesistente) vengano rifiutate.
#
#   pwsh -NoProfile -File scripts/prova-configura-dominio.ps1
#
# Esce con 1 se un caso non va come deve.
$ErrorActionPreference = 'Stop'
$sorgente = Join-Path $PSScriptRoot 'Configura-Dominio-DA-IPAM.ps1'
$copia = Join-Path ([IO.Path]::GetTempPath()) ("configura-dominio-" + [guid]::NewGuid() + ".ps1")
Get-Content $sorgente | Where-Object { $_ -notmatch '^#Requires' } | Set-Content $copia

function Import-Module {}
function Get-ADDomain { [pscustomobject]@{ DistinguishedName = 'DC=prova,DC=local'; DomainControllersContainer = 'OU=Domain Controllers,DC=prova,DC=local'; DNSRoot = 'prova.local'; UsersContainer = 'CN=Users,DC=prova,DC=local'; DomainSID = 'S-1-5-21-1'; NetBIOSName = 'PROVA'; PDCEmulator = 'dc01.prova.local' } }
# Come AD vero: restituisce il DN nella sua forma, anche se lo si e' scritto con gli spazi.
function Get-ADOrganizationalUnit { param($Identity, $Server) if ($Identity -like '*Manca*') { throw 'OU assente' }; [pscustomobject]@{ DistinguishedName = ($Identity -replace ',\s+', ',') } }
function Get-ADComputer {
  param($SearchBase, $Filter, $Server)
  if ($SearchBase -like '*Illeggibile*') { throw 'accesso negato' }
  if ($SearchBase -like '*ConDC*') { return @([pscustomobject]@{ Name = 'DC01' }) }
  if ($SearchBase -like '*ConRODC*' -and $Filter -like '*521*') { return @([pscustomobject]@{ Name = 'RODC01' }) }
  @()
}
function Get-ADRootDSE { [pscustomobject]@{ configurationNamingContext = 'CN=Configuration,DC=prova,DC=local' } }
function Get-ADObject { @() }
function Get-ADUser { param($Filter, $Identity, $Properties, $Server) if ($Filter -like '*svc-ipam-dc*') { [pscustomobject]@{ SamAccountName = 'svc-ipam-dc'; MemberOf = @('CN=Domain Admins,CN=Users,DC=prova,DC=local') } } }
function Get-ADGroup {
  param($Identity, $Filter, $Server)
  if ($Filter) { return $null }
  [pscustomobject]@{ Name = "G-$Identity"; DistinguishedName = $(if ("$Identity" -like '*-512') { 'CN=Domain Admins,CN=Users,DC=prova,DC=local' } else { "CN=$Identity" }) }
}
function Get-ADGroupMember { @() }
function Get-GPO { throw 'GPO assente' }
foreach ($f in 'New-ADUser', 'Add-ADGroupMember', 'New-ADGroup', 'New-GPO', 'New-GPLink', 'Set-GPLink', 'Set-GPRegistryValue', 'Remove-GPRegistryValue', 'Set-ADObject', 'New-Item', 'Get-GPInheritance', 'Read-Host') {
  Set-Item -Path "function:$f" -Value ([scriptblock]::Create("throw 'SCRITTURA DURANTE LA PROVA: $f'"))
}

$casi = @(
  @{ Nome = 'OU buona, -Prova'; OU = @('OU=Server,DC=prova,DC=local'); Atteso = $null },
  @{ Nome = 'radice del dominio'; OU = @('DC=prova,DC=local'); Atteso = 'radice del dominio' },
  @{ Nome = 'OU Domain Controllers'; OU = @('OU=Domain Controllers,DC=prova,DC=local'); Atteso = 'sui DC' },
  @{ Nome = 'OU Domain Controllers scritta con gli spazi'; OU = @('OU=Domain Controllers, DC=prova, DC=local'); Atteso = 'sui DC' },
  @{ Nome = 'OU con un DC dentro'; OU = @('OU=ConDC,DC=prova,DC=local'); Atteso = 'ci sono domain controller' },
  @{ Nome = 'OU con un RODC dentro'; OU = @('OU=ConRODC,DC=prova,DC=local'); Atteso = 'ci sono domain controller' },
  @{ Nome = 'OU che non si riesce a leggere (fallisce chiuso)'; OU = @('OU=Illeggibile,DC=prova,DC=local'); Atteso = 'non collego niente' },
  @{ Nome = 'OU inesistente'; OU = @('OU=Manca,DC=prova,DC=local'); Atteso = 'OU non trovata' }
)
$falliti = 0
try {
  foreach ($c in $casi) {
    $errore = $null
    try { & $copia -OU $c.OU -IpDaIpam 10.0.0.5 -Prova *> $null } catch { $errore = $_.Exception.Message }
    $ok = if ($c.Atteso) { $errore -and $errore -like "*$($c.Atteso)*" } else { -not $errore }
    if ($ok) { Write-Host "ok   $($c.Nome)" } else { Write-Host "NO   $($c.Nome): $errore"; $falliti++ }
  }
} finally { Remove-Item $copia -ErrorAction SilentlyContinue }
exit [int]($falliti -gt 0)
