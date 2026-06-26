#!/bin/bash
# Wrapper Docker — delega allo script canonico in scripts/
set -euo pipefail
APP_DIR="${DA_INVENT_APP_DIR:-/opt/da-ipam}"
exec bash "${APP_DIR}/scripts/setup-winrm-venv.sh"
