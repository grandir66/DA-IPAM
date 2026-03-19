#!/usr/bin/env bash
#
# DA-INVENT — Scarica il repository da Git ed avvia il wizard LXC su Proxmox VE
#
# Esegui sul nodo Proxmox come root. NON usare "curl ... | bash" (stdin deve restare
# il terminale per le domande interattive del wizard).
#
# Comando consigliato (una riga):
#   curl -fsSL https://raw.githubusercontent.com/grandir66/DA-IPAM/main/scripts/bootstrap-proxmox.sh -o /tmp/da-invent-bootstrap.sh && bash /tmp/da-invent-bootstrap.sh
#
# Variabili d'ambiente (opzionali):
#   DA_INVENT_GIT_URL      — URL clone Git (default: repo pubblico grandir66/DA-IPAM)
#   DA_INVENT_BRANCH       — branch da clonare (default: main)
#   DA_INVENT_BOOTSTRAP_DIR — directory di lavoro (default: /root/da-invent-install)
#
set -euo pipefail

DEFAULT_GIT_URL="https://github.com/grandir66/DA-IPAM.git"
REPO="${DA_INVENT_GIT_URL:-$DEFAULT_GIT_URL}"
BRANCH="${DA_INVENT_BRANCH:-main}"
TARGET="${DA_INVENT_BOOTSTRAP_DIR:-/root/da-invent-install}"

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'
die() { echo -e "${RED}Errore:${NC} $*" >&2; exit 1; }
info() { echo -e "${GREEN}==>${NC} $*"; }

require_root() {
  [[ "$(id -u)" -eq 0 ]] || die "Esegui come root sul nodo Proxmox (es. ssh root@nodo-pve)."
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
  [[ -x "$TARGET/scripts/proxmox-lxc-install.sh" ]] || chmod +x "$TARGET/scripts/proxmox-lxc-install.sh"
  [[ -f "$TARGET/scripts/proxmox-lxc-install.sh" ]] || die "Script proxmox-lxc-install.sh non trovato nel repository."
}

main() {
  echo ""
  echo "DA-INVENT — Bootstrap Proxmox (download Git + wizard LXC)"
  echo ""
  require_root
  ensure_git_curl
  clone_repo
  info "Avvio wizard creazione container…"
  echo ""
  export DA_INVENT_GIT_URL="$REPO"
  exec "$TARGET/scripts/proxmox-lxc-install.sh"
}

main "$@"
