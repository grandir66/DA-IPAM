#!/usr/bin/env bash
# verifica-permessi.sh — i permessi visti dal di fuori, SOLO in locale (T3-30).
#
# Crea un utente viewer di prova nel database hub locale (password generata sul
# posto, mai stampata), fa solo GET senza sessione e da viewer sulle rotte che il
# censimento delle guardie indica, giudica le risposte, toglie l'utente.
# Logica: scripts/verifica-permessi.ts e src/lib/permessi/verifica-esterna.ts.
#
# Uso:  bash scripts/verifica-permessi.sh [http://127.0.0.1:3001]
#       con l'applicazione accesa in locale (npm run dev) sullo stesso database
#       hub (DA_INVENT_DATA_DIR o DA_IPAM_HUB_DB_PATH, come per l'applicazione).
# Esce: 0 tutto ok · 1 almeno un caso fallito · 2 configurazione sbagliata.
set -euo pipefail

URL="${1:-http://127.0.0.1:3001}"
case "${URL}" in
  http://127.0.0.1:*|http://127.0.0.1|http://localhost:*|http://localhost|http://\[::1\]:*) ;;
  *)
    echo "Solo in locale: ${URL} non è 127.0.0.1, localhost o ::1." >&2
    echo "Un'utenza di prova su un server vero è una scrittura in produzione." >&2
    exit 2
    ;;
esac

RADICE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${RADICE}"
exec npx tsx scripts/verifica-permessi.ts "${URL}"
