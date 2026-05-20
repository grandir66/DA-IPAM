#!/bin/bash
# DA-INVENT — Auto-update guidato da timer systemd.
#
# Strategia "appliance sempre allineata a main, no-op se già in pari":
#   1. forza il branch target (default: main, override DA_INVENT_BRANCH)
#      — se la working tree è su un altro branch, checkout
#      — se ci sono modifiche locali su tracked files, reset --hard (appliance
#        immutable: i file tracked non vanno modificati a mano)
#   2. git fetch + confronto con origin/<branch>
#   3. se HEAD locale == origin/<branch> → esci 0 (NESSUN build, NESSUN restart)
#   4. altrimenti → delega a update.sh --restart (pull + npm install + build + restart)
#
# Lock con flock per evitare run sovrapposti. Output → journald (systemd).
# Override branch con DA_INVENT_BRANCH; directory con DA_INVENT_DIR.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
APP_DIR="${DA_INVENT_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
cd "$APP_DIR"

if [ ! -d .git ]; then
  echo "[auto-update] '$APP_DIR' non è un repo Git: skip (installazione non-git)."
  exit 0
fi

# Lock: un solo auto-update per volta
LOCK="/tmp/da-invent-auto-update.lock"
exec 9>"$LOCK"
if ! flock -n 9; then
  echo "[auto-update] un altro update è già in corso: skip."
  exit 0
fi

BRANCH="${DA_INVENT_BRANCH:-main}"
CURRENT="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")"

# Fetch sempre, così abbiamo origin/<branch> disponibile per checkout
git fetch --quiet origin "$BRANCH" || { echo "[auto-update] git fetch fallito, riprovo al prossimo tick."; exit 0; }

if [ "$CURRENT" != "$BRANCH" ]; then
  echo "[auto-update] branch corrente '$CURRENT' != target '$BRANCH': checkout in corso..."
  # Drift su tracked files: hard-reset (le appliance non devono avere mod locali;
  # data/, .env.local, tenants/ sono in .gitignore e non vengono toccati)
  if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
    echo "[auto-update] modifiche locali su tracked files: reset --hard per allineare l'appliance."
    git reset --hard HEAD
  fi
  git checkout -B "$BRANCH" "origin/$BRANCH"
fi

echo "[auto-update] $(date -Is) — branch $BRANCH"

LOCAL="$(git rev-parse HEAD)"
REMOTE="$(git rev-parse "origin/$BRANCH")"

if [ "$LOCAL" = "$REMOTE" ]; then
  echo "[auto-update] già aggiornato ($(git rev-parse --short HEAD)). Nessun downtime."
  exit 0
fi

echo "[auto-update] nuovo commit su origin/$BRANCH ($(git rev-parse --short "$REMOTE")): aggiorno..."
exec "$SCRIPT_DIR/update.sh" --restart
