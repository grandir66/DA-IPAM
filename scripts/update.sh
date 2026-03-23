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

# In produzione npm install/version:bump possono modificare file gestiti da Git
# (package-lock.json, package.json, VERSION). Ripristiniamo da HEAD per evitare conflitti.
RESTORE_FILES=(package-lock.json package.json VERSION)
for f in "${RESTORE_FILES[@]}"; do
  if [ -n "$(git status --porcelain -- "$f" 2>/dev/null)" ]; then
    echo ">>> $f modificato localmente: ripristino da Git prima del pull..."
    git restore "$f" 2>/dev/null || git checkout -- "$f"
  fi
done

# Pull
echo ">>> git pull..."
git pull origin "$BRANCH"

# npm install
echo ">>> npm install..."
npm install

# Venv Python WinRM (stesso set di install.sh): aggiorna dopo git pull
if [ -f "${HOME}/.da-invent-venv/bin/pip" ]; then
  echo ">>> pip WinRM (venv ~/.da-invent-venv)..."
  "${HOME}/.da-invent-venv/bin/pip" install -q -U pywinrm requests-ntlm requests-credssp gssapi 2>/dev/null || true
fi

# Build
echo ">>> npm run build..."
npm run build

# Restart servizio systemd (se richiesto)
# In LXC Debian minimale spesso non c'è `sudo`; come root usare systemctl diretto.
restart_service() {
  if [ "$(id -u)" -eq 0 ]; then
    systemctl restart da-invent
  elif command -v sudo >/dev/null 2>&1; then
    sudo systemctl restart da-invent
  else
    echo "Errore: servizio da riavviare ma né root né sudo disponibili."
    return 1
  fi
}

if [ "$RESTART" = true ]; then
  if systemctl is-active --quiet da-invent 2>/dev/null; then
    echo ">>> systemctl restart da-invent..."
    restart_service
    echo "    Servizio riavviato."
  else
    echo ">>> Servizio da-invent non attivo, skip restart."
  fi
fi

# Mostra versione e commit (la versione è quella nel package.json dopo git pull = branch remoto)
VERSION=$(node -e "console.log(require('./package.json').version)")
SHORT=$(git rev-parse --short HEAD 2>/dev/null || echo "?")
SUBJECT=$(git log -1 --format=%s 2>/dev/null || echo "")
echo ""
echo "=== Aggiornamento completato ==="
echo "Versione package.json: $VERSION"
echo "Commit installato: $SHORT"
if [ -n "$SUBJECT" ]; then
  echo "Ultimo commit: $SUBJECT"
fi
echo ""
echo "Nota: git pull porta solo ciò che è su GitHub (branch corrente). Se la versione non sale,"
echo "      su origin non c'è ancora un commit più nuovo, oppure non sei sul branch giusto."
echo ""
