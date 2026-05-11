# DA-INVENT Remote Agent

Agente Python/FastAPI installato presso ogni cliente. L'hub DA-INVENT lo
contatta via Tailscale per eseguire le operazioni di scansione (ping, nmap,
DNS) sulla rete locale del cliente.

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
python3.12 -m venv .venv
source .venv/bin/activate
pip install -e '.[dev]'

# Avvia in dev_mode (accetta richieste da 127.0.0.1, salta tailscale0 check)
export DA_INVENT_AGENT_DEV_MODE=true
export DA_INVENT_AGENT_TENANT_CODE=DEV
export DA_INVENT_AGENT_HUB_URL=http://localhost:3001
# Genera un hash bcrypt del token plaintext
python -c "import bcrypt; print(bcrypt.hashpw(b'my-dev-token', bcrypt.gensalt()).decode())"
export DA_INVENT_AGENT_TOKEN_HASH='<paste hash>'

uvicorn da_invent_agent.main:app --reload --port 8443
```

Smoke test:

```bash
curl http://127.0.0.1:8443/healthz
curl -X POST http://127.0.0.1:8443/exec/ping \
    -H 'Authorization: Bearer my-dev-token' \
    -H 'Content-Type: application/json' \
    -d '{"ip":"127.0.0.1"}'
```

## Test

```bash
pytest
```

## Endpoint (Phase 2 MVP)

| Method | Path | Auth | Note |
|--------|------|------|------|
| GET | `/healthz` | — | Liveness probe (anche per Tailscale healthchecks). |
| GET | `/version` | — | Versione corrente dell'agente. |
| POST | `/exec/ping` | bearer | Singolo IP. |
| POST | `/exec/ping-sweep` | bearer | Batch con concorrenza. |
| POST | `/exec/nmap-discover` | bearer | `nmap -sn` su subnet. |
| POST | `/exec/nmap-port-scan` | bearer | Port scan TCP (Phase 2: solo TCP). |
| POST | `/exec/dns-reverse` | bearer | PTR del resolver di sistema. |
| POST | `/exec/dns-forward` | bearer | A record. |
| POST | `/exec/dns-batch` | bearer | reverse + forward in parallelo. |

Le firme di request/response sono i modelli pydantic in `da_invent_agent/models.py`.

### Endpoint pianificati (Phase 3+)

- `/exec/snmp-walk`, `/exec/ssh`, `/exec/winrm`, `/exec/arp` — quando le primitive
  verranno estratte dal codice TS dell'hub.
- `/admin/update` — auto-aggiornamento controllato dall'hub (Phase 5).

## Installazione production

Lo script `agent/scripts/install.sh` (Phase 4) installerà l'agente come
servizio systemd. La unit è in `agent/scripts/da-invent-agent.service`.

Requisiti host:

- Ubuntu 22.04+ con `python3.12`
- Tailscale installato e autenticato (`tailscale up` manuale al primo install)
- `nmap` e `iputils-ping` nei pacchetti di sistema
