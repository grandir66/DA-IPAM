# Wazuh Agent — Playbook unificato (install + upgrade)

> **Versione target:** `4.14.5`
> **Manager Domarc:** `da-wazuh.domarc.it` (Tailscale: stesso FQDN, IP storico `192.168.4.19`)
> **Manager cliente (esempio):** `172.16.1.10` (`srv-wazuh` — LAN privata 172.16.0.0/16)
>
> Per ogni cliente / sito sostituire `da-wazuh.domarc.it` con l'IP/FQDN del manager target.
> La versione `4.14.5-1` nei link va aggiornata se cambia la release.

Documento operativo: install da zero o upgrade dell'agent Wazuh su un device. Da girare ai colleghi che devono operare sui propri host o sui server in gestione.

---

## Indice

1. [Prima di iniziare](#1-prima-di-iniziare)
2. [Decision tree — quale percorso seguire](#2-decision-tree--quale-percorso-seguire)
3. [Install / Upgrade manuale per OS](#3-install--upgrade-manuale-per-os)
   - [3.1 Linux Ubuntu/Debian](#31-linux-ubuntudebian)
   - [3.2 Linux RHEL/CentOS/Rocky/AlmaLinux](#32-linux-rhelcentosrockyalmalinux)
   - [3.3 Windows](#33-windows)
   - [3.4 macOS](#34-macos)
4. [Upgrade massivo via script (20+ host)](#4-upgrade-massivo-via-script-20-host)
5. [Casi speciali e operazioni via API](#5-casi-speciali-e-operazioni-via-api)
6. [FAQ / Troubleshooting](#6-faq--troubleshooting)
7. [Contatti](#7-contatti)

---

## 1. Prima di iniziare

- Servono **privilegi admin/sudo** (`sudo` su Linux/macOS, "Esegui come amministratore" su Windows).
- L'host deve raggiungere il manager sulle porte:
  - **`1514/tcp`** → eventi (sempre)
  - **`1515/tcp`** → enrollment (solo install nuovo)
- L'install da zero richiede il manager raggiungibile.

### Verifica se l'agent è già installato

| OS | Comando |
|----|---------|
| **Debian/Ubuntu** | `dpkg-query -W -f='${Version}\n' wazuh-agent` |
| **RHEL/CentOS** | `rpm -q wazuh-agent` |
| **Linux generico** | `sudo /var/ossec/bin/wazuh-control info \| grep VERSION` |
| **Windows** (PowerShell) | `Get-ItemProperty "HKLM:\SOFTWARE\Wazuh\Agent" -Name "Version"` |
| **macOS** | `sudo /Library/Ossec/bin/wazuh-control info \| grep VERSION` |

---

## 2. Decision tree — quale percorso seguire

```
Quanti host devo aggiornare/installare?
│
├─ 1–10 host  → percorso MANUALE per OS (sezione 3)
│              one-liner copy-paste, in SSH/PowerShell/Terminale
│
└─ 20+ host omogenei (tutti Linux SSH-reachable)
   │
   ├─ Ho chiavi SSH già configurate?
   │  ├─ SÌ → scripts/upgrade-wazuh-agents.sh        (sezione 4.2)
   │  └─ NO → scripts/upgrade-wazuh-agents-pwd.sh    (sezione 4.3)
   │
   └─ Mix Windows/Linux?
      └─ Linux via script + Windows in GPO/RMM/PowerShell (manuale).
         Per WinRM automatizzato → skill `winrm-kerberos` di DA-IPAM.
```

> **Regola pratica:** sotto i ~15 host, la preparazione di `hosts.txt` + SSH config dello script costa più del tempo risparmiato. Lo script paga sopra le 20 unità o quando ti serve log centralizzato.

---

## 3. Install / Upgrade manuale per OS

Per ciascun OS sono presenti tre blocchi: **upgrade** (agent già installato), **install da zero** (host nuovo), **verifica**.

### 3.1 Linux Ubuntu/Debian

#### Upgrade

```bash
sudo curl -fsSLo /tmp/wazuh-agent.deb \
  "https://packages.wazuh.com/4.x/apt/pool/main/w/wazuh-agent/wazuh-agent_4.14.5-1_amd64.deb" \
  && sudo dpkg --force-confnew -i /tmp/wazuh-agent.deb \
  && sudo systemctl restart wazuh-agent \
  && sudo rm -f /tmp/wazuh-agent.deb \
  && dpkg-query -W -f='wazuh-agent: ${Version}\n' wazuh-agent
```

Output finale atteso: `wazuh-agent: 4.14.5-1`

#### Install da zero

```bash
sudo curl -fsSLo /tmp/wazuh-agent.deb \
  "https://packages.wazuh.com/4.x/apt/pool/main/w/wazuh-agent/wazuh-agent_4.14.5-1_amd64.deb"

sudo WAZUH_MANAGER='da-wazuh.domarc.it' \
     WAZUH_AGENT_GROUP='default' \
     dpkg -i /tmp/wazuh-agent.deb

sudo systemctl daemon-reload
sudo systemctl enable --now wazuh-agent
sudo rm -f /tmp/wazuh-agent.deb
sudo /var/ossec/bin/wazuh-control status
```

#### Verifica

```bash
sudo systemctl status wazuh-agent --no-pager | head -10
sudo tail -20 /var/ossec/logs/ossec.log
```

L'agent deve registrarsi sul manager entro 30s e apparire nella dashboard Wazuh come `active`.

---

### 3.2 Linux RHEL/CentOS/Rocky/AlmaLinux

#### Upgrade

```bash
sudo curl -fsSLo /tmp/wazuh-agent.rpm \
  "https://packages.wazuh.com/4.x/yum/wazuh-agent-4.14.5-1.x86_64.rpm" \
  && sudo rpm -U --force /tmp/wazuh-agent.rpm \
  && sudo systemctl restart wazuh-agent \
  && sudo rm -f /tmp/wazuh-agent.rpm \
  && rpm -q wazuh-agent
```

#### Install da zero

```bash
sudo curl -fsSLo /tmp/wazuh-agent.rpm \
  "https://packages.wazuh.com/4.x/yum/wazuh-agent-4.14.5-1.x86_64.rpm"

sudo WAZUH_MANAGER='da-wazuh.domarc.it' \
     WAZUH_AGENT_GROUP='default' \
     rpm -ivh /tmp/wazuh-agent.rpm

sudo systemctl daemon-reload
sudo systemctl enable --now wazuh-agent
sudo rm -f /tmp/wazuh-agent.rpm
```

#### Verifica

```bash
sudo systemctl status wazuh-agent --no-pager | head -10
sudo tail -20 /var/ossec/logs/ossec.log
```

---

### 3.3 Windows

> Apri **PowerShell come Amministratore** (tasto destro sull'icona → "Esegui come amministratore").

#### Upgrade

```powershell
Invoke-WebRequest "https://packages.wazuh.com/4.x/windows/wazuh-agent-4.14.5-1.msi" -OutFile "$env:TEMP\wazuh-agent.msi"
Start-Process msiexec.exe -ArgumentList "/i `"$env:TEMP\wazuh-agent.msi`" /qn" -Wait
Restart-Service WazuhSvc
Remove-Item "$env:TEMP\wazuh-agent.msi"
Get-Service WazuhSvc
```

#### Install da zero

```powershell
Invoke-WebRequest "https://packages.wazuh.com/4.x/windows/wazuh-agent-4.14.5-1.msi" -OutFile "$env:TEMP\wazuh-agent.msi"
Start-Process msiexec.exe -ArgumentList "/i `"$env:TEMP\wazuh-agent.msi`" /qn WAZUH_MANAGER='da-wazuh.domarc.it' WAZUH_AGENT_GROUP='default'" -Wait
Start-Service WazuhSvc
Remove-Item "$env:TEMP\wazuh-agent.msi"
Get-Service WazuhSvc
```

#### Verifica

```powershell
Get-Service WazuhSvc                    # deve essere Running
Get-Content "C:\Program Files (x86)\ossec-agent\ossec.log" -Tail 20
```

#### Deploy massivo Windows

Per molti host Windows non c'è un modo "via SSH" affidabile. Tre opzioni:

1. **GPO / Intune / RMM** del cliente → push del `.msi` con le ENV `WAZUH_MANAGER` e `WAZUH_AGENT_GROUP`
2. **Skill `winrm-kerberos`** di DA-IPAM (`.claude/skills/winrm-kerberos/SKILL.md`) — bridge Python pronto, gestisce auth Kerberos AD
3. **Manuale RDP** sui pochi host critici

---

### 3.4 macOS

> Apri il **Terminale** (Cmd+Space → Terminale).

#### Upgrade

```bash
ARCH=$([ "$(uname -m)" = "arm64" ] && echo arm64 || echo intel64)
curl -fsSLo /tmp/wazuh-agent.pkg \
  "https://packages.wazuh.com/4.x/macos/wazuh-agent-4.14.5-1.${ARCH}.pkg"
sudo installer -pkg /tmp/wazuh-agent.pkg -target /
sudo /Library/Ossec/bin/wazuh-control restart
rm -f /tmp/wazuh-agent.pkg
sudo /Library/Ossec/bin/wazuh-control info | grep VERSION
```

#### Install da zero

```bash
ARCH=$([ "$(uname -m)" = "arm64" ] && echo arm64 || echo intel64)
curl -fsSLo /tmp/wazuh-agent.pkg \
  "https://packages.wazuh.com/4.x/macos/wazuh-agent-4.14.5-1.${ARCH}.pkg"

sudo installer -pkg /tmp/wazuh-agent.pkg -target /

# Imposta manager e gruppo nel file di config
sudo sed -i '' 's|<address>MANAGER_IP</address>|<address>da-wazuh.domarc.it</address>|' /Library/Ossec/etc/ossec.conf
sudo /Library/Ossec/bin/wazuh-control restart
rm -f /tmp/wazuh-agent.pkg
```

#### Verifica

```bash
sudo /Library/Ossec/bin/wazuh-control status
sudo tail -20 /Library/Ossec/logs/ossec.log
```

---

## 4. Upgrade massivo via script (20+ host)

Per flotte omogenee di Linux SSH-reachable. Script in `scripts/` del repo DA-IPAM.

### 4.1 Quando usare lo script

- **20+ Linux server** SSH-reachable, omogenei (stessa famiglia OS o miste Debian/RHEL)
- Vuoi log centralizzato per ogni host (`/tmp/wazuh-upgrade-<ts>/`)
- Vuoi parallelismo controllato (`--parallel N`)
- Vuoi `--dry-run` per verificare connettività prima del deploy reale

Per "5 server Linux Domarc" l'install manuale è più rapido. Lo script resta per scenari futuri o per i nuovi clienti con parchi grossi.

### 4.2 Variante chiavi SSH — `scripts/upgrade-wazuh-agents.sh`

```bash
# 1. Lista host upgrade-target (user@host SSH-reachable)
cat > /tmp/wazuh-hosts.txt <<EOF
domarc@192.168.20.5     # da-omada (Ubuntu)
domarc@192.168.4.40     # DA-OBSERVE (Ubuntu)
domarc@192.168.20.14    # da-ftp (Ubuntu)
domarc@192.168.4.42     # da-sns (Ubuntu)
domarc@192.168.4.41     # da-sns-dev (Ubuntu)
EOF

# 2. Dry-run prima (verifica connettività + OS detect, no install)
bash scripts/upgrade-wazuh-agents.sh \
  --hosts /tmp/wazuh-hosts.txt \
  --dry-run

# 3. Upgrade vero (parallel 3)
bash scripts/upgrade-wazuh-agents.sh \
  --hosts /tmp/wazuh-hosts.txt \
  --target 4.14.5 \
  --parallel 3

# 4. Log per host
ls /tmp/wazuh-upgrade-*/

# 5. Verifica dal manager che siano tutti alla versione target
JWT=$(curl -sk -u da-ipam:PASS -X POST \
  "https://da-wazuh.domarc.it:55000/security/user/authenticate?raw=true")
curl -sk -H "Authorization: Bearer $JWT" \
  "https://da-wazuh.domarc.it:55000/agents?select=id,name,version,status&q=version!=Wazuh v4.14.5;status=active" \
  | jq '.data.affected_items'
```

#### Opzioni dello script

| Flag | Default | Descrizione |
|------|---------|-------------|
| `--hosts <file>` | (richiesto) | Lista host, uno per riga, formato `user@hostname[:port]` |
| `--target <ver>` | `4.14.5` | Versione Wazuh target |
| `--mode <pkg\|wpk-fix>` | `pkg` | `pkg` = install pacchetto nativo. `wpk-fix` = solo rotation `wpk_root.pem` |
| `--parallel <n>` | `3` | Host in parallelo |
| `--dry-run` | off | Mostra cosa farebbe (SSH detect OS, no install) |
| `--log-dir <dir>` | `/tmp/wazuh-upgrade-<ts>/` | Cartella log per host |

Override SSH options via env: `SSH_OPTS="-J root@jump -i ~/.ssh/key"`.

### 4.3 Variante password — `scripts/upgrade-wazuh-agents-pwd.sh`

Se **NON** hai chiavi SSH sugli host target (es. ambiente cliente, primo touch), usa questa variante. Richiede `sshpass` (`brew install hudochenkov/sshpass/sshpass` su Mac, `apt install sshpass` su Linux).

```bash
# 1. Prepara file input (chmod 600 — è gitignored di default)
cp scripts/wazuh-hosts-pwd.example.txt /tmp/wazuh-hosts-pwd.txt
chmod 600 /tmp/wazuh-hosts-pwd.txt
# Formato riga: ip|ssh_user|ssh_pass[|sudo_pass]
#   192.168.20.5|domarc|sshpassword|sudopassword
#   192.168.4.40|admin|stessapass

# 2. Dry-run prima
bash scripts/upgrade-wazuh-agents-pwd.sh --hosts /tmp/wazuh-hosts-pwd.txt --dry-run

# 3. Upgrade vero
bash scripts/upgrade-wazuh-agents-pwd.sh --hosts /tmp/wazuh-hosts-pwd.txt --target 4.14.5

# 4. Cleanup: dopo l'uso elimina il file con le password
shred -u /tmp/wazuh-hosts-pwd.txt
```

Lo script:
- Maschera password nei log (`sed s/PASS/***`)
- Avvisa se il file input ha permessi `>600`
- Detect OS family (Ubuntu/Debian/RHEL), download pacchetto corretto
- Skip automatico host già a target version

---

## 5. Casi speciali e operazioni via API

### 5.1 Background — perché upgrade via Wazuh API spesso fallisce

Quando l'upgrade via Wazuh REST API (`PUT /agents/upgrade`) fallisce con `Send upgrade command error` su agent v4.11/v4.12, il problema reale è che il `wpk_root.pem` dell'agent **non riconosce la firma del WPK target** (Wazuh ha ruotato la CA dei WPK tra versioni).

Diagnosi confermata sul Wazuh Domarc (debug log `wazuh-modulesd:agent-upgrade`):

```
[Manager] Sending: '036 upgrade {"command":"upgrade",...}'
[Agent]   → {"error":13,"message":"Could not verify signature"}
[Manager] ERROR → mascherato in API come "Send upgrade command error"
```

Stessa diagnosi vale per il manager cliente `172.16.1.10` con i suoi 57 Windows + 1 Debian su agent 4.12.

#### Due strategie

| Strategia | Pro | Contro | Quando usarla |
|-----------|-----|--------|---------------|
| **A. Pacchetto nativo (`--mode pkg`)** | Bypassa completamente WPK e firma. Funziona sempre. | Richiede SSH (o WinRM) all'host. | Upgrade massivo / agent vecchi. **Raccomandato.** |
| **B. Rotation `wpk_root.pem` (`--mode wpk-fix`)** | Ripristina il flusso upgrade automatico via API. | Modifica file su agent prod. Comunque richiede SSH la prima volta. | Quando vuoi tenere l'upgrade automatico futuro. |

Lo script `scripts/upgrade-wazuh-agents.sh` implementa entrambe.

### 5.2 Verifica risultato

#### Lista agent ancora outdated dopo l'upgrade massivo

```bash
JWT=$(curl -sk -u da-ipam:PASS -X POST \
  "https://da-wazuh.domarc.it:55000/security/user/authenticate?raw=true")
curl -sk -H "Authorization: Bearer $JWT" \
  "https://da-wazuh.domarc.it:55000/agents/outdated?limit=500" \
  | jq '[.data.affected_items[] | {id, name, version}]'
```

#### Conteggio CVE post-upgrade (atteso: in calo)

```bash
curl -sk -u da-ipam-os:PASS \
  "https://da-wazuh.domarc.it:9200/wazuh-states-vulnerabilities-*/_count"
```

### 5.3 Quando un agent NON è raggiungibile via SSH

1. **Windows** → usa la skill [`winrm-kerberos`](../../.claude/skills/winrm-kerberos/SKILL.md) (DA-IPAM ha bridge WinRM Python pronto)
2. **macOS** → spesso le password sudo richiedono touch — meglio chiedere all'utente di lanciare l'one-liner localmente
3. **Appliance closed** (Omada, PRTG, ecc.) → niente da fare via API/SSH, valuta se rimuovere l'agent
4. **Agent disconnesso permanente** → rimuovi via API se confermato dismesso (vedi 5.4 sotto)

### 5.4 Cleanup agent stale (con purge CVE)

Quando un agent è disconnected da `>30-90gg` ed è confermato dismesso, rimuoverlo **purga anche le sue CVE dagli indici inventory/vulnerabilities**. Senza purge, le CVE storiche restano e gonfiano i dashboard.

```bash
ADMIN_JWT=$(curl -sk -u wazuh-wui:ADMIN_PASS -X POST \
  "https://da-wazuh.domarc.it:55000/security/user/authenticate?raw=true")

# Backup info pre-delete
curl -sk -H "Authorization: Bearer $ADMIN_JWT" \
  "https://da-wazuh.domarc.it:55000/agents?agents_list=NNN,MMM&select=id,name,ip,version,group" \
  > backup-agents-$(date +%F).json

# Delete con purge (rimuove anche client.keys e dati)
curl -sk -X DELETE -H "Authorization: Bearer $ADMIN_JWT" \
  "https://da-wazuh.domarc.it:55000/agents?agents_list=NNN,MMM&status=all&older_than=0s&purge=true"
```

Esempio reale eseguito il 2026-05-24 sul manager Domarc:
- Cancellati 18 agent (13 vecchi + 5 disconnessi grossi): `005,010,011,013,025,030,032,037,039,043,044,050,051,052,053,060,085,091`
- CVE totali: **42.119 → 34.589** (−7.530)
- Agent totali: **61 → 43** (27 active, 16 disc)

---

## 6. FAQ / Troubleshooting

### Linux: prompt `Configuration file '/etc/systemd/system/wazuh-agent.service' Deleted`

Risposta: **Y** (installa la versione del pacchetto). Significa che il file unit era stato modificato/cancellato a mano. Il flag `--force-confnew` nell'one-liner della sezione 3.1 evita il prompt automaticamente.

### Linux: `rm: cannot remove '/tmp/wazuh-agent.deb': Operation not permitted`

Il file è stato creato da `sudo curl` come root e `/tmp` ha lo sticky bit. Aggiungi `sudo` anche al `rm` (già fatto negli one-liner). Errore innocuo: l'agent è stato installato comunque.

### Linux: `/var/ossec/bin/wazuh-control: Permission denied`

Il binario ha permessi `0750 root:wazuh`. Usa `sudo` davanti, oppure leggi solo la versione con `dpkg-query -W -f='${Version}\n' wazuh-agent`.

### Windows: il servizio `WazuhSvc` non parte

Verifica che la porta 1514 verso il manager non sia bloccata da firewall:

```powershell
Test-NetConnection da-wazuh.domarc.it -Port 1514
```

### L'agent risulta `disconnected` sulla dashboard Wazuh dopo l'install

1. Controlla `ossec.log` (path nella tabella sotto) per errori
2. Verifica che il manager sia raggiungibile dall'host (porta 1514)
3. Forza re-registration: cancella `client.keys` e restart agent
   - Linux/macOS: `sudo rm /var/ossec/etc/client.keys` o `/Library/Ossec/etc/client.keys`
   - Windows: `Remove-Item "C:\Program Files (x86)\ossec-agent\client.keys"`

### Dove finiscono i log dell'agent?

| OS | Path |
|----|------|
| Linux | `/var/ossec/logs/ossec.log` |
| Windows | `C:\Program Files (x86)\ossec-agent\ossec.log` |
| macOS | `/Library/Ossec/logs/ossec.log` |

### Bug WPK firma (upgrade API fallisce)

Vedi sezione [5.1](#51-background--perché-upgrade-via-wazuh-api-spesso-fallisce). Workaround: usare pacchetto nativo (`--mode pkg`) o rotation `wpk_root.pem`.

---

## 7. Contatti

Per problemi che non si risolvono con la FAQ: scrivere a **IT Domarc**.

- **Manager Domarc** Wazuh: `da-wazuh.domarc.it` (VM 192.168.4.19)
- **Manager cliente** esempio: `172.16.1.10` (`srv-wazuh`, accesso SSH via `dts@172.16.1.10`)

---

## Cronologia documento

- **2026-05-25** — Unione di `wazuh-agent-install.md` + `wazuh-agent-upgrade.md` in un unico playbook strutturato, aggiunto decision tree, riferimento al manager cliente 172.16.1.10
