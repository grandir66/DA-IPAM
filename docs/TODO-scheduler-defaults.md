# TODO — Scheduler defaults: `known_host_check` first, `fast_scan` solo on-demand

**Origine**: incident 2026-05-25, tenant DTS (`tenant_code=71734`).
**Stato**: runtime fix applicato in produzione; codebase ancora da allineare.
**Priorità**: alta (regressione potenziale su ogni nuovo tenant/network creato).

---

## 1. Contesto incident

Su LXC dts-invent (172.16.1.133 → CT 10001) il framework auto-creava 2 job
`fast_scan` (= full subnet ICMP sweep) ogni 15 min per ciascun network del
tenant DTS, di cui uno su una `/17` (32 768 IP). Risultato: container saturato
~100% CPU per ore, load 7+.

Handler in [src/lib/cron/jobs.ts](../src/lib/cron/jobs.ts) sono corretti:

- `runPingSweep` / `runFastScan` → discovery completa subnet (pesante)
- `runKnownHostCheck` → ping SOLO `getKnownHosts(networkId)` (= host registrati)

Il bug è solo nei **default di provisioning + UI**.

---

## 2. Runtime fix già applicato (DTS, 2026-05-25)

Eseguito direttamente sul DB tenant `data/tenants/71734/tenant.db`:

```sql
-- Disabilita tutti i fast_scan auto-creati
UPDATE scheduled_jobs SET enabled = 0 WHERE job_type = 'fast_scan';

-- Crea known_host_check ogni 15 min su tutte le network senza
INSERT INTO scheduled_jobs (network_id, job_type, interval_minutes, enabled, next_run)
SELECT n.id, 'known_host_check', 15, 1, datetime('now', '+1 minute')
FROM networks n
WHERE NOT EXISTS (
  SELECT 1 FROM scheduled_jobs s
  WHERE s.network_id = n.id AND s.job_type = 'known_host_check'
);
```

Effetto immediato: load 7.66 → 5.95 in 90 s, sceso sotto 1 nei minuti successivi.
**Non rifare manualmente** su DTS — già fatto. La migrazione del punto 3.2 deve
essere idempotente per non duplicare.

---

## 3. Lavoro da fare in codebase

### 3.1 Default scheduling per nuovi network/tenant

Cercare dove vengono creati i `scheduled_jobs` di default (probabilmente
`src/lib/db-tenant.ts::createNetwork()` o seed in `initializeTenantDb`).
Sostituire la logica "auto-crea `fast_scan` ogni N min" con:

- **Per network**: `known_host_check` ogni 15 min (leggero, scope = host registrati)
- **Globali (no `network_id`)**: `vuln_sync` ogni 30 min, `wazuh_sync` ogni 30 min se attivi
- **NON** auto-creare `fast_scan` / `ping_sweep` / `nmap_scan` schedulati →
  solo on-demand dalla UI

Warning runtime se network ≥ /22 (>1024 IP) e qualcuno tenta di schedulare
`fast_scan`:

> "Network <CIDR> ha N IP — `fast_scan` schedulato può saturare CPU.
> Usa `known_host_check` (default) + discovery manuale on-demand."

### 3.2 Migrazione idempotente al boot

In [server.ts](../server.ts) (avvio scheduler) o in `initializeTenantDb()`,
per ogni tenant esistente:

```ts
// Per ogni network senza known_host_check → INSERT
// Per ogni fast_scan/ping_sweep attivo su network >= /22 → enabled = 0 + log warning
```

Tracciata in `tenant_meta` (o `meta`) con chiave:
`migration_known_host_check_applied = 1` → eseguita una sola volta per tenant.

### 3.3 UI Settings → Scheduled Jobs (revisione)

[src/app/(dashboard)/settings/page.tsx](../src/app/(dashboard)/settings/page.tsx)
(o sotto-pagina jobs). Verificare/migliorare:

- Job per `job_type` con descrizione human-readable:
  - `known_host_check` → "Ping host registrati" (consigliato per scheduling)
  - `fast_scan` / `ping_sweep` → "Discovery completa subnet" (solo manuale/notturno)
  - `arp_poll` → "ARP poll switch (SNMP)"
  - ecc.
- Badge giallo "Carico CPU alto, valuta `known_host_check`" su
  `fast_scan` / `ping_sweep` con interval ≤60 min su network > /22
- Pulsante "Run now" per ogni job (API `/api/scheduled-jobs/<id>/run`)

### 3.4 Pagina Network → pulsante "Discovery completa" on-demand

Su [src/app/(dashboard)/networks/[id]/page.tsx](../src/app/(dashboard)/networks/)
(o equivalente): verificare/aggiungere pulsante "Discovery completa" → POST
`/api/networks/[id]/discover` (tipo `network_discovery` / `fast`).
Conferma modale: "Scansiona TUTTI gli IP del subnet, può richiedere tempo".

### 3.5 Test

- Unit: `getKnownHosts(networkId)` filtra solo `registered`
- Integration: migrazione idempotente non duplica al secondo boot
- Edge: `runKnownHostCheck` con 0 host noti → no errori

### 3.6 CHANGELOG + version bump

Regola anti-regressione (vedi `CLAUDE.md` regola 1):

```bash
npm run lint && npx tsc --noEmit && npm run build
npm run version:release
git push
```

CHANGELOG:

> `feat(scheduler)`: `known_host_check` default per nuovi tenant + migrazione
> automatica disabilita `fast_scan` auto-schedulato (incident 2026-05-25 DTS-INVENT).

### 3.7 Documentazione

Aggiungere in `docs/playbooks/`:

- Tabella `job_type` con scope + raccomandazione (auto vs manual)
- Sezione "Come scoprire nuovi host": 2 path = `arp_poll` (passivo via switch SNMP)
  o discovery manuale dalla pagina network.

---

## 4. Hardening aggiuntivo (sezioni nate dall'analisi post-mortem)

### 4.1 Auto-cap interval in base alla dimensione network

Quando si crea/abilita un `known_host_check`, calcolare l'interval minimo
sicuro in base al **numero di host registrati** (NON al CIDR: conta "quanti
devo pingare", non "quanti potrei pingare"):

```ts
function computeMinInterval(hostCount: number): number {
  // pingHost sequenziale, ~3s/host worst case
  const estimatedSeconds = hostCount * 3;
  const safetyFactor = 2;
  const minIntervalMin = Math.ceil((estimatedSeconds * safetyFactor) / 60);
  return Math.max(15, Math.min(minIntervalMin, 1440)); // 15 min ÷ 24 h
}
```

Casi reali dal tenant DTS (2026-05-25):

| Host registrati | Interval minimo |
|----------------:|:----------------|
| 422             | 60 min          |
| 147             | 30 min          |
| <100            | 15 min OK       |

### 4.2 Spalmare automaticamente i tick di network multiple

Con N `known_host_check` job, il `next_run` iniziale deve essere distanziato
di almeno `60/N` minuti (= 3 min se 5 network), non tutti al minuto 0 —
altrimenti burst contemporaneo. Logica nel seed/init:

```ts
datetime('now', `+${idx * Math.floor(60 / N)} minutes`)
```

### 4.3 (Opzionale) Concurrency limit in `runKnownHostCheck`

Attualmente `for of` con `await pingHost` = sequenziale puro. Per host
veloci (1 ms) 422 host = 422 ms; per host in timeout (3 s) = 21 min.
Ibridare con `Promise.allSettled` + `p-limit`:

```ts
import pLimit from 'p-limit';
const limit = pLimit(10); // max 10 ping in parallelo
await Promise.allSettled(hosts.map(h => limit(() => pingHost(h.ip))));
```

---

## 5. File rilevanti

- [src/lib/cron/jobs.ts](../src/lib/cron/jobs.ts) — handler (già OK)
- [src/lib/db-tenant-schema.ts](../src/lib/db-tenant-schema.ts) — schema `scheduled_jobs` (NON toccare)
- [src/lib/db-tenant.ts](../src/lib/db-tenant.ts) — `createNetwork`, `getKnownHosts`, `getNetworks`
- [server.ts](../server.ts) — boot scheduler
- [src/app/(dashboard)/settings/page.tsx](../src/app/(dashboard)/settings/page.tsx) — UI jobs
- `src/app/api/scheduled-jobs/...` — route CRUD

---

## 6. Memoria da aggiornare a fine task

`~/.claude/projects/-Users-riccardo-Progetti-DA-IPAM/memory/feedback_scheduled_jobs_default.md`:

> Default `scheduled_jobs` = `known_host_check` (no `fast_scan` auto).
> Discovery completa solo on-demand dalla UI. Auto-cap interval in base a
> N host registrati; spalmatura `next_run` tra network multiple.
