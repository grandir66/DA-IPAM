#!/bin/bash
# Verifica parità deploy container vs hub (health + decrypt credenziali + WinRM venv).
# Uso:
#   bash scripts/verify-appliance-health.sh
#   bash scripts/verify-appliance-health.sh http://127.0.0.1:3001 appliance-ipam
set -euo pipefail

BASE="${1:-http://127.0.0.1:3001}"
CONTAINER="${2:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"

if [ -n "$CONTAINER" ]; then
  bash "${SCRIPT_DIR}/verify-install.sh" --docker "$CONTAINER" --url "$BASE"
else
  bash "${SCRIPT_DIR}/verify-install.sh" --url "$BASE"
fi

echo "OK — appliance allineata al modello hub (health + WinRM)"
