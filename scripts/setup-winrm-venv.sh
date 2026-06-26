#!/bin/bash
# Crea/aggiorna venv Python per bridge WinRM/WMI/SSH (hub systemd + container Docker).
# Path canonico: ${HOME}/.da-invent-venv (parità hub 192.168.4.8).
#
# Uso:
#   bash scripts/setup-winrm-venv.sh
#   WINRM_VENV=/root/.da-invent-venv bash scripts/setup-winrm-venv.sh
#
# Dipendenze apt (install.sh / hub-install.sh): python3 python3-venv python3-dev
# libffi-dev libkrb5-dev (opzionale Kerberos via gssapi).
set -euo pipefail

WINRM_VENV="${WINRM_VENV:-${HOME:-/root}/.da-invent-venv}"

if ! command -v python3 >/dev/null 2>&1; then
  echo "[setup-winrm-venv] python3 non installato." >&2
  echo "  Debian/Ubuntu: apt-get install -y python3 python3-venv python3-dev libffi-dev libkrb5-dev" >&2
  exit 1
fi

if [ ! -x "${WINRM_VENV}/bin/python3" ]; then
  echo "[setup-winrm-venv] Creazione venv in ${WINRM_VENV}..."
  python3 -m venv "${WINRM_VENV}" || {
    echo "[setup-winrm-venv] Errore venv. Installare: apt-get install -y python3-venv" >&2
    exit 1
  }
fi

PIP="${WINRM_VENV}/bin/pip"
PY="${WINRM_VENV}/bin/python3"

"${PIP}" install --quiet --upgrade pip

echo "[setup-winrm-venv] Installazione pywinrm + bridge SSH/WMI..."
if ! "${PIP}" install --quiet "pywinrm[kerberos]" pyspnego requests-ntlm requests-credssp paramiko impacket; then
  echo "[setup-winrm-venv] pywinrm[kerberos] fallito — retry minimale..."
  "${PIP}" install --quiet pywinrm requests-ntlm requests-credssp paramiko impacket || {
    echo "[setup-winrm-venv] ERRORE: pip install fallita." >&2
    exit 1
  }
fi

if "${PIP}" install --quiet gssapi 2>/dev/null; then
  echo "[setup-winrm-venv] gssapi/Kerberos disponibile."
else
  echo "[setup-winrm-venv] gssapi non installato (NTLM/CredSSP ok)."
fi

for mod in winrm paramiko impacket; do
  if ! "${PY}" -c "import ${mod}" 2>/dev/null; then
    echo "[setup-winrm-venv] ERRORE: import ${mod} fallito." >&2
    exit 1
  fi
done

echo "[setup-winrm-venv] OK — ${PY} (pywinrm $( "${PY}" -c 'import winrm; print(winrm.__version__)' ))"
