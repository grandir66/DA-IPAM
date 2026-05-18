# Playbook — Deploy agent DA-IPAM su host esistente (no bridge fresh)

Procedura per installare l'agent DA-IPAM su un host **già esistente** del
cliente (es. server Linux già operativo, container LXC, VM dedicata) senza
passare dal bridge template completo.

**Tempo stimato**: 5-10 minuti.
**Prerequisiti**: host Ubuntu 22.04+ o Debian 12+, accesso root, accesso
internet (apt + GitHub + tailscale.com), Tailscale auth-key, accesso admin
DA-IPAM per generare token.

---

## Pre-requisiti

- Cliente già registrato come **tenant** in DA-IPAM
- Hub DA-IPAM raggiungibile sia da admin (per generare il token) sia
  dall'host target (per scaricare l'installer)

## 1. Genera token e one-liner da UI DA-IPAM

Sul tuo Mac/workstation, in tailnet:

1. Apri `https://da-invent/agents`
2. Click **"Nuovo agente"**
3. **Step 1**: seleziona cliente esistente
4. **Step 2**: 
   - **Label/Sede**: es. `Sede principale`, `Server DB`, `LAN ufficio`
   - **Hostname**: nome MagicDNS che vuoi dare al nodo Tailscale (es. `agent-acme-srv01`)
   - **Porta**: 8443 (default)
   - **Subnet match**: CIDR LAN che questo agent può scansionare (opzionale, riservato Phase 7)
5. **Step 3**: copia l'intero one-liner `curl ... | bash`
6. **Salva subito il token plaintext in Keeper** sotto
   `Domarc / Agents / <cliente> / <label>`

## 2. Pre-check sull'host target (opzionale ma raccomandato)

Sull'host dove installerai l'agent:

```bash
# Scarica solo lo script e lancia il pre-check (no env vars necessarie)
curl -fsSL https://da-invent/agent-install.sh | bash -s -- --precheck
```

Output atteso: tutti verde o solo warning (es. "Tailscale non installato —
sarà installato"). Se ci sono errori bloccanti (OS troppo vecchio,
DNS rotto), risolvi prima di proseguire.

## 3. Esegui l'one-liner

```bash
# Incolla l'one-liner dal Step 3 del wizard. Esempio:
curl -fsSL https://da-invent/agent-install.sh \
  | TENANT_CODE='acme01' \
    HUB_URL='https://da-invent' \
    AGENT_TOKEN='<plaintext-token>' \
    AGENT_PORT='8443' \
    TAILSCALE_AUTH_KEY='tskey-auth-...' \
    bash
```

Lo script (idempotente, ~3-5 min) fa:
1. Verifica root + env vars obbligatorie
2. Installa Tailscale se mancante (script ufficiale tailscale.com)
3. `tailscale up` con auth-key (o interattivo se TAILSCALE_AUTH_KEY assente)
4. APT deps: python3.12, nmap, snmp, ping, ssh, krb5 dev libs
5. `setcap` su nmap (best-effort)
6. Sudoers fragment NOPASSWD limitato a `/usr/bin/nmap` (per UDP scan)
7. Crea utente `da-invent-agent`
8. Clone DA-IPAM/agent in `/opt/da-invent-agent/src/`
9. venv Python + `pip install -e .`
10. `/etc/da-invent-agent/config.yml` con tenant_code + bcrypt hash token
11. Systemd unit + enable + start

## 4. Verifica post-install

Sullo stesso host:

```bash
curl -fsSL https://da-invent/agent-install.sh | bash -s -- --verify
```

Output atteso: tutti verde su service, file config, sudoers, Tailscale,
porta in listen, /healthz.

Alternativa più rapida:

```bash
systemctl status da-invent-agent
curl http://localhost:8443/healthz
tailscale ip -4
```

## 5. Verifica hub-side

Su `https://da-invent/agents`:
- Refresh
- Il nuovo agent appare con `last_seen_at` recente
- Click **Test** → deve mostrare `online · Xms` verde
- Click **Configura** → puoi vedere/modificare hostname, porta, subnet_match

## Rotazione token

Se il token plaintext viene compromesso o perso:

1. UI `/agents` → riga agent → **Configura**
2. Bottone "Genera nuovo token" → mostra plaintext UNA VOLTA
3. Sull'host agent: ri-esegui l'one-liner con il **nuovo AGENT_TOKEN**.
   Lo script è idempotente: aggiornerà `config.yml` con il nuovo bcrypt
   hash e farà restart del service.

## Aggiornamento agent (manuale)

Per ora l'aggiornamento è manuale (Phase 8 aggiungerà `/admin/update`):

```bash
# Sull'host agent
cd /opt/da-invent-agent/src
sudo -u da-invent-agent git fetch
sudo -u da-invent-agent git checkout <new-tag>   # es. agent-v0.2.5
sudo /opt/da-invent-agent/venv/bin/pip install -e .
sudo systemctl restart da-invent-agent
sudo systemctl status da-invent-agent
```

## Disinstallazione

```bash
sudo systemctl disable --now da-invent-agent
sudo rm -rf /opt/da-invent-agent /etc/da-invent-agent /var/log/da-invent-agent
sudo rm -f /etc/systemd/system/da-invent-agent.service
sudo rm -f /etc/sudoers.d/da-invent-agent
sudo userdel da-invent-agent 2>/dev/null
sudo systemctl daemon-reload

# Tailscale: lasciato (potrebbe servire ad altri servizi sull'host).
# Per rimuovere anche Tailscale:
sudo tailscale logout
sudo apt-get remove -y tailscale

# Lato hub: UI /agents → Elimina (rimuove la registrazione,
# l'host può continuare a girare ma /whoami fallirà auth)
```

## Troubleshooting

### `curl: (35) SSL` durante install Tailscale
Cert store di sistema obsoleto. `apt-get install -y ca-certificates`.

### `tailscale up` resta in attesa
- Con auth-key: la key è scaduta o single-use già consumata. Rigenera.
- Interattivo: clicca l'URL stampato dallo script, autentica, lo script prosegue.

### Service avviato ma /healthz da 503 `tool_missing`
Apt ha installato pacchetti diversi (es. `nmap` mancante). Verifica con:
```bash
which nmap snmpwalk ssh
```
Re-esegui `apt-get install` manualmente per quello che manca.

### Hub vede "no_token" su /agents
Il config.yml ha un bcrypt hash di un token DIVERSO da quello cifrato
hub-side. Cause: hai rigenerato il token hub-side ma non aggiornato
l'agent. Soluzione: rigenera one-liner e ri-esegui (vedi "Rotazione token").

## Checklist finale

- [ ] Tenant cliente esistente in DA-IPAM
- [ ] Token + one-liner generato + salvato in Keeper
- [ ] Pre-check su host target verde
- [ ] One-liner eseguito senza errori
- [ ] Verify post-install verde
- [ ] Agent visibile in `/agents` UI con last_seen recente
- [ ] Bottone Test verde
- [ ] Host registrato in documento cliente
