# WAVE 0 — Report (misura & pulizia) · 2026-07-19

Esecuzione della Wave 0 del `PIANO-INTERVENTO`. Tre task: inventario auth, stato bug audit,
potatura branch. Output usato per calibrare **Wave 1** su dati reali invece che stime.

---

## W0-1 — Inventario guardie auth

Script: **`scripts/audit-api-auth.ts`** → **`docs/auth-matrix.md`** (rigenerabile:
`AUDIT_STAMP=$(date +%F) npx tsx scripts/audit-api-auth.ts`).

**Correzione di metodo rispetto alla stima iniziale.** `withTenantFromSession` ritorna 401
senza sessione → **impone l'autenticazione, non il ruolo**. Quindi una *lettura* `session-only`
è protetta quanto `requireAuth`: non è una vulnerabilità. Flaggare tutte le GET `session-only`
(erano 55) era un falso allarme. Il rischio vero, misurato:

| Categoria | Conteggio | Significato |
|---|---|---|
| Endpoint totali (metodo×route) | 399 | su 268 route file |
| 🔴 **FLAG** | **13** | mutazioni eseguibili da viewer **+** endpoint senza guardia |
| — di cui mutazioni viewer | 8 | POST/PUT/PATCH senza `requireAdmin` |
| — di cui `none` (no guardia, non pubblici) | 7 | da verificare: auth via token interno? |
| 🟡 **REVIEW** | **14** | letture sensibili (credenziali/segreti/trigger) → valutare admin + POST |

### 🔴 FLAG — fix diretto in Wave 1
Mutazioni da elevare a `requireAdmin`:
- `PATCH /api/analytics/anomalies/[id]`
- `POST /api/devices/test-provisional`
- `POST /api/integrations/meshcentral/host-status`
- `POST /api/integrations/wazuh/host-status`
- `POST /api/networks/export-csv`
- `PUT /api/user/preferences` *(valutare: preferenze utente → forse `requireAuth` basta, non admin)*

Endpoint `none` da **verificare** (probabile auth via token agent, non sessione — decisione prodotto):
- `GET/POST /api/inventory/ingest` — ingest agente
- `POST /api/onboarding/complete`, `GET /api/onboarding/status` — flusso onboarding
- `GET /api/integrations/inventory-agent/install/{linux.sh,macos.sh,windows.ps1}` — script installer pubblici (token firmato?)

### 🟡 REVIEW — letture sensibili da elevare (admin + conversione a POST dove c'è side-effect)
Le più rilevanti (usano credenziali vault / lanciano probe):
- `GET /api/credentials/[id]/test-snmp`, `GET /api/networks/[id]/test-snmp`, `GET /api/networks/[id]/test-dns`, `GET /api/test-arp`, `GET /api/test-snmp`
- `GET /api/credentials`, `GET /api/credentials/[id]`, `GET /api/devices/[id]/credentials`, `GET /api/hosts/[id]/credentials`, `GET /api/networks/[id]/credentials`
- `GET /api/export`, `GET /api/inventory/export`, `GET /api/client-config/export`, `GET /api/integrations/[component]/test-connection`

---

## W0-2 — Stato bug dall'audit esistente

`npx tsx scripts/verify-bug-report.ts` → **5 CONFIRMED · 6 REJECTED · 1 INCONCLUSIVE**.

| ID | Esito | Rilevanza per il piano |
|---|---|---|
| **H1** getDb() silent DEFAULT fallback | 🔴 CONFIRMED | **Prerequisito Wave 5** (facade DB): tenant leak, chiudere PRIMA del refactor |
| **H2** `__ALL__` superadmin → DEFAULT tenant DB | 🔴 CONFIRMED | Idem — tenant sbagliato peggio di auth debole |
| **H3** `requireSuperAdmin` definito ma **mai usato** (0 route) | 🔴 CONFIRMED | Wave 1: route hub/utenti/tenant vanno elevate a superadmin |
| **H10** `db-legacy.ts` codice morto (0 import) | 🔴 CONFIRMED | Wave 4: conferma rimozione |
| **H12** systemd gira come **root** | 🔴 CONFIRMED | **NUOVO** — non era nel piano: hardening `User=` dedicato (aggiunto a Wave ∞) |
| H7 token integrazioni esposti via GET | 🟢 REJECTED | ma nota: **token in chiaro in hub settings** → item at-rest (come Infra-6 DA-Vulcan) |
| H5 viewer lancia scan | 🟢 REJECTED | la route *scan* è guardata; i FLAG W0-1 sono su *altre* route (test-*, ingest) |
| H8 client-config leggibile senza tenant scope | 🟡 INCONCLUSIVE | incrocia con REVIEW `client-config/export` |

**Due nuovi item emersi** (non nel piano originale, aggiunti alla coda):
- **H12**: `da-invent.service` come root → creare user dedicato + `ProtectSystem`.
- **H7-nota**: token integrazioni in chiaro in hub settings → cifratura at-rest (gemello di Infra-6).

---

## W0-3 — Potatura branch

Stato: **15 branch tutti già merged in `dev`, 0 con lavoro pendente**. Eliminati (nessun commit perso):
tutti i `claude/*`, `bugfix/code-audit-*`, `feat/rmm-meshcentral`, `feature/{patch-management-module,remote-agents,wazuh-device-enrichment}`.
Rimasti: **`dev` + `main`**. Board pulita.

---

## Esito: Wave 1 ricalibrata

Backlog reale (invece del "~21" stimato):
1. **6 mutazioni** → `requireAdmin` (1 da valutare: `user/preferences`).
2. **7 endpoint `none`** → verificare/aggiungere auth (token agent o guardia).
3. **~10 letture sensibili** (credenziali/probe) → elevare ad admin + convertire i trigger a POST.
4. **H3**: applicare `requireSuperAdmin` alle route hub.
5. Test regressione `api-auth-matrix.test.ts` sulle route toccate.

Prerequisito **Wave 5** (facade DB): **H1/H2 sono CONFIRMED** → vanno chiusi prima del refactor `db.ts`.
