# Attribution v2 — Fase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introdurre il motore di attribuzione unificato (tassonomia a 2 livelli, tabella `attribution_evidence`, fusione pura `fuse.ts`) alimentato SOLO dai segnali già in DB (OUI, hostname, SNMP, LLDP/CDP, AD, Wazuh, agent GLPI), in **parallel-run additivo**: scrive le nuove colonne `hosts.attr_*` senza toccare il sistema legacy (`classification`, `inferred_*`), che resta invariato fino alla Fase 4.

**Architecture:** Nuovo modulo `src/lib/attribution/` accanto a `src/lib/classification/` (che NON viene modificato). Le evidenze sono righe append-only in `attribution_evidence` (tenant DB); gli *emettitori* le producono dai dati già persistiti; `fuse.ts` è una funzione pura `evidenze → 3 dimensioni (vendor, category, os)`; `recompute.ts` orchestra emettitori→fusione→persist e viene agganciato ai flussi esistenti (fine scan, sync AD/Wazuh, enrich agent, poll ARP/DHCP) senza rimuovere i writer legacy. Spec di riferimento: `docs/superpowers/specs/2026-07-26-attribution-v2-design.md` §3, §4.1-4.3, §5, §9 riga Fase 1.

**Tech Stack:** Next.js 16 / TS strict, better-sqlite3 (WAL), test runner nativo `node --import tsx --test` (node:test + node:assert), Zod v4 per gli input API.

## Global Constraints

- **Node 20.x/22.x LTS** (`engines: node >=20 <25`); Node ≥25 rompe better-sqlite3.
- **Nessun framework di migrazioni**: schema in `src/lib/db-tenant-schema.ts` + ALTER idempotenti dentro `getTenantDb()` in `src/lib/db-tenant.ts` (pattern B "lista dichiarativa", vedi `db-tenant.ts:811-831`).
- **Ogni funzione DB nuova va in `db-tenant.ts` E in `db.ts`** (facade con `getDb()`), regola 12 CLAUDE.md.
- **Ogni tabella tenant nuova va registrata** in `src/lib/transfer/table-registry.ts` (altrimenti export/import la salta e i test transfer falliscono).
- **API**: `requireAuth()` per GET sensibili, `requireAdmin()` per POST; route tenant-scoped dentro `withTenantFromSession()`; body validato con Zod v4 (`.issues`, non `.errors`); errori `{ error: "messaggio in italiano" }`.
- **TS strict, no `any`**; testo UI/errori in italiano; niente `console.log` committato.
- **NON toccare** `src/lib/classification/*`, `src/lib/devices/auto-classify.ts`, né i writer legacy di `classification`/`inferred_*`: la Fase 1 è additiva (il ritiro è Fase 4). Gli hook AGGIUNGONO emissione evidenze, non sostituiscono nulla.
- Test: file `*.test.ts` in `__tests__/` accanto al codice, runner `npm test` (`node --import tsx --test "src/**/*.test.ts"`). Singolo file: `node --import tsx --test src/lib/attribution/__tests__/<file>.test.ts`.
- Verifica finale obbligatoria: `npm run lint && npx tsc --noEmit && npm run build`, poi `npm run version:release` + `git push origin dev` (MAI `main`). Versione attuale: 0.3.203.
- Branch di lavoro: `dev`.

## Decisioni vincolanti (dalla spec, da NON reinterpretare)

1. **Tre dimensioni indipendenti**: `vendor`, `category` (2 livelli `famiglia.tipo`), `os` (famiglia + stringa libera). §4.1.
2. **`manual` vince sempre**: evidenza `source='manual'`, confidence 1.0, mai sovrascritta da emettitori. §4.2.
3. **Fusione deterministica sull'insieme completo** delle evidenze non scadute, non incrementale. §3.
4. **Gerarchia**: un voto per `network.access_point` conta anche per `network`; vince il claim più profondo sopra soglia; conflitto tra pari livello entro la finestra → si ripiega al padre comune registrando il conflitto. §4.3.
5. **`min_phase`**: fase più avanzata (in ordine pipeline) tra le evidenze citate dal claim vincente — è la fase necessaria a riprodurre l'attribuzione, usata dalla UI per "cosa manca". §3/§4.3.
6. **Caso Ubiquiti**: modello dal `sysDescr` (`U6-Pro`, `U7-Pro`, `UAP…` → AP; `USW…`/`US-…` → switch; `USG`/`UXG`/`UDM`/`EdgeRouter` → router) — è il deliverable esplicito della nota di Fase 0 ("si risolve in Fase 1").
7. **Capability bits LLDP**: NON sono oggi in `device_neighbors` (nessuna colonna capability, verificato). La Fase 1 emette evidenza LLDP/CDP **non autoritativa** (confidence 0.7) dal testo `remote_platform`; l'autorità da capability bits arriverà quando i collector le raccoglieranno (fase successiva). Documentato come limite noto.
8. **`host_classification_history`**: il CHECK su `trigger` (`'scan','apply','manual','backfill'`) non è alterabile in SQLite senza rebuild → si RIUSANO quei valori (recompute bulk→`apply`, hook post-scan/sync→`scan`, override→`manual`) e si aggiungono 3 colonne nullable `attr_vendor`, `attr_category`, `attr_os` via ALTER idempotente.
9. **`attribution_evidence.source` senza CHECK SQL** (i CHECK non si estendono in SQLite; le fasi 2-5 aggiungeranno sorgenti): il vocabolario è chiuso a livello TypeScript (union `AttributionSource`).
10. **Append-only pragmatico**: ri-emissione identica (stesso host, source, dimension, claim, raw_value) aggiorna solo `observed_at`/`confidence`; claim diverso dalla stessa (source, dimension) inserisce la nuova riga e marca le vecchie con `superseded_by`. Evita la crescita illimitata mantenendo la catena tracciabile.

## File Structure

| File | Ruolo |
|---|---|
| `src/lib/attribution/taxonomy.ts` (nuovo) | Tassonomia 2 livelli, helper gerarchia, mappa legacy 52-slug → v2 |
| `src/lib/attribution/types.ts` (nuovo) | Union `AttributionSource/Dimension/Phase`, interfacce evidenza/risultato, costanti motore |
| `src/lib/attribution/weights.ts` (nuovo) | Pesi per sorgente + sorgenti autoritative per dimensione |
| `src/lib/attribution/evidence.ts` (nuovo) | `recordEvidence()` / `getActiveEvidence()` (supersede + refresh) |
| `src/lib/attribution/fuse.ts` (nuovo) | Fusione pura 3 dimensioni |
| `src/lib/attribution/emitters.ts` (nuovo) | Emettitori dai segnali già in DB (host row, neighbors, AD, Wazuh) |
| `src/lib/attribution/persist.ts` (nuovo) | Scrittura `hosts.attr_*` + history |
| `src/lib/attribution/recompute.ts` (nuovo) | Orchestratore emit→fuse→persist + variante bulk |
| `src/lib/db-tenant-schema.ts` (mod) | CREATE `attribution_evidence` + indici |
| `src/lib/db-tenant.ts` (mod) | ALTER `hosts.attr_*` + history cols, `getAttributionSignalsForHost()`, hook in `upsertNeighbors` |
| `src/lib/db.ts` (mod) | Facade delle nuove funzioni DB |
| `src/lib/transfer/table-registry.ts` (mod) | Registrazione `attribution_evidence` |
| `src/lib/scanner/discovery.ts` (mod) | Hook recompute post-scan (~riga 2710) |
| `src/lib/ad/ad-client.ts`, `src/lib/integrations/wazuh-sync.ts`, `src/lib/inventory-agent/enrich-host.ts`, `src/lib/cron/jobs.ts` (mod) | Hook emissione evidenze/recompute |
| `src/app/api/hosts/[id]/attribution/route.ts` (nuovo) | GET attribuzione + evidenze + "cosa manca" |
| `src/app/api/hosts/[id]/attribution/override/route.ts` (nuovo) | POST override manuale |
| `src/app/api/attribution/recompute/route.ts` (nuovo) | POST rifusione bulk |
| `scripts/attribution-golden-export.ts` (nuovo) | Snapshot evidenze host reali → fixture golden |
| `src/lib/attribution/__tests__/*.test.ts` (nuovi) | Unit + golden + progressività |

---

### Task 1: Tassonomia a 2 livelli (`taxonomy.ts`)

**Files:**
- Create: `src/lib/attribution/taxonomy.ts`
- Test: `src/lib/attribution/__tests__/taxonomy.test.ts`

**Interfaces:**
- Consumes: `DeviceClassification` (type-only) da `@/lib/device-classifications`.
- Produces: `type CategoryLevel1`, `type CategorySlug` (include i soli livello-1 come claim legittimi), `CATEGORY_TAXONOMY: Record<CategoryLevel1, readonly string[]>`, `isValidCategory(s: string): s is CategorySlug`, `categoryParent(s: CategorySlug): CategoryLevel1`, `categoryDepth(s: CategorySlug): 1 | 2`, `commonAncestor(a: CategorySlug, b: CategorySlug): CategorySlug | null`, `mapLegacyClassification(slug: string): { category: CategorySlug | null; os_family: "windows" | "linux" | null }`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/attribution/__tests__/taxonomy.test.ts
import { describe, it } from "node:test";
import assert from "node:assert";
import {
  isValidCategory, categoryParent, categoryDepth, commonAncestor,
  mapLegacyClassification,
} from "../taxonomy";

describe("taxonomy", () => {
  it("valida slug a 2 livelli e livello 1", () => {
    assert.equal(isValidCategory("network.access_point"), true);
    assert.equal(isValidCategory("network"), true);
    assert.equal(isValidCategory("unknown"), true);
    assert.equal(isValidCategory("wireless"), false);       // slug legacy sysobj
    assert.equal(isValidCategory("network.wifi"), false);
  });
  it("parent e depth", () => {
    assert.equal(categoryParent("network.access_point"), "network");
    assert.equal(categoryParent("network"), "network");
    assert.equal(categoryDepth("network.access_point"), 2);
    assert.equal(categoryDepth("compute"), 1);
  });
  it("commonAncestor", () => {
    assert.equal(commonAncestor("network.access_point", "network.switch"), "network");
    assert.equal(commonAncestor("network.switch", "compute.server"), null);
    assert.equal(commonAncestor("network", "network.switch"), "network");
  });
  it("mappa i 52 slug legacy", () => {
    assert.deepEqual(mapLegacyClassification("access_point"), { category: "network.access_point", os_family: null });
    assert.deepEqual(mapLegacyClassification("server_windows"), { category: "compute.server", os_family: "windows" });
    assert.deepEqual(mapLegacyClassification("server_linux"), { category: "compute.server", os_family: "linux" });
    assert.deepEqual(mapLegacyClassification("stampante"), { category: "peripheral.printer", os_family: null });
    assert.deepEqual(mapLegacyClassification("multifunzione"), { category: "peripheral.mfp", os_family: null });
    assert.deepEqual(mapLegacyClassification("nas_synology"), { category: "storage.nas", os_family: null });
    assert.deepEqual(mapLegacyClassification("telecamera"), { category: "av.camera", os_family: null });
    assert.deepEqual(mapLegacyClassification("bridge"), { category: "network", os_family: null });
    assert.deepEqual(mapLegacyClassification("web_server"), { category: "compute.server", os_family: null });
    assert.deepEqual(mapLegacyClassification("unknown"), { category: null, os_family: null });
    assert.deepEqual(mapLegacyClassification("slug-inesistente"), { category: null, os_family: null });
  });
  it("ogni slug legacy noto ha una mappatura non-null tranne unknown", async () => {
    const { DEVICE_CLASSIFICATIONS } = await import("@/lib/device-classifications");
    for (const slug of DEVICE_CLASSIFICATIONS) {
      if (slug === "unknown") continue;
      const m = mapLegacyClassification(slug);
      assert.notEqual(m.category, null, `slug legacy senza mappatura: ${slug}`);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/lib/attribution/__tests__/taxonomy.test.ts`
Expected: FAIL (`Cannot find module '../taxonomy'`)

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/attribution/taxonomy.ts
// Tassonomia Attribution v2 — spec §4.1. Radici da Fingerbank, foglie da LibreNMS.

export const CATEGORY_TAXONOMY = {
  network: ["router", "switch", "access_point", "firewall", "controller", "modem"],
  compute: ["server", "workstation", "hypervisor", "vm", "laptop"],
  storage: ["nas", "san", "tape"],
  peripheral: ["printer", "scanner", "mfp"],
  av: ["camera", "nvr", "display", "speaker"],
  voip: ["phone", "pbx", "gateway"],
  power: ["ups", "pdu"],
  iot: ["sensor", "thermostat", "plug", "other"],
  mobile: ["phone", "tablet", "wearable"],
} as const;

export type CategoryLevel1 = keyof typeof CATEGORY_TAXONOMY | "unknown";

type Leaf<K extends keyof typeof CATEGORY_TAXONOMY> =
  `${K}.${(typeof CATEGORY_TAXONOMY)[K][number]}`;
export type CategorySlug =
  | CategoryLevel1
  | { [K in keyof typeof CATEGORY_TAXONOMY]: Leaf<K> }[keyof typeof CATEGORY_TAXONOMY];

const ALL_SLUGS: ReadonlySet<string> = new Set([
  "unknown",
  ...Object.keys(CATEGORY_TAXONOMY),
  ...Object.entries(CATEGORY_TAXONOMY).flatMap(([l1, leaves]) =>
    leaves.map((leaf) => `${l1}.${leaf}`)
  ),
]);

export function isValidCategory(s: string): s is CategorySlug {
  return ALL_SLUGS.has(s);
}

export function categoryDepth(s: CategorySlug): 1 | 2 {
  return s.includes(".") ? 2 : 1;
}

export function categoryParent(s: CategorySlug): CategoryLevel1 {
  return (s.includes(".") ? s.split(".")[0] : s) as CategoryLevel1;
}

/** Antenato comune: stesso slug → sé; stesso livello 1 → livello 1; altrimenti null. */
export function commonAncestor(a: CategorySlug, b: CategorySlug): CategorySlug | null {
  if (a === b) return a;
  const pa = categoryParent(a);
  const pb = categoryParent(b);
  return pa === pb ? pa : null;
}

/**
 * Mappa i 52 slug legacy di DeviceClassification (device-classifications.ts) sulla
 * tassonomia v2. `server_windows`/`server_linux` sono due dimensioni in un valore:
 * la parte OS esce come os_family.
 */
const LEGACY_MAP: Record<string, { category: CategorySlug; os_family?: "windows" | "linux" }> = {
  router: { category: "network.router" },
  switch: { category: "network.switch" },
  firewall: { category: "network.firewall" },
  access_point: { category: "network.access_point" },
  modem: { category: "network.modem" },
  ont: { category: "network.modem" },
  bridge: { category: "network" },
  repeater: { category: "network" },
  controller: { category: "network.controller" },
  controller_wifi: { category: "network.controller" },
  network_controller: { category: "network.controller" },
  load_balancer: { category: "network" },
  vpn_gateway: { category: "network.firewall" },
  proxy: { category: "compute.server" },
  server: { category: "compute.server" },
  server_windows: { category: "compute.server", os_family: "windows" },
  server_linux: { category: "compute.server", os_family: "linux" },
  dhcp_server: { category: "compute.server" },
  dns_server: { category: "compute.server" },
  nfs_server: { category: "compute.server" },
  mail_server: { category: "compute.server" },
  web_server: { category: "compute.server" },
  database_server: { category: "compute.server" },
  backup_server: { category: "compute.server" },
  hypervisor: { category: "compute.hypervisor" },
  vm: { category: "compute.vm" },
  workstation: { category: "compute.workstation" },
  notebook: { category: "compute.laptop" },
  stampante: { category: "peripheral.printer" },
  fotocopiatrice: { category: "peripheral.mfp" },
  multifunzione: { category: "peripheral.mfp" },
  scanner: { category: "peripheral.scanner" },
  nas: { category: "storage.nas" },
  nas_synology: { category: "storage.nas" },
  nas_qnap: { category: "storage.nas" },
  storage: { category: "storage" },
  telecamera: { category: "av.camera" },
  smart_tv: { category: "av.display" },
  decoder: { category: "av.display" },
  media_player: { category: "av.display" },
  voip: { category: "voip.phone" },
  ups: { category: "power.ups" },
  iot: { category: "iot.other" },
  domotica: { category: "iot.other" },
  console: { category: "iot.other" },
  rete_ot: { category: "iot" },
  plc: { category: "iot.sensor" },
  hmi: { category: "iot.sensor" },
  sensore: { category: "iot.sensor" },
  tablet: { category: "mobile.tablet" },
  smartphone: { category: "mobile.phone" },
};

export function mapLegacyClassification(
  slug: string
): { category: CategorySlug | null; os_family: "windows" | "linux" | null } {
  const hit = LEGACY_MAP[slug];
  if (!hit) return { category: null, os_family: null };
  return { category: hit.category, os_family: hit.os_family ?? null };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test src/lib/attribution/__tests__/taxonomy.test.ts`
Expected: PASS (5 test). Nota: il test "ogni slug legacy" importa `DEVICE_CLASSIFICATIONS` — se qualche slug dei 52 non è coperto, aggiungerlo a `LEGACY_MAP` (la lista completa è in `src/lib/device-classifications.ts:24-77`).

- [ ] **Step 5: Commit**

```bash
git add src/lib/attribution/taxonomy.ts src/lib/attribution/__tests__/taxonomy.test.ts
git commit -m "feat(attribution): tassonomia categoria a 2 livelli + mappa legacy (fase 1)"
```

---

### Task 2: Schema — `attribution_evidence`, colonne `hosts.attr_*`, history, registry

**Files:**
- Modify: `src/lib/db-tenant-schema.ts` (CREATE TABLE prima della chiusura di `TENANT_SCHEMA_SQL` a riga ~1268; indici prima della chiusura di `TENANT_INDEXES_SQL` a riga ~1505)
- Modify: `src/lib/db-tenant.ts` (ALTER idempotenti dentro `getTenantDb()`, accanto al blocco `inferredCols` a righe 811-831)
- Modify: `src/lib/transfer/table-registry.ts` (nuova entry in `TENANT_TABLES`)
- Test: `src/lib/attribution/__tests__/schema-wiring.test.ts`

**Interfaces:**
- Produces (schema): tabella `attribution_evidence(id, host_id, source, phase, dimension CHECK IN ('vendor','category','os'), claim, confidence REAL, weight REAL, raw_value, observed_at, expires_at, superseded_by)`; colonne `hosts.attr_vendor, attr_vendor_name, attr_category, attr_os_family, attr_os_name, attr_confidence_vendor, attr_confidence_category, attr_confidence_os, attr_min_phase, attr_at, attr_engine_version`; colonne `host_classification_history.attr_vendor, attr_category, attr_os`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/attribution/__tests__/schema-wiring.test.ts
import { describe, it } from "node:test";
import assert from "node:assert";
import Database from "better-sqlite3";
import { TENANT_SCHEMA_SQL, TENANT_INDEXES_SQL } from "@/lib/db-tenant-schema";

function freshDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(TENANT_SCHEMA_SQL);
  db.exec(TENANT_INDEXES_SQL);
  return db;
}

describe("attribution schema wiring", () => {
  it("attribution_evidence esiste con le colonne della spec", () => {
    const db = freshDb();
    const cols = db.prepare("PRAGMA table_info(attribution_evidence)").all() as Array<{ name: string }>;
    const names = cols.map((c) => c.name);
    for (const c of ["host_id", "source", "phase", "dimension", "claim", "confidence", "weight", "raw_value", "observed_at", "expires_at", "superseded_by"]) {
      assert.ok(names.includes(c), `manca colonna ${c}`);
    }
  });
  it("dimension ha CHECK sui 3 valori", () => {
    const db = freshDb();
    db.exec("INSERT INTO networks (id, name, cidr) VALUES (1, 'n', '10.0.0.0/24')");
    db.exec("INSERT INTO hosts (id, network_id, ip) VALUES (1, 1, '10.0.0.1')");
    assert.throws(() =>
      db.prepare(
        "INSERT INTO attribution_evidence (host_id, source, phase, dimension, claim, confidence, weight) VALUES (1,'oui','scan_icmp','colore','x',1,1)"
      ).run()
    );
  });
  it("indice per host+dimension presente", () => {
    const db = freshDb();
    const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='attribution_evidence'").all() as Array<{ name: string }>;
    assert.ok(idx.some((i) => i.name === "idx_attr_evidence_host"), "manca idx_attr_evidence_host");
  });
  it("table-registry include attribution_evidence", async () => {
    const { TENANT_TABLES } = await import("@/lib/transfer/table-registry");
    assert.ok(TENANT_TABLES.some((t: { table: string }) => t.table === "attribution_evidence"));
  });
});
```

Nota: se `INSERT INTO networks` fallisse per colonne NOT NULL diverse, copiare l'insert di setup già usato in `src/lib/classification/__tests__/persist.test.ts` (crea network+host in-memory con lo stesso schema).

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/lib/attribution/__tests__/schema-wiring.test.ts`
Expected: FAIL (tabella inesistente)

- [ ] **Step 3: Aggiungere la tabella allo schema**

In `src/lib/db-tenant-schema.ts`, dentro `TENANT_SCHEMA_SQL`, DOPO l'ultima tabella (`mc_command_log`, righe ~1256-1267) e prima del backtick di chiusura:

```sql
-- Attribution v2 (spec §4.2): evidenze append-only per host/dimensione.
-- NB: 'source' e 'phase' senza CHECK deliberatamente — il vocabolario è chiuso
-- a livello TypeScript (AttributionSource/AttributionPhase) e crescerà nelle fasi 2-5;
-- i CHECK SQLite non sono estendibili senza rebuild della tabella.
CREATE TABLE IF NOT EXISTS attribution_evidence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  host_id INTEGER NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  phase TEXT NOT NULL,
  dimension TEXT NOT NULL CHECK(dimension IN ('vendor','category','os')),
  claim TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0,
  weight REAL NOT NULL DEFAULT 0,
  raw_value TEXT,
  observed_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT,
  superseded_by INTEGER REFERENCES attribution_evidence(id) ON DELETE SET NULL
);
```

In `TENANT_INDEXES_SQL`, in coda prima della chiusura:

```sql
CREATE INDEX IF NOT EXISTS idx_attr_evidence_host ON attribution_evidence(host_id, dimension);
CREATE INDEX IF NOT EXISTS idx_attr_evidence_active ON attribution_evidence(host_id, superseded_by) WHERE superseded_by IS NULL;
```

- [ ] **Step 4: ALTER idempotenti per DB tenant esistenti**

In `src/lib/db-tenant.ts`, dentro `getTenantDb()`, SUBITO DOPO il blocco `inferredCols` (righe 811-831), aggiungere (riusa `hCols` da `PRAGMA table_info(hosts)` di riga ~799):

```ts
    // Attribution v2 fase 1 — colonne risultato fusione (spec §5)
    const attrCols: Array<{ name: string; sql: string }> = [
      { name: "attr_vendor", sql: "ALTER TABLE hosts ADD COLUMN attr_vendor TEXT" },
      { name: "attr_vendor_name", sql: "ALTER TABLE hosts ADD COLUMN attr_vendor_name TEXT" },
      { name: "attr_category", sql: "ALTER TABLE hosts ADD COLUMN attr_category TEXT" },
      { name: "attr_os_family", sql: "ALTER TABLE hosts ADD COLUMN attr_os_family TEXT" },
      { name: "attr_os_name", sql: "ALTER TABLE hosts ADD COLUMN attr_os_name TEXT" },
      { name: "attr_confidence_vendor", sql: "ALTER TABLE hosts ADD COLUMN attr_confidence_vendor INTEGER" },
      { name: "attr_confidence_category", sql: "ALTER TABLE hosts ADD COLUMN attr_confidence_category INTEGER" },
      { name: "attr_confidence_os", sql: "ALTER TABLE hosts ADD COLUMN attr_confidence_os INTEGER" },
      { name: "attr_min_phase", sql: "ALTER TABLE hosts ADD COLUMN attr_min_phase TEXT" },
      { name: "attr_at", sql: "ALTER TABLE hosts ADD COLUMN attr_at TEXT" },
      { name: "attr_engine_version", sql: "ALTER TABLE hosts ADD COLUMN attr_engine_version TEXT" },
    ];
    for (const col of attrCols) {
      if (!hCols.some((c) => c.name === col.name)) {
        newDb.exec(col.sql);
        console.info(`[db-tenant] ${tenantCode}: hosts.${col.name} aggiunto`);
      }
    }
    // Tabella evidenze per DB creati prima di questa versione
    newDb.exec(`CREATE TABLE IF NOT EXISTS attribution_evidence (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      host_id INTEGER NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
      source TEXT NOT NULL,
      phase TEXT NOT NULL,
      dimension TEXT NOT NULL CHECK(dimension IN ('vendor','category','os')),
      claim TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 0,
      weight REAL NOT NULL DEFAULT 0,
      raw_value TEXT,
      observed_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT,
      superseded_by INTEGER REFERENCES attribution_evidence(id) ON DELETE SET NULL
    )`);
    newDb.exec("CREATE INDEX IF NOT EXISTS idx_attr_evidence_host ON attribution_evidence(host_id, dimension)");
    newDb.exec("CREATE INDEX IF NOT EXISTS idx_attr_evidence_active ON attribution_evidence(host_id, superseded_by) WHERE superseded_by IS NULL");
    // History estesa alle 3 dimensioni (il CHECK su trigger resta invariato — decisione 8 del piano)
    const histCols = newDb.prepare("PRAGMA table_info(host_classification_history)").all() as Array<{ name: string }>;
    for (const c of ["attr_vendor", "attr_category", "attr_os"]) {
      if (!histCols.some((x) => x.name === c)) {
        newDb.exec(`ALTER TABLE host_classification_history ADD COLUMN ${c} TEXT`);
      }
    }
```

Aggiungere le stesse 3 colonne anche al CREATE di `host_classification_history` in `db-tenant-schema.ts` (righe 108-119): `attr_vendor TEXT, attr_category TEXT, attr_os TEXT` prima di `trigger`.

- [ ] **Step 5: Registrare la tabella nel transfer registry**

In `src/lib/transfer/table-registry.ts`, dentro `TENANT_TABLES`, accanto a `host_classification_history` (riga ~49):

```ts
  { table: "attribution_evidence", scope: "tenant", tier: "history" },
```

(Adeguare la shape esatta dell'entry a quelle adiacenti nel file — alcune hanno `mergeKey`; per una tabella history non serve.)

- [ ] **Step 6: Run tests**

Run: `node --import tsx --test src/lib/attribution/__tests__/schema-wiring.test.ts && npm run test:transfer`
Expected: PASS entrambi (i test transfer verificano che la registry copra le tabelle dello schema).

- [ ] **Step 7: Commit**

```bash
git add src/lib/db-tenant-schema.ts src/lib/db-tenant.ts src/lib/transfer/table-registry.ts src/lib/attribution/__tests__/schema-wiring.test.ts
git commit -m "feat(attribution): tabella attribution_evidence + colonne hosts.attr_* (fase 1)"
```

---

### Task 3: Tipi, pesi e layer evidenze (`types.ts`, `weights.ts`, `evidence.ts`)

**Files:**
- Create: `src/lib/attribution/types.ts`
- Create: `src/lib/attribution/weights.ts`
- Create: `src/lib/attribution/evidence.ts`
- Test: `src/lib/attribution/__tests__/evidence.test.ts`

**Interfaces:**
- Consumes: `CategorySlug` da Task 1 (solo type-check dei claim category negli emitter, non qui).
- Produces:
  - `type AttributionDimension = "vendor" | "category" | "os"`
  - `type AttributionPhase` + `PHASE_ORDER` (ordine pipeline)
  - `type AttributionSource` (i 27 valori della spec §4.2)
  - `interface AttributionEvidenceRow` (riga DB), `interface EvidenceInput`
  - `recordEvidence(dbh: Database.Database, hostId: number, inputs: EvidenceInput[]): { inserted: number; refreshed: number; superseded: number }`
  - `getActiveEvidence(dbh: Database.Database, hostId: number): AttributionEvidenceRow[]`
  - `ATTR_ENGINE_VERSION = "2.0.0"`, `MIN_CLAIM_SCORE = 0.56`, `CONFLICT_WINDOW = 0.10`
  - `ATTR_SOURCE_WEIGHTS: Record<AttributionSource, number>`, `AUTHORITATIVE_SOURCES: Record<AttributionDimension, readonly AttributionSource[]>`

- [ ] **Step 1: Scrivere `types.ts` e `weights.ts`** (nessun test dedicato: sono dati; li copre il test di evidence/fuse)

```ts
// src/lib/attribution/types.ts
export const ATTR_ENGINE_VERSION = "2.0.0";
export const MIN_CLAIM_SCORE = 0.56;   // coerente con MIN_APPLY_CONFIDENCE=56 del motore legacy
export const CONFLICT_WINDOW = 0.1;    // finestra di conflitto sulla scala score 0-1

export type AttributionDimension = "vendor" | "category" | "os";

export const PHASE_ORDER = [
  "scan_icmp",
  "scan_naabu",
  "scan_nmap_base",
  "scan_snmp_verify",
  "credential_validate",
  "integration", // AD / Wazuh / agent GLPI / LLDP: presenti solo se il modulo è attivo
  "manual",
] as const;
export type AttributionPhase = (typeof PHASE_ORDER)[number];

export function phaseIndex(p: AttributionPhase): number {
  return PHASE_ORDER.indexOf(p);
}

// Vocabolario completo spec §4.2 — la fase 1 ne usa un sottoinsieme,
// ma il tipo è chiuso qui una volta sola.
export type AttributionSource =
  | "oui" | "mac_product" | "hostname" | "dhcp" | "ttl" | "ports"
  | "http_banner" | "tls_cert" | "snmp_sysobj" | "snmp_sysdescr"
  | "lldp" | "cdp" | "mdns" | "ssdp" | "wsd" | "netbios" | "smb"
  | "nmap_os" | "nmap_service" | "ad" | "wazuh" | "inv_agent"
  | "ssh" | "winrm" | "fingerbank" | "ai" | "manual";

export interface AttributionEvidenceRow {
  id: number;
  host_id: number;
  source: AttributionSource;
  phase: AttributionPhase;
  dimension: AttributionDimension;
  claim: string;
  confidence: number;   // 0-1
  weight: number;       // 0-1
  raw_value: string | null;
  observed_at: string;
  expires_at: string | null;
  superseded_by: number | null;
}

export interface EvidenceInput {
  source: AttributionSource;
  phase: AttributionPhase;
  dimension: AttributionDimension;
  claim: string;
  confidence: number;
  weight?: number;             // default: ATTR_SOURCE_WEIGHTS[source]
  raw_value?: string | null;
  expires_at?: string | null;  // segnali volatili (DHCP, TTL)
}
```

```ts
// src/lib/attribution/weights.ts
import type { AttributionDimension, AttributionSource } from "./types";

export const ATTR_SOURCE_WEIGHTS: Record<AttributionSource, number> = {
  manual: 1, ad: 1, wazuh: 1, inv_agent: 0.95, winrm: 0.95,
  snmp_sysobj: 0.95, snmp_sysdescr: 0.85, lldp: 0.9, cdp: 0.9,
  oui: 0.9, mac_product: 0.85, http_banner: 0.9, tls_cert: 0.85,
  wsd: 0.9, mdns: 0.8, ssdp: 0.75, smb: 0.75, ssh: 0.6,
  fingerbank: 0.6, netbios: 0.5, nmap_os: 0.5, nmap_service: 0.5,
  hostname: 0.35, ports: 0.3, dhcp: 0.3, ttl: 0.25, ai: 0.5,
};

/**
 * Sorgenti dichiarative (spec §4.3 punto 4): saltano la somma pesata.
 * Fase 1: lldp/cdp NON sono qui perché device_neighbors non persiste i
 * capability bits — l'evidenza LLDP odierna è testuale (remote_platform)
 * e resta probabilistica. Entreranno quando i collector le raccoglieranno.
 */
export const AUTHORITATIVE_SOURCES: Record<AttributionDimension, readonly AttributionSource[]> = {
  vendor: ["manual"],
  category: ["manual", "wsd"],
  os: ["manual", "ad", "wazuh", "inv_agent", "winrm"],
};
```

- [ ] **Step 2: Write the failing test per `evidence.ts`**

```ts
// src/lib/attribution/__tests__/evidence.test.ts
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import Database from "better-sqlite3";
import { TENANT_SCHEMA_SQL, TENANT_INDEXES_SQL } from "@/lib/db-tenant-schema";
import { recordEvidence, getActiveEvidence } from "../evidence";

let db: Database.Database;
beforeEach(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(TENANT_SCHEMA_SQL);
  db.exec(TENANT_INDEXES_SQL);
  db.exec("INSERT INTO networks (id, name, cidr) VALUES (1, 'n', '10.0.0.0/24')");
  db.exec("INSERT INTO hosts (id, network_id, ip) VALUES (1, 1, '10.0.0.1')");
});

describe("recordEvidence", () => {
  it("inserisce evidenza nuova con weight di default", () => {
    const r = recordEvidence(db, 1, [
      { source: "oui", phase: "scan_icmp", dimension: "vendor", claim: "ubiquiti", confidence: 0.9, raw_value: "Ubiquiti Inc" },
    ]);
    assert.equal(r.inserted, 1);
    const rows = getActiveEvidence(db, 1);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].weight, 0.9); // ATTR_SOURCE_WEIGHTS.oui
  });
  it("ri-emissione identica → refresh, non duplicato", () => {
    const input = { source: "oui" as const, phase: "scan_icmp" as const, dimension: "vendor" as const, claim: "ubiquiti", confidence: 0.9, raw_value: "Ubiquiti Inc" };
    recordEvidence(db, 1, [input]);
    const r2 = recordEvidence(db, 1, [input]);
    assert.equal(r2.refreshed, 1);
    assert.equal(r2.inserted, 0);
    assert.equal(getActiveEvidence(db, 1).length, 1);
  });
  it("claim diverso dalla stessa (source,dimension) → supersede", () => {
    recordEvidence(db, 1, [{ source: "hostname", phase: "scan_icmp", dimension: "category", claim: "network.access_point", confidence: 0.5 }]);
    const r2 = recordEvidence(db, 1, [{ source: "hostname", phase: "scan_icmp", dimension: "category", claim: "network.switch", confidence: 0.5 }]);
    assert.equal(r2.inserted, 1);
    assert.equal(r2.superseded, 1);
    const active = getActiveEvidence(db, 1);
    assert.equal(active.length, 1);
    assert.equal(active[0].claim, "network.switch");
    const all = db.prepare("SELECT COUNT(*) AS n FROM attribution_evidence WHERE host_id=1").get() as { n: number };
    assert.equal(all.n, 2); // la storia resta
  });
  it("manual non viene mai superseded da sorgenti automatiche", () => {
    recordEvidence(db, 1, [{ source: "manual", phase: "manual", dimension: "category", claim: "network.switch", confidence: 1 }]);
    recordEvidence(db, 1, [{ source: "hostname", phase: "scan_icmp", dimension: "category", claim: "network.access_point", confidence: 0.5 }]);
    const active = getActiveEvidence(db, 1);
    assert.ok(active.some((e) => e.source === "manual" && e.claim === "network.switch"));
  });
  it("nuovo manual supersede il manual precedente sulla stessa dimensione", () => {
    recordEvidence(db, 1, [{ source: "manual", phase: "manual", dimension: "category", claim: "network.switch", confidence: 1 }]);
    recordEvidence(db, 1, [{ source: "manual", phase: "manual", dimension: "category", claim: "network.router", confidence: 1 }]);
    const manuals = getActiveEvidence(db, 1).filter((e) => e.source === "manual");
    assert.equal(manuals.length, 1);
    assert.equal(manuals[0].claim, "network.router");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --import tsx --test src/lib/attribution/__tests__/evidence.test.ts`
Expected: FAIL (`Cannot find module '../evidence'`)

- [ ] **Step 4: Implementare `evidence.ts`**

```ts
// src/lib/attribution/evidence.ts
import type Database from "better-sqlite3";
import type { AttributionEvidenceRow, EvidenceInput } from "./types";
import { ATTR_SOURCE_WEIGHTS } from "./weights";

export interface RecordEvidenceResult { inserted: number; refreshed: number; superseded: number; }

/**
 * Registra evidenze per un host (spec §4.2, decisione 10 del piano):
 * - identica a una attiva (source, dimension, claim, raw_value) → refresh di
 *   observed_at/confidence/expires_at;
 * - claim/raw diverso dalla stessa (source, dimension) → INSERT + supersede
 *   delle attive precedenti di quella coppia;
 * - le evidenze manual sono superseded SOLO da un nuovo manual.
 */
export function recordEvidence(
  dbh: Database.Database,
  hostId: number,
  inputs: EvidenceInput[]
): RecordEvidenceResult {
  const result: RecordEvidenceResult = { inserted: 0, refreshed: 0, superseded: 0 };
  const selActive = dbh.prepare(
    `SELECT id, claim, raw_value FROM attribution_evidence
     WHERE host_id = ? AND source = ? AND dimension = ? AND superseded_by IS NULL`
  );
  const refresh = dbh.prepare(
    `UPDATE attribution_evidence
     SET observed_at = datetime('now'), confidence = ?, expires_at = ? WHERE id = ?`
  );
  const insert = dbh.prepare(
    `INSERT INTO attribution_evidence
       (host_id, source, phase, dimension, claim, confidence, weight, raw_value, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const supersede = dbh.prepare(`UPDATE attribution_evidence SET superseded_by = ? WHERE id = ?`);

  dbh.transaction(() => {
    for (const input of inputs) {
      const weight = input.weight ?? ATTR_SOURCE_WEIGHTS[input.source];
      const active = selActive.all(hostId, input.source, input.dimension) as Array<{
        id: number; claim: string; raw_value: string | null;
      }>;
      const identical = active.find(
        (a) => a.claim === input.claim && (a.raw_value ?? null) === (input.raw_value ?? null)
      );
      if (identical) {
        refresh.run(input.confidence, input.expires_at ?? null, identical.id);
        result.refreshed += 1;
        continue;
      }
      const newId = insert.run(
        hostId, input.source, input.phase, input.dimension, input.claim,
        input.confidence, weight, input.raw_value ?? null, input.expires_at ?? null
      ).lastInsertRowid as number;
      result.inserted += 1;
      for (const a of active) {
        supersede.run(newId, a.id);
        result.superseded += 1;
      }
    }
  })();
  return result;
}

export function getActiveEvidence(
  dbh: Database.Database,
  hostId: number
): AttributionEvidenceRow[] {
  return dbh
    .prepare(
      `SELECT * FROM attribution_evidence
       WHERE host_id = ? AND superseded_by IS NULL
       ORDER BY dimension, source, id`
    )
    .all(hostId) as AttributionEvidenceRow[];
}
```

Nota sul vincolo "manual mai superseded da automatiche": è garantito strutturalmente — il supersede agisce solo sulle righe con la **stessa** `source`, quindi un'evidenza `hostname` non può mai superare una `manual`. Il test lo verifica comunque.

- [ ] **Step 5: Run test to verify it passes**

Run: `node --import tsx --test src/lib/attribution/__tests__/evidence.test.ts`
Expected: PASS (5 test)

- [ ] **Step 6: Commit**

```bash
git add src/lib/attribution/types.ts src/lib/attribution/weights.ts src/lib/attribution/evidence.ts src/lib/attribution/__tests__/evidence.test.ts
git commit -m "feat(attribution): tipi, pesi e layer evidenze con supersede (fase 1)"
```

---

### Task 4: Fusione pura (`fuse.ts`)

**Files:**
- Create: `src/lib/attribution/fuse.ts`
- Test: `src/lib/attribution/__tests__/fuse.test.ts`

**Interfaces:**
- Consumes: `AttributionEvidenceRow`, `PHASE_ORDER`, `phaseIndex`, `MIN_CLAIM_SCORE`, `CONFLICT_WINDOW`, `ATTR_ENGINE_VERSION` (Task 3); `isValidCategory`, `categoryParent`, `categoryDepth`, `commonAncestor` (Task 1); `AUTHORITATIVE_SOURCES` (Task 3).
- Produces:

```ts
export interface AttributionConflict { a: string; b: string; score_a: number; score_b: number; }
export interface DimensionResult {
  claim: string | null;
  confidence: number;          // 0-100
  min_phase: AttributionPhase | null;
  evidence_ids: number[];      // evidenze citate per il claim vincente
  conflicts: AttributionConflict[];
  authoritative: boolean;      // true se decisa da sorgente dichiarativa o manual
}
export interface AttributionResult {
  vendor: DimensionResult & { vendor_name: string | null };
  category: DimensionResult;
  os: DimensionResult & { os_name: string | null };
  engine_version: string;
}
export function fuseAttribution(evidence: AttributionEvidenceRow[], nowIso: string): AttributionResult
```

**Algoritmo (spec §4.3, per ciascuna dimensione):**
1. Filtra: `dimension` corrispondente, `superseded_by IS NULL` (già garantito da `getActiveEvidence`), `expires_at` null o > `nowIso`.
2. Se c'è evidenza `manual` → claim suo, confidence 100, `authoritative: true`, min_phase `manual`. Stop.
3. Se c'è evidenza di sorgente in `AUTHORITATIVE_SOURCES[dimension]` → vince quella a confidence più alta (claim suo, confidence `round(confidence*100)`, `authoritative: true`). Stop.
4. Somma pesata per claim: `score(claim) = Σ weight × confidence`. Per `category`, ogni claim livello-2 contribuisce ANCHE al proprio livello-1.
5. Vincitore: il claim **più profondo** con score ≥ `MIN_CLAIM_SCORE`. Se i due migliori claim di pari profondità distano meno di `CONFLICT_WINDOW` → si ripiega su `commonAncestor` (se esiste e sopra soglia) e si registra il conflitto. Per vendor/os (nessuna gerarchia): conflitto → vince il primo per score ma il conflitto è registrato; sotto soglia → claim null.
6. `confidence = min(100, round(score*100))`; `min_phase` = fase più avanzata (max `phaseIndex`) tra le evidenze citate; `evidence_ids` = id delle evidenze del claim vincente (per category: anche quelle dei figli che hanno contribuito al livello-1 scelto).
7. Per `vendor`: `vendor_name` = `raw_value` dell'evidenza a confidence più alta del claim vincente. Per `os`: claim = `os_family`; `os_name` = `raw_value` più confidente (es. "Windows Server 2022 Standard" da AD).

- [ ] **Step 1: Write the failing test** (i casi tabellari della spec §8)

```ts
// src/lib/attribution/__tests__/fuse.test.ts
import { describe, it } from "node:test";
import assert from "node:assert";
import { fuseAttribution } from "../fuse";
import type { AttributionEvidenceRow } from "../types";

const NOW = "2026-07-26T12:00:00Z";
let nextId = 1;
function ev(partial: Partial<AttributionEvidenceRow> & Pick<AttributionEvidenceRow, "source" | "dimension" | "claim">): AttributionEvidenceRow {
  return {
    id: nextId++, host_id: 1, phase: "scan_icmp", confidence: 0.9, weight: 0.9,
    raw_value: null, observed_at: NOW, expires_at: null, superseded_by: null,
    ...partial,
  } as AttributionEvidenceRow;
}

describe("fuseAttribution", () => {
  it("solo fase ICMP: vendor da OUI, categoria livello 1 assente se sotto soglia", () => {
    const r = fuseAttribution([
      ev({ source: "oui", dimension: "vendor", claim: "ubiquiti", raw_value: "Ubiquiti Inc", confidence: 0.9, weight: 0.9 }),
      ev({ source: "hostname", dimension: "category", claim: "network.access_point", confidence: 0.5, weight: 0.35 }),
    ], NOW);
    assert.equal(r.vendor.claim, "ubiquiti");
    assert.equal(r.vendor.vendor_name, "Ubiquiti Inc");
    assert.equal(r.vendor.min_phase, "scan_icmp");
    assert.equal(r.category.claim, null); // 0.5*0.35=0.175 < 0.56
  });
  it("AP Ubiquiti: sysDescr + hostname concordi superano la soglia sul livello 2", () => {
    const r = fuseAttribution([
      ev({ source: "snmp_sysdescr", dimension: "category", claim: "network.access_point", confidence: 0.85, weight: 0.85, phase: "scan_snmp_verify" }),
      ev({ source: "hostname", dimension: "category", claim: "network.access_point", confidence: 0.5, weight: 0.35 }),
    ], NOW);
    assert.equal(r.category.claim, "network.access_point");
    assert.equal(r.category.min_phase, "scan_snmp_verify"); // fase più avanzata citata
    assert.ok(r.category.confidence >= 56);
  });
  it("switch con hostname fuorviante ap-piano2: conflitto pari livello → ripiega su network", () => {
    const r = fuseAttribution([
      ev({ source: "snmp_sysdescr", dimension: "category", claim: "network.switch", confidence: 0.8, weight: 0.85, phase: "scan_snmp_verify" }),
      ev({ source: "hostname", dimension: "category", claim: "network.access_point", confidence: 0.9, weight: 0.7, raw_value: "ap-piano2" }),
    ], NOW);
    // score switch=0.68, ap=0.63 → delta 0.05 < 0.10 → padre comune
    assert.equal(r.category.claim, "network");
    assert.equal(r.category.conflicts.length, 1);
  });
  it("AD è autoritativo sull'OS e vince su nmap discordante", () => {
    const r = fuseAttribution([
      ev({ source: "nmap_os", dimension: "os", claim: "linux", confidence: 0.9, weight: 0.5, phase: "scan_nmap_base" }),
      ev({ source: "ad", dimension: "os", claim: "windows", confidence: 0.95, weight: 1, raw_value: "Windows Server 2022 Standard", phase: "integration" }),
    ], NOW);
    assert.equal(r.os.claim, "windows");
    assert.equal(r.os.authoritative, true);
    assert.equal(r.os.os_name, "Windows Server 2022 Standard");
  });
  it("manual vince sempre, anche su autoritative", () => {
    const r = fuseAttribution([
      ev({ source: "ad", dimension: "os", claim: "windows", confidence: 0.95, weight: 1, phase: "integration" }),
      ev({ source: "manual", dimension: "os", claim: "linux", confidence: 1, weight: 1, phase: "manual" }),
    ], NOW);
    assert.equal(r.os.claim, "linux");
    assert.equal(r.os.confidence, 100);
  });
  it("evidenza scaduta esclusa dalla fusione", () => {
    const r = fuseAttribution([
      ev({ source: "dhcp", dimension: "vendor", claim: "samsung", confidence: 0.9, weight: 0.9, expires_at: "2026-07-01T00:00:00Z" }),
    ], NOW);
    assert.equal(r.vendor.claim, null);
  });
  it("voti livello 2 discordi fanno comunque emergere il livello 1", () => {
    const r = fuseAttribution([
      ev({ source: "snmp_sysdescr", dimension: "category", claim: "network.switch", confidence: 0.45, weight: 0.85, phase: "scan_snmp_verify" }),
      ev({ source: "ports", dimension: "category", claim: "network.router", confidence: 0.9, weight: 0.3, phase: "scan_naabu" }),
    ], NOW);
    // switch=0.3825, router=0.27: entrambi sotto soglia, ma network=0.6525 sopra
    assert.equal(r.category.claim, "network");
    assert.equal(r.category.min_phase, "scan_snmp_verify");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/lib/attribution/__tests__/fuse.test.ts`
Expected: FAIL (`Cannot find module '../fuse'`)

- [ ] **Step 3: Implementare `fuse.ts`**

```ts
// src/lib/attribution/fuse.ts
// Fusione pura evidenze → attribuzione (spec §4.3). Nessun accesso DB, nessun side effect.
import {
  ATTR_ENGINE_VERSION, CONFLICT_WINDOW, MIN_CLAIM_SCORE, phaseIndex,
} from "./types";
import type {
  AttributionDimension, AttributionEvidenceRow, AttributionPhase,
} from "./types";
import { AUTHORITATIVE_SOURCES } from "./weights";
import {
  categoryDepth, categoryParent, commonAncestor, isValidCategory,
} from "./taxonomy";
import type { CategorySlug } from "./taxonomy";

export interface AttributionConflict { a: string; b: string; score_a: number; score_b: number; }
export interface DimensionResult {
  claim: string | null;
  confidence: number;
  min_phase: AttributionPhase | null;
  evidence_ids: number[];
  conflicts: AttributionConflict[];
  authoritative: boolean;
}
export interface AttributionResult {
  vendor: DimensionResult & { vendor_name: string | null };
  category: DimensionResult;
  os: DimensionResult & { os_name: string | null };
  engine_version: string;
}

function emptyResult(): DimensionResult {
  return { claim: null, confidence: 0, min_phase: null, evidence_ids: [], conflicts: [], authoritative: false };
}

function minPhaseOf(rows: AttributionEvidenceRow[]): AttributionPhase | null {
  if (rows.length === 0) return null;
  return rows.reduce((acc, r) => (phaseIndex(r.phase) > phaseIndex(acc) ? r.phase : acc), rows[0].phase);
}

function bestRaw(rows: AttributionEvidenceRow[]): string | null {
  const withRaw = rows.filter((r) => r.raw_value != null);
  if (withRaw.length === 0) return null;
  return withRaw.reduce((a, b) => (b.confidence > a.confidence ? b : a)).raw_value;
}

function fuseDimension(
  all: AttributionEvidenceRow[],
  dimension: AttributionDimension,
  nowIso: string
): { result: DimensionResult; winnerRows: AttributionEvidenceRow[] } {
  const rows = all.filter(
    (e) => e.dimension === dimension && (e.expires_at == null || e.expires_at > nowIso)
  );
  const result = emptyResult();
  if (rows.length === 0) return { result, winnerRows: [] };

  // 1. manual vince sempre
  const manual = rows.filter((e) => e.source === "manual");
  if (manual.length > 0) {
    const m = manual[manual.length - 1];
    return {
      result: { ...result, claim: m.claim, confidence: 100, min_phase: "manual", evidence_ids: [m.id], authoritative: true },
      winnerRows: [m],
    };
  }

  // 2. sorgenti dichiarative (spec §4.3 punto 4)
  const authSources = AUTHORITATIVE_SOURCES[dimension];
  const auth = rows.filter((e) => authSources.includes(e.source));
  if (auth.length > 0) {
    const winner = auth.reduce((a, b) => (b.confidence > a.confidence ? b : a));
    const supporting = auth.filter((e) => e.claim === winner.claim);
    return {
      result: {
        ...result, claim: winner.claim,
        confidence: Math.min(100, Math.round(winner.confidence * 100)),
        min_phase: minPhaseOf(supporting), evidence_ids: supporting.map((e) => e.id),
        authoritative: true,
      },
      winnerRows: supporting,
    };
  }

  // 3. somma pesata per claim
  const scores = new Map<string, number>();
  for (const e of rows) {
    scores.set(e.claim, (scores.get(e.claim) ?? 0) + e.weight * e.confidence);
  }

  if (dimension === "category") {
    // gerarchia: i livello-2 contribuiscono al proprio livello-1
    const l1: Map<string, number> = new Map();
    for (const [claim, s] of scores) {
      if (!isValidCategory(claim)) continue;
      const parent = categoryParent(claim as CategorySlug);
      l1.set(parent, (l1.get(parent) ?? 0) + s);
    }
    // classifica dei claim livello-2 sopra soglia, per profondità poi score
    const l2Sorted = [...scores.entries()]
      .filter(([c]) => isValidCategory(c) && categoryDepth(c as CategorySlug) === 2)
      .sort((a, b) => b[1] - a[1]);
    const conflicts: AttributionConflict[] = [];
    let claim: string | null = null;
    let citing: AttributionEvidenceRow[] = [];
    if (l2Sorted.length >= 2 && l2Sorted[0][1] >= MIN_CLAIM_SCORE && l2Sorted[0][1] - l2Sorted[1][1] < CONFLICT_WINDOW) {
      conflicts.push({ a: l2Sorted[0][0], b: l2Sorted[1][0], score_a: l2Sorted[0][1], score_b: l2Sorted[1][1] });
      const anc = commonAncestor(l2Sorted[0][0] as CategorySlug, l2Sorted[1][0] as CategorySlug);
      claim = anc;
    } else if (l2Sorted.length > 0 && l2Sorted[0][1] >= MIN_CLAIM_SCORE) {
      claim = l2Sorted[0][0];
    }
    if (claim == null) {
      // nessuna foglia qualificata: prova il livello 1 aggregato
      const l1Sorted = [...l1.entries()].sort((a, b) => b[1] - a[1]);
      if (l1Sorted.length > 0 && l1Sorted[0][1] >= MIN_CLAIM_SCORE) claim = l1Sorted[0][0];
    }
    if (claim == null) return { result: { ...result, conflicts }, winnerRows: [] };
    const score = categoryDepth(claim as CategorySlug) === 2 ? scores.get(claim)! : l1.get(claim)!;
    citing = rows.filter(
      (e) => e.claim === claim || (isValidCategory(e.claim) && categoryParent(e.claim as CategorySlug) === claim)
    );
    return {
      result: {
        claim, confidence: Math.min(100, Math.round(score * 100)),
        min_phase: minPhaseOf(citing), evidence_ids: citing.map((e) => e.id),
        conflicts, authoritative: false,
      },
      winnerRows: citing,
    };
  }

  // vendor / os: nessuna gerarchia
  const sorted = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  const conflicts: AttributionConflict[] = [];
  if (sorted.length >= 2 && sorted[0][1] - sorted[1][1] < CONFLICT_WINDOW) {
    conflicts.push({ a: sorted[0][0], b: sorted[1][0], score_a: sorted[0][1], score_b: sorted[1][1] });
  }
  if (sorted.length === 0 || sorted[0][1] < MIN_CLAIM_SCORE) {
    return { result: { ...result, conflicts }, winnerRows: [] };
  }
  const claim = sorted[0][0];
  const citing = rows.filter((e) => e.claim === claim);
  return {
    result: {
      claim, confidence: Math.min(100, Math.round(sorted[0][1] * 100)),
      min_phase: minPhaseOf(citing), evidence_ids: citing.map((e) => e.id),
      conflicts, authoritative: false,
    },
    winnerRows: citing,
  };
}

export function fuseAttribution(
  evidence: AttributionEvidenceRow[], nowIso: string
): AttributionResult {
  const vendor = fuseDimension(evidence, "vendor", nowIso);
  const category = fuseDimension(evidence, "category", nowIso);
  const os = fuseDimension(evidence, "os", nowIso);
  return {
    vendor: { ...vendor.result, vendor_name: bestRaw(vendor.winnerRows) },
    category: category.result,
    os: { ...os.result, os_name: bestRaw(os.winnerRows) },
    engine_version: ATTR_ENGINE_VERSION,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test src/lib/attribution/__tests__/fuse.test.ts`
Expected: PASS (7 test). Verificare a mano i numeri del test "hostname fuorviante" (0.8×0.85=0.68 vs 0.9×0.7=0.63, delta 0.05<0.10 → conflitto → padre `network`).

- [ ] **Step 5: Commit**

```bash
git add src/lib/attribution/fuse.ts src/lib/attribution/__tests__/fuse.test.ts
git commit -m "feat(attribution): fusione pura a 3 dimensioni con gerarchia e autorita (fase 1)"
```

---

### Task 5: Emettitori dai segnali già in DB (`emitters.ts`) + query segnali

**Files:**
- Create: `src/lib/attribution/emitters.ts`
- Modify: `src/lib/db-tenant.ts` (nuova `getAttributionSignalsForHost()`)
- Modify: `src/lib/db.ts` (facade della stessa)
- Test: `src/lib/attribution/__tests__/emitters.test.ts`

**Interfaces:**
- Consumes: `EvidenceInput` (Task 3), `mapLegacyClassification` (Task 1), `lookupVendorSync` da `@/lib/scanner/mac-vendor`, `lookupSysObjectId` da `@/lib/scanner/snmp-sysobj-lookup`, `mapSysObjCategory` da `@/lib/attribution/sysobj-category`, `classifyDevice` da `@/lib/device-classifier`.
- Produces:

```ts
// Snapshot dei segnali di un host già persistiti (nessun probe): input puro per gli emettitori.
export interface AttributionSignals {
  host: {
    id: number; ip: string; mac: string | null; vendor: string | null;
    hostname: string | null; os_info: string | null; open_ports: string | null;
    snmp_data: string | null; detection_json: string | null;
  };
  adComputer: { operating_system: string | null; operating_system_version: string | null } | null;
  wazuh: { os_platform: string | null; os_name: string | null; os_version: string | null; board_vendor: string | null } | null;
  neighborSightings: Array<{ protocol: string; remote_platform: string | null; remote_device_name: string }>;
}
export function emitEvidenceFromSignals(signals: AttributionSignals): EvidenceInput[]   // pura, testabile
// in db-tenant.ts (+ facade db.ts):
export function getAttributionSignalsForHost(hostId: number): AttributionSignals | null
```

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/attribution/__tests__/emitters.test.ts
import { describe, it } from "node:test";
import assert from "node:assert";
import { emitEvidenceFromSignals } from "../emitters";
import type { AttributionSignals } from "../emitters";

function base(): AttributionSignals {
  return {
    host: { id: 1, ip: "10.0.0.1", mac: null, vendor: null, hostname: null, os_info: null, open_ports: null, snmp_data: null, detection_json: null },
    adComputer: null, wazuh: null, neighborSightings: [],
  };
}

describe("emitEvidenceFromSignals", () => {
  it("vendor da OUI (hosts.vendor già risolto)", () => {
    const s = base();
    s.host.vendor = "Ubiquiti Inc";
    const out = emitEvidenceFromSignals(s);
    const v = out.find((e) => e.source === "oui" && e.dimension === "vendor");
    assert.ok(v);
    assert.equal(v.claim, "ubiquiti");
    assert.equal(v.raw_value, "Ubiquiti Inc");
    assert.equal(v.phase, "scan_icmp");
  });
  it("sysDescr Ubiquiti: U6-Pro → access_point, USW → switch, UDM → router", () => {
    const mk = (sysDescr: string) => {
      const s = base();
      s.host.snmp_data = JSON.stringify({ sysDescr, sysObjectID: "1.3.6.1.4.1.41112", collected_at: "x" });
      return emitEvidenceFromSignals(s).filter((e) => e.source === "snmp_sysdescr" && e.dimension === "category");
    };
    assert.equal(mk("U6-Pro 6.5.28")[0]?.claim, "network.access_point");
    assert.equal(mk("USW-24-PoE 7.0.1")[0]?.claim, "network.switch");
    assert.equal(mk("UDM-Pro 3.1")[0]?.claim, "network.router");
  });
  it("sysObjectID via lookup KB → vendor + categoria (fallback tabella builtin)", () => {
    const s = base();
    // 1.3.6.1.4.1.41112.1.6 è UniFi AP nella LOOKUP_TABLE builtin
    s.host.snmp_data = JSON.stringify({ sysObjectID: "1.3.6.1.4.1.41112.1.6", sysDescr: null, collected_at: "x" });
    const out = emitEvidenceFromSignals(s);
    const cat = out.find((e) => e.source === "snmp_sysobj" && e.dimension === "category");
    const ven = out.find((e) => e.source === "snmp_sysobj" && e.dimension === "vendor");
    assert.equal(cat?.claim, "network.access_point");
    assert.ok(ven);
  });
  it("os_info nmap → os family", () => {
    const s = base();
    s.host.os_info = "Microsoft Windows Server 2019";
    const out = emitEvidenceFromSignals(s);
    const os = out.find((e) => e.source === "nmap_os" && e.dimension === "os");
    assert.equal(os?.claim, "windows");
  });
  it("AD autoritativo: os + categoria server/workstation", () => {
    const s = base();
    s.adComputer = { operating_system: "Windows Server 2022 Standard", operating_system_version: "10.0 (20348)" };
    const out = emitEvidenceFromSignals(s);
    assert.equal(out.find((e) => e.source === "ad" && e.dimension === "os")?.claim, "windows");
    assert.equal(out.find((e) => e.source === "ad" && e.dimension === "category")?.claim, "compute.server");
    const s2 = base();
    s2.adComputer = { operating_system: "Windows 11 Pro", operating_system_version: null };
    assert.equal(emitEvidenceFromSignals(s2).find((e) => e.source === "ad" && e.dimension === "category")?.claim, "compute.workstation");
  });
  it("Wazuh: os_platform → famiglia + compute livello 1", () => {
    const s = base();
    s.wazuh = { os_platform: "ubuntu", os_name: "Ubuntu", os_version: "22.04", board_vendor: "Dell Inc." };
    const out = emitEvidenceFromSignals(s);
    assert.equal(out.find((e) => e.source === "wazuh" && e.dimension === "os")?.claim, "linux");
    assert.equal(out.find((e) => e.source === "wazuh" && e.dimension === "category")?.claim, "compute");
  });
  it("neighbor LLDP con platform → categoria non autoritativa", () => {
    const s = base();
    s.neighborSightings = [{ protocol: "lldp", remote_platform: "MikroTik RouterOS 7.14 CRS326", remote_device_name: "sw-core" }];
    const out = emitEvidenceFromSignals(s);
    const cat = out.find((e) => e.source === "lldp" && e.dimension === "category");
    assert.ok(cat, "attesa evidenza categoria da LLDP");
    assert.ok(cat.confidence <= 0.7);
  });
  it("hostname pattern → categoria debole", () => {
    const s = base();
    s.host.hostname = "ap-piano2";
    const out = emitEvidenceFromSignals(s);
    assert.equal(out.find((e) => e.source === "hostname" && e.dimension === "category")?.claim, "network.access_point");
  });
  it("nessun segnale → nessuna evidenza (mai claim vuoti)", () => {
    assert.deepEqual(emitEvidenceFromSignals(base()), []);
    for (const e of emitEvidenceFromSignals(base())) assert.ok(e.claim.length > 0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/lib/attribution/__tests__/emitters.test.ts`
Expected: FAIL (`Cannot find module '../emitters'`)

- [ ] **Step 3: Implementare `emitters.ts`**

```ts
// src/lib/attribution/emitters.ts
// Emettitori fase 1 (spec §9): SOLO segnali già in DB, zero probe nuovi.
import { classifyDevice } from "@/lib/device-classifier";
import { lookupSysObjectId } from "@/lib/scanner/snmp-sysobj-lookup";
import { mapSysObjCategory } from "@/lib/attribution/sysobj-category";
import { mapLegacyClassification } from "./taxonomy";
import type { EvidenceInput } from "./types";

export interface AttributionSignals {
  host: {
    id: number; ip: string; mac: string | null; vendor: string | null;
    hostname: string | null; os_info: string | null; open_ports: string | null;
    snmp_data: string | null; detection_json: string | null;
  };
  adComputer: { operating_system: string | null; operating_system_version: string | null } | null;
  wazuh: { os_platform: string | null; os_name: string | null; os_version: string | null; board_vendor: string | null } | null;
  neighborSightings: Array<{ protocol: string; remote_platform: string | null; remote_device_name: string }>;
}

/** "Ubiquiti Inc" → "ubiquiti"; "Hewlett Packard Enterprise" → "hewlett-packard-enterprise" */
export function vendorSlug(name: string): string {
  return name.trim().toLowerCase()
    .replace(/,?\s+(inc|ltd|llc|gmbh|s\.?p\.?a\.?|s\.?r\.?l\.?|co|corp|corporation|technologies|technology|networks)\.?$/i, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// Caso Ubiquiti (nota Fase 0 della spec): il modello nel sysDescr distingue AP/switch/router
const UBNT_AP = /\b(U[67][A-Z0-9-]*|UAP[A-Z0-9-]*|UA-[A-Z0-9-]*)\b/i;
const UBNT_SW = /\b(USW[A-Z0-9-]*|US-\d[A-Z0-9-]*|USL\d*|UniFi\s*Switch)\b/i;
const UBNT_GW = /\b(USG[A-Z0-9-]*|UXG[A-Z0-9-]*|UDM[A-Z0-9-]*|UDR|EdgeRouter|ER-[A-Z0-9]+)\b/i;

const OS_PLATFORM_FAMILY: Record<string, string> = {
  windows: "windows", darwin: "macos", macos: "macos",
  ubuntu: "linux", debian: "linux", centos: "linux", rhel: "linux",
  rocky: "linux", alma: "linux", suse: "linux", fedora: "linux", alpine: "linux",
};

function osFamilyFromText(text: string): string | null {
  const t = text.toLowerCase();
  if (t.includes("windows")) return "windows";
  if (t.includes("mac os") || t.includes("macos") || t.includes("os x")) return "macos";
  if (t.includes("linux") || t.includes("ubuntu") || t.includes("debian") || t.includes("centos")) return "linux";
  if (t.includes("routeros") || t.includes("ios") || t.includes("junos") || t.includes("edgeos") || t.includes("vyos")) return "network-os";
  return null;
}

function safeJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}

function categoryFromLegacyText(input: Parameters<typeof classifyDevice>[0]): string | null {
  const legacy = classifyDevice(input);
  if (!legacy || legacy === "unknown") return null;
  return mapLegacyClassification(legacy).category;
}

export function emitEvidenceFromSignals(signals: AttributionSignals): EvidenceInput[] {
  const out: EvidenceInput[] = [];
  const { host } = signals;

  // 1. Vendor da OUI: hosts.vendor è già la risoluzione OUI del MAC (lookupVendorSync
  //    a scan-time). Non rifacciamo il lookup: emettiamo il dato persistito.
  if (host.vendor) {
    out.push({
      source: "oui", phase: "scan_icmp", dimension: "vendor",
      claim: vendorSlug(host.vendor), confidence: 0.9, raw_value: host.vendor,
    });
  }

  // 2. SNMP: sysObjectID via KB + sysDescr (incl. caso Ubiquiti)
  const snmp = safeJson<{ sysDescr?: string | null; sysObjectID?: string | null; manufacturer?: string | null }>(host.snmp_data);
  if (snmp?.sysObjectID) {
    const match = lookupSysObjectId(snmp.sysObjectID);
    if (match) {
      out.push({
        source: "snmp_sysobj", phase: "scan_snmp_verify", dimension: "vendor",
        claim: vendorSlug(match.vendor), confidence: 0.95, raw_value: match.vendor,
      });
      const legacyCat = mapSysObjCategory(match);
      const cat = legacyCat ? mapLegacyClassification(legacyCat).category : null;
      if (cat) {
        out.push({
          source: "snmp_sysobj", phase: "scan_snmp_verify", dimension: "category",
          claim: cat, confidence: 0.95, raw_value: `${snmp.sysObjectID} → ${match.product}`,
        });
      }
    }
  }
  if (snmp?.sysDescr) {
    const d = snmp.sysDescr;
    let ubntCat: string | null = null;
    if (UBNT_SW.test(d)) ubntCat = "network.switch";
    else if (UBNT_AP.test(d)) ubntCat = "network.access_point";
    else if (UBNT_GW.test(d)) ubntCat = "network.router";
    if (ubntCat) {
      out.push({ source: "snmp_sysdescr", phase: "scan_snmp_verify", dimension: "category", claim: ubntCat, confidence: 0.9, raw_value: d.slice(0, 200) });
    } else {
      const cat = categoryFromLegacyText({ sysDescr: d });
      if (cat) out.push({ source: "snmp_sysdescr", phase: "scan_snmp_verify", dimension: "category", claim: cat, confidence: 0.75, raw_value: d.slice(0, 200) });
    }
    const osFam = osFamilyFromText(d);
    if (osFam) out.push({ source: "snmp_sysdescr", phase: "scan_snmp_verify", dimension: "os", claim: osFam, confidence: 0.7, raw_value: d.slice(0, 200) });
  }

  // 3. os_info (nmap/altro)
  if (host.os_info) {
    const fam = osFamilyFromText(host.os_info);
    if (fam) out.push({ source: "nmap_os", phase: "scan_nmap_base", dimension: "os", claim: fam, confidence: 0.7, raw_value: host.os_info.slice(0, 200) });
  }

  // 4. hostname (debole)
  if (host.hostname) {
    const cat = categoryFromLegacyText({ hostname: host.hostname });
    if (cat) out.push({ source: "hostname", phase: "scan_icmp", dimension: "category", claim: cat, confidence: 0.5, raw_value: host.hostname });
  }

  // 5. porte aperte (debole)
  const ports = safeJson<Array<{ port: number }>>(host.open_ports);
  if (ports && ports.length > 0) {
    const cat = categoryFromLegacyText({ openPorts: ports });
    if (cat) out.push({ source: "ports", phase: "scan_naabu", dimension: "category", claim: cat, confidence: 0.5, raw_value: ports.map((p) => p.port).join(",") });
  }

  // 6. AD — autoritativo su OS (spec §4.3 punto 4)
  const ados = signals.adComputer?.operating_system;
  if (ados) {
    out.push({ source: "ad", phase: "integration", dimension: "os", claim: "windows", confidence: 0.95, raw_value: ados });
    out.push({
      source: "ad", phase: "integration", dimension: "category",
      claim: ados.toLowerCase().includes("server") ? "compute.server" : "compute.workstation",
      confidence: 0.85, raw_value: ados,
    });
  }

  // 7. Wazuh — autoritativo su OS; l'agente implica compute.*
  const wz = signals.wazuh; // narrowing esplicito: l'optional chaining nella condizione non basta a TS
  if (wz && (wz.os_platform || wz.os_name)) {
    const plat = (wz.os_platform ?? "").toLowerCase();
    const fam = OS_PLATFORM_FAMILY[plat] ?? osFamilyFromText(wz.os_name ?? "") ?? (plat ? "linux" : null);
    const rawOs = [wz.os_name, wz.os_version].filter(Boolean).join(" ") || null;
    if (fam) out.push({ source: "wazuh", phase: "integration", dimension: "os", claim: fam, confidence: 0.95, raw_value: rawOs });
    out.push({ source: "wazuh", phase: "integration", dimension: "category", claim: "compute", confidence: 0.6, raw_value: "agente Wazuh presente" });
    if (wz.board_vendor) {
      out.push({ source: "wazuh", phase: "integration", dimension: "vendor", claim: vendorSlug(wz.board_vendor), confidence: 0.7, raw_value: wz.board_vendor });
    }
  }

  // 8. Neighbors LLDP/CDP — testuale, non autoritativo (capability bits non in DB, decisione 7)
  for (const n of signals.neighborSightings) {
    if (!n.remote_platform) continue;
    const cat = categoryFromLegacyText({ sysDescr: n.remote_platform });
    if (!cat) continue;
    const source = n.protocol === "cdp" ? "cdp" : "lldp";
    out.push({ source, phase: "integration", dimension: "category", claim: cat, confidence: 0.7, raw_value: n.remote_platform.slice(0, 200) });
    break; // un solo sighting basta: gli altri sono duplicati dello stesso vicinato
  }

  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test src/lib/attribution/__tests__/emitters.test.ts`
Expected: PASS (9 test). Se il test sysObjectID fallisce perché `lookupSysObjectId` richiede il DB hub: la funzione ha già fallback alla `LOOKUP_TABLE` hardcoded quando `require("@/lib/db")` fallisce (vedi `snmp-sysobj-lookup.ts:174-211`) — verificare che il fallback scatti in test; altrimenti nel test importare e usare direttamente la voce builtin.

- [ ] **Step 5: `getAttributionSignalsForHost` in `db-tenant.ts` + facade**

In `src/lib/db-tenant.ts` (zona funzioni host, dopo `upsertHost`):

```ts
export interface AttributionSignals {
  host: {
    id: number; ip: string; mac: string | null; vendor: string | null;
    hostname: string | null; os_info: string | null; open_ports: string | null;
    snmp_data: string | null; detection_json: string | null;
  };
  adComputer: { operating_system: string | null; operating_system_version: string | null } | null;
  wazuh: { os_platform: string | null; os_name: string | null; os_version: string | null; board_vendor: string | null } | null;
  neighborSightings: Array<{ protocol: string; remote_platform: string | null; remote_device_name: string }>;
}

export function getAttributionSignalsForHost(hostId: number): AttributionSignals | null {
  const d = db();
  const host = d.prepare(
    `SELECT id, ip, mac, vendor, hostname, os_info, open_ports, snmp_data, detection_json
     FROM hosts WHERE id = ?`
  ).get(hostId) as AttributionSignals["host"] | undefined;
  if (!host) return null;
  const adComputer = d.prepare(
    `SELECT operating_system, operating_system_version FROM ad_computers
     WHERE host_id = ? ORDER BY synced_at DESC LIMIT 1`
  ).get(hostId) as AttributionSignals["adComputer"] ?? null;
  const wazuh = d.prepare(
    `SELECT wo.os_platform, wo.os_name, wo.os_version, wh.board_vendor
     FROM wazuh_agent wa
     LEFT JOIN wazuh_os wo ON wo.agent_id = wa.agent_id
     LEFT JOIN wazuh_hw wh ON wh.agent_id = wa.agent_id
     WHERE wa.host_id = ? LIMIT 1`
  ).get(hostId) as AttributionSignals["wazuh"] ?? null;
  const neighborSightings = d.prepare(
    `SELECT dn.protocol, dn.remote_platform, dn.remote_device_name
     FROM device_neighbors dn, hosts h
     WHERE h.id = ?
       AND ((dn.remote_mac IS NOT NULL AND dn.remote_mac = h.mac)
         OR (dn.remote_ip IS NOT NULL AND dn.remote_ip = h.ip))
     ORDER BY dn.timestamp DESC LIMIT 5`
  ).all(hostId) as AttributionSignals["neighborSightings"];
  return { host, adComputer, wazuh, neighborSightings };
}
```

In `src/lib/db.ts` la stessa funzione con `const d = getDb();` al posto di `db()` (pattern facade, es. `upsertNeighbors` a `db.ts:4908`). Verificare con `PRAGMA table_info(wazuh_hw)` che la colonna sia `board_vendor` (schema `db-tenant-schema.ts:805-817`); se il nome reale è diverso (es. `vendor`), adeguare la SELECT e l'interfaccia.

- [ ] **Step 6: Type-check e commit**

Run: `npx tsc --noEmit`
Expected: 0 errori.

```bash
git add src/lib/attribution/emitters.ts src/lib/attribution/__tests__/emitters.test.ts src/lib/db-tenant.ts src/lib/db.ts
git commit -m "feat(attribution): emettitori dai segnali gia in DB + query segnali host (fase 1)"
```

---

### Task 6: Persist + orchestratore recompute (`persist.ts`, `recompute.ts`)

**Files:**
- Create: `src/lib/attribution/persist.ts`
- Create: `src/lib/attribution/recompute.ts`
- Test: `src/lib/attribution/__tests__/recompute.test.ts`

**Interfaces:**
- Consumes: `AttributionResult`, `fuseAttribution` (Task 4); `recordEvidence`, `getActiveEvidence` (Task 3); `emitEvidenceFromSignals`, `AttributionSignals` (Task 5); `ATTR_ENGINE_VERSION` (Task 3).
- Produces:

```ts
// persist.ts
export function applyAttribution(dbh: Database.Database, hostId: number, result: AttributionResult, trigger: "scan" | "apply" | "manual" | "backfill"): void
// recompute.ts
export function recomputeHostAttribution(dbh: Database.Database, signals: AttributionSignals, trigger?: "scan" | "apply" | "manual" | "backfill"): AttributionResult
// wrapper con contesto tenant + try/catch, per gli hook nei flussi esistenti:
export function recomputeAttributionSafe(hostId: number, trigger?: "scan" | "apply" | "manual" | "backfill"): AttributionResult | null
```

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/attribution/__tests__/recompute.test.ts
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import Database from "better-sqlite3";
import { TENANT_SCHEMA_SQL, TENANT_INDEXES_SQL } from "@/lib/db-tenant-schema";
import { recomputeHostAttribution } from "../recompute";
import type { AttributionSignals } from "../emitters";

let db: Database.Database;
beforeEach(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(TENANT_SCHEMA_SQL);
  db.exec(TENANT_INDEXES_SQL);
  // le colonne attr_* sono nel CREATE TABLE dello schema? No: vengono da ALTER in getTenantDb.
  // Nei test in-memory le aggiungiamo come farebbe la migrazione:
  for (const c of ["attr_vendor TEXT","attr_vendor_name TEXT","attr_category TEXT","attr_os_family TEXT","attr_os_name TEXT","attr_confidence_vendor INTEGER","attr_confidence_category INTEGER","attr_confidence_os INTEGER","attr_min_phase TEXT","attr_at TEXT","attr_engine_version TEXT"]) {
    try { db.exec(`ALTER TABLE hosts ADD COLUMN ${c}`); } catch { /* già presente */ }
  }
  db.exec("INSERT INTO networks (id, name, cidr) VALUES (1, 'n', '10.0.0.0/24')");
  db.exec("INSERT INTO hosts (id, network_id, ip, vendor, hostname) VALUES (1, 1, '10.0.0.1', 'Ubiquiti Inc', 'ap-piano2')");
});

function signals(): AttributionSignals {
  return {
    host: { id: 1, ip: "10.0.0.1", mac: "24:5a:4c:00:00:01", vendor: "Ubiquiti Inc", hostname: "ap-piano2", os_info: null, open_ports: null, snmp_data: JSON.stringify({ sysDescr: "U6-Pro 6.5.28", sysObjectID: "1.3.6.1.4.1.41112", collected_at: "x" }), detection_json: null },
    adComputer: null, wazuh: null, neighborSightings: [],
  };
}

describe("recomputeHostAttribution", () => {
  it("emette evidenze, fonde e scrive hosts.attr_*", () => {
    const r = recomputeHostAttribution(db, signals(), "scan");
    assert.equal(r.vendor.claim, "ubiquiti");
    assert.equal(r.category.claim, "network.access_point");
    const row = db.prepare("SELECT attr_vendor, attr_category, attr_confidence_category, attr_min_phase, attr_engine_version FROM hosts WHERE id=1").get() as Record<string, unknown>;
    assert.equal(row.attr_vendor, "ubiquiti");
    assert.equal(row.attr_category, "network.access_point");
    assert.ok((row.attr_confidence_category as number) >= 56);
    assert.equal(row.attr_min_phase, "scan_snmp_verify");
    assert.equal(row.attr_engine_version, "2.0.0");
    const hist = db.prepare("SELECT attr_category, trigger FROM host_classification_history WHERE host_id=1 ORDER BY id DESC LIMIT 1").get() as Record<string, unknown>;
    assert.equal(hist.attr_category, "network.access_point");
    assert.equal(hist.trigger, "scan");
  });
  it("è idempotente: secondo run non duplica evidenze né cambia l'esito", () => {
    recomputeHostAttribution(db, signals(), "scan");
    const n1 = (db.prepare("SELECT COUNT(*) n FROM attribution_evidence WHERE superseded_by IS NULL").get() as { n: number }).n;
    const r2 = recomputeHostAttribution(db, signals(), "scan");
    const n2 = (db.prepare("SELECT COUNT(*) n FROM attribution_evidence WHERE superseded_by IS NULL").get() as { n: number }).n;
    assert.equal(n1, n2);
    assert.equal(r2.category.claim, "network.access_point");
  });
  it("progressività: l'arrivo di SNMP non peggiora l'attribuzione da sola fase ICMP", () => {
    const icmpOnly = signals();
    icmpOnly.host.snmp_data = null;
    const r1 = recomputeHostAttribution(db, icmpOnly, "scan");
    const r2 = recomputeHostAttribution(db, signals(), "scan");
    // il claim di r2 deve essere uguale o più profondo di r1, mai contraddirlo salendo di livello
    if (r1.category.claim) {
      assert.ok(r2.category.claim === r1.category.claim || r2.category.claim?.startsWith(r1.category.claim.split(".")[0]));
    }
    assert.ok(r2.category.confidence >= r1.category.confidence);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/lib/attribution/__tests__/recompute.test.ts`
Expected: FAIL (`Cannot find module '../recompute'`)

- [ ] **Step 3: Implementare `persist.ts` e `recompute.ts`**

```ts
// src/lib/attribution/persist.ts
import type Database from "better-sqlite3";
import type { AttributionResult } from "./fuse";

/**
 * Scrive il risultato della fusione su hosts.attr_* e appende alla history estesa.
 * NON tocca classification/inferred_* (parallel-run, fase 1 — il legacy resta fino alla fase 4).
 * Il trigger riusa i valori del CHECK esistente (decisione 8 del piano).
 */
export function applyAttribution(
  dbh: Database.Database,
  hostId: number,
  result: AttributionResult,
  trigger: "scan" | "apply" | "manual" | "backfill"
): void {
  dbh.transaction(() => {
    dbh.prepare(
      `UPDATE hosts SET
         attr_vendor = ?, attr_vendor_name = ?, attr_category = ?,
         attr_os_family = ?, attr_os_name = ?,
         attr_confidence_vendor = ?, attr_confidence_category = ?, attr_confidence_os = ?,
         attr_min_phase = ?, attr_at = datetime('now'), attr_engine_version = ?
       WHERE id = ?`
    ).run(
      result.vendor.claim, result.vendor.vendor_name, result.category.claim,
      result.os.claim, result.os.os_name,
      result.vendor.confidence, result.category.confidence, result.os.confidence,
      result.category.min_phase, result.engine_version, hostId
    );
    dbh.prepare(
      `INSERT INTO host_classification_history
         (host_id, classification, confidence, reason, evidence_json, conflicts_json, attr_vendor, attr_category, attr_os, trigger)
       VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      hostId, result.category.confidence,
      `attribution-v2 ${result.engine_version}`,
      JSON.stringify({ vendor: result.vendor.evidence_ids, category: result.category.evidence_ids, os: result.os.evidence_ids }),
      JSON.stringify(result.category.conflicts),
      result.vendor.claim, result.category.claim, result.os.claim, trigger
    );
  })();
}
```

```ts
// src/lib/attribution/recompute.ts
import type Database from "better-sqlite3";
import { getActiveEvidence, recordEvidence } from "./evidence";
import { emitEvidenceFromSignals } from "./emitters";
import type { AttributionSignals } from "./emitters";
import { fuseAttribution } from "./fuse";
import type { AttributionResult } from "./fuse";
import { applyAttribution } from "./persist";

/**
 * Orchestratore fase 1: emette le evidenze dai segnali già in DB, rifonde
 * l'insieme completo (spec §3: deterministica, non incrementale) e persiste.
 */
export function recomputeHostAttribution(
  dbh: Database.Database,
  signals: AttributionSignals,
  trigger: "scan" | "apply" | "manual" | "backfill" = "apply"
): AttributionResult {
  recordEvidence(dbh, signals.host.id, emitEvidenceFromSignals(signals));
  const result = fuseAttribution(getActiveEvidence(dbh, signals.host.id), new Date().toISOString());
  applyAttribution(dbh, signals.host.id, result, trigger);
  return result;
}

/**
 * Wrapper per gli hook nei flussi esistenti (scan, sync, cron): risolve il
 * contesto tenant corrente e NON propaga mai errori — un difetto del motore
 * di attribuzione non deve rompere scansioni o sync.
 */
export function recomputeAttributionSafe(
  hostId: number,
  trigger: "scan" | "apply" | "manual" | "backfill" = "scan"
): AttributionResult | null {
  try {
    // import dinamici per evitare cicli db-tenant ↔ attribution
    const { getAttributionSignalsForHost, getCurrentTenantCode, getTenantDb } =
      require("@/lib/db-tenant") as typeof import("@/lib/db-tenant");
    const code = getCurrentTenantCode();
    if (!code) return null;
    const signals = getAttributionSignalsForHost(hostId);
    if (!signals) return null;
    return recomputeHostAttribution(getTenantDb(code), signals, trigger);
  } catch (e) {
    console.error(`[attribution] recompute host ${hostId} fallito:`, e);
    return null;
  }
}
```

Nota: se `getCurrentTenantCode`/`getTenantDb` non sono già esportate con questi nomi, verificarle in `db-tenant.ts:62-80` (lo sono). Il `require` dinamico segue il precedente di `snmp-sysobj-lookup.ts:174`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test src/lib/attribution/__tests__/recompute.test.ts`
Expected: PASS (3 test)

- [ ] **Step 5: Commit**

```bash
git add src/lib/attribution/persist.ts src/lib/attribution/recompute.ts src/lib/attribution/__tests__/recompute.test.ts
git commit -m "feat(attribution): persist attr_* + orchestratore recompute (fase 1)"
```

---

### Task 7: Hook nei flussi esistenti (additivi, MAI sostitutivi)

**Files:**
- Modify: `src/lib/scanner/discovery.ts` (~riga 2710, dopo `runClassificationEngineForHost`)
- Modify: `src/lib/integrations/wazuh-sync.ts` (righe ~185 e ~291, accanto a `enrichHostFromWazuh`)
- Modify: `src/lib/ad/ad-client.ts` (fine di `linkComputersToHosts`, ~riga 779)
- Modify: `src/lib/db-tenant.ts` (`relinkAdComputersForNetwork` ~riga 5057) — e specchio in `db.ts` (`relinkAdComputersForNetwork` a `db.ts:6213`)
- Modify: `src/lib/inventory-agent/enrich-host.ts` (dopo l'UPDATE a ~riga 128)
- Modify: `src/lib/cron/jobs.ts` (dopo gli `updateHostIfExists` a righe ~276, ~309, ~614)

**Interfaces:**
- Consumes: `recomputeAttributionSafe(hostId, trigger)` (Task 6); in `enrich-host.ts` anche `recordEvidence` + `getTenantDb`/`getCurrentTenantCode` per l'evidenza `inv_agent`.
- Produces: nessuna nuova interfaccia — solo chiamate. I writer legacy restano INTATTI.

- [ ] **Step 1: Hook post-scan in `discovery.ts`**

Dopo la chiamata a `runClassificationEngineForHost` (righe 2692-2710), aggiungere:

```ts
      // Attribution v2 (fase 1, parallel-run): rifusione evidenze sui dati appena persistiti
      const { recomputeAttributionSafe } = await import("@/lib/attribution/recompute");
      recomputeAttributionSafe(upsertedHost.id, "scan");
```

(usare la variabile host effettivamente disponibile in quel punto — l'host è già stato upsertato a riga ~2640; se il nome è `host` o `savedHost`, adeguare).

- [ ] **Step 2: Hook post-sync Wazuh**

In `src/lib/integrations/wazuh-sync.ts`, dopo ciascuna chiamata a `enrichHostFromWazuh(hostId, hw, os)` (righe ~185 e ~291):

```ts
      const { recomputeAttributionSafe } = await import("@/lib/attribution/recompute");
      recomputeAttributionSafe(hostId, "scan");
```

- [ ] **Step 3: Hook post-sync AD**

In `src/lib/ad/ad-client.ts`, alla fine di `linkComputersToHosts` (riga ~779), per ogni host linkato nel loop (raccogliere gli `hostId` toccati in un array locale `linkedHostIds` e a fine funzione):

```ts
  const { recomputeAttributionSafe } = await import("@/lib/attribution/recompute");
  for (const id of linkedHostIds) recomputeAttributionSafe(id, "scan");
```

In `db-tenant.ts` `relinkAdComputersForNetwork` (e specchio `db.ts`): stessa cosa con `require` sincrono (`const { recomputeAttributionSafe } = require("@/lib/attribution/recompute") as typeof import("@/lib/attribution/recompute");`) perché la funzione non è async.

- [ ] **Step 4: Evidenza `inv_agent` in `enrich-host.ts`**

Dopo l'`UPDATE hosts` (riga ~128), SENZA rimuovere le scritture legacy:

```ts
  // Attribution v2: l'inventario agent è evidenza autoritativa su OS (spec §4.3)
  try {
    const { recordEvidence } = await import("@/lib/attribution/evidence");
    const { recomputeAttributionSafe } = await import("@/lib/attribution/recompute");
    const { getCurrentTenantCode, getTenantDb } = await import("@/lib/db-tenant");
    const code = getCurrentTenantCode();
    if (code) {
      const inputs: import("@/lib/attribution/types").EvidenceInput[] = [];
      if (parsed.os_family && parsed.os_family !== "other") {
        inputs.push({
          source: "inv_agent", phase: "integration", dimension: "os",
          claim: parsed.os_family === "macos" ? "macos" : parsed.os_family,
          confidence: 0.95, raw_value: parsed.os_name ?? null,
        });
      }
      inputs.push({ source: "inv_agent", phase: "integration", dimension: "category", claim: "compute", confidence: 0.6, raw_value: "agent GLPI presente" });
      if (inputs.length > 0) recordEvidence(getTenantDb(code), hostId, inputs);
      recomputeAttributionSafe(hostId, "scan");
    }
  } catch (e) {
    console.error("[attribution] evidenza inv_agent fallita:", e);
  }
```

(`parsed` è il `ParsedGlpiInventory` già in scope; se non espone `os_name`, usare il campo effettivo o omettere `raw_value`.)

- [ ] **Step 5: Hook cron ARP/DHCP**

In `src/lib/cron/jobs.ts`, dopo ciascuno dei tre `updateHostIfExists(...)` (righe ~276, ~309, ~614), quando il risultato non è null:

```ts
            if (host) {
              const { recomputeAttributionSafe } = await import("@/lib/attribution/recompute");
              recomputeAttributionSafe(host.id, "scan");
            }
```

(al call-site ARP di riga ~276 il ritorno di `updateHostIfExists` non è assegnato: assegnarlo a `const host =`.) I bypass legacy (`classifyDevice` → `classification`) restano: si rimuovono in Fase 4.

- [ ] **Step 6: Hook neighbors**

In `src/lib/db-tenant.ts`, in coda a `upsertNeighbors` (righe 3672-3700, dopo la transaction), aggiungere la rifusione degli host visti come remote (copre tutti e 3 i call-site di `upsertNeighbors`):

```ts
  // Attribution v2: i vicini LLDP/CDP appena scritti sono evidenza per gli host remoti
  try {
    const { recomputeAttributionSafe } = require("@/lib/attribution/recompute") as typeof import("@/lib/attribution/recompute");
    const touched = db().prepare(
      `SELECT DISTINCT h.id FROM hosts h
       JOIN device_neighbors dn ON dn.device_id = ?
        AND ((dn.remote_mac IS NOT NULL AND dn.remote_mac = h.mac)
          OR (dn.remote_ip IS NOT NULL AND dn.remote_ip = h.ip))`
    ).all(deviceId) as Array<{ id: number }>;
    for (const t of touched) recomputeAttributionSafe(t.id, "scan");
  } catch (e) {
    console.error("[attribution] recompute da neighbors fallito:", e);
  }
```

Specchiare in `db.ts:4908` (`upsertNeighbors` facade) con `getDb()`.

- [ ] **Step 7: Verifica + commit**

Run: `npm run lint && npx tsc --noEmit && npm test`
Expected: lint ok, 0 errori TS, tutti i test PASS (inclusi i 66 file preesistenti).

```bash
git add src/lib/scanner/discovery.ts src/lib/integrations/wazuh-sync.ts src/lib/ad/ad-client.ts src/lib/inventory-agent/enrich-host.ts src/lib/cron/jobs.ts src/lib/db-tenant.ts src/lib/db.ts
git commit -m "feat(attribution): hook recompute su scan, sync AD/Wazuh, agent, ARP/DHCP, neighbors (fase 1)"
```

---

### Task 8: API — attribuzione, override manuale, recompute bulk

**Files:**
- Create: `src/app/api/hosts/[id]/attribution/route.ts`
- Create: `src/app/api/hosts/[id]/attribution/override/route.ts`
- Create: `src/app/api/attribution/recompute/route.ts`
- Modify: `src/lib/db-tenant.ts` + `src/lib/db.ts` (`getHostIdsByNetwork(networkId): number[]` se non già esistente — verificare prima: potrebbe bastare `getHostsByNetwork`)
- Test: `src/lib/attribution/__tests__/missing-suggestion.test.ts` (per la sola logica pura "cosa manca")

**Interfaces:**
- Consumes: `requireAuth`/`requireAdmin` da `@/lib/api-auth`; `withTenantFromSession` da `@/lib/api-tenant`; `getAttributionSignalsForHost`, `getCurrentTenantCode`, `getTenantDb` da `@/lib/db-tenant`; `getActiveEvidence` (Task 3); `recordEvidence` (Task 3); `recomputeHostAttribution` (Task 6); `fuseAttribution` (Task 4); `PHASE_ORDER`, `phaseIndex` (Task 3); `isValidCategory` (Task 1).
- Produces: `buildMissingSuggestion(result: AttributionResult): string | null` esportata da `src/lib/attribution/missing.ts` (nuovo file, funzione pura).

- [ ] **Step 1: Logica "cosa manca" (`missing.ts`) con test**

```ts
// src/lib/attribution/missing.ts
import type { AttributionResult } from "./fuse";
import { categoryDepth } from "./taxonomy";
import type { CategorySlug } from "./taxonomy";
import { isValidCategory } from "./taxonomy";

/**
 * Suggerisce la prossima fase utile (spec §3: "per migliorare questo host serve SNMP"
 * invece di un vuoto). Regole fase 1:
 * - categoria assente e min_phase < scan_snmp_verify → suggerisci SNMP;
 * - categoria a livello 1 → SNMP (sysObjectID/LLDP distinguono la foglia);
 * - os assente → suggerisci Nmap base o credenziali;
 * - tutto risolto → null.
 */
export function buildMissingSuggestion(result: AttributionResult): string | null {
  const cat = result.category.claim;
  if (cat == null) {
    return "Nessuna categoria attribuibile: esegui la scansione SNMP (sysObjectID) o una fase porte per portare nuove evidenze.";
  }
  if (isValidCategory(cat) && categoryDepth(cat as CategorySlug) === 1) {
    return `Categoria ferma al livello 1 (${cat}): esegui SNMP per distinguere il tipo esatto (es. AP vs switch).`;
  }
  if (result.os.claim == null) {
    return "OS non attribuito: esegui Nmap base o valida credenziali SSH/WinRM.";
  }
  return null;
}
```

```ts
// src/lib/attribution/__tests__/missing-suggestion.test.ts
import { describe, it } from "node:test";
import assert from "node:assert";
import { buildMissingSuggestion } from "../missing";
import type { AttributionResult } from "../fuse";

function res(category: string | null, os: string | null): AttributionResult {
  const dim = { confidence: 0, min_phase: null, evidence_ids: [], conflicts: [], authoritative: false };
  return {
    vendor: { ...dim, claim: "ubiquiti", vendor_name: null },
    category: { ...dim, claim: category },
    os: { ...dim, claim: os, os_name: null },
    engine_version: "2.0.0",
  };
}

describe("buildMissingSuggestion", () => {
  it("categoria assente → suggerisce SNMP", () => {
    assert.match(buildMissingSuggestion(res(null, null)) ?? "", /SNMP/);
  });
  it("livello 1 → suggerisce SNMP per la foglia", () => {
    assert.match(buildMissingSuggestion(res("network", "linux")) ?? "", /livello 1/);
  });
  it("categoria ok ma os assente → suggerisce nmap/credenziali", () => {
    assert.match(buildMissingSuggestion(res("network.switch", null)) ?? "", /OS non attribuito/);
  });
  it("tutto risolto → null", () => {
    assert.equal(buildMissingSuggestion(res("network.switch", "network-os")), null);
  });
});
```

Run: `node --import tsx --test src/lib/attribution/__tests__/missing-suggestion.test.ts` → prima FAIL, poi PASS dopo l'implementazione.

- [ ] **Step 2: GET `/api/hosts/[id]/attribution`**

```ts
// src/app/api/hosts/[id]/attribution/route.ts
import { requireAuth } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getAttributionSignalsForHost, getCurrentTenantCode, getTenantDb } from "@/lib/db-tenant";
import { getActiveEvidence } from "@/lib/attribution/evidence";
import { fuseAttribution } from "@/lib/attribution/fuse";
import { buildMissingSuggestion } from "@/lib/attribution/missing";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireAuth();
  return withTenantFromSession(async () => {
    const { id } = await params;
    const hostId = Number(id);
    if (!Number.isInteger(hostId) || hostId <= 0) {
      return Response.json({ error: "id host non valido" }, { status: 400 });
    }
    const code = getCurrentTenantCode();
    if (!code) return Response.json({ error: "contesto tenant assente" }, { status: 500 });
    const signals = getAttributionSignalsForHost(hostId);
    if (!signals) return Response.json({ error: "host non trovato" }, { status: 404 });
    const dbh = getTenantDb(code);
    const evidence = getActiveEvidence(dbh, hostId);
    const result = fuseAttribution(evidence, new Date().toISOString());
    return Response.json({
      attribution: result,
      evidence,
      missing: buildMissingSuggestion(result),
    });
  });
}
```

- [ ] **Step 3: POST `/api/hosts/[id]/attribution/override`**

```ts
// src/app/api/hosts/[id]/attribution/override/route.ts
import { z } from "zod";
import { requireAdmin } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getAttributionSignalsForHost, getCurrentTenantCode, getTenantDb } from "@/lib/db-tenant";
import { recordEvidence } from "@/lib/attribution/evidence";
import { recomputeHostAttribution } from "@/lib/attribution/recompute";
import { isValidCategory } from "@/lib/attribution/taxonomy";
import type { EvidenceInput } from "@/lib/attribution/types";

const OverrideSchema = z.object({
  vendor: z.string().min(1).optional(),
  category: z.string().min(1).optional(),
  os_family: z.enum(["windows", "linux", "macos", "network-os"]).optional(),
  os_name: z.string().optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  return withTenantFromSession(async () => {
    const { id } = await params;
    const hostId = Number(id);
    if (!Number.isInteger(hostId) || hostId <= 0) {
      return Response.json({ error: "id host non valido" }, { status: 400 });
    }
    const body = await request.json().catch(() => null);
    const parsed = OverrideSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json({ error: parsed.error.issues }, { status: 400 });
    }
    const { vendor, category, os_family, os_name } = parsed.data;
    if (!vendor && !category && !os_family) {
      return Response.json({ error: "indicare almeno una dimensione da correggere" }, { status: 400 });
    }
    if (category && !isValidCategory(category)) {
      return Response.json({ error: `categoria non valida: ${category}` }, { status: 400 });
    }
    const code = getCurrentTenantCode();
    if (!code) return Response.json({ error: "contesto tenant assente" }, { status: 500 });
    const signals = getAttributionSignalsForHost(hostId);
    if (!signals) return Response.json({ error: "host non trovato" }, { status: 404 });

    const inputs: EvidenceInput[] = [];
    if (vendor) inputs.push({ source: "manual", phase: "manual", dimension: "vendor", claim: vendor, confidence: 1, raw_value: vendor });
    if (category) inputs.push({ source: "manual", phase: "manual", dimension: "category", claim: category, confidence: 1 });
    if (os_family) inputs.push({ source: "manual", phase: "manual", dimension: "os", claim: os_family, confidence: 1, raw_value: os_name ?? null });

    const dbh = getTenantDb(code);
    recordEvidence(dbh, hostId, inputs);
    const result = recomputeHostAttribution(dbh, signals, "manual");
    return Response.json({ success: true, attribution: result });
  });
}
```

- [ ] **Step 4: POST `/api/attribution/recompute`**

```ts
// src/app/api/attribution/recompute/route.ts
import { z } from "zod";
import { requireAdmin } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getAttributionSignalsForHost, getCurrentTenantCode, getTenantDb, getHostsByNetwork } from "@/lib/db-tenant";
import { recomputeHostAttribution } from "@/lib/attribution/recompute";

const RecomputeSchema = z.object({
  network_id: z.number().int().positive().optional(),
  host_ids: z.array(z.number().int().positive()).optional(),
});

export async function POST(request: Request) {
  await requireAdmin();
  return withTenantFromSession(async () => {
    const body = await request.json().catch(() => null);
    const parsed = RecomputeSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json({ error: parsed.error.issues }, { status: 400 });
    }
    const { network_id, host_ids } = parsed.data;
    if (!network_id && (!host_ids || host_ids.length === 0)) {
      return Response.json({ error: "indicare network_id o host_ids" }, { status: 400 });
    }
    const code = getCurrentTenantCode();
    if (!code) return Response.json({ error: "contesto tenant assente" }, { status: 500 });
    const dbh = getTenantDb(code);
    const ids: number[] = host_ids ?? getHostsByNetwork(network_id!).map((h: { id: number }) => h.id);
    let done = 0;
    for (const hostId of ids) {
      const signals = getAttributionSignalsForHost(hostId);
      if (!signals) continue;
      recomputeHostAttribution(dbh, signals, "apply");
      done += 1;
    }
    return Response.json({ success: true, hosts: ids.length, recomputed: done, message: `Attribuzione ricalcolata su ${done} host` });
  });
}
```

Verificare la firma reale di `getHostsByNetwork` in `db-tenant.ts` (esiste — è usata da `refresh/route.ts`); se il tipo di ritorno non espone `id` tipizzato, mappare con un tipo locale.

- [ ] **Step 5: Verifica + commit**

Run: `npm run lint && npx tsc --noEmit && node --import tsx --test src/lib/attribution/__tests__/missing-suggestion.test.ts`
Expected: tutto PASS.

```bash
git add src/lib/attribution/missing.ts src/lib/attribution/__tests__/missing-suggestion.test.ts src/app/api/hosts/[id]/attribution src/app/api/attribution
git commit -m "feat(attribution): API attribuzione host, override manuale e recompute bulk (fase 1)"
```

---

### Task 9: Golden set + test di progressività

**Files:**
- Create: `scripts/attribution-golden-export.ts`
- Create: `src/lib/attribution/__tests__/golden/README.md`
- Create: `src/lib/attribution/__tests__/golden.test.ts`
- Fixture (generate a mano, commit separato): `src/lib/attribution/__tests__/golden/hosts.json`, `expected.json`

**Interfaces:**
- Consumes: `emitEvidenceFromSignals`, `AttributionSignals` (Task 5); `fuseAttribution` (Task 4); `recordEvidence`/`getActiveEvidence` (Task 3); `PHASE_ORDER`, `phaseIndex` (Task 3); `categoryParent` (Task 1).
- Produces: formato fixture: `hosts.json` = `AttributionSignals[]`; `expected.json` = `Array<{ ip: string; category: string | null; vendor: string | null; os: string | null }>` (attribuzione attesa verificata a mano, spec §8).

- [ ] **Step 1: Script di export**

```ts
// scripts/attribution-golden-export.ts
// Estrae AttributionSignals da una COPIA locale del DB tenant (mai da produzione live).
// Uso: npx tsx scripts/attribution-golden-export.ts data/tenants/70791.db > src/lib/attribution/__tests__/golden/hosts.json
// Poi curare a mano expected.json con l'attribuzione attesa per ciascun IP (~50 host, spec §8).
import Database from "better-sqlite3";

const dbPath = process.argv[2];
if (!dbPath) {
  console.error("Uso: npx tsx scripts/attribution-golden-export.ts <path-db-tenant> [limit]");
  process.exit(1);
}
const limit = Number(process.argv[3] ?? 50);
const db = new Database(dbPath, { readonly: true });

const hosts = db.prepare(
  `SELECT id, ip, mac, vendor, hostname, os_info, open_ports, snmp_data, detection_json
   FROM hosts
   ORDER BY (snmp_data IS NOT NULL) DESC, (os_info IS NOT NULL) DESC, id
   LIMIT ?`
).all(limit) as Array<Record<string, unknown> & { id: number; ip: string; mac: string | null }>;

const out = hosts.map((h) => {
  const adComputer = db.prepare(
    "SELECT operating_system, operating_system_version FROM ad_computers WHERE host_id = ? LIMIT 1"
  ).get(h.id) ?? null;
  const wazuh = db.prepare(
    `SELECT wo.os_platform, wo.os_name, wo.os_version, wh.board_vendor
     FROM wazuh_agent wa
     LEFT JOIN wazuh_os wo ON wo.agent_id = wa.agent_id
     LEFT JOIN wazuh_hw wh ON wh.agent_id = wa.agent_id
     WHERE wa.host_id = ? LIMIT 1`
  ).get(h.id) ?? null;
  const neighborSightings = db.prepare(
    `SELECT protocol, remote_platform, remote_device_name FROM device_neighbors
     WHERE (remote_mac IS NOT NULL AND remote_mac = ?) OR (remote_ip IS NOT NULL AND remote_ip = ?)
     LIMIT 5`
  ).all(h.mac, h.ip);
  const { id: _id, ...hostFields } = h;
  return { host: { id: h.id, ...hostFields }, adComputer, wazuh, neighborSightings };
});

console.log(JSON.stringify(out, null, 2));
```

ATTENZIONE privacy: il file esportato contiene IP e hostname del tenant reale. Prima del commit valutare con l'utente se anonimizzare (gli IP possono essere rimappati su 10.x.x.x mantenendo l'unicità); in ogni caso NIENTE credenziali dentro `snmp_data` → lo script DEVE rimuovere la chiave `community` dal JSON `snmp_data` prima dell'output (aggiungere un passaggio di sanitizzazione: parse, `delete obj.community`, re-stringify).

- [ ] **Step 2: Test golden + progressività**

```ts
// src/lib/attribution/__tests__/golden.test.ts
import { describe, it } from "node:test";
import assert from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { emitEvidenceFromSignals } from "../emitters";
import type { AttributionSignals } from "../emitters";
import { fuseAttribution } from "../fuse";
import { phaseIndex } from "../types";
import { ATTR_SOURCE_WEIGHTS } from "../weights";
import type { AttributionEvidenceRow, EvidenceInput } from "../types";
import { categoryParent } from "../taxonomy";
import type { CategorySlug } from "../taxonomy";
import { isValidCategory } from "../taxonomy";

const DIR = join(__dirname, "golden");
const NOW = new Date().toISOString();

function toRows(inputs: EvidenceInput[]): AttributionEvidenceRow[] {
  return inputs.map((e, i) => ({
    id: i + 1, host_id: 0, source: e.source, phase: e.phase, dimension: e.dimension,
    claim: e.claim, confidence: e.confidence,
    weight: e.weight ?? ATTR_SOURCE_WEIGHTS[e.source],
    raw_value: e.raw_value ?? null, observed_at: NOW, expires_at: e.expires_at ?? null,
    superseded_by: null,
  }));
}

describe("golden set (spec §8)", { skip: !existsSync(join(DIR, "expected.json")) }, () => {
  const hosts = JSON.parse(readFileSync(join(DIR, "hosts.json"), "utf8")) as AttributionSignals[];
  const expected = JSON.parse(readFileSync(join(DIR, "expected.json"), "utf8")) as Array<{ ip: string; category: string | null; vendor: string | null; os: string | null }>;

  it("nessun host golden peggiora", () => {
    let correctL2 = 0, withExpectedL2 = 0;
    for (const exp of expected) {
      const signals = hosts.find((h) => h.host.ip === exp.ip);
      assert.ok(signals, `host golden mancante in hosts.json: ${exp.ip}`);
      const r = fuseAttribution(toRows(emitEvidenceFromSignals(signals)), NOW);
      if (exp.vendor) assert.equal(r.vendor.claim, exp.vendor, `${exp.ip}: vendor`);
      if (exp.os) assert.equal(r.os.claim, exp.os, `${exp.ip}: os`);
      if (exp.category && exp.category.includes(".")) {
        withExpectedL2 += 1;
        if (r.category.claim === exp.category) correctL2 += 1;
        else {
          // tollerato SOLO il ripiego al livello 1 corretto, mai una famiglia diversa
          assert.equal(r.category.claim, categoryParent(exp.category as CategorySlug), `${exp.ip}: categoria`);
        }
      }
    }
    // metrica di accettazione spec §8: livello 2 corretto ≥ 85% sul golden set
    if (withExpectedL2 > 0) {
      assert.ok(correctL2 / withExpectedL2 >= 0.85, `livello 2 corretto ${correctL2}/${withExpectedL2} < 85%`);
    }
  });

  it("progressività: la fusione dopo la fase N non contraddice la fase N+1", () => {
    for (const signals of hosts) {
      const all = toRows(emitEvidenceFromSignals(signals));
      let prevClaim: string | null = null;
      for (let p = 0; p < 7; p++) {
        const upTo = all.filter((e) => phaseIndex(e.phase) <= p);
        const r = fuseAttribution(upTo, NOW);
        const claim = r.category.claim;
        if (prevClaim && claim && isValidCategory(prevClaim) && isValidCategory(claim)) {
          assert.ok(
            claim === prevClaim ||
              categoryParent(claim as CategorySlug) === categoryParent(prevClaim as CategorySlug),
            `${signals.host.ip}: fase ${p} contraddice la precedente (${prevClaim} → ${claim})`
          );
        }
        if (claim) prevClaim = claim;
      }
    }
  });
});
```

Nota: `{ skip: ... }` fa sì che il test sia verde ma marcato skipped finché le fixture non esistono — la suite CI non si rompe prima della cattura del golden set.

- [ ] **Step 3: README per la procedura**

```markdown
<!-- src/lib/attribution/__tests__/golden/README.md -->
# Golden set attribuzione (spec §8)

1. Scaricare una copia del DB tenant: `npm run pull:db` (o copiare `/var/tmp/70791.pre-attrv2.db`).
2. `npx tsx scripts/attribution-golden-export.ts data/tenants/70791.db > src/lib/attribution/__tests__/golden/hosts.json`
3. Creare `expected.json` verificando A MANO l'attribuzione attesa di ogni host:
   `[{ "ip": "192.168.1.10", "category": "network.access_point", "vendor": "ubiquiti", "os": null }, ...]`
   (`category` livello 2 dove certo, livello 1 dove il segnale non basta, null dove ignoto).
4. Il test `golden.test.ts` fallisce se una release peggiora un host già corretto.
```

- [ ] **Step 4: Verifica + commit**

Run: `node --import tsx --test src/lib/attribution/__tests__/golden.test.ts`
Expected: PASS (skipped finché mancano le fixture).

```bash
git add scripts/attribution-golden-export.ts src/lib/attribution/__tests__/golden.test.ts src/lib/attribution/__tests__/golden/README.md
git commit -m "test(attribution): harness golden set + progressivita (fase 1)"
```

---

### Task 10: Verifica finale, release e misura

- [ ] **Step 1: Suite completa**

Run: `npm test`
Expected: tutti i PASS (nuovi test attribution + 66 file preesistenti; golden skipped se fixture non ancora catturate).

- [ ] **Step 2: Verifica obbligatoria post-modifica (CLAUDE.md)**

Run: `npm run lint && npx tsc --noEmit && npm run build`
Expected: 0 errori. Se `npm run build` fallisce su Node ≥25: `nvm use 22`.

- [ ] **Step 3: Release**

```bash
cd /Users/riccardo/Progetti/Domarc/DA-IPAM   # cwd-trap: mai release da un altro repo
npm run version:release                       # → v0.3.204+
git push origin dev                           # MAI main (promote solo via UI)
```

- [ ] **Step 4: Misura post-deploy (manuale, dopo promote+deploy su tenant 70791)**

Query di accettazione (spec §8, sqlite3 read-only sul DB tenant in produzione):

```sql
-- categoria valorizzata: target ≥ 90% (baseline 52,5%)
SELECT ROUND(100.0 * SUM(attr_category IS NOT NULL AND attr_category != 'unknown') / COUNT(*), 1) AS pct_categoria FROM hosts;
-- host a confidence 0: target < 20 (baseline 145)
SELECT COUNT(*) FROM hosts WHERE COALESCE(attr_confidence_category, 0) = 0;
-- zero slug non validi (tutti gli attr_category devono essere nella tassonomia v2)
SELECT DISTINCT attr_category FROM hosts WHERE attr_category IS NOT NULL;
-- bootstrap evidenze: POST /api/attribution/recompute per ogni network del tenant
```

Nota: al primo deploy le evidenze non esistono ancora — serve un giro di `POST /api/attribution/recompute` per network (o attendere il prossimo scan/sync) prima di misurare.

---

## Fuori scope (fasi successive — NON farle in questo piano)

- **KB SQLite vendorizzata + `mac_product_map` + UI tab Identificazione** → Fase 2.
- **Probe nuovi** (HTTP/TLS esteso, mDNS, SSDP, WSD, SMB2) → Fase 3.
- **Redesign UI subnet** (§6: `Scansione iniziale` unica, fasi con stato, `Ricalcola attribuzione` con anteprima, rimozione dei 4 pulsanti combo del pannello Classificazione) → **Fase 3b**; dipende da questo piano (la fusione pura è ciò che rende l'attribuzione ricalcolabile senza scansione).
- **Ritiro sistema B (`auto-classify`), viste di compatibilità, rimozione bypass legacy** → Fase 4.
- **Credenziali** (catena unica, `resolveCredentialFor`, anti-lockout) → Fase 1b (piano separato).
- Capability bits LLDP nei collector → insieme alla Fase 3 (tocca i collector).




