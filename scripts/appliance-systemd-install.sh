#!/usr/bin/env bash
# Installa DA-IPAM su VM appliance-stack in modalità systemd + git (auto-update).
# LibreNMS / Scanner-Edge / Greenbone restano Docker; solo da-ipam esce dal container.
#
# Prerequisiti: root, Node 22, git, VM con /opt/appliance-stack e volume /data.
#
# Uso:
#   sudo DA_INVENT_BRANCH=dev bash scripts/appliance-systemd-install.sh
#
# Idempotente: ri-eseguire aggiorna git + build + restart systemd.
set -euo pipefail

APP_DIR="${DA_INVENT_DIR:-/opt/da-ipam}"
DATA_DIR="${DA_INVENT_DATA_DIR:-/data}"
REPO="${DA_INVENT_REPO:-https://github.com/grandir66/DA-IPAM.git}"
BRANCH="${DA_INVENT_BRANCH:-dev}"
COMPOSE_DIR="${APPLIANCE_STACK_DIR:-/opt/appliance-stack}"
SERVICE="da-invent"

if [ "$(id -u)" -ne 0 ]; then
  echo "Esegui come root (sudo)." >&2
  exit 1
fi

echo "=== DA-IPAM appliance → systemd + git ==="
echo "APP_DIR=$APP_DIR  DATA_DIR=$DATA_DIR  BRANCH=$BRANCH"

command -v node >/dev/null || { echo "Node.js mancante." >&2; exit 1; }
command -v git >/dev/null || { echo "git mancante." >&2; exit 1; }

NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
if [ "$NODE_MAJOR" -lt 20 ] || [ "$NODE_MAJOR" -ge 25 ]; then
  echo "Node $NODE_MAJOR non supportato — usa Node 22 LTS." >&2
  exit 1
fi

# Ferma container Docker (stessa porta 3001)
if command -v docker >/dev/null && [ -d "$COMPOSE_DIR" ]; then
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx 'appliance-ipam'; then
    echo ">>> Stop container appliance-ipam..."
    (cd "$COMPOSE_DIR" && docker compose stop da-ipam) || docker stop appliance-ipam || true
  fi
fi

mkdir -p "$DATA_DIR" "$APP_DIR"

if [ ! -d "$APP_DIR/.git" ]; then
  echo ">>> git clone $REPO → $APP_DIR (branch $BRANCH)..."
  git clone --branch "$BRANCH" --depth 1 "$REPO" "$APP_DIR"
else
  echo ">>> git fetch + reset $BRANCH..."
  git -C "$APP_DIR" fetch origin "$BRANCH"
  git -C "$APP_DIR" checkout -B "$BRANCH" "origin/$BRANCH"
  git -C "$APP_DIR" reset --hard "origin/$BRANCH"
fi

SECRETS="$DATA_DIR/.env.local"
if [ ! -f "$SECRETS" ]; then
  echo "ERRORE: $SECRETS mancante — segreti appliance (ENCRYPTION_KEY, AUTH_SECRET)." >&2
  exit 1
fi

# Branch canale + data dir persistente (parità container)
if grep -qE '^\s*DA_INVENT_BRANCH=' "$SECRETS" 2>/dev/null; then
  sed -i "s/^DA_INVENT_BRANCH=.*/DA_INVENT_BRANCH=$BRANCH/" "$SECRETS"
else
  echo "DA_INVENT_BRANCH=$BRANCH" >> "$SECRETS"
fi
if ! grep -qE '^\s*DA_INVENT_DATA_DIR=' "$SECRETS" 2>/dev/null; then
  echo "DA_INVENT_DATA_DIR=$DATA_DIR" >> "$SECRETS"
fi
# Rimuovi flag container — siamo systemd
sed -i '/^DA_INVENT_CONTAINER=/d' "$SECRETS" 2>/dev/null || true

ln -sfn "$SECRETS" "$APP_DIR/.env.local"
ln -sfn "$DATA_DIR" "$APP_DIR/data"
chmod 600 "$SECRETS"

echo ">>> npm install + build..."
cd "$APP_DIR"
npm install --include=dev --no-audit --no-fund
bash scripts/setup-winrm-venv.sh
npm run build

echo ">>> systemd + auto-update timer..."
export DA_INVENT_DIR="$APP_DIR"
bash scripts/install.sh --systemd

systemctl enable "${SERVICE}-update.timer" 2>/dev/null || true
systemctl start "${SERVICE}-update.timer" 2>/dev/null || true

if systemctl is-active --quiet "$SERVICE"; then
  systemctl restart "$SERVICE"
else
  systemctl start "$SERVICE"
fi

VERSION="$(node -p "require('./package.json').version")"
SHORT="$(git -C "$APP_DIR" rev-parse --short HEAD)"

echo ""
echo "=== OK — DA-IPAM systemd ==="
echo "Versione: v$VERSION ($SHORT)"
echo "Servizio: systemctl status $SERVICE"
echo "Auto-update: systemctl status ${SERVICE}-update.timer"
echo ""
echo "Verifica: curl -s http://127.0.0.1:3001/api/health"
echo "Per disabilitare il vecchio servizio Docker, commenta 'da-ipam' in $COMPOSE_DIR/compose.yml"
