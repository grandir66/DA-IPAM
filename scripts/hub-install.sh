#!/usr/bin/env bash
# DA-INVENT hub — installer / verifier delle dipendenze di sistema.
#
# Usare DOPO aver clonato/rsyncato il codice DA-INVENT in /opt/da-invent
# (es. dopo una migrazione da LXC a VM, o setup di un host nuovo).
#
# Idempotente: rieseguibile per allineare un host esistente.
# Sicuro: non tocca dati (data/), env (.env.local), DB hub/tenant.
#
# Uso (root o sudo):
#   bash /opt/da-invent/scripts/hub-install.sh
#
# Cosa installa/configura:
#   - Pacchetti apt: nmap, snmp, snmp-mibs-downloader, fping, iputils-arping,
#     mtr-tiny, libkrb5-dev, krb5-config, krb5-user, libffi-dev, python3-venv,
#     python3-dev, build-essential, nodejs (se mancante via NodeSource)
#   - file capabilities su /usr/bin/nmap (cap_net_raw,cap_net_admin)
#   - venv pywinrm in /root/.da-invent-venv
#   - systemd unit /etc/systemd/system/da-invent.service (se non esiste,
#     da template /opt/da-invent/deploy/da-invent.service)
#
# NON installa Node.js né npm install: quelli sono lasciati al workflow di
# build (npm install + npm run build). Controlliamo solo la presenza.

set -euo pipefail

APP_DIR="${APP_DIR:-/opt/da-invent}"
WINRM_VENV="${WINRM_VENV:-/root/.da-invent-venv}"

if [ "$(id -u)" -ne 0 ]; then
    echo "ERROR: lanciare come root (sudo bash $0)" >&2
    exit 1
fi

log() { printf '\n\033[1;34m[hub-install]\033[0m %s\n' "$*"; }
ok()  { printf '  ✓ %s\n' "$*"; }
warn(){ printf '  ! %s\n' "$*" >&2; }

# ─── App dir sanity ──────────────────────────────────────────────────────────

if [ ! -d "$APP_DIR" ]; then
    echo "ERROR: $APP_DIR non esiste. Clona prima il codice." >&2
    exit 2
fi
if [ ! -f "$APP_DIR/package.json" ]; then
    echo "ERROR: $APP_DIR/package.json mancante. Path errato?" >&2
    exit 2
fi
ok "Codice trovato in $APP_DIR"

# ─── apt dependencies ───────────────────────────────────────────────────────

log "Installa dipendenze APT (idempotente)"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq \
    nmap snmp \
    fping iputils-arping iputils-ping mtr-tiny \
    openssh-client \
    libkrb5-dev krb5-config krb5-user libffi-dev \
    python3 python3-venv python3-dev python3-pip \
    build-essential pkg-config \
    sqlite3 \
    git rsync ca-certificates >/dev/null
if apt-cache show snmp-mibs-downloader >/dev/null 2>&1; then
    apt-get install -y -qq snmp-mibs-downloader >/dev/null || warn "snmp-mibs-downloader non installato (continue)"
else
    warn "snmp-mibs-downloader non disponibile su questo release Debian/Ubuntu (SNMP ok, MIB opzionali)"
fi
ok "APT deps OK"

# ─── Capabilities su nmap ────────────────────────────────────────────────────

if [ -x /usr/bin/nmap ]; then
    setcap cap_net_raw,cap_net_admin,cap_net_bind_service=eip /usr/bin/nmap || warn "setcap su nmap fallito (continue)"
    if getcap /usr/bin/nmap 2>/dev/null | grep -q cap_net_raw; then
        ok "setcap su /usr/bin/nmap"
    fi
fi

# ─── Venv pywinrm per winrm-bridge.py ───────────────────────────────────────

log "Setup venv WinRM (scripts/setup-winrm-venv.sh)"
WINRM_VENV="${WINRM_VENV:-/root/.da-invent-venv}" \
  bash "${APP_DIR}/scripts/setup-winrm-venv.sh"
WINRM_VER="$("${WINRM_VENV}/bin/python" -c 'import winrm; print(winrm.__version__)')"
ok "pywinrm ${WINRM_VER} pronto in ${WINRM_VENV}"

# ─── Node.js / npm presence ─────────────────────────────────────────────────

if ! command -v node >/dev/null 2>&1; then
    warn "Node.js non trovato. Installa Node 22 LTS:"
    echo "    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -"
    echo "    apt-get install -y nodejs"
else
    NODE_VER="$(node --version)"
    case "$NODE_VER" in
        v20.*|v22.*) ok "Node $NODE_VER" ;;
        v25.*|v26.*) warn "Node $NODE_VER: better-sqlite3 NON funziona su Node ≥25, downgrade a 22 LTS!" ;;
        *) warn "Node $NODE_VER non testato — preferire 20.x/22.x" ;;
    esac
fi

# ─── Sanity check finale ────────────────────────────────────────────────────

log "Sanity check tool"
MISSING=""
for t in nmap snmpwalk snmpget fping arping ping ssh; do
    if ! command -v "$t" >/dev/null 2>&1; then
        MISSING="$MISSING $t"
    fi
done
if [ -n "$MISSING" ]; then
    warn "Tool ancora mancanti:$MISSING"
    exit 3
fi
ok "Tutti i tool di scan presenti"

log "Verifica venv WinRM (verify-install.sh)"
bash "${APP_DIR}/scripts/verify-install.sh" || {
  echo "ERROR: verify-install fallito — controllare scripts/setup-winrm-venv.sh" >&2
  exit 4
}

cat <<INFO

╔══════════════════════════════════════════════════════════════╗
║  DA-INVENT hub: dipendenze di sistema OK                    ║
╠══════════════════════════════════════════════════════════════╣
║  App:      $APP_DIR
║  WinRM:    $WINRM_VENV (pywinrm $WINRM_VER)
║  Nmap:     $(getcap /usr/bin/nmap 2>/dev/null || echo 'no caps')
╚══════════════════════════════════════════════════════════════╝

Prossimi passi (manuali):
  cd $APP_DIR && npm install && npm run build
  systemctl restart da-invent
  curl -sk https://localhost/api/health | jq
INFO
