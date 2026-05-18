#!/bin/bash
# DA-INVENT — Auto-update guidato da timer systemd.
#
# Invocato da da-invent-update.timer. Strategia "no-op se già aggiornato":
#   1. git fetch del branch corrente
#   2. se HEAD locale == origin/<branch> → esci 0 (NESSUN build, NESSUN restart:
#      zero downtime quando non c'è nulla di nuovo)
#   3. altrimenti → delega a update.sh --restart (pull + npm install + build + restart)
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

BRANCH="${DA_INVENT_BRANCH:-$(git rev-parse --abbrev-ref HEAD)}"
echo "[auto-update] $(date -Is) — branch $BRANCH, fetch origin..."
git fetch --quiet origin "$BRANCH" || { echo "[auto-update] git fetch fallito, riprovo al prossimo tick."; exit 0; }

LOCAL="$(git rev-parse HEAD)"
REMOTE="$(git rev-parse "origin/$BRANCH")"

if [ "$LOCAL" = "$REMOTE" ]; then
  echo "[auto-update] già aggiornato ($(git rev-parse --short HEAD)). Nessun downtime."
  exit 0
fi

echo "[auto-update] nuovo commit su origin/$BRANCH ($(git rev-parse --short "$REMOTE")): aggiorno..."
exec "$SCRIPT_DIR/update.sh" --restart
