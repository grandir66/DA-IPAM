#!/bin/bash
# DA-INVENT — Aggiornamento via Git
# Esegue: allineamento a origin, npm install, build in una cartella a parte,
# scambio, restart e controllo di /api/health; se qualcosa fallisce torna alla
# build e al commit di prima. Stato in scripts/stato-aggiornamento.mjs.
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

# Canale da .env.local se DA_INVENT_BRANCH non è in ambiente (update manuale via SSH).
if [ -z "${DA_INVENT_BRANCH:-}" ] && [ -f "$APP_DIR/.env.local" ]; then
  DA_INVENT_BRANCH="$(grep -E '^[[:space:]]*DA_INVENT_BRANCH=' "$APP_DIR/.env.local" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d "\"'" | tr -d '[:space:]')"
  export DA_INVENT_BRANCH
fi

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
  git stash push -u -m "autoupdate-$STAMP" -- . ':!data' ':!data/**' ':!data.wrong-*' ':!data.wrong-*/**' || {
    echo "Errore: stash fallito. Pulisci manualmente: 'git status' e 'git restore' / 'rm'."
    exit 1
  }
fi

# ── Stato dell'aggiornamento e ritorno indietro (16/10/2026) ─────────────────
# Prima: pull → install → build sul posto, con `set -e`. Un build fallito usciva
# senza riavvio lasciando il processo acceso su una .next a metà (CONTEXT §3:
# «mai npm run build senza riavviare subito»), e auto-update.sh non ritentava
# perché HEAD era già uguale a origin. Ora:
#   - si costruisce nella cartella NON in uso (.next-a / .next-b, con
#     DA_INVENT_BUILD_DIR) e solo a build riuscito la si dichiara in uso in
#     `.next-attiva` (letto da next.config.ts): il processo acceso non perde
#     file. Non si rinomina dopo il build: Next scrive il nome della cartella
#     dentro le rotte compilate (provato il 16/10 su v0.3.311);
#   - dopo il riavvio /api/health deve rispondere 200, altrimenti si torna
#     indietro (build, codice e servizio di prima);
#   - ogni fase e l'esito vanno in scripts/stato-aggiornamento.mjs, che
#     auto-update.sh legge per ritentare e che l'app mostra.
stato() { node "$APP_DIR/scripts/stato-aggiornamento.mjs" "$@" || true; }

# La cartella in uso: quella scritta in .next-attiva, altrimenti la storica .next.
BUILD_ATTIVA="$(cat .next-attiva 2>/dev/null || true)"
case "$BUILD_ATTIVA" in
  .next-a|.next-b) [ -d "$BUILD_ATTIVA" ] || { echo "AVVISO: .next-attiva indica $BUILD_ATTIVA, che non c'è: uso .next" >&2; rm -f .next-attiva; BUILD_ATTIVA=".next"; } ;;
  *)
    # Senza .next-attiva vale .next; se però .next è il collegamento a una delle
    # due cartelle, quella è in uso e non va cancellata.
    BUILD_ATTIVA=".next"
    if [ -L .next ]; then
      case "$(readlink .next)" in .next-a|.next-b) BUILD_ATTIVA="$(readlink .next)" ;; esac
    fi
    ;;
esac
if [ "$BUILD_ATTIVA" = ".next-a" ]; then BUILD_NUOVA=".next-b"; else BUILD_NUOVA=".next-a"; fi
# Quella libera può contenere una build vecchia o a metà: si rifà da zero.
rm -rf "$BUILD_NUOVA"

dichiara_build() {
  if [ "$1" = ".next" ]; then
    rm -f .next-attiva
  else
    printf '%s\n' "$1" > .next-attiva.tmp && mv .next-attiva.tmp .next-attiva
  fi
}

# Il commit a cui tornare: quello della build in uso (scritto in DA_COMMIT dopo ogni
# build riuscita), poi quello avviato con salute buona, altrimenti HEAD. Revisione del
# 19/10: dopo «pronto_non_avviato» il commit avviato è il vecchio, ma la build in uso è
# già la nuova; tornare al vecchio lasciava sorgente e pagine di due commit diversi.
PRIMA="$(head -n1 "$BUILD_ATTIVA/DA_COMMIT" 2>/dev/null || true)"
if [ -z "$PRIMA" ] || ! git cat-file -e "${PRIMA}^{commit}" 2>/dev/null; then
  PRIMA="$(node "$APP_DIR/scripts/stato-aggiornamento.mjs" leggi commit_avviato 2>/dev/null || true)"
fi
if [ -z "$PRIMA" ] || ! git cat-file -e "${PRIMA}^{commit}" 2>/dev/null; then
  PRIMA="$(git rev-parse HEAD)"
fi

echo ">>> git fetch origin $BRANCH..."
git fetch origin "$BRANCH"
NUOVO="$(git rev-parse "origin/$BRANCH")"
stato inizio "$NUOVO" "$PRIMA"

FASE="pull"
RIAVVIATO=false
SCAMBIATA=false

torna_indietro() {
  echo ">>> ritorno a $(git rev-parse --short "$PRIMA") ..." >&2
  if [ "$SCAMBIATA" = true ]; then dichiara_build "$BUILD_ATTIVA"; fi
  rm -rf "$BUILD_NUOVA"
  local lock_cambiato=false
  if ! git diff --quiet "$PRIMA" HEAD -- package-lock.json 2>/dev/null; then lock_cambiato=true; fi
  git reset --hard --quiet "$PRIMA" || echo "AVVISO: git reset a $PRIMA non riuscito" >&2
  # node_modules torna al package-lock di prima se l'install nuovo l'ha toccato
  # (anche a metà: un install fallito può lasciarlo incompleto).
  if [ "$lock_cambiato" = true ] && [ "$FASE" != "pull" ]; then
    npm install --include=dev >/dev/null 2>&1 || echo "AVVISO: npm install di ritorno non riuscito" >&2
  fi
  if [ "$RIAVVIATO" = true ]; then
    restart_service || echo "AVVISO: riavvio con la build di prima non riuscito" >&2
  fi
}

fallisci() {
  local motivo="$1"
  trap - ERR
  set +e
  echo "ERRORE: aggiornamento fallito nella fase «$FASE»: $motivo" >&2
  torna_indietro
  stato fine fallito "fase $FASE: $motivo"
  echo "=== Aggiornamento NON completato: gira ancora $(git rev-parse --short HEAD) ===" >&2
  exit 1
}

set -E
trap 'fallisci "comando terminato con codice $?"' ERR

# Pull: le appliance non hanno modifiche proprie (stash sopra), quindi si va su
# origin anche quando la storia non è lineare (ritorno da un ramo diverso).
echo ">>> allineo a origin/$BRANCH ($(git rev-parse --short "$NUOVO"))..."
if ! git merge --ff-only --quiet "origin/$BRANCH" 2>/dev/null; then
  git reset --hard --quiet "origin/$BRANCH"
fi

# npm install: --include=dev forza l'installazione delle devDependencies
# anche con NODE_ENV=production (presente in .env.local del service). Servono
# comunque al build successivo (TypeScript/tailwind) e a `patch-package`, che
# gira come postinstall per patchare httpntlm.
FASE="install"; stato fase install
echo ">>> npm install --include=dev..."
npm install --include=dev

# Venv Python WinRM/WMI/SSH (script canonico condiviso con install.sh)
if [ -f "$APP_DIR/scripts/setup-winrm-venv.sh" ]; then
  echo ">>> setup-winrm-venv..."
  # WinRM è una funzione facoltativa: un suo guasto non deve fermare l'aggiornamento.
  # Sul cliente A un venv senza pip ha bloccato build e restart per mesi (2026-10-12).
  bash "$APP_DIR/scripts/setup-winrm-venv.sh" || {
    echo "AVVISO: setup-winrm-venv fallito — WinRM non disponibile, l'aggiornamento prosegue." >&2
    stato avviso "setup-winrm-venv fallito: WinRM non disponibile"
  }
fi

# Build nella cartella libera: quella in uso resta intatta per il processo acceso.
FASE="build"; stato fase build
echo ">>> npm run build (in $BUILD_NUOVA)..."
DA_INVENT_BUILD_DIR="$BUILD_NUOVA" npm run build
# tsconfig.json elenca già i tipi di .next-a e .next-b; se Next lo ritoccasse
# comunque (versione nuova), si rimette com'era: è un file tracciato.
git checkout --quiet -- tsconfig.json 2>/dev/null || true
if [ ! -f "$BUILD_NUOVA/BUILD_ID" ]; then
  fallisci "build senza BUILD_ID"
fi
# Il commit di questa build, per tornarci (vedi PRIMA).
git rev-parse HEAD > "$BUILD_NUOVA/DA_COMMIT"

# Nome del servizio: da-invent sulle installazioni classiche, da-ipam sulle
# appliance consolidate. Prima si cercava solo da-invent: sul cliente A (da-ipam) il
# restart veniva saltato e la build nuova non partiva mai (2026-10-12).
SERVICE="da-invent"
for s in da-invent da-ipam; do
  if systemctl is-active --quiet "$s" 2>/dev/null; then SERVICE="$s"; break; fi
done

# Restart servizio systemd (se richiesto)
# In LXC Debian minimale spesso non c'è `sudo`; come root usare systemctl diretto.
restart_service() {
  if [ "$(id -u)" -eq 0 ]; then
    systemctl restart "$SERVICE"
  elif command -v sudo >/dev/null 2>&1; then
    sudo systemctl restart "$SERVICE"
  else
    echo "Errore: servizio da riavviare ma né root né sudo disponibili."
    return 1
  fi
}

# Scambio: da qui un avvio dell'app usa la build nuova.
FASE="scambio"; stato fase scambio
SERVIZIO_ATTIVO=false
if systemctl is-active --quiet "$SERVICE" 2>/dev/null; then SERVIZIO_ATTIVO=true; fi
dichiara_build "$BUILD_NUOVA"
SCAMBIATA=true

PORT="$(grep -E '^PORT=' "$APP_DIR/.env.local" 2>/dev/null | cut -d= -f2- | tr -d '"' || true)"
URL_SALUTE="http://127.0.0.1:${PORT:-3001}"

if [ "$RESTART" = true ] && [ "$SERVIZIO_ATTIVO" = true ]; then
  FASE="riavvio"; stato fase riavvio
  echo ">>> systemctl restart $SERVICE..."
  RIAVVIATO=true
  restart_service
  echo "    Servizio riavviato."

  # Salute: il servizio appena riavviato impiega qualche secondo ad ascoltare.
  # Serve un 200 da /api/health (DB e chiave di cifratura leggibili), http o https,
  # entro DA_INVENT_ATTESA_SALUTE secondi (90 di default).
  FASE="salute"; stato fase salute
  echo ">>> attendo /api/health..."
  SANO=false
  ATTESA="${DA_INVENT_ATTESA_SALUTE:-90}"
  for _ in $(seq 1 $(( (ATTESA + 1) / 2 ))); do
    if curl -fs -o /dev/null --max-time 2 "$URL_SALUTE/api/health"; then SANO=true; break; fi
    if curl -fsk -o /dev/null --max-time 2 "https://127.0.0.1:${PORT:-3001}/api/health"; then
      SANO=true; URL_SALUTE="https://127.0.0.1:${PORT:-3001}"; break
    fi
    sleep 2
  done
  if [ "$SANO" != true ]; then
    fallisci "/api/health non risponde 200 entro ${ATTESA} s dal riavvio"
  fi
  echo "    /api/health: ok"
elif [ "$RESTART" = true ]; then
  echo ">>> Servizio $SERVICE non attivo, skip restart."
  stato avviso "servizio $SERVICE non attivo: build pronta, non provata"
else
  echo "AVVISO: build sostituita senza riavvio: riavviare $SERVICE subito (il processo acceso carica i file a richiesta)." >&2
  stato avviso "build sostituita senza riavvio"
fi

trap - ERR
set +E
# La build di prima non serve più. .next diventa un collegamento a quella in uso,
# per chi controlla .next/BUILD_ID (api/system/update, script a mano).
rm -rf "$BUILD_ATTIVA"
ln -sfn "$BUILD_NUOVA" .next

if [ -f "$APP_DIR/scripts/verify-install.sh" ]; then
  echo ">>> verify-install..."
  VERIFY_ARGS=()
  if [ "$RIAVVIATO" = true ]; then VERIFY_ARGS=(--url "$URL_SALUTE"); fi
  bash "$APP_DIR/scripts/verify-install.sh" "${VERIFY_ARGS[@]}" || {
    echo "AVVISO: verify-install fallito (dettagli sopra)" >&2
    stato avviso "verify-install fallito"
  }
fi

# Analisi del 19/10 (F03): «riuscito» segna il commit come avviato, e il controllo
# dopo lo crede in esercizio. Senza riavvio (servizio fermo, o lanciato senza
# --restart) né l'avvio né la salute sono provati: la build è pronta, non avviata.
if [ "$RIAVVIATO" = true ]; then
  stato fine riuscito
else
  stato fine pronto_non_avviato "servizio $SERVICE non riavviato: build pronta, non avviata"
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
