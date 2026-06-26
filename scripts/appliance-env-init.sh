#!/bin/bash
# Inizializza .env host per appliance-stack (idempotente).
# Uso: sudo bash scripts/appliance-env-init.sh [/opt/appliance-stack/.env]
set -euo pipefail

ENV_FILE="${1:-/opt/appliance-stack/.env}"
DIR="$(dirname "$ENV_FILE")"

mkdir -p "$DIR"
touch "$ENV_FILE"
chmod 600 "$ENV_FILE"

upsert() {
  local key="$1" val="$2"
  if grep -q "^${key}=" "$ENV_FILE" 2>/dev/null; then
    return 0
  fi
  echo "${key}=${val}" >> "$ENV_FILE"
  echo ">>> Aggiunto ${key}"
}

KEY="$(openssl rand -hex 32)"
SECRET="$(openssl rand -hex 32)"

upsert ENCRYPTION_KEY "$KEY"
upsert AUTH_SECRET "$SECRET"
upsert NEXTAUTH_SECRET "$SECRET"
upsert AUTH_TRUST_HOST "true"

echo ""
echo "=== Appliance secrets in ${ENV_FILE} ==="
echo "Salva ENCRYPTION_KEY in vault — senza di essa le credenziali vault sono irrecuperabili."
echo "Verifica dopo avvio:"
echo "  curl -s http://127.0.0.1:3001/api/health | jq '{status, deploy_mode, encryption_key}'"
