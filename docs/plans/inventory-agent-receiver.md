# Plan — Inventory Agent Receiver (GLPI Agent → DA-IPAM, no GLPI server)

**Progetto**: DA-IPAM  
**Stato**: implementato (MVP)  
**Data**: 2026-06-22

## Obiettivo

Inventario software **push** su Windows, Linux e macOS usando il binario **GLPI Agent** (solo task `inventory`), **senza** server GLPI e **senza** Wazuh.

DA-IPAM espone un endpoint HTTPS leggero che accetta il JSON standard [glpi-project/inventory_format](https://github.com/glpi-project/inventory_format).

## Non-goals

- Server GLPI / CMDB / ticket / licenze
- Protocollo PROLOG XML nativo GLPI Agent (fase 2 — oggi usiamo push JSON)
- Wazuh agent
- Deploy software via agent

## Architettura

```
GLPI Agent (inventory-only)
  → glpi-inventory --json  (oppure futuro: server URL compatibile)
  → script push (curl / PowerShell) + Bearer token
  → POST /api/inventory/ingest
  → SQLite tenant (inv_agent_*)
  → UI host / oggetto
```

## Autenticazione ingest

- Header: `Authorization: Bearer <token>` oppure `X-Domarc-Ingest-Token`
- Token generato in **Impostazioni → Inventory Agent** (per tenant)
- Lookup hub: `inventory_ingest_tokens(token_sha256 → tenant_code)`
- Feature flag hub: `tenant_features.inventory_agent`

## Formato payload

Accettiamo:

1. JSON completo GLPI (`{ "deviceid", "content": { "softwares", "operatingsystem", "networks", ... } }`)
2. Solo `{ "content": { ... } }`
3. Array wrapper `[{ ... }]` (primo elemento)

Campi usati per match host: IP da `networks`, MAC, hostname, `deviceid` / `hardware.uuid`.

## Deploy endpoint (cliente)

**Windows** (Scheduled Task, ogni 6h):

```powershell
# scripts/push-inventory-agent.ps1 — variabili INGEST_URL e INGEST_TOKEN
```

**Linux / macOS**:

```bash
# scripts/push-inventory-agent.sh
glpi-inventory --json 2>/dev/null | curl -fsS -X POST \
  -H "Authorization: Bearer $INGEST_TOKEN" \
  -H "Content-Type: application/json" \
  --data-binary @- \
  "$INGEST_URL"
```

Installazione agent: MSI/pkg/deb ufficiale GLPI Agent, **TASKS=Inventory** only.

## Schema tenant

- `inv_agent_endpoint` — una riga per macchina (device_id stabile)
- `inv_agent_report` — ogni ingest (audit)
- `inv_agent_software` — snapshot software per report

## API

| Route | Auth | Descrizione |
|-------|------|-------------|
| `POST /api/inventory/ingest` | Bearer token | Riceve inventario JSON |
| `GET /api/inventory/ingest` | — | Health (`{ status: "ok" }`) |
| `GET /api/integrations/inventory-agent` | session | Stato feature + URL |
| `POST /api/integrations/inventory-agent/token` | admin | Genera token (mostrato una volta) |
| `POST /api/features/inventory_agent/install` | admin | Abilita feature + migration |
| `GET /api/hosts/[id]/inventory-agent` | session | Software corrente da agent |

## Fase 2 (backlog)

- Handshake PROLOG XML per usare `SERVER=https://da-ipam/.../inventory/ingest` direttamente nell'agent
- Retention automatica report (ultimi N per endpoint)
- Diff install/uninstall tra report consecutivi
