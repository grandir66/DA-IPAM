#!/bin/bash
# Allinea integrazioni appliance-stack (PX-NAS / distribuzione Docker).
# Eseguire sul nodo PVE con accesso a /etc/da-appliance/secrets/ e SSH alla VM app-stack.
set -euo pipefail

APPLIANCE_HOST="${APPLIANCE_HOST:-192.168.99.50}"
SSH_KEY="${SSH_KEY:-/etc/da-appliance/secrets/admin_ed25519}"
SECRETS_DIR="${SECRETS_DIR:-/etc/da-appliance/secrets}"
STACK_DIR="${STACK_DIR:-/opt/appliance-stack}"
NET_SERVICES_HOST="${NET_SERVICES_HOST:-192.168.99.53}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

read_secret() {
  local f="$1"
  [ -f "$f" ] || { echo "FATAL: secret mancante: $f" >&2; exit 1; }
  tr -d '\n\r' < "$f"
}

# Token API edge: edge.token (Bearer UI/API). NON scanner-edge.secret_key (chiave interna container).
EDGE_TOKEN="$(read_secret "$SECRETS_DIR/edge.token")"
LIBRENMS_TOKEN="$(read_secret "$SECRETS_DIR/librenms.token")"
NET_TOKEN="$(read_secret "$SECRETS_DIR/net-services.token")"
CANONICAL_KEY="$(read_secret "$SECRETS_DIR/ipam.encryption_key")"
if [ ! -f "$SECRETS_DIR/export_passphrase" ]; then
  openssl rand -base64 32 | tr -d '\n' > "$SECRETS_DIR/export_passphrase"
  chmod 600 "$SECRETS_DIR/export_passphrase"
  echo "    Creato $SECRETS_DIR/export_passphrase"
fi
EXPORT_PASSPHRASE="$(read_secret "$SECRETS_DIR/export_passphrase")"

ssh_app() {
  ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "root@${APPLIANCE_HOST}" "$@"
}

echo ">>> [1/7] ENCRYPTION_KEY — allineamento host / volume / secrets"
LOCAL_KEY="$(ssh_app "docker exec appliance-ipam sh -c 'grep ^ENCRYPTION_KEY= /data/.env.local 2>/dev/null || grep ^ENCRYPTION_KEY= /opt/da-ipam/.env.local 2>/dev/null' | head -1 | cut -d= -f2- || true")"
if [ -n "$LOCAL_KEY" ] && [ "$LOCAL_KEY" != "$CANONICAL_KEY" ]; then
  echo "    Vault cifrato con chiave volume — aggiorno ipam.encryption_key canonico"
  printf '%s' "$LOCAL_KEY" > "$SECRETS_DIR/ipam.encryption_key"
  chmod 600 "$SECRETS_DIR/ipam.encryption_key"
  CANONICAL_KEY="$LOCAL_KEY"
fi

ssh_app "python3 - <<'PY'
from pathlib import Path
env = Path('${STACK_DIR}/.env')
lines = env.read_text().splitlines() if env.exists() else []
upsert = {
  'ENCRYPTION_KEY': '''${CANONICAL_KEY}''',
  'EDGE_API_TOKEN': '''${EDGE_TOKEN}''',
  'LIBRENMS_API_TOKEN': '''${LIBRENMS_TOKEN}''',
  'NET_SERVICES_API_TOKEN': '''${NET_TOKEN}''',
  'NET_SERVICES_API_URL': 'https://${NET_SERVICES_HOST}:8443',
  'APPLIANCE_LAN_IP': '''${APPLIANCE_HOST}''',
  'LIBRENMS_UI_URL': 'https://${APPLIANCE_HOST}:7443',
  'EXPORT_PASSPHRASE': '''${EXPORT_PASSPHRASE}''',
}
out, keys = [], set()
for line in lines:
    k = line.split('=', 1)[0] if '=' in line else None
    if k in upsert:
        out.append(f'{k}={upsert[k]}')
        keys.add(k)
    else:
        out.append(line)
for k, v in upsert.items():
    if k not in keys:
        out.append(f'{k}={v}')
env.write_text('\\n'.join(out) + '\\n')
env.chmod(0o600)
# Persisti sul volume (sopravvive al recreate)
vol = Path('/var/lib/docker/volumes/appliance-stack_ipam_data/_data/.env.local')
vol.parent.mkdir(parents=True, exist_ok=True)
vol.write_text(f'ENCRYPTION_KEY={upsert[\"ENCRYPTION_KEY\"]}\\n')
vol.chmod(0o600)
print('.env + volume .env.local aggiornati')
PY"

echo ">>> [2/7] Patch compose.yml"
ssh_app "python3 - <<'PY'
from pathlib import Path
p = Path('${STACK_DIR}/compose.yml')
t = p.read_text()
if '127.0.0.1:8000:8000' in t:
    t = t.replace('127.0.0.1:8000:8000', '8000:8000')
if 'LIBRENMS_API_TOKEN:' not in t:
    t = t.replace(
        'LIBRENMS_API_URL: http://127.0.0.1:8000',
        'LIBRENMS_API_URL: http://127.0.0.1:8000\\n      LIBRENMS_API_TOKEN: \${LIBRENMS_API_TOKEN:-}',
    )
if 'NET_SERVICES_API_URL' not in t:
    t = t.replace(
        'LIBRENMS_API_TOKEN: \${LIBRENMS_API_TOKEN:-}',
        'LIBRENMS_API_TOKEN: \${LIBRENMS_API_TOKEN:-}\\n      NET_SERVICES_API_URL: \${NET_SERVICES_API_URL:-}\\n      NET_SERVICES_API_TOKEN: \${NET_SERVICES_API_TOKEN:-}',
    )
if 'EDGE_API_TOKEN:' not in t:
    t = t.replace(
        'EDGE_INTERNAL_URL: http://127.0.0.1:8080',
        'EDGE_INTERNAL_URL: http://127.0.0.1:8080\\n      EDGE_API_TOKEN: \${EDGE_API_TOKEN:-}',
    )
if 'LIBRENMS_UI_URL:' not in t:
    t = t.replace(
        'LIBRENMS_API_URL: http://127.0.0.1:8000',
        'LIBRENMS_API_URL: http://127.0.0.1:8000\\n      LIBRENMS_UI_URL: https://\${APPLIANCE_LAN_IP:-localhost}:7443\\n      DA_INVENT_PUBLIC_HOST: \${APPLIANCE_LAN_IP:-}',
    )
p.write_text(t)
print('compose patched')
PY"

echo ">>> [3/7] Copia bootstrap script nel container"
scp -i "$SSH_KEY" -o StrictHostKeyChecking=no \
  "$SCRIPT_DIR/appliance-integrate-bootstrap.ts" \
  "root@${APPLIANCE_HOST}:/tmp/appliance-integrate-bootstrap.ts"
ssh_app "docker cp /tmp/appliance-integrate-bootstrap.ts appliance-ipam:/opt/da-ipam/scripts/appliance-integrate-bootstrap.ts"

echo ">>> [4/7] Recreate servizi (librenms + da-ipam)"
ssh_app "cd ${STACK_DIR} && docker compose up -d --force-recreate librenms da-ipam"

echo ">>> Attendo da-ipam..."
for _ in $(seq 1 40); do
  ssh_app "curl -sf http://127.0.0.1:3001/api/health >/dev/null 2>&1" && break
  sleep 2
done

echo ">>> [5/7] Bootstrap DB integrazioni"
ssh_app "docker exec \
  -e EDGE_TOKEN='${EDGE_TOKEN}' \
  -e APPLIANCE_HOST='${APPLIANCE_HOST}' \
  -e LIBRENMS_TOKEN='${LIBRENMS_TOKEN}' \
  -e NET_URL='https://${NET_SERVICES_HOST}:8443' \
  -e NET_TOKEN='${NET_TOKEN}' \
  -w /opt/da-ipam appliance-ipam \
  npx tsx scripts/appliance-integrate-bootstrap.ts"

echo ">>> [6/7] LibreNMS APP_URL + nginx Host :7443"
scp -i "$SSH_KEY" -o StrictHostKeyChecking=no \
  "$SCRIPT_DIR/appliance-librenms-fix-app-url.sh" \
  "root@${APPLIANCE_HOST}:/tmp/appliance-librenms-fix-app-url.sh"
ssh_app "chmod +x /tmp/appliance-librenms-fix-app-url.sh && APPLIANCE_LAN_IP='${APPLIANCE_HOST}' bash /tmp/appliance-librenms-fix-app-url.sh 'https://${APPLIANCE_HOST}:7443'"

echo ">>> [7/7] Verifica"
ssh_app "curl -sf http://127.0.0.1:3001/api/health" | python3 -m json.tool 2>/dev/null | head -25
ssh_app "curl -skI https://127.0.0.1:7443/ | grep -i location || true"
ssh_app "curl -sk -o /dev/null -w 'nginx7443:%{http_code}\n' https://127.0.0.1:7443/"
ssh_app "docker exec appliance-ipam curl -s -H 'X-Auth-Token: ${LIBRENMS_TOKEN}' -o /dev/null -w 'librenms_api:%{http_code}\n' 'http://127.0.0.1:8000/api/v0/devices?limit=1'"

echo ">>> Integrazioni appliance allineate."
