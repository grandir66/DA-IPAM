#!/bin/bash
# DA-INVENT — Installer per LXC/Proxmox e Debian/Ubuntu
# Uso: ./scripts/install.sh [--systemd]

set -e

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

# Installa dipendenze di sistema (Debian/Ubuntu)
install_system_deps() {
  echo ">>> Installazione dipendenze di sistema..."
  apt-get update -qq
  apt-get install -y -qq \
    curl \
    build-essential \
    python3 \
    python3-venv \
    python3-pip \
    net-tools \
    nmap \
    sqlite3 \
    > /dev/null 2>&1 || true
  echo "    Dipendenze installate."
}

# Installa Node.js 20 LTS se non presente
install_node() {
  if command -v node &>/dev/null; then
    NODE_VER=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$NODE_VER" -ge 20 ]; then
      echo ">>> Node.js $(node -v) già presente."
      return
    fi
  fi

  echo ">>> Installazione Node.js 20 LTS..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - > /dev/null 2>&1
  apt-get install -y -qq nodejs > /dev/null 2>&1
  echo "    Node.js $(node -v) installato."
}

# Setup Python venv per WinRM (opzionale)
setup_winrm_venv() {
  local venv_dir="$HOME/.da-invent-venv"
  if [ ! -f "$venv_dir/bin/python3" ]; then
    echo ">>> Creazione venv Python per WinRM (opzionale)..."
    python3 -m venv "$venv_dir" 2>/dev/null || true
    if [ -f "$venv_dir/bin/pip" ]; then
      "$venv_dir/bin/pip" install --quiet pywinrm requests-ntlm 2>/dev/null || true
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

# Crea .env.local se non esiste
setup_env() {
  local env_file="$APP_DIR/.env.local"
  if [ ! -f "$env_file" ] || ! grep -q "ENCRYPTION_KEY" "$env_file" 2>/dev/null; then
    echo ">>> Generazione .env.local..."
    local key=$(openssl rand -hex 32)
    local secret=$(openssl rand -hex 32)
    cat > "$env_file" << EOF
# DA-INVENT — generato dall'installer
ENCRYPTION_KEY=$key
AUTH_SECRET=$secret
PORT=$PORT
NODE_ENV=production
EOF
    chmod 600 "$env_file"
    echo "    .env.local creato. Completare il setup dalla UI al primo avvio."
  else
    echo ">>> .env.local già presente."
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
PrivateTmp=true

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

if [ "$(id -u)" -eq 0 ]; then
  install_system_deps
  install_node
  # setup_winrm_venv va fatto come utente finale
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
