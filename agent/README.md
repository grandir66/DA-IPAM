# DA-INVENT Remote Agent

Agente Python/FastAPI installato presso ogni cliente. L'hub DA-INVENT lo
contatta via Tailscale per eseguire le operazioni di scansione e
device-interrogation (ping, nmap, DNS, SNMP, SSH, WinRM) sulla rete locale
del cliente.

## Versione corrente: 0.2.0

> **BREAKING — v0.2.0**
>
> 1. `DA_INVENT_AGENT_TOKEN_HASH` rimossa. Sostituita da
>    `DA_INVENT_AGENT_TOKENS` (lista JSON con `label`, `token_hash`,
>    `scopes`). Vedi `.env.example`.
> 2. Tutti gli errori 4xx/5xx ora ritornano `{error: {code, message,
>    retriable, details?}}` — non più `{detail}` di FastAPI.
> 3. Endpoint protetti richiedono uno **scope**:
>    `exec:network` per ping/nmap/DNS/SNMP/ARP, `exec:device` per
>    SSH/WinRM, `admin:update` per il future endpoint di self-update.
>    Token con scope `["*"]` passa qualunque controllo.

## Architettura

```
┌─────────────┐                         ┌──────────────────┐
│             │   HTTPS bearer token    │                  │
│  DA-IPAM    │ ────────────────────▶   │  da-invent-agent │
│    hub      │   sopra Tailscale       │  (questa repo)   │
│             │                         │                  │
└─────────────┘                         └────────┬─────────┘
                                                 │
                                                 ▼
                                         rete del cliente
```

Vedi anche il piano di riferimento: `~/.claude/plans/da-ipam-remote-agents.md`.

## Dev locale

```bash
cd agent
python3.12 -m venv .venv          # o python3.11+; testato su 3.14
source .venv/bin/activate
pip install -e '.[dev]'

# Genera un hash bcrypt del token plaintext
python -c "import bcrypt; print(bcrypt.hashpw(b'my-dev-token', bcrypt.gensalt()).decode())"
# → $2b$12$...

# Esporta env (vedi .env.example per i campi)
export DA_INVENT_AGENT_DEV_MODE=true
export DA_INVENT_AGENT_TENANT_CODE=DEV
export DA_INVENT_AGENT_HUB_URL=http://localhost:3001
export DA_INVENT_AGENT_TOKENS='[{"label":"dev","token_hash":"$2b$12$...","scopes":["*"]}]'

uvicorn da_invent_agent.main:app --reload --port 8443
```

Smoke test:

```bash
curl http://127.0.0.1:8443/healthz | jq
curl http://127.0.0.1:8443/whoami \
    -H "Authorization: Bearer my-dev-token" | jq
curl -X POST http://127.0.0.1:8443/exec/ping \
    -H "Authorization: Bearer my-dev-token" \
    -H 'Content-Type: application/json' \
    -d '{"ip":"127.0.0.1"}' | jq
```

## Tests

```bash
pytest                              # tutti i test (parser inclusi)
pytest tests/test_arp_parser.py     # solo parser MAC ARP
```

## Endpoint v0.2.0

### Public (no auth)

| Method | Path | Note |
|--------|------|------|
| GET | `/healthz` | Liveness + presenza tool + stato Tailscale. |
| GET | `/version` | Versione corrente dell'agente. |

### Autenticati

| Method | Path | Scope richiesto |
|--------|------|-----------------|
| GET    | `/whoami`               | (qualsiasi token) |
| POST   | `/exec/ping`            | `exec:network` |
| POST   | `/exec/ping-sweep`      | `exec:network` |
| POST   | `/exec/nmap-discover`   | `exec:network` |
| POST   | `/exec/nmap-port-scan`  | `exec:network` |
| POST   | `/exec/dns-reverse`     | `exec:network` |
| POST   | `/exec/dns-forward`     | `exec:network` |
| POST   | `/exec/dns-batch`       | `exec:network` |
| POST   | `/exec/snmp-walk`       | `exec:network` |
| POST   | `/exec/arp-poll`        | `exec:network` |
| POST   | `/exec/snmp-routes`     | `exec:network` |
| POST   | `/exec/ssh-exec`        | `exec:device` |
| POST   | `/exec/winrm-exec`      | `exec:device` |

Le request/response sono definite in `da_invent_agent/models.py`.
Schema OpenAPI: `agent/openapi.json` (rigenerare con `python scripts/dump_openapi.py`).

### Esempi curl

```bash
TOKEN='my-dev-token'

# ARP poll su un MikroTik
curl -X POST http://127.0.0.1:8443/exec/arp-poll \
    -H "Authorization: Bearer $TOKEN" \
    -H 'Content-Type: application/json' \
    -d '{"router_ip":"10.0.0.1","community":"public","version":"2c"}' | jq

# SNMP routes (ipAddrTable + ipCidrRouteTable in parallelo)
curl -X POST http://127.0.0.1:8443/exec/snmp-routes \
    -H "Authorization: Bearer $TOKEN" \
    -H 'Content-Type: application/json' \
    -d '{"router_ip":"10.0.0.1","community":"public"}' | jq

# SSH exec con chiave privata
curl -X POST http://127.0.0.1:8443/exec/ssh-exec \
    -H "Authorization: Bearer $TOKEN" \
    -H 'Content-Type: application/json' \
    -d @- <<'EOF'
{
  "host": "192.168.1.10",
  "user": "admin",
  "auth": {"type":"key","private_key_pem":"-----BEGIN OPENSSH PRIVATE KEY-----\n..."},
  "command": "uname -a",
  "timeout_ms": 5000
}
EOF

# WinRM exec con password Kerberos auto-fallback NTLM
curl -X POST http://127.0.0.1:8443/exec/winrm-exec \
    -H "Authorization: Bearer $TOKEN" \
    -H 'Content-Type: application/json' \
    -d '{
      "host": "DC01.example.local",
      "user": "admin@EXAMPLE.LOCAL",
      "auth": {"type":"password","password":"secret"},
      "command": "Get-ComputerInfo"
    }'
```

### Endpoint pianificati (Phase 5+)

- `/admin/update` — auto-aggiornamento controllato dall'hub (scope `admin:update`).

## Error contract

Tutti gli errori (validation, auth, esecuzione) seguono lo stesso shape:

```json
{
  "error": {
    "code": "tool_missing",
    "message": "snmpwalk non trovato nel PATH",
    "retriable": false,
    "details": {"tool": "snmpwalk"}
  }
}
```

Codici / status HTTP:

| code                 | HTTP | retriable | quando lo emettiamo |
|----------------------|------|-----------|--------------------|
| `auth_invalid`       | 401  | no  | bearer mancante/errato/origin fuori da Tailscale |
| `scope_denied`       | 403  | no  | token autenticato ma senza lo scope dell'endpoint |
| `invalid_input`      | 400  | no  | body non valido (Zod/Pydantic) o argomento non supportato |
| `tool_missing`       | 503  | no  | `snmpwalk`/`nmap`/etc non presente sul sistema |
| `target_unreachable` | 502  | sì  | dispositivo SNMP/SSH/WinRM offline o no response |
| `timeout`            | 504  | sì  | operazione superato il timeout |
| `parse_error`        | 502  | no  | output del tool non parseabile (winrm_bridge JSON corrotto, nmap XML rotto) |
| `internal`           | 500  | sì  | eccezione non gestita: spesso transiente (OOM, socket exhaustion, race) — l'hub fa backoff. Bug deterministici si diagnosticano via log/observability. |

## Installazione production

Lo script `agent/scripts/install.sh` (Phase 4) installerà l'agente come
servizio systemd. La unit è in `agent/scripts/da-invent-agent.service`.

Requisiti host:

- Ubuntu 22.04+ con `python3.11+` (testato fino a 3.14)
- Tailscale installato e autenticato (`tailscale up` manuale al primo install)
- `nmap`, `iputils-ping`, `snmp` (net-snmp client), `openssh-client`
- Per Kerberos WinRM: `krb5-user`, `libkrb5-dev`, `krb5-config`
  (vedi `.claude/skills/winrm-kerberos/` lato hub per i gotchas).

## Manutenzione

- **Bump version**: modifica `da_invent_agent/__version__.py` e
  `pyproject.toml`. Tag commit con `release(agent): vX.Y.Z`.
- **Aggiornare OpenAPI** dopo modifiche agli endpoint:
  `python scripts/dump_openapi.py`.
- **Pre-commit suggerito**: `scripts/check_openapi_fresh.sh` exit 1 se
  `openapi.json` diverge dallo schema vivo.

## Sicurezza — note

- Nessun token plaintext viene mai persistito né loggato. Solo `label`
  finisce negli audit log (`auth.py`).
- Password/community/passphrase sono modellate come `pydantic.SecretStr`:
  repr e log nativo le redact a `**********`.
- Il client SSH usa `known_hosts=None` (TOFU). Considereremo certificate
  pinning in Phase 4+.
- Nessuna injection: tutti i subprocess sono invocati con
  `asyncio.create_subprocess_exec(args=list)`, mai shell string.
