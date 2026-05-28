#!/bin/bash
# DA-INVENT — Installer per LXC/Proxmox e Debian/Ubuntu
# Uso: ./scripts/install.sh [--systemd]
#
# Installa tutte le dipendenze di sistema (apt), Node.js 20+, dipendenze npm e build.
# Per clone automatico su Linux senza Proxmox: scripts/bootstrap-linux.sh
# Per wizard LXC su nodo Proxmox: scripts/proxmox-lxc-install.sh (o bootstrap-proxmox.sh)

set -e

SCRIPT_ARGS=("$@")

INSTALL_SYSTEMD=false
for arg in "$@"; do
  [[ "$arg" == "--systemd" ]] && INSTALL_SYSTEMD=true
done

APP_NAME="da-invent"
APP_USER="${DA_INVENT_USER:-da-invent}"
# Utente systemd: default **root** (container/LXC) per nmap UDP (-sU) e ping raw.
# Per servizio non privilegiato: DA_INVENT_SERVICE_USER=da-invent + capability (vedi README).
SERVICE_USER="${DA_INVENT_SERVICE_USER:-root}"
SERVICE_GROUP="${DA_INVENT_SERVICE_GROUP:-$SERVICE_USER}"
APP_DIR="${DA_INVENT_DIR:-$(pwd)}"
PORT="${PORT:-3001}"

echo "=== DA-INVENT Installer ==="
echo "Directory: $APP_DIR"
echo "Porta: $PORT"
echo ""

# Rileva OS
if [ -f /etc/os-release ]; then
  . /etc/os-release
  OS=$ID
  VERSION=${VERSION_ID:-}
else
  echo "Impossibile rilevare il sistema operativo."
  exit 1
fi

# Installa dipendenze di sistema (Debian/Ubuntu / container LXC)
# Inclusi header e toolchain per moduli nativi npm: better-sqlite3, bcrypt, ssh2, net-snmp, oui
install_system_deps() {
  echo ">>> Installazione dipendenze di sistema..."
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq \
    ca-certificates \
    curl \
    git \
    openssl \
    build-essential \
    pkg-config \
    python3 \
    python3-venv \
    python3-pip \
    net-tools \
    nmap \
    snmp \
    iputils-ping \
    sqlite3 \
    libssl-dev \
    libsqlite3-dev \
    libsnmp-dev \
    libkrb5-dev \
    krb5-config \
    krb5-user \
    libffi-dev
  echo "    Dipendenze installate (toolchain, SNMP client, nmap, ping, Kerberos; librerie per build npm e gssapi)."
}

# Installa Node.js 20 LTS se non presente
install_node() {
  if command -v node &>/dev/null; then
    NODE_VER=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$NODE_VER" -ge 20 ]; then
      echo ">>> Node.js $(node -v) già presente."
      return
    fi
    if [ "$(id -u)" -ne 0 ]; then
      echo "Errore: richiesto Node.js 20+ (trovato $(node -v)). Esegui come root: sudo $0 ${SCRIPT_ARGS[*]}"
      exit 1
    fi
  fi

  if [ "$(id -u)" -ne 0 ]; then
    echo "Errore: Node.js 20+ assente. Esegui l'installer come root: sudo $0 ${SCRIPT_ARGS[*]}"
    exit 1
  fi

  echo ">>> Installazione Node.js 20 LTS..."
  export DEBIAN_FRONTEND=noninteractive
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y -qq nodejs
  echo "    Node.js $(node -v) installato."
}

# Setup Python venv per WinRM (pywinrm + Kerberos via gssapi)
# Richiede pacchetti di sistema: libkrb5-dev, krb5-config, libffi-dev, build-essential, python3-dev
# (installati da install_system_deps).
setup_winrm_venv() {
  local venv_dir="$HOME/.da-invent-venv"
  if [ ! -f "$venv_dir/bin/python3" ]; then
    echo ">>> Creazione venv Python per WinRM..."
    python3 -m venv "$venv_dir" || {
      echo "    Errore: creazione venv fallita. Installa python3-venv (apt-get install python3-venv)."
      return 1
    }
  fi
  if [ ! -f "$venv_dir/bin/pip" ]; then
    echo "    Errore: pip non disponibile nel venv $venv_dir."
    return 1
  fi
  echo ">>> Installazione pywinrm + dipendenze Kerberos nel venv..."
  "$venv_dir/bin/pip" install --quiet --upgrade pip
  if "$venv_dir/bin/pip" install --quiet pywinrm requests-ntlm requests-credssp gssapi; then
    echo "    Venv WinRM pronto in $venv_dir (pywinrm + gssapi/Kerberos)."
  else
    echo "    Avviso: build di gssapi fallita. WinRM funziona via NTLM/CredSSP, ma Kerberos non è disponibile."
    echo "    Per abilitare Kerberos: apt-get install libkrb5-dev krb5-config krb5-user libffi-dev e rilancia l'installer."
    "$venv_dir/bin/pip" install --quiet pywinrm requests-ntlm requests-credssp || {
      echo "    Errore: anche l'install minimale di pywinrm è fallita."
      return 1
    }
  fi

  # impacket: fallback WMI/DCOM (porta 135) quando WinRM (5985/5986) è disabilitato sul target.
  # Modalità degradata: recupera OS, hardware, rete, hotfix, antivirus — niente registry né AD.
  echo ">>> Installazione impacket nel venv (fallback WMI/DCOM)..."
  if "$venv_dir/bin/pip" install --quiet impacket; then
    echo "    impacket pronto: fallback WMI disponibile su porta 135."
  else
    echo "    Avviso: install di impacket fallito. Il fallback WMI non sarà disponibile;"
    echo "    DA-IPAM continuerà a funzionare via WinRM dove configurato."
  fi
}

# npm install e build
build_app() {
  echo ">>> Installazione dipendenze npm..."
  npm ci 2>/dev/null || npm install
  echo ">>> Build produzione..."
  npm run build
  echo "    Build completata."
}

# Auth.js: senza AUTH_URL fisso l'app accetta qualsiasi Host (IP LAN, DHCP, hostname).
# trustHost è già true in codice; AUTH_TRUST_HOST=true nel .env rende esplicito il comportamento.
# Solo per URL pubblico canonico (es. https://invent.esempio.it dietro proxy): export DA_INVENT_AUTH_URL=...
# Non impostiamo più AUTH_URL dall'IP rilevato — con IP dinamico i cookie/callback andavano fuori sync.
fixed_auth_url_from_env() {
  if [ -n "${DA_INVENT_AUTH_URL:-}" ]; then
    echo "$DA_INVENT_AUTH_URL"
  fi
}

# Crea .env.local se non esiste
setup_env() {
  local env_file="$APP_DIR/.env.local"
  local auth_url
  auth_url="$(fixed_auth_url_from_env)"

  if [ ! -f "$env_file" ] || ! grep -q "ENCRYPTION_KEY" "$env_file" 2>/dev/null; then
    echo ">>> Generazione .env.local..."
    local key=$(openssl rand -hex 32)
    local secret=$(openssl rand -hex 32)
    # Password Domarc: 20 caratteri alfanumerici casuali
    local domarc_pass=$(openssl rand -base64 20 | tr -dc 'A-Za-z0-9' | head -c 20)
    {
      echo "# DA-INVENT — generato dall'installer"
      echo "ENCRYPTION_KEY=$key"
      echo "AUTH_SECRET=$secret"
      echo "PORT=$PORT"
      echo "NODE_ENV=production"
      echo ""
      echo "# Auth.js: accesso da qualsiasi IP/hostname (LAN, container DHCP). Opzionale URL fisso: DA_INVENT_AUTH_URL=..."
      echo "AUTH_TRUST_HOST=true"
      echo ""
      echo "# Utente di servizio Domarc (accesso superadmin incondizionato)"
      echo "DOMARC_USERNAME=domarc"
      echo "DOMARC_PASSWORD=$domarc_pass"
      if [ -n "$auth_url" ]; then
        echo "AUTH_URL=$auth_url"
      fi
    } > "$env_file"
    chmod 600 "$env_file"
    echo ""
    echo "    ╔══════════════════════════════════════════════════════════════╗"
    echo "    ║  UTENTE DI SERVIZIO DOMARC                                 ║"
    echo "    ║  Username: domarc                                          ║"
    echo "    ║  Password: $domarc_pass                     ║"
    echo "    ║                                                            ║"
    echo "    ║  ANNOTARE QUESTA PASSWORD — non sarà più visualizzata.     ║"
    echo "    ╚══════════════════════════════════════════════════════════════╝"
    echo ""
    if [ -n "$auth_url" ]; then
      echo "    .env.local creato (AUTH_TRUST_HOST=true, AUTH_URL=$auth_url da DA_INVENT_AUTH_URL). Completare il setup dalla UI al primo avvio."
    else
      echo "    .env.local creato (AUTH_TRUST_HOST=true, nessun AUTH_URL fisso — ok con IP dinamico). Completare il setup dalla UI al primo avvio."
    fi
  else
    echo ">>> .env.local già presente."
    if ! grep -qE '^[[:space:]]*AUTH_TRUST_HOST=' "$env_file" 2>/dev/null; then
      echo "AUTH_TRUST_HOST=true" >> "$env_file"
      chmod 600 "$env_file"
      echo "    Aggiunto AUTH_TRUST_HOST=true (accesso da qualsiasi host/IP; rimuovi o aggiorna AUTH_URL se era legato a un IP vecchio)."
    fi
  fi
}

# Installa servizio systemd
install_systemd_service() {
  if [ "$INSTALL_SYSTEMD" != "true" ]; then
    echo ">>> Salto installazione systemd (usa --systemd per abilitare)."
    return
  fi

  if [ "$(id -u)" -ne 0 ]; then
    echo ">>> Installazione systemd richiede sudo. Esegui: sudo $0 --systemd"
    return
  fi

  echo ">>> Installazione servizio systemd (utente: $SERVICE_USER)..."
  local service_file="/etc/systemd/system/${APP_NAME}.service"
  cat > "$service_file" << EOF
[Unit]
Description=DA-INVENT - IP Address Management
After=network.target

[Service]
Type=simple
User=$SERVICE_USER
Group=$SERVICE_GROUP
WorkingDirectory=$APP_DIR
Environment=NODE_ENV=production
Environment=PORT=$PORT
EnvironmentFile=$APP_DIR/.env.local
ExecStart=$(which node) $APP_DIR/node_modules/next/dist/bin/next start -p $PORT -H 0.0.0.0
Restart=on-failure
RestartSec=5
# No PrivateTmp: su molti LXC/Proxmox CT systemd fallisce con status=226/NAMESPACE
# (mount namespace non applicabile o in conflitto con il CT).

[Install]
WantedBy=multi-user.target
EOF

  # Usa tsx per server.ts (cron + Next.js)
  local tsx_path="$APP_DIR/node_modules/.bin/tsx"
  [ -x "$tsx_path" ] || { echo "    Errore: tsx non trovato. Esegui npm install."; return 1; }
  sed -i "s|ExecStart=.*|ExecStart=$tsx_path $APP_DIR/server.ts|" "$service_file"

  systemctl daemon-reload
  # enable = avvio al boot; --now = avvia anche subito (evita stato inactive fino al primo reboot)
  systemctl enable --now "$APP_NAME"
  echo "    Servizio installato, abilitato al boot e avviato (systemctl enable --now)."

  # ── Auto-update: timer systemd ogni 15 min (no-op se già allineato) ───────
  echo ">>> Installazione auto-update (timer systemd)..."
  cat > "/etc/systemd/system/${APP_NAME}-update.service" << EOF
[Unit]
Description=DA-INVENT auto-update (enforce branch=main + git pull + build + restart se ci sono novità)
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=$SERVICE_USER
Group=$SERVICE_GROUP
WorkingDirectory=$APP_DIR
EnvironmentFile=-$APP_DIR/.env.local
ExecStart=/bin/bash $APP_DIR/scripts/auto-update.sh
TimeoutStartSec=1800
EOF
  cat > "/etc/systemd/system/${APP_NAME}-update.timer" << EOF
[Unit]
Description=DA-INVENT auto-update (ogni 15 min, no-op se già allineato)

[Timer]
# Cadenza fitta: il check è quasi gratis (git fetch + rev-parse). Build/restart
# avvengono SOLO se origin/main ha un commit nuovo, quindi le release pushate
# su main arrivano in produzione entro ~15 minuti senza intervento manuale.
OnBootSec=2min
OnUnitActiveSec=15min
RandomizedDelaySec=60
Persistent=true
Unit=${APP_NAME}-update.service

[Install]
WantedBy=timers.target
EOF
  systemctl daemon-reload
  systemctl enable --now "${APP_NAME}-update.timer"
  echo "    Auto-update attivo: ogni 15 min, branch=main forzato. Build/restart SOLO se origin ha commit nuovi."
  echo "    Forzare ora:  systemctl start ${APP_NAME}-update.service && journalctl -u ${APP_NAME}-update -f"
}

# Main
cd "$APP_DIR"

if [ "$(id -u)" -ne 0 ]; then
  echo "Avviso: esecuzione senza root — le dipendenze di sistema (apt) non sono state installate."
  echo "         Per un deploy completo: sudo $0 ${SCRIPT_ARGS[*]}"
  echo ""
fi

if [ "$(id -u)" -eq 0 ]; then
  install_system_deps
  install_node
  # Venv pywinrm anche per root (deploy tipico LXC): altrimenti WinRM dal server non funziona.
  setup_winrm_venv
else
  install_node
  setup_winrm_venv
fi

build_app
setup_env
install_systemd_service

echo ""
echo "=== Installazione completata ==="
echo ""
echo "Avvio rapido (senza systemd):"
echo "  cd $APP_DIR && npm run start"
echo ""
echo "Con systemd (se installato con --systemd) il servizio è già stato avviato; stato:"
echo "  systemctl status da-invent"
echo ""
echo "Accedi a: http://<indirizzo-ip>:$PORT"
echo "Al primo avvio completa il setup dalla pagina /setup"
echo ""
echo "WinRM verso host Windows: venv pywinrm in \$HOME/.da-invent-venv (Kerberos via gssapi se libkrb5-dev presente)."
echo "Fallback WMI/DCOM su porta 135 via impacket (modalità degradata se WinRM è chiuso sul target)."
echo "Se la scansione WinRM/WMI fallisce, ricrea il venv:"
echo "  rm -rf ~/.da-invent-venv && python3 -m venv ~/.da-invent-venv && \\"
echo "    ~/.da-invent-venv/bin/pip install pywinrm requests-ntlm requests-credssp gssapi impacket"
echo ""
