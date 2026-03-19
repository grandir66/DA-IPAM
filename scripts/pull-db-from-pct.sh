#!/usr/bin/env bash
#
# DA-INVENT — Opzionale: copia SOLO il database dal CT alla cartella data/ sul Mac
#
# La copia «buona» del progetto è la cartella sul Mac (Git + lavoro). Il CT è deploy.
# Questo script non sincronizza il codice: solo ipam.db (+ WAL) dal CT → sovrascrive i dati
# locali (con backup). Usalo solo se ti serve uno snapshot del DB del container.
#
# Esegui dalla root del progetto sul Mac, con SSH verso il nodo Proxmox.
#
# Uso:
#   ./scripts/pull-db-from-pct.sh
#   DA_INVENT_SSH=root@192.168.99.10 DA_INVENT_PCT=150 ./scripts/pull-db-from-pct.sh
#
# Variabili:
#   DA_INVENT_SSH     — utente@host Proxmox (default: root@192.168.99.10)
#   DA_INVENT_PCT     — VMID del CT (default: 150)
#   DA_INVENT_DIR_IN_CT — directory app nel CT (default: /opt/da-invent)
#
set -euo pipefail

SSH_TARGET="${DA_INVENT_SSH:-root@192.168.99.10}"
VMID="${DA_INVENT_PCT:-150}"
APP_IN_CT="${DA_INVENT_DIR_IN_CT:-/opt/da-invent}"
DATA_REMOTE="${APP_IN_CT}/data"

# Directory dati locale: repo root se esiste ./data, altrimenti cwd
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
if [[ -d "$REPO_ROOT/data" ]] || [[ "$PWD" = "$REPO_ROOT" ]]; then
  DATA_LOCAL="$REPO_ROOT/data"
else
  DATA_LOCAL="${DA_INVENT_DATA_DIR:-$PWD/data}"
fi

mkdir -p "$DATA_LOCAL"

TS="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="$DATA_LOCAL/.backup-before-pull-$TS"
mkdir -p "$BACKUP_DIR"

backup_if_exists() {
  local f="$1"
  [[ -f "$f" ]] && cp -p "$f" "$BACKUP_DIR/" && echo "  Salvato: $BACKUP_DIR/$(basename "$f")"
}

echo "=== Copia database da CT $VMID ($SSH_TARGET) → $DATA_LOCAL ==="
echo ""

echo ">>> Backup file locali esistenti (se presenti)..."
backup_if_exists "$DATA_LOCAL/ipam.db"
backup_if_exists "$DATA_LOCAL/ipam.db-wal"
backup_if_exists "$DATA_LOCAL/ipam.db-shm"
if [[ -z "$(ls -A "$BACKUP_DIR" 2>/dev/null)" ]]; then
  rmdir "$BACKUP_DIR" 2>/dev/null || true
  echo "    (nessun file precedente)"
else
  echo "    Cartella backup: $BACKUP_DIR"
fi
echo ""

echo ">>> Verifica file sul CT..."
ssh -o ConnectTimeout=15 -o BatchMode=yes "$SSH_TARGET" \
  "pct exec $VMID -- test -f $DATA_REMOTE/ipam.db" || {
  echo "Errore: $DATA_REMOTE/ipam.db non trovato nel CT $VMID."
  exit 1
}

pull_file() {
  local name="$1"
  if ssh -o ConnectTimeout=15 -o BatchMode=yes "$SSH_TARGET" \
    "pct exec $VMID -- test -f $DATA_REMOTE/$name" 2>/dev/null; then
    echo ">>> Scarico $name..."
    ssh -o BatchMode=yes "$SSH_TARGET" "pct exec $VMID -- cat $DATA_REMOTE/$name" > "$DATA_LOCAL/$name.tmp"
    mv -f "$DATA_LOCAL/$name.tmp" "$DATA_LOCAL/$name"
  else
    echo "    (assente sul CT: $name — skip)"
    rm -f "$DATA_LOCAL/$name"
  fi
}

pull_file ipam.db
pull_file ipam.db-wal
pull_file ipam.db-shm

echo ""
echo "=== Fatto ==="
echo "Database locale: $DATA_LOCAL/ipam.db"
ls -la "$DATA_LOCAL"/ipam.db* 2>/dev/null || true
echo ""
echo "Riavvia l'app locale (npm run dev / dev:server) dopo aver chiuso eventuali processi che tengono aperto il DB."
echo ""
