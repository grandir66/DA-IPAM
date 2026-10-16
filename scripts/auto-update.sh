#!/bin/bash
# DA-INVENT — Auto-update guidato da timer systemd.
#
# Strategia "appliance sempre allineata a main, no-op se già in pari":
#   1. forza il branch target (default: main, override DA_INVENT_BRANCH)
#      — se la working tree è su un altro branch, checkout
#      — se ci sono modifiche locali su tracked files, reset --hard (appliance
#        immutable: i file tracked non vanno modificati a mano)
#   2. git fetch + confronto fra origin/<branch> e il commit AVVIATO con salute
#      buona (scripts/stato-aggiornamento.mjs), non HEAD: HEAD avanza col pull
#      prima del build, e un build fallito restava «già aggiornato» per sempre
#      (16/10/2026). Senza stato (primo giro) vale HEAD, come prima.
#   3. se coincidono → esci 0 (NESSUN build, NESSUN restart)
#   4. se lo stesso commit è già fallito MAX_TENTATIVI volte → esci 0 e aspetta un
#      commit nuovo (DA_INVENT_FORZA_AGGIORNAMENTO=1 per riprovare subito)
#   5. altrimenti → delega a update.sh --restart (pull + npm install + build + restart)
#
# Lock con flock per evitare run sovrapposti. Output → journald (systemd).
# Override branch con DA_INVENT_BRANCH; directory con DA_INVENT_DIR.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
APP_DIR="${DA_INVENT_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
cd "$APP_DIR"

if [ -z "${DA_INVENT_BRANCH:-}" ] && [ -f "$APP_DIR/.env.local" ]; then
  DA_INVENT_BRANCH="$(grep -E '^[[:space:]]*DA_INVENT_BRANCH=' "$APP_DIR/.env.local" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d "\"'" | tr -d '[:space:]')"
  export DA_INVENT_BRANCH
fi

if [ ! -d .git ]; then
  echo "[auto-update] '$APP_DIR' non è un repo Git: skip (installazione non-git)."
  exit 0
fi

# Lock: un solo auto-update per volta
LOCK="${DA_INVENT_LOCK:-/tmp/da-invent-auto-update.lock}"
exec 9>"$LOCK"
if ! flock -n 9; then
  echo "[auto-update] un altro update è già in corso: skip."
  exit 0
fi

BRANCH="${DA_INVENT_BRANCH:-main}"
CURRENT="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")"
MAX_TENTATIVI="${DA_INVENT_MAX_TENTATIVI:-3}"

stato() { node "$SCRIPT_DIR/stato-aggiornamento.mjs" "$@"; }

# Il commit che gira davvero: letto PRIMA del checkout, che sposta HEAD.
AVVIATO="$(stato leggi commit_avviato 2>/dev/null || true)"
if [ -z "$AVVIATO" ]; then
  AVVIATO="$(git rev-parse HEAD)"
  stato avviato "$AVVIATO" "primo giro con lo stato su file: si assume che HEAD giri" || true
fi

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

if [ "$AVVIATO" = "$REMOTE" ]; then
  echo "[auto-update] già aggiornato ($(git rev-parse --short "$AVVIATO")). Nessun downtime."
  exit 0
fi

# Un tentativo rimasto «in_corso» col lucchetto libero è morto a metà (timeout
# del servizio, riavvio della macchina): si registra come interrotto.
if [ "$(stato leggi esito || true)" = "in_corso" ]; then
  stato fine interrotto "il giro precedente si è fermato a metà (fase: $(stato leggi fase))" || true
fi

# Un commit che non si costruisce non si ritenta all'infinito: ogni giro è un
# build di minuti sulla macchina del cliente. Si riprova al commit successivo.
TENTATO="$(stato leggi commit_tentato || true)"
ESITO="$(stato leggi esito || true)"
TENTATIVI="$(stato leggi tentativi || true)"
if [ "${DA_INVENT_FORZA_AGGIORNAMENTO:-0}" != "1" ] \
  && [ "$TENTATO" = "$REMOTE" ] \
  && { [ "$ESITO" = "fallito" ] || [ "$ESITO" = "interrotto" ]; } \
  && [ "${TENTATIVI:-0}" -ge "$MAX_TENTATIVI" ]; then
  echo "[auto-update] $(git rev-parse --short "$REMOTE") è fallito $MAX_TENTATIVI volte (fase: $(stato leggi fase)): aspetto un commit nuovo. Gira ancora $(git rev-parse --short "$AVVIATO")."
  exit 0
fi

# Solo documentazione: si aggiornano i file senza build né riavvio. Ogni commit di
# docs su dev riavviava l'appliance del cliente A e interrompeva il controllo host in corso (2026-10-12).
# L'app legge i .md dal disco a ogni richiesta, quindi non serve la build.
# Vale solo se la build accesa è quella di HEAD: dopo un build fallito si rifà tutto.
CAMBIATI="$(git diff --name-only "$AVVIATO" "$REMOTE" 2>/dev/null || echo "?")"
if [ "$LOCAL" = "$AVVIATO" ] && [ -n "$CAMBIATI" ] && ! printf '%s\n' "$CAMBIATI" | grep -q -v -E '^docs/|\.md$'; then
  if git merge --ff-only --quiet "origin/$BRANCH"; then
    stato avviato "$REMOTE" "solo documentazione, nessun riavvio" || true
    echo "[auto-update] solo documentazione ($(git rev-parse --short HEAD)): file aggiornati, nessun riavvio."
    exit 0
  fi
fi

echo "[auto-update] nuovo commit su origin/$BRANCH ($(git rev-parse --short "$REMOTE")): aggiorno..."
exec "$SCRIPT_DIR/update.sh" --restart
