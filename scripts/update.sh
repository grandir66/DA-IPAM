#!/bin/bash
# DA-INVENT — Aggiornamento via Git pull
# Esegue: git pull, npm install, build, restart servizio
# Uso: ./scripts/update.sh [--restart]

set -e

RESTART=false
for arg in "$@"; do
  [[ "$arg" == "--restart" ]] && RESTART=true
done

# Risolve la root del repo dalla posizione dello script (scripts/..), così
# `update.sh` funziona anche invocato per path assoluto via `pct exec` (CWD=/root)
# o da qualsiasi directory. Override esplicito con DA_INVENT_DIR.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
APP_DIR="${DA_INVENT_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
cd "$APP_DIR"

echo "=== DA-INVENT Update ==="
echo "Directory: $APP_DIR"
echo ""

# Verifica che sia un repo git
if [ ! -d .git ]; then
  echo "Errore: '$APP_DIR' non è un repository Git."
  echo "       L'app non è stata installata via 'git clone'. Recupero possibile:"
  echo "       cd $APP_DIR && git init && git remote add origin https://github.com/grandir66/DA-IPAM.git && git fetch origin main && git reset --hard origin/main"
  exit 1
fi

# Target branch dell'appliance (default: main). Override con DA_INVENT_BRANCH.
# Se il branch corrente è diverso, allinea (auto-update.sh fa già il checkout
# preventivo, ma update.sh può essere invocato a mano e va comunque convergere).
BRANCH="${DA_INVENT_BRANCH:-main}"
CURRENT=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
if [ "$CURRENT" != "$BRANCH" ]; then
  echo ">>> Branch corrente '$CURRENT' != target '$BRANCH': allineo..."
  git fetch origin "$BRANCH"
  git checkout -B "$BRANCH" "origin/$BRANCH"
fi
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

# Pulizia residui debug noti (script temporanei lasciati dietro da sessioni
# precedenti che non sono mai stati committati e bloccano il pull).
DEBUG_RESIDUE=(scripts/probe-debug.ts scripts/wazuh-debug.ts)
for f in "${DEBUG_RESIDUE[@]}"; do
  if [ -f "$f" ] && ! git ls-files --error-unmatch "$f" >/dev/null 2>&1; then
    echo ">>> rimuovo residuo debug non tracciato: $f"
    rm -f "$f"
  elif [ -n "$(git status --porcelain -- "$f" 2>/dev/null)" ]; then
    echo ">>> $f modificato localmente: ripristino da Git..."
    git restore "$f" 2>/dev/null || rm -f "$f"
  fi
done

# Stash di sicurezza per QUALSIASI altra modifica locale non gestita sopra:
# il pull non deve mai abortire silenziosamente in autoupdate. Lo stash è
# taggato con timestamp ed è recuperabile manualmente (`git stash list`).
DIRTY=$(git status --porcelain 2>/dev/null | head -c 1)
if [ -n "$DIRTY" ]; then
  STAMP=$(date +%Y%m%d-%H%M%S)
  echo ">>> Modifiche locali rilevate: stash automatico 'autoupdate-$STAMP'"
  echo ">>> File interessati:"
  git status --porcelain | sed 's/^/    /' | head -20
  git stash push -u -m "autoupdate-$STAMP" || {
    echo "Errore: stash fallito. Pulisci manualmente: 'git status' e 'git restore' / 'rm'."
    exit 1
  }
fi

# Pull
echo ">>> git pull..."
git pull origin "$BRANCH"

# npm install: --include=dev forza l'installazione delle devDependencies
# anche con NODE_ENV=production (presente in .env.local del service). Servono
# comunque al build successivo (TypeScript/tailwind) e a `patch-package`, che
# gira come postinstall per patchare httpntlm.
echo ">>> npm install --include=dev..."
npm install --include=dev

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
