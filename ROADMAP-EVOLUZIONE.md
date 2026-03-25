# Roadmap DA-INVENT — Evoluzione Piattaforma Infrastrutturale

## Contesto

DA-INVENT è un IPAM multi-tenant (Next.js 16 + SQLite) che gestisce discovery, inventario e scansione reti.
Questa roadmap definisce l'evoluzione verso una piattaforma completa di gestione infrastrutturale, attraverso 5 fasi indipendenti e non distruttive.

**Principio guida**: ogni fase aggiunge funzionalità senza modificare i file core esistenti.
Ogni integrazione è opzionale, disattivabile per tenant, e funziona air-gapped (nessuna dipendenza cloud).

---

## Mappa delle fasi

```
Fase 0 ──► Fase 1 ──► Fase 2 ──► Fase 3 (A/B/C parallele)
  │            │           │
  │            │           └── Graylog (log management)
  │            └── LibreNMS (monitoring SNMP)
  │
  └── Collector Sync (centralizzazione dati)

Fase 3A: Anomaly Detection  ─┐
Fase 3B: Classificazione     ├── Parallele, nessuna dipendenza esterna
Fase 3C: Capacity Planning  ─┘
```

---

## FASE 0 — Collector Sync (centralizzazione dati)

### Obiettivo
Aggregare i dati di tutte le istanze DA-INVENT in un collector centrale via WebSocket.

### Architettura
```
┌─────────────────────────────────────────────────┐
│           DA-INVENT COLLECTOR                    │
│      (Fastify + PostgreSQL + ws)                 │
│                                                  │
│  WebSocket Hub ←── agenti connessi               │
│  REST API ←── admin dashboard                    │
│  PostgreSQL ←── dati aggregati multi-tenant      │
└───────┬──────────────┬──────────────┬────────────┘
        │ WSS          │ WSS          │ WSS
┌───────▼──────┐ ┌─────▼────────┐ ┌──▼──────────────┐
│  DA-INVENT   │ │  DA-INVENT   │ │  DA-INVENT      │
│  + agent mod │ │  + agent mod │ │  + agent mod    │
│  (notebook)  │ │  (notebook)  │ │  (server fisso) │
└──────────────┘ └──────────────┘ └─────────────────┘
```

Dati salgono (agent → collector), comandi scendono (collector → agent).

### Parte A: Collector (progetto separato)

**Stack**: Node.js 20+, Fastify, `ws`, PostgreSQL 16, Drizzle ORM

**Struttura**:
```
da-invent-collector/
├── docker-compose.yml        # PG + collector
├── src/
│   ├── index.ts              # Avvio HTTP + WS
│   ├── config.ts             # .env configuration
│   ├── db/
│   │   ├── client.ts         # Drizzle + pg
│   │   ├── schema.ts         # Drizzle schema
│   │   └── migrate.ts
│   ├── ws/
│   │   ├── hub.ts            # WebSocket Hub (pattern DADude3)
│   │   ├── protocol.ts       # Tipi messaggi condivisi
│   │   ├── auth.ts           # Token validation handshake
│   │   └── handlers.ts       # Handler: heartbeat, sync, result
│   ├── api/
│   │   ├── router.ts         # Fastify routes
│   │   ├── agents.ts         # CRUD agenti
│   │   ├── tenants.ts        # Vista aggregata
│   │   └── commands.ts       # Invio comandi
│   ├── sync/
│   │   ├── ingest.ts         # Payload sync → PG
│   │   └── transform.ts      # Shape SQLite → PG
│   └── services/
│       ├── agent-registry.ts
│       └── cleanup.ts
└── migrations/
    └── 0001_initial.sql
```

**Schema PG**:
- `agents` (instance_id UUID, name, token_hash, version, status, last_seen_at, metrics JSONB)
- `agent_tenants` (agent_id, tenant_code, tenant_name, last_sync_at, host_count, network_count)
- `sync_log` (agent_id, tenant_code, entity_type, sync_type, records count, duration_ms, status)
- `command_log` (command_id UUID, agent_id, action, params JSONB, status, result JSONB)
- `synced_networks` (source_agent_id, tenant_code, source_id + cidr, name, gateway, vlan_id)
- `synced_hosts` (source_agent_id, tenant_code, source_id + ip, mac, vendor, hostname, classification, status, model, serial)
- `synced_network_devices` (source_agent_id, tenant_code, source_id + name, host, device_type, vendor, model, firmware)
- `synced_inventory_assets` (source_agent_id, tenant_code, source_id + asset_tag, serial, hostname, categoria, stato)
- `synced_status_history` (source_host_id, status, response_time_ms, checked_at — max 7gg)

### Parte B: Modulo Agent in DA-INVENT

**ZERO modifiche ai file core** (db-hub-schema.ts, server.ts, next.config.ts).

**Nuovi file**:
```
src/lib/collector-sync/
├── index.ts              # Singleton lazy: startAgentSync(), getAgentStatus()
├── config.ts             # Legge config da data/collector-queue.db
├── client.ts             # WebSocket client (reconnection + heartbeat)
├── protocol.ts           # Tipi messaggi (identici al collector)
├── heartbeat.ts          # Heartbeat 60s con metriche OS
├── sync-extractor.ts     # Estrae dati tenant (read-only su tenant DB)
├── sync-scheduler.ts     # Cron trigger sync
├── command-handler.ts    # Gestisce comandi dal collector
├── queue.ts              # Store & forward su data/collector-queue.db
└── types.ts
```

**Database**: `data/collector-queue.db` (file SQLite separato, autonomo)
```sql
CREATE TABLE IF NOT EXISTS queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_type TEXT NOT NULL, payload TEXT NOT NULL,
  tenant_code TEXT, created_at TEXT DEFAULT (datetime('now')),
  attempts INTEGER DEFAULT 0, max_attempts INTEGER DEFAULT 10,
  status TEXT DEFAULT 'pending'
);
CREATE TABLE IF NOT EXISTS config (
  key TEXT PRIMARY KEY, value TEXT NOT NULL
);
```

**Endpoint API**: `/api/collector-sync/status|configure|test|sync-now`

**Protocollo sync**: incrementale per `updated_at`, chunk max 500, store & forward offline (backoff esponenziale 1s→300s, TTL 7gg).

**Dati MAI sincronizzati**: encrypted_password, encrypted_username, api_token, community_string, raw_output, detection_json, snmp_data.

### Sottofasi implementazione
| Step | Cosa | Stima |
|------|------|-------|
| 0a | Scaffold collector + PG schema + WS hub + ingest networks/hosts | 3gg |
| 0b | Modulo agent in DA-INVENT + client WS + heartbeat + sync networks/hosts | 3gg |
| 0c | Sync completo (devices, inventory, status_history, scan_summary) + comandi | 3gg |
| 0d | Admin UI collector stile Domarc (agenti, tenant, log, comandi) | 5gg |
| 0e | Docker Compose produzione + mTLS opzionale | 2gg |

### Rischi e mitigazioni
| Rischio | Mitigazione |
|---------|-------------|
| Agent module tocca file core | DB separato, singleton lazy, zero import nei file esistenti |
| Sync payload troppo grande | Chunking max 500 record, compressione opzionale |
| Collector offline | Store & forward locale, TTL 7gg, backoff esponenziale |
| Conflitti dati | Flusso unidirezionale (agent → collector), last-write-wins |

---

## FASE 1 — LibreNMS (Monitoring SNMP)

### Obiettivo
Integrare LibreNMS per monitoring continuo con grafici, alert e metriche SNMP dei device già scoperti da DA-INVENT.

### Architettura
```
DA-INVENT ──(API REST)──► LibreNMS (Docker, stessa VM)
                           │
                           ├── Polling SNMP device registrati
                           ├── Grafici banda/CPU/RAM/errori
                           └── Alert su soglie
```

LibreNMS gira in Docker sulla stessa VM di DA-INVENT. DA-INVENT usa le API REST di LibreNMS per:
1. **Registrare device** scoperti durante le scansioni → LibreNMS inizia il polling
2. **Recuperare metriche/grafici** → mostrati nelle pagine device di DA-INVENT
3. **Sincronizzare alert** → widget alert nella dashboard DA-INVENT

### Struttura modulo
```
src/lib/librenms/
├── client.ts             # API client REST (fetch wrapper)
├── types.ts              # Tipi LibreNMS (Device, Port, Alert, Graph)
├── sync.ts               # Logica sync device DA-INVENT → LibreNMS
└── config.ts             # Lettura config per tenant (URL + API key)
```

### Configurazione per tenant
In tabella `settings` del tenant DB (già esistente):
- `librenms_url` — es. `http://localhost:8080/api/v0`
- `librenms_api_key` — cifrato con encrypt()
- `librenms_sync_enabled` — "1" / "0"
- `librenms_auto_register` — registra automaticamente device scoperti

### Flusso operativo
1. **Scan DA-INVENT** scopre un device (router, switch) con SNMP community
2. **Cron job `librenms_sync`** (nuovo) → per ogni device con SNMP:
   - Controlla se esiste in LibreNMS (`GET /api/v0/devices?type=hostname&query=<ip>`)
   - Se no → registra (`POST /api/v0/devices` con hostname, community, version)
   - Se sì → aggiorna metadata se cambiato
3. **Pagina device DA-INVENT** mostra:
   - Stato polling LibreNMS (up/down/pending)
   - Grafici traffico interfacce (embed URL grafici LibreNMS)
   - Alert attivi dal device
4. **Dashboard** → widget "Alert LibreNMS" con conteggio per severità

### Nuovi endpoint API
- `GET /api/devices/[id]/librenms-status` — stato device in LibreNMS
- `POST /api/devices/[id]/librenms-register` — registra manualmente
- `GET /api/librenms/alerts` — alert attivi aggregati

### Nuova tabella tenant DB
```sql
CREATE TABLE IF NOT EXISTS librenms_devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  network_device_id INTEGER NOT NULL REFERENCES network_devices(id),
  librenms_device_id INTEGER,          -- ID in LibreNMS
  librenms_hostname TEXT,
  sync_status TEXT DEFAULT 'pending',   -- pending|synced|error|disabled
  last_sync_at TEXT,
  last_error TEXT,
  UNIQUE(network_device_id)
);
```

### Nuovo cron job
```typescript
// In src/lib/cron/jobs.ts — nuovo case nel switch:
case "librenms_sync":
  return await runLibreNMSSync(networkId);
```

### Problemi potenziali
| Problema | Soluzione |
|----------|-----------|
| LibreNMS non raggiungibile | Timeout 5s, retry nel prossimo ciclo, stato "error" nel DB |
| Community string diversa tra DA-INVENT e LibreNMS | DA-INVENT passa la community decifrata all'API LibreNMS |
| Device duplicati | Match per IP (hostname), verifica esistenza prima di registrare |
| SNMP v3 credentials | Passare user/authKey/privKey via API LibreNMS (supportato) |
| Grafici embed: CORS/auth | Usare LibreNMS API per ottenere URL grafico firmato, o proxy via Next.js API route |

### Sottofasi
| Step | Cosa | Stima |
|------|------|-------|
| 1a | Docker Compose LibreNMS + configurazione base | 1gg |
| 1b | `src/lib/librenms/client.ts` + types + config per tenant | 2gg |
| 1c | Cron job `librenms_sync` + tabella `librenms_devices` | 2gg |
| 1d | UI: sezione device page + widget dashboard + settings | 3gg |
| 1e | Test end-to-end: discovery → auto-register → grafici | 1gg |

### Impatto su file esistenti
| File | Modifica |
|------|----------|
| `src/lib/cron/jobs.ts` | Aggiunta case `librenms_sync` (1 riga + import) |
| `src/lib/db-tenant-schema.ts` | Aggiunta tabella `librenms_devices` |
| `src/app/(dashboard)/devices/[id]/page.tsx` | Nuova sezione/tab "Monitoring" |
| `src/app/(dashboard)/settings/page.tsx` | Nuova sezione "LibreNMS" |
| `src/app/(dashboard)/page.tsx` | Widget alert (opzionale) |

---

## FASE 2 — Graylog (Log Management)

### Obiettivo
Centralizzare i log di Windows, Linux e device di rete in Graylog, con correlazione per IP/hostname nella UI di DA-INVENT.

### Scelta: Graylog (non Loki)
**Graylog** perché: esperienza diretta già presente, UI ricerca integrata, GELF nativo, alerting built-in, sidecar per Windows. Loki risparmia ~4GB RAM ma richiede Grafana e ha ricerca meno potente.

### Architettura
```
┌──────────────────────────────────────────────────────┐
│                      Graylog                          │
│  (Docker: graylog + mongodb + opensearch)            │
│                                                       │
│  ◄── WinLogBeat/Sidecar (Windows)                    │
│  ◄── rsyslog (Linux)                                  │
│  ◄── syslog nativo (switch, router, firewall)        │
│                                                       │
│  API REST: /api/search/universal, /api/streams        │
└───────────────────┬──────────────────────────────────┘
                    │ REST API
           ┌────────▼────────┐
           │   DA-INVENT     │
           │  (query + show) │
           └─────────────────┘
```

### Struttura modulo
```
src/lib/graylog/
├── client.ts             # API client REST Graylog
├── types.ts              # Tipi: GraylogMessage, GraylogStream, GraylogAlert
├── search.ts             # Query builder per correlazione IP/hostname
└── config.ts             # Config per tenant (URL + API token)
```

### Configurazione per tenant
- `graylog_url` — es. `http://localhost:9000/api`
- `graylog_api_token` — cifrato con encrypt()
- `graylog_enabled` — "1" / "0"
- `graylog_default_stream_id` — stream da cui cercare (opzionale)

### Flusso operativo
1. **Sorgenti log** (WinLogBeat, rsyslog, syslog device) inviano a Graylog direttamente — DA-INVENT NON è intermediario
2. **DA-INVENT** interroga Graylog via API quando l'utente apre una pagina host/device:
   - `GET /api/search/universal/relative?query=source:<ip>&range=86400`
   - Filtra per IP sorgente o hostname
3. **Pagina host** → nuovo tab "Log" con ultimi 50 eventi, filtro severità, link a Graylog
4. **Pagina device** → idem, filtrato per IP device
5. **Dashboard** → widget "Log critici ultimi 24h" con conteggio per severità

### Nuovi endpoint API DA-INVENT
- `GET /api/hosts/[id]/logs` — proxy verso Graylog filtrato per IP host
- `GET /api/devices/[id]/logs` — proxy verso Graylog filtrato per IP device
- `GET /api/graylog/summary` — conteggio eventi per severità (dashboard widget)

### Nessuna nuova tabella
Graylog è la sorgente di verità per i log. DA-INVENT fa solo query. Cache opzionale in-memory (60s TTL) per le query dashboard.

### Problemi potenziali
| Problema | Soluzione |
|----------|-----------|
| Graylog richiede 3-4GB RAM | Requisito VM: minimo 8GB con Graylog |
| Latenza query API | Cache in-memory 60s per dashboard, query diretta per pagine dettaglio |
| Correlazione IP: IP dinamici | Match anche per hostname/MAC quando disponibile |
| Sidecar deployment Windows | Documentare setup WinLogBeat, opzionale: DA-INVENT genera config |
| Autenticazione Graylog API | Token API (non session), stored cifrato in settings tenant |

### Sottofasi
| Step | Cosa | Stima |
|------|------|-------|
| 2a | Docker Compose Graylog (graylog + mongodb + opensearch) | 1gg |
| 2b | `src/lib/graylog/client.ts` + types + search builder | 2gg |
| 2c | API proxy endpoints (hosts/[id]/logs, devices/[id]/logs) | 1gg |
| 2d | UI: tab "Log" in host/device page + widget dashboard | 3gg |
| 2e | Documentazione setup sorgenti (WinLogBeat, rsyslog, syslog) | 1gg |
| 2f | Settings UI per configurazione Graylog | 1gg |

### Impatto su file esistenti
| File | Modifica |
|------|----------|
| `src/app/(dashboard)/hosts/[id]/page.tsx` | Nuovo tab "Log" |
| `src/app/(dashboard)/devices/[id]/page.tsx` | Nuovo tab "Log" |
| `src/app/(dashboard)/settings/page.tsx` | Nuova sezione "Graylog" |
| `src/app/(dashboard)/page.tsx` | Widget log critici (opzionale) |

---

## FASE 3 — Analytics Integrata (puro TypeScript)

Tre sotto-moduli indipendenti, implementabili in parallelo. Zero dipendenze esterne, funzionano air-gapped.
Unica dipendenza: `simple-statistics` (libreria TS leggera, ~20KB, per z-score e regressione).

### 3A — Anomaly Detection

**Obiettivo**: rilevare automaticamente cambiamenti sospetti tra scansioni successive.

**Cosa rileva**:
| Anomalia | Dati sorgente | Logica |
|----------|---------------|--------|
| Nuovo host sconosciuto | hosts (scan-to-scan diff) | IP non presente nella scansione precedente + known_host=0 |
| MAC flip (IP cambia MAC) | arp_entries, mac_ip_mapping | Stesso IP, MAC diverso in <24h |
| Nuove porte aperte | hosts.open_ports | Porte non viste prima su host known |
| Host offline inatteso | status_history | known_host online → offline per >N cicli |
| Uptime anomalo | status_history | z-score >2σ rispetto baseline 30gg |
| Nuovo device SNMP | network_devices | Device non registrato prima in rete nota |

**Struttura**:
```
src/lib/analytics/
├── anomaly.ts            # Engine principale: detectAnomalies(tenantCode)
├── baseline.ts           # Calcolo baseline statistiche (media, stddev, z-score)
├── diff.ts               # Confronto scan-to-scan (nuovi host, MAC flip, porte)
├── types.ts              # AnomalyEvent, AnomalySeverity, BaselineStats
└── alerts.ts             # Generazione alert da anomalie
```

**Nuova tabella tenant DB**:
```sql
CREATE TABLE IF NOT EXISTS anomaly_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,     -- new_host|mac_flip|new_ports|unexpected_offline|uptime_anomaly
  severity TEXT DEFAULT 'info', -- info|warning|critical
  host_id INTEGER,
  network_id INTEGER,
  description TEXT NOT NULL,
  details TEXT,                 -- JSON con contesto
  resolved INTEGER DEFAULT 0,
  detected_at TEXT DEFAULT (datetime('now')),
  resolved_at TEXT
);
CREATE INDEX idx_anomaly_events_type_date ON anomaly_events(event_type, detected_at DESC);
```

**Nuovo cron job**: `anomaly_scan` — esegue dopo `ping_sweep`, confronta con stato precedente.

**UI**: tab "Anomalie" nella dashboard, badge con conteggio su sidebar, dettaglio per host.

**Stima**: 4gg

### 3B — Classificazione Device Migliorata

**Obiettivo**: migliorare il sistema di fingerprinting esistente con weighted scoring multi-segnale e confidence tracciabile.

**Stato attuale** (in `src/lib/device-fingerprint-classification.ts`):
- Soglia minima confidence: 0.56
- Scoring basato su: porte TCP, OID SNMP, banner HTTP/SSH, TTL, MAC vendor
- ~50 tipi di device riconosciuti
- Regole utente in `fingerprint_classification_map`

**Miglioramenti proposti**:
| Miglioramento | Dettaglio |
|---------------|-----------|
| Weighted scoring esplicito | Peso configurabile per segnale (es. OID: 0.4, porte: 0.3, banner: 0.2, TTL: 0.1) |
| Confidence history | Tracciare come cambia la confidence nel tempo per host |
| Multi-match ranking | Se 3 profili matchano, mostrare tutti con score ordinati |
| Auto-learning leggero | Se l'utente corregge una classificazione, boost quel pattern |
| Report accuracy | Dashboard con % classificati, % incerti, top errori |

**File modificati**:
- `src/lib/device-fingerprint-classification.ts` — aggiunta pesi configurabili
- `src/lib/scanner/device-fingerprint.ts` — ranking multi-match
- `src/lib/db-hub-schema.ts` — tabella `classification_overrides` per user corrections

**Attenzione**: questa è l'unica fase che modifica file core. Le modifiche sono additive (nuove funzioni, nuove tabelle), mai distruttive.

**Stima**: 3gg

### 3C — Capacity Planning

**Obiettivo**: prevedere l'esaurimento di subnet e generare alert proattivi.

**Calcoli**:
| Metrica | Formula |
|---------|---------|
| Occupazione subnet | host_count / (2^(32-prefix) - 2) × 100% |
| Trend occupazione | Regressione lineare su occupazione 30/60/90gg |
| Proiezione esaurimento | Intersezione trend con soglia (es. 90%) |
| Alert soglia | Notifica quando occupazione > 80% |

**Struttura**:
```
src/lib/analytics/
├── capacity.ts           # Calcolo occupazione + proiezione
├── trend.ts              # Regressione lineare (simple-statistics)
└── capacity-types.ts
```

**Nuova tabella tenant DB**:
```sql
CREATE TABLE IF NOT EXISTS subnet_capacity_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  network_id INTEGER NOT NULL REFERENCES networks(id),
  host_count INTEGER NOT NULL,
  total_ips INTEGER NOT NULL,
  occupancy_pct REAL NOT NULL,
  sampled_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_capacity_network_date ON subnet_capacity_history(network_id, sampled_at DESC);
```

**Cron job**: `capacity_snapshot` — campiona occupazione dopo ogni ping_sweep.

**UI**: widget Recharts nella pagina rete (grafico trend + proiezione tratteggiata), alert nella dashboard.

**Stima**: 3gg

---

## Requisiti VM per deployment completo

| Configurazione | RAM | Disco | Note |
|----------------|-----|-------|------|
| DA-INVENT solo | 2GB | 5GB | SQLite, nessun container |
| + LibreNMS | 4GB | 15GB | Docker: LibreNMS + MariaDB |
| + Graylog | +4GB | +20GB | Docker: Graylog + MongoDB + OpenSearch |
| **Tutto** | **8-10GB** | **40GB** | DA-INVENT + LibreNMS + Graylog |
| + Collector | +2GB | +10GB | Docker: Collector + PostgreSQL (se stessa VM) |

---

## Ordine di implementazione consigliato

```
Mese 1:  Fase 0a-0b (Collector MVP: WS + sync base)
         Fase 3C (Capacity Planning — veloce, alto valore)

Mese 2:  Fase 0c-0d (Collector completo + admin UI)
         Fase 3A (Anomaly Detection)

Mese 3:  Fase 1 (LibreNMS)
         Fase 3B (Classificazione migliorata)

Mese 4:  Fase 2 (Graylog)
         Fase 0e (Collector produzione + mTLS)
```

**Razionale**:
- Collector e Capacity Planning sono indipendenti e subito utili
- LibreNMS prima di Graylog: stesso pattern (Docker + API REST), più maturo
- Analytics 3A/3B/3C possono procedere in parallelo con tutto il resto
- Fase 3B (classificazione) è l'unica che tocca file core → pianificarla con attenzione

---

## Dipendenze nuove (package.json)

| Fase | Pacchetto | Dimensione | Note |
|------|-----------|------------|------|
| 0 (Agent) | `ws`, `@types/ws` | ~50KB | WebSocket client |
| 3A/3C | `simple-statistics` | ~20KB | z-score, regressione lineare |
| Collector (progetto separato) | `fastify`, `drizzle-orm`, `pg`, `ws`, `bcrypt` | — | Non impatta DA-INVENT |

---

## Matrice impatto file core DA-INVENT

| File | Fase 0 | Fase 1 | Fase 2 | Fase 3A | Fase 3B | Fase 3C |
|------|--------|--------|--------|---------|---------|---------|
| `db-hub-schema.ts` | ❌ | ❌ | ❌ | ❌ | ⚠️ minimo | ❌ |
| `db-tenant-schema.ts` | ❌ | ✅ +1 tabella | ❌ | ✅ +1 tabella | ❌ | ✅ +1 tabella |
| `server.ts` | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `cron/jobs.ts` | ❌ | ✅ +1 case | ❌ | ✅ +1 case | ❌ | ✅ +1 case |
| `settings/page.tsx` | ❌ | ✅ +sezione | ✅ +sezione | ❌ | ❌ | ❌ |
| `hosts/[id]/page.tsx` | ❌ | ❌ | ✅ +tab | ✅ +badge | ❌ | ❌ |
| `devices/[id]/page.tsx` | ❌ | ✅ +tab | ✅ +tab | ❌ | ❌ | ❌ |
| `page.tsx` (dashboard) | ❌ | ✅ +widget | ✅ +widget | ✅ +widget | ❌ | ✅ +widget |
| `package.json` | ✅ +ws | ❌ | ❌ | ✅ +simple-stats | ❌ | ❌ |

**Legenda**: ❌ = nessuna modifica, ✅ = modifica additiva, ⚠️ = modifica con attenzione

---

## Verifica per fase

### Fase 0 (Collector)
1. `docker compose up` → PG + collector su :8080
2. DA-INVENT: configura collector via `/api/collector-sync/configure`
3. Heartbeat visibile in `GET /api/agents`
4. Dopo sync: dati in PG (`synced_hosts`, `synced_networks`)
5. Comando `ping` dal collector → risposta dall'agent
6. Test offline: stop collector → queue cresce → restart → flush

### Fase 1 (LibreNMS)
1. LibreNMS Docker su :8080
2. DA-INVENT scan rete → device con SNMP scoperti
3. Cron `librenms_sync` → device registrati in LibreNMS
4. Pagina device → grafici traffico da LibreNMS API
5. Dashboard → widget alert

### Fase 2 (Graylog)
1. Graylog Docker su :9000
2. Sorgente test: rsyslog da host Linux
3. DA-INVENT `/api/hosts/[id]/logs` → eventi correlati per IP
4. Tab "Log" nella pagina host con filtro severità
5. Dashboard → widget log critici

### Fase 3A (Anomaly Detection)
1. Due scan successive della stessa rete
2. Aggiungere un host fittizio → "nuovo host sconosciuto" rilevato
3. Cambiare MAC di un IP → "MAC flip" rilevato
4. Dashboard → badge anomalie

### Fase 3C (Capacity Planning)
1. Rete /24 con 200 host
2. Cron `capacity_snapshot` registra campione
3. Pagina rete → grafico occupazione + proiezione
4. Se >80% → alert nella dashboard
