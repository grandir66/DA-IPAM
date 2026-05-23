# Playbook — Integrazione DA-IPAM ↔ Wazuh

Provisioning di credenziali read-only su un server Wazuh per consentire a DA-IPAM di leggere agenti, syscollector e CVE.

## TL;DR

```bash
# 1. SSH sul server Wazuh (o lancia da una macchina che lo raggiunge in HTTPS)
# 2. Esegui:
bash scripts/setup-wazuh-integration.sh \
  --endpoint https://da-wazuh.example.com \
  --admin-api-pass 'PASSWORD-DI-wazuh-wui' \
  --admin-os-pass  'PASSWORD-DI-admin-OPENSEARCH'

# 3. Annota le credenziali stampate a fine script (vengono mostrate UNA volta sola)
# 4. Inseriscile nei settings Hub di DA-IPAM (sezione integrazioni / Wazuh)
```

Risultato: due utenti read-only attivi sul Wazuh — uno per la API REST (porta 55000), uno per OpenSearch (porta 9200) — pronti per essere consumati da DA-IPAM.

---

## Cosa fa lo script

1. **Wazuh API REST (porta 55000)** — crea, in modo idempotente:
   - Policy custom `daipam_vulnerability_read` (azione `vulnerability:read` su `agent:id:*`).
   - Role `da_ipam_readonly_role` con 6 policy:
     - 4 built-in: `agents_read_agents`, `agents_read_groups`, `syscollector_read_syscollector`, `cluster_read_resourceless` (= `manager:read`), `cluster_read_nodes` (= `cluster:read`).
     - 1 custom: `daipam_vulnerability_read`.
   - User `da-ipam` (default) con il role sopra.
2. **OpenSearch (porta 9200)** — crea, in modo idempotente:
   - Role `da-ipam-readonly` con `cluster_composite_ops_ro` + `cluster_monitor` + read su:
     - `wazuh-states-vulnerabilities-*` (CVE — fonte primaria in Wazuh 4.14+)
     - `wazuh-states-inventory-*` (inventario syscollector storicizzato)
     - `wazuh-alerts-*`, `wazuh-monitoring-*`, `wazuh-statistics-*`
   - Internal user `da-ipam-os` (default).
   - Role mapping `da-ipam-os` → `da-ipam-readonly`.
3. **Verifica** post-provisioning:
   - Login + `GET /agents` come `da-ipam` → atteso 200.
   - Auth basic + `GET /_cluster/health` come `da-ipam-os` → atteso `green/yellow`.
   - Write deny test su OS → atteso 403.

---

## Risoluzione DNS lato VM DA-IPAM (anti-regressione)

DA-IPAM apre connessioni HTTP server-side verso il Wazuh manager + dashboard
(reverse proxy iframe + API REST). Se il FQDN `da-wazuh.<dominio>` non è
risolvibile dal resolver della VM DA-IPAM (es. DNS interno LAN non
configurato, Tailscale MagicDNS non condiviso), tutte le chiamate server-side
falliscono con `ENOTFOUND` mentre il browser dell'utente risolve normalmente
(usa il DNS aziendale).

Fix permanente: aggiungere il FQDN al `/etc/hosts` della VM DA-IPAM:

```bash
echo "192.168.X.Y da-wazuh.tuodominio.it" | sudo tee -a /etc/hosts
```

Verifica:

```bash
getent hosts da-wazuh.tuodominio.it
curl -sk -o /dev/null -w "%{http_code}\n" https://da-wazuh.tuodominio.it/
```

> **2026-05-23 Domarc** — sul cluster DA-IPAM `192.168.4.8` aggiunta entry
> `192.168.4.19 da-wazuh.domarc.it` perché il resolver `systemd-resolved`
> della VM non vedeva il record (NXDOMAIN da `127.0.0.53`). Stesso check
> applicabile a LibreNMS, Greenbone, qualsiasi integrazione server-side.

## Iframe dashboard embedded in DA-IPAM (basePath OSD)

La pagina "Integrazioni → Wazuh" di DA-IPAM mostra il dashboard Wazuh in
iframe via `/api/integrations/proxy/wazuh/*`. OpenSearch Dashboards (la
SPA su cui gira Wazuh) genera link assoluti via `window.location.origin`,
quindi senza `server.basePath` configurato il bootstrap della SPA fallisce
con "Wazuh did not load properly" anche se HTML/CSS/JS sono raggiungibili.

**Fix sul server Wazuh**:

```bash
sudo cp /etc/wazuh-dashboard/opensearch_dashboards.yml{,.bak-pre-basepath}
sudo tee -a /etc/wazuh-dashboard/opensearch_dashboards.yml > /dev/null <<'EOF'

# DA-IPAM iframe proxy
server.basePath: "/api/integrations/proxy/wazuh"
server.rewriteBasePath: true
EOF
sudo systemctl restart wazuh-dashboard
```

`rewriteBasePath: true` mantiene compatibile anche l'accesso diretto al
dashboard via FQDN senza il sub-path. Verifica:

```bash
curl -sk -o /dev/null -w "%{http_code}\n" https://localhost/app/login
curl -sk -o /dev/null -w "%{http_code}\n" https://localhost/api/integrations/proxy/wazuh/app/login
```

Entrambe le rotte devono rispondere 200 (o 302 verso il proprio /login).

## Prerequisiti

| Cosa | Dove | Note |
|------|------|------|
| Wazuh 4.x in esecuzione | server target | testato 4.14.2 — in 4.14 l'endpoint REST `/vulnerability/{id}` è rimosso, le CVE vivono solo in OpenSearch |
| Password admin Wazuh API | utente con role `administrator` (id=1) | tipicamente `wazuh-wui` (vedi `/usr/share/wazuh-dashboard/data/wazuh/config/wazuh.yml`) |
| Password admin OpenSearch | utente OS `admin` | impostata a setup Wazuh — è in `/etc/wazuh-indexer/wazuh-passwords-tool.sh` se generata automaticamente; oppure usa il cert admin con `--admin-os-cert /etc/wazuh-indexer/certs/admin.pem --admin-os-key /etc/wazuh-indexer/certs/admin-key.pem` |
| Tool sulla macchina che lancia lo script | `curl`, `jq`, `openssl` | quasi sempre presenti |
| Connettività HTTPS | porta 55000 (Wazuh API) e 9200 (OpenSearch) dal lancio dello script | OpenSearch su Wazuh single-node è bound spesso su `127.0.0.1` — lanciare lo script dal server Wazuh stesso, oppure modificare `network.host` in `/etc/wazuh-indexer/opensearch.yml` prima |

---

## Opzioni dello script

| Flag | Default | Descrizione |
|------|---------|-------------|
| `--endpoint <url>` | (vuoto, **richiesto**) | URL base del Wazuh, es. `https://da-wazuh.example.com` |
| `--api-port <n>` | `55000` | porta Wazuh API REST |
| `--os-port <n>` | `9200` | porta OpenSearch |
| `--admin-api-user <u>` | `wazuh-wui` | admin Wazuh API per il provisioning |
| `--admin-api-pass <p>` | env `WAZUH_ADMIN_API_PASS` | password dell'admin Wazuh API |
| `--api-user <u>` | `da-ipam` | nome del nuovo utente Wazuh API |
| `--api-pass <p>` | auto-generata 32 char | password del nuovo utente |
| `--admin-os-user <u>` | `admin` | admin OpenSearch (basic auth) |
| `--admin-os-pass <p>` | env `WAZUH_ADMIN_OS_PASS` | password admin OS |
| `--admin-os-cert <path>` | — | alternativa: certificato admin mTLS |
| `--admin-os-key <path>` | — | chiave del certificato admin mTLS |
| `--os-user <u>` | `da-ipam-os` | nome del nuovo utente OS |
| `--os-pass <p>` | auto-generata 32 char | password del nuovo utente OS |
| `--skip-os` | off | salta tutto il provisioning OpenSearch |
| `--verify-only` | off | non crea nulla: testa solo che le credenziali passate funzionino |
| `--dry-run` | off | mostra cosa verrebbe creato, senza fare modifiche |
| `--output <fmt>` | `text` | `text` \| `env` \| `json` |

Tutte le opzioni hanno una equivalente variabile d'ambiente (`WAZUH_*`), utile per CI.

---

## Esempi

### Provisioning standard (interattivo)

```bash
bash scripts/setup-wazuh-integration.sh \
  --endpoint https://da-wazuh.domarc.it \
  --admin-api-pass 'qW8NSrHHR+r*yOG9.89rQV3nYYmIH4M2' \
  --admin-os-pass  'OS-ADMIN-PASS'
```

### Con cert mTLS (no password OS)

Se sul Wazuh hai i cert admin `/etc/wazuh-indexer/certs/admin.pem` + `admin-key.pem` (default install):

```bash
bash scripts/setup-wazuh-integration.sh \
  --endpoint https://localhost \
  --admin-api-pass 'WAZUH-WUI-PASS' \
  --admin-os-cert /etc/wazuh-indexer/certs/admin.pem \
  --admin-os-key  /etc/wazuh-indexer/certs/admin-key.pem
```

### Output `env` per dotenv DA-IPAM

```bash
WAZUH_ADMIN_API_PASS=... WAZUH_ADMIN_OS_PASS=... \
  bash scripts/setup-wazuh-integration.sh \
  --endpoint https://da-wazuh.example.com \
  --output env > /opt/da-invent/.env.wazuh
```

### Output `json` (per pipeline / ingest in DB)

```bash
bash scripts/setup-wazuh-integration.sh ... --output json | jq .
# {
#   "endpoint": "https://da-wazuh.example.com",
#   "wazuh_api": {"url": "...:55000", "user": "da-ipam", "password": "..."},
#   "opensearch": {"url": "...:9200", "user": "da-ipam-os", "password": "..."}
# }
```

### Verifica successiva senza ricreare

```bash
bash scripts/setup-wazuh-integration.sh \
  --endpoint https://da-wazuh.example.com \
  --verify-only \
  --api-user da-ipam --api-pass 'XXX' \
  --os-user  da-ipam-os --os-pass 'YYY'
```

### Solo Wazuh API (no OpenSearch)

```bash
bash scripts/setup-wazuh-integration.sh \
  --endpoint https://da-wazuh.example.com \
  --admin-api-pass '...' \
  --skip-os
```

---

## Cosa fare lato DA-IPAM dopo il setup

1. **Salvare le credenziali in Hub settings** (`hub.db` → `settings` table) tramite UI: *Settings → Integrazioni → Wazuh*. Conservate criptate con `ENCRYPTION_KEY` come fai già per gli agent token (`safeEncrypt()` da `src/lib/crypto.ts`).
2. **Aggiungere un client `src/lib/wazuh/client.ts`** con:
   ```ts
   export async function wazuhFetchJwt(): Promise<string> { ... }
   export async function wazuhListAgents(): Promise<WazuhAgent[]> { ... }
   export async function wazuhSyscollector(agentId: string, kind: 'os'|'hardware'|'packages'|'ports'|'netiface') { ... }
   export async function wazuhCveForAgent(agentId: string): Promise<WazuhCve[]> { /* query OpenSearch */ }
   ```
3. **Sync periodico**: cron node-cron in `server.ts` (es. ogni 60min): per ogni tenant con Wazuh configurato → mappare `agents.ip ↔ hosts.ip` → upsert syscollector + CVE in tenant DB.

---

## Esempi di query da DA-IPAM

### Wazuh API — lista agent

```bash
JWT=$(curl -sk -u da-ipam:PASS -X POST \
  "https://da-wazuh.example.com:55000/security/user/authenticate?raw=true")

curl -sk -H "Authorization: Bearer $JWT" \
  "https://da-wazuh.example.com:55000/agents?limit=500&select=id,name,ip,os.platform,os.version,status,lastKeepAlive"
```

### Wazuh API — syscollector packages di un agent

```bash
curl -sk -H "Authorization: Bearer $JWT" \
  "https://da-wazuh.example.com:55000/syscollector/001/packages?limit=10000"
```

### OpenSearch — CVE Critical per host

```bash
curl -sk -u da-ipam-os:PASS \
  "https://da-wazuh.example.com:9200/wazuh-states-vulnerabilities-*/_search" \
  -H "Content-Type: application/json" -d '{
    "size": 500,
    "query": {"bool": {"must": [
      {"term": {"agent.id": "001"}},
      {"terms": {"vulnerability.severity": ["Critical","High"]}}
    ]}},
    "_source": ["agent.name","vulnerability.id","vulnerability.severity",
                "vulnerability.score.base","package.name","package.version"],
    "sort": [{"vulnerability.score.base": "desc"}]
  }'
```

### OpenSearch — aggregazione CVE per host

```bash
curl -sk -u da-ipam-os:PASS \
  "https://da-wazuh.example.com:9200/wazuh-states-vulnerabilities-*/_search?size=0" \
  -H "Content-Type: application/json" -d '{
    "query": {"term": {"vulnerability.severity": "Critical"}},
    "aggs": {"per_agent": {"terms": {"field": "agent.name", "size": 50}}}
  }'
```

---

## Troubleshooting

| Sintomo | Causa probabile | Fix |
|---------|-----------------|-----|
| `login Wazuh API fallito` | `--admin-api-pass` errata o utente senza role administrator | verifica la password in `wazuh.yml` o resetta con `/var/ossec/framework/python/bin/wazuh-passwords-tool.sh` |
| `create OS role/user fallita` | admin OpenSearch errato — l'utente `admin` di Wazuh non è quello di OpenSearch | usa cert mTLS con `--admin-os-cert /etc/wazuh-indexer/certs/admin.pem --admin-os-key /etc/wazuh-indexer/certs/admin-key.pem` |
| `Connection refused` su 9200 | OpenSearch bound solo su `127.0.0.1` (default Wazuh single-node) | lancia lo script dal server Wazuh, o modifica `network.host` in `/etc/wazuh-indexer/opensearch.yml` + restart indexer |
| `GET /vulnerability/{id}` ritorna 404 | endpoint REST rimosso in Wazuh 4.14+ — *non è un bug* | per le CVE usa OpenSearch (`wazuh-states-vulnerabilities-*`) — è il senso dell'utente OS |
| Dashboard Wazuh dice `[API connection] No API available to connect` dopo lo script | rate-limit Wazuh API saturo (scanner vuln che bombarda :55000) | alza `max_request_per_minute` in `/var/ossec/api/configuration/api.yaml` e restart `wazuh-manager`; soluzione strutturale: escludi il Wazuh dai target dello scanner |
| `403` su `_plugins/_security/api/internalusers` | utente OS senza `cluster:admin/*` | è normale, l'utente `da-ipam-os` è read-only — non è un problema |
| Script ripetuto dice "già esistente" | normale, è idempotente | per rigenerare la password elimina prima l'utente: `DELETE /security/users/{id}` (Wazuh) o `DELETE /_plugins/_security/api/internalusers/{name}` (OS) |

---

## Rollback (eliminare tutto)

```bash
# Wazuh API (USER_ID e ROLE_ID restituiti dallo script o trovabili via GET /security/{users,roles})
JWT_ADMIN=$(curl -sk -u wazuh-wui:ADMIN_PASS -X POST \
  "https://da-wazuh.example.com:55000/security/user/authenticate?raw=true")

curl -sk -X DELETE -H "Authorization: Bearer $JWT_ADMIN" \
  "https://da-wazuh.example.com:55000/security/users?user_ids=USER_ID"
curl -sk -X DELETE -H "Authorization: Bearer $JWT_ADMIN" \
  "https://da-wazuh.example.com:55000/security/roles?role_ids=ROLE_ID"
curl -sk -X DELETE -H "Authorization: Bearer $JWT_ADMIN" \
  "https://da-wazuh.example.com:55000/security/policies?policy_ids=POLICY_ID"

# OpenSearch
curl -sk -u admin:ADMIN_OS_PASS -X DELETE \
  "https://da-wazuh.example.com:9200/_plugins/_security/api/internalusers/da-ipam-os"
curl -sk -u admin:ADMIN_OS_PASS -X DELETE \
  "https://da-wazuh.example.com:9200/_plugins/_security/api/rolesmapping/da-ipam-readonly"
curl -sk -u admin:ADMIN_OS_PASS -X DELETE \
  "https://da-wazuh.example.com:9200/_plugins/_security/api/roles/da-ipam-readonly"
```

---

## Sicurezza

- Le password generate sono 32 caratteri (28 base64 + suffisso `Aa1!` per rispettare i requisiti complessità Wazuh: maiuscola + minuscola + numero + speciale).
- Lo script **non logga le password** in stdout durante l'esecuzione — vengono stampate **solo** nell'output finale.
- Lo script **non aggiorna** la password di un utente già esistente: la rispetta. Per rigenerare, elimina prima l'utente (vedi rollback).
- L'utente OS `da-ipam-os` è completamente isolato dalla RBAC Wazuh API: una compromissione di uno non implica l'altro.
- I permessi sono **strettamente read** (verificato: PUT/DELETE su indici e azioni admin → 403).
