#!/usr/bin/env bash
# Push inventario GLPI Agent → DA-IPAM (Linux / macOS).
# Richiede: glpi-agent (glpi-inventory), curl, jq opzionale.
#
# Variabili:
#   INGEST_URL   — es. https://da-ipam.example/api/inventory/ingest
#   INGEST_TOKEN — Bearer token da Impostazioni → Inventory Agent
#
# Cron esempio (ogni 6h):
#   0 */6 * * * INGEST_URL=... INGEST_TOKEN=... /opt/domarc/push-inventory-agent.sh

set -euo pipefail

INGEST_URL="${INGEST_URL:?INGEST_URL obbligatorio}"
INGEST_TOKEN="${INGEST_TOKEN:?INGEST_TOKEN obbligatorio}"

if ! command -v glpi-inventory >/dev/null 2>&1; then
  echo "glpi-inventory non trovato — installa GLPI Agent" >&2
  exit 1
fi

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

glpi-inventory --json >"$TMP" 2>/dev/null || {
  echo "glpi-inventory fallito" >&2
  exit 1
}

HTTP_CODE="$(curl -fsSk -o /dev/null -w '%{http_code}' -X POST \
  -H "Authorization: Bearer ${INGEST_TOKEN}" \
  -H "Content-Type: application/json" \
  --data-binary @"$TMP" \
  "$INGEST_URL" || echo "000")"

if [[ "$HTTP_CODE" != "200" ]]; then
  echo "Ingest fallito HTTP $HTTP_CODE" >&2
  exit 1
fi

echo "Inventario inviato OK"
