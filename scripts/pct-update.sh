#!/bin/bash
# DA-INVENT — Aggiorna l'istanza dentro un LXC da nodo Proxmox VE
#
# Esegui come root sul nodo Proxmox (non dentro il CT).
# Esegue: pct exec → cd /opt/da-invent → scripts/update.sh --restart
#
# Uso:
#   ./scripts/pct-update.sh 150
#   DA_INVENT_PCT=150 ./scripts/pct-update.sh
#   DA_INVENT_DIR=/opt/da-invent DA_INVENT_PCT=150 ./scripts/pct-update.sh
#
set -euo pipefail

VMID="${1:-${DA_INVENT_PCT:-}}"
APP_DIR_IN_CT="${DA_INVENT_DIR:-/opt/da-invent}"

if [[ -z "$VMID" ]]; then
  echo "Uso: $0 <VMID>"
  echo "  oppure: DA_INVENT_PCT=<VMID> $0"
  echo "Directory app nel CT (default $APP_DIR_IN_CT): variabile DA_INVENT_DIR"
  exit 1
fi

command -v pct >/dev/null 2>&1 || { echo "Errore: eseguire questo script sul nodo Proxmox (comando pct non trovato)."; exit 1; }

if ! pct config "$VMID" >/dev/null 2>&1; then
  echo "Errore: container CT $VMID non trovato o non accessibile."
  exit 1
fi

echo "=== Aggiornamento DA-INVENT nel CT $VMID ==="
echo "Directory nel CT: $APP_DIR_IN_CT"
echo ""

pct exec "$VMID" -- bash -ce "
  set -e
  cd '$APP_DIR_IN_CT'
  if [ ! -d .git ]; then
    echo \"Errore: $APP_DIR_IN_CT non è un clone Git.\"
    exit 1
  fi
  chmod +x scripts/update.sh 2>/dev/null || true
  ./scripts/update.sh --restart
"

echo ""
echo "=== Completato (CT $VMID) ==="
echo "Stato servizio: pct exec $VMID -- systemctl status da-invent --no-pager"
echo ""
