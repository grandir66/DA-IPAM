# Installazione / Aggiornamento Wazuh agent — Guida IT Domarc

Istruzioni per installare da zero o aggiornare l'agent Wazuh (SIEM Domarc) su un
device. Da girare ai colleghi che devono operare sui propri host o sui server
in gestione.

> **Versione target attuale: 4.14.5**
> **Manager Domarc:** `da-wazuh.domarc.it` (Tailscale: stesso FQDN)

## Prima di iniziare

- Servono **privilegi admin/sudo** (sudo su Linux/macOS, "Esegui come amministratore" su Windows)
- L'host deve raggiungere `da-wazuh.domarc.it` sulle porte **1514/tcp** (eventi) e **1515/tcp** (enrollment iniziale, solo install nuovo)
- Per l'install da zero serve il manager raggiungibile in rete

Per capire se un host ha già l'agent installato e che versione è:
- Linux/macOS: `sudo /var/ossec/bin/wazuh-control info | grep VERSION` (oppure `dpkg-query -W -f='${Version}\n' wazuh-agent` su Debian/Ubuntu)
- Windows: `Get-ItemProperty "HKLM:\SOFTWARE\Wazuh\Agent" -Name "Version"` in PowerShell

---

## Linux — Ubuntu / Debian

### Upgrade (agent già installato)

Lancia in SSH sull'host, una riga:

```bash
sudo curl -fsSLo /tmp/wazuh-agent.deb \
  "https://packages.wazuh.com/4.x/apt/pool/main/w/wazuh-agent/wazuh-agent_4.14.5-1_amd64.deb" \
  && sudo dpkg --force-confnew -i /tmp/wazuh-agent.deb \
  && sudo systemctl restart wazuh-agent \
  && sudo rm -f /tmp/wazuh-agent.deb \
  && dpkg-query -W -f='wazuh-agent: ${Version}\n' wazuh-agent
```

Output finale atteso: `wazuh-agent: 4.14.5-1`

### Install da zero (host senza Wazuh)

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

### Verifica

```bash
sudo systemctl status wazuh-agent --no-pager | head -10
sudo tail -20 /var/ossec/logs/ossec.log
```

L'agent deve registrarsi sul manager entro 30s e apparire nella dashboard Wazuh.

---

## Linux — RHEL / CentOS / Rocky / AlmaLinux

### Upgrade

```bash
sudo curl -fsSLo /tmp/wazuh-agent.rpm \
  "https://packages.wazuh.com/4.x/yum/wazuh-agent-4.14.5-1.x86_64.rpm" \
  && sudo rpm -U --force /tmp/wazuh-agent.rpm \
  && sudo systemctl restart wazuh-agent \
  && sudo rm -f /tmp/wazuh-agent.rpm \
  && rpm -q wazuh-agent
```

### Install da zero

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

---

## Windows

> **Apri PowerShell come Amministratore** (tasto destro sull'icona → "Esegui come amministratore")

### Upgrade

```powershell
Invoke-WebRequest "https://packages.wazuh.com/4.x/windows/wazuh-agent-4.14.5-1.msi" -OutFile "$env:TEMP\wazuh-agent.msi"
Start-Process msiexec.exe -ArgumentList "/i `"$env:TEMP\wazuh-agent.msi`" /qn" -Wait
Restart-Service WazuhSvc
Remove-Item "$env:TEMP\wazuh-agent.msi"
Get-Service WazuhSvc
```

### Install da zero

```powershell
Invoke-WebRequest "https://packages.wazuh.com/4.x/windows/wazuh-agent-4.14.5-1.msi" -OutFile "$env:TEMP\wazuh-agent.msi"
Start-Process msiexec.exe -ArgumentList "/i `"$env:TEMP\wazuh-agent.msi`" /qn WAZUH_MANAGER='da-wazuh.domarc.it' WAZUH_AGENT_GROUP='default'" -Wait
Start-Service WazuhSvc
Remove-Item "$env:TEMP\wazuh-agent.msi"
Get-Service WazuhSvc
```

### Verifica

```powershell
Get-Service WazuhSvc                    # deve essere Running
Get-Content "C:\Program Files (x86)\ossec-agent\ossec.log" -Tail 20
```

---

## macOS

> Apri il **Terminale** (Cmd+Space → Terminale)

### Upgrade

```bash
ARCH=$([ "$(uname -m)" = "arm64" ] && echo arm64 || echo intel64)
curl -fsSLo /tmp/wazuh-agent.pkg \
  "https://packages.wazuh.com/4.x/macos/wazuh-agent-4.14.5-1.${ARCH}.pkg"
sudo installer -pkg /tmp/wazuh-agent.pkg -target /
sudo /Library/Ossec/bin/wazuh-control restart
rm -f /tmp/wazuh-agent.pkg
sudo /Library/Ossec/bin/wazuh-control info | grep VERSION
```

### Install da zero

```bash
ARCH=$([ "$(uname -m)" = "arm64" ] && echo arm64 || echo intel64)
curl -fsSLo /tmp/wazuh-agent.pkg \
  "https://packages.wazuh.com/4.x/macos/wazuh-agent-4.14.5-1.${ARCH}.pkg"

sudo installer -pkg /tmp/wazuh-agent.pkg -target /

# Imposta manager e gruppo
echo "WAZUH_MANAGER='da-wazuh.domarc.it' && /Library/Ossec/bin/wazuh-control restart" | sudo tee -a /Library/Ossec/etc/ossec.conf > /dev/null
sudo sed -i '' 's|<address>MANAGER_IP</address>|<address>da-wazuh.domarc.it</address>|' /Library/Ossec/etc/ossec.conf
sudo /Library/Ossec/bin/wazuh-control restart
rm -f /tmp/wazuh-agent.pkg
```

### Verifica

```bash
sudo /Library/Ossec/bin/wazuh-control status
sudo tail -20 /Library/Ossec/logs/ossec.log
```

---

## FAQ / Troubleshooting

### Linux: prompt `Configuration file '/etc/systemd/system/wazuh-agent.service' Deleted`

Risposta: **Y** (installa la versione del pacchetto). Significa che il file unit
era stato modificato/cancellato a mano. Il flag `--force-confnew` nell'one-liner
sopra evita il prompt automaticamente.

### Linux: `rm: cannot remove '/tmp/wazuh-agent.deb': Operation not permitted`

Il file è stato creato da `sudo curl` come root e `/tmp` ha lo sticky bit. Aggiungi
`sudo` anche al `rm` (già fatto nell'one-liner sopra). Errore innocuo: l'agent è
stato installato comunque.

### Linux: `/var/ossec/bin/wazuh-control: Permission denied`

Il binario ha permessi `0750 root:wazuh`. Usa `sudo` davanti, oppure leggi solo
la versione con `dpkg-query -W -f='${Version}\n' wazuh-agent`.

### Windows: il servizio `WazuhSvc` non parte

Verifica che la porta 1514 verso `da-wazuh.domarc.it` non sia bloccata da firewall:

```powershell
Test-NetConnection da-wazuh.domarc.it -Port 1514
```

### L'agent risulta `disconnected` sulla dashboard Wazuh dopo l'install

1. Controlla `ossec.log` (path nelle sezioni "Verifica" sopra) per errori
2. Verifica che il manager sia raggiungibile dall'host
3. Forza re-registration: cancella `/var/ossec/etc/client.keys` (Linux/macOS) o
   `C:\Program Files (x86)\ossec-agent\client.keys` (Windows) e restart agent

### Dove finiscono i log dell'agent?

| OS | Path |
|----|------|
| Linux | `/var/ossec/logs/ossec.log` |
| Windows | `C:\Program Files (x86)\ossec-agent\ossec.log` |
| macOS | `/Library/Ossec/logs/ossec.log` |

---

## Contatti

Per problemi che non si risolvono con la FAQ: scrivere a IT Domarc.
Il manager Wazuh è gestito sulla VM **da-wazuh.domarc.it** (192.168.4.19).
