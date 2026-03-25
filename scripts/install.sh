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
    libsnmp-dev
  echo "    Dipendenze installate (toolchain, SNMP client, nmap, ping; librerie per build npm)."
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

# Setup Python venv per WinRM (opzionale)
setup_winrm_venv() {
  local venv_dir="$HOME/.da-invent-venv"
  if [ ! -f "$venv_dir/bin/python3" ]; then
    echo ">>> Creazione venv Python per WinRM (opzionale)..."
    python3 -m venv "$venv_dir" 2>/dev/null || true
    if [ -f "$venv_dir/bin/pip" ]; then
      "$venv_dir/bin/pip" install --quiet pywinrm requests-ntlm requests-credssp gssapi 2>/dev/null || true
      echo "    Venv WinRM creato in $venv_dir"
    fi
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

# URL per Auth.js (evita callback con 0.0.0.0 quando il servizio ascolta su tutte le interfacce).
# Override: DA_INVENT_AUTH_URL=https://esempio.it  —  altrimenti prima IPv4 non-loopback rilevata.
compute_auth_url() {
  if [ -n "${DA_INVENT_AUTH_URL:-}" ]; then
    echo "$DA_INVENT_AUTH_URL"
    return
  fi
  local ip=""
  ip=$(hostname -I 2>/dev/null | tr ' ' '\n' | grep -E '^[0-9]{1,3}(\.[0-9]{1,3}){3}$' | grep -v '^127\.' | head -1)
  if [ -z "$ip" ]; then
    ip=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i=1; i<=NF; i++) if ($i=="src") { print $(i+1); exit }}')
  fi
  if [ -z "$ip" ] || [ "$ip" = "127.0.0.1" ]; then
    echo ""
    return
  fi
  echo "http://${ip}:${PORT}"
}

# Crea .env.local se non esiste
setup_env() {
  local env_file="$APP_DIR/.env.local"
  local auth_url
  auth_url="$(compute_auth_url)"

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
      echo "    .env.local creato (AUTH_URL=$auth_url). Completare il setup dalla UI al primo avvio."
    else
      echo "    .env.local creato (AUTH_URL non impostato). Completare il setup dalla UI al primo avvio."
    fi
  else
    echo ">>> .env.local già presente."
    if [ -n "$auth_url" ] && ! grep -qE '^[[:space:]]*AUTH_URL=' "$env_file" 2>/dev/null; then
      echo "AUTH_URL=$auth_url" >> "$env_file"
      chmod 600 "$env_file"
      echo "    Aggiunto AUTH_URL=$auth_url (accesso da rete)."
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
echo "WinRM verso host Windows: richiede Python + pywinrm sul server (venv in \$HOME/.da-invent-venv)."
echo "Se la scansione WinRM fallisce: verifica che il venv esista o esegui"
echo "  python3 -m venv ~/.da-invent-venv && ~/.da-invent-venv/bin/pip install pywinrm requests-ntlm requests-credssp gssapi"
echo ""
