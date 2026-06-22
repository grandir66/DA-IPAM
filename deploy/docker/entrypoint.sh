#!/bin/bash
# Entrypoint DA-IPAM container — parità deterministica con hub systemd (192.168.4.8).
# - ENCRYPTION_KEY obbligatoria da compose (no chiavi random nel layer immagine)
# - .env.local unico su volume /data (persistente, sopravvive al rebuild)
# - symlink /opt/da-ipam/.env.local → /data/.env.local (Next.js + server.ts)
set -euo pipefail

APP_DIR="${DA_INVENT_APP_DIR:-/opt/da-ipam}"
DATA_DIR="${DA_INVENT_DATA_DIR:-/data}"
SECRETS_FILE="${DATA_DIR}/.env.local"
CWD_SECRETS="${APP_DIR}/.env.local"

export DA_INVENT_CONTAINER="${DA_INVENT_CONTAINER:-1}"
export DA_INVENT_DATA_DIR="${DATA_DIR}"

# Alias auth (compose → runtime)
if [ -z "${AUTH_SECRET:-}" ] && [ -n "${NEXTAUTH_SECRET:-}" ]; then
  export AUTH_SECRET="${NEXTAUTH_SECRET}"
fi
if [ -z "${NEXTAUTH_SECRET:-}" ] && [ -n "${AUTH_SECRET:-}" ]; then
  export NEXTAUTH_SECRET="${AUTH_SECRET}"
fi

if [ -z "${ENCRYPTION_KEY:-}" ]; then
  echo "FATAL: ENCRYPTION_KEY mancante. Genera /opt/appliance-stack/.env sul host (scripts/appliance-env-init.sh)." >&2
  exit 1
fi

if [ -z "${AUTH_SECRET:-}" ]; then
  echo "FATAL: AUTH_SECRET o NEXTAUTH_SECRET mancante nel compose." >&2
  exit 1
fi

mkdir -p "${DATA_DIR}" "${APP_DIR}/logs"

# Migrazione one-shot: vecchio .env.local nel layer immagine → volume
if [ -f "${CWD_SECRETS}" ] && [ ! -L "${CWD_SECRETS}" ]; then
  if [ ! -f "${SECRETS_FILE}" ]; then
    echo "[entrypoint] Migrazione ${CWD_SECRETS} → ${SECRETS_FILE}"
    mv "${CWD_SECRETS}" "${SECRETS_FILE}"
    chmod 600 "${SECRETS_FILE}"
  else
    echo "[entrypoint] Rimozione ${CWD_SECRETS} stale (uso ${SECRETS_FILE})"
    rm -f "${CWD_SECRETS}"
  fi
fi

ln -sfn "${SECRETS_FILE}" "${CWD_SECRETS}"

# Venv pywinrm — stesso path del hub 192.168.4.8: /root/.da-invent-venv
if [ -x "${APP_DIR}/deploy/docker/setup-winrm-venv.sh" ]; then
  WINRM_VENV="${WINRM_VENV:-/root/.da-invent-venv}" HOME="${HOME:-/root}" \
    "${APP_DIR}/deploy/docker/setup-winrm-venv.sh" || \
    echo "[entrypoint] Avviso: setup venv WinRM fallito — scan Windows non disponibili." >&2
fi
export WINRM_PYTHON="${WINRM_PYTHON:-/root/.da-invent-venv/bin/python3}"
export SSH_PYTHON="${SSH_PYTHON:-/root/.da-invent-venv/bin/python3}"

echo "[entrypoint] DA-IPAM container — secrets=${SECRETS_FILE} data=${DATA_DIR} winrm=${WINRM_PYTHON}"

exec "$@"
