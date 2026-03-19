#!/usr/bin/env bash
# Diagnostica rapida: server in ascolto su 3001 e API health (Mac / Linux).
# Uso: dalla root del repo, con o senza dev già avviato:
#   ./scripts/dev-doctor.sh
#
set -euo pipefail
PORT="${PORT:-3001}"
BASE="http://127.0.0.1:${PORT}"

echo "=== DA-INVENT dev doctor (porta $PORT) ==="
echo ""

if lsof -i ":$PORT" -sTCP:LISTEN -n -P 2>/dev/null | head -5; then
  echo ">>> Qualcosa è in ascolto su :$PORT"
else
  echo ">>> NESSUN processo in ascolto su :$PORT"
  echo "    Avvia il server in un altro terminale:"
  echo "      cd $(pwd) && npm run dev"
  echo ""
fi

echo ">>> GET $BASE/api/health"
if code=$(curl -sS -o /tmp/da-invent-health.json -w "%{http_code}" --connect-timeout 3 "$BASE/api/health" 2>/dev/null); then
  echo "    HTTP $code"
  cat /tmp/da-invent-health.json 2>/dev/null | head -c 400 || true
  echo ""
else
  echo "    Connessione fallita: il dev server non risponde o usa un’altra porta."
  echo "    Apri nel browser: $BASE (HTTP, non HTTPS, se usi npm run dev)."
fi
echo ""
echo ">>> Suggerimenti"
echo "    - URL: http://127.0.0.1:$PORT o http://localhost:$PORT"
echo "    - Con npm run start + TLS in .env.local usa https://127.0.0.1:$PORT"
echo "    - Se la pagina resta su «Caricamento…» oltre ~12s, aggiorna: abbiamo un timeout di sicurezza sulla login."
echo ""
