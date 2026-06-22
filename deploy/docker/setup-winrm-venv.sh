#!/bin/bash
# Crea/aggiorna venv Python per bridge WinRM/WMI/SSH (pywinrm, impacket, paramiko).
# Usato da: deploy/docker/Dockerfile (build) e entrypoint.sh (bootstrap su container esistenti).
set -euo pipefail

APP_DIR="${DA_INVENT_APP_DIR:-/opt/da-ipam}"
WINRM_VENV="${WINRM_VENV:-${APP_DIR}/.venv-winrm}"

if ! command -v python3 >/dev/null 2>&1; then
  echo "[setup-winrm-venv] python3 non installato — salto (installare python3 python3-venv)." >&2
  exit 1
fi

if [ ! -x "${WINRM_VENV}/bin/python3" ]; then
  echo "[setup-winrm-venv] Creazione venv in ${WINRM_VENV}..."
  python3 -m venv "${WINRM_VENV}"
fi

PIP="${WINRM_VENV}/bin/pip"
PY="${WINRM_VENV}/bin/python3"

"${PIP}" install --quiet --upgrade pip

echo "[setup-winrm-venv] Installazione pywinrm + dipendenze..."
if ! "${PIP}" install --quiet pywinrm requests-ntlm requests-credssp paramiko impacket; then
  echo "[setup-winrm-venv] ERRORE: install base fallita." >&2
  exit 1
fi

# Kerberos opzionale (gssapi richiede libkrb5-dev a build-time)
if "${PIP}" install --quiet gssapi 2>/dev/null; then
  echo "[setup-winrm-venv] gssapi/Kerberos disponibile."
else
  echo "[setup-winrm-venv] gssapi non installato (NTLM/CredSSP ok)."
fi

if "${PY}" -c "import winrm" 2>/dev/null; then
  echo "[setup-winrm-venv] OK — ${PY}"
else
  echo "[setup-winrm-venv] ERRORE: import winrm fallito." >&2
  exit 1
fi
