#!/bin/bash
# Backup database DA-INVENT con retention
set -e

DB_PATH="${DB_PATH:-data/ipam.db}"
BACKUP_DIR="${BACKUP_DIR:-data/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"

mkdir -p "$BACKUP_DIR"

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/ipam_${TIMESTAMP}.db"

# Usa sqlite3 .backup per copia consistente (senza lock WAL)
if command -v sqlite3 &> /dev/null; then
  sqlite3 "$DB_PATH" ".backup '$BACKUP_FILE'"
else
  cp "$DB_PATH" "$BACKUP_FILE"
fi

# Comprimi
gzip "$BACKUP_FILE"
echo "✓ Backup: ${BACKUP_FILE}.gz"

# Pulizia backup vecchi
find "$BACKUP_DIR" -name "ipam_*.db.gz" -mtime +${RETENTION_DAYS} -delete
echo "✓ Rimossi backup più vecchi di ${RETENTION_DAYS} giorni"
