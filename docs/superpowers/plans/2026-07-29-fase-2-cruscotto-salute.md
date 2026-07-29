# Fase 2 — Cruscotto salute Wazuh e repliche in DA-IPAM

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mostrare in testa alla pagina Alert sicurezza lo stato di salute di Wazuh (demoni del manager, cluster e spazio dell'indexer, ritardo di ingestione) e delle repliche verso lo storage immutabile, e notificare quando qualcosa si degrada.

**Architecture:** Un modulo `wazuh-health.ts` interroga in parallelo quattro sorgenti — client manager e indexer già esistenti, più il nuovo endpoint di stato del programma di replica — e produce quattro blocchi con verdetto `ok | degraded | fail`. Il risultato è cacheato 60 secondi come già fa `src/lib/modules/health.ts`, esposto da una route e reso da una fascia di riquadri nella pagina esistente. La valutazione delle soglie e la notifica avvengono dentro il job `wazuh_alerts_sync` già schedulato.

**Tech Stack:** TypeScript strict, Next.js 16, `node:https` raw (come gli altri client di integrazione), better-sqlite3, Zod v4.

## Global Constraints

- **Repository**: `/Users/riccardo/Progetti/Domarc/DA-IPAM`, branch di lavoro `dev`. Mai push su `main`.
- **Prerequisito**: la Fase 0+1 deve essere installata su almeno una macchina Wazuh; servono URL, token e impronta SPKI del certificato annotati al suo Task 7.
- TS strict, **no `any`**; testi UI ed errori **in italiano**; Zod v4 usa `.issues`, non `.errors`.
- Funzioni DB nuove in `src/lib/db-tenant.ts` **e** `src/lib/db.ts` (regola 12 del CLAUDE.md); schema in `db-tenant-schema.ts` + ALTER idempotente in `getTenantDb()`.
- Route API: `requireAuth()` per le GET, `requireAdmin()` per le POST, sempre con `isAuthError()` (pattern di `src/app/api/networks/[id]/excluded-ips/route.ts`), dentro `withTenantFromSession()`.
- Componenti client: shadcn v4 (`render={<Button/>}`, **mai** `asChild`); ogni `setInterval` con cleanup via ref.
- Credenziali cifrate con `encrypt()`, lette con `safeDecrypt()` da `src/lib/crypto.ts`. Il token dell'endpoint non deve mai comparire in una risposta API né in un log.
- **Nessun probe deve poter abbattere la pagina**: `Promise.allSettled` e timeout per singolo probe, come `src/lib/modules/health.ts:403-433`.
- Gate per task: `npm run lint && npx tsc --noEmit && npm test`. I gate completi girano in un **worktree isolato** (altre sessioni lavorano sullo stesso checkout).

## File Structure

| File | Ruolo |
|---|---|
| `src/lib/integrations/immutable-store-api.ts` (nuovo) | Client HTTPS verso l'endpoint di stato, con pinning e token |
| `src/lib/integrations/wazuh-health.ts` (nuovo) | Composizione dei quattro blocchi, cache, verdetti |
| `src/lib/integrations/wazuh-health-thresholds.ts` (nuovo) | Soglie e classificazione — funzioni pure, è qui che vivono i test |
| `src/lib/integrations/wazuh-api.ts` (mod) | Due metodi nuovi: stato dei demoni e statistiche di analisi |
| `src/lib/integrations/wazuh-indexer-api.ts` (mod) | Allocazione disco per nodo |
| `src/lib/integrations/wazuh-config.ts` (mod) | Tre chiavi nuove per l'endpoint di stato |
| `src/app/api/integrations/wazuh/health/route.ts` (nuovo) | GET (cache) e POST (forza il probe) |
| `src/components/integrations/wazuh-health-band.tsx` (nuovo) | La fascia di quattro riquadri |
| `src/lib/integrations/wazuh-health-notify.ts` (nuovo) | Anti-rumore e invio notifiche |

---

### Task 1: Client verso l'endpoint di stato

**Files:**
- Create: `src/lib/integrations/immutable-store-api.ts`
- Modify: `src/lib/integrations/wazuh-config.ts`
- Test: `src/lib/integrations/__tests__/immutable-store-api.test.ts`

**Interfaces:**
- Produces:
```ts
export interface ImmutableStoreState {
  schema_version: number; generated_at: string; host: string;
  backend: { type?: string; reachable?: boolean; message?: string; destination?: string | null;
             disk?: { size?: string; used?: string; available?: string; use_percent?: string } };
  local_disk: { size_gb?: number; used_gb?: number; available_gb?: number; use_percent?: number };
  runs: {
    archive: { last_started_at?: string; last_finished_at?: string; outcome: string;
               archives_created?: number; uploaded?: number; failed?: number;
               bytes_uploaded?: number; error?: string | null };
    retention: { last_finished_at?: string; outcome: string; local_files_deleted?: number;
                 space_freed_mb?: number; errors_count?: number; error?: string | null };
    verify: { last_finished_at?: string; outcome: string; manifest_chain_valid?: boolean;
              archives_checked?: number; archives_valid?: number; errors?: string[] };
  };
  archives: { total?: number; total_size_gb?: number; with_signature?: number;
              with_checksum?: number; oldest?: string | null; newest?: string | null };
  retention_policy: { remote_days?: number; mode?: string; lock_until?: string | null };
  schedule: { archive_interval?: string; next_archive_at?: string | null };
}
export class ImmutableStoreError extends Error { constructor(public status: number, message: string) }
export interface ImmutableStoreConfig { url: string; token: string; certPin?: string | null }
export async function fetchImmutableStoreState(cfg: ImmutableStoreConfig, timeoutMs?: number): Promise<ImmutableStoreState>
export function parseImmutableStoreState(raw: unknown): ImmutableStoreState  // PURA, normalizza e riempie i buchi
export function getImmutableStoreConfig(): ImmutableStoreConfig | null       // da settings hub, null se non configurato
```

- [ ] **Step 1: Scrivere il test della funzione pura di parsing**

Crea `src/lib/integrations/__tests__/immutable-store-api.test.ts`:

```ts
import { describe, it } from "node:test";
import assert from "node:assert";
import { parseImmutableStoreState } from "../immutable-store-api";

const COMPLETO = {
  schema_version: 1, generated_at: "2026-07-29T10:22:57Z", host: "srv-wazuh",
  backend: { type: "qnap-nfs", reachable: true, message: "ok", destination: "/mnt/qnap-wazuh",
             disk: { size: "3.7T", used: "1.2T", available: "2.5T", use_percent: "33%" } },
  local_disk: { size_gb: 292, used_gb: 160, available_gb: 121, use_percent: 57 },
  runs: {
    archive: { last_finished_at: "2026-07-29T09:11:43Z", outcome: "success", uploaded: 3, failed: 0 },
    retention: { last_finished_at: "2026-07-29T03:00:31Z", outcome: "success" },
    verify: { last_finished_at: "2026-07-26T06:23:40Z", outcome: "success", manifest_chain_valid: true },
  },
  archives: { total: 512, total_size_gb: 41.7, newest: "2026-07-29T09:11:43Z" },
  retention_policy: { remote_days: 2555 },
  schedule: { archive_interval: "hourly" },
};

describe("parseImmutableStoreState", () => {
  it("accetta uno stato completo", () => {
    const s = parseImmutableStoreState(COMPLETO);
    assert.equal(s.host, "srv-wazuh");
    assert.equal(s.runs.archive.outcome, "success");
    assert.equal(s.archives.total, 512);
  });

  it("riempie le sezioni mancanti invece di lanciare", () => {
    const s = parseImmutableStoreState({ schema_version: 1, host: "x" });
    assert.equal(s.runs.archive.outcome, "never");
    assert.deepEqual(s.archives, {});
  });

  it("non lancia su input non oggetto", () => {
    const s = parseImmutableStoreState("non un oggetto");
    assert.equal(s.runs.verify.outcome, "never");
  });

  it("conserva l'esito fallito", () => {
    const s = parseImmutableStoreState({ ...COMPLETO,
      runs: { ...COMPLETO.runs, archive: { outcome: "failed", failed: 3, error: "NAS irraggiungibile" } } });
    assert.equal(s.runs.archive.outcome, "failed");
    assert.equal(s.runs.archive.error, "NAS irraggiungibile");
  });
});
```

- [ ] **Step 2: Eseguire il test e vederlo fallire**

Run: `node --import tsx --test src/lib/integrations/__tests__/immutable-store-api.test.ts`
Expected: FAIL — modulo inesistente.

- [ ] **Step 3: Implementare il client**

Modella la richiesta HTTPS su `src/lib/vuln/scanner-edge-client.ts` (stesso progetto): `node:https` raw, `rejectUnauthorized: false` con verifica dell'impronta SPKI tramite `probePinTls` esportata da lì (riusala, non riscriverla), timeout via `req.setTimeout`, errore con campo `status` (0 = errore di rete). Punti obbligati:

- `fetchImmutableStoreState` chiama `GET {url}/status` con `Authorization: Bearer <token>`, timeout predefinito **8000 ms**, corpo massimo **256 KB** (interrompi e lancia oltre quella soglia).
- Se `certPin` è valorizzato, verifica il pin **prima** di inviare il token: un endpoint sostituito non deve ricevere il segreto.
- Su `401` lancia `ImmutableStoreError(401, "token non accettato dall'endpoint di stato")`; su errore di rete `ImmutableStoreError(0, ...)`.
- `parseImmutableStoreState` è pura, non lancia mai: normalizza e usa `{ outcome: "never" }` per le sezioni assenti.

In `wazuh-config.ts` aggiungi le tre chiavi seguendo esattamente lo stile delle esistenti (`integration_wazuh_*`): `integration_immutable_store_url`, `integration_immutable_store_token_encrypted` (scritta con `encrypt()`, letta con `safeDecrypt()`), `integration_immutable_store_cert_pin`. `getImmutableStoreConfig()` ritorna `null` se URL o token mancano. Estendi anche la funzione "public" esistente esponendo `immutableStoreTokenSet: boolean` e **mai** il token.

- [ ] **Step 4: Eseguire il test e vederlo passare**

Run: `node --import tsx --test src/lib/integrations/__tests__/immutable-store-api.test.ts`
Expected: PASS (4 test)

- [ ] **Step 5: Commit**

```bash
git add src/lib/integrations/immutable-store-api.ts src/lib/integrations/wazuh-config.ts src/lib/integrations/__tests__/immutable-store-api.test.ts
git commit -m "feat(wazuh): client per l'endpoint di stato delle repliche

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Le soglie, come funzioni pure

**Files:**
- Create: `src/lib/integrations/wazuh-health-thresholds.ts`
- Test: `src/lib/integrations/__tests__/wazuh-health-thresholds.test.ts`

**Interfaces:**
- Produces:
```ts
export type HealthVerdict = "ok" | "degraded" | "fail";
export interface BlockHealth { key: "manager" | "indexer" | "ingestion" | "replication";
  verdict: HealthVerdict; headline: string; detail?: string[]; configured: boolean }
export function classifyDiskUsage(usePercent: number | null | undefined): HealthVerdict;
export function classifyManager(daemons: Array<{ name: string; status: string }>): BlockHealth;
export function classifyIndexer(cluster: { status?: string }, nodes: Array<{ node: string; diskPercent: number | null }>): BlockHealth;
export function classifyIngestion(input: { eventsDropped?: number; queueUsage?: number; newestAlertIso?: string | null; nowMs: number }): BlockHealth;
export function classifyReplication(state: ImmutableStoreState | null, nowMs: number): BlockHealth;
export const DISK_WARN_PERCENT = 85;
export const DISK_FAIL_PERCENT = 95;
export const INGESTION_LAG_WARN_MINUTES = 30;
export const REPLICATION_MIN_HOURS = 3;
```

- [ ] **Step 1: Scrivere i test — una riga per ogni soglia della spec §7**

Crea `src/lib/integrations/__tests__/wazuh-health-thresholds.test.ts`:

```ts
import { describe, it } from "node:test";
import assert from "node:assert";
import {
  classifyDiskUsage, classifyManager, classifyIndexer, classifyIngestion, classifyReplication,
} from "../wazuh-health-thresholds";

const ORA = Date.parse("2026-07-29T12:00:00Z");

describe("disco", () => {
  it("sotto l'85% è ok", () => assert.equal(classifyDiskUsage(84), "ok"));
  it("all'85% è degradato", () => assert.equal(classifyDiskUsage(85), "degraded"));
  it("al 95% è errore", () => assert.equal(classifyDiskUsage(95), "fail"));
  it("valore assente è ok", () => assert.equal(classifyDiskUsage(null), "ok"));
});

describe("manager", () => {
  it("tutti i demoni attivi", () => {
    const b = classifyManager([{ name: "wazuh-analysisd", status: "running" },
                               { name: "wazuh-modulesd", status: "running" }]);
    assert.equal(b.verdict, "ok");
  });
  it("un demone fermo è errore e viene nominato", () => {
    const b = classifyManager([{ name: "wazuh-analysisd", status: "stopped" },
                               { name: "wazuh-modulesd", status: "running" }]);
    assert.equal(b.verdict, "fail");
    assert.ok(b.headline.includes("wazuh-analysisd"));
  });
});

describe("indexer", () => {
  it("cluster verde e disco basso", () => {
    const b = classifyIndexer({ status: "green" }, [{ node: "n1", diskPercent: 60 }]);
    assert.equal(b.verdict, "ok");
  });
  it("cluster giallo è degradato", () => {
    assert.equal(classifyIndexer({ status: "yellow" }, []).verdict, "degraded");
  });
  it("cluster rosso è errore", () => {
    assert.equal(classifyIndexer({ status: "red" }, []).verdict, "fail");
  });
  it("un nodo oltre il 95% è errore anche con cluster verde", () => {
    const b = classifyIndexer({ status: "green" }, [{ node: "n1", diskPercent: 96 }]);
    assert.equal(b.verdict, "fail");
  });
});

describe("ingestione", () => {
  it("alert recente è ok", () => {
    const b = classifyIngestion({ newestAlertIso: "2026-07-29T11:50:00Z", nowMs: ORA });
    assert.equal(b.verdict, "ok");
  });
  it("alert più vecchio di 30 minuti è degradato", () => {
    const b = classifyIngestion({ newestAlertIso: "2026-07-29T11:20:00Z", nowMs: ORA });
    assert.equal(b.verdict, "degraded");
  });
  it("eventi scartati sono degradato", () => {
    const b = classifyIngestion({ eventsDropped: 42, newestAlertIso: "2026-07-29T11:59:00Z", nowMs: ORA });
    assert.equal(b.verdict, "degraded");
  });
});

describe("repliche", () => {
  const base = {
    schema_version: 1, generated_at: "2026-07-29T11:55:00Z", host: "srv",
    backend: { reachable: true, disk: { use_percent: "33%" } },
    local_disk: { use_percent: 57 },
    runs: { archive: { outcome: "success", failed: 0 }, retention: { outcome: "success" },
            verify: { outcome: "success", manifest_chain_valid: true } },
    archives: { newest: "2026-07-29T11:11:00Z" },
    retention_policy: {}, schedule: { archive_interval: "hourly" },
  } as never;

  it("replica recente e pulita è ok", () => {
    assert.equal(classifyReplication(base, ORA).verdict, "ok");
  });
  it("nessuna replica da oltre il doppio dell'intervallo è errore", () => {
    const s = { ...(base as object), archives: { newest: "2026-07-29T02:00:00Z" } } as never;
    assert.equal(classifyReplication(s, ORA).verdict, "fail");
  });
  it("upload falliti sono errore", () => {
    const s = { ...(base as object),
      runs: { ...(base as { runs: object }).runs, archive: { outcome: "partial", failed: 2 } } } as never;
    assert.equal(classifyReplication(s, ORA).verdict, "fail");
  });
  it("catena di integrità non valida è errore", () => {
    const s = { ...(base as object),
      runs: { ...(base as { runs: object }).runs, verify: { outcome: "failed", manifest_chain_valid: false } } } as never;
    assert.equal(classifyReplication(s, ORA).verdict, "fail");
  });
  it("disco della destinazione oltre l'85% è degradato", () => {
    const s = { ...(base as object), backend: { reachable: true, disk: { use_percent: "88%" } } } as never;
    assert.equal(classifyReplication(s, ORA).verdict, "degraded");
  });
  it("endpoint non configurato non è un errore", () => {
    const b = classifyReplication(null, ORA);
    assert.equal(b.configured, false);
    assert.equal(b.verdict, "ok");
  });
});
```

- [ ] **Step 2: Eseguire i test e vederli fallire**

Run: `node --import tsx --test src/lib/integrations/__tests__/wazuh-health-thresholds.test.ts`
Expected: FAIL — modulo inesistente.

- [ ] **Step 3: Implementare le soglie**

Regole, tutte e sole quelle della spec §7. Note di attuazione:
- `use_percent` del backend arriva come stringa `"33%"` (viene da `df -h`): normalizza con un parser che tollera `"33%"`, `"33"`, `33` e `null`.
- L'intervallo pianificato arriva da `schedule.archive_interval` (`"hourly"` → 60 minuti, `"daily"` → 1440; sconosciuto → 60). La soglia è `max(2 × intervallo, REPLICATION_MIN_HOURS)`.
- `classifyReplication(null, …)` ritorna `configured: false`, verdetto `ok` e `headline` che invita a configurare: un endpoint non impostato non è un guasto.
- `headline` è una frase breve in italiano, quella che finisce nel riquadro: `"ultima replica riuscita 1 ora fa"`, `"nessuna replica riuscita da 9 ore"`, `"analysisd fermo"`, `"cluster verde · 62% su 3 nodi"`.

- [ ] **Step 4: Eseguire i test e vederli passare**

Run: `node --import tsx --test src/lib/integrations/__tests__/wazuh-health-thresholds.test.ts`
Expected: PASS (20 test)

- [ ] **Step 5: Commit**

```bash
git add src/lib/integrations/wazuh-health-thresholds.ts src/lib/integrations/__tests__/wazuh-health-thresholds.test.ts
git commit -m "feat(wazuh): soglie di salute come funzioni pure

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Raccolta dei quattro blocchi e route API

**Files:**
- Create: `src/lib/integrations/wazuh-health.ts`
- Modify: `src/lib/integrations/wazuh-api.ts`, `src/lib/integrations/wazuh-indexer-api.ts`
- Create: `src/app/api/integrations/wazuh/health/route.ts`

**Interfaces:**
- Consumes: `fetchImmutableStoreState`, `getImmutableStoreConfig` (Task 1); tutte le `classify*` (Task 2).
- Produces:
```ts
// wazuh-api.ts
getManagerStatus(): Promise<Array<{ name: string; status: string }>>   // GET /manager/status
getAnalysisdStats(): Promise<{ eventsDropped: number; queueUsage: number } | null>  // GET /manager/stats/analysisd
// wazuh-indexer-api.ts
getNodesDiskUsage(): Promise<Array<{ node: string; diskPercent: number | null }>>   // GET _cat/allocation?format=json
// wazuh-health.ts
export interface WazuhHealth { blocks: BlockHealth[]; probedAt: string }
export async function getWazuhHealth(tenantCode: string, opts?: { force?: boolean }): Promise<WazuhHealth>
export function invalidateWazuhHealth(tenantCode: string): void
```

- [ ] **Step 1: Aggiungere i metodi ai due client**

In `wazuh-api.ts`, accanto ai metodi esistenti, usando lo stesso helper di richiesta interno e la stessa gestione del 404 (`→ []`/`null`):

```ts
  /** Stato dei demoni del manager. Un demone fermo è la causa più comune di "Wazuh non registra più". */
  async getManagerStatus(): Promise<Array<{ name: string; status: string }>> {
    const data = await this.get<{ data?: { affected_items?: Array<Record<string, string>> } }>("/manager/status");
    const items = data?.data?.affected_items ?? [];
    // La risposta è un oggetto { "wazuh-analysisd": "running", ... } dentro affected_items[0]
    const primo = items[0] ?? {};
    return Object.entries(primo).map(([name, status]) => ({ name, status: String(status) }));
  }
```

Verifica la forma reale con una chiamata di prova (Step 4) e adegua il parsing se differisce; la struttura `data.affected_items` è quella comune a tutta l'API Wazuh.

Analogamente `getAnalysisdStats()` su `/manager/stats/analysisd`, estraendo gli eventi scartati e il riempimento massimo delle code; ritorna `null` su 404 (versioni che non espongono l'endpoint).

In `wazuh-indexer-api.ts`, `getNodesDiskUsage()` su `GET /_cat/allocation?format=json`, mappando `{ node, "disk.percent" }` in `{ node, diskPercent }` (numero o `null` per nodi non assegnati).

- [ ] **Step 2: Implementare `wazuh-health.ts`**

Struttura obbligata, modellata su `src/lib/modules/health.ts`:
- cache `Map<string, { at: number; value: WazuhHealth }>` con `TTL_MS = 60_000`, chiave il `tenantCode`; `invalidateWazuhHealth` la svuota.
- `PROBE_TIMEOUT_MS = 8_000`, ogni probe avvolto in un timeout.
- I quattro probe girano con `Promise.allSettled`: un probe che lancia produce il blocco corrispondente con verdetto `fail` e messaggio dell'errore, **senza** influenzare gli altri.
- Il blocco `ingestion` prende l'alert più recente da `wazuh_alert_event` (colonna `last_seen_at`, tabella già esistente) invece di interrogare l'indexer: è più economico e riflette ciò che DA-IPAM ha davvero ricevuto.
- Nessun segreto nei messaggi d'errore.

- [ ] **Step 3: La route**

`src/app/api/integrations/wazuh/health/route.ts`, sul modello di `src/app/api/modules/health/route.ts`:

```ts
export async function GET() {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  return withTenantFromSession(async () => {
    const code = getCurrentTenantCode();
    if (!code) return Response.json({ error: "contesto tenant assente" }, { status: 500 });
    const health = await getWazuhHealth(code);
    return Response.json(health);
  });
}

export async function POST() {
  const auth = await requireAdmin();
  if (isAuthError(auth)) return auth;
  return withTenantFromSession(async () => {
    const code = getCurrentTenantCode();
    if (!code) return Response.json({ error: "contesto tenant assente" }, { status: 500 });
    const health = await getWazuhHealth(code, { force: true });
    return Response.json(health);
  });
}
```

- [ ] **Step 4: Verifica contro il Wazuh reale**

Con l'appliance di sviluppo (`192.168.4.8`, Wazuh `192.168.4.19`), da un contesto autenticato o via script `tsx`, verifica che `getManagerStatus()` e `getNodesDiskUsage()` restituiscano dati sensati e adegua il parsing se la forma reale differisce. Annota nel report l'output osservato: è l'unico modo di sapere se il parsing regge.

- [ ] **Step 5: Verifica e commit**

Run: `npm run lint && npx tsc --noEmit && npm test`

```bash
git add src/lib/integrations/wazuh-health.ts src/lib/integrations/wazuh-api.ts src/lib/integrations/wazuh-indexer-api.ts "src/app/api/integrations/wazuh/health/route.ts"
git commit -m "feat(wazuh): raccolta salute manager, indexer, ingestione e repliche

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: La fascia di stato nella pagina

**Files:**
- Create: `src/components/integrations/wazuh-health-band.tsx`
- Modify: `src/app/(dashboard)/security-alerts/security-alerts-client.tsx`

**Interfaces:**
- Consumes: `GET /api/integrations/wazuh/health` (Task 3), tipo `BlockHealth` (Task 2).
- Produces: `<WazuhHealthBand refreshKey={number} />`

- [ ] **Step 1: Il componente**

Quattro riquadri in una riga che va a capo sugli schermi stretti. Per ciascuno: pallino colorato (verde/ambra/rosso, con le stesse classi usate da `src/app/(dashboard)/launchpad/modules-grid.tsx`), etichetta del blocco, `headline` in grande, e al clic l'espansione con l'elenco `detail`. Il blocco non configurato mostra un invito con collegamento alle impostazioni, non un errore.

Nessun `setInterval` proprio: il componente riceve `refreshKey` e rifà la fetch quando cambia. `AbortController` con cleanup nell'`useEffect`.

- [ ] **Step 2: Innestarlo nella pagina**

In `security-alerts-client.tsx`, montare `<WazuhHealthBand refreshKey={refreshTick} />` sopra i grafici esistenti, dove `refreshTick` è un contatore già incrementato dal ciclo di aggiornamento a 60 secondi presente nel file (se non esiste, aggiungerlo accanto alla fetch esistente, **senza** introdurre un secondo intervallo).

- [ ] **Step 3: Verifica**

Run: `npm run lint && npx tsc --noEmit && npm run build`
Verifica visiva sull'appliance di sviluppo dopo il deploy del Task 6.

- [ ] **Step 4: Commit**

```bash
git add src/components/integrations/wazuh-health-band.tsx "src/app/(dashboard)/security-alerts/security-alerts-client.tsx"
git commit -m "feat(ui): fascia di stato Wazuh e repliche in testa agli alert

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Notifiche con anti-rumore

**Files:**
- Create: `src/lib/integrations/wazuh-health-notify.ts`
- Modify: `src/lib/db-tenant-schema.ts`, `src/lib/db-tenant.ts`, `src/lib/db.ts`, `src/lib/integrations/wazuh-alerts-sync.ts`
- Test: `src/lib/integrations/__tests__/wazuh-health-notify.test.ts`

**Interfaces:**
- Consumes: `BlockHealth` (Task 2), `getWazuhHealth` (Task 3).
- Produces:
```ts
export interface NotifyDecision { notify: boolean; reason: "transizione" | "ripetizione" | "rientro" | "nessuna" }
export function decideNotification(precedente: { verdict: string; lastNotifiedAtMs: number | null } | null,
                                   attuale: HealthVerdict, nowMs: number): NotifyDecision;  // PURA
export async function evaluateAndNotifyWazuhHealth(tenantCode: string): Promise<{ notified: number }>;
export const REPEAT_AFTER_HOURS = 6;
```

Tabella nuova (ALTER idempotente nel pattern di `getTenantDb()`):

```sql
CREATE TABLE IF NOT EXISTS wazuh_health_state (
  block TEXT PRIMARY KEY,
  verdict TEXT NOT NULL,
  headline TEXT,
  last_changed_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_notified_at TEXT
);
```

- [ ] **Step 1: Scrivere i test della decisione**

Crea `src/lib/integrations/__tests__/wazuh-health-notify.test.ts`:

```ts
import { describe, it } from "node:test";
import assert from "node:assert";
import { decideNotification } from "../wazuh-health-notify";

const ORA = Date.parse("2026-07-29T12:00:00Z");
const ORE = (n: number) => n * 3600_000;

describe("decideNotification", () => {
  it("primo rilevamento di un guasto notifica", () => {
    const d = decideNotification(null, "fail", ORA);
    assert.equal(d.notify, true);
    assert.equal(d.reason, "transizione");
  });
  it("primo rilevamento di uno stato ok non notifica", () => {
    assert.equal(decideNotification(null, "ok", ORA).notify, false);
  });
  it("stesso guasto entro 6 ore non ripete", () => {
    const d = decideNotification({ verdict: "fail", lastNotifiedAtMs: ORA - ORE(2) }, "fail", ORA);
    assert.equal(d.notify, false);
  });
  it("stesso guasto dopo 6 ore ripete", () => {
    const d = decideNotification({ verdict: "fail", lastNotifiedAtMs: ORA - ORE(7) }, "fail", ORA);
    assert.equal(d.notify, true);
    assert.equal(d.reason, "ripetizione");
  });
  it("peggioramento da degradato a errore notifica subito", () => {
    const d = decideNotification({ verdict: "degraded", lastNotifiedAtMs: ORA - ORE(1) }, "fail", ORA);
    assert.equal(d.notify, true);
    assert.equal(d.reason, "transizione");
  });
  it("rientro alla normalità notifica la chiusura", () => {
    const d = decideNotification({ verdict: "fail", lastNotifiedAtMs: ORA - ORE(1) }, "ok", ORA);
    assert.equal(d.notify, true);
    assert.equal(d.reason, "rientro");
  });
  it("da ok a ok non notifica", () => {
    assert.equal(decideNotification({ verdict: "ok", lastNotifiedAtMs: null }, "ok", ORA).notify, false);
  });
});
```

- [ ] **Step 2: Eseguire e vedere fallire**

Run: `node --import tsx --test src/lib/integrations/__tests__/wazuh-health-notify.test.ts`
Expected: FAIL — modulo inesistente.

- [ ] **Step 3: Implementare**

`decideNotification` pura secondo le regole testate. `evaluateAndNotifyWazuhHealth` legge lo stato precedente dalla tabella, chiama `getWazuhHealth(tenantCode, { force: true })`, decide per blocco, invia con il notificatore già usato dagli alert (`src/lib/notifications/notifier.ts` — riusa la funzione che usa `wazuh-alerts-sync.ts`, non scriverne una nuova) e aggiorna la riga. Il messaggio contiene blocco, verdetto e `headline`; **mai** URL con token.

Aggancia la chiamata in coda a `syncWazuhAlertsForTenant`, dentro un `try/catch` che logga e prosegue: un problema di salute non deve far fallire la sincronizzazione degli alert.

- [ ] **Step 4: Eseguire i test e vederli passare**

Run: `node --import tsx --test src/lib/integrations/__tests__/wazuh-health-notify.test.ts`
Expected: PASS (7 test)

- [ ] **Step 5: Verifica e commit**

Run: `npm run lint && npx tsc --noEmit && npm test`

```bash
git add src/lib/integrations/wazuh-health-notify.ts src/lib/db-tenant-schema.ts src/lib/db-tenant.ts src/lib/db.ts src/lib/integrations/wazuh-alerts-sync.ts src/lib/integrations/__tests__/wazuh-health-notify.test.ts
git commit -m "feat(wazuh): notifiche di salute al cambio di stato

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Configurazione, rilascio e verifica sul campo

**Files:**
- Modify: `src/components/settings/wazuh-card.tsx`, `src/app/api/integrations/wazuh/config/route.ts`

- [ ] **Step 1: Campi di configurazione**

Nella scheda Wazuh delle impostazioni, aggiungi tre campi: URL dell'endpoint di stato, token (write-only, mai ripopolato in lettura) e impronta del certificato, con un pulsante "Verifica" che chiama `POST /api/integrations/wazuh/health` e mostra l'esito del solo blocco repliche. Estendi lo schema Zod della route di configurazione con i tre campi opzionali.

- [ ] **Step 2: Gate completi in worktree isolato**

```bash
WT=/private/tmp/wt-fase2 && rm -rf "$WT"
git worktree add --detach "$WT" HEAD
cd "$WT" && cp -al /Users/riccardo/Progetti/Domarc/DA-IPAM/node_modules node_modules
npx tsc --noEmit && npm test && npm run build
cd - && git worktree remove --force "$WT"
```

- [ ] **Step 3: Rilascio e deploy sull'appliance di sviluppo**

```bash
cd /Users/riccardo/Progetti/Domarc/DA-IPAM
npm run version:release && git push origin dev
ssh -J root@192.168.40.4 root@192.168.4.8 \
  'cd /opt/da-invent && git pull && npm install && npm run build && systemctl restart da-invent'
```

Verifica che la build non fallisca leggendo l'output per intero e controllando l'esistenza di `.next/BUILD_ID`: un `grep` sul solo "Compiled successfully" nasconde i fallimenti successivi al typecheck.

- [ ] **Step 4: Configurare e osservare**

Configura l'endpoint dell'installazione Domarc (URL `https://192.168.4.19:9443`, token e impronta annotati al Task 7 della Fase 0+1). Apri la pagina Alert sicurezza e verifica che i quattro riquadri mostrino dati coerenti con quanto si osserva a mano sull'host (`systemctl list-timers`, `df -h`, listing della destinazione).

- [ ] **Step 5: La prova che conta**

Ripeti la prova negativa della Fase 0+1 (smontare la destinazione, forzare un ciclo) e verifica che entro un ciclo di aggiornamento il riquadro Repliche diventi rosso e che arrivi la notifica. Rimonta subito dopo. Annota l'esito: è la dimostrazione che il difetto silenzioso è coperto fino all'operatore.

---

## Fuori scope

Storico dei valori e grafici di andamento; stato degli agent (già visibile altrove); azioni correttive dall'interfaccia.
