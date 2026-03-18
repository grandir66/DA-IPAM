#!/bin/bash
# DA-INVENT — Aggiornamento via Git pull
# Esegue: git pull, npm install, build, restart servizio
# Uso: ./scripts/update.sh [--restart]

set -e

RESTART=false
for arg in "$@"; do
  [[ "$arg" == "--restart" ]] && RESTART=true
done

APP_DIR="${DA_INVENT_DIR:-$(pwd)}"
cd "$APP_DIR"

echo "=== DA-INVENT Update ==="
echo "Directory: $APP_DIR"
echo ""

# Verifica che sia un repo git
if [ ! -d .git ]; then
  echo "Errore: non è un repository Git."
  exit 1
fi

# Salva branch corrente
BRANCH=$(git rev-parse --abbrev-ref HEAD)
echo ">>> Branch: $BRANCH"

# Pull
echo ">>> git pull..."
git pull origin "$BRANCH"

# npm install
echo ">>> npm install..."
npm install

# Build
echo ">>> npm run build..."
npm run build

# Restart servizio systemd (se richiesto)
if [ "$RESTART" = true ]; then
  if systemctl is-active --quiet da-invent 2>/dev/null; then
    echo ">>> systemctl restart da-invent..."
    sudo systemctl restart da-invent
    echo "    Servizio riavviato."
  else
    echo ">>> Servizio da-invent non attivo, skip restart."
  fi
fi

# Mostra versione aggiornata
VERSION=$(node -e "console.log(require('./package.json').version)")
echo ""
echo "=== Aggiornamento completato ==="
echo "Versione: $VERSION"
echo ""
