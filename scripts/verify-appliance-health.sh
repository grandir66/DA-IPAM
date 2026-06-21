#!/bin/bash
# Verifica parità deploy container vs hub (health + decrypt credenziali).
# Uso: bash scripts/verify-appliance-health.sh [base_url]
set -euo pipefail

BASE="${1:-http://127.0.0.1:3001}"
JSON="$(curl -fsS "${BASE}/api/health")"

echo "$JSON" | python3 -c "
import json, sys
d = json.load(sys.stdin)
print('status:', d.get('status'))
print('deploy_mode:', d.get('deploy_mode'))
ek = d.get('encryption_key') or {}
print('encryption_key.configured:', ek.get('configured'))
print('encryption_key.credentials_decryptable:', ek.get('credentials_decryptable'))
print('encryption_key.fingerprint:', ek.get('fingerprint'))
if ek.get('detail'):
    print('DETAIL:', ek['detail'])
    sys.exit(1)
if d.get('status') != 'ok':
    sys.exit(1)
"

echo "OK — appliance allineata al modello hub"
