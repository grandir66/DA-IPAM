#!/usr/bin/env bash
#
# DA-INVENT — Bootstrap su Debian/Ubuntu (VM, bare metal o LXC senza wizard Proxmox)
#
# Installa gli strumenti minimi (git, curl), clona il repository ed esegue
# scripts/install.sh che scarica Node.js, dipendenze npm e compila l’app in locale.
#
# Esegui come root (es. sudo bash bootstrap-linux.sh). Non usare pipe da curl su stdin
# interattivo: salva lo script e avvialo da file.
#
#   curl -fsSL https://raw.githubusercontent.com/grandir66/DA-IPAM/main/scripts/bootstrap-linux.sh -o /tmp/da-invent-bootstrap-linux.sh \
#     && bash /tmp/da-invent-bootstrap-linux.sh
#
# Variabili d'ambiente (opzionali):
#   DA_INVENT_GIT_URL       — URL repository (default: repo pubblico)
#   DA_INVENT_BRANCH        — branch (default: main)
#   DA_INVENT_BOOTSTRAP_DIR — directory di installazione (default: /opt/da-invent)
#   DA_INVENT_SKIP_SYSTEMD  — se 1, non installa/avvia il servizio systemd
#
set -euo pipefail

DEFAULT_GIT_URL="https://github.com/grandir66/DA-IPAM.git"
REPO="${DA_INVENT_GIT_URL:-$DEFAULT_GIT_URL}"
BRANCH="${DA_INVENT_BRANCH:-main}"
TARGET="${DA_INVENT_BOOTSTRAP_DIR:-/opt/da-invent}"

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'
die() { echo -e "${RED}Errore:${NC} $*" >&2; exit 1; }
info() { echo -e "${GREEN}==>${NC} $*"; }

require_root() {
  [[ "$(id -u)" -eq 0 ]] || die "Esegui come root (es. sudo bash $0)."
}

ensure_git_curl() {
  if command -v git >/dev/null 2>&1 && command -v curl >/dev/null 2>&1; then
    return 0
  fi
  info "Installazione di git e curl (apt)…"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq git curl ca-certificates
}

clone_repo() {
  info "Clonazione repository in $TARGET (branch: $BRANCH)…"
  rm -rf "$TARGET"
  git clone --depth 1 --branch "$BRANCH" "$REPO" "$TARGET" || die "git clone fallito. Verifica URL e branch."
  [[ -f "$TARGET/scripts/install.sh" ]] || die "scripts/install.sh non trovato nel repository."
  chmod +x "$TARGET/scripts/install.sh"
}

main() {
  echo ""
  echo "DA-INVENT — Bootstrap Linux (Debian/Ubuntu)"
  echo ""
  require_root
  ensure_git_curl
  clone_repo
  export DA_INVENT_DIR="$TARGET"
  cd "$TARGET"
  info "Avvio installazione applicazione (dipendenze di sistema, Node, npm, build)…"
  if [[ "${DA_INVENT_SKIP_SYSTEMD:-}" == "1" ]]; then
    ./scripts/install.sh
  else
    ./scripts/install.sh --systemd
  fi
}

main "$@"
