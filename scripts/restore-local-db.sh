#!/usr/bin/env bash
#
# Ripristina data/ipam.db sul Mac da un file di backup (.backup-* o copia manuale).
# Rimuove ipam.db-wal e ipam.db-shm (vecchi WAL non vanno mescolati con un .db ripristinato).
#
# Uso (dalla root del repo):
#   ./scripts/restore-local-db.sh data/ipam.db.backup-20260320-003317
#
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DATA="$REPO_ROOT/data"

BACKUP="${1:-}"
if [[ -z "$BACKUP" ]]; then
  echo "Uso: $0 <percorso-file-backup>" >&2
  echo "Esempio: $0 $DATA/ipam.db.backup-20260320-003317" >&2
  exit 1
fi
if [[ ! -f "$BACKUP" ]]; then
  echo "Errore: file non trovato: $BACKUP" >&2
  exit 1
fi

TS="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$DATA/.before-restore-$TS"
[[ -f "$DATA/ipam.db" ]] && cp -p "$DATA/ipam.db" "$DATA/.before-restore-$TS/" || true
[[ -f "$DATA/ipam.db-wal" ]] && cp -p "$DATA/ipam.db-wal" "$DATA/.before-restore-$TS/" || true
[[ -f "$DATA/ipam.db-shm" ]] && cp -p "$DATA/ipam.db-shm" "$DATA/.before-restore-$TS/" || true

rm -f "$DATA/ipam.db-wal" "$DATA/ipam.db-shm"
cp -p "$BACKUP" "$DATA/ipam.db"
echo "Ripristinato: $DATA/ipam.db da $BACKUP"
echo "Backup stato precedente: $DATA/.before-restore-$TS"
echo "Riavvia npm run dev (o dev:server) dopo aver chiuso i processi che tenevano aperto il DB."
