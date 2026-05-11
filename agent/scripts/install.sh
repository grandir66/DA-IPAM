#!/usr/bin/env bash
# DA-INVENT Agent — installer one-liner.
#
# Uso (root o sudo):
#
#   curl -fsSL https://<hub>/agent-install.sh \
#     | TENANT_CODE=CLIENTE-001 \
#       HUB_URL=https://<hub> \
#       AGENT_TOKEN='<plaintext-token-da-UI>' \
#       AGENT_PORT=8443 \
#       bash
#
# Variabili obbligatorie:
#   TENANT_CODE   codice cliente DA-IPAM (es. "BRIDGE-DOMARC-OVH")
#   HUB_URL       URL hub DA-INVENT (es. "https://da-invent")
#   AGENT_TOKEN   token plaintext (generato dall'UI hub)
#
# Variabili opzionali:
#   AGENT_PORT    porta bind (default 8443)
#   AGENT_VERSION ref git da clonare (default: branch feature/remote-agents)
#   AGENT_REPO    URL del repo (default: https://github.com/grandir66/DA-IPAM.git)
#
# Vincoli:
#   - Idempotente: rieseguilo per upgrade o rotazione token.
#   - Richiede Tailscale già installato e autenticato (NON gestito dallo
#     script per scelta: tu fai `tailscale up` separatamente).
#   - Ubuntu 22.04+ / Debian 12+ con apt.

set -euo pipefail

# ─── Pre-flight ───────────────────────────────────────────────────────────────

if [ "$(id -u)" -ne 0 ]; then
    echo "ERROR: questo script deve girare come root (usa sudo)." >&2
    exit 1
fi

: "${TENANT_CODE:?TENANT_CODE non impostato}"
: "${HUB_URL:?HUB_URL non impostato}"
: "${AGENT_TOKEN:?AGENT_TOKEN non impostato}"
AGENT_PORT="${AGENT_PORT:-8443}"
AGENT_VERSION="${AGENT_VERSION:-feature/remote-agents}"
AGENT_REPO="${AGENT_REPO:-https://github.com/grandir66/DA-IPAM.git}"

INSTALL_DIR="/opt/da-invent-agent"
SRC_DIR="${INSTALL_DIR}/src"
VENV_DIR="${INSTALL_DIR}/venv"
CONFIG_DIR="/etc/da-invent-agent"
CONFIG_FILE="${CONFIG_DIR}/config.yml"
LOG_DIR="/var/log/da-invent-agent"
SYSTEMD_UNIT="/etc/systemd/system/da-invent-agent.service"
AGENT_USER="da-invent-agent"
TMP_CLONE="$(mktemp -d -t da-invent-agent-clone-XXXXXX)"

cleanup() { rm -rf "$TMP_CLONE"; }
trap cleanup EXIT

log() { printf '\n\033[1;34m[install]\033[0m %s\n' "$*"; }
ok()  { printf '  ✓ %s\n' "$*"; }

# ─── Verifica Tailscale ──────────────────────────────────────────────────────

log "Verifica Tailscale"
if ! command -v tailscale >/dev/null 2>&1; then
    echo "ERROR: tailscale non trovato. Installa Tailscale e fai 'tailscale up' prima di rieseguire." >&2
    exit 2
fi
if ! tailscale status >/dev/null 2>&1; then
    echo "ERROR: Tailscale non attivo. Esegui 'tailscale up' prima di rieseguire." >&2
    exit 2
fi
TS_IP="$(tailscale ip -4 | head -1)"
ok "Tailscale OK — IP: $TS_IP"

# ─── Dipendenze sistema ──────────────────────────────────────────────────────

log "Installa dipendenze APT (idempotente)"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq \
    python3.12 python3.12-venv python3-pip \
    nmap snmp iputils-ping openssh-client libcap2-bin \
    libkrb5-dev krb5-config krb5-user libffi-dev \
    git rsync >/dev/null
ok "APT deps OK"

# File capabilities su nmap (best-effort: nmap 7.94 su Ubuntu 24.04 ignora
# i caps per -sU/-sS e hard-checka euid==0, vedi sudoers sotto).
if command -v setcap >/dev/null 2>&1 && [ -x /usr/bin/nmap ]; then
    setcap cap_net_raw,cap_net_admin,cap_net_bind_service=eip /usr/bin/nmap || true
fi

# Sudoers fragment: permette all'agent di invocare ``sudo -n /usr/bin/nmap``
# senza password. Necessario per UDP scan (-sU) e SYN scan (-sS).
SUDOERS_FRAG=/etc/sudoers.d/da-invent-agent
cat > "$SUDOERS_FRAG" <<EOF
${AGENT_USER:-da-invent-agent} ALL=(root) NOPASSWD: /usr/bin/nmap
EOF
chmod 440 "$SUDOERS_FRAG"
visudo -cf "$SUDOERS_FRAG" >/dev/null
ok "sudoers fragment $SUDOERS_FRAG"

# ─── Utente di servizio ──────────────────────────────────────────────────────

log "Utente di sistema"
if id "$AGENT_USER" >/dev/null 2>&1; then
    ok "Utente $AGENT_USER già esistente"
else
    useradd -r -s /usr/sbin/nologin -d "$INSTALL_DIR" "$AGENT_USER"
    ok "Creato utente $AGENT_USER"
fi

# ─── Layout directory ────────────────────────────────────────────────────────

log "Layout filesystem"
mkdir -p "$INSTALL_DIR" "$CONFIG_DIR" "$LOG_DIR"
chown -R "$AGENT_USER:$AGENT_USER" "$INSTALL_DIR" "$LOG_DIR"
chown -R "$AGENT_USER:$AGENT_USER" "$CONFIG_DIR"
chmod 750 "$CONFIG_DIR"
ok "Directory pronte"

# ─── Clone / aggiorna codice ─────────────────────────────────────────────────

log "Scarica codice agent ($AGENT_REPO @ $AGENT_VERSION)"
git clone --depth=1 -b "$AGENT_VERSION" "$AGENT_REPO" "$TMP_CLONE/repo" >/dev/null 2>&1 || {
    git clone --depth=1 "$AGENT_REPO" "$TMP_CLONE/repo" >/dev/null 2>&1
    (cd "$TMP_CLONE/repo" && git fetch --depth=1 origin "$AGENT_VERSION" && git checkout FETCH_HEAD) >/dev/null 2>&1
}
if [ ! -d "$TMP_CLONE/repo/agent" ]; then
    echo "ERROR: il repo non contiene la directory 'agent/'." >&2
    exit 3
fi
rsync -a --delete \
    --exclude=".venv/" --exclude="__pycache__/" --exclude=".pytest_cache/" \
    --exclude="da_invent_agent.egg-info/" --exclude="tests/" \
    "$TMP_CLONE/repo/agent/" "$SRC_DIR/"
chown -R "$AGENT_USER:$AGENT_USER" "$SRC_DIR"
ok "Sorgenti aggiornati"

# ─── Virtualenv + dipendenze Python ──────────────────────────────────────────

log "Setup Python venv"
if [ ! -x "$VENV_DIR/bin/python" ]; then
    sudo -u "$AGENT_USER" python3.12 -m venv "$VENV_DIR"
    ok "Venv creato"
fi
sudo -u "$AGENT_USER" "$VENV_DIR/bin/pip" install --upgrade pip --quiet
sudo -u "$AGENT_USER" "$VENV_DIR/bin/pip" install -e "$SRC_DIR" --quiet
INSTALLED_VERSION="$("$VENV_DIR/bin/python" -c 'from da_invent_agent import __version__; print(__version__)')"
ok "Pip install OK — agent v$INSTALLED_VERSION"

# ─── Config file (con bcrypt hash generato in-process, niente shell) ─────────

log "Scrivi $CONFIG_FILE"
sudo -u "$AGENT_USER" AGENT_TOKEN_PLAIN="$AGENT_TOKEN" \
    TENANT_CODE="$TENANT_CODE" HUB_URL="$HUB_URL" AGENT_PORT="$AGENT_PORT" CONFIG_FILE="$CONFIG_FILE" \
    "$VENV_DIR/bin/python" - <<'PY'
import os, bcrypt, yaml
plain = os.environ["AGENT_TOKEN_PLAIN"]
hash_b = bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt())
cfg = {
    "tenant_code": os.environ["TENANT_CODE"],
    "hub_url": os.environ["HUB_URL"],
    "port": int(os.environ["AGENT_PORT"]),
    "host": "0.0.0.0",
    "dev_mode": False,
    "log_level": "INFO",
    "tokens": [
        {
            "label": "hub-prod",
            "token_hash": hash_b.decode("utf-8"),
            "scopes": ["exec:network", "exec:device", "admin:update"],
        }
    ],
}
with open(os.environ["CONFIG_FILE"], "w") as f:
    yaml.safe_dump(cfg, f, sort_keys=False)
PY
chmod 600 "$CONFIG_FILE"
chown "$AGENT_USER:$AGENT_USER" "$CONFIG_FILE"
ok "Config scritta (mode 600)"

# ─── Systemd unit ────────────────────────────────────────────────────────────

log "Systemd unit"
install -m 644 "$SRC_DIR/scripts/da-invent-agent.service" "$SYSTEMD_UNIT"
systemctl daemon-reload
systemctl enable da-invent-agent >/dev/null 2>&1 || true
systemctl restart da-invent-agent
sleep 2
if ! systemctl is-active --quiet da-invent-agent; then
    echo "ERROR: il servizio non si è avviato. Log:" >&2
    journalctl -u da-invent-agent -n 30 --no-pager >&2
    exit 4
fi
ok "Servizio attivo"

# ─── Health check finale ─────────────────────────────────────────────────────

log "Health check via HTTP"
if curl -fsS --max-time 5 "http://127.0.0.1:${AGENT_PORT}/healthz" > /tmp/agent-health.json 2>/dev/null; then
    ok "/healthz risponde"
else
    echo "WARNING: /healthz non risponde via 127.0.0.1 (dev_mode=false, il check resta su CGNAT)." >&2
    echo "         Test via Tailscale dal hub: curl http://${TS_IP}:${AGENT_PORT}/healthz" >&2
fi

# ─── Riepilogo ───────────────────────────────────────────────────────────────

cat <<INFO

╔══════════════════════════════════════════════════════════════╗
║  DA-INVENT Agent installato con successo                    ║
╠══════════════════════════════════════════════════════════════╣
║  Versione agent:  v${INSTALLED_VERSION}
║  Tenant code:     ${TENANT_CODE}
║  Tailscale IP:    ${TS_IP}
║  Porta:           ${AGENT_PORT}
║  Config file:     ${CONFIG_FILE} (chmod 600)
║  Log:             journalctl -u da-invent-agent -f
║  Status:          systemctl status da-invent-agent
╚══════════════════════════════════════════════════════════════╝

Sul hub DA-IPAM: vai su ${HUB_URL}/agents e premi "Test" sul tenant
${TENANT_CODE} per confermare la connettività.
INFO
