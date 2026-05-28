# Manuale di integrazione Active Directory per DA-IPAM

> Versione: v0.2.657 · target: integratori e admin di dominio cliente
>
> Questo manuale copre la configurazione lato **Domain Controller** necessaria per consentire a DA-IPAM di estrarre informazioni da Active Directory (utenti, computer, gruppi, organizational unit) e dal server DHCP eventualmente co-installato sul DC.
>
> **Incident reali coperti**: DC DTS.local con LDAPS signing forzato (richiesto fix lato DC); DC 2R con DHCP installato dove il sync DA-IPAM non riusciva a leggere i lease.

---

## Indice

1. [Cosa fa DA-IPAM con AD](#1-cosa-fa-da-ipam-con-ad)
2. [Prerequisiti sul Domain Controller](#2-prerequisiti-sul-domain-controller)
3. [Configurazione LDAPS (porta 636)](#3-configurazione-ldaps-porta-636)
4. [Configurazione WinRM per DHCP sync](#4-configurazione-winrm-per-dhcp-sync)
5. [Account di servizio (`svc-ipam`)](#5-account-di-servizio-svc-ipam)
6. [Setup integrazione lato DA-IPAM](#6-setup-integrazione-lato-da-ipam)
7. [Troubleshooting](#7-troubleshooting)
8. [Hardening e sicurezza](#8-hardening-e-sicurezza)
9. [Appendice: comandi rapidi](#9-appendice-comandi-rapidi)

---

## 1. Cosa fa DA-IPAM con AD

| Funzione | Protocollo | Porta | Cmdlet/Filter usato |
|---|---|---|---|
| Sync computer object | LDAP/LDAPS | 389/636 | `(objectCategory=computer)` |
| Sync utenti | LDAP/LDAPS | 389/636 | `(objectCategory=person)(objectClass=user)` |
| Sync gruppi | LDAP/LDAPS | 389/636 | `(objectClass=group)` |
| Sync lease DHCP | WinRM (5985/5986) | 5985 | `Get-DhcpServerv4Scope`, `Get-DhcpServerv4Lease` |
| Test integrazione | LDAP/LDAPS | 389/636 | bind anonimo o autenticato |

**Importante**: LDAP e WinRM sono **due canali separati**. DA-IPAM richiede entrambi configurati se vuoi sia il sync AD sia il sync DHCP (caso comune: DC con ruolo DHCP installato).

---

## 2. Prerequisiti sul Domain Controller

### 2.1 Servizi base

```powershell
# Verifica che i servizi siano running
Get-Service NTDS, ADWS, WinRM, DHCPServer | Format-Table Name, Status, StartType
```

Devi vedere `Status = Running` per:
- **NTDS** — Active Directory Domain Services (sempre attivo su DC)
- **ADWS** — Active Directory Web Services (porta 9389, usato da PowerShell AD module)
- **WinRM** — Windows Remote Management (porta 5985 — necessario per DHCP sync)
- **DHCPServer** — solo se il DC ha anche ruolo DHCP

### 2.2 Porte aperte verso il DA-IPAM appliance

| Porta | Protocollo | Scopo |
|---|---|---|
| **389** | TCP | LDAP plaintext (sconsigliato, vedi §3) |
| **636** | TCP | LDAPS (LDAP over TLS) — **richiesto** in setup tipici |
| **3268** | TCP | Global Catalog plaintext (multi-domain forest) |
| **3269** | TCP | Global Catalog over TLS |
| **5985** | TCP | WinRM HTTP (per DHCP sync) |
| **9389** | TCP | ADWS (Active Directory Web Services) |

Verifica con `Test-NetConnection -ComputerName <ip-DA-IPAM> -Port <porta>` da uno script eseguito sul DC.

### 2.3 RSAT DHCP Server module (se DC ha ruolo DHCP)

Il sync DHCP usa il cmdlet `Get-DhcpServerv4Lease`, parte del modulo PowerShell `DhcpServer`. Su DC con ruolo DHCP installato il modulo è già disponibile, ma verificalo:

```powershell
Get-Module -ListAvailable DhcpServer
# Deve elencare il modulo. Se manca:
Install-WindowsFeature RSAT-DHCP
```

Se manca anche su un DC dove il servizio DHCP è effettivamente in esecuzione, è un'anomalia: `Install-WindowsFeature RSAT-DHCP` lo aggiunge (può richiedere riavvio).

**Test rapido sul DC** (PowerShell elevato):
```powershell
Get-DhcpServerv4Scope | Select ScopeId, Name, State
```
Se ti restituisce i scope DHCP, il modulo è OK. Se errore, fix con Install-WindowsFeature.

---

## 3. Configurazione LDAPS (porta 636)

### 3.1 Perché LDAPS è quasi sempre necessario

Da Windows Server 2019/2022, AD ha policy di default più aggressive su **LDAP signing** e **LDAP channel binding**. Anche se la versione del DC è 2016 o 2012R2, l'admin di solito ha già applicato hardening (security baseline Microsoft) che richiedono LDAP signed.

DA-IPAM tenta sempre prima LDAPS (porta 636); se il DC ha LDAP signing forzato e non ha un cert TLS valido, il bind fallisce.

### 3.2 Verifica stato corrente

Sul DC, PowerShell elevato:

```powershell
# Channel binding policy (0=disabled, 1=enabled when supported, 2=always required)
Get-ItemProperty HKLM:\SYSTEM\CurrentControlSet\Services\NTDS\Parameters |
  Select-Object LdapEnforceChannelBinding, LDAPServerIntegrity
```

| `LDAPServerIntegrity` | Significato | DA-IPAM funziona? |
|---|---|---|
| `1` (None) | LDAP plaintext OK | Sì, plaintext o LDAPS |
| `2` (Require signing) | Solo LDAP signed | Solo LDAPS o LDAP signed (DA-IPAM usa LDAPS) |

| `LdapEnforceChannelBinding` | Significato | DA-IPAM funziona? |
|---|---|---|
| `0` (Never) | Nessun binding | Sì |
| `1` (When supported) | Se cert valido | Sì se cert pubblicamente trusted |
| `2` (Always) | Cert valido obbligatorio | Solo se DA-IPAM gira con cert custom in TLS store |

### 3.3 Setup certificato LDAPS sul DC

**Caso A: DC con CA Enterprise** (situazione enterprise tipica): la CA emette automaticamente cert "Domain Controller" valido per LDAPS. Verifica:

```powershell
# Lista cert macchina nel personal store
Get-ChildItem Cert:\LocalMachine\My | Select-Object Subject, NotAfter, EnhancedKeyUsageList |
  Where-Object { $_.EnhancedKeyUsageList.FriendlyName -like "*Server Authentication*" }
```

Se trovi un cert con `Subject = CN=<NomeDC>.<dominio.fqdn>` e EKU "Server Authentication" → LDAPS è già attivo.

**Caso B: nessuna CA, cert self-signed**: emetti un cert manualmente:

```powershell
# Genera self-signed cert valido per LDAPS
$cert = New-SelfSignedCertificate `
  -DnsName "$($env:COMPUTERNAME).$env:USERDNSDOMAIN", $env:COMPUTERNAME `
  -CertStoreLocation "Cert:\LocalMachine\My" `
  -KeyUsage DigitalSignature, KeyEncipherment `
  -TextExtension @("2.5.29.37={text}1.3.6.1.5.5.7.3.1") `
  -NotAfter (Get-Date).AddYears(5)

Write-Host "Cert thumbprint: $($cert.Thumbprint)"

# Copia il cert anche nel Trusted Root del DC stesso (NTDS richiede questo)
$srcCert = Get-Item "Cert:\LocalMachine\My\$($cert.Thumbprint)"
$rootStore = New-Object System.Security.Cryptography.X509Certificates.X509Store("Root","LocalMachine")
$rootStore.Open("ReadWrite")
$rootStore.Add($srcCert)
$rootStore.Close()

# Riavvio NTDS per caricare il nuovo cert (LDAPS lo trova al startup)
Restart-Service NTDS -Force
```

> ⚠ **Caveat noto** (incident DTS.local): il cert deve essere SIA in `My` (Personal\Computer) SIA in `Root` (Trusted Root) del DC stesso, altrimenti NTDS lo carica ma il bind LDAPS lo rifiuta come untrusted. Vedi memoria `reference_da_ipam_ldaps_client_dc`.

### 3.4 Distribuzione del cert al DA-IPAM appliance

Se il cert è self-signed, DA-IPAM lo accetta perché lato bridge LDAP non valida la catena di fiducia (`tlsOptions: rejectUnauthorized: false`). Se vuoi rendere il binding sicuro, vedi §8.

### 3.5 Test LDAPS dal DA-IPAM

Dal lato DA-IPAM appliance (linux):
```bash
echo | openssl s_client -connect <ip-DC>:636 -showcerts 2>&1 | grep -E "subject|issuer|verify"
```
Deve restituire il cert del DC e `Verify return code` (0 se trusted, >0 se untrusted ma comunque visibile).

---

## 4. Configurazione WinRM per DHCP sync

Il DC con ruolo DHCP richiede WinRM attivo per consentire a DA-IPAM di leggere i lease via `Get-DhcpServerv4Lease`.

### 4.1 Abilita WinRM sul DC

Il DC è quasi sempre in dominio, quindi:

```powershell
Enable-PSRemoting -Force
```

`-SkipNetworkProfileCheck` non serve perché in dominio la NIC è `DomainAuthenticated`. Se per qualche motivo il DC ha NIC Public (raro), aggiungi il flag.

### 4.2 Permessi sull'utente per leggere DHCP

L'utente WinRM (vedi §5) deve essere membro di **uno** dei seguenti gruppi sul DC:
- **DHCP Administrators** (preferito — scope minimo necessario)
- **Domain Admins**
- **Enterprise Admins**

Aggiungere a DHCP Administrators:
```powershell
Add-DhcpServerSecurityGroup
# Crea il gruppo "DHCP Administrators" e "DHCP Users" se non esistono.
Restart-Service DHCPServer
Add-ADGroupMember -Identity "DHCP Administrators" -Members "svc-ipam"
```

### 4.3 Verifica cmdlet DHCP

```powershell
# Lo stesso comando che DA-IPAM esegue:
Get-DhcpServerv4Scope | ConvertTo-Json -Depth 2 -Compress
```

Se ti restituisce un array JSON con i scope, il sync funzionerà. Errori comuni:
- `The term 'Get-DhcpServerv4Scope' is not recognized` → manca modulo DhcpServer (vedi §2.3)
- `Failed to get version of the DHCP server` → servizio DHCP non in esecuzione (`Start-Service DHCPServer`)
- `Access is denied` → permessi (vedi §4.2)
- `No element found in collection` con `ConvertTo-Json` su zero scope → comportamento normale, DA-IPAM gestisce array vuoto

### 4.4 Caso 2R: DHCP installato ma sync non legge nulla

**Sintomi tipici**: `Get-DhcpServerv4Scope` da DA-IPAM ritorna 0 scope, ma la console DHCP del DC mostra scope attivi con lease.

**Checklist diagnostica** (sul DC, PowerShell elevato con stesso utente WinRM):

```powershell
# 1. Verifica cmdlet disponibile
Get-Command Get-DhcpServerv4Scope
# Se errore: Install-WindowsFeature RSAT-DHCP

# 2. Verifica servizio DHCP
Get-Service DHCPServer | Select Status, StartType
# Deve essere Running. Se Stopped: Start-Service DHCPServer

# 3. Verifica se DC è "authorized" come DHCP server in AD
Get-DhcpServerInDC
# Deve elencarne almeno uno. Se vuoto → DC non autorizzato a fare DHCP:
# Add-DhcpServerInDC

# 4. Verifica i scope diretto sul DC
Get-DhcpServerv4Scope
# Se restituisce i scope qui ma non da DA-IPAM → problema permessi WinRM

# 5. Verifica permessi utente WinRM su DHCP
Get-DhcpServerSetting | Select IsAuthorized, IsDomainJoined
net localgroup "DHCP Administrators"  # cerca svc-ipam
```

**Bug noto in DA-IPAM v0.2.656**: il parser `JSON.parse` su `Get-DhcpServerv4Scope` può fallire silenziosamente se l'output PowerShell è racchiuso in `__type` (oggetto Pwsh single non array). Fix in v0.2.657: tolleranza array/single, log diagnostico esplicito quando 0 scope ricevuti.

---

## 5. Account di servizio (`svc-ipam`)

### 5.1 Perché un account dedicato

Per **audit, isolation, principio del minimo privilegio**: invece di usare `Administrator` o un domain admin, crei un account `svc-ipam` con permessi limitati allo scope di lavoro DA-IPAM.

### 5.2 Setup account in AD (Domain User normale)

```powershell
# Importa il modulo AD
Import-Module ActiveDirectory

# Crea l'account (password lunga, non scade, account abilitato)
$pwd = ConvertTo-SecureString "PasswordLungaSicura!2026" -AsPlainText -Force
New-ADUser `
  -Name "svc-ipam" `
  -SamAccountName "svc-ipam" `
  -UserPrincipalName "svc-ipam@dominio.fqdn" `
  -AccountPassword $pwd `
  -PasswordNeverExpires $true `
  -Enabled $true `
  -Description "Service account per DA-IPAM (sync AD + DHCP)"
```

### 5.3 Permessi minimi necessari

| Funzione DA-IPAM | Permesso richiesto |
|---|---|
| Sync computer/users/groups via LDAP | Lettura su tutto il dominio (Authenticated Users di default ce l'hanno) |
| Sync DHCP | Membership in `DHCP Administrators` o `Domain Admins` |
| WinRM connect al DC | Membership in `Remote Management Users` o `Administrators` sul DC |

```powershell
# DHCP read
Add-ADGroupMember -Identity "DHCP Administrators" -Members "svc-ipam"

# WinRM sul DC (necessario per Get-DhcpServerv4Scope)
# Opzione 1: Remote Management Users (scope minore — solo read)
Add-LocalGroupMember -Group "Remote Management Users" -Member "DOMINIO\svc-ipam"

# Opzione 2: Administrators (più semplice, scope ampio)
Add-LocalGroupMember -Group "Administrators" -Member "DOMINIO\svc-ipam"
```

> ⚠ **Nota**: per inventario software completo via WMI (caso patch management Chocolatey), serve `Administrators`. Solo Remote Management Users non basta.

### 5.4 Test connessione con svc-ipam

Da una macchina Windows in dominio (anche client), prova:
```powershell
$cred = Get-Credential
# Username: DOMINIO\svc-ipam (o svc-ipam@dominio.fqdn)
# Password: la password assegnata

Invoke-Command -ComputerName dc01.dominio.fqdn -Credential $cred -ScriptBlock {
  Get-DhcpServerv4Scope | Select ScopeId, Name
}
```

Se restituisce i scope → DA-IPAM funzionerà con la stessa credenziale.

---

## 6. Setup integrazione lato DA-IPAM

In DA-IPAM `/active-directory` → **Nuova integrazione**:

| Campo | Valore | Note |
|---|---|---|
| Nome | "AD Cliente XYZ" | Label libero |
| DC host | `dc01.cliente.local` o IP | FQDN preferito (necessario per Kerberos) |
| Domain | `cliente.local` | Dominio FQDN |
| Base DN | `DC=cliente,DC=local` | Distinguished Name root |
| Use SSL | ✓ (consigliato) | LDAPS porta 636 |
| Port | 636 (LDAPS) o 389 (LDAP) | |
| WinRM credential | crea credenziale Windows con `svc-ipam@cliente.local` | per DHCP sync |
| Enabled | ✓ | |

**Importante**: la credenziale WinRM associata all'integrazione deve avere format username `svc-ipam@cliente.local` (UPN) o `CLIENTE\svc-ipam` (NetBIOS). Vedi MANUALE-WINRM.md per dettagli.

### 6.1 Test integrazione

Dalla riga della integrazione AD, bottone **"Test"**:
- LDAP bind OK → integrazione funzionante
- DHCP sync funzionante → conteggio scope > 0 (se DC ha DHCP)

### 6.2 Sync manuale

Bottone **"Sync"** sulla riga → DA-IPAM fa fetch di tutti gli oggetti AD. Tempi tipici:
- 100 utenti / 50 computer → 5-10s
- 1000+ utenti, 500+ computer → 30-60s

### 6.3 Sync schedulato

DA-IPAM ha un cron `ad_sync` (job_type=`ad_sync`) configurabile in `/settings` → Job schedulati. Default `interval_minutes=60`. Per ambienti dove l'AD cambia spesso (provisioning frequente) ridurlo a 15-30 min.

---

## 7. Troubleshooting

### LDAP bind fallisce con "Inappropriate Authentication"

Il DC richiede LDAP signing. Soluzioni:
- Usare LDAPS (porta 636) — DA-IPAM lo fa di default se "Use SSL" è ✓
- Fix lato DC come §3.3

### LDAPS fallisce con "Certificate verification failed"

Il cert sul DC non è in `Trusted Root` del DC stesso. Fix §3.3 (cert in My + Root + restart NTDS).

### LDAPS fallisce con "Connection refused"

Servizio NTDS non sta servendo LDAPS. Verifica:
```powershell
netstat -ano | findstr ":636"
# Deve mostrare 0.0.0.0:636 LISTENING
```
Se non c'è, riavvia NTDS dopo aver installato un cert valido.

### DHCP sync ritorna 0 scope ma DC ha DHCP attivo

Vedi §4.4 — checklist diagnostica completa.

### Sync AD timeout

Possibili cause:
- DC raggiungibile su 636 ma risposta lenta (filtri LDAP non indicizzati). Verifica indici AD: `dsdbutil "activate instance ntds" "files" "info"`
- DA-IPAM appliance ha ENV `DA_INVENT_LDAP_TIMEOUT_MS` troppo basso. Default 30000ms.

### WinRM connect al DC fallisce con 401

Identica situazione del MANUALE-WINRM.md §3.3 — credenziale UPN, account in Administrators del DC.

### "DHCP Administrators" non esiste sul DC

Server con DHCP role appena installato. Esegui sul DC:
```powershell
Add-DhcpServerSecurityGroup
Restart-Service DHCPServer
```

---

## 8. Hardening e sicurezza

### 8.1 LDAPS con cert pubblicamente trusted

Se il DC è gestito con una CA Enterprise interna, emetti un cert con quel template `Domain Controller`. Vantaggio: tutti i client AD-joined ricevono automaticamente la catena di fiducia via GPO.

### 8.2 Restrizione IP su WinRM del DC

```powershell
# Solo DA-IPAM appliance può connettersi via WinRM al DC
Set-Item WSMan:\localhost\Service\IPv4Filter -Value "192.168.4.8"
Restart-Service winrm
```

### 8.3 Account svc-ipam non interattivo

```powershell
# Vieta logon interattivo al svc-ipam (login console o RDP)
# Set-ADUser con UserAccountControl bitmask, oppure via GPO User Rights:
# "Deny log on locally" e "Deny log on through Remote Desktop Services"
```

### 8.4 Audit access

Eventi LDAP bind sono in `Security` log del DC (event ID 4624 logon type 3). Filtra per `TargetUserName = svc-ipam` per audit dell'accesso DA-IPAM.

---

## 9. Appendice: comandi rapidi

```powershell
# === STATO ===
Get-Service NTDS, ADWS, WinRM, DHCPServer | Format-Table Name, Status
Get-Module -ListAvailable DhcpServer
Get-NetTCPConnection -LocalPort 389,636,5985,9389 | Select LocalAddress, LocalPort, State

# === LDAPS ===
Get-ItemProperty HKLM:\SYSTEM\CurrentControlSet\Services\NTDS\Parameters |
  Select LdapEnforceChannelBinding, LDAPServerIntegrity
Get-ChildItem Cert:\LocalMachine\My |
  Where-Object { $_.EnhancedKeyUsageList.FriendlyName -like "*Server Authentication*" }

# === DHCP ===
Get-DhcpServerInDC
Get-DhcpServerv4Scope
Get-DhcpServerv4Lease -ScopeId <scope> | Select IPAddress, HostName, ClientId, LeaseExpiryTime
net localgroup "DHCP Administrators"

# === ACCOUNT svc-ipam ===
Get-ADUser svc-ipam -Properties MemberOf, PasswordLastSet, LockedOut
Get-ADPrincipalGroupMembership svc-ipam | Select Name

# === FIX RAPIDI ===
# LDAPS con self-signed
$cert = New-SelfSignedCertificate -DnsName "$($env:COMPUTERNAME).$env:USERDNSDOMAIN" `
  -CertStoreLocation Cert:\LocalMachine\My -NotAfter (Get-Date).AddYears(5)
$rs = New-Object System.Security.Cryptography.X509Certificates.X509Store("Root","LocalMachine")
$rs.Open("ReadWrite"); $rs.Add($cert); $rs.Close()
Restart-Service NTDS -Force

# DHCP RSAT install
Install-WindowsFeature RSAT-DHCP

# Add svc-ipam ai gruppi necessari
Add-ADGroupMember "DHCP Administrators" -Members svc-ipam
Add-LocalGroupMember -Group "Administrators" -Member "DOMINIO\svc-ipam"
```

---

## Appendice B: incident reali documentati

- **DTS.local DC** — LDAPS rifiutato da DA-IPAM con "channel binding". Causa: cert non in `Trusted Root` del DC. Fix: §3.3 (My + Root + restart NTDS). Vedi memoria `reference_da_ipam_ldaps_client_dc`.
- **2R DC con DHCP co-installato** — Sync DHCP ritornava 0 scope. Da diagnosticare con checklist §4.4.

**Manutenzione**: ogni nuovo incident sul campo va documentato qui + salvato in memoria persistente del progetto.
