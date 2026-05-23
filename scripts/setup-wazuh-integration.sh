#!/usr/bin/env bash
# DA-IPAM ↔ Wazuh — provisioning utenti read-only per integrazione.
#
# Crea (in modo idempotente) su un server Wazuh:
#   1. Wazuh API user + role + policy custom per:
#      - agent:read, group:read, syscollector:read, manager:read, cluster:read,
#        vulnerability:read (custom — non c'è built-in in 4.14)
#   2. OpenSearch internal user + role + role-mapping per read-only su indici:
#      - wazuh-states-vulnerabilities-*  (CVE, fonte primaria 4.14+)
#      - wazuh-states-inventory-*
#      - wazuh-alerts-*
#      - wazuh-monitoring-*, wazuh-statistics-*
#
# Lo script è idempotente: se un oggetto esiste già con lo stesso nome, lo
# riusa invece di duplicare. Le password generate (o passate) NON vengono
# loggate in plaintext salvo nell'output finale richiesto esplicitamente.
#
# Uso minimo (interattivo):
#   bash scripts/setup-wazuh-integration.sh \
#     --endpoint https://da-wazuh.example.com \
#     --admin-api-pass 'PASS-DI-WAZUH-WUI' \
#     --admin-os-pass  'PASS-DI-OPENSEARCH-ADMIN'
#
# Uso non interattivo (CI / da DA-IPAM):
#   WAZUH_ADMIN_API_PASS=... WAZUH_ADMIN_OS_PASS=... \
#   bash scripts/setup-wazuh-integration.sh \
#     --endpoint https://da-wazuh.example.com \
#     --output env > .env.wazuh
#
# Verifica solo (no creazione):
#   bash scripts/setup-wazuh-integration.sh --verify-only \
#     --endpoint ... --api-user da-ipam --api-pass ... \
#     --os-user da-ipam-os --os-pass ...

set -euo pipefail

# ─── defaults ────────────────────────────────────────────────────────────────

ENDPOINT="${WAZUH_ENDPOINT:-}"
ADMIN_API_USER="${WAZUH_ADMIN_API_USER:-wazuh-wui}"
ADMIN_API_PASS="${WAZUH_ADMIN_API_PASS:-}"
API_PORT="${WAZUH_API_PORT:-55000}"
OS_PORT="${WAZUH_OS_PORT:-9200}"

API_USER="${WAZUH_API_USER:-da-ipam}"
API_PASS="${WAZUH_API_PASS:-}"

ADMIN_OS_USER="${WAZUH_ADMIN_OS_USER:-admin}"
ADMIN_OS_PASS="${WAZUH_ADMIN_OS_PASS:-}"
ADMIN_OS_CERT="${WAZUH_ADMIN_OS_CERT:-}"
ADMIN_OS_KEY="${WAZUH_ADMIN_OS_KEY:-}"

OS_USER="${WAZUH_OS_USER:-da-ipam-os}"
OS_PASS="${WAZUH_OS_PASS:-}"

SKIP_OS=0
VERIFY_ONLY=0
DRY_RUN=0
OUTPUT_FORMAT="text"

# ─── helpers ─────────────────────────────────────────────────────────────────

c_blu="\033[1;34m"; c_grn="\033[1;32m"; c_ylw="\033[1;33m"; c_red="\033[1;31m"; c_rst="\033[0m"
log()  { printf "${c_blu}[wazuh-setup]${c_rst} %s\n" "$*" >&2; }
ok()   { printf "  ${c_grn}✓${c_rst} %s\n" "$*" >&2; }
warn() { printf "  ${c_ylw}!${c_rst} %s\n" "$*" >&2; }
err()  { printf "  ${c_red}✗${c_rst} %s\n" "$*" >&2; }
die()  { err "$*"; exit 1; }

usage() {
  sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
}

gen_pass() {
  # 28 alfanumerici + suffix che rispetta vincoli Wazuh (upper, lower, digit, special).
  printf '%s%s' "$(openssl rand -base64 24 | tr -d '/+=' | head -c 28)" 'Aa1!'
}

# Wrapper curl: -k per certificati self-signed (Wazuh demo certs).
api_curl() { curl -sk -m 15 "$@"; }

# ─── argparse ────────────────────────────────────────────────────────────────

while [[ $# -gt 0 ]]; do
  case "$1" in
    --endpoint)         ENDPOINT="$2"; shift 2;;
    --api-port)         API_PORT="$2"; shift 2;;
    --os-port)          OS_PORT="$2"; shift 2;;
    --admin-api-user)   ADMIN_API_USER="$2"; shift 2;;
    --admin-api-pass)   ADMIN_API_PASS="$2"; shift 2;;
    --api-user)         API_USER="$2"; shift 2;;
    --api-pass)         API_PASS="$2"; shift 2;;
    --admin-os-user)    ADMIN_OS_USER="$2"; shift 2;;
    --admin-os-pass)    ADMIN_OS_PASS="$2"; shift 2;;
    --admin-os-cert)    ADMIN_OS_CERT="$2"; shift 2;;
    --admin-os-key)     ADMIN_OS_KEY="$2"; shift 2;;
    --os-user)          OS_USER="$2"; shift 2;;
    --os-pass)          OS_PASS="$2"; shift 2;;
    --skip-os)          SKIP_OS=1; shift;;
    --verify-only)      VERIFY_ONLY=1; shift;;
    --dry-run)          DRY_RUN=1; shift;;
    --output)           OUTPUT_FORMAT="$2"; shift 2;;
    -h|--help)          usage;;
    *)                  die "Argomento sconosciuto: $1 (usa --help)";;
  esac
done

# ─── precondizioni ───────────────────────────────────────────────────────────

[[ -z "$ENDPOINT" ]] && die "--endpoint mancante (es. https://da-wazuh.example.com)"
command -v jq      >/dev/null || die "jq non installato"
command -v curl    >/dev/null || die "curl non installato"
command -v openssl >/dev/null || die "openssl non installato"

API_BASE="${ENDPOINT}:${API_PORT}"
OS_BASE="${ENDPOINT}:${OS_PORT}"

if [[ $VERIFY_ONLY -eq 0 ]]; then
  [[ -z "$ADMIN_API_PASS" ]] && die "--admin-api-pass mancante (o WAZUH_ADMIN_API_PASS env)"
  if [[ $SKIP_OS -eq 0 && -z "$ADMIN_OS_PASS" && -z "$ADMIN_OS_CERT" ]]; then
    die "--admin-os-pass (o --admin-os-cert + --admin-os-key) mancante. Usa --skip-os per saltare OpenSearch."
  fi
fi

[[ -z "$API_PASS" ]] && API_PASS="$(gen_pass)"
[[ -z "$OS_PASS"  ]] && OS_PASS="$(gen_pass)"

# ─── Wazuh API ───────────────────────────────────────────────────────────────

WAZUH_JWT=""

wazuh_login() {
  local resp
  resp=$(api_curl -u "$ADMIN_API_USER:$ADMIN_API_PASS" -X POST "$API_BASE/security/user/authenticate") \
    || die "login Wazuh API fallito (network)"
  WAZUH_JWT=$(printf '%s' "$resp" | jq -r '.data.token // empty')
  [[ -z "$WAZUH_JWT" ]] && die "login Wazuh API fallito: $(printf '%s' "$resp" | jq -c .)"
  ok "auth Wazuh API ($ADMIN_API_USER) → token ottenuto"
}

wazuh_api() {
  api_curl -H "Authorization: Bearer $WAZUH_JWT" "$@"
}

# Restituisce l'id di una policy esistente per nome (stringa vuota se non c'è).
wazuh_policy_id() {
  local name=$1
  wazuh_api "$API_BASE/security/policies?limit=500" \
    | jq -r --arg n "$name" '.data.affected_items[] | select(.name == $n) | .id' | head -n1
}

wazuh_role_id() {
  local name=$1
  wazuh_api "$API_BASE/security/roles?limit=500" \
    | jq -r --arg n "$name" '.data.affected_items[] | select(.name == $n) | .id' | head -n1
}

wazuh_user_id() {
  local name=$1
  wazuh_api "$API_BASE/security/users?limit=500" \
    | jq -r --arg n "$name" '.data.affected_items[] | select(.username == $n) | .id' | head -n1
}

wazuh_ensure_policy() {
  local name=$1 body=$2
  local id; id=$(wazuh_policy_id "$name")
  if [[ -n "$id" ]]; then
    ok "policy '$name' già esistente (id=$id)"
    printf '%s' "$id"; return
  fi
  if [[ $DRY_RUN -eq 1 ]]; then
    warn "DRY-RUN: creerei policy '$name'"
    printf '%s' "DRY"; return
  fi
  local resp; resp=$(wazuh_api -X POST -H "Content-Type: application/json" -d "$body" "$API_BASE/security/policies")
  id=$(printf '%s' "$resp" | jq -r '.data.affected_items[0].id // empty')
  [[ -z "$id" ]] && die "create policy '$name' fallita: $(printf '%s' "$resp" | jq -c .)"
  ok "policy '$name' creata (id=$id)"
  printf '%s' "$id"
}

wazuh_ensure_role() {
  local name=$1
  local id; id=$(wazuh_role_id "$name")
  if [[ -n "$id" ]]; then
    ok "role '$name' già esistente (id=$id)"
    printf '%s' "$id"; return
  fi
  if [[ $DRY_RUN -eq 1 ]]; then
    warn "DRY-RUN: creerei role '$name'"
    printf '%s' "DRY"; return
  fi
  local resp; resp=$(wazuh_api -X POST -H "Content-Type: application/json" \
    -d "{\"name\":\"$name\"}" "$API_BASE/security/roles")
  id=$(printf '%s' "$resp" | jq -r '.data.affected_items[0].id // empty')
  [[ -z "$id" ]] && die "create role '$name' fallita: $(printf '%s' "$resp" | jq -c .)"
  ok "role '$name' creato (id=$id)"
  printf '%s' "$id"
}

wazuh_link_policies() {
  local role_id=$1 policy_ids=$2
  if [[ $DRY_RUN -eq 1 || "$role_id" == "DRY" ]]; then
    warn "DRY-RUN: linkerei policies [$policy_ids] al role $role_id"; return
  fi
  wazuh_api -X POST "$API_BASE/security/roles/$role_id/policies?policy_ids=$policy_ids" \
    >/dev/null || die "link policies fallito"
  ok "policies [$policy_ids] linkate al role $role_id"
}

wazuh_ensure_user() {
  local name=$1 pass=$2
  local id; id=$(wazuh_user_id "$name")
  if [[ -n "$id" ]]; then
    ok "user '$name' già esistente (id=$id) — password NON aggiornata"
    printf '%s' "$id"; return
  fi
  if [[ $DRY_RUN -eq 1 ]]; then
    warn "DRY-RUN: creerei user '$name'"
    printf '%s' "DRY"; return
  fi
  local resp; resp=$(wazuh_api -X POST -H "Content-Type: application/json" \
    -d "{\"username\":\"$name\",\"password\":\"$pass\"}" "$API_BASE/security/users")
  id=$(printf '%s' "$resp" | jq -r '.data.affected_items[0].id // empty')
  [[ -z "$id" ]] && die "create user '$name' fallita: $(printf '%s' "$resp" | jq -c .)"
  ok "user '$name' creato (id=$id)"
  printf '%s' "$id"
}

wazuh_link_role_to_user() {
  local user_id=$1 role_id=$2
  if [[ $DRY_RUN -eq 1 || "$user_id" == "DRY" || "$role_id" == "DRY" ]]; then
    warn "DRY-RUN: linkerei role $role_id al user $user_id"; return
  fi
  wazuh_api -X POST "$API_BASE/security/users/$user_id/roles?role_ids=$role_id" \
    >/dev/null || die "link role→user fallito"
  ok "role $role_id linkato al user $user_id"
}

wazuh_test_user() {
  local user=$1 pass=$2
  local jwt; jwt=$(api_curl -u "$user:$pass" -X POST "$API_BASE/security/user/authenticate?raw=true")
  [[ ${#jwt} -lt 50 ]] && die "test login '$user' fallito (jwt=${jwt:-vuoto})"
  local http; http=$(api_curl -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $jwt" "$API_BASE/agents?limit=1")
  [[ "$http" != "200" ]] && die "GET /agents come '$user' → HTTP $http (atteso 200)"
  ok "verifica '$user' → login OK, GET /agents → 200"
}

# ─── OpenSearch ──────────────────────────────────────────────────────────────

os_auth_args=()
os_setup_auth() {
  if [[ -n "$ADMIN_OS_CERT" && -n "$ADMIN_OS_KEY" ]]; then
    os_auth_args=(--cert "$ADMIN_OS_CERT" --key "$ADMIN_OS_KEY")
    ok "OpenSearch admin auth: cert mTLS ($ADMIN_OS_CERT)"
  else
    os_auth_args=(-u "$ADMIN_OS_USER:$ADMIN_OS_PASS")
    ok "OpenSearch admin auth: basic ($ADMIN_OS_USER)"
  fi
}

os_curl() { api_curl "${os_auth_args[@]}" "$@"; }

os_ensure_role() {
  local name=$1
  # _plugins/_security restituisce 404 se non esiste.
  local http; http=$(os_curl -o /dev/null -w '%{http_code}' "$OS_BASE/_plugins/_security/api/roles/$name")
  if [[ "$http" == "200" ]]; then
    ok "OS role '$name' già esistente"
    return
  fi
  if [[ $DRY_RUN -eq 1 ]]; then
    warn "DRY-RUN: creerei OS role '$name'"; return
  fi
  local body
  body=$(cat <<JSON
{
  "cluster_permissions": ["cluster_composite_ops_ro", "cluster_monitor"],
  "index_permissions": [{
    "index_patterns": [
      "wazuh-states-vulnerabilities-*",
      "wazuh-states-inventory-*",
      "wazuh-alerts-*",
      "wazuh-monitoring-*",
      "wazuh-statistics-*"
    ],
    "allowed_actions": ["read", "search", "indices_monitor"]
  }],
  "tenant_permissions": []
}
JSON
)
  os_curl -X PUT -H "Content-Type: application/json" -d "$body" \
    "$OS_BASE/_plugins/_security/api/roles/$name" \
    | jq -e '.status == "CREATED" or .status == "OK"' >/dev/null \
    || die "create OS role '$name' fallita"
  ok "OS role '$name' creato"
}

os_ensure_user() {
  local name=$1 pass=$2
  local http; http=$(os_curl -o /dev/null -w '%{http_code}' "$OS_BASE/_plugins/_security/api/internalusers/$name")
  if [[ "$http" == "200" ]]; then
    ok "OS user '$name' già esistente — password NON aggiornata"
    return
  fi
  if [[ $DRY_RUN -eq 1 ]]; then
    warn "DRY-RUN: creerei OS user '$name'"; return
  fi
  local body
  body=$(cat <<JSON
{
  "password": "$pass",
  "backend_roles": [],
  "attributes": {"purpose": "DA-IPAM integration", "created_by": "setup-wazuh-integration.sh"}
}
JSON
)
  os_curl -X PUT -H "Content-Type: application/json" -d "$body" \
    "$OS_BASE/_plugins/_security/api/internalusers/$name" \
    | jq -e '.status == "CREATED" or .status == "OK"' >/dev/null \
    || die "create OS user '$name' fallita"
  ok "OS user '$name' creato"
}

os_ensure_mapping() {
  local role=$1 user=$2
  if [[ $DRY_RUN -eq 1 ]]; then
    warn "DRY-RUN: mapperei user '$user' → role '$role'"; return
  fi
  local body
  body=$(cat <<JSON
{"users": ["$user"], "backend_roles": [], "hosts": []}
JSON
)
  os_curl -X PUT -H "Content-Type: application/json" -d "$body" \
    "$OS_BASE/_plugins/_security/api/rolesmapping/$role" \
    | jq -e '.status == "CREATED" or .status == "OK"' >/dev/null \
    || die "mapping role→user fallito"
  ok "mapping OS '$user' → '$role' applicato"
}

os_test_user() {
  local user=$1 pass=$2
  local body status
  body=$(api_curl -u "$user:$pass" "$OS_BASE/_cluster/health" 2>&1) || {
    die "OpenSearch non raggiungibile su $OS_BASE — è bound su 127.0.0.1 di default. Lancia lo script dal server Wazuh, oppure modifica 'network.host' in /etc/wazuh-indexer/opensearch.yml."
  }
  status=$(printf '%s' "$body" | jq -r '.status // empty' 2>/dev/null || true)
  [[ -z "$status" ]] && die "test OS '$user' fallito (auth errata o risposta non JSON): $body"
  ok "verifica OS '$user' → cluster status: $status"
  local http; http=$(api_curl -u "$user:$pass" -o /dev/null -w '%{http_code}' \
    -X PUT "$OS_BASE/wazuh-test-write-deny/_doc/1" -H "Content-Type: application/json" -d '{"x":1}' 2>/dev/null || echo "ERR")
  [[ "$http" != "403" ]] && warn "test write-deny: atteso 403, ricevuto $http (controllare role!)"
  [[ "$http" == "403" ]] && ok "verifica OS '$user' → write deny → 403 (corretto)"
}

# ─── flusso principale ───────────────────────────────────────────────────────

log "Endpoint: $API_BASE  +  $OS_BASE"

if [[ $VERIFY_ONLY -eq 1 ]]; then
  log "Modalità VERIFY-ONLY: nessun oggetto verrà creato"
  [[ -z "$API_PASS" ]] && die "--api-pass richiesto per verify"
  wazuh_test_user "$API_USER" "$API_PASS"
  if [[ $SKIP_OS -eq 0 ]]; then
    [[ -z "$OS_PASS" ]] && die "--os-pass richiesto per verify"
    os_test_user "$OS_USER" "$OS_PASS"
  fi
  log "Tutti i test OK"
  exit 0
fi

log "Step 1/2 — Wazuh API user provisioning"
wazuh_login

POLICY_VULN_ID=$(wazuh_ensure_policy "daipam_vulnerability_read" \
  '{"name":"daipam_vulnerability_read","policy":{"actions":["vulnerability:read"],"resources":["agent:id:*"],"effect":"allow"}}')

ROLE_ID=$(wazuh_ensure_role "da_ipam_readonly_role")

# Built-in policy ID (verificate su Wazuh 4.14):
#   4  agents_read_agents           (agent:read)
#   5  agents_read_groups           (group:read)
#   28 syscollector_read_syscollector (syscollector:read)
#   31 cluster_read_resourceless    (manager:read, cluster:status)
#   32 cluster_read_nodes           (cluster:read)
wazuh_link_policies "$ROLE_ID" "4,5,28,31,32,$POLICY_VULN_ID"

USER_ID=$(wazuh_ensure_user "$API_USER" "$API_PASS")
wazuh_link_role_to_user "$USER_ID" "$ROLE_ID"

if [[ $DRY_RUN -eq 0 ]]; then
  wazuh_test_user "$API_USER" "$API_PASS"
fi

if [[ $SKIP_OS -eq 1 ]]; then
  log "Skip OpenSearch (--skip-os)"
else
  log "Step 2/2 — OpenSearch user provisioning"
  os_setup_auth
  os_ensure_role "da-ipam-readonly"
  os_ensure_user "$OS_USER" "$OS_PASS"
  os_ensure_mapping "da-ipam-readonly" "$OS_USER"
  if [[ $DRY_RUN -eq 0 ]]; then
    os_test_user "$OS_USER" "$OS_PASS"
  fi
fi

# ─── output ──────────────────────────────────────────────────────────────────

case "$OUTPUT_FORMAT" in
  json)
    jq -n \
      --arg ep "$ENDPOINT" \
      --arg ap "$API_PORT" --arg au "$API_USER" --arg apw "$API_PASS" \
      --arg op "$OS_PORT"  --arg ou "$OS_USER"  --arg opw "$OS_PASS" \
      --argjson skipos "$SKIP_OS" \
      '{
        endpoint: $ep,
        wazuh_api: {url: ($ep + ":" + $ap), user: $au, password: $apw},
        opensearch: (if $skipos == 0
          then {url: ($ep + ":" + $op), user: $ou, password: $opw}
          else null end)
      }'
    ;;
  env)
    cat <<ENV
# Generato da setup-wazuh-integration.sh il $(date -u +%Y-%m-%dT%H:%M:%SZ)
WAZUH_API_URL=$ENDPOINT:$API_PORT
WAZUH_API_USER=$API_USER
WAZUH_API_PASS=$API_PASS
ENV
    if [[ $SKIP_OS -eq 0 ]]; then
      cat <<ENV
WAZUH_OS_URL=$ENDPOINT:$OS_PORT
WAZUH_OS_USER=$OS_USER
WAZUH_OS_PASS=$OS_PASS
ENV
    fi
    ;;
  text|*)
    cat >&2 <<TXT

══════════════════════════════════════════════════════════════════
 SETUP COMPLETATO
══════════════════════════════════════════════════════════════════
 Wazuh API
   URL       : $ENDPOINT:$API_PORT
   Username  : $API_USER
   Password  : $API_PASS
TXT
    if [[ $SKIP_OS -eq 0 ]]; then
      cat >&2 <<TXT
 OpenSearch (per CVE su Wazuh 4.14+)
   URL       : $ENDPOINT:$OS_PORT
   Username  : $OS_USER
   Password  : $OS_PASS
TXT
    fi
    cat >&2 <<TXT
══════════════════════════════════════════════════════════════════
 SALVA QUESTE CREDENZIALI IN UN VAULT (sono mostrate solo ora)
══════════════════════════════════════════════════════════════════
TXT
    ;;
esac
