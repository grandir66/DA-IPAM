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
#   TENANT_CODE   codice cliente DA-IPAM (es. "70791a")
#   HUB_URL       URL hub DA-INVENT (es. "https://192.168.4.8")
#   AGENT_TOKEN   token plaintext (generato dall'UI hub)
#
# Variabili opzionali:
#   AGENT_PORT          porta bind (default 8443)
#   AGENT_VERSION       ref git da clonare (default: feature/remote-agents)
#   AGENT_REPO          URL del repo (default: github grandir66/DA-IPAM)
#   TAILSCALE_AUTH_KEY  reusable auth-key Tailscale (se assente: login interattivo)
#   TAILSCALE_HOSTNAME  hostname Tailscale del nodo (default: $(hostname))
#
# Vincoli:
#   - Idempotente: rieseguilo per upgrade o rotazione token.
#   - Installa anche Tailscale se mancante (script ufficiale tailscale.com).
#   - Senza TAILSCALE_AUTH_KEY il primo `tailscale up` è interattivo:
#     stampa un URL da aprire nel browser per autenticare il nodo.
#   - Ubuntu 22.04+ / Debian 12+ con apt.

set -euo pipefail

# ─── Sub-comandi: precheck / verify / help ────────────────────────────────────
# Disponibili PRIMA del check root e PRIMA del require di TENANT_CODE/HUB_URL/
# AGENT_TOKEN — così uno può lanciare:
#   bash install.sh --precheck    # verifica sistema, niente install niente env
#   bash install.sh --verify      # post-install: service attivo, /whoami risponde
#   bash install.sh --help        # this

_c_red()    { printf '\033[1;31m%s\033[0m\n' "$*"; }
_c_green()  { printf '\033[1;32m%s\033[0m\n' "$*"; }
_c_yellow() { printf '\033[1;33m%s\033[0m\n' "$*"; }
_c_cyan()   { printf '\033[1;36m%s\033[0m\n' "$*"; }
_ok()       { printf '  \033[1;32m✓\033[0m %s\n' "$*"; }
_warn()     { printf '  \033[1;33m○\033[0m %s\n' "$*"; }
_fail()     { printf '  \033[1;31m✗\033[0m %s\n' "$*"; }

show_help() {
    sed -n '2,30p' "${BASH_SOURCE[0]}" | sed 's/^# \?//'
    exit 0
}

run_precheck() {
    _c_cyan "DA-INVENT agent installer — pre-check (solo lettura)"
    echo
    local errors=0
    local warnings=0

    # OS check (Ubuntu 22.04+ o Debian 12+)
    if command -v lsb_release >/dev/null 2>&1; then
        local dist; dist="$(lsb_release -is 2>/dev/null)"
        local rel;  rel="$(lsb_release -rs 2>/dev/null)"
        case "$dist" in
            Ubuntu)
                if [ "${rel%%.*}" -ge 22 ] 2>/dev/null; then
                    _ok "OS: Ubuntu $rel"
                else
                    _fail "OS: Ubuntu $rel — richiesto 22.04+"; errors=$((errors+1))
                fi
                ;;
            Debian)
                if [ "${rel%%.*}" -ge 12 ] 2>/dev/null; then
                    _ok "OS: Debian $rel"
                else
                    _fail "OS: Debian $rel — richiesto 12+"; errors=$((errors+1))
                fi
                ;;
            *)
                _warn "OS: $dist $rel — non testato (Ubuntu 22+/Debian 12+ consigliati)"; warnings=$((warnings+1))
                ;;
        esac
    else
        _warn "lsb_release mancante — impossibile verificare OS"; warnings=$((warnings+1))
    fi

    # Privilegi (per install serve root)
    if [ "$(id -u)" -eq 0 ]; then
        _ok "Eseguito come root"
    else
        _warn "Non-root: per l'install reale lancia con sudo. Precheck procede comunque."; warnings=$((warnings+1))
    fi

    # Connettività out
    if getent hosts github.com >/dev/null 2>&1; then
        _ok "DNS risolve github.com"
    else
        _fail "DNS non funziona — apt e clone repo falliranno"; errors=$((errors+1))
    fi
    if command -v curl >/dev/null 2>&1; then
        if curl -fsS --max-time 5 -o /dev/null https://github.com 2>/dev/null; then
            _ok "HTTPS verso github.com raggiungibile"
        else
            _warn "HTTPS verso github.com non risponde — clone repo potrebbe fallire"; warnings=$((warnings+1))
        fi
        if curl -fsS --max-time 5 -o /dev/null https://tailscale.com 2>/dev/null; then
            _ok "HTTPS verso tailscale.com raggiungibile (per installer ufficiale)"
        else
            _warn "tailscale.com non risponde — install Tailscale offline non supportato"; warnings=$((warnings+1))
        fi
    else
        _warn "curl mancante — sarà installato"; warnings=$((warnings+1))
    fi

    # HUB_URL raggiungibile (se fornito)
    if [ -n "${HUB_URL:-}" ]; then
        if curl -fsS -k --max-time 5 -o /dev/null "$HUB_URL" 2>/dev/null; then
            _ok "HUB_URL=$HUB_URL raggiungibile"
        else
            _warn "HUB_URL=$HUB_URL non risponde — verifica connettività hub (potrebbe essere in tailnet, in tal caso ok dopo tailscale up)"; warnings=$((warnings+1))
        fi
    else
        _warn "HUB_URL non impostato (env var) — sarà obbligatoria all'install"; warnings=$((warnings+1))
    fi

    # Stato Tailscale (informativo)
    if command -v tailscale >/dev/null 2>&1; then
        if tailscale status --json 2>/dev/null | grep -q '"BackendState":"Running"'; then
            local ts_ip; ts_ip="$(tailscale ip -4 2>/dev/null | head -1)"
            _ok "Tailscale già connesso (IP ${ts_ip:-?})"
        else
            _warn "Tailscale installato ma non running — installer eseguirà tailscale up"; warnings=$((warnings+1))
        fi
    else
        _warn "Tailscale non installato — installer lo installerà da tailscale.com"; warnings=$((warnings+1))
    fi

    # Strumenti già presenti vs da installare
    for t in python3.12 nmap snmpwalk ping; do
        if command -v "$t" >/dev/null 2>&1; then
            _ok "$t presente ($(command -v "$t"))"
        else
            _warn "$t mancante — sarà installato da apt"; warnings=$((warnings+1))
        fi
    done

    # Disco libero in /opt (≥1 GB per code+venv)
    if command -v df >/dev/null 2>&1; then
        local mb; mb="$(df -BM --output=avail /opt 2>/dev/null | tail -1 | tr -dc '0-9')"
        if [ "${mb:-0}" -ge 1024 ]; then
            _ok "Disco /opt disponibile: ${mb} MB (≥1024)"
        else
            _fail "Disco /opt: ${mb} MB — troppo poco (min 1024)"; errors=$((errors+1))
        fi
    fi

    # Conflitti porta 8443
    if command -v ss >/dev/null 2>&1 && ss -lntH 2>/dev/null | awk '{print $4}' | grep -qE ":${AGENT_PORT:-8443}$"; then
        local who; who="$(ss -lntp 2>/dev/null | awk -v p=":${AGENT_PORT:-8443}" '$4 ~ p {print $NF}' | head -1)"
        _warn "Porta ${AGENT_PORT:-8443} già in uso ($who) — l'agent fallirà bind a meno di cambio porta"; warnings=$((warnings+1))
    else
        _ok "Porta ${AGENT_PORT:-8443} libera"
    fi

    echo
    if [ $errors -eq 0 ] && [ $warnings -eq 0 ]; then
        _c_green "Tutto verde: pronto per l'install reale."
        return 0
    elif [ $errors -eq 0 ]; then
        _c_yellow "$warnings warning (non bloccanti). Procedi pure con l'install."
        return 0
    else
        _c_red "$errors errori, $warnings warning. Risolvi gli errori prima dell'install."
        return 1
    fi
}

run_verify() {
    _c_cyan "DA-INVENT agent — post-install verify"
    echo
    local errors=0
    local warnings=0

    # Service systemd
    if systemctl is-active --quiet da-invent-agent 2>/dev/null; then
        _ok "service da-invent-agent attivo"
    else
        _fail "service da-invent-agent NON attivo (systemctl status da-invent-agent)"; errors=$((errors+1))
    fi

    # File essenziali
    for f in /etc/da-invent-agent/config.yml /etc/systemd/system/da-invent-agent.service; do
        if [ -f "$f" ]; then
            _ok "presente: $f"
        else
            _fail "manca: $f"; errors=$((errors+1))
        fi
    done

    # Sudoers fragment (per UDP scan nmap)
    if [ -f /etc/sudoers.d/da-invent-agent ]; then
        _ok "/etc/sudoers.d/da-invent-agent presente"
        if visudo -cf /etc/sudoers.d/da-invent-agent >/dev/null 2>&1; then
            _ok "sudoers fragment sintatticamente valido"
        else
            _fail "sudoers fragment INVALIDO — visudo -cf fallisce"; errors=$((errors+1))
        fi
    else
        _warn "manca /etc/sudoers.d/da-invent-agent (UDP scan potrebbe fallire)"; warnings=$((warnings+1))
    fi

    # Tailscale
    if command -v tailscale >/dev/null 2>&1 && tailscale status --json 2>/dev/null | grep -q '"BackendState":"Running"'; then
        local ts_ip; ts_ip="$(tailscale ip -4 2>/dev/null | head -1)"
        _ok "Tailscale connesso (IP ${ts_ip:-?})"
    else
        _fail "Tailscale non running"; errors=$((errors+1))
    fi

    # Porta agent in listen
    local port; port="$(awk '/^port:/ {print $2}' /etc/da-invent-agent/config.yml 2>/dev/null || echo 8443)"
    if command -v ss >/dev/null 2>&1 && ss -lntH 2>/dev/null | awk '{print $4}' | grep -qE ":${port}$"; then
        _ok "agent in ascolto :${port}"
    else
        _fail "agent NON in ascolto su :${port}"; errors=$((errors+1))
    fi

    # /healthz risponde (no auth)
    if curl -fsS --max-time 3 "http://127.0.0.1:${port}/healthz" >/dev/null 2>&1; then
        local resp; resp="$(curl -fsS --max-time 3 "http://127.0.0.1:${port}/healthz")"
        _ok "/healthz risponde: $resp"
    else
        _fail "/healthz non risponde su 127.0.0.1:${port}"; errors=$((errors+1))
    fi

    # /whoami con token (se config legibile)
    if [ -r /etc/da-invent-agent/config.yml ]; then
        # config.yml ha bcrypt hash, non plaintext — non possiamo testare /whoami senza il plaintext.
        # Verifichiamo solo che ci sia almeno un token configurato.
        if grep -q "token_hash:" /etc/da-invent-agent/config.yml; then
            _ok "almeno un token configurato in config.yml"
        else
            _fail "nessun token in config.yml — agent rifiuterà tutte le richieste protette"; errors=$((errors+1))
        fi
    fi

    echo
    if [ $errors -eq 0 ] && [ $warnings -eq 0 ]; then
        _c_green "Tutto verde: l'agent è operativo."
        return 0
    elif [ $errors -eq 0 ]; then
        _c_yellow "$warnings warning. Verifica i punti flaggati."
        return 0
    else
        _c_red "$errors errori. Investiga journalctl -u da-invent-agent -n 50."
        return 1
    fi
}

case "${1:-}" in
    --help|-h)  show_help ;;
    --precheck) run_precheck; exit $? ;;
    --verify)   run_verify;   exit $? ;;
    "")         : ;;  # flow normale install
    *)          _c_red "Argomento non riconosciuto: $1"; echo "Usa --help"; exit 2 ;;
esac

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

log "Tailscale: install + up (idempotente)"
if ! command -v tailscale >/dev/null 2>&1; then
    ok "Tailscale assente, installo (script ufficiale tailscale.com)"
    curl -fsSL https://tailscale.com/install.sh | sh >/dev/null 2>&1 || {
        echo "ERROR: install Tailscale fallito. Verifica connessione internet o installa manualmente." >&2
        exit 2
    }
else
    ok "Tailscale già installato ($(tailscale version | head -1))"
fi

systemctl enable --now tailscaled >/dev/null 2>&1 || true

if ! tailscale status >/dev/null 2>&1; then
    TS_HOSTNAME="${TAILSCALE_HOSTNAME:-$(hostname)}"
    if [ -n "${TAILSCALE_AUTH_KEY:-}" ]; then
        ok "tailscale up con auth-key"
        tailscale up --authkey="$TAILSCALE_AUTH_KEY" --hostname="$TS_HOSTNAME" >/dev/null 2>&1 || {
            echo "ERROR: tailscale up con auth-key fallito (key scaduta o revocata?)" >&2
            exit 2
        }
    else
        echo ""
        echo "  >>> AUTENTICAZIONE TAILSCALE — APRI L'URL CHE APPARE QUI SOTTO <<<"
        echo "  >>> dopo l'auth lo script proseguirà automaticamente            <<<"
        echo ""
        tailscale up --hostname="$TS_HOSTNAME" || {
            echo "ERROR: tailscale up interattivo fallito o annullato." >&2
            exit 2
        }
    fi
fi

TS_IP="$(tailscale ip -4 2>/dev/null | head -1)"
if [ -z "$TS_IP" ]; then
    echo "ERROR: Tailscale up ma nessun IP IPv4 assegnato (?)" >&2
    exit 2
fi
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
