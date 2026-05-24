#!/usr/bin/env bash
# DA-IPAM ↔ Wazuh — upgrade Linux agent via SSH con autenticazione PASSWORD.
#
# Variante di scripts/upgrade-wazuh-agents.sh dedicata al caso in cui NON hai
# chiavi SSH configurate sugli host target — usa sshpass + password fornite
# in un file CSV.
#
# Per OGNI host nel file di input:
#   1. ssh con password (sshpass)
#   2. detect OS (Ubuntu/Debian o RHEL-like)
#   3. download pacchetto Wazuh agent target
#   4. install via sudo (con password sudo separata se necessaria)
#   5. restart wazuh-agent + verifica versione
#
# REQUISITI
#   - macOS: brew install hudochenkov/sshpass/sshpass
#   - Debian/Ubuntu: apt install sshpass
#   - RHEL/Rocky: dnf install sshpass
#
# FORMATO FILE INPUT (separatore: pipe |)
#   # commenti consentiti, righe vuote ignorate
#   # ip|ssh_user|ssh_password[|sudo_password]
#   # se sudo_password manca, viene usata la ssh_password
#   192.168.20.5|domarc|sshpass123|sudopass456
#   192.168.4.40|domarc|pass789
#
# SICUREZZA
#   - Il file con le password deve avere permessi 0600.
#   - Le password NON vengono mai stampate nei log per host.
#   - Aggiungi il file a .gitignore (es. wazuh-hosts-pwd.txt è già escluso).
#
# USO
#   bash scripts/upgrade-wazuh-agents-pwd.sh --hosts wazuh-hosts-pwd.txt
#   bash scripts/upgrade-wazuh-agents-pwd.sh --hosts ... --target 4.14.5 --dry-run

set -euo pipefail

# ─── defaults ────────────────────────────────────────────────────────────────

TARGET_VERSION="${TARGET_VERSION:-4.14.5}"
HOSTS_FILE=""
DRY_RUN=0
PARALLEL="${PARALLEL:-1}"  # serial di default per debug più semplice
LOG_DIR="${LOG_DIR:-/tmp/wazuh-upgrade-pwd-$(date +%Y%m%d-%H%M%S)}"
SSH_OPTS="-o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 -o LogLevel=ERROR -o PreferredAuthentications=password -o PubkeyAuthentication=no"

# ─── helpers ─────────────────────────────────────────────────────────────────

c_blu="\033[1;34m"; c_grn="\033[1;32m"; c_ylw="\033[1;33m"; c_red="\033[1;31m"; c_rst="\033[0m"
log()  { printf "${c_blu}[upgrade-pwd]${c_rst} %s\n" "$*" >&2; }
ok()   { printf "  ${c_grn}✓${c_rst} %s\n" "$*" >&2; }
warn() { printf "  ${c_ylw}!${c_rst} %s\n" "$*" >&2; }
err()  { printf "  ${c_red}✗${c_rst} %s\n" "$*" >&2; }

usage() {
  sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
}

# ─── argparse ────────────────────────────────────────────────────────────────

while [[ $# -gt 0 ]]; do
  case "$1" in
    --hosts)    HOSTS_FILE="$2"; shift 2;;
    --target)   TARGET_VERSION="$2"; shift 2;;
    --parallel) PARALLEL="$2"; shift 2;;
    --dry-run)  DRY_RUN=1; shift;;
    --log-dir)  LOG_DIR="$2"; shift 2;;
    -h|--help)  usage;;
    *)          err "Argomento sconosciuto: $1"; exit 1;;
  esac
done

# ─── precondizioni ───────────────────────────────────────────────────────────

[[ -z "$HOSTS_FILE" || ! -f "$HOSTS_FILE" ]] && { err "--hosts FILE richiesto"; exit 2; }

if ! command -v sshpass >/dev/null; then
  err "sshpass non installato."
  cat >&2 <<EOF
  Installa:
    macOS:    brew install hudochenkov/sshpass/sshpass
    Debian:   sudo apt install sshpass
    RHEL:     sudo dnf install sshpass
EOF
  exit 3
fi

# Verifica permessi file (warn se world-readable)
PERMS=$(stat -f '%Lp' "$HOSTS_FILE" 2>/dev/null || stat -c '%a' "$HOSTS_FILE" 2>/dev/null)
if [[ "$PERMS" != "600" && "$PERMS" != "400" ]]; then
  warn "$HOSTS_FILE ha permessi $PERMS — dovrebbe essere 600 (chmod 600 $HOSTS_FILE)"
fi

mkdir -p "$LOG_DIR"

# ─── per-host worker ─────────────────────────────────────────────────────────

upgrade_one() {
  local IP=$1 USER=$2 SSH_PASS=$3 SUDO_PASS=$4
  local LOG="$LOG_DIR/${IP//./_}.log"
  {
    echo "═══ $IP @ $(date -u +%H:%M:%SZ) ═══"
    echo "user: $USER"

    # 1) test SSH base
    local OS_INFO
    OS_INFO=$(sshpass -p "$SSH_PASS" ssh $SSH_OPTS "$USER@$IP" 'cat /etc/os-release 2>/dev/null' 2>&1)
    if [[ -z "$OS_INFO" || "$OS_INFO" =~ "Permission denied" || "$OS_INFO" =~ "Connection" ]]; then
      echo "ERROR: SSH ko — $(echo "$OS_INFO" | head -1)"
      return 1
    fi

    # 2) detect OS family
    local OS_FAMILY ARCH PKG URL INSTALL_CMD
    if grep -qiE 'ubuntu|debian' <<<"$OS_INFO"; then
      OS_FAMILY=deb
      ARCH=$(sshpass -p "$SSH_PASS" ssh $SSH_OPTS "$USER@$IP" 'dpkg --print-architecture')
      PKG="wazuh-agent_${TARGET_VERSION}-1_${ARCH}.deb"
      URL="https://packages.wazuh.com/4.x/apt/pool/main/w/wazuh-agent/$PKG"
      INSTALL_CMD="dpkg -i /tmp/$PKG && systemctl restart wazuh-agent"
    elif grep -qiE 'rhel|centos|rocky|alma|fedora|amazon|suse' <<<"$OS_INFO"; then
      OS_FAMILY=rpm
      ARCH=$(sshpass -p "$SSH_PASS" ssh $SSH_OPTS "$USER@$IP" 'uname -m')
      PKG="wazuh-agent-${TARGET_VERSION}-1.${ARCH}.rpm"
      URL="https://packages.wazuh.com/4.x/yum/$PKG"
      INSTALL_CMD="rpm -U --force /tmp/$PKG && systemctl restart wazuh-agent"
    else
      echo "ERROR: OS non supportato (mostra cat /etc/os-release)"
      return 1
    fi
    echo "os: $OS_FAMILY  arch: $ARCH  pkg: $PKG"

    # 3) versione corrente
    local OLD_VER
    OLD_VER=$(sshpass -p "$SSH_PASS" ssh $SSH_OPTS "$USER@$IP" \
      "/var/ossec/bin/wazuh-control info 2>/dev/null | grep ^WAZUH_VERSION | cut -d'\"' -f2" 2>/dev/null || echo "?")
    echo "versione attuale: $OLD_VER"

    if [[ "$OLD_VER" == "v$TARGET_VERSION" || "$OLD_VER" == "$TARGET_VERSION" ]]; then
      echo "SKIP: già a $TARGET_VERSION"
      return 0
    fi

    if [[ $DRY_RUN -eq 1 ]]; then
      echo "DRY-RUN: scaricherei $URL → sudo $INSTALL_CMD"
      return 0
    fi

    # 4) install (sudo via -S con stdin password)
    # Nota: usa `sudo -S -p ''` per leggere password da stdin senza prompt visibile.
    echo "esecuzione install (download + dpkg/rpm + restart)..."
    local FULL_CMD="curl -fsSL -o /tmp/$PKG '$URL' && echo '$SUDO_PASS' | sudo -S -p '' bash -c '$INSTALL_CMD' && rm -f /tmp/$PKG"
    sshpass -p "$SSH_PASS" ssh $SSH_OPTS "$USER@$IP" "$FULL_CMD" 2>&1 | sed "s|$SUDO_PASS|***|g; s|$SSH_PASS|***|g"
    local RC=${PIPESTATUS[0]}
    if [[ $RC -ne 0 ]]; then
      echo "ERROR: install fallita (rc=$RC)"
      return $RC
    fi

    # 5) verifica
    sleep 6
    local NEW_VER
    NEW_VER=$(sshpass -p "$SSH_PASS" ssh $SSH_OPTS "$USER@$IP" \
      "/var/ossec/bin/wazuh-control info 2>/dev/null | grep ^WAZUH_VERSION | cut -d'\"' -f2" 2>/dev/null || echo "?")
    echo "versione nuova:   $NEW_VER"

    if [[ "$NEW_VER" == "v$TARGET_VERSION" || "$NEW_VER" == "$TARGET_VERSION" ]]; then
      echo "SUCCESS"
      return 0
    else
      echo "MISMATCH: atteso $TARGET_VERSION, ottenuto $NEW_VER"
      return 1
    fi
  } 2>&1 | tee "$LOG"
}

export -f upgrade_one
export SSH_OPTS TARGET_VERSION DRY_RUN LOG_DIR

# ─── flusso ──────────────────────────────────────────────────────────────────

log "Target: $TARGET_VERSION   Parallel: $PARALLEL   Log: $LOG_DIR"

N=$(grep -cvE '^\s*#|^\s*$' "$HOSTS_FILE")
log "$N host da processare"
echo ""

# Leggi riga per riga (gestione separatore | con read -d)
RC_TOTAL=0
while IFS='|' read -r IP USER SSH_PASS SUDO_PASS; do
  [[ -z "$IP" || "$IP" =~ ^[[:space:]]*# ]] && continue
  IP=$(echo "$IP" | tr -d '[:space:]')
  USER=$(echo "$USER" | tr -d '[:space:]')
  SSH_PASS="${SSH_PASS:-}"
  SUDO_PASS="${SUDO_PASS:-$SSH_PASS}"
  [[ -z "$IP" || -z "$USER" || -z "$SSH_PASS" ]] && { warn "Riga incompleta skippata: $IP"; continue; }
  upgrade_one "$IP" "$USER" "$SSH_PASS" "$SUDO_PASS" || RC_TOTAL=$((RC_TOTAL+1))
  echo ""
done < "$HOSTS_FILE"

# ─── summary ─────────────────────────────────────────────────────────────────

echo ""
log "═══ SUMMARY ═══"
SUCC=$(grep -l "^SUCCESS$" "$LOG_DIR"/*.log 2>/dev/null | wc -l | tr -d ' ')
SKIP=$(grep -l "^SKIP:" "$LOG_DIR"/*.log 2>/dev/null | wc -l | tr -d ' ')
FAIL=$(grep -l "^ERROR:\|^MISMATCH:" "$LOG_DIR"/*.log 2>/dev/null | wc -l | tr -d ' ')
echo "  SUCCESS: $SUCC"
echo "  SKIP:    $SKIP (già aggiornati)"
echo "  FAIL:    $FAIL"
echo "  Log per host: $LOG_DIR/"

if [[ "$FAIL" -gt 0 ]]; then
  echo ""
  warn "Host falliti:"
  grep -l "^ERROR:\|^MISMATCH:" "$LOG_DIR"/*.log 2>/dev/null | while read -r f; do
    NAME=$(basename "$f" .log | tr '_' '.')
    REASON=$(grep -E "^ERROR:|^MISMATCH:" "$f" | head -1)
    echo "  - $NAME: $REASON"
  done
  exit 1
fi
exit 0
