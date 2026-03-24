#!/usr/bin/env bash
# DA-INVENT — Rimuove l'unità systemd e indica come fare setup da zero.
#
# Non elimina la directory dell'app (serve backup manuale). Esegui come root.
#
# Variabili (opzionali):
#   DA_INVENT_SERVICE_NAME — nome unità (default: da-invent)
#   DA_INVENT_DIR          — directory installazione (default: /opt/da-invent)
#
# Uso: sudo bash scripts/uninstall-da-invent.sh

set -euo pipefail

APP_NAME="${DA_INVENT_SERVICE_NAME:-da-invent}"
APP_DIR="${DA_INVENT_DIR:-/opt/da-invent}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Errore: eseguire come root, es.: sudo bash $0"
  exit 1
fi

echo "=== Disinstallazione servizio systemd ($APP_NAME) ==="

if systemctl list-unit-files "${APP_NAME}.service" &>/dev/null || systemctl cat "${APP_NAME}.service" &>/dev/null; then
  systemctl stop "$APP_NAME" 2>/dev/null || true
  systemctl disable "$APP_NAME" 2>/dev/null || true
fi

SERVICE_FILE="/etc/systemd/system/${APP_NAME}.service"
if [[ -f "$SERVICE_FILE" ]]; then
  rm -f "$SERVICE_FILE"
  echo "Rimosso: $SERVICE_FILE"
else
  echo "Nessun file $SERVICE_FILE (già assente o nome servizio diverso)."
fi

systemctl daemon-reload
echo "systemctl daemon-reload eseguito."

echo ""
echo "────────────────────────────────────────────────────────────"
echo "Setup da zero — scegli UNA delle due strade:"
echo ""
echo "A) Reinstallazione completa (rimuove codice, node_modules, dati)"
echo "   1. Backup:  tar czf ~/da-invent-backup.tgz \"$APP_DIR/data\" \"$APP_DIR/.env.local\" 2>/dev/null || true"
echo "   2. Elimina: rm -rf \"$APP_DIR\""
echo "   3. Clone + install (da README): bootstrap-linux.sh oppure:"
echo "      git clone https://github.com/grandir66/DA-IPAM.git \"$APP_DIR\""
echo "      cd \"$APP_DIR\" && chmod +x scripts/install.sh && ./scripts/install.sh --systemd"
echo ""
echo "B) Stesso clone, solo database nuovo (torna /setup, tieni node_modules)"
echo "   1. Assicurati che il servizio sia fermo: systemctl stop $APP_NAME (già fatto sopra)"
echo "   2. Rimuovi i DB (hub + tenant + legacy):"
echo "      rm -f \"$APP_DIR/data/hub.db\" \"$APP_DIR/data/hub.db-wal\" \"$APP_DIR/data/hub.db-shm\""
echo "      rm -f \"$APP_DIR/data/ipam.db\" \"$APP_DIR/data/ipam.db-wal\" \"$APP_DIR/data/ipam.db-shm\""
echo "      rm -f $APP_DIR/data/tenants/*.db $APP_DIR/data/tenants/*.db-wal $APP_DIR/data/tenants/*.db-shm 2>/dev/null || true"
echo "   3. Template DB: deve esistere \"$APP_DIR/data/ipam.empty.db\" (dal repo). Se manca, dal clone: npm run db:empty"
echo "   4. Opzionale: nuove chiavi — rimuovi o svuota .env.local (ENCRYPTION_KEY / AUTH_SECRET) solo se accetti di riconfigurare tutto"
echo "   5. Riavvia: cd \"$APP_DIR\" && ./scripts/install.sh --systemd   oppure   systemctl start $APP_NAME"
echo "   6. Apri /setup per creare di nuovo il primo utente"
echo "────────────────────────────────────────────────────────────"
