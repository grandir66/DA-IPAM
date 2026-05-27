# Manuale di configurazione WinRM per DA-IPAM

> Versione: v0.2.656 · target: integratori e amministratori cliente
>
> Questo manuale copre **tutti** gli scenari di configurazione WinRM necessari per consentire a DA-IPAM di accedere a host Windows (workstation, server, controller di dominio) per inventario software, fingerprint OS, esecuzione patch via Chocolatey, sincronizzazione Wazuh.
>
> **Casi d'uso reali coperti** (incident documentati): server workgroup DOMARC (Veeam), VM domain-joined DTS, controller di dominio cliente con LDAPS hardenizzato, postazioni Windows 11 con NTLM disabilitato di default.

---

## Indice

1. [Cos'è WinRM e come lo usa DA-IPAM](#1-cosè-winrm-e-come-lo-usa-da-ipam)
2. [Decisione architetturale: HTTP vs HTTPS](#2-decisione-architetturale-http-vs-https)
3. [Scenari di configurazione](#3-scenari-di-configurazione)
   - 3.1 [Server workgroup + Administrator builtin](#31-server-workgroup--administrator-builtin)
   - 3.2 [Server workgroup + admin locale custom (caso Veeam/DA)](#32-server-workgroup--admin-locale-custom-caso-veeamda)
   - 3.3 [Server in dominio + utenza AD](#33-server-in-dominio--utenza-ad)
   - 3.4 [Server in dominio + admin locale del server](#34-server-in-dominio--admin-locale-del-server)
   - 3.5 [Postazioni Windows in dominio (mass deployment via GPO)](#35-postazioni-windows-in-dominio-mass-deployment-via-gpo)
   - 3.6 [Domain Controller (accesso LDAP/LDAPS + WinRM)](#36-domain-controller-accesso-ldapldaps--winrm)
4. [Script PowerShell unificato](#4-script-powershell-unificato)
5. [Configurazione via Group Policy (enterprise)](#5-configurazione-via-group-policy-enterprise)
6. [Credenziale in DA-IPAM: format username](#6-credenziale-in-da-ipam-format-username)
7. [Troubleshooting per errore](#7-troubleshooting-per-errore)
8. [Verifiche post-installazione](#8-verifiche-post-installazione)
9. [Sicurezza e hardening](#9-sicurezza-e-hardening)
10. [Quick reference comandi](#10-quick-reference-comandi)

---

## 1. Cos'è WinRM e come lo usa DA-IPAM

**WinRM** (Windows Remote Management) è l'implementazione Microsoft di **WS-Management**, un protocollo SOAP su HTTP/HTTPS per amministrazione remota. È il canale standard moderno per:
- Eseguire comandi PowerShell remoti (`Invoke-Command`, `Enter-PSSession`)
- Interrogare WMI/CIM via protocollo standardizzato
- Trasferire file via WSMan

**Porte standard**:
- **5985** — WinRM HTTP (autenticazione cifrata da NTLM/Kerberos via SPNEGO, ma payload in chiaro per Basic)
- **5986** — WinRM HTTPS (canale TLS, richiede certificato server)

**DA-IPAM usa WinRM per**:
- **Fingerprint OS** — `wmic os get ...` per identificare versione Windows
- **Inventory software** — enumerare programmi installati (registry + `Get-Package`)
- **Patch Management Chocolatey** — eseguire `choco upgrade <pkg>` via PSRemote
- **Test credenziali** dalla pagina `/credentials`
- **Scan periodico Wazuh-correlato** — incrociare i dati DA-IPAM con quelli Wazuh

Il bridge Python `winrm-bridge.py` (lato DA-IPAM appliance) tenta una catena di autenticazione automatica: **Kerberos → NTLM → CredSSP → Basic**.

---

## 2. Decisione architetturale: HTTP vs HTTPS

**Per DA-IPAM la scelta consigliata è HTTP (5985)** per i seguenti motivi:
- L'autenticazione NTLM/Kerberos cifra il payload via SPNEGO (anche su HTTP)
- Non richiede emissione e distribuzione di certificati TLS
- Setup più rapido (specialmente in workgroup)
- DA-IPAM appliance e host target sono tipicamente sulla stessa LAN aziendale trusted

**HTTPS (5986) è giustificato quando**:
- WinRM passa attraverso link untrusted (es. WAN inter-sede)
- Compliance esplicita richiede TLS end-to-end
- Usato Basic auth (mai consigliato, ma in casi legacy serve TLS)

In questo manuale **tutti gli script usano HTTP 5985** per semplicità. Per HTTPS vedere [§9 Sicurezza](#9-sicurezza-e-hardening).

---

## 3. Scenari di configurazione

### 3.1 Server workgroup + Administrator builtin

**Profilo**: server standalone non joinato ad AD, autenticazione con l'account `Administrator` predefinito (SID `S-1-5-21-...-500`).

**Esempio**: macchina di test, lab interno, server di backup standalone.

**Cose da fare sul server target (PowerShell elevato)**:

```powershell
Enable-PSRemoting -Force -SkipNetworkProfileCheck
```

**Cosa fa questo singolo comando**:
- Avvia il servizio WinRM in auto-start
- Crea il listener HTTP su tutte le interfacce (`Address=*+Transport=HTTP`)
- Abilita la regola firewall `WINRM-HTTP-In-TCP-PUBLIC` (essenziale perché in workgroup la NIC è Public)
- Configura PSRemoting per `Microsoft.PowerShell` session config

**Credenziale in DA-IPAM**:
- Tipo: **Windows (host)**
- Username: **`.\Administrator`** (con il prefisso `.\`)
- Password: la password locale di Administrator

**Verifica sul server**:
```powershell
Test-NetConnection -ComputerName localhost -Port 5985  # TcpTestSucceeded : True
netstat -ano | findstr ":5985"                         # 0.0.0.0:5985 LISTENING
```

> ✅ **Caso più semplice**. `Administrator` builtin è esente dal token filtering remoto.

---

### 3.2 Server workgroup + admin locale custom (caso Veeam/DA)

**Profilo**: server standalone, autenticazione con admin locale **non-builtin** (es. `da`, `manutenzione`, `svc-monitor`).

**Esempio reale**: server Veeam DOMARC con account locale `da` in gruppo Administrators. Server DA-VEEAM cliente DTS.

**Tre ostacoli sovrapposti** da risolvere:

1. **`LocalAccountTokenFilterPolicy`** — Windows applica filtro UAC remoto agli admin custom (non `Administrator` builtin). Senza il fix, NTLM autentica ma WinRM rifiuta i privilegi → 401.
2. **NIC Public** — workgroup ha NIC classificate Public; `winrm quickconfig` rifiuta senza `-SkipNetworkProfileCheck`.
3. **Format username** — `da` da solo viene mandato con domain vuoto → NTLM cerca AD fantasma → 401.

**Cose da fare sul server target (PowerShell elevato)**:

```powershell
# 1. Disabilita filtro UAC remoto per admin custom locale
reg add HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System `
  /v LocalAccountTokenFilterPolicy /t REG_DWORD /d 1 /f

# 2. Abilita WinRM su NIC Public (workgroup default)
Enable-PSRemoting -Force -SkipNetworkProfileCheck

# 3. (Opzionale) Verifica che l'utente è in Administrators
net localgroup Administrators
```

**Credenziale in DA-IPAM**:
- Tipo: **Windows (host)**
- Username: **`.\da`** (con prefisso `.\` che significa "questa macchina")
- Password: password locale dell'utente

**Verifica completa**:
```powershell
Test-NetConnection -ComputerName localhost -Port 5985
net user da   # cerca "Account active=Yes" e "Locked=No"
```

> ⚠ **Caso più frequente di errore 401** in setup cliente. Tre fix necessari, non basta solo uno.

---

### 3.3 Server in dominio + utenza AD

**Profilo**: server joinato ad Active Directory, autenticazione con utenza di dominio (membro di `Domain Admins` o `Administrators` locale via gruppo AD).

**Esempio**: file server, database server, hypervisor in dominio aziendale.

**Cose da fare sul server target (PowerShell elevato)**:

```powershell
Enable-PSRemoting -Force
```

Niente `-SkipNetworkProfileCheck` necessario: in dominio la NIC è già `DomainAuthenticated` (private equivalent).

**Credenziale in DA-IPAM** — due format accettati:
- **UPN**: `nomeutente@dominio.fqdn` (es. `admin@corp.acme.local`) — preferito per Kerberos
- **NetBIOS**: `DOMINIO\nomeutente` (es. `CORP\admin`) — funziona via NTLM

Il bridge DA-IPAM prova Kerberos prima (più sicuro), poi NTLM come fallback. Entrambi i formati sono accettati e DA-IPAM sceglie automaticamente.

**Non serve** `LocalAccountTokenFilterPolicy` per account AD — il filtro UAC remoto non si applica.

> ✅ **Caso più semplice in ambiente enterprise**.

---

### 3.4 Server in dominio + admin locale del server

**Profilo**: server joinato ad AD, ma l'amministratore preferisce usare un account **locale** del server (per isolation, audit cleaner, o policy interna).

**Esempio**: server applicativo dove si vuole evitare l'esposizione di credenziali AD ai tool di monitoring.

**Cose da fare sul server target (PowerShell elevato)**:

```powershell
# Solo se l'account NON è "Administrator" builtin:
reg add HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System `
  /v LocalAccountTokenFilterPolicy /t REG_DWORD /d 1 /f

Enable-PSRemoting -Force
```

**Credenziale in DA-IPAM**:
- Username: **`.\nomeutente`** o **`NOMESERVER\nomeutente`** (NetBIOS)
- Il prefisso forza l'auth contro l'account locale del server, evitando il DC.

> ⚠ Senza il prefisso, il server interroga il DC del dominio per un account che non esiste → 401.

---

### 3.5 Postazioni Windows in dominio (mass deployment via GPO)

**Profilo**: parco macchine di centinaia o migliaia di postazioni Windows 10/11 in dominio AD. Necessario configurare WinRM su tutte per inventario software.

**Approccio consigliato**: **Group Policy** centralizzata. Vedere [§5 Configurazione via Group Policy](#5-configurazione-via-group-policy-enterprise).

**Alternativa per parchi piccoli (<50 postazioni)**: script PowerShell deployato via SCCM/Intune/GPO startup script.

**Importante**: per le **postazioni** (non server), considerare:
- L'utente loggato spesso è un domain user senza privilegi admin → DA-IPAM deve usare credenziale AD admin **separata** (es. un service account `svc-ipam`)
- L'account `svc-ipam` deve essere in `Domain Admins` **oppure** in `Administrators` locale di ogni macchina (deployato via GPO Restricted Groups)
- Per inventario software completo (Win32_Product, registry HKLM\Software\Microsoft\Windows\CurrentVersion\Uninstall) serve admin: un utente normale vede solo i propri programmi

> ⚠ **Sicurezza**: meglio creare un service account dedicato `svc-ipam` con scope limitato anziché usare un domain admin generico. Vedi `[reference-da-ipam-ldaps-client-dc]` per pattern di delegazione.

---

### 3.6 Domain Controller (accesso LDAP/LDAPS + WinRM)

**Profilo**: DA-IPAM deve interrogare AD via LDAP/LDAPS per popolare la tabella `ad_computers` (sync periodico utenti, computer, gruppi). Inoltre può servire WinRM sul DC stesso per inventario software del DC.

**Due integrazioni separate**:

#### A) LDAP/LDAPS per sync AD (no WinRM)

Non serve WinRM. DA-IPAM si collega direttamente alla porta:
- **389** — LDAP plaintext (sconsigliato, deprecato)
- **636** — LDAPS (LDAP over TLS) — **richiesto**
- **3268** — Global Catalog plaintext
- **3269** — Global Catalog over TLS

**Requisiti sul DC**:
- Certificato server LDAPS installato in `Personal\Computer` (LocalMachine\My)
- Restart del servizio NTDS dopo install del cert
- Porta 636 accessibile dal DA-IPAM appliance

**Footgun noto** (memoria `reference_da_ipam_ldaps_client_dc`): se il DC impone LDAP signing (`LdapEnforceChannelBinding=1`) senza un certificato pubblicamente trusted, LDAPS fallisce. Fix: certificato self-signed nel store `Personal` + `Trusted Root` del DC, restart NTDS.

#### B) WinRM sul DC (opzionale, per inventario DC)

```powershell
Enable-PSRemoting -Force
```

**Credenziale**:
- Utenza in gruppo `Domain Admins` (necessario per query AD privilegiate via WMI)
- Format: `admin@dominio.fqdn`

> ⚠ Limitare WinRM sul DC alle sole IP del DA-IPAM appliance via firewall rule:
> ```powershell
> Set-NetFirewallRule -Name "WINRM-HTTP-In-TCP" -RemoteAddress 192.168.4.8
> ```

---

## 4. Script PowerShell unificato

DA-IPAM include uno script PowerShell che automatizza tutti gli scenari sopra:

**Posizione**: [scripts/Configure-WinRM-DA-IPAM.ps1](../scripts/Configure-WinRM-DA-IPAM.ps1)

**Esempio di utilizzo**:

```powershell
# Server workgroup con admin custom (Veeam/DA)
.\Configure-WinRM-DA-IPAM.ps1 -Mode WorkgroupCustomAdmin

# Server in dominio (più semplice)
.\Configure-WinRM-DA-IPAM.ps1 -Mode Domain

# Restringere accesso solo al DA-IPAM appliance
.\Configure-WinRM-DA-IPAM.ps1 -Mode WorkgroupCustomAdmin -AllowFromIP 192.168.4.8

# Solo test (no modifiche)
.\Configure-WinRM-DA-IPAM.ps1 -Mode Domain -WhatIf
```

Lo script esegue tutti i controlli e applica solo le modifiche necessarie (idempotente).

---

## 5. Configurazione via Group Policy (enterprise)

Per parchi >50 postazioni in dominio, GPO è l'approccio scalabile. Crea una GPO `WinRM-DA-IPAM` linkata all'OU dei computer da monitorare.

### Settings GPO necessari

#### Allow Remote Server Management through WinRM
**Computer Configuration → Policies → Administrative Templates → Windows Components → Windows Remote Management (WinRM) → WinRM Service → Allow remote server management through WinRM**

- Stato: **Enabled**
- IPv4 filter: `192.168.4.8` (IP del DA-IPAM appliance) o `*` per tutti
- IPv6 filter: `*` o vuoto

#### Windows Firewall: allow inbound WinRM
**Computer Configuration → Policies → Windows Settings → Security Settings → Windows Defender Firewall with Advanced Security → Inbound Rules**

Nuova regola:
- Predefined: **Windows Remote Management**
- Profiles: **Domain, Private** (Public solo se necessario per workgroup)

#### Service WinRM auto-start
**Computer Configuration → Policies → Windows Settings → Security Settings → System Services → Windows Remote Management (WS-Management)**

- Startup Mode: **Automatic**

#### (Opzionale) Listener via Allow Basic Authentication
Se necessario fallback Basic auth (sconsigliato, solo legacy):
- WinRM Client: **Disable Basic Authentication = Disabled**
- WinRM Service: **Allow Basic Authentication = Disabled** (default)

#### Restricted Groups per service account
**Computer Configuration → Preferences → Control Panel Settings → Local Users and Groups**

Aggiungi `svc-ipam` al gruppo `Administrators` di tutte le macchine target.

#### Force gpupdate sui client
Dopo aver creato la GPO:
```cmd
gpupdate /force
```
Le macchine applicheranno la policy entro il prossimo refresh ciclico (max 90 min) o al riavvio.

### Verifica deploy GPO

Da una macchina target:
```cmd
gpresult /R | findstr "WinRM-DA-IPAM"
winrm get winrm/config/service
```

---

## 6. Credenziale in DA-IPAM: format username

| Scenario | Format username |
|---|---|
| Account locale di workgroup machine | `.\nomeutente` |
| Account locale di server in dominio | `.\nomeutente` o `NOMESERVER\nomeutente` |
| Domain user (AD) | `nomeutente@dominio.fqdn` (UPN, preferito) |
| Domain user (NetBIOS) | `DOMINIO\nomeutente` |
| Administrator builtin (qualsiasi server) | `.\Administrator` o `Administrator` (raro funzioni senza prefisso) |

> 🛑 **Errori più comuni**:
> - `administrator` senza `.\` → 401 (NTLM cerca su dominio)
> - `corp\admin` con backslash singolo (in JSON va escaped come `corp\\admin`)
> - `admin@dominio` senza FQDN completo (`admin@corp` invece di `admin@corp.local`) → Kerberos fallisce

---

## 7. Troubleshooting per errore

### `[AUTH_REJECTED] 401`

| Causa | Diagnosi | Fix |
|---|---|---|
| Username senza prefisso `.\` per account locale | format esatto in DA-IPAM | aggiungi `.\` |
| LATFP non impostato (admin custom non-builtin) | `reg query HKLM\...\Policies\System /v LocalAccountTokenFilterPolicy` | imposta a `1`, restart winrm |
| Password sbagliata | `net user nomeutente` sul server | verifica password |
| Account non in Administrators | `net localgroup Administrators` | aggiungi al gruppo |
| NTLM disabilitato (Windows 11/Server 2022 hardened) | `Get-ItemProperty HKLM:\SYSTEM\CurrentControlSet\Control\Lsa \| Select RestrictReceivingNTLMTraffic` | se = 2, abbassa a 0 oppure usa Kerberos (richiede AD) |

### `[TCP_TIMEOUT]`

| Causa | Diagnosi | Fix |
|---|---|---|
| Listener WinRM non attivo | `netstat -ano \| findstr ":5985"` sul server | `Enable-PSRemoting -Force -SkipNetworkProfileCheck` |
| Regola firewall mancante su profilo Public (workgroup) | `Get-NetFirewallRule -DisplayName "WinRM*" \| Format-Table DisplayName, Enabled, Profile` | `Enable-NetFirewallRule -Name WINRM-HTTP-In-TCP-PUBLIC` |
| Antivirus enterprise (Sophos, ESET, Kaspersky) | controlla log antivirus | eccezione TCP 5985 |
| Router/VLAN ACL blocca tra DA-IPAM subnet e server subnet | da appliance: `timeout 3 bash -c '</dev/tcp/IP/5985'` | apri policy rete |

### `[KERBEROS_FAILED]`

Solo se forzato `WINRM_TRANSPORT=kerberos`. Rimuovi env var, il bridge fa fallback automatico su NTLM.

### `[KERBEROS_ONLY]`

Server hardened con NTLM disabilitato (RestrictReceivingNTLMTraffic=2):
- Soluzione A: joinare al dominio AD, usare credenziali AD (Kerberos passa)
- Soluzione B: riabilitare NTLM con `Set-ItemProperty HKLM:\SYSTEM\CurrentControlSet\Control\Lsa -Name RestrictReceivingNTLMTraffic -Value 0`

---

## 8. Verifiche post-installazione

Sul server target (PowerShell):

```powershell
# Listener attivo e in ascolto su tutte le interfacce
winrm enumerate winrm/config/listener

# Auth providers (Negotiate=true necessario per NTLM)
winrm get winrm/config/service/auth

# Test self-loopback
Test-NetConnection -ComputerName localhost -Port 5985

# Profilo NIC
Get-NetConnectionProfile

# Membership Administrators
net localgroup Administrators

# Account attivo, password non scaduta
net user nomeutente
```

Dal lato DA-IPAM (test credenziale):
1. `/credentials` → seleziona la credenziale Windows → bottone **"Test"**
2. Inserisci l'IP del server target
3. Deve apparire toast **"Test riuscito"**

Se test OK, prova un upgrade su un pacchetto sicuro (es. `notepadplusplus`):
1. Apri il device in `/objects/<id>`
2. Tab Patch Management → **Probe**
3. Da un pacchetto outdated → **Upgrade**

---

## 9. Sicurezza e hardening

### Restrizione IP

WinRM esposto sull'intera rete è rischio. Restringere a IP DA-IPAM appliance:

```powershell
# Aggiunge restrizione su listener esistente
Set-Item WSMan:\localhost\Service\IPv4Filter -Value "192.168.4.8"
Restart-Service winrm
```

GPO equivalente: vedi §5.

### HTTPS (5986)

Per traffico WinRM su link untrusted (WAN, internet, sede remota):

```powershell
# Genera self-signed cert
$cert = New-SelfSignedCertificate -DnsName $env:COMPUTERNAME -CertStoreLocation Cert:\LocalMachine\My

# Crea listener HTTPS
New-Item -Path WSMan:\Localhost\Listener -Transport HTTPS `
  -Address * -CertificateThumbprint $cert.Thumbprint -Force

# Apri firewall 5986
New-NetFirewallRule -DisplayName "WinRM-HTTPS-In" -Direction Inbound `
  -Protocol TCP -LocalPort 5986 -Action Allow
```

In DA-IPAM la credenziale resta uguale, ma sul test si specifica porta **5986** invece di 5985.

### Disabilitare Basic auth

Sconsigliata sempre, ma per certezza:
```powershell
Set-Item WSMan:\Localhost\Service\Auth\Basic -Value $false
```

### Audit log

Eventi WinRM logged in `Microsoft-Windows-WinRM/Operational`. Per eventi auth fail:
```powershell
Get-WinEvent -LogName 'Microsoft-Windows-WinRM/Operational' -MaxEvents 50 |
  Where-Object {$_.LevelDisplayName -eq 'Error'} | Select-Object TimeCreated, Message
```

---

## 10. Quick reference comandi

```powershell
# === SETUP ===
Enable-PSRemoting -Force -SkipNetworkProfileCheck                    # Workgroup
Enable-PSRemoting -Force                                              # Domain
reg add HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System `
  /v LocalAccountTokenFilterPolicy /t REG_DWORD /d 1 /f               # LATFP (admin custom)

# === DIAGNOSTICA ===
netstat -ano | findstr ":5985"                                        # Listener attivo
Test-NetConnection -ComputerName localhost -Port 5985                 # Self-loopback
winrm enumerate winrm/config/listener                                 # Listener configurati
winrm get winrm/config/service/auth                                   # Auth providers
Get-NetConnectionProfile                                              # Profilo NIC
Get-NetFirewallRule -DisplayName "WinRM*" |
  Format-Table DisplayName, Enabled, Profile, Direction               # Firewall rules
net localgroup Administrators                                         # Gruppo admin
net user nomeutente                                                   # Stato utente

# === FIX FIREWALL ===
Enable-NetFirewallRule -Name WINRM-HTTP-In-TCP
Enable-NetFirewallRule -Name WINRM-HTTP-In-TCP-PUBLIC
netsh advfirewall firewall add rule name="WinRM-In" dir=in action=allow protocol=TCP localport=5985

# === RESTART ===
Restart-Service winrm
sc.exe stop winrm; sc.exe start winrm

# === RESET COMPLETO ===
Stop-Service winrm -Force
winrm invoke restore winrm/config
Enable-PSRemoting -Force -SkipNetworkProfileCheck                     # Reset + reconfig

# === HARDENING ===
Set-Item WSMan:\localhost\Service\IPv4Filter -Value "192.168.4.8"     # Whitelist IP
Set-Item WSMan:\Localhost\Service\Auth\Basic -Value $false            # Disable Basic
```

---

## Appendice A: Matrice scenari riassunta

| Scenario | LATFP | -SkipNetworkProfileCheck | Username DA-IPAM |
|---|---|---|---|
| Workgroup + Administrator builtin | NO | SÌ | `.\Administrator` |
| Workgroup + admin custom | **SÌ** | **SÌ** | `.\<user>` |
| Domain + utente AD | NO | NO | `<user>@<fqdn>` o `<DOMINIO>\<user>` |
| Domain + admin locale builtin | NO | NO | `.\Administrator` |
| Domain + admin locale custom | **SÌ** | NO | `.\<user>` |
| Domain Controller (LDAP) | NO | NO | (LDAP, non WinRM) |
| Domain Controller (WinRM) | NO | NO | `Domain Admin@<fqdn>` |
| Postazione Windows (GPO) | NO | NO (è Domain) | `<svc>@<fqdn>` |

---

## Appendice B: Memoria storica incidenti

Documentazione di fix scoperti sul campo (riferimenti memoria progetto):

- **DA cliente Veeam (workgroup + admin `da`)** — `reference_winrm_local_admin_non_builtin.md`. Tre fix sovrapposti, risolto con LATFP + SkipNetworkProfileCheck + `.\da`.
- **LDAPS DC cliente con signing forzato** — `reference_da_ipam_ldaps_client_dc.md`. Fix lato DC: self-signed in `Personal` + `Trusted Root` + restart NTDS.
- **Patch management 5min timeout** — `reference_da_ipam_sqlite_datetime_string_compare.md`. Non WinRM, ma datetime SQLite mal confrontato; v0.2.652.

---

**Manutenzione**: tieni aggiornato questo manuale ogni volta che si scopre un nuovo scenario sul campo. Il pattern di update: salva memoria in `~/.claude/projects/.../memory/`, aggiungi sezione qui, fai bump versione DA-IPAM.
