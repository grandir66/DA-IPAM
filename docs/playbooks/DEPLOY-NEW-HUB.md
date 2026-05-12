# Playbook — Deploy nuovo hub DA-IPAM (o DA-Vul-can) da Ubuntu vuoto

Procedura per portare una VM Ubuntu 24.04 fresca a hub Domarc completamente
funzionante (UI HTTPS + scheduler cron + agent connector + backup nightly).

**Tempo stimato**: 25-40 minuti, di cui 15-20 min di build/npm ci.
**Prerequisiti**: VM Ubuntu 24.04 (≥4GB RAM, ≥30GB disco), accesso SSH
root, hostname risolvibile, accesso internet (apt + GitHub + npm).

---

## 1. Provisioning VM (5 min)

Su Proxmox:

```bash
# Sul nodo Proxmox (es. DA-PX-04 / 192.168.40.4)
qm clone <ubuntu-24-template-vmid> <new-vmid> --name <new-name>
qm set <new-vmid> --memory 8192 --cores 4
qm start <new-vmid>
```

Aspetta il boot, poi prendi nota dell'IP DHCP (`qm guest cmd <vmid> network-get-interfaces`).

## 2. Bootstrap base (3 min)

SSH al nuovo host:

```bash
ssh root@<new-ip>
apt-get update && apt-get install -y curl git ca-certificates
```

## 3. Install Node.js 22 + dipendenze sistema (5 min)

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs

# System deps richieste da DA-IPAM
apt-get install -y \
  sqlite3 nmap snmp fping arping iputils-ping \
  build-essential pkg-config libssl-dev libsqlite3-dev libsnmp-dev \
  libkrb5-dev krb5-config krb5-user libffi-dev \
  python3 python3-pip python3-venv

# setcap su nmap (servirà se l'hub fa scan locali; per scan via agent non serve)
setcap cap_net_raw,cap_net_admin,cap_net_bind_service=eip /usr/bin/nmap
```

## 4. Clone repo + .env.local (5 min)

```bash
# Crea utente di servizio (opzionale ma raccomandato)
useradd -r -m -s /bin/bash -d /opt/da-invent da-invent || true

# Clone GitOps-style
cd /opt
git clone https://github.com/grandir66/DA-IPAM.git da-invent
cd da-invent
git checkout main   # o feature/remote-agents per branch in lavorazione
chown -R da-invent:da-invent /opt/da-invent

# .env.local — generare segreti
sudo -u da-invent bash <<'EOF'
cd /opt/da-invent
cp .env.example .env.local 2>/dev/null || touch .env.local
# Genera ENCRYPTION_KEY (32 byte hex)
echo "ENCRYPTION_KEY=$(openssl rand -hex 32)" >> .env.local
# Genera AUTH_SECRET
echo "AUTH_SECRET=$(openssl rand -hex 32)" >> .env.local
echo "PORT=3001" >> .env.local
EOF

chmod 600 /opt/da-invent/.env.local
chown da-invent:da-invent /opt/da-invent/.env.local
```

⚠️ **SALVA ENCRYPTION_KEY in Keeper SUBITO**. Se la perdi, tutti i token
agent cifrati nel DB diventano inutilizzabili (`decrypt_failed`).

## 5. Install npm deps + build (10 min)

```bash
cd /opt/da-invent
sudo -u da-invent npm ci
sudo -u da-invent npm run build
```

## 6. Systemd unit (2 min)

```bash
cat >/etc/systemd/system/da-invent.service <<'EOF'
[Unit]
Description=DA-INVENT hub
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=da-invent
Group=da-invent
WorkingDirectory=/opt/da-invent
EnvironmentFile=/opt/da-invent/.env.local
ExecStart=/usr/bin/npx tsx server.ts
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

# Hardening minimo (non così aggressivo da rompere nmap/sudo come per l'agent)
NoNewPrivileges=true
ProtectSystem=full
ProtectHome=true
ReadWritePaths=/opt/da-invent

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now da-invent
sleep 4
systemctl is-active da-invent
curl -fsS http://localhost:3001/api/version
```

## 7. HTTPS reverse proxy (5 min, opzionale ma raccomandato)

```bash
apt-get install -y nginx
cat >/etc/nginx/sites-available/da-invent <<'EOF'
server {
    listen 80;
    listen 443 ssl;
    server_name _;
    ssl_certificate /etc/ssl/certs/ssl-cert-snakeoil.pem;
    ssl_certificate_key /etc/ssl/private/ssl-cert-snakeoil.key;
    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
    }
}
EOF
ln -sf /etc/nginx/sites-available/da-invent /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
```

## 8. Tailscale (3 min)

```bash
curl -fsSL https://tailscale.com/install.sh | sh
tailscale up --reset \
  --authkey=tskey-auth-NEW_KEY_HERE \
  --advertise-tags=tag:da-hub \
  --hostname=da-invent \
  --ssh \
  --accept-dns=true
tailscale ip -4
```

## 9. Setup admin user (2 min)

Apri `https://<tailscale-ip>` o `https://<lan-ip>` nel browser:

- La prima visita reindirizza a `/setup`
- Crea il primo utente admin (username + password ≥8 char)
- Login post-setup

## 10. Configurazione PUBLIC_HUB_URL (1 min)

Dalla UI: **Impostazioni** → **Hub URL pubblico**:
- Settare **Hostname Tailscale (fallback)** = `da-invent`
- Salva

Da ora il wizard `/agents` userà `https://da-invent` nel one-liner.

## 11. Verifica end-to-end

```bash
# Da SSH sul nuovo hub:
systemctl is-active da-invent       # active
curl -fsS http://localhost:3001/api/version
curl -fsSk https://localhost
journalctl -u da-invent -n 30 --no-pager

# Da una macchina admin in tailnet:
curl -fsS https://da-invent/api/version
ssh root@da-invent
```

## 12. Hardening produzione (opzionale ma raccomandato)

```bash
# Firewall: solo SSH (22) e HTTPS (443) accettati su LAN, tutto su tailnet
ufw default deny incoming
ufw default allow outgoing
ufw allow from 100.64.0.0/10 to any              # tutto da tailnet
ufw allow 22/tcp
ufw allow 443/tcp
ufw --force enable

# Disable login password (solo chiavi)
sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl restart sshd
```

## Checklist finale

- [ ] VM ricavata con almeno 4G RAM 30G disco
- [ ] Node 22 + system deps installati
- [ ] `/opt/da-invent` git clone, branch corretto
- [ ] `.env.local` con ENCRYPTION_KEY e AUTH_SECRET random
- [ ] **ENCRYPTION_KEY salvata in Keeper**
- [ ] systemd unit attivo, /api/version risponde
- [ ] HTTPS reverse proxy attivo
- [ ] Tailscale up con `tag:da-hub` e hostname stabile
- [ ] Admin user creato via /setup
- [ ] PUBLIC_HUB_URL settato in UI
- [ ] Firewall UFW attivo, password ssh disabilitato
- [ ] Verifica E2E: UI accessibile, /api/version risponde

## Per DA-Vul-can (variante)

Stessa procedura con sostituzioni:
- Repo: `https://github.com/grandir66/DA-Vul-can.git`
- Path: `/opt/da-vulcan`
- Service: `da-vulcan.service`
- Tag Tailscale: `tag:da-hub` (stesso)
- Hostname Tailscale: `da-vulcan`
- Porta: 3002 (default DA-Vul-can)
- System deps aggiuntive: `python3-lxml python3-docx` (sidecar Python per .docx)
- `.env.local` aggiuntivo: `ANTHROPIC_API_KEY=sk-...`
