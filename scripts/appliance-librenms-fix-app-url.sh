#!/usr/bin/env bash
# Fix LibreNMS redirect :7443 → :443 (DA-IPAM) quando APP_URL=/ o nginx passa Host senza porta.
#
# Uso (sulla VM app-stack):
#   bash appliance-librenms-fix-app-url.sh
#   bash appliance-librenms-fix-app-url.sh https://192.168.99.50:7443
set -euo pipefail

APP_URL="${1:-https://${APPLIANCE_LAN_IP:-192.168.99.50}:7443}"
CONTAINER="${LIBRENMS_CONTAINER:-appliance-librenms}"
NGINX_CONF="${NGINX_CONF:-/opt/appliance-stack/nginx/conf.d/default.conf}"
STACK_DIR="${STACK_DIR:-/opt/appliance-stack}"

docker exec "$CONTAINER" sh -c "grep -q '^APP_URL=' /data/.env 2>/dev/null && sed -i 's|^APP_URL=.*|APP_URL=${APP_URL}|' /data/.env || echo 'APP_URL=${APP_URL}' >> /data/.env"
docker exec "$CONTAINER" sh -c "grep -q '^APP_URL=' /opt/librenms/.env && sed -i 's|^APP_URL=.*|APP_URL=${APP_URL}|' /opt/librenms/.env || echo 'APP_URL=${APP_URL}' >> /opt/librenms/.env"
docker exec -u librenms "$CONTAINER" /opt/librenms/artisan config:clear
echo "[librenms] APP_URL=${APP_URL}"

if [ -f "$NGINX_CONF" ]; then
  python3 - <<PY
from pathlib import Path

p = Path("${NGINX_CONF}")
text = p.read_text()
marker = "# :7443 — LibreNMS"
if marker not in text:
    raise SystemExit(f"blocco LibreNMS non trovato in {p}")

before, after = text.split(marker, 1)
block, rest = after.split("\n}\n", 1)
block = block.replace("proxy_set_header Host \$host;", "proxy_set_header Host \$http_host;")
if "X-Forwarded-Port 7443" not in block:
    block = block.replace(
        "proxy_set_header Host \$http_host;",
        "proxy_set_header Host \$http_host;\n        proxy_set_header X-Forwarded-Port 7443;",
    )
if "proxy_redirect https://\$host/" not in block:
    block = block.replace(
        "proxy_http_version 1.1;",
        "proxy_http_version 1.1;\n        proxy_redirect https://\$host/ https://\$http_host/;\n        proxy_redirect http://\$host/ https://\$http_host/;",
    )
p.write_text(before + marker + block + "\n}\n" + rest)
print(f"[nginx] patchato {p}")
PY
  if docker compose -f "${STACK_DIR}/compose.yml" ps -q nginx >/dev/null 2>&1; then
    docker compose -f "${STACK_DIR}/compose.yml" restart nginx
    echo "[nginx] restart nginx"
  fi
fi
