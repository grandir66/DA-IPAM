# Playbook — Upgrade agent Wazuh

## Quando NON usare lo script (= reinstallazione manuale)

Per **pochi host** (1-10) o **mix eterogeneo** (Win + Linux + Mac), l'install
manuale è più rapido di setup `hosts.txt` + SSH config + script. Lo script
serve per **flotte omogenee da 20+ host SSH-reachable**.

### One-liner copy-paste

**Linux Ubuntu/Debian** (SSH all'host):
```bash
sudo curl -fsSLo /tmp/wazuh-agent.deb \
  "https://packages.wazuh.com/4.x/apt/pool/main/w/wazuh-agent/wazuh-agent_4.14.5-1_amd64.deb" \
  && sudo dpkg -i /tmp/wazuh-agent.deb \
  && sudo systemctl restart wazuh-agent \
  && /var/ossec/bin/wazuh-control info | grep VERSION
```

**RHEL/CentOS/Rocky** (SSH all'host):
```bash
sudo curl -fsSLo /tmp/wazuh-agent.rpm \
  "https://packages.wazuh.com/4.x/yum/wazuh-agent-4.14.5-1.x86_64.rpm" \
  && sudo rpm -U --force /tmp/wazuh-agent.rpm \
  && sudo systemctl restart wazuh-agent
```

**Windows** (RDP, PowerShell admin):
```powershell
Invoke-WebRequest "https://packages.wazuh.com/4.x/windows/wazuh-agent-4.14.5-1.msi" -OutFile $env:TEMP\wazuh-agent.msi
Start-Process msiexec.exe -ArgumentList "/i $env:TEMP\wazuh-agent.msi /q" -Wait
Restart-Service WazuhSvc
```

**macOS** (terminale):
```bash
ARCH=$([ "$(uname -m)" = "arm64" ] && echo arm64 || echo intel64)
curl -fsSLo /tmp/wazuh-agent.pkg "https://packages.wazuh.com/4.x/macos/wazuh-agent-4.14.5-1.${ARCH}.pkg"
sudo installer -pkg /tmp/wazuh-agent.pkg -target /
sudo /Library/Ossec/bin/wazuh-control restart
```

Aggiorna `4.14.5-1` alla release target corrente prima di usare.

---

## Quando USARE lo script `scripts/upgrade-wazuh-agents.sh`

- Nuovo cliente con **20+ Linux server** SSH-reachable, omogenei
- Vuoi log centralizzato per ogni host (`/tmp/wazuh-upgrade-<ts>/`)
- Vuoi parallelismo controllato (`--parallel N`)
- Vuoi `--dry-run` per verificare connettività prima di lanciare

Per i casi "5 server Linux Domarc" l'install manuale è più rapido. Lo script
resta per scenari futuri.

### Variante con autenticazione PASSWORD: `scripts/upgrade-wazuh-agents-pwd.sh`

Se NON hai chiavi SSH sugli host target (es. ambiente cliente, primo touch),
usa questa variante. Richiede `sshpass` (`brew install hudochenkov/sshpass/sshpass`
su Mac).

```bash
# 1. Prepara file input (chmod 600 — è gitignored di default)
cp scripts/wazuh-hosts-pwd.example.txt /tmp/wazuh-hosts-pwd.txt
chmod 600 /tmp/wazuh-hosts-pwd.txt
# Riempi: ip|ssh_user|ssh_pass[|sudo_pass]
#   192.168.20.5|domarc|sshpassword|sudopassword
#   192.168.4.40|admin|stessapass

# 2. Dry-run prima
bash scripts/upgrade-wazuh-agents-pwd.sh --hosts /tmp/wazuh-hosts-pwd.txt --dry-run

# 3. Vero upgrade
bash scripts/upgrade-wazuh-agents-pwd.sh --hosts /tmp/wazuh-hosts-pwd.txt --target 4.14.5

# 4. Cleanup: dopo l'uso elimina il file con le password
shred -u /tmp/wazuh-hosts-pwd.txt
```

Lo script:
- Maschera password nei log (`sed s/PASS/***`)
- Avvisa se il file input ha permessi >600
- Detect OS family (Ubuntu/Debian/RHEL), download pacchetto corretto
- Skip automatico host già a target version

---

## Background: perché upgrade via Wazuh API spesso fallisce

Quando l'upgrade via Wazuh REST API (`PUT /agents/upgrade`) fallisce con
`Send upgrade command error` su agent v4.11/v4.12, il problema reale è che
**il `wpk_root.pem` dell'agent non riconosce la firma del WPK target**
(Wazuh ha ruotato la CA dei WPK tra versioni).

Diagnosi confermata sul Wazuh Domarc (debug log `wazuh-modulesd:agent-upgrade`):

```
[Manager] Sending: '036 upgrade {"command":"upgrade",...}'
[Agent]   → {"error":13,"message":"Could not verify signature"}
[Manager] ERROR → mascherato in API come "Send upgrade command error"
```

## Due strategie

| Strategia | Pro | Contro | Quando usarla |
|-----------|-----|--------|---------------|
| **A. Pacchetto nativo (`--mode pkg`)** | Bypassa completamente WPK e firma. Funziona sempre. | Richiede SSH (o WinRM) all'host. | Upgrade massivo / agent vecchi. **Raccomandato.** |
| **B. Rotation `wpk_root.pem` (`--mode wpk-fix`)** | Ripristina il flusso upgrade automatico via API. | Modifica file su agent prod. Comunque richiede SSH la prima volta. | Quando vuoi tenere l'upgrade automatico futuro. |

Lo script `scripts/upgrade-wazuh-agents.sh` implementa entrambe.

---

## Quick start

```bash
# 1. lista host upgrade-target (user@host SSH-reachable)
cat > /tmp/wazuh-hosts.txt <<EOF
domarc@192.168.20.5     # da-omada (Ubuntu)
domarc@192.168.4.40     # DA-OBSERVE (Ubuntu)
domarc@192.168.20.14    # da-ftp (Ubuntu)
domarc@192.168.4.42     # da-sns (Ubuntu)
domarc@192.168.4.41     # da-sns-dev (Ubuntu)
EOF

# 2. dry-run prima (verifica connettività + OS detect)
bash scripts/upgrade-wazuh-agents.sh \
  --hosts /tmp/wazuh-hosts.txt \
  --dry-run

# 3. upgrade vero (parallel 3)
bash scripts/upgrade-wazuh-agents.sh \
  --hosts /tmp/wazuh-hosts.txt \
  --target 4.14.2 \
  --parallel 3

# 4. log per host
ls /tmp/wazuh-upgrade-*/

# 5. verifica dal manager che siano tutti v4.14.2
JWT=$(curl -sk -u da-ipam:PASS -X POST \
  "https://da-wazuh.domarc.it:55000/security/user/authenticate?raw=true")
curl -sk -H "Authorization: Bearer $JWT" \
  "https://da-wazuh.domarc.it:55000/agents?select=id,name,version,status&q=version!=Wazuh v4.14.2;status=active" \
  | jq '.data.affected_items'
```

## Opzioni dello script

| Flag | Default | Descrizione |
|------|---------|-------------|
| `--hosts <file>` | (richiesto) | Lista host, uno per riga, formato `user@hostname[:port]` |
| `--target <ver>` | `4.14.2` | Versione Wazuh target |
| `--mode <pkg\|wpk-fix>` | `pkg` | `pkg` = install pacchetto nativo. `wpk-fix` = solo rotation wpk_root.pem |
| `--parallel <n>` | `3` | Host in parallelo |
| `--dry-run` | off | Mostra cosa farebbe (SSH detect OS, no install) |
| `--log-dir <dir>` | `/tmp/wazuh-upgrade-<ts>/` | Cartella log per host |

Override via env: `SSH_OPTS="-J root@jump -i ~/.ssh/key"`.

---

## Quando un agent NON è raggiungibile via SSH

Possibili soluzioni:

1. **Windows** → usa la skill `winrm-kerberos` (DA-IPAM ha bridge WinRM Python pronto)
2. **macOS** → spesso le password sudo richiedono touch — meglio chiedere all'utente
3. **Appliance closed (Omada, PRTG, ecc.)** → niente da fare via API/SSH, valuta se rimuovere l'agent
4. **Agent disconnesso** → l'host probabilmente è spento. Rimuovi via API se permanente:
   ```bash
   curl -sk -X DELETE -H "Authorization: Bearer $ADMIN_JWT" \
     "https://da-wazuh.domarc.it:55000/agents?agents_list=NNN&status=disconnected&older_than=90d&purge=true"
   ```

---

## Verifica risultato

### Lista agent ancora outdated dopo l'upgrade massivo

```bash
JWT=$(curl -sk -u da-ipam:PASS -X POST \
  "https://da-wazuh.domarc.it:55000/security/user/authenticate?raw=true")
curl -sk -H "Authorization: Bearer $JWT" \
  "https://da-wazuh.domarc.it:55000/agents/outdated?limit=500" \
  | jq '[.data.affected_items[] | {id, name, version}]'
```

### CVE post-upgrade (atteso: in calo perché i pacchetti sono più recenti)

```bash
curl -sk -u da-ipam-os:PASS \
  "https://da-wazuh.domarc.it:9200/wazuh-states-vulnerabilities-*/_count"
```

---

## Caso speciale: Windows

Lo script via SSH **non gestisce Windows** (richiede WinRM + cert + scaricamento MSI lato remoto). Per gli agent Win:

```powershell
# Su ogni Windows host, RDP/PSExec/WinRM:
$url = "https://packages.wazuh.com/4.x/windows/wazuh-agent-4.14.2-1.msi"
Invoke-WebRequest -Uri $url -OutFile C:\Temp\wazuh-agent.msi
msiexec.exe /i C:\Temp\wazuh-agent.msi /q
Restart-Service WazuhSvc
```

Per automatizzare, integrare con la skill `winrm-kerberos` di DA-IPAM (vedi
`.claude/skills/winrm-kerberos/SKILL.md`).

---

## Caso speciale: macOS

```bash
# Determina arch
ARCH=$(uname -m)  # arm64 o x86_64
SUFFIX=$([ "$ARCH" = "arm64" ] && echo arm64 || echo intel64)

curl -fsSLo /tmp/wazuh-agent.pkg \
  "https://packages.wazuh.com/4.x/macos/wazuh-agent-4.14.2-1.${SUFFIX}.pkg"
sudo installer -pkg /tmp/wazuh-agent.pkg -target /
sudo /Library/Ossec/bin/wazuh-control restart
```

---

## Cleanup agent stale (recap operazione 2026-05-24)

Quando un agent è disconnected da >30-90gg ed è confermato dismesso, rimuoverlo
**purga anche le sue CVE dagli indici inventory/vulnerabilities**. Senza purge,
le CVE storiche restano e gonfiano i dashboard.

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

Esempio reale fatto il 2026-05-24:
- Cancellati 18 agent (13 vecchi + 5 grossi disc): `005,010,011,013,025,030,032,037,039,043,044,050,051,052,053,060,085,091`
- CVE totali **42.119 → 34.589** (-7.530)
- Agent totali **61 → 43** (27 active, 16 disc)
