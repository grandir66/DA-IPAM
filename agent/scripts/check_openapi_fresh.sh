#!/usr/bin/env bash
# Verifica che ``agent/openapi.json`` committato sia allineato con
# l'output corrente di ``dump_openapi.py``. Da chiamare in pre-commit o CI
# quando si toccano endpoint/models.
#
# Exit 0 se invariato, 1 se diverge.

set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
AGENT_ROOT="$(cd "$HERE/.." && pwd)"
COMMITTED="$AGENT_ROOT/openapi.json"

if [ ! -f "$COMMITTED" ]; then
    echo "ERROR: openapi.json mancante in $AGENT_ROOT — esegui 'python scripts/dump_openapi.py'." >&2
    exit 1
fi

PYTHON="${PYTHON:-$AGENT_ROOT/.venv/bin/python}"
if [ ! -x "$PYTHON" ]; then
    PYTHON="$(command -v python3 || true)"
fi
if [ -z "$PYTHON" ]; then
    echo "ERROR: nessun interprete Python disponibile." >&2
    exit 1
fi

TMP="$(mktemp -t openapi-check.XXXXXX.json)"
trap 'rm -f "$TMP"' EXIT

(
    cd "$AGENT_ROOT"
    "$PYTHON" scripts/dump_openapi.py "$TMP" >/dev/null
)

if diff -u "$COMMITTED" "$TMP" >/tmp/openapi-diff.out; then
    echo "OpenAPI committato è fresh."
    exit 0
else
    echo "ERROR: openapi.json non aggiornato. Diff:" >&2
    head -200 /tmp/openapi-diff.out >&2
    echo "" >&2
    echo "Esegui: cd agent && python scripts/dump_openapi.py" >&2
    exit 1
fi
