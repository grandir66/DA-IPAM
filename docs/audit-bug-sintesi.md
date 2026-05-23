# Audit bug e gap di sicurezza — sintesi per sviluppo

**Progetto:** DA-IPAM (DA-INVENT) · **Versione analizzata:** v0.2.537  
**Data audit:** 2026-05-23  
**Metodo:** analisi statica + verifica runtime (script + ispezione codice/DB locale)  
**Scope:** 173 route API, `src/lib` (db hub/tenant triplicato), dashboard UI, agent Python, integrazioni, `deploy/`

Documento di handoff per il team di sviluppo. Codici tipo `MT-1`, `SEC-3` per PR, backlog e conversazioni.

---

## Come usare questo documento

1. **Priorità fix** → [Priorità consigliata](#priorità-consigliata)
2. **Multi-tenant** → sezione dedicata (rischio principale di questo prodotto)
3. **Rieseguire verifiche** → `npx tsx scripts/verify-bug-report.ts`
4. **Regole progetto** → [CLAUDE.md](../CLAUDE.md) (auth, triplicazione DB, hub vs tenant)

---

## Executive summary

| Severità | N. finding | Tema dominante |
|----------|------------|----------------|
| **Critical** | 5 | Isolamento tenant, segreti integrazioni, RBAC hub |
| **High** | ~20 | Privilege escalation, proxy interni, agent nmap |
| **Medium** | ~25 | SSRF probe, UI tenant `__ALL__`, debito DB triplicato |
| **Low / debito** | ~15 | Polling UI, rate limit parziale, service root |

**Architettura:** hub (`data/hub.db`) + tenant DB (`data/tenants/<code>.db`). Il rischio #1 è **operare sul tenant sbagliato** o **esporre dati cross-tenant**.

**Verifica runtime (script):** 7/12 ipotesi **CONFIRMED** — vedi [Script di verifica](#script-di-verifica).

**Punti di forza:**

- Credenziali device/AD cifrate AES-GCM; letture via `safeDecrypt()`
- Agent: bearer + scope, subprocess senza `shell=True`, test auth in `agent/tests/`
- Rate limit login (5 tentativi / 15 min)
- Wazuh credentials cifrate (a differenza di LibreNMS/Graylog)
- Molte route mutanti con Zod + `withTenantFromSession`

---

## Priorità consigliata

| Ordine | Codice | Fix | Sforzo | File principali |
|--------|--------|-----|--------|-----------------|
| 1 | MT-1 | Eliminare fallback silenzioso `getDb()` → DEFAULT | M | `src/lib/db.ts` |
| 2 | MT-2 | Bloccare mutazioni con `tenantCode === "__ALL__"` (non remap a DEFAULT) | M | `src/lib/api-tenant.ts` |
| 3 | RBAC-1 | Usare `requireSuperAdmin()` su hub: users, tenants, system, agent tokens | M | `api-auth.ts`, route hub |
| 4 | RBAC-2 | `select-tenant`: verificare `getUserTenantAccess()` anche per `admin` | S | `auth/select-tenant/route.ts` |
| 5 | SEC-1 | Redact/mask token integrazioni; GET solo admin; cifrare at-rest | M | `integrations/config.ts`, `integrations/[component]/route.ts` |
| 6 | SEC-2 | `requireAdmin` su `POST /api/scans/trigger` | S | `scans/trigger/route.ts` |
| 7 | MT-3 | Wrappare `networks/[id]/refresh`, `apply-classifications`, `monitoring/known-hosts/run-check` in `withTenantFromSession` | S | route networks/monitoring |
| 8 | SEC-3 | Restringere proxy Wazuh/LibreNMS a admin | S | `integrations/proxy/*/route.ts` |
| 9 | SEC-4 | Scope `client-config` per tenant assegnati | M | `client-config/route.ts` |
| 10 | SEC-5 | Non loggare password in install job logs | S | `integrations/librenms.ts`, install-progress |
| 11 | AGENT-1 | Nmap: validare IP/CIDR + `--` prima del target | S | `agent/.../exec/nmap.py` |
| 12 | DB-1 | Collassare triplicazione: `db.ts` thin re-export, rimuovere `db-legacy.ts` | L | `db.ts`, `db-tenant.ts` |
| 13 | DEPLOY-1 | Service non-root + capability per nmap/raw | M | `deploy/da-invent.service` |
| 14 | UI-1 | Discovery rescan: poll progress, non success immediato | S | `discovery/page.tsx` |
| 15 | SEC-6 | Rate limit su scan, credential test, test-snmp | M | `rate-limit.ts` + route sensibili |

---

## Critical

### MT-1 — Fallback silenzioso su tenant DEFAULT

**File:** `src/lib/db.ts` (L102–109)

Se esiste `hub.db` ma **nessun contesto tenant** in AsyncLocalStorage, `getDb()` apre **`DEFAULT.db` senza errore**. Route che importano `@/lib/db` senza `withTenantFromSession()` operano sul tenant sbagliato.

**Evidenza runtime:** CONFIRMED (`hubExists`, `defaultTenantExists`, codice presente).

**Esempi route a rischio:** `networks/[id]/refresh/route.ts` (usa `@/lib/db` diretto).

---

### MT-2 — Superadmin `__ALL__` → mutazioni su DEFAULT

**File:** `src/lib/api-tenant.ts` (L40–44, L53–57)

`withTenantFromSession()` e `getServerTenantCode()` mappano `__ALL__` → `"DEFAULT"`. UI aggregata mostra tutti i tenant; mutazioni colpiscono solo DEFAULT.

**Evidenza runtime:** CONFIRMED.

**Fix atteso:** rifiutare mutazioni in modalità `__ALL__` o richiedere tenant esplicito.

---

### RBAC-1 — `requireSuperAdmin()` mai usato

**File:** `src/lib/api-auth.ts` — helper definito, **0 route** lo invocano.

Operazioni hub (users CRUD, tenants DELETE, system update/promote, agent token) usano solo `requireAdmin()` → **admin di un tenant = poteri hub**.

**Evidenza runtime:** CONFIRMED (`routeFilesUsingIt: 0`).

---

### SEC-1 — Segreti integrazioni in chiaro a qualsiasi utente auth

**File:** `src/app/api/integrations/[component]/route.ts` (GET → `requireAuth` only)

`getIntegrationConfig()` legge `apiToken`, `password`, `adminPassword` **in plaintext** da hub `settings`. Response JSON completa al client.

**Evidenza:** ispezione codice + `integrations/config.ts`. Token LibreNMS/Graylog non cifrati (Wazuh sì).

---

### RBAC-2 — Tenant admin: switch cross-tenant

**File:** `src/app/api/auth/select-tenant/route.ts` (L41–42)

```typescript
if (role === "superadmin" || role === "admin") {
  return NextResponse.json({ success: true, tenantCode, ... });
}
```

Solo `viewer` passa da `getUserTenantAccess()`. **Admin può selezionare qualsiasi tenant** senza assegnazione.

**Evidenza:** ispezione codice (confermato audit statico).

---

## High

### Isolamento tenant e RBAC

| Codice | Finding | File |
|--------|---------|------|
| RBAC-3 | Tenant `admin` può creare/promuovere utenti `superadmin` | `users/route.ts`, `users/[id]/route.ts` |
| RBAC-4 | GET/PUT/DELETE tenant qualsiasi per admin; DELETE cancella DB tenant | `tenants/[id]/route.ts` |
| RBAC-5 | Lista tenant completa per admin (non solo assegnati) | `tenants/route.ts` |
| RBAC-6 | POST creazione tenant: commento “solo superadmin” ma `requireAdmin()` | `tenants/route.ts` |
| SEC-7 | `client-config`: qualsiasi auth user legge config VPN/credentiali per codice | `client-config/route.ts` |
| SEC-8 | `GET /api/backup` — download `ipam.db` legacy, no tenant scope | `backup/route.ts` |
| RBAC-7 | Token agent rotazione per qualsiasi tenant ID (admin) | `tenants/[id]/agent/token/*` |

### Operazioni invasive

| Codice | Finding | File |
|--------|---------|------|
| SEC-2 | **Viewer** può lanciare scan (nmap, ARP, AD sync, …) | `scans/trigger/route.ts` |
| SEC-9 | `GET /api/test-snmp?host=` — probe SNMP verso host arbitrario | `test-snmp/route.ts` |
| SEC-10 | Proxy Wazuh/LibreNMS per qualsiasi auth user; TLS verify off | `integrations/proxy/*` |

### Database / architettura

| Codice | Finding | File |
|--------|---------|------|
| DB-1 | Triplicazione `db.ts` / `db-tenant.ts` / `db-legacy.ts` (~7k×3 righe); drift feature | `src/lib/db*.ts` |
| DB-2 | `db-legacy.ts` zero import — dead code | Verificato runtime |
| DB-3 | Migration `network_devices_v2` può perdere `physical_device_id` | `db-tenant.ts` |
| DB-4 | `updateNetworkDevice` whitelist omette `physical_device_id` | `db-tenant.ts`, `db.ts` |
| DB-5 | `resetConfiguration()` incompleto (manca wazuh, software, services, …) | `db-tenant.ts` |

### Integrazioni e deploy

| Codice | Finding | File |
|--------|---------|------|
| SEC-11 | Password admin in log install job (LibreNMS) | `integrations/librenms.ts` |
| DEPLOY-1 | `User=root` in produzione | `deploy/da-invent.service` — CONFIRMED runtime |
| SEC-12 | Credenziali Docker hardcoded (`librenms_secret_pw`, …) | `integrations/librenms.ts` |
| SEC-13 | `GET /api/credentials?for_edit=1` decrypt username per non-admin | `credentials/[id]/route.ts` |

### Agent

| Codice | Finding | File |
|--------|---------|------|
| AGENT-1 | Nmap: `ip`/`target` append senza `--` → flag injection se valore inizia con `-` | `agent/.../exec/nmap.py` L113, L178 |
| AGENT-2 | `custom_args` sanitizza solo `-sU`/`-sS`; resto pass-through | `nmap.py` `_tcp_args_from_custom` |

### Frontend

| Codice | Finding | File |
|--------|---------|------|
| UI-1 | Discovery “Riscansione”: success prima che scan async finisca | `discovery/page.tsx` |
| UI-2 | Poll scan senza timeout/cleanup on unmount | `objects/[id]`, `discovery`, `devices/[id]` |
| UI-3 | Dashboard SSR usa DEFAULT in modalità `__ALL__` | `page.tsx`, `api-tenant.ts` |

---

## Medium (selezione)

### SSRF / rete

- `POST integrations/scanner-edge/test` — URL arbitrario admin, no blocklist IP privati
- `POST devices/detect-protocol` — probe protocollo su host arbitrario (admin)
- LDAP/WinRM/scanner-edge: `rejectUnauthorized: false` / cert ignore

### Resilienza

- `JSON.parse` / `request.json()` senza try-catch su alcune route (users, setup, system/update)
- Transazioni incomplete: `bulkUpsertDhcpLeases`, `deleteHostsBulk`
- N+1: `getCredentialById` in loop su bulk credential/inventory sync

### UI / UX

- Fetch race su chart period, Wazuh batch su ogni edit host
- Molte pagine senza `router.refresh()` (accettabile se refetch client coerente)
- Admin UI (backup, cert, edge) visibile a viewer con 403 API

### Rate limiting

- Esiste `rate-limit.ts` — **solo login** oggi
- Nessun rate limit su scan trigger, credential test, SNMP test (audit API: 173 route)

### Hub settings

- `GET /api/settings` — tutti gli hub settings a qualsiasi auth user
- `PUT system/update-channel` — scrive `.env.local` (admin)

---

## Low / debito tecnico

- `decrypt` importato ma non usato nei DB layer (solo `safeDecrypt` — OK)
- Salt scrypt fisso `"da-ipam-salt"` in `crypto.ts`
- HTTP redirect usa header `Host` client-side (`server.ts`) se TLS redirect attivo
- `GET /api/system/update?action=status` espone `projectRoot`
- Agent `/healthz`, `/version` non autenticati (by design)
- `version-release.js`: `git add -A` — rischio file non voluti in release

---

## Aree sane (non rompere senza motivo)

| Area | Stato |
|------|-------|
| Login rate limit | 5 fail / 15 min (`auth.ts`) |
| Device/AD credential encryption | AES-GCM at-rest |
| Wazuh hub credentials | Cifrate (vs LibreNMS/Graylog plaintext) |
| Agent subprocess | argv list, no shell |
| Agent auth tests | `agent/tests/test_auth.py` |
| SNMP community read | `safeDecrypt` |
| TypeScript | `npx tsc --noEmit` passa |
| Zod su scan trigger, credentials, tenants | Presente |

---

## Script di verifica

Creato in repo:

```bash
cd /path/to/DA-IPAM
npx tsx scripts/verify-bug-report.ts
```

Ipotesi verificate automaticamente:

| ID | Esito | Nota |
|----|-------|------|
| H1 | CONFIRMED | getDb DEFAULT fallback |
| H2 | CONFIRMED | __ALL__ → DEFAULT |
| H3 | CONFIRMED | requireSuperAdmin unused |
| H4 | — | Verificare manualmente select-tenant (audit statico: CONFIRMED) |
| H5 | CONFIRMED | scans/trigger no admin |
| H6 | CONFIRMED | network refresh no tenant |
| H7 | — | Integration GET: confermato da code review |
| H8 | — | client-config: confermato da code review |
| H9 | — | Rate limit solo login (non API generali) |
| H10 | CONFIRMED | db-legacy dead |
| H11 | — | Nmap injection: confermato da code review |
| H12 | CONFIRMED | systemd User=root |

---

## Confronto con DA-Vul-can

| Aspetto | DA-Vul-can | DA-IPAM |
|---------|------------|---------|
| Rischio #1 | PII verso Anthropic | Isolamento multi-tenant |
| Auth model | Single-tenant + admin | Hub + tenant + superadmin/admin/viewer |
| DB layer | Singolo + migrazioni inline | Triplicato (drift) |
| Rate limit | 3 upload route | Solo login |
| Agent | Edge bridge bearer | Tenant agent scope nmap/ssh/winrm |

Audit complementare DA-Vul-can: [`DA-Vul-can/docs/audit-bug-sintesi.md`](../../DA-Vul-can/docs/audit-bug-sintesi.md) (repo sibling).

---

## Proposta integrazione backlog

```markdown
### MT-AUDIT-1 — Isolamento tenant (CRITICAL)
Fix MT-1, MT-2, MT-3. Fail-fast senza contesto; no __ALL__ mutations; audit route @/lib/db.

### RBAC-AUDIT-1 — Superadmin e hub (CRITICAL)
Fix RBAC-1..7. requireSuperAdmin su hub ops; select-tenant access check per admin.

### SEC-AUDIT-1 — Segreti e proxy integrazioni (HIGH)
Fix SEC-1, SEC-3, SEC-5, SEC-11. Cifrare token LibreNMS/Graylog; admin-only GET.

### DB-AUDIT-1 — Triplicazione e migrazioni (HIGH)
Fix DB-1..5. Thin facade; delete db-legacy; fix physical_device_id migration.

### AGENT-AUDIT-1 — Hardening nmap (MEDIUM)
Fix AGENT-1, AGENT-2. Validazione target + -- separator.
```

---

## Riferimenti

| Documento | Uso |
|-----------|-----|
| [CLAUDE.md](../CLAUDE.md) | Regole anti-regressione, comandi, hub vs tenant |
| [docs/MANUALE-SVILUPPATORE.md](./MANUALE-SVILUPPATORE.md) | Architettura dettagliata |
| [.claude/rules/api-routes.md](../.claude/rules/api-routes.md) | Auth e rate limit |
| [docs/playbooks/DR.md](./playbooks/DR.md) | Disaster recovery |

---

*Generato da audit automatizzato (173 API routes, 4 agenti paralleli, script verifica). Per singole voci citare il codice (es. MT-1) in PR/issue.*
