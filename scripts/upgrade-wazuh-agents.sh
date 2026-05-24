#!/usr/bin/env bash
# DA-IPAM ↔ Wazuh — upgrade massivo agent via pacchetto nativo (bypass WPK).
#
# Risolve il problema "Send upgrade command error" / "Could not verify signature"
# riscontrato sui Wazuh manager 4.14 quando upgradano agent v4.11/v4.12: i WPK
# v4.14 sono firmati con una CA che il root_cert dell'agent vecchio non riconosce.
#
# Approccio: invece di passare per /agents/upgrade API (WPK-based), si fa SSH
# sull'host e si installa il pacchetto ufficiale (.deb / .rpm / .pkg / .msi).
#
# Due modalità:
#   --mode pkg       (default) installa pacchetto nativo, restart agent
#   --mode wpk-fix   aggiorna SOLO /var/ossec/etc/wpk_root.pem + restart,
#                    così l'upgrade via API riprende a funzionare
#
# Uso:
#   bash scripts/upgrade-wazuh-agents.sh --hosts hosts.txt --target 4.14.2
#   bash scripts/upgrade-wazuh-agents.sh --hosts hosts.txt --mode wpk-fix
#
# hosts.txt: una riga per host nel formato `user@host[:port]`
#   Esempio:
#     domarc@192.168.20.5     # da-omada
#     domarc@192.168.4.40     # da-observe
#     # commenti ignorati
#
# Opzioni SSH (jump host, identity) configurabili in ~/.ssh/config o via
# variabile env SSH_OPTS="-J root@192.168.40.4 -i ~/.ssh/da_key".

set -euo pipefail

# ─── defaults ────────────────────────────────────────────────────────────────

TARGET_VERSION="${TARGET_VERSION:-4.14.2}"
MODE="${MODE:-pkg}"          # pkg | wpk-fix
PARALLEL="${PARALLEL:-3}"
HOSTS_FILE=""
DRY_RUN=0
LOG_DIR="${LOG_DIR:-/tmp/wazuh-upgrade-$(date +%Y%m%d-%H%M%S)}"
SSH_OPTS="${SSH_OPTS:--o StrictHostKeyChecking=no -o ConnectTimeout=10 -o BatchMode=yes}"
WPK_ROOT_URL="${WPK_ROOT_URL:-https://packages.wazuh.com/key/wpk_root.pem}"

# ─── helpers ─────────────────────────────────────────────────────────────────

c_blu="\033[1;34m"; c_grn="\033[1;32m"; c_ylw="\033[1;33m"; c_red="\033[1;31m"; c_rst="\033[0m"
log()  { printf "${c_blu}[upgrade]${c_rst} %s\n" "$*" >&2; }
ok()   { printf "  ${c_grn}✓${c_rst} %s\n" "$*" >&2; }
warn() { printf "  ${c_ylw}!${c_rst} %s\n" "$*" >&2; }
err()  { printf "  ${c_red}✗${c_rst} %s\n" "$*" >&2; }

usage() {
  sed -n '2,32p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
}

# ─── argparse ────────────────────────────────────────────────────────────────

while [[ $# -gt 0 ]]; do
  case "$1" in
    --hosts)    HOSTS_FILE="$2"; shift 2;;
    --target)   TARGET_VERSION="$2"; shift 2;;
    --mode)     MODE="$2"; shift 2;;
    --parallel) PARALLEL="$2"; shift 2;;
    --dry-run)  DRY_RUN=1; shift;;
    --log-dir)  LOG_DIR="$2"; shift 2;;
    -h|--help)  usage;;
    *)          err "Argomento sconosciuto: $1"; exit 1;;
  esac
done

[[ -z "$HOSTS_FILE" || ! -f "$HOSTS_FILE" ]] && { err "--hosts FILE mancante o non esiste"; exit 2; }
[[ "$MODE" != "pkg" && "$MODE" != "wpk-fix" ]] && { err "--mode pkg|wpk-fix"; exit 2; }
mkdir -p "$LOG_DIR"

# ─── per-host worker ─────────────────────────────────────────────────────────

upgrade_pkg() {
  local HOST=$1
  local LOG="$LOG_DIR/${HOST//[^a-zA-Z0-9]/_}.log"
  {
    echo "═══ $HOST ($(date -u +%H:%M:%SZ)) ═══"

    # 1) detect OS
    local OS_INFO
    OS_INFO=$(ssh $SSH_OPTS "$HOST" 'cat /etc/os-release 2>/dev/null || sw_vers 2>/dev/null || ver 2>/dev/null')
    if [[ -z "$OS_INFO" ]]; then
      echo "ERROR: SSH ko o OS non identificato"; return 1
    fi

    local OS_FAMILY ARCH PKG URL CHECK_BIN INSTALL_CMD
    if grep -qiE 'ubuntu|debian' <<<"$OS_INFO"; then
      OS_FAMILY=deb
      ARCH=$(ssh $SSH_OPTS "$HOST" 'dpkg --print-architecture')
      PKG="wazuh-agent_${TARGET_VERSION}-1_${ARCH}.deb"
      URL="https://packages.wazuh.com/4.x/apt/pool/main/w/wazuh-agent/$PKG"
      INSTALL_CMD="sudo dpkg -i /tmp/$PKG && sudo systemctl restart wazuh-agent"
      CHECK_BIN="/var/ossec/bin/wazuh-control"
    elif grep -qiE 'rhel|centos|rocky|alma|fedora|amazon|suse' <<<"$OS_INFO"; then
      OS_FAMILY=rpm
      ARCH=$(ssh $SSH_OPTS "$HOST" 'uname -m')
      PKG="wazuh-agent-${TARGET_VERSION}-1.${ARCH}.rpm"
      URL="https://packages.wazuh.com/4.x/yum/$PKG"
      INSTALL_CMD="sudo rpm -U --force /tmp/$PKG && sudo systemctl restart wazuh-agent"
      CHECK_BIN="/var/ossec/bin/wazuh-control"
    elif grep -qiE 'darwin|productname.*mac' <<<"$OS_INFO"; then
      OS_FAMILY=pkg
      ARCH=$(ssh $SSH_OPTS "$HOST" 'uname -m')
      [[ "$ARCH" == "arm64" ]] && ARCH=arm64 || ARCH=intel64
      PKG="wazuh-agent-${TARGET_VERSION}-1.${ARCH}.pkg"
      URL="https://packages.wazuh.com/4.x/macos/$PKG"
      INSTALL_CMD="sudo installer -pkg /tmp/$PKG -target / && sudo /Library/Ossec/bin/wazuh-control restart"
      CHECK_BIN="/Library/Ossec/bin/wazuh-control"
    else
      # Windows si fa via WinRM/PSExec, non SSH — skip
      echo "ERROR: OS non supportato via SSH (Windows usa WinRM separato)"
      return 1
    fi

    echo "OS=$OS_FAMILY  ARCH=$ARCH  PKG=$PKG"

    # 2) versione corrente
    local OLD_VER
    OLD_VER=$(ssh $SSH_OPTS "$HOST" "$CHECK_BIN info 2>/dev/null | grep -E '^WAZUH_VERSION' | cut -d'\"' -f2" 2>&1)
    echo "Versione attuale: ${OLD_VER:-sconosciuta}"

    if [[ "$OLD_VER" == "v$TARGET_VERSION" || "$OLD_VER" == "$TARGET_VERSION" ]]; then
      echo "SKIP: già a $TARGET_VERSION"; return 0
    fi

    if [[ $DRY_RUN -eq 1 ]]; then
      echo "DRY-RUN: scaricherei $URL → installerei → restart"
      return 0
    fi

    # 3) download + install
    echo "Download + install in corso..."
    ssh $SSH_OPTS "$HOST" "curl -fsSL -o /tmp/$PKG '$URL' && $INSTALL_CMD && rm -f /tmp/$PKG" 2>&1
    local RC=$?
    [[ $RC -ne 0 ]] && { echo "ERROR: install failed (rc=$RC)"; return $RC; }

    # 4) verifica
    sleep 6
    local NEW_VER
    NEW_VER=$(ssh $SSH_OPTS "$HOST" "$CHECK_BIN info 2>/dev/null | grep -E '^WAZUH_VERSION' | cut -d'\"' -f2" 2>&1)
    echo "Versione nuova:    ${NEW_VER:-sconosciuta}"

    if [[ "$NEW_VER" == "v$TARGET_VERSION" || "$NEW_VER" == "$TARGET_VERSION" ]]; then
      echo "SUCCESS"; return 0
    else
      echo "MISMATCH: atteso $TARGET_VERSION, ottenuto $NEW_VER"; return 1
    fi
  } 2>&1 | tee "$LOG"
}

wpk_fix_one() {
  local HOST=$1
  local LOG="$LOG_DIR/${HOST//[^a-zA-Z0-9]/_}.wpkfix.log"
  {
    echo "═══ $HOST ($(date -u +%H:%M:%SZ)) — WPK fix ═══"
    local AGENT_DIR
    AGENT_DIR=$(ssh $SSH_OPTS "$HOST" 'test -d /Library/Ossec && echo /Library/Ossec || echo /var/ossec')
    echo "agent dir: $AGENT_DIR"

    if [[ $DRY_RUN -eq 1 ]]; then
      echo "DRY-RUN: scaricherei $WPK_ROOT_URL → $AGENT_DIR/etc/wpk_root.pem"
      return 0
    fi

    ssh $SSH_OPTS "$HOST" "
      set -e
      sudo cp $AGENT_DIR/etc/wpk_root.pem $AGENT_DIR/etc/wpk_root.pem.bak.\$(date +%F)
      sudo curl -fsSL -o $AGENT_DIR/etc/wpk_root.pem '$WPK_ROOT_URL'
      sudo $AGENT_DIR/bin/wazuh-control restart
    " 2>&1
    local RC=$?
    [[ $RC -eq 0 ]] && echo "SUCCESS: wpk_root.pem rotated, agent restarted"
    return $RC
  } 2>&1 | tee "$LOG"
}

export -f upgrade_pkg wpk_fix_one log ok warn err
export SSH_OPTS TARGET_VERSION DRY_RUN LOG_DIR WPK_ROOT_URL

# ─── flusso ──────────────────────────────────────────────────────────────────

log "Modalità: $MODE   Target: $TARGET_VERSION   Parallel: $PARALLEL   Log: $LOG_DIR"

HOSTS=$(grep -vE '^\s*#|^\s*$' "$HOSTS_FILE")
N=$(wc -l <<<"$HOSTS")
log "$N host da processare"

if [[ "$MODE" == "pkg" ]]; then
  printf '%s\n' "$HOSTS" | xargs -P "$PARALLEL" -I{} bash -c 'upgrade_pkg "$@"' _ {}
else
  printf '%s\n' "$HOSTS" | xargs -P "$PARALLEL" -I{} bash -c 'wpk_fix_one "$@"' _ {}
fi

echo ""
log "═══ SUMMARY ═══"
SUCC=$(grep -l "^SUCCESS$" "$LOG_DIR"/*.log 2>/dev/null | wc -l)
SKIP=$(grep -l "^SKIP:" "$LOG_DIR"/*.log 2>/dev/null | wc -l)
FAIL=$(grep -l "^ERROR:\|^MISMATCH:" "$LOG_DIR"/*.log 2>/dev/null | wc -l)
echo "  SUCCESS: $SUCC"
echo "  SKIP:    $SKIP (già aggiornati)"
echo "  FAIL:    $FAIL"
echo "  Log per host: $LOG_DIR/"

if [[ "$FAIL" -gt 0 ]]; then
  echo ""
  warn "Host falliti:"
  grep -l "^ERROR:\|^MISMATCH:" "$LOG_DIR"/*.log 2>/dev/null | sed 's|^|  - |'
  exit 1
fi
exit 0
