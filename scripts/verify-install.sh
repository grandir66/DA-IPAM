#!/bin/bash
# Verifica post-install: venv WinRM + (opzionale) health HTTP.
#
# Hub systemd:
#   bash scripts/verify-install.sh
#   bash scripts/verify-install.sh --url http://127.0.0.1:3001
#
# Container Docker:
#   bash scripts/verify-install.sh --docker appliance-ipam
#   bash scripts/verify-install.sh --docker appliance-ipam --url http://127.0.0.1:3001
set -euo pipefail

DOCKER=""
BASE_URL=""
VENV_PY="${WINRM_PYTHON:-${HOME:-/root}/.da-invent-venv/bin/python3}"

while [ $# -gt 0 ]; do
  case "$1" in
    --docker) DOCKER="${2:?}"; shift 2 ;;
    --url) BASE_URL="${2:?}"; shift 2 ;;
    -h|--help)
      echo "Uso: $0 [--docker CONTAINER] [--url BASE]"
      exit 0
      ;;
    *) echo "Argomento sconosciuto: $1" >&2; exit 2 ;;
  esac
done

run_in_target() {
  if [ -n "$DOCKER" ]; then
    docker exec "$DOCKER" bash -lc "$1"
  else
    bash -lc "$1"
  fi
}

echo "=== verify-install ==="
[ -n "$DOCKER" ] && echo "target: docker $DOCKER" || echo "target: host locale"

# ── Python / WinRM venv ─────────────────────────────────────────────────────
if [ -n "$DOCKER" ]; then
  VENV_PY="/root/.da-invent-venv/bin/python3"
fi

echo ">>> WinRM venv: $VENV_PY"
run_in_target "test -x '$VENV_PY'" || {
  echo "ERRORE: Python venv assente. Esegui: bash scripts/setup-winrm-venv.sh" >&2
  exit 1
}

run_in_target "'$VENV_PY' -c \"
import winrm, paramiko, impacket
print('pywinrm', winrm.__version__)
print('paramiko', paramiko.__version__)
\"" || {
  echo "ERRORE: moduli Python mancanti nel venv." >&2
  exit 1
}

if [ -n "$DOCKER" ]; then
  run_in_target "printenv WINRM_PYTHON" | grep -q . || {
    echo "AVVISO: WINRM_PYTHON non impostato nel container (find-bridge-python usa path default)." >&2
  }
fi

# ── HTTP health (opzionale) ───────────────────────────────────────────────────
if [ -n "$BASE_URL" ]; then
  echo ">>> GET ${BASE_URL}/api/health"
  if [ -n "$DOCKER" ]; then
    JSON="$(docker exec "$DOCKER" curl -fsS "${BASE_URL}/api/health")"
  else
    JSON="$(curl -fsS "${BASE_URL}/api/health")"
  fi
  echo "$JSON" | python3 -c "
import json, sys
d = json.load(sys.stdin)
assert d.get('status') == 'ok', d
ek = d.get('encryption_key') or {}
if ek.get('configured') and ek.get('credentials_decryptable') is False:
    print('AVVISO: encryption_key non decifra credenziali:', ek.get('detail'))
    sys.exit(1)
print('health: ok')
ver = d.get('version') or d.get('app_version')
if ver: print('version:', ver)
"
  VER_JSON="$(curl -fsS "${BASE_URL}/api/version" 2>/dev/null || true)"
  if [ -n "$VER_JSON" ]; then
    echo ">>> GET ${BASE_URL}/api/version → $VER_JSON"
  fi
fi

echo "OK — installazione verificata (WinRM/WMI/SSH Python pronto)"
