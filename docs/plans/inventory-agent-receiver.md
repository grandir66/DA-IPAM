# Plan — Inventory Agent Receiver (GLPI Agent → DA-IPAM, no GLPI server)

**Progetto**: DA-IPAM  
**Stato**: implementato (MVP + arricchimento NIS2 v0.2.713)  
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
- Token generato in **Impostazioni → Inventory Agent** (per tenant, condiviso tra tutte le postazioni)
- **Prima generazione**: pulsante «Genera token» — mostra il valore una sola volta
- **Rigenerazione**: solo tramite «Rigenera token…» con conferma (revoca il precedente)
- Script installazione: sempre visibili (template `<TOKEN>`); download precompilato usa token salvato server-side
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

- `inv_agent_endpoint` — una riga per macchina (device_id stabile) + `inventory_json` (ultimo profilo)
- `inv_agent_report` — ogni ingest (audit) + `inventory_json`
- `inv_agent_software` — snapshot software per report
- `inv_agent_license` — licenze OS/app (`licenseinfos`: nome, product id, chiave)
- `inv_agent_runtime` — database, remote mgmt, firewall, processi (max 300/report)

## Dati estratti da GLPI (inventory_format)

| Sezione GLPI | Uso DA-IPAM |
|--------------|-------------|
| `softwares` | Vista `/software`, tab oggetto, match CVE |
| `licenseinfos` | Tab Licenze, compliance NIS2 |
| `hardware`, `bios`, `cpus`, `memories`, `storages` | Anagrafica host + tab Hardware |
| `networks`, `users`, `antivirus`, `monitors` | Profilo + flag sicurezza |
| `databases_services`, `remote_mgmt`, `firewalls` | Tab Runtime (postura) |
| `processes` | Processi in esecuzione (cap 300, conteggio totale) |
| `controllers`, `firmwares`, `batteries` | Profilo hardware esteso |

Al ingest, campi vuoti di `hosts` vengono arricchiti (MAC, hostname, OS, modello, serial, produttore, firmware).

## Integrazione Vulnerability Assessment

Incrocio già disponibile in DA-IPAM:

- **Software Agent** ↔ **CVE Edge/Wazuh** via `getAggregatedSoftware()` / pagina `/vulnerabilities`
- Tab oggetto GLPI Agent espone `vuln_summary` (Critical/High dello stesso `host_id`)
- Flag `security_flags`: AV disattivo/non aggiornato, firewall off, remote management

**Fase 3 (DA-Vul-can)**: export bundle NIS2 per tenant (asset + software + licenze + CVE) via API o job schedulato.

## API

| Route | Auth | Descrizione |
|-------|------|-------------|
| `POST /api/inventory/ingest` | Bearer token | Riceve inventario JSON |
| `GET /api/inventory/ingest` | — | Health (`{ status: "ok" }`) |
| `GET /api/integrations/inventory-agent` | session | Stato feature + URL |
| `POST /api/integrations/inventory-agent/token` | admin | Genera token (mostrato una volta; **revoca i precedenti**) |
| `POST /api/features/inventory_agent/install` | admin | Abilita feature + migration |
| `GET /api/hosts/[id]/inventory-agent` | session | Inventario completo + CVE summary |

Chiavi licenza: visibili in chiaro solo ad **admin**; altri utenti vedono valore mascherato.

## Fase 2 (backlog)

- Handshake PROLOG XML per usare `SERVER=https://da-ipam/.../inventory/ingest` direttamente nell'agent
- Retention automatica report (ultimi N per endpoint)
- Diff install/uninstall tra report consecutivi
- Vista globale licenze `/licenses` e servizi critici
- Export NIS2 JSON/PDF verso DA-Vul-can
