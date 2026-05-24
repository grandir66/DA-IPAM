#!/usr/bin/env bash
# Deploy della chiave SSH personale su tutti gli host Linux Domarc.
#
# Uso (defaults Domarc già pronti):
#   bash scripts/deploy-ssh-key.sh
#
# Con override:
#   bash scripts/deploy-ssh-key.sh \
#     --key ~/.ssh/id_ed25519.pub \
#     --user admin \
#     --jump root@192.168.40.4 \
#     --hosts /path/to/hosts.txt
#
# Ti chiederà la password SSH 1 volta per host. È idempotente: se la chiave
# è già autorizzata stampa "All keys were skipped because they already exist".
#
# Verifica finale automatica: per ogni host fa un BatchMode ssh + hostname.

set -euo pipefail

# ─── defaults ────────────────────────────────────────────────────────────────

KEY="${KEY:-$HOME/.ssh/id_rsa.pub}"
USER_DEFAULT="${USER_DEFAULT:-domarc}"
JUMP="${JUMP:-root@192.168.40.4}"
HOSTS_FILE=""
DRY_RUN=0
SKIP_VERIFY=0

# Lista default host Linux Domarc (active, da inventario Wazuh 2026-05-24).
# Formato: "user@ip  # nome agent". Modifica USER se l'utente è diverso da $USER_DEFAULT.
DEFAULT_HOSTS=(
  "domarc@192.168.4.40    # DA-OBSERVE"
  "domarc@192.168.20.14   # da-ftp"
  "domarc@192.168.20.5    # da-omada"
  "domarc@192.168.4.42    # da-sns"
  "domarc@192.168.4.41    # da-sns-dev"
  "domarc@192.168.4.10    # DA-GRAYLOG"
  "domarc@192.168.4.6     # da-vulcan"
  "domarc@192.168.4.7     # da-va"
  "domarc@192.168.4.8     # da-invent (VM DA-IPAM)"
)

# ─── helpers ─────────────────────────────────────────────────────────────────

c_blu="\033[1;34m"; c_grn="\033[1;32m"; c_ylw="\033[1;33m"; c_red="\033[1;31m"; c_rst="\033[0m"
log()  { printf "${c_blu}[deploy-key]${c_rst} %s\n" "$*" >&2; }
ok()   { printf "  ${c_grn}✓${c_rst} %s\n" "$*" >&2; }
warn() { printf "  ${c_ylw}!${c_rst} %s\n" "$*" >&2; }
err()  { printf "  ${c_red}✗${c_rst} %s\n" "$*" >&2; }

usage() {
  cat >&2 <<EOF
Uso: $0 [opzioni]

Opzioni:
  --key PATH         chiave pubblica da deploy (default: ~/.ssh/id_rsa.pub)
  --user USER        username default per gli host (default: domarc)
  --jump HOST        ProxyJump da usare (default: root@192.168.40.4, vuoto = no jump)
  --hosts FILE       file lista host (1 per riga, formato user@ip), sovrascrive i default
  --dry-run          mostra cosa farebbe, no comandi
  --skip-verify      no verifica finale
  -h, --help         questo aiuto
EOF
  exit 0
}

# ─── argparse ────────────────────────────────────────────────────────────────

while [[ $# -gt 0 ]]; do
  case "$1" in
    --key)         KEY="$2"; shift 2;;
    --user)        USER_DEFAULT="$2"; shift 2;;
    --jump)        JUMP="$2"; shift 2;;
    --hosts)       HOSTS_FILE="$2"; shift 2;;
    --dry-run)     DRY_RUN=1; shift;;
    --skip-verify) SKIP_VERIFY=1; shift;;
    -h|--help)     usage;;
    *)             err "Opzione sconosciuta: $1"; usage;;
  esac
done

# ─── precondizioni ───────────────────────────────────────────────────────────

[[ ! -f "$KEY" ]] && { err "Chiave $KEY non trovata"; exit 2; }
command -v ssh-copy-id >/dev/null || { err "ssh-copy-id mancante (brew install ssh-copy-id)"; exit 3; }

# Carica hosts
if [[ -n "$HOSTS_FILE" ]]; then
  [[ ! -f "$HOSTS_FILE" ]] && { err "File $HOSTS_FILE non esiste"; exit 4; }
  mapfile -t HOSTS < <(grep -vE '^\s*#|^\s*$' "$HOSTS_FILE")
else
  HOSTS=("${DEFAULT_HOSTS[@]}")
fi

# Costruisci SSH options (proxy jump opzionale)
SSH_OPTS=(-o "StrictHostKeyChecking=accept-new" -o "ConnectTimeout=10")
[[ -n "$JUMP" ]] && SSH_OPTS+=(-o "ProxyJump=$JUMP")

# ─── summary pre-run ─────────────────────────────────────────────────────────

log "Chiave:    $KEY"
log "ProxyJump: ${JUMP:-(nessuno)}"
log "Host:      ${#HOSTS[@]}"
for line in "${HOSTS[@]}"; do
  echo "  - $line"
done
echo ""

if [[ $DRY_RUN -eq 1 ]]; then
  warn "DRY-RUN — non eseguo nulla"
  exit 0
fi

# ─── loop ssh-copy-id ────────────────────────────────────────────────────────

TOTAL=0; OK_COUNT=0; FAIL_COUNT=0; FAILED_HOSTS=()
for line in "${HOSTS[@]}"; do
  TARGET=$(echo "$line" | awk '{print $1}')
  # Se manca user@, prepend USER_DEFAULT
  [[ "$TARGET" != *@* ]] && TARGET="${USER_DEFAULT}@${TARGET}"
  TOTAL=$((TOTAL+1))
  echo ""
  echo "═══ [$TOTAL/${#HOSTS[@]}] ssh-copy-id → $TARGET ═══"
  if ssh-copy-id -i "$KEY" "${SSH_OPTS[@]}" "$TARGET"; then
    OK_COUNT=$((OK_COUNT+1))
  else
    FAIL_COUNT=$((FAIL_COUNT+1))
    FAILED_HOSTS+=("$TARGET")
  fi
done

# ─── verifica ────────────────────────────────────────────────────────────────

if [[ $SKIP_VERIFY -eq 0 ]]; then
  echo ""
  log "═══ VERIFICA (no password questa volta) ═══"
  VERIFY_OK=0; VERIFY_KO=0
  for line in "${HOSTS[@]}"; do
    TARGET=$(echo "$line" | awk '{print $1}')
    [[ "$TARGET" != *@* ]] && TARGET="${USER_DEFAULT}@${TARGET}"
    HOSTNAME=$(ssh -o BatchMode=yes -o ConnectTimeout=5 "${SSH_OPTS[@]}" "$TARGET" 'hostname' 2>&1 | head -1)
    if [[ "$HOSTNAME" =~ "Permission denied" || "$HOSTNAME" =~ "Connection" ]]; then
      printf "  ${c_red}✗${c_rst} %-30s %s\n" "$TARGET" "$HOSTNAME"
      VERIFY_KO=$((VERIFY_KO+1))
    else
      printf "  ${c_grn}✓${c_rst} %-30s %s\n" "$TARGET" "$HOSTNAME"
      VERIFY_OK=$((VERIFY_OK+1))
    fi
  done
fi

# ─── summary ─────────────────────────────────────────────────────────────────

echo ""
log "═══ SUMMARY ═══"
echo "  ssh-copy-id: $OK_COUNT ok, $FAIL_COUNT falliti su $TOTAL"
[[ $SKIP_VERIFY -eq 0 ]] && echo "  verifica:    $VERIFY_OK ok, $VERIFY_KO falliti"
if [[ ${#FAILED_HOSTS[@]} -gt 0 ]]; then
  echo ""
  warn "Host falliti (controlla user/password/connettività):"
  for h in "${FAILED_HOSTS[@]}"; do echo "    - $h"; done
  exit 1
fi
exit 0
