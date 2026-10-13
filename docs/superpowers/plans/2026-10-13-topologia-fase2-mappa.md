# Topologia fase 2 «la mappa» — piano di attuazione

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** sostituire la mappa di oggi con «Tutto automatico» + mappe «passo passo» con un nome, un nodo per oggetto fisico, attaccati e client dalla tabella dei MAC per porta (letta da SNMP/SSH e dai client UniFi).

**Architecture:** tre tappe. **A** (livello completo) raccoglie: migrazione additiva (`mac_port_entries` che invecchia, tabella `topology_maps`), SNMP/SSH salvano l'elenco dei MAC per porta, nuova lettura in sola lettura dei client UniFi. **B** (leggero) è logica pura in `src/lib/topology/`: identità, attaccati, albero, disposizione. **C** (leggero) è la pagina `/topology` nuova con React Flow, che usa le funzioni pure di B nel browser e salva mappe e ritocchi con rotte nuove.

**Tech Stack:** Next.js 16 / React 19 / TypeScript strict, better-sqlite3 (WAL), `node --import tsx --test`, Zod v4, shadcn v4 su `@base-ui/react`, `@xyflow/react` (React Flow, resta; `dagre` si toglie).

**Spec:** `docs/superpowers/specs/2026-10-12-topology-map-design.md` — §10 (fase 2 progettata il 13/10), più §3-§5 e §7 per il resto. ADR di riferimento: 0008 (punti 4 e 11), 0005, 0007.

## Global Constraints

- Repo **pubblico**: niente nomi, IP, MAC, seriali o utenze dei clienti in codice, prove, fixture, commit o documenti. Le prove usano dati inventati con la **forma** vera; le fixture passano da `anonimizzaInput` e dalla prova `fixture-anonime.test.ts`.
- `db-tenant` si importa **solo staticamente** (ADR 0002, `no-dynamic-db-tenant-import.test.ts`). Eccezione già dichiarata: gli script in `scripts/` fuori dall'app.
- Ogni rotta: `withTenantFromSession` + `requireAuth()` (letture) / `requireAdmin()` (scritture), come prima istruzione. Corpi validati con Zod, messaggi in italiano.
- Migrazioni **additive e idempotenti**, in transazione, **in fondo a `getTenantDb` dopo `migrateTopologyPhase1`** (ADR 0008 punto 6). Mai DROP/ALTER ad-hoc su tabelle con FK.
- Date del DB lette con `parseDbDate`; caricamenti client con `fetchJson` + `LoadError` (`.claude/rules/client-components.md`): un errore non diventa «lista vuota».
- `db.ts` e `db-tenant.ts` divergono: ogni funzione toccata si cambia **in tutti e due**, oppure il chiamante importa da `db-tenant` (regola 12 del CLAUDE.md del repo).
- MAC virtuali (VRRP `00:00:5E:00:01:xx`/`00:00:5E:00:02:xx`, HSRP `00:00:0C:07:AC:xx`) **non identificano nessuno**.
- Interfaccia: testi in italiano, pavimento tipografico 13 px, **mai il solo colore** (forma + simbolo + testo: Riccardo è daltonico), palette Domarc dai token, schermo di riferimento **1920 px**, verifiche a 1280 e 1920 (pagina da scrivania).
- Segreti: mai nel trascritto né in un argomento; a uno script solo come **prima riga di stdin** da un filtro del vault che **fallisce chiuso**, provato prima con un valore finto. Dentro ssh `pgrep -x`, mai `pgrep -f`; lavori lunghi sul server con `setsid nohup` + registro.
- Al massimo **2 agenti che compilano insieme**, ciascuno nel suo worktree.
- **Ogni push su `dev` arriva al server del cliente A da solo** (aggiornamento automatico): il push di `dev` è una scrittura sui dati di un cliente e passa dal Task 14 (numeri sulla copia + conferma di Riccardo). I rami di lavoro si pushano liberamente.
- Orari a Riccardo in ora italiana. Log del cancello nello scratchpad della sessione (`$S`), mai con nome fisso in `/tmp`; esito letto da `exit=`.

## Review Focus

1. **Un apparato con decine di MAC su una porta di bordo** (switch non gestito sotto): i client sono contati su quella porta, non su un uplink, e il numero non esplode sugli switch a monte → prova nel Task 7.
2. **Un host col MAC virtuale VRRP e nessun nome**: non si fonde con nessun router, resta un nodo «da promuovere» solo se ha un nome o un MAC vero; altrimenti finisce come indirizzo virtuale del router che lo annuncia via MNDP/LLDP → prova nel Task 6.
3. **Una mappa passo passo con un oggetto che non esiste più** (apparato cancellato): la mappa si apre, l'oggetto mancante è elencato «non più presente», niente pagina rotta → prova nel Task 10 (lettura) e Task 12 (pagina).
4. **Due persone che modificano la stessa mappa**: l'ultima scrittura vince per ciascun oggetto (aggiungi/togli sono idempotenti, non si riscrive l'intero elenco) → prova nel Task 10.
5. **Il job dei client UniFi fuori orario o col controller irraggiungibile**: fuori dalle 7-20 (ora italiana) non chiama il controller e lo dice nel log; un errore di trasporto è «non so», non «zero client», e non tocca le righe esistenti → prova nel Task 4.

---

## Struttura dei file

**Tappa A — raccolta (ramo `topologia/f2-raccolta`, worktree `.claude/worktrees/topologia-f2a`)**
- Modify `src/lib/db-tenant.ts`: `migrateTopologyPhase2` (nuova, accanto a `migrateTopologyPhase1`), `upsertMacPortEntries` (invecchia), `cleanupOldMacPortEntries` (giorni), `getMacPortEntriesByDevice` (ultimo giro), `setControllerSchedule`/`listControllerScheduleJobs` (solo apparati), `setControllerClientSchedule` (nuova), `getTopologyModelInput` (+`macPorts`).
- Modify `src/lib/db.ts`: le stesse funzioni MAC per porta delegano alla semantica di `db-tenant`.
- Create `src/lib/devices/mac-port-list.ts`: elenco per porta dall'elenco SNMP/SSH (logica pura).
- Modify `src/lib/cron/jobs.ts`: salvataggio dell'elenco; job `unifi_sync` con `config.cosa = "client"`; pulizia a 30 giorni.
- Create `src/lib/integrations/unifi-clients.ts`: parser di `stat/sta` e mappatura client → (apparato, porta) (logica pura).
- Modify `src/lib/integrations/unifi-api.ts`: `stat/sta` in lista bianca, `listClients()`.
- Create `src/lib/integrations/unifi-clients-sync.ts`: lettura dei client per un controller.
- Modify `src/lib/controllers/service.ts`, `src/app/api/controllers/[id]/route.ts`, `src/app/(dashboard)/controllers/page.tsx`: interruttore «Leggi i client ogni ora (7-20)».
- Create `scripts/misura-mac-porta.ts`.

**Tappa B — motore (ramo `topologia/f2-mappa`, worktree `.claude/worktrees/topologia-f2b`, nato dal commit del Task 1)**
- Modify `src/lib/topology/model-types.ts`, `node-index.ts`, `model.ts`, `anonimizza.ts`, `scripts/estrai-fixture-topologia.ts`.
- Create `src/lib/topology/identity.ts`, `attach.ts`, `tree.ts`, `tree-layout.ts`.

**Tappa C — pagina (stesso ramo di B)**
- Modify `src/lib/db-tenant.ts` (funzioni delle mappe), `src/lib/topology/api-input.ts`, `src/app/api/topology/model/route.ts`, `src/app/api/topology/positions/route.ts`.
- Create `src/app/api/topology/maps/route.ts`, `maps/[id]/route.ts`, `maps/[id]/nodes/route.ts`, `src/app/api/topology/nodes/hidden/route.ts`, `src/lib/topology/status-map.ts`.
- Create `src/components/topology/map/` (`topology-map-client.tsx`, `object-list.tsx`, `map-canvas.tsx`, `map-node.tsx`, `linked-panel.tsx`, `map-toolbar.tsx`, `topology-icons.tsx`, `use-topology-data.ts`).
- Modify `src/app/(dashboard)/topology/page.tsx`; delete `topology-client.tsx`, `status-node.tsx`, `src/lib/topology/layout.ts`, il GET di `src/app/api/topology/route.ts`; `dagre` fuori da `package.json`.

**Ordine:** Task 1 (A) per primo → push del ramo A → ramo B nasce da lì. Poi **due agenti in parallelo**: A (Task 2-5) e B (Task 6-9). C (Task 10-12) dopo B. Task 13 (fixture) dopo A e B. Task 14 (live) e Task 15 (documenti) alla fine, nella sessione principale.

---

## Tappa A — raccolta (livello completo)

### Task 1: Migrazione della fase 2

**Files:**
- Modify: `src/lib/db-tenant.ts` (accanto a `migrateTopologyPhase1`, ~riga 187; chiamata dopo quella a ~riga 1464)
- Test: `src/lib/__tests__/topology-phase2-migration.test.ts`

**Interfaces:**
- Produces: `migrateTopologyPhase2(db: Database.Database): string[]` (elenco di ciò che ha aggiunto); colonne `mac_port_entries.first_seen TEXT`, `mac_port_entries.source TEXT NOT NULL DEFAULT 'device'`; indice unico `idx_mac_port_entries_key (device_id, mac, port_name)`; tabella `topology_maps`.

- [ ] **Step 1: la prova che fallisce** — sul modello di `topology-phase1-migration.test.ts` (DB in memoria con lo schema vecchio di `mac_port_entries`, senza le colonne nuove):

```ts
// src/lib/__tests__/topology-phase2-migration.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { migrateTopologyPhase2 } from "@/lib/db-tenant";

function vecchio(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE network_devices (id INTEGER PRIMARY KEY);
    CREATE TABLE mac_port_entries (id INTEGER PRIMARY KEY AUTOINCREMENT, device_id INTEGER NOT NULL REFERENCES network_devices(id) ON DELETE CASCADE,
      mac TEXT NOT NULL, port_name TEXT NOT NULL, vlan INTEGER, port_status TEXT CHECK(port_status IN ('up','down')), speed TEXT, timestamp TEXT DEFAULT (datetime('now')));
    CREATE TABLE topology_position (id INTEGER PRIMARY KEY AUTOINCREMENT, view TEXT NOT NULL DEFAULT 'default', node_id TEXT NOT NULL, x REAL NOT NULL, y REAL NOT NULL,
      pinned INTEGER NOT NULL DEFAULT 1, structure_sig TEXT, updated_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(view, node_id));
    INSERT INTO network_devices (id) VALUES (1);`);
  return db;
}

test("aggiunge colonne, indice unico e topology_maps; la seconda volta non fa niente", () => {
  const db = vecchio();
  const prima = migrateTopologyPhase2(db);
  assert.deepEqual(prima.sort(), ["mac_port_entries.first_seen", "mac_port_entries.source", "topology_maps"].sort());
  assert.deepEqual(migrateTopologyPhase2(db), []);
  const idx = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'idx_mac_port_entries_key'").get() as { sql: string };
  assert.match(idx.sql, /UNIQUE/);
  db.prepare("INSERT INTO topology_maps (name, kind) VALUES ('Prova', 'passo')").run();
  assert.throws(() => db.prepare("INSERT INTO topology_maps (name, kind) VALUES ('X', 'altro')").run());
});

test("i doppi esistenti si riducono alla riga più recente prima dell'indice unico", () => {
  const db = vecchio();
  const ins = db.prepare("INSERT INTO mac_port_entries (device_id, mac, port_name, timestamp) VALUES (1, 'AA:BB:CC:00:00:01', 'Port 3', ?)");
  ins.run("2026-10-01 10:00:00"); ins.run("2026-10-02 10:00:00"); ins.run("2026-10-01 09:00:00");
  migrateTopologyPhase2(db);
  const righe = db.prepare("SELECT timestamp, first_seen, source FROM mac_port_entries").all();
  assert.deepEqual(righe, [{ timestamp: "2026-10-02 10:00:00", first_seen: "2026-10-01 09:00:00", source: "device" }]);
});

test("una sola mappa automatica per tenant", () => {
  const db = vecchio();
  migrateTopologyPhase2(db);
  db.prepare("INSERT INTO topology_maps (name, kind) VALUES ('Tutta la rete', 'auto')").run();
  assert.throws(() => db.prepare("INSERT INTO topology_maps (name, kind) VALUES ('Altra', 'auto')").run());
});
```

- [ ] **Step 2: eseguirla e vederla fallire**

Run: `DA_INVENT_DATA_DIR=$(mktemp -d "${TMPDIR:-/tmp}/f2.XXXXXX") node --import tsx --test src/lib/__tests__/topology-phase2-migration.test.ts`
Expected: FAIL, `migrateTopologyPhase2` non esportata.

- [ ] **Step 3: la migrazione**

```ts
/**
 * Migrazione runtime «topologia fase 2» (spec §10.5-10.6, piano
 * 2026-10-13-topologia-fase2-mappa). La tabella dei MAC per porta invecchia
 * invece di essere riscritta a ogni lettura: serve una riga per (apparato, MAC,
 * porta), quindi prima si tolgono i doppi (si tiene la più recente, con la prima
 * volta vista più vecchia) e poi l'indice unico. Più la tabella delle mappe.
 * Tutto in una transazione. Esportata per le prove.
 */
export function migrateTopologyPhase2(db: Database.Database): string[] {
  const added: string[] = [];
  const has = (table: string, col: string): boolean =>
    (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some((c) => c.name === col);
  const exists = (name: string): boolean => !!db.prepare("SELECT 1 FROM sqlite_master WHERE name = ?").get(name);
  db.transaction(() => {
    if (!has("mac_port_entries", "first_seen")) {
      db.exec("ALTER TABLE mac_port_entries ADD COLUMN first_seen TEXT");
      added.push("mac_port_entries.first_seen");
    }
    if (!has("mac_port_entries", "source")) {
      db.exec("ALTER TABLE mac_port_entries ADD COLUMN source TEXT NOT NULL DEFAULT 'device'");
      added.push("mac_port_entries.source");
    }
    if (!exists("idx_mac_port_entries_key")) {
      db.exec(`UPDATE mac_port_entries SET first_seen = (
                 SELECT MIN(COALESCE(m2.first_seen, m2.timestamp)) FROM mac_port_entries m2
                  WHERE m2.device_id = mac_port_entries.device_id AND m2.mac = mac_port_entries.mac AND m2.port_name = mac_port_entries.port_name)
               WHERE first_seen IS NULL`);
      db.exec(`DELETE FROM mac_port_entries WHERE id NOT IN (
                 SELECT id FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY device_id, mac, port_name ORDER BY timestamp DESC, id DESC) AS rn
                                   FROM mac_port_entries) WHERE rn = 1)`);
      db.exec("CREATE UNIQUE INDEX idx_mac_port_entries_key ON mac_port_entries(device_id, mac, port_name)");
      db.exec("CREATE INDEX IF NOT EXISTS idx_mac_port_entries_mac ON mac_port_entries(mac)");
    }
    if (!exists("topology_maps")) {
      db.exec(`CREATE TABLE topology_maps (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        kind TEXT NOT NULL CHECK(kind IN ('auto', 'passo')),
        roots TEXT NOT NULL DEFAULT '[]',
        head_node TEXT,
        created_by TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`);
      db.exec("CREATE UNIQUE INDEX idx_topology_maps_auto ON topology_maps(kind) WHERE kind = 'auto'");
      added.push("topology_maps");
    }
  })();
  return added;
}
```

Chiamata in `getTenantDb`, subito dopo il blocco che chiama `migrateTopologyPhase1(newDb)`, con la stessa forma (try/catch, `console.info` delle cose aggiunte con il codice tenant, `console.error` se fallisce: ADR 0008 punto 10 vale anche qui).

- [ ] **Step 4: la prova passa** — stesso comando, Expected: PASS (3 prove).

- [ ] **Step 5: commit e push del ramo** (il ramo B nasce da qui)

```bash
git add src/lib/db-tenant.ts src/lib/__tests__/topology-phase2-migration.test.ts
git commit -m "feat(topologia): migrazione fase 2 — MAC per porta che invecchiano, tabella delle mappe"
git push -u origin topologia/f2-raccolta
```

---

### Task 2: La tabella dei MAC per porta invecchia, e SNMP/SSH la riempiono

**Files:**
- Create: `src/lib/devices/mac-port-list.ts`
- Modify: `src/lib/db-tenant.ts:4593-4640` (`upsertMacPortEntries`, `cleanupOldMacPortEntries`, `getMacPortEntriesByDevice`), `src/lib/db.ts:5465-5495` (stesse funzioni), `src/lib/cron/jobs.ts` (ramo `getPortSchema` ~riga 660-735, ramo `getMacTable` ~riga 762, pulizia ~riga 1113)
- Test: `src/lib/devices/__tests__/mac-port-list.test.ts`, `src/lib/__tests__/mac-port-entries-db.test.ts`

**Interfaces:**
- Consumes: colonne del Task 1.
- Produces:
  - `macPortListFromPorts(ports: Array<{ port_index: number; port_name: string }>, byIndex: Map<number, { macs: string[] }>, byName: Map<string, { macs: string[] }>, normalize: (s: string) => string): Array<{ mac: string; port_name: string }>`
  - `upsertMacPortEntries(deviceId: number, entries: MacPortInput[], source: "device" | "unifi"): void` con `MacPortInput = { mac: string; port_name: string; vlan: number | null; port_status: "up" | "down" | null; speed: string | null }`
  - `cleanupOldMacPortEntries(retentionDays: number = 30): number`
  - `getMacPortEntriesByDevice(deviceId)` = solo l'**ultimo giro** di ogni fonte (stessa idea di `NEIGHBORS_LATEST_ROUND_SQL`).

- [ ] **Step 1: prove che falliscono**

```ts
// src/lib/devices/__tests__/mac-port-list.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { macPortListFromPorts } from "@/lib/devices/mac-port-list";

const norm = (s: string) => s.trim().toLowerCase();

test("l'elenco per porta segue l'indice, poi il nome; un MAC ripetuto sulla stessa porta conta una volta", () => {
  const ports = [{ port_index: 3, port_name: "Port 3" }, { port_index: 7, port_name: "ether7" }];
  const byIndex = new Map([[3, { macs: ["AA:00:00:00:00:01", "AA:00:00:00:00:01", "AA:00:00:00:00:02"] }]]);
  const byName = new Map([["ether7", { macs: ["AA:00:00:00:00:03"] }]]);
  assert.deepEqual(macPortListFromPorts(ports, byIndex, byName, norm), [
    { mac: "AA:00:00:00:00:01", port_name: "Port 3" },
    { mac: "AA:00:00:00:00:02", port_name: "Port 3" },
    { mac: "AA:00:00:00:00:03", port_name: "ether7" },
  ]);
});

test("una porta senza MAC non produce righe", () => {
  assert.deepEqual(macPortListFromPorts([{ port_index: 1, port_name: "Port 1" }], new Map(), new Map(), norm), []);
});
```

```ts
// src/lib/__tests__/mac-port-entries-db.test.ts
import { removeTestHubDb } from "@/lib/integrations/__tests__/support/hub-isolato";
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { closeHubDb } from "@/lib/db-hub";
import {
  cleanupOldMacPortEntries, deleteTenantDatabase, getMacPortEntriesByDevice, getTenantDb, upsertMacPortEntries, withTenant,
} from "@/lib/db-tenant";

const T = "TESTMACPORT";
const db = () => getTenantDb(T);
const w = <R>(fn: () => R): R => withTenant(T, fn);
const riga = (mac: string, port_name: string) => ({ mac, port_name, vlan: null, port_status: null, speed: null });
type Riga = { mac: string; port_name: string; first_seen: string; timestamp: string; source: string };
const leggi = () => db().prepare("SELECT mac, port_name, first_seen, timestamp, source FROM mac_port_entries ORDER BY mac, port_name").all() as Riga[];

beforeEach(() => {
  db().exec("DELETE FROM mac_port_entries; DELETE FROM network_devices;");
  db().exec("INSERT INTO network_devices (id, name, host, device_type, vendor, protocol) VALUES (1, 'SW-1', '10.0.0.2', 'switch', 'ubiquiti', 'api')");
});
after(() => {
  deleteTenantDatabase(T);
  closeHubDb();
  removeTestHubDb();
});

test("una seconda lettura aggiorna la riga, tiene first_seen, e non cancella i MAC non visti", () => {
  w(() => upsertMacPortEntries(1, [riga("AA:00:00:00:00:01", "Port 3"), riga("AA:00:00:00:00:02", "Port 4")], "device"));
  db().exec("UPDATE mac_port_entries SET timestamp = datetime('now','-1 day'), first_seen = datetime('now','-1 day')");
  const ieri = leggi();
  w(() => upsertMacPortEntries(1, [riga("AA:00:00:00:00:01", "Port 3")], "device"));
  const oggi = leggi();
  assert.equal(oggi.length, 2);                        // il ...02 resta: «visto l'ultima volta» ieri
  assert.equal(oggi[0].first_seen, ieri[0].first_seen); // la prima volta non avanza
  assert.ok(oggi[0].timestamp > ieri[0].timestamp);
  assert.equal(oggi[1].timestamp, ieri[1].timestamp);
});

test("getMacPortEntriesByDevice mostra solo l'ultimo giro della fonte", () => {
  w(() => upsertMacPortEntries(1, [riga("AA:00:00:00:00:01", "Port 3"), riga("AA:00:00:00:00:02", "Port 4")], "device"));
  db().exec("UPDATE mac_port_entries SET timestamp = datetime('now','-1 hour')");
  w(() => upsertMacPortEntries(1, [riga("AA:00:00:00:00:01", "Port 3")], "device"));
  assert.deepEqual(w(() => getMacPortEntriesByDevice(1)).map((r) => r.mac), ["AA:00:00:00:00:01"]);
});

test("le righe più vecchie di 30 giorni si tolgono, le altre restano", () => {
  w(() => upsertMacPortEntries(1, [riga("AA:00:00:00:00:01", "Port 3"), riga("AA:00:00:00:00:02", "Port 4")], "device"));
  db().exec("UPDATE mac_port_entries SET timestamp = datetime('now','-31 days') WHERE mac = 'AA:00:00:00:00:01'");
  db().exec("UPDATE mac_port_entries SET timestamp = datetime('now','-29 days') WHERE mac = 'AA:00:00:00:00:02'");
  assert.equal(w(() => cleanupOldMacPortEntries()), 1);
  assert.deepEqual(leggi().map((r) => r.mac), ["AA:00:00:00:00:02"]);
});

test("la stessa porta letta da un'altra fonte aggiorna la riga: source cambia, first_seen resta", () => {
  w(() => upsertMacPortEntries(1, [riga("AA:00:00:00:00:01", "Port 3")], "device"));
  db().exec("UPDATE mac_port_entries SET first_seen = datetime('now','-2 days')");
  const prima = leggi()[0];
  w(() => upsertMacPortEntries(1, [riga("AA:00:00:00:00:01", "Port 3")], "unifi"));
  const dopo = leggi();
  assert.equal(dopo.length, 1);
  assert.equal(dopo[0].source, "unifi");
  assert.equal(dopo[0].first_seen, prima.first_seen);
});
```

- [ ] **Step 2: eseguirle e vederle fallire**

Run: `DA_INVENT_DATA_DIR=$(mktemp -d "${TMPDIR:-/tmp}/f2.XXXXXX") node --import tsx --test src/lib/devices/__tests__/mac-port-list.test.ts src/lib/__tests__/mac-port-entries-db.test.ts`
Expected: FAIL (modulo mancante; firma con `source` mancante).

- [ ] **Step 3: il codice**

```ts
// src/lib/devices/mac-port-list.ts
/**
 * Elenco (MAC, porta) dai MAC che la lettura SNMP/SSH ha già raggruppato per
 * porta: prima per ifIndex, poi per nome normalizzato (stessa regola del
 * calcolo di mac_count in cron/jobs.ts). Prima si contava e si buttava
 * l'elenco; ora si salva (spec §10.5). Logica pura.
 */
export function macPortListFromPorts(
  ports: Array<{ port_index: number; port_name: string }>,
  byIndex: Map<number, { macs: string[] }>,
  byName: Map<string, { macs: string[] }>,
  normalize: (s: string) => string,
): Array<{ mac: string; port_name: string }> {
  const out: Array<{ mac: string; port_name: string }> = [];
  for (const p of ports) {
    const name = p.port_name.trim();
    const found = byIndex.get(p.port_index) ?? byName.get(normalize(name));
    for (const mac of new Set(found?.macs ?? [])) out.push({ mac, port_name: name });
  }
  return out;
}
```

In `db-tenant.ts` (e la stessa semantica in `db.ts`):

```ts
export type MacPortInput = { mac: string; port_name: string; vlan: number | null; port_status: "up" | "down" | null; speed: string | null };

/**
 * Le righe invecchiano (spec §10.5, come i vicini nell'ADR 0008): una lettura
 * aggiorna o crea, non cancella. `timestamp` uguale per tutto il giro = «ultimo
 * giro» riconoscibile. La pulizia a 30 giorni la fa il job cleanup.
 */
export function upsertMacPortEntries(deviceId: number, entries: MacPortInput[], source: "device" | "unifi"): void {
  const d = db();
  const now = (d.prepare("SELECT datetime('now') AS t").get() as { t: string }).t;
  const stmt = d.prepare(
    `INSERT INTO mac_port_entries (device_id, mac, port_name, vlan, port_status, speed, timestamp, first_seen, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(device_id, mac, port_name) DO UPDATE SET
       vlan = excluded.vlan, port_status = excluded.port_status, speed = excluded.speed,
       timestamp = excluded.timestamp, source = excluded.source`,
  );
  d.transaction((items: MacPortInput[]) => {
    for (const e of items) stmt.run(deviceId, e.mac, e.port_name, e.vlan, e.port_status, e.speed, now, now, source);
  })(entries);
}

export function cleanupOldMacPortEntries(retentionDays: number = 30): number {
  return (db().prepare("DELETE FROM mac_port_entries WHERE timestamp < datetime('now', '-' || ? || ' days')").run(retentionDays) as { changes: number }).changes;
}
```

`getMacPortEntriesByDevice`: alla `WHERE mpe.device_id = ?` si aggiunge
`AND mpe.timestamp = (SELECT MAX(m2.timestamp) FROM mac_port_entries m2 WHERE m2.device_id = mpe.device_id AND m2.source = mpe.source)`.

In `cron/jobs.ts`:
- ramo `getPortSchema`, dopo `upsertSwitchPorts(device.id, switchPorts);`:

```ts
          // Spec §10.5: l'elenco dei MAC per porta si salva (prima si contava e si buttava).
          upsertMacPortEntries(
            device.id,
            macPortListFromPorts(portInfos, macsByPortByIndex, macsByPortByName, normalizePortNameForMatch).map((e) => ({
              ...e, vlan: null, port_status: null, speed: null,
            })),
            "device",
          );
```
- ramo `getMacTable` (~riga 764): aggiungere l'argomento `"device"`.
- import: `upsertMacPortEntries` da `@/lib/db-tenant` (non più da `@/lib/db`), `macPortListFromPorts` da `@/lib/devices/mac-port-list`.
- pulizia (~riga 1113): `const macPortRetentionDays = config.mac_port_retention_days ?? 30;` e `cleanupOldMacPortEntries(macPortRetentionDays)`; il commento v0.2.651 si riscrive: le righe ora sono una per (apparato, MAC, porta), il volume non cresce a ogni giro.

- [ ] **Step 4: prove verdi** — stesso comando dello Step 2. Expected: PASS. Poi `npx tsc --noEmit` (la firma nuova rompe i chiamanti dimenticati: correggerli tutti).

- [ ] **Step 5: commit**

```bash
git add src/lib/devices/mac-port-list.ts src/lib/devices/__tests__/mac-port-list.test.ts src/lib/__tests__/mac-port-entries-db.test.ts src/lib/db-tenant.ts src/lib/db.ts src/lib/cron/jobs.ts
git commit -m "feat(topologia): la tabella dei MAC per porta si salva da SNMP/SSH e invecchia (30 giorni)"
```

---

### Task 3: Lettura dei client UniFi (sola lettura)

**Files:**
- Create: `src/lib/integrations/unifi-clients.ts`, `src/lib/integrations/unifi-clients-sync.ts`, `src/lib/integrations/__tests__/fixtures/unifi-stat-sta.json`
- Modify: `src/lib/integrations/unifi-api.ts` (`isUnifiRequestAllowed` ~riga 151, interfaccia `UnifiClient` ~riga 463, `createUnifiClient` ~riga 642)
- Test: `src/lib/integrations/__tests__/unifi-clients.test.ts`, aggiunte a `unifi-api.test.ts`

**Interfaces:**
- Consumes: `upsertMacPortEntries(…, "unifi")` dal Task 2.
- Produces:
  - `parseStatStaResponse(json: unknown): UnifiStaClient[]` con `UnifiStaClient = { mac: string; isWired: boolean; swMac: string | null; swPort: number | null; apMac: string | null; lastSeen: number | null }`
  - `mapClientsToPorts(clients: UnifiStaClient[], devices: Array<{ id: number; controller_mac: string | null }>, portNames: Map<string, string>): { byDevice: Map<number, Array<{ mac: string; port_name: string }>>; unmatched: number }` — `portNames` chiave `${deviceId}|${portIndex}` → nome porta in `switch_ports`; un wireless va sull'AP con porta `"wifi"`.
  - `UnifiClient.listClients(): Promise<UnifiStaClient[]>`
  - `syncUnifiClientsForController(controllerId: number, trigger: "manual" | "schedule"): Promise<{ ok: boolean; clients: number; saved: number; unmatched: number; failure: string | null }>`

- [ ] **Step 1: fixture inventata con la forma vera** — `unifi-stat-sta.json`: `{ "meta": { "rc": "ok" }, "data": [...] }` con 4 voci: un cablato (`is_wired: true`, `sw_mac`, `sw_port: 5`), un wireless (`is_wired: false`, `ap_mac`), un cablato senza `sw_mac` (client dietro un apparato non UniFi), una voce senza `mac` (scartata). Campi in più che il controller manda e che si ignorano: `hostname`, `ip`, `essid`, `uptime`, `last_seen`. MAC e nomi **inventati** (prefisso `02:00:00`, localmente amministrato). Al Task 14, punto (c), si confronta la forma con una risposta vera **in sola lettura** sulla copia: se un campo ha un altro nome, si corregge il parser e la fixture.

- [ ] **Step 2: prove che falliscono**

```ts
// src/lib/integrations/__tests__/unifi-clients.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { parseStatStaResponse, mapClientsToPorts } from "@/lib/integrations/unifi-clients";

const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/unifi-stat-sta.json"), "utf8"));

test("parser: tiene cablati e wireless, scarta le voci senza MAC", () => {
  const c = parseStatStaResponse(fixture);
  assert.equal(c.length, 3);
  assert.deepEqual(c.map((x) => x.isWired), [true, false, true]);
});

test("una risposta con rc di errore è un errore, non zero client", () => {
  assert.throws(() => parseStatStaResponse({ meta: { rc: "error", msg: "api.err.NoPermission" }, data: [] }));
});

test("cablato → porta dello switch per indice; wireless → 'wifi' dell'AP; senza switch noto → non abbinato", () => {
  const clients = parseStatStaResponse(fixture);
  const devices = [{ id: 10, controller_mac: clients[0].swMac }, { id: 20, controller_mac: clients[1].apMac }];
  const { byDevice, unmatched } = mapClientsToPorts(clients, devices, new Map([["10|5", "Port 5"]]));
  assert.deepEqual(byDevice.get(10), [{ mac: clients[0].mac, port_name: "Port 5" }]);
  assert.deepEqual(byDevice.get(20), [{ mac: clients[1].mac, port_name: "wifi" }]);
  assert.equal(unmatched, 1);
});
```

In `unifi-api.test.ts`: `isUnifiRequestAllowed("GET", "/api/s/default/stat/sta") === true`, `("GET", "/proxy/network/api/s/default/stat/sta") === true`, `("GET", "/api/s/default/cmd/stamgr") === false`, `("POST", "/api/s/default/stat/sta") === false`.

- [ ] **Step 3: vederle fallire** — `node --import tsx --test src/lib/integrations/__tests__/unifi-clients.test.ts src/lib/integrations/__tests__/unifi-api.test.ts` → FAIL.

- [ ] **Step 4: il codice**

```ts
// src/lib/integrations/unifi-clients.ts
/**
 * Client collegati letti dal controller UniFi (`GET /api/s/<site>/stat/sta`,
 * sola lettura) → righe della tabella dei MAC per porta (spec §10.5).
 * Logica pura. MAC normalizzati come nel resto dell'app.
 */
import { normalizeMacForStorage } from "@/lib/utils";

export interface UnifiStaClient { mac: string; isWired: boolean; swMac: string | null; swPort: number | null; apMac: string | null; lastSeen: number | null }

export function parseStatStaResponse(json: unknown): UnifiStaClient[] {
  const o = json as { meta?: { rc?: string; msg?: string }; data?: unknown };
  if (o?.meta?.rc !== "ok") throw new Error(`Risposta del controller non valida (stat/sta): ${o?.meta?.msg ?? "senza esito"}`);
  if (!Array.isArray(o.data)) throw new Error("Risposta del controller non valida (stat/sta): manca data[]");
  const out: UnifiStaClient[] = [];
  for (const r of o.data as Array<Record<string, unknown>>) {
    const mac = normalizeMacForStorage(typeof r.mac === "string" ? r.mac : null);
    if (!mac) continue;
    const port = typeof r.sw_port === "number" && Number.isInteger(r.sw_port) ? r.sw_port : null;
    out.push({
      mac,
      isWired: r.is_wired === true,
      swMac: normalizeMacForStorage(typeof r.sw_mac === "string" ? r.sw_mac : null),
      swPort: port,
      apMac: normalizeMacForStorage(typeof r.ap_mac === "string" ? r.ap_mac : null),
      lastSeen: typeof r.last_seen === "number" ? r.last_seen : null,
    });
  }
  return out;
}

export function mapClientsToPorts(
  clients: UnifiStaClient[],
  devices: Array<{ id: number; controller_mac: string | null }>,
  portNames: Map<string, string>,
): { byDevice: Map<number, Array<{ mac: string; port_name: string }>>; unmatched: number } {
  const byMac = new Map<string, number>();
  for (const d of devices) {
    const m = normalizeMacForStorage(d.controller_mac);
    if (m) byMac.set(m, d.id);
  }
  const byDevice = new Map<number, Array<{ mac: string; port_name: string }>>();
  let unmatched = 0;
  const push = (id: number, mac: string, port: string) => byDevice.set(id, [...(byDevice.get(id) ?? []), { mac, port_name: port }]);
  for (const c of clients) {
    if (c.isWired && c.swMac && c.swPort !== null && byMac.has(c.swMac)) {
      const id = byMac.get(c.swMac)!;
      push(id, c.mac, portNames.get(`${id}|${c.swPort}`) ?? `Port ${c.swPort}`);
    } else if (!c.isWired && c.apMac && byMac.has(c.apMac)) {
      push(byMac.get(c.apMac)!, c.mac, "wifi");
    } else {
      unmatched++;
    }
  }
  return { byDevice, unmatched };
}
```

`unifi-api.ts`: in `isUnifiRequestAllowed` la regex diventa `/^\/api\/s\/([^/]+)\/stat\/(device|sta)$/`; `UnifiClient` riceve `listClients(): Promise<UnifiStaClient[]>`; in `createUnifiClient` una `statSta(send, auth, site, timeoutMs)` gemella di `statDevice` (stessa gestione degli errori, `parseStatStaResponse` al posto di `parseStatDeviceResponse`), e `listClients` gemella di `listDevices` (stessa autenticazione, stesso pin del certificato, stesso logout).

`unifi-clients-sync.ts`: legge il controller come fa `syncController` di `src/lib/controllers/service.ts` (stessa costruzione del client con `controllerPinStore(id)` e segreto decifrato con `safeDecrypt`), chiama `listClients()`, costruisce `devices` dagli apparati del tenant con `controller_mac` e `portNames` da `switch_ports` (una query sola, niente N+1), chiama `upsertMacPortEntries(id, righe, "unifi")` per ogni apparato, e registra il giro con `recordControllerRun` (contatori: `total` = client letti, `ports` = righe salvate). **Un errore del controller lancia prima di qualunque scrittura**: le righe esistenti restano, invecchiano. Nessun log con MAC, nomi o IP.

- [ ] **Step 5: prove verdi** — comando dello Step 3 → PASS; `npx tsc --noEmit` pulito.

- [ ] **Step 6: commit**

```bash
git add src/lib/integrations/unifi-clients.ts src/lib/integrations/unifi-clients-sync.ts src/lib/integrations/unifi-api.ts src/lib/integrations/__tests__/unifi-clients.test.ts src/lib/integrations/__tests__/unifi-api.test.ts src/lib/integrations/__tests__/fixtures/unifi-stat-sta.json
git commit -m "feat(controller): lettura dei client UniFi (stat/sta, sola lettura) nella tabella dei MAC per porta"
```

---

### Task 4: Il job dei client, ogni ora dalle 7 alle 20, spento di default

**Files:**
- Modify: `src/lib/cron/jobs.ts` (`case "unifi_sync"` ~riga 241, `unifiJobControllerId` ~riga 139), `src/lib/db-tenant.ts` (`listControllerScheduleJobs`, `setControllerSchedule` ~righe 8601-8640), `src/lib/controllers/service.ts` (`toControllerView`), `src/app/api/controllers/[id]/route.ts`, `src/app/(dashboard)/controllers/page.tsx`
- Test: `src/lib/cron/__tests__/unifi-client-window.test.ts`, aggiunte alla prova esistente delle pianificazioni dei controller (cercarla con `grep -rln setControllerSchedule src/**/__tests__`)

**Interfaces:**
- Produces: `unifiJobKind(configStr): "apparati" | "client"`; `inFinestraClient(d: Date): boolean` (7:00 ≤ ora di Roma < 20:00, `Intl.DateTimeFormat` con `timeZone: "Europe/Rome"`); `setControllerClientSchedule(controllerId: number, on: boolean): void`; `NetworkControllerView.clientSchedule: boolean`.

- [ ] **Step 1: prove che falliscono**

```ts
// src/lib/cron/__tests__/unifi-client-window.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { inFinestraClient, unifiJobKind } from "@/lib/cron/jobs";

test("finestra 7-20 in ora italiana, anche col cambio d'ora", () => {
  assert.equal(inFinestraClient(new Date("2026-10-13T04:59:00Z")), false); // 06:59 a Roma (estate)
  assert.equal(inFinestraClient(new Date("2026-10-13T05:00:00Z")), true);  // 07:00
  assert.equal(inFinestraClient(new Date("2026-10-13T17:59:00Z")), true);  // 19:59
  assert.equal(inFinestraClient(new Date("2026-10-13T18:00:00Z")), false); // 20:00
  assert.equal(inFinestraClient(new Date("2026-12-01T06:00:00Z")), true);  // 07:00 d'inverno
});

test("il tipo di job: senza 'cosa' è la lettura degli apparati (job nati prima)", () => {
  assert.equal(unifiJobKind('{"controller_id":1}'), "apparati");
  assert.equal(unifiJobKind('{"controller_id":1,"cosa":"client"}'), "client");
  assert.equal(unifiJobKind("non json"), "apparati");
});
```

Nella prova delle pianificazioni: `setControllerClientSchedule(1, true)` crea **un** job `unifi_sync` con `interval_minutes = 60` e `config.cosa = "client"`; `setControllerSchedule(1, 1440)` **non lo tocca**; `listControllerScheduleJobs()` elenca solo i job degli apparati; `setControllerClientSchedule(1, false)` cancella solo quello dei client; `deleteNetworkController` li toglie tutti e due (già così).

- [ ] **Step 2: vederle fallire** — `node --import tsx --test src/lib/cron/__tests__/unifi-client-window.test.ts` → FAIL.

- [ ] **Step 3: il codice**

```ts
// src/lib/cron/jobs.ts (accanto a unifiJobControllerId)
export function unifiJobKind(configStr: string | null | undefined): "apparati" | "client" {
  try {
    return (JSON.parse(configStr || "{}") as { cosa?: unknown }).cosa === "client" ? "client" : "apparati";
  } catch {
    return "apparati";
  }
}

/** Spec §10.5: i client si leggono dalle 7 alle 20 (ora italiana): di notte sono spenti. */
export function inFinestraClient(d: Date): boolean {
  const ora = Number(new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", hour: "2-digit", hour12: false }).format(d));
  return ora >= 7 && ora < 20;
}
```

Nel `case "unifi_sync"`: se `unifiJobKind(job.config) === "client"`: fuori finestra → `console.info("[Scheduler] unifi_sync client #<id>: fuori dalle 7-20, non letto")` e `break` (non è un fallimento); dentro → `syncUnifiClientsForController(controllerId, "schedule")`, e se `failure` → `throw` come per gli apparati.

In `db-tenant.ts`: le query di `setControllerSchedule` e `listControllerScheduleJobs` aggiungono `AND COALESCE(json_extract(config, '$.cosa'), 'apparati') = 'apparati'`; `setControllerClientSchedule(id, on)` in `runInTenantTransaction`: `on` → un job (`interval_minutes 60`, `config {"controller_id": id, "cosa": "client"}`), creato se manca; `!on` → cancellato.

Pagina Controller di rete: sotto la pianificazione esistente una casella **«Leggi i client ogni ora (7–20)»** con sotto, in 13 px: «Serve alla mappa per sapere a quale porta è attaccato ogni dispositivo. Spenta di default.». La rotta `PATCH /api/controllers/[id]` accetta `client_schedule: boolean` (Zod, `requireAdmin`). Testo dello stato in parole («Client: letti ogni ora dalle 7 alle 20» / «Client: non letti»), non solo la casella.

- [ ] **Step 4: prove verdi** — comando dello Step 2 più la prova delle pianificazioni → PASS; `npx tsc --noEmit`, `npm run lint`.

- [ ] **Step 5: commit**

```bash
git add src/lib/cron/jobs.ts src/lib/cron/__tests__/unifi-client-window.test.ts src/lib/db-tenant.ts src/lib/controllers/service.ts "src/app/api/controllers/[id]/route.ts" "src/app/(dashboard)/controllers/page.tsx"
git commit -m "feat(controller): job dei client UniFi ogni ora 7-20, spento di default, accanto a quello degli apparati"
```

(Più il file della prova delle pianificazioni toccato.)

---

### Task 5: I MAC per porta nel modello, e la misura sulla copia

**Files:**
- Modify: `src/lib/topology/model-types.ts` (solo il tipo di ingresso), `src/lib/db-tenant.ts` (`getTopologyModelInput` ~riga 8662)
- Create: `scripts/misura-mac-porta.ts`
- Test: `src/lib/__tests__/topology-db.test.ts` (aggiunta)

**Interfaces:**
- Produces: `ModelMacPortRow = { device_id: number; mac: string; port_name: string; timestamp: string; source: string }`; `TopologyModelInput.macPorts: ModelMacPortRow[]` (righe degli ultimi 30 giorni, tutte; il modello decide cosa è «vecchio»).

- [ ] **Step 1: prova che fallisce** — in `topology-db.test.ts`: dopo `upsertMacPortEntries(dev, [riga], "device")`, `getTopologyModelInput(2).macPorts` contiene `{ device_id: dev, mac, port_name, source: "device" }` con `timestamp` valorizzato.

- [ ] **Step 2: vederla fallire**, poi **Step 3** aggiungere a `getTopologyModelInput`:

```ts
    macPorts: d.prepare(`
      SELECT device_id, mac, port_name, timestamp, source FROM mac_port_entries
       WHERE timestamp >= datetime('now', '-30 days') ORDER BY device_id, port_name, mac`).all() as ModelInput["macPorts"],
```

e in `model-types.ts` il tipo e il campo (con commento: «Ultimi 30 giorni; spec §10.5»). Le prove esistenti che costruiscono un `TopologyModelInput` a mano ricevono `macPorts: []` (il compilatore le elenca tutte).

- [ ] **Step 4: lo script di misura** `scripts/misura-mac-porta.ts`, sul modello di `scripts/misura-topologia.ts` (copia della copia in `--cartella`, `controllaPercorsi`, console dirottata su file, segreto **solo** dalla prima riga di stdin con `--segreto-stdin`): `integrity_check` prima → apertura del tenant = migrazione fase 2 (durata, cose aggiunte) → `integrity_check` dopo → con `--unifi <id> --segreto-stdin` lettura dei client **in sola lettura** dal controller e scrittura **solo sulla copia** → stampa **solo conteggi**: righe `mac_port_entries` per fonte, apparati con almeno una riga, client letti, client non abbinati, MAC distinti, tempo della lettura. Uscita 0/1/2 come lo script gemello.

- [ ] **Step 5: verde e commit**

```bash
git add src/lib/topology/model-types.ts src/lib/db-tenant.ts src/lib/__tests__/topology-db.test.ts scripts/misura-mac-porta.ts
git commit -m "feat(topologia): MAC per porta nel modello; script di misura sulla copia"
git push origin topologia/f2-raccolta
```

---

## Tappa B — il motore (livello leggero, ramo `topologia/f2-mappa`)

Il ramo nasce dal commit del Task 1: `git worktree add .claude/worktrees/topologia-f2b -b topologia/f2-mappa origin/topologia/f2-raccolta`. Prima di toccare `model-types.ts` si fa `git merge origin/topologia/f2-raccolta` se il Task 5 è già spinto; altrimenti il Task 6 aggiunge **lo stesso** campo `macPorts` con lo stesso tipo (il merge finale li unisce senza conflitto di significato).

### Task 6: Un oggetto fisico, un nodo

**Files:**
- Create: `src/lib/topology/identity.ts`
- Modify: `src/lib/topology/node-index.ts`, `src/lib/topology/model-types.ts` (`MapNode`)
- Test: `src/lib/topology/__tests__/identity.test.ts`

**Interfaces:**
- Consumes: `ModelHostRow`, `ModelNeighborRow`, `buildNodeIndex` (firma che cambia: riceve anche `neighbors`).
- Produces:
  - `isVirtualMac(mac: string | null | undefined): boolean`
  - `IDENTITY_TYPES: readonly string[]` = `["router","firewall","switch","access_point","server","server_linux","server_windows","hypervisor","nas","storage"]`
  - `announcedNames(hosts: ModelHostRow[], neighbors: ModelNeighborRow[]): Map<number, string[]>` (hostId → nomi annunciati via LLDP/CDP/MNDP per l'IP di quell'host, se l'IP è di un host solo)
  - `NodeClass = "infra" | "ap" | "att" | "client"`; `nodeClass(n: Pick<MapNode, "type">): NodeClass` (infra = router/firewall/switch; ap = access_point; att = server, server_linux, server_windows, hypervisor, nas, storage; client = tutto il resto)
  - `MapNode.addresses: Array<{ ip: string; virtual: boolean; hostId: number | null }>`, `MapNode.aliases: string[]`
  - `buildNodeIndex(devices, hosts, knownMacs, neighbors)`; `NodeIndex.mergedHosts: number`

- [ ] **Step 1: prove che falliscono** — dati inventati con la forma del caso vero (spec §10.1), IP di documentazione `192.0.2.x`/`198.51.100.x`, MAC `02:00:00:…`:

```ts
// src/lib/topology/__tests__/identity.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildNodeIndex } from "@/lib/topology/node-index";
import { isVirtualMac } from "@/lib/topology/identity";
import type { ModelDeviceRow, ModelHostRow, ModelNeighborRow } from "@/lib/topology/model-types";

const dev = (id: number, name: string, host: string): ModelDeviceRow => ({
  id, name, host, device_type: "router", vendor: "mikrotik", model: null, enabled: 1, host_id: null, physical_device_id: null,
  location_id: null, controller_mac: null, uplink_mac: null, uplink_remote_port: null, uplink_seen_at: null, topology_hidden: 0, port_count: 0,
});
const host = (id: number, ip: string, mac: string | null, hostname: string | null, classification = "router"): ModelHostRow => ({
  id, network_id: 1, ip, mac, hostname, custom_name: null, classification, status: "online", physical_device_id: null,
});
const vicino = (ip: string, name: string, mac: string): ModelNeighborRow => ({
  device_id: 9, local_port: "ether1", remote_device_name: name, remote_port: "bridge", protocol: "mndp",
  remote_ip: ip, remote_mac: mac, timestamp: "2026-10-13 10:00:00", source: "device",
});

test("MAC virtuali VRRP/HSRP riconosciuti", () => {
  assert.equal(isVirtualMac("00:00:5E:00:01:65"), true);
  assert.equal(isVirtualMac("00:00:5e:00:02:0a"), true);
  assert.equal(isVirtualMac("00:00:0C:07:AC:01"), true);
  assert.equal(isVirtualMac("02:00:00:00:00:01"), false);
  assert.equal(isVirtualMac(null), false);
});

test("il router assorbe gli host col suo nome annunciato, anche con MAC virtuale; gli IP virtuali sono segnati", () => {
  const devices = [dev(1, "RTR-SEDE1", "192.0.2.11")];
  const hosts = [
    host(10, "192.0.2.11", "02:00:00:00:00:98", "CORE-ID"),   // l'host dell'apparato: dà l'alias CORE-ID
    host(11, "198.51.100.254", "00:00:5E:00:01:65", "CORE-ID"),
    host(12, "198.51.100.253", null, "CORE-ID"),
    host(13, "203.0.113.254", "00:00:5E:00:01:6E", null),       // nessun nome: lo annuncia un vicino MNDP
  ];
  const idx = buildNodeIndex(devices, hosts, [], [vicino("203.0.113.254", "CORE-ID", "00:00:5E:00:01:6E")]);
  const n = idx.nodes.get("dev:1")!;
  assert.deepEqual(n.fusedHostIds, [10, 11, 12, 13]);
  assert.deepEqual(n.aliases, ["CORE-ID"]);
  assert.deepEqual(n.addresses.filter((a) => a.virtual).map((a) => a.ip).sort(), ["198.51.100.254", "203.0.113.254"]);
  assert.equal([...idx.nodes.keys()].filter((k) => k.startsWith("host:")).length, 0);
});

test("quattro host con lo stesso MAC vero diventano un oggetto solo, col nome che c'è", () => {
  const hosts = [
    host(20, "192.0.2.12", "02:00:00:00:BA:C6", "RTR-BACKUP"),
    host(21, "198.51.100.252", "02:00:00:00:BA:C6", null),
    host(22, "203.0.113.252", "02:00:00:00:BA:C6", null),
    host(23, "192.0.2.252", "02:00:00:00:BA:C6", null),
  ];
  const idx = buildNodeIndex([], hosts, [], []);
  const hostNodes = [...idx.nodes.values()].filter((n) => n.kind === "host");
  assert.equal(hostNodes.length, 1);
  assert.equal(hostNodes[0].name, "RTR-BACKUP");
  assert.equal(hostNodes[0].addresses.length, 4);
  assert.equal(idx.mergedHosts, 3);
});

test("due client con lo stesso nome non si fondono; due host col MAC virtuale e senza nome nemmeno", () => {
  const hosts = [
    host(30, "192.0.2.47", "02:00:00:00:00:47", "iPhone", "voip"),
    host(31, "192.0.2.48", "02:00:00:00:00:48", "iPhone", "voip"),
    host(32, "192.0.2.1", "00:00:5E:00:01:01", null),
    host(33, "192.0.2.2", "00:00:5E:00:01:01", null),
  ];
  const idx = buildNodeIndex([], hosts, [], []);
  assert.equal(idx.mergedHosts, 0);
});

test("un nome annunciato non porta via un host il cui MAC vero è di un altro apparato", () => {
  const devices = [dev(1, "RTR-A", "192.0.2.11"), { ...dev(2, "RTR-B", "192.0.2.21"), controller_mac: "02:00:00:00:00:B0" }];
  const hosts = [host(10, "192.0.2.11", "02:00:00:00:00:A0", "ID-A"), host(40, "192.0.2.99", "02:00:00:00:00:B0", "ID-A")];
  const idx = buildNodeIndex(devices, hosts, [], []);
  assert.ok(idx.nodes.get("dev:2")!.fusedHostIds.includes(40));
  assert.ok(!idx.nodes.get("dev:1")!.fusedHostIds.includes(40));
});
```

- [ ] **Step 2: vederle fallire** — `node --import tsx --test src/lib/topology/__tests__/identity.test.ts` → FAIL.

- [ ] **Step 3: il codice**

```ts
// src/lib/topology/identity.ts
/**
 * Un oggetto fisico, un nodo (spec §10.4). Logica pura. I MAC virtuali (VRRP,
 * HSRP) passano da un router all'altro: non identificano nessuno. Il seriale
 * degli host non si usa (spec §10.1: 40 seriali su 81 condivisi sulla copia
 * di un cliente).
 */
import type { MapNode, ModelHostRow, ModelNeighborRow } from "@/lib/topology/model-types";

const VIRTUALI = [/^00:00:5e:00:0[12]:/i, /^00:00:0c:07:ac:/i];

export function isVirtualMac(mac: string | null | undefined): boolean {
  return !!mac && VIRTUALI.some((r) => r.test(mac.replace(/-/g, ":")));
}

export const IDENTITY_TYPES: readonly string[] = [
  "router", "firewall", "switch", "access_point", "server", "server_linux", "server_windows", "hypervisor", "nas", "storage",
];

export type NodeClass = "infra" | "ap" | "att" | "client";

/** Ruolo nella mappa (spec §10.3): i client non sono nodi della mappa automatica. */
export function nodeClass(n: Pick<MapNode, "type">): NodeClass {
  if (n.type === "router" || n.type === "firewall" || n.type === "switch") return "infra";
  if (n.type === "access_point") return "ap";
  if (["server", "server_linux", "server_windows", "hypervisor", "nas", "storage"].includes(n.type)) return "att";
  return "client";
}

/** Nomi annunciati (LLDP/CDP/MNDP) per l'IP di un host, se quell'IP è di un host solo. */
export function announcedNames(hosts: ModelHostRow[], neighbors: ModelNeighborRow[]): Map<number, string[]> {
  const byIp = new Map<string, number | null>();
  for (const h of hosts) if (h.ip) byIp.set(h.ip, byIp.has(h.ip) ? null : h.id);
  const out = new Map<number, string[]>();
  for (const n of neighbors) {
    const id = n.remote_ip ? byIp.get(n.remote_ip) : undefined;
    const name = n.remote_device_name?.trim();
    if (typeof id !== "number" || !name) continue;
    const list = out.get(id) ?? [];
    if (!list.includes(name)) out.set(id, [...list, name].sort());
  }
  return out;
}
```

In `node-index.ts`:
1. firma `buildNodeIndex(devices, hosts, knownMacs, neighbors: ModelNeighborRow[] = [])`; `NodeIndex.mergedHosts`.
2. nel ciclo «host col MAC di UN solo apparato»: `if (isVirtualMac(m)) continue;` prima di cercare i proprietari (un MAC VRRP di un apparato solo **non** assorbe più).
3. **dopo** quel ciclo, prima di indicizzare gli host non assorbiti, due passi nuovi:

```ts
  // Spec §10.4 punto 3: il nome annunciato da un host già fuso è un alias dell'apparato.
  const announced = announcedNames(sortedHosts, neighbors);
  const namesOf = (h: ModelHostRow): string[] =>
    [h.hostname, h.custom_name, ...(announced.get(h.id) ?? [])].map((s) => nameKey(s)).filter((k): k is string => !!k);
  const aliasOwner = new Map<string, string | null>();
  const claim = (k: string, devId: string) => aliasOwner.set(k, aliasOwner.has(k) && aliasOwner.get(k) !== devId ? null : devId);
  for (const d of devices) { const k = nameKey(d.name); if (k) claim(k, `dev:${d.id}`); }
  for (const [hostId, devId] of absorbedBy) { const h = idx.hostById.get(hostId); if (h) for (const k of namesOf(h)) claim(k, devId); }
  for (const h of sortedHosts) {
    if (absorbedBy.has(h.id) || !IDENTITY_TYPES.includes(h.classification ?? "")) continue;
    const m = normalizeMacForStorage(h.mac);
    const owners = m && !isVirtualMac(m) ? macOwners.get(m) : undefined;   // MAC vero di un altro apparato = contraddizione
    const devId = namesOf(h).map((k) => aliasOwner.get(k)).find((v): v is string => typeof v === "string");
    if (!devId || (owners && !owners.has(devId))) continue;
    absorbedBy.set(h.id, devId);
    const node = idx.nodes.get(devId)!;
    node.fusedHostIds = [...node.fusedHostIds, h.id].sort((a, b) => a - b);
  }
  // Spec §10.4 punti 1-2: gli host rimasti si raggruppano per MAC vero (tutti) e per nome (solo infrastruttura e server).
  const parent = new Map<number, number>();
  const find = (x: number): number => { const p = parent.get(x) ?? x; if (p === x) return x; const r = find(p); parent.set(x, r); return r; };
  const union = (a: number, b: number) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(Math.max(ra, rb), Math.min(ra, rb)); };
  const firstBy = new Map<string, number>();
  const join = (key: string, id: number) => { const f = firstBy.get(key); if (f === undefined) firstBy.set(key, id); else union(f, id); };
  for (const h of sortedHosts) {
    if (absorbedBy.has(h.id)) continue;
    const m = normalizeMacForStorage(h.mac);
    if (m && !isVirtualMac(m)) join(`mac:${m}`, h.id);
    if (IDENTITY_TYPES.includes(h.classification ?? "")) for (const k of namesOf(h)) join(`nome:${k}`, h.id);
  }
  const groupOf = new Map<number, number>();   // host → rappresentante (id più basso)
  for (const h of sortedHosts) if (!absorbedBy.has(h.id)) groupOf.set(h.id, find(h.id));
```

Poi: per ogni rappresentante con almeno un altro membro si crea subito il nodo `host:<rappresentante>` con `hostNode(rapp)`, `fusedHostIds` = gli altri membri, nome = il primo nome non-IP fra i membri (in ordine di id), e ogni membro va in `idx.alias` → `host:<rappresentante>`; `idx.mergedHosts` = numero di membri non rappresentanti. Nell'indicizzazione finale degli host non assorbiti, chiavi IP/MAC/nome di un membro puntano al nodo del rappresentante (`weak = true`).
4. `addresses` e `aliases`: per ogni nodo (apparato o gruppo) si calcolano alla fine: l'IP di gestione (`virtual: false`, `hostId` = host fuso con quell'IP o null) più l'IP di ogni host fuso (`virtual: isVirtualMac(h.mac)`), senza doppi, in ordine di IP; `aliases` = nomi (hostname, custom_name, annunciati) degli host fusi diversi dal nome del nodo (confronto con `nameKey`), senza doppi, ordinati. `hostNode()` e i nodi apparato partono con `addresses: []`, `aliases: []`.
5. `buildTopologyModel` passa `input.neighbors` a `buildNodeIndex`; `ModelCounts.mergedHosts` (nuovo).

- [ ] **Step 4: verdi** — la prova nuova e **tutte** quelle di `src/lib/topology/__tests__/` (`node --import tsx --test "src/lib/topology/__tests__/*.test.ts"`): le prove della fase 1 sulle fixture devono restare verdi; se un conteggio cambia (meno nodi host), si aggiorna il numero **scrivendo nel commento della prova perché** (regola dell'identità, spec §10.4).

- [ ] **Step 5: commit**

```bash
git add src/lib/topology/identity.ts src/lib/topology/node-index.ts src/lib/topology/model-types.ts src/lib/topology/model.ts src/lib/topology/__tests__/
git commit -m "feat(topologia): un oggetto fisico un nodo — alias annunciati, MAC veri, mai MAC virtuali (spec §10.4)"
```

---

### Task 7: Attaccati e client dalla tabella dei MAC per porta

**Files:**
- Create: `src/lib/topology/attach.ts`
- Modify: `src/lib/topology/model-types.ts` (`LinkSource` + `mac_table`, rango 3; `TopologyModel.portClients`, `clientCount`), `src/lib/topology/model.ts`
- Test: `src/lib/topology/__tests__/attach.test.ts`

**Interfaces:**
- Consumes: `NodeIndex`, `MapLink[]`, `TopologyModelInput.macPorts`, `uplinkPorts`, `nodeClass` (Task 6).
- Produces:
  - `PortClient = { mac: string; nodeId: string | null; name: string | null; ip: string | null; lastSeen: string; stale: boolean }`
  - `PortClients = { nodeId: string; port: string; clients: PortClient[] }`
  - `attachMacs(input: TopologyModelInput, idx: NodeIndex, links: MapLink[]): { portClients: PortClients[]; clientCount: Record<string, number>; attachLinks: MapLink[] }`
  - `TopologyModel.portClients: PortClients[]`, `TopologyModel.clientCount: Record<string, number>`

- [ ] **Step 1: prove che falliscono** (`attach.test.ts`, input costruiti a mano come in `model.test.ts`):
  1. **porta di bordo**: un MAC visto su `sw1|Port 1` (porta di un collegamento sw1↔sw2), su `sw2|Port 9` (uplink, in `uplinkPorts`) e su `sw2|Port 5` → sta solo su `sw2|Port 5`;
  2. **router scartato**: un MAC visto su `rtr|bridge` e su `sw1|Port 4` → sta su `sw1|Port 4`; un MAC visto **solo** sul router → nessun client (il router non conta client) e nessun collegamento;
  3. **switch non gestito sotto**: 30 MAC su `sw2|Port 7` → `clientCount["dev:sw2"] = 30`, e lo switch a monte non li conta;
  4. **server attaccato**: il MAC di un host classificato `server_linux` su `sw2|Port 2` → `attachLinks` con un collegamento `mac_table` sw2(`Port 2`) ↔ host, e niente client; se fra i due c'è già un collegamento LLDP, nessun collegamento in più; il MAC di un host `workstation` noto → **client** con nome e IP dell'host, mai un collegamento;
  5. **apparato trovato per MAC**: il MAC di un AP censito su `sw1|Port 8` senza altri collegamenti → collegamento `mac_table`, così «partire da un apparato qualunque» funziona senza controller;
  6. **vecchio**: una riga di 3 giorni fa con soglia 2 → `stale: true`, conta comunque (si mostra «visto l'ultima volta»);
  7. **stessi dati, stesso risultato** (due chiamate, `deepEqual`).

- [ ] **Step 2: vederle fallire**, poi **Step 3: il codice**

```ts
// src/lib/topology/attach.ts
/**
 * Dove è attaccato un MAC (spec §10.5): sulla porta di bordo — non uplink, non
 * porta di un collegamento fra apparati — di uno switch o AP; un router solo se
 * nessuno switch lo vede (e allora non conta client: il suo bridge vede tutta la
 * rete). A parità, la porta con meno MAC (una porta di passaggio ne ha tanti),
 * poi nodo e porta. Il MAC di un nodo noto che non è un client (apparato,
 * server) diventa un collegamento «mac_table»; gli altri sono client contati
 * sulla porta, con nome e IP se l'host è noto. Logica pura.
 */
import type { MapLink, PortClients, TopologyModelInput } from "@/lib/topology/model-types";
import { type NodeIndex, resolveNode } from "@/lib/topology/node-index";
import { nodeClass } from "@/lib/topology/identity";
import { normalizeMacForStorage, normalizePortNameForMatch } from "@/lib/utils";
import { parseDbDate } from "@/lib/db-date";

const CLIENT_COUNTING = ["switch", "access_point"];
const DAY = 86_400_000;

interface Cand { node: string; port: string; ts: string; counting: boolean }

export function attachMacs(
  input: TopologyModelInput,
  idx: NodeIndex,
  links: MapLink[],
): { portClients: PortClients[]; clientCount: Record<string, number>; attachLinks: MapLink[] } {
  const portKey = (node: string, port: string) => `${node}|${normalizePortNameForMatch(port)}`;
  const linkPorts = new Set<string>();
  for (const l of links) {
    if (l.aPort) linkPorts.add(portKey(l.a, l.aPort));
    if (l.bPort) linkPorts.add(portKey(l.b, l.bPort));
  }
  for (const u of input.uplinkPorts) linkPorts.add(portKey(`dev:${u.device_id}`, u.port_name));
  const linked = new Set(links.map((l) => [l.a, l.b].sort().join("|")));

  const perPort = new Map<string, number>();
  const cand = new Map<string, Cand[]>();
  for (const r of input.macPorts) {
    const node = `dev:${r.device_id}`;
    const n = idx.nodes.get(node);
    const mac = normalizeMacForStorage(r.mac);
    if (!n || !mac || linkPorts.has(portKey(node, r.port_name))) continue;
    const k = portKey(node, r.port_name);
    perPort.set(k, (perPort.get(k) ?? 0) + 1);
    cand.set(mac, [...(cand.get(mac) ?? []), { node, port: r.port_name, ts: r.timestamp, counting: CLIENT_COUNTING.includes(n.type) }]);
  }

  const byPort = new Map<string, PortClients>();
  const clientCount: Record<string, number> = {};
  const attachLinks: MapLink[] = [];
  for (const mac of [...cand.keys()].sort()) {
    const all = cand.get(mac)!;
    const pool = all.some((c) => c.counting) ? all.filter((c) => c.counting) : all;
    pool.sort((x, y) =>
      perPort.get(portKey(x.node, x.port))! - perPort.get(portKey(y.node, y.port))!
      || (x.node < y.node ? -1 : x.node > y.node ? 1 : 0)
      || x.port.localeCompare(y.port));
    const best = pool[0];
    const seenMs = parseDbDate(best.ts).getTime();
    const daysUnseen = Math.max(0, Math.floor((input.nowMs - seenMs) / DAY));
    const stale = input.nowMs - seenMs > input.staleDays * DAY;
    const otherId = resolveNode(idx, { mac });
    const other = otherId ? idx.nodes.get(otherId) : undefined;
    if (other && other.id !== best.node && nodeClass(other) !== "client") {
      const key = [best.node, other.id].sort().join("|");
      if (!linked.has(key)) {
        linked.add(key);
        attachLinks.push({
          id: `mac:${key}`, a: best.node, aPort: best.port, b: other.id, bPort: "", source: "mac_table", sources: ["mac_table"],
          uplinkFrom: other.id, lastSeen: best.ts, daysUnseen, stale,
        });
      }
      continue;
    }
    if (!best.counting) continue;
    const pk = `${best.node}|${best.port}`;
    const pc = byPort.get(pk) ?? { nodeId: best.node, port: best.port, clients: [] };
    pc.clients.push({ mac, nodeId: other?.id ?? null, name: other?.name ?? null, ip: other?.mgmtIp ?? null, lastSeen: best.ts, stale });
    byPort.set(pk, pc);
    clientCount[best.node] = (clientCount[best.node] ?? 0) + 1;
  }
  const portClients = [...byPort.values()].sort((a, b) =>
    (a.nodeId < b.nodeId ? -1 : a.nodeId > b.nodeId ? 1 : 0) || a.port.localeCompare(b.port, "it", { numeric: true }));
  attachLinks.sort((a, b) => (a.id < b.id ? -1 : 1));
  return { portClients, clientCount, attachLinks };
}
```

In `model.ts`: `const { portClients, clientCount, attachLinks } = attachMacs(input, idx, links)`; `links` del modello = `[...links, ...attachLinks]` (ordinati per id); i conteggi `attachedLinks` li includono; `linksBySource.mac_table`. In `model-types.ts`: `LinkSource` += `"mac_table"`, `LINK_SOURCE_RANK.mac_table = 3`.

- [ ] **Step 4: verdi** — `node --import tsx --test "src/lib/topology/__tests__/*.test.ts"` → PASS.

- [ ] **Step 5: commit**

```bash
git add src/lib/topology/attach.ts src/lib/topology/model-types.ts src/lib/topology/model.ts src/lib/topology/__tests__/attach.test.ts
git commit -m "feat(topologia): attaccati e client dalla tabella dei MAC per porta — porta di bordo, mai il bridge di un router"
```

---

### Task 8: L'albero e la testa proposta

**Files:**
- Create: `src/lib/topology/tree.ts`
- Test: `src/lib/topology/__tests__/tree.test.ts`

**Interfaces:**
- Consumes: `TopologyModel` (Task 6-7).
- Produces:
  - usa `nodeClass` di `identity.ts` (Task 6)
  - `TreeResult = { roots: string[]; children: Map<string, string[]>; via: Map<string, MapLink> }`
  - `buildTree(model: TopologyModel, visible: ReadonlySet<string>, roots: readonly string[]): TreeResult`
  - `proposeHead(model: TopologyModel): string | null`
  - `autoVisible(model: TopologyModel): Set<string>` (non client, non isolati, non nascosti)
  - `missingNeighbors(model: TopologyModel, nodeId: string, visible: ReadonlySet<string>): MapLink[]` (collegamenti verso nodi non client e non visibili: il «+N»)

- [ ] **Step 1: prove che falliscono**
  1. da una radice, a parità di nodi raggiungibili, vince il collegamento **non vecchio** e poi quello di **rango migliore** (uplink UniFi < LLDP < mac_table);
  2. attaccati e client sono **foglie** (un server collegato a due switch non fa da ponte);
  3. un nodo visibile non raggiungibile dalle radici diventa una **radice in più** (prima l'infrastruttura, poi per numero di collegamenti, poi id);
  4. **determinismo**: stessi dati con nodi e collegamenti in ordine diverso → stesso `TreeResult` (confronto di `children` serializzato con le chiavi ordinate);
  5. `proposeHead`: la testa confermata di una sede vince; senza sedi, il router-apparato che raggiunge più nodi coi soli collegamenti non vecchi; a parità, id più basso; nessun router → null;
  6. `missingNeighbors` non conta i client e non conta i nodi già visibili.

- [ ] **Step 2: vederle fallire**, poi **Step 3: il codice** — Prim deterministico (dal prototipo approvato):

```ts
export function buildTree(model: TopologyModel, visible: ReadonlySet<string>, roots: readonly string[]): TreeResult {
  const nodes = new Map(model.nodes.map((n) => [n.id, n]));
  const adj = new Map<string, MapLink[]>();
  for (const l of model.links) {
    if (!visible.has(l.a) || !visible.has(l.b)) continue;
    adj.set(l.a, [...(adj.get(l.a) ?? []), l]);
    adj.set(l.b, [...(adj.get(l.b) ?? []), l]);
  }
  const cost = (l: MapLink) => (l.stale ? 100 : 0) + LINK_SOURCE_RANK[l.source];
  const taken = new Set<string>(); const children = new Map<string, string[]>(); const via = new Map<string, MapLink>(); const outRoots: string[] = [];
  const grow = (r: string) => {
    taken.add(r); children.set(r, []); outRoots.push(r);
    for (;;) {
      let best: { c: number; from: string; to: string; l: MapLink } | null = null;
      for (const x of [...taken].sort()) {
        const cls = nodeClass(nodes.get(x)!);
        if (cls === "att" || cls === "client") continue;
        for (const l of adj.get(x) ?? []) {
          const to = l.a === x ? l.b : l.a;
          if (taken.has(to)) continue;
          const c = cost(l);
          if (!best || c < best.c || (c === best.c && (x + "|" + to) < (best.from + "|" + best.to))) best = { c, from: x, to, l };
        }
      }
      if (!best) return;
      taken.add(best.to); children.set(best.to, []); children.get(best.from)!.push(best.to); via.set(best.to, best.l);
    }
  };
  for (const r of roots) if (visible.has(r) && !taken.has(r)) grow(r);
  const rest = [...visible].filter((x) => !taken.has(x) && nodes.has(x)).sort((a, b) =>
    Number(nodeClass(nodes.get(a)!) !== "infra") - Number(nodeClass(nodes.get(b)!) !== "infra")
    || (adj.get(b)?.length ?? 0) - (adj.get(a)?.length ?? 0) || (a < b ? -1 : 1));
  for (const r of rest) if (!taken.has(r)) grow(r);
  return { roots: outRoots, children, via };
}
```

```ts
/** Mappa automatica (spec §10.2): niente client, niente isolati («Da sistemare»), niente nascosti. */
export function autoVisible(model: TopologyModel): Set<string> {
  const isolated = new Set(model.isolated);
  return new Set(model.nodes.filter((n) => nodeClass(n) !== "client" && !n.hidden && !isolated.has(n.id)).map((n) => n.id));
}

/** Testa confermata di una sede; altrimenti il router (apparato) che raggiunge più nodi coi collegamenti non vecchi. */
export function proposeHead(model: TopologyModel): string | null {
  const confirmed = model.sites.find((s) => s.headNodeId !== null && !s.headProposed)?.headNodeId;
  if (confirmed) return confirmed;
  const fresh = new Map<string, string[]>();
  for (const l of model.links) {
    if (l.stale) continue;
    fresh.set(l.a, [...(fresh.get(l.a) ?? []), l.b]);
    fresh.set(l.b, [...(fresh.get(l.b) ?? []), l.a]);
  }
  let best: string | null = null;
  let size = -1;
  for (const n of model.nodes.filter((x) => x.kind === "device" && x.type === "router").sort((a, b) => a.refId - b.refId)) {
    const seen = new Set([n.id]);
    const q = [n.id];
    while (q.length) for (const y of fresh.get(q.shift()!) ?? []) if (!seen.has(y)) { seen.add(y); q.push(y); }
    if (seen.size > size) { size = seen.size; best = n.id; }
  }
  return best;
}

/** Il «+N» (spec §10.2): collegamenti verso nodi che non sono client e non sono ancora nella mappa. */
export function missingNeighbors(model: TopologyModel, nodeId: string, visible: ReadonlySet<string>): MapLink[] {
  const byId = new Map(model.nodes.map((n) => [n.id, n]));
  return model.links.filter((l) => {
    if (l.a !== nodeId && l.b !== nodeId) return false;
    const other = byId.get(l.a === nodeId ? l.b : l.a);
    return !!other && !visible.has(other.id) && nodeClass(other) !== "client";
  });
}
```

La testa della mappa automatica nella pagina è `getAutoMap()?.head_node ?? proposeHead(model)`.

- [ ] **Step 4: verdi**; **Step 5: commit**

```bash
git add src/lib/topology/tree.ts src/lib/topology/__tests__/tree.test.ts
git commit -m "feat(topologia): albero dagli oggetti di partenza e testa proposta (Prim deterministico)"
```

---

### Task 9: La disposizione

**Files:**
- Create: `src/lib/topology/tree-layout.ts`
- Test: `src/lib/topology/__tests__/tree-layout.test.ts`

**Interfaces:**
- Consumes: `TreeResult`, `TopologyModel`, `nodeClass`.
- Produces:
  - costanti `BOX_H = 44`, `GAP = 18`, `LEVEL_GAP = 56`, `AP_W = 150`, `AP_H = 40`, `AP_COLS = 4`, `ATT_W = 160`, `ATT_ROW = 20`, `ATT_MAX = 4`, `CHAR_W = 7`
  - `nodeWidth(label: string): number` = `min(230, max(170, label.length * CHAR_W + 44))`; `fitLabel(label: string, width: number): string` (tronca con «…» a `floor((width - 44) / CHAR_W)` caratteri)
  - `structureSig(tree: TreeResult, nodeId: string): string` = genitore + fratelli ordinati, uniti da `|`
  - `SavedTweak = { nodeId: string; x: number; y: number; sig: string | null }`
  - `LayoutNode = { id: string; x: number; y: number; w: number; h: number; role: "box" | "ap" | "attached"; parent: string | null }`
  - `LayoutResult = { nodes: Map<string, LayoutNode>; apGroups: Array<{ parent: string; x: number; y: number; w: number; h: number; count: number }>; moreAttached: Map<string, number>; width: number; height: number; expired: string[] }`
  - `layoutTree(model: TopologyModel, tree: TreeResult, tweaks: SavedTweak[]): LayoutResult`

- [ ] **Step 1: prove che falliscono** (le garanzie del §7 della spec):
  1. **stessi dati → stesse coordinate** (due chiamate, `deepEqual` sul risultato serializzato);
  2. **un AP in più non sposta gli altri rami**: switch con 3 AP e un fratello; con 4 AP le coordinate del fratello e del suo ramo non cambiano (il gruppo degli AP occupa sempre `AP_COLS` colonne); con 5 AP cresce solo l'altezza;
  3. **nessuna scritta esce dal nodo**: per ogni nodo, `fitLabel(nome, w).length * CHAR_W + 44 <= w`; un nome di 80 caratteri finisce con «…»;
  4. **fascia degli attaccati**: 6 server sotto uno switch → 4 visibili accanto al riquadro (`role: "attached"`), `moreAttached.get(switch) === 2`; nessun attaccato si sovrappone a una linea verso i figli (gli attaccati stanno a destra del riquadro, i figli sotto);
  5. **ritocco**: un ritocco con `sig` uguale sposta il nodo **e il suo ramo** dello stesso scarto; con `sig` diversa non si applica e il nodo finisce in `expired`;
  6. il riquadro del genitore è centrato sopra il blocco dei suoi figli (entro 1 px), anche con la fascia degli attaccati.

- [ ] **Step 2: vederle fallire** — `node --import tsx --test src/lib/topology/__tests__/tree-layout.test.ts` → FAIL.

- [ ] **Step 3: il codice** (algoritmo d'albero ordinato del prototipo approvato; niente librerie)

```ts
// src/lib/topology/tree-layout.ts
/**
 * Disposizione dell'albero (spec §4 livello 2, §5 pezzo 2, §10): livelli fissi,
 * figli infrastruttura in fila sotto il genitore, AP senza figli in un gruppo a
 * griglia che occupa SEMPRE AP_COLS colonne (un AP in più non sposta gli altri
 * rami), attaccati in colonna a destra del riquadro (non coprono le linee verso
 * i figli), riquadro centrato sopra i figli. Ritocchi a mano: valgono finché la
 * firma (genitore + fratelli) non cambia. Logica pura: stessi dati, stesse
 * coordinate.
 */
import type { TopologyModel } from "@/lib/topology/model-types";
import { nodeClass } from "@/lib/topology/identity";
import type { TreeResult } from "@/lib/topology/tree";

export const BOX_H = 44, GAP = 18, LEVEL_GAP = 56, AP_W = 150, AP_H = 40, AP_COLS = 4, AP_HEAD = 18;
export const ATT_W = 160, ATT_ROW = 20, ATT_MAX = 4, CHAR_W = 7, ROOT_GAP = 60, MARGIN = 40;
const AP_BLOCK = AP_COLS * (AP_W + 8);
const ATT_SIDE = ATT_W + 10;

export function nodeWidth(label: string): number {
  return Math.min(230, Math.max(170, label.length * CHAR_W + 44));
}

export function fitLabel(label: string, width: number): string {
  const max = Math.floor((width - 44) / CHAR_W);
  return label.length > max ? `${label.slice(0, Math.max(1, max - 1))}…` : label;
}

export function structureSig(tree: TreeResult, nodeId: string): string {
  let parent = "";
  for (const [p, kids] of tree.children) if (kids.includes(nodeId)) { parent = p; break; }
  const siblings = parent ? [...(tree.children.get(parent) ?? [])].sort() : [...tree.roots].sort();
  return `${parent}|${siblings.join(",")}`;
}

export interface SavedTweak { nodeId: string; x: number; y: number; sig: string | null }
export interface LayoutNode { id: string; x: number; y: number; w: number; h: number; role: "box" | "ap" | "attached"; parent: string | null }
export interface LayoutResult {
  nodes: Map<string, LayoutNode>;
  apGroups: Array<{ parent: string; x: number; y: number; w: number; h: number; count: number }>;
  moreAttached: Map<string, number>;
  width: number;
  height: number;
  expired: string[];
}

export function layoutTree(model: TopologyModel, tree: TreeResult, tweaks: SavedTweak[]): LayoutResult {
  const byId = new Map(model.nodes.map((n) => [n.id, n]));
  const name = (id: string) => byId.get(id)?.name ?? id;
  const cls = (id: string) => { const n = byId.get(id); return n ? nodeClass(n) : "client"; };
  const order = (a: string, b: string) =>
    Number(cls(a) !== "infra") - Number(cls(b) !== "infra") || name(a).localeCompare(name(b), "it") || (a < b ? -1 : 1);
  const parts = (id: string) => {
    const kids = tree.children.get(id) ?? [];
    const att = kids.filter((k) => cls(k) === "att" || cls(k) === "client").sort(order);
    const ap = kids.filter((k) => cls(k) === "ap" && (tree.children.get(k)?.length ?? 0) === 0).sort(order);
    const inf = kids.filter((k) => !att.includes(k) && !ap.includes(k)).sort(order);
    return { inf, ap, att };
  };

  const levelH: number[] = [];
  const width = new Map<string, number>();
  const kidsWidth = (p: ReturnType<typeof parts>) => {
    const items = p.inf.map((k) => width.get(k)!).concat(p.ap.length ? [AP_BLOCK] : []);
    return items.length ? items.reduce((s, v) => s + v, 0) + GAP * (items.length - 1) : 0;
  };
  const measure = (id: string, lvl: number): void => {
    const p = parts(id);
    const shown = Math.min(p.att.length, ATT_MAX) + (p.att.length > ATT_MAX ? 1 : 0);
    levelH[lvl] = Math.max(levelH[lvl] ?? 0, BOX_H, shown * ATT_ROW);
    for (const k of p.inf) measure(k, lvl + 1);
    if (p.ap.length) levelH[lvl + 1] = Math.max(levelH[lvl + 1] ?? 0, AP_HEAD + Math.ceil(p.ap.length / AP_COLS) * (AP_H + 6));
    // Il riquadro sta al centro: lo spazio della fascia si riserva da tutti e due i lati.
    width.set(id, Math.max(nodeWidth(name(id)) + (p.att.length ? 2 * ATT_SIDE : 0), kidsWidth(p)));
  };
  for (const r of tree.roots) measure(r, 0);
  const y: number[] = [MARGIN];
  for (let i = 1; i <= levelH.length; i++) y[i] = y[i - 1] + (levelH[i - 1] ?? BOX_H) + LEVEL_GAP;

  const nodes = new Map<string, LayoutNode>();
  const apGroups: LayoutResult["apGroups"] = [];
  const moreAttached = new Map<string, number>();
  const place = (id: string, x: number, lvl: number, parent: string | null): void => {
    const p = parts(id);
    const w = width.get(id)!;
    const box = nodeWidth(name(id));
    const cx = x + w / 2;
    nodes.set(id, { id, x: cx - box / 2, y: y[lvl], w: box, h: BOX_H, role: "box", parent });
    p.att.slice(0, ATT_MAX).forEach((a, i) =>
      nodes.set(a, { id: a, x: cx + box / 2 + 10, y: y[lvl] + i * ATT_ROW, w: ATT_W, h: ATT_ROW - 2, role: "attached", parent: id }));
    if (p.att.length > ATT_MAX) moreAttached.set(id, p.att.length - ATT_MAX);
    let cur = cx - kidsWidth(p) / 2;
    for (const k of p.inf) { place(k, cur, lvl + 1, id); cur += width.get(k)! + GAP; }
    if (p.ap.length) {
      p.ap.forEach((a, i) => nodes.set(a, {
        id: a, x: cur + (i % AP_COLS) * (AP_W + 8), y: y[lvl + 1] + AP_HEAD + Math.floor(i / AP_COLS) * (AP_H + 6),
        w: AP_W, h: AP_H, role: "ap", parent: id,
      }));
      apGroups.push({ parent: id, x: cur - 4, y: y[lvl + 1], w: AP_BLOCK, h: AP_HEAD + Math.ceil(p.ap.length / AP_COLS) * (AP_H + 6) + 4, count: p.ap.length });
    }
  };
  let x = MARGIN;
  for (const r of tree.roots) { place(r, x, 0, null); x += width.get(r)! + ROOT_GAP; }

  // Ritocchi: lo scarto vale per il nodo e tutto il suo ramo (attaccati e gruppo AP compresi).
  const expired: string[] = [];
  for (const t of [...tweaks].sort((a, b) => (a.nodeId < b.nodeId ? -1 : 1))) {
    const n = nodes.get(t.nodeId);
    if (!n || n.role !== "box") continue;
    if (t.sig !== structureSig(tree, t.nodeId)) { expired.push(t.nodeId); continue; }
    const dx = t.x - n.x, dy = t.y - n.y;
    const branch = new Set<string>([t.nodeId]);
    const q = [t.nodeId];
    while (q.length) for (const k of tree.children.get(q.shift()!) ?? []) if (!branch.has(k)) { branch.add(k); q.push(k); }
    for (const id of branch) { const m = nodes.get(id); if (m) nodes.set(id, { ...m, x: m.x + dx, y: m.y + dy }); }
    for (const g of apGroups) if (branch.has(g.parent)) { g.x += dx; g.y += dy; }
  }
  let maxX = 0, maxY = 0;
  for (const n of nodes.values()) { maxX = Math.max(maxX, n.x + n.w); maxY = Math.max(maxY, n.y + n.h); }
  for (const g of apGroups) { maxX = Math.max(maxX, g.x + g.w); maxY = Math.max(maxY, g.y + g.h); }
  return { nodes, apGroups, moreAttached, width: maxX + MARGIN, height: maxY + MARGIN, expired };
}
```

- [ ] **Step 4: verdi**; **Step 5: commit**

```bash
git add src/lib/topology/tree-layout.ts src/lib/topology/__tests__/tree-layout.test.ts
git commit -m "feat(topologia): disposizione ad albero — livelli fissi, AP in fila, fascia degli attaccati, ritocchi che scadono"
```

---

## Tappa C — la pagina (livello leggero)

### Task 10: Mappe salvate, ritocchi e «nascondi» nel DB e nelle rotte

**Files:**
- Modify: `src/lib/db-tenant.ts` (sezione TOPOLOGIA), `src/lib/topology/api-input.ts`, `src/app/api/topology/positions/route.ts`
- Create: `src/app/api/topology/maps/route.ts`, `src/app/api/topology/maps/[id]/route.ts`, `src/app/api/topology/maps/[id]/nodes/route.ts`, `src/app/api/topology/nodes/hidden/route.ts`
- Test: `src/lib/__tests__/topology-maps-db.test.ts`, aggiunte a `src/lib/topology/__tests__/api-input.test.ts`

**Interfaces:**
- Consumes: tabella `topology_maps` (Task 1), `topology_position`.
- Produces (db-tenant):
  - `TopologyMapRow = { id: number; name: string; kind: "auto" | "passo"; roots: string[]; head_node: string | null; created_by: string | null; created_at: string; updated_at: string }`
  - `listTopologyMaps(): TopologyMapRow[]` (solo `passo`, per nome), `getTopologyMap(id): TopologyMapRow | null`, `getAutoMap(): TopologyMapRow | null`
  - `createTopologyMap(input: { name: string; roots: string[]; nodes: string[] }, author: string): TopologyMapRow`
  - `updateTopologyMap(id: number, patch: { name?: string; roots?: string[] }): Esito`
  - `setTopologyMapNodes(id: number, add: string[], remove: string[]): Esito` (aggiungi = `INSERT … ON CONFLICT DO NOTHING` con `pinned 0, x 0, y 0`; togli = `DELETE`; un nodo tolto esce anche da `roots`)
  - `deleteTopologyMap(id: number): boolean` (una transazione: righe di `topology_position` con `view = 'mappa:<id>'` e la mappa)
  - `getTopologyMapView(view: string): { nodes: string[]; tweaks: Array<{ nodeId: string; x: number; y: number; sig: string | null }> }`
  - `saveTopologyTweaks(view: string, rows: Array<{ nodeId: string; x: number; y: number; sig: string }>): void`; `clearTopologyTweaks(view: string): void` («Riordina»: `pinned = 0` per le mappe passo passo, `DELETE` per `auto`)
  - `setAutoHead(nodeId: string | null, author: string): void` (crea la riga `auto` «Tutta la rete» se manca)
  - `setNodeHidden(deviceId: number, hidden: boolean): Esito`
- Rotte: `GET/POST /api/topology/maps`; `GET/PATCH/DELETE /api/topology/maps/[id]`; `PUT /api/topology/maps/[id]/nodes` (`{ add: string[], remove: string[] }`); `PUT /api/topology/positions` (`{ view, tweaks }` o `{ view, clear: true }`); `PUT /api/topology/nodes/hidden` (`{ node_id: "dev:N", hidden }`); `PUT /api/topology/maps/auto/head` dentro la rotta `[id]` con `id = "auto"`.

- [ ] **Step 1: prove che falliscono**
  - DB: creare una mappa con 2 nodi e una radice → `getTopologyMapView('mappa:<id>').nodes` ha 2 nodi; `setTopologyMapNodes(id, ["dev:3"], ["dev:1"])` → nodi `dev:2, dev:3`, `roots` senza `dev:1`; aggiungere due volte lo stesso nodo non crea doppi e **non cancella un ritocco** già salvato su quel nodo (Review Focus 4); `deleteTopologyMap` toglie mappa e righe in una transazione; una mappa con un nodo che non esiste più si legge lo stesso (il nodo resta nell'elenco: la pagina lo dichiara «non più presente», Review Focus 3); seconda `setAutoHead` aggiorna la stessa riga.
  - Zod (`api-input.ts`): nome vuoto o oltre 80 caratteri rifiutato con messaggio italiano; nodi che non sono `dev:N`/`host:N` rifiutati; più di 2000 nodi in un colpo rifiutati; `hidden` accetta solo `dev:N`.

- [ ] **Step 2: vederle fallire**; **Step 3: il codice** — funzioni DB con `runInTenantTransaction` dove scrivono più righe; rotte nello stile di `src/app/api/topology/links/route.ts` (`withTenantFromSession`, `requireAuth`/`requireAdmin` come prima riga, parser di `api-input.ts`, `NO_STORE`, errori 400 col messaggio del parser, 404 se la mappa non c'è, 500 con messaggio generico e `console.error` senza dati del cliente). `positions/route.ts`: lo schema accetta `{ view: /^(auto|mappa:\d+)$/, tweaks: [...] }` o `{ view, clear: true }` e scrive `structure_sig`.

- [ ] **Step 4: verdi**; **Step 5: commit**

```bash
git add src/lib/db-tenant.ts src/lib/topology/api-input.ts src/app/api/topology/ src/lib/__tests__/topology-maps-db.test.ts src/lib/topology/__tests__/api-input.test.ts
git commit -m "feat(topologia): mappe passo passo salvate, ritocchi con firma, nascondi — DB e rotte"
```

---

### Task 11: Lo stato nel modello e la pagina nuova

**Files:**
- Create: `src/lib/topology/status-map.ts`, `src/components/topology/map/{topology-map-client,object-list,map-canvas,map-node,linked-panel,map-toolbar,topology-icons,use-topology-data}.tsx|ts`
- Modify: `src/app/api/topology/model/route.ts` (aggiunge `status`), `src/app/(dashboard)/topology/page.tsx`
- Test: `src/lib/topology/__tests__/status-map.test.ts`

**Interfaces:**
- Consumes: tutto B, rotte del Task 10, `GET /api/topology/model`.
- Produces: `computeStatusByNode(data: ReturnType<typeof getTopologyData>, nowMs: number): Record<string, TopologyStatus>` (lo stesso calcolo che oggi sta nel GET di `src/app/api/topology/route.ts`, spostato qui e coperto da prova); la risposta del modello ha `status` con chiavi canoniche (un host fuso prende lo stato peggiore fra apparato e host).

- [ ] **Step 1: prova che fallisce** per `computeStatusByNode` (apparato disattivato → `unknown`; host offline → `fail`; uplink giù → `warning`, come le prove di `status.test.ts`). Verde, poi il modello la usa.

- [ ] **Step 2: la pagina** (l'interfaccia è quella del prototipo approvato il 13/10, la bozza in `.superpowers/brainstorm/` sul MacBook, fuori da git; qui la si riscrive con i componenti dell'app):
  - **`map-toolbar.tsx`**: interruttore a due segmenti **«Tutto automatico» / «Passo passo»** (il segmento attivo con fondo pieno **e** «●» davanti: doppio segnale); nel passo passo un `Select` delle mappe + «Nuova mappa…» (dialogo col nome) + «Rinomina» + «Elimina» (conferma); nell'automatico «Testa: <nome>» con la provenienza in parole («proposta dal sistema» / «scelta da <autore>») e **«Crea una mappa passo passo da qui»**; a destra «Collegamenti in più» (casella), «−», «+», «Adatta», **«Riordina»** (solo admin, toglie i ritocchi).
  - **`object-list.tsx`** (300 px, a sinistra): ricerca nome/IP/alias; gruppi apribili «Router e firewall», «Switch», «Access point», «Server e attaccati», «Client» (chiuso), «Da sistemare» (isolati, tipi sospetti, proposte promuovi); per voce icona 18 px, nome, «✓ nella mappa» o (passo passo, admin) **«Inserisci»**. Liste lunghe: «+ altri N» oltre 200 per gruppo.
  - **`map-canvas.tsx`**: React Flow con nodi **fissi** nelle coordinate di `layoutTree` (`nodesDraggable` solo per admin; al rilascio si calcola lo scarto e si salva il ritocco con `structureSig` via `PUT /api/topology/positions`), archi `type: "step"` (ad angolo retto) con etichetta «porta mia → porta sua» e, se vecchio, linea grigia tratteggiata + «non visto da N g»; collegamenti in più (fuori dall'albero) tratteggiati sottili, solo con la casella; riquadro tenue del gruppo AP con «N AP».
  - **`map-node.tsx`**: riquadro col testo misurato (`nodeWidth`/`fitLabel`, nome intero nel `title`), icona 26 px, seconda riga «IP · N client» (client solo su switch/AP), stato: **giù = bordo rosso pieno + «▲ giù»**, sconosciuto = «?»; host da promuovere = bordo tratteggiato + «host · da promuovere»; passo passo: segno **«+N»** (fondo giallo, testo navy, il numero) e «▶ partenza» sugli oggetti di partenza; attaccati come etichette 160×18 a destra del riquadro, «+ altri N».
  - **`linked-panel.tsx`** (400 px, a destra, al clic su un oggetto): nome, tipo, alias («si annuncia come …»), **tutti gli indirizzi** (virtuali con «virtuale VRRP»); azioni — passo passo: «Togli dalla mappa» / «Aggiungi alla mappa», «Usa come partenza»; automatico: «Usa come testa»; sempre (admin): «Nascondi dalla mappa», e per un host infrastruttura il link **«Promuovi ad apparato»** → `/objects/<hostId>?promote=1` (la promozione esiste già); tabella **«Collegato a (N)»** (oggetto, porte, fonte in parole, «✓ visto oggi» / «▲ non visto da N g», «Aggiungi» o «✓ nella mappa»), «Aggiungi tutti gli apparati collegati» (non gli host); tabella **«Porte con dispositivi attaccati»** (porta, MAC, nome/IP se noti, «visto l'ultima volta» per i vecchi).
  - **`use-topology-data.ts`**: carica modello, mappe e vista con `fetchJson` + `LoadError` (un errore si vede come errore, mai «mappa vuota»); aggiornamento automatico ogni 30 s con `setInterval` dentro `useEffect` + `useRef` e pulizia (regola 8 del repo); dopo una scrittura, ricarica.
  - **`topology-icons.tsx`**: il set approvato il 13/10 (router, switch, switch L3 con badge «L3», firewall, AP, server, hypervisor, NAS, telefono, stampante, telecamera, Internet, client) come `<symbol>` SVG in un componente, colori dai token Domarc; **switch e switch L3 distinguibili a 20 px**.
  - **`topology-map-client.tsx`**: lo stato (modo, mappa scelta, oggetto selezionato), la mappa vuota del passo passo con la spiegazione di una riga («Scegli dall'elenco a sinistra un oggetto da cui partire…»), gli oggetti di una mappa che non esistono più elencati in fondo al pannello come «non più presente: <id>» con «Togli».
  - **`page.tsx`**: titolo «Topologia», link «Dati della mappa», niente fascia di spiegazioni (lo spazio sullo schermo è un vincolo).

- [ ] **Step 3: tipi e lint** — `npx tsc --noEmit && npm run lint`, puliti.

- [ ] **Step 4: commit**

```bash
git add src/lib/topology/status-map.ts src/lib/topology/__tests__/status-map.test.ts src/components/topology/map/ src/app/api/topology/model/route.ts "src/app/(dashboard)/topology/page.tsx"
git commit -m "feat(topologia): pagina nuova — tutto automatico e mappe passo passo, pannello dei collegati, attaccati e client"
```

---

### Task 12: Via la mappa vecchia, e la verifica a schermo sulla copia

**Files:**
- Delete: `src/app/(dashboard)/topology/topology-client.tsx`, `src/app/(dashboard)/topology/status-node.tsx`, `src/lib/topology/layout.ts` (e la sua prova se c'è), il `GET` di `src/app/api/topology/route.ts` (il file si toglie se non resta altro)
- Modify: `package.json` / `package-lock.json` (`npm uninstall dagre @types/dagre`), `scripts/misura-topologia.ts` (la parte «prima» con `buildTopologyGraph` resta solo se `graph.ts` resta: verificarlo con `grep -rn "topology/graph" src scripts`)

- [ ] **Step 1: togliere** e verificare che niente li importi più: `grep -rn -E "topology/layout|status-node|topology-client|from \"dagre\"" src scripts` → nessuna riga.

- [ ] **Step 2: tipi, lint, prove della topologia, build** — `npx tsc --noEmit && npm run lint && node --import tsx --test "src/lib/topology/__tests__/*.test.ts" && npm run build`, con `exit=` letto.

- [ ] **Step 3: a schermo, in locale, sulla copia** (ricetta del Task 15 passo 5 della fase 1): app locale con la **copia della copia** di cliente A (e poi dell'hub) in `$S/ui`, hub di prova creato da `/setup` con password generata sul posto in un file `chmod 600`, porta 3101. Con `playwright-core` (`channel: "chrome"`, viewport **1920×1080** e **1280×800**, `innerWidth` letto e stampato): `/topology` in automatico (intera con «Adatta» e al 100 %), passo passo vuoto, mappa nuova «Prova» con i tre router inseriti, clic su un router → pannello, «Aggiungi tutti gli apparati collegati», un trascinamento → ricarica → il ritocco resta; «Riordina» → torna automatico; server spento → errore in vista, non mappa vuota. Si controlla: **nessuna scritta fuori dai riquadri**, «+ altri N» dove serve, stato scritto in parole, un nodo per oggetto (il router principale una volta, con i suoi indirizzi nel pannello). Foto nello scratchpad, **mai nel repo** (contengono nomi veri).

- [ ] **Step 4: commit**

```bash
git add -A src/app/api/topology "src/app/(dashboard)/topology" src/lib/topology package.json package-lock.json scripts/misura-topologia.ts
git commit -m "refactor(topologia): via la mappa vecchia e dagre — la pagina nuova la sostituisce"
```

(`git add -A` qui è limitato ai percorsi elencati, nel worktree della sessione: nessun file altrui.)

---

### Task 13: Fixture riestratte dal dato vero, anonimizzate

**Files:**
- Modify: `src/lib/topology/anonimizza.ts` (anche `macPorts`: MAC e nomi di porta anonimizzati con lo stesso vocabolario), `scripts/estrai-fixture-topologia.ts`, `src/lib/topology/__tests__/fixture-anonime.test.ts` (forma: il campo `macPorts`), `src/lib/topology/__tests__/fixtures/topologia-{domarc,cliente-a}.json`, `src/lib/topology/__tests__/model-fixtures.test.ts`

Da fare **dopo** che il ramo A e il ramo B sono uniti in locale (Task 14 punto a) e dopo la misura sulle copie con la lettura dei client (Task 14 punto c): le copie misurate hanno uplink, MAC per porta e oggetti con più IP veri. Per l'hub: se Riccardo non ha ancora fatto «Leggi ora» del controller #1, la misura legge gli apparati **sulla copia** con `scripts/misura-topologia.ts --unifi 1 --segreto-stdin` prima di estrarre.

- [ ] **Step 1: prova sulla forma che fallisce** — `fixture-anonime.test.ts` pretende `macPorts` con la forma fissata campo per campo; le fixture vecchie non l'hanno → FAIL.
- [ ] **Step 2: anonimizzatore + estrazione** — `estrai-fixture-topologia.ts` sulle due copie misurate; lo script non scrive se `contaValoriVeri` non dà zero.
- [ ] **Step 3: prove sulle fixture** in `model-fixtures.test.ts`: (a) nessun nodo con lo stesso nome annunciato due volte fra l'infrastruttura; (b) su cliente A gli uplink salvati sono > 0 e i collegamenti `unifi_uplink` > 0; (c) `layoutTree(buildTree(autoVisible))` due volte → coordinate identiche; (d) nessuna scritta fuori dal nodo su tutti i nodi; (e) i conteggi principali (nodi, collegamenti, isolati, client) uguali a quelli misurati, scritti nella prova con un commento che dice da dove vengono (data e copia, senza nomi).
- [ ] **Step 4: verdi** (`node --import tsx --test "src/lib/topology/__tests__/*.test.ts"`) e **commit**

```bash
git add src/lib/topology/anonimizza.ts scripts/estrai-fixture-topologia.ts src/lib/topology/__tests__/
git commit -m "test(topologia): fixture riestratte (anonime) con uplink, MAC per porta e oggetti con più indirizzi"
```

---

## Uscita sul dato vero (sessione principale)

### Task 14: Unione, cancello, misura sulle copie, conferma, rilascio

- [ ] **(a) Unione in locale** — worktree pulito da `origin/dev`: `git merge --no-ff origin/topologia/f2-raccolta` poi `origin/topologia/f2-mappa`; conflitti risolti tenendo **entrambe** le aggiunte (`model-types.ts`, `db-tenant.ts`).
- [ ] **(b) Cancello completo una volta**, in sottofondo, log nello scratchpad:

```bash
LOG="$S/cancello-f2.log"; (npm run lint && npx tsc --noEmit && DA_INVENT_DATA_DIR=$(mktemp -d "${TMPDIR:-/tmp}/f2.XXXXXX") npm test && npm run build) > "$LOG" 2>&1; ESITO=$?; echo "exit=$ESITO"; grep -E "^# (tests|pass|fail)" "$LOG"
```
Atteso `exit=0`. Una prova rossa nota da prima del lavoro si nomina nel rapporto; una nuova ferma tutto.
- [ ] **(c) Misura sulle copie** — copie fresche con l'API di backup (un ssh per server, `node` con `better-sqlite3` in sola lettura su cliente A che non ha `sqlite3`), poi `scripts/misura-mac-porta.ts` su ciascuna: migrazione (durata, cose aggiunte, `integrity_check` prima e dopo) e, con `--unifi <id> --segreto-stdin`, lettura dei client **in sola lettura** sulla copia. Il segreto dal vault: un filtro che stampa **solo** il valore della chiave del controller di quel cliente e **fallisce chiuso** (esce ≠0 senza stampare se la sezione o la riga non hanno la forma attesa); provato prima con un vault finto nello scratchpad; poi `filtro | npx tsx scripts/misura-mac-porta.ts …`. Si confronta qui la forma vera di `stat/sta` con la fixture del Task 3: se un campo ha un altro nome, si corregge prima di andare avanti. Poi `scripts/misura-topologia.ts` sulle stesse copie per i conteggi del modello prima/dopo (nodi, doppi tolti, client contati, collegamenti `mac_table`).
- [ ] **(d) `quick_check` di TUTTI i tenant** di cliente A e dell'hub, in sola lettura, prima di qualunque scrittura (il 13/10 il 70791a era rovinato da prima). Un tenant rovinato ferma il rilascio su quella macchina e si dice.
- [ ] **(e) CONFERMA DI RICCARDO** — un messaggio solo, con: numeri della misura su ciascuna copia (durata della migrazione, righe tolte come doppi, righe MAC per fonte, client letti e non abbinati, nodi prima/dopo), esito dei `quick_check`, cosa succede sul server (copia del DB in `data/backups/<tenant>-pre-topologia-f2-<data>.db`, push di `dev` → cliente A si aggiorna da solo entro 15 minuti; hub con «Aggiorna» come per la fase 1), e la domanda separata per **accendere il job dei client** su cliente A e sull'hub (resta spento se dice di no). Ora in ora italiana.
- [ ] **(f) Dopo il sì** — copie sul server con l'API di backup (nome sopra); `npm run version:release`; push di `dev`; versione letta su cliente A e hub (`/api/version`); `quick_check` dei tenant dopo la migrazione; `journalctl` dell'avvio con la riga della migrazione fase 2; conteggi rifatti sul server in sola lettura e confrontati con la copia. Job dei client acceso solo se confermato, dalla pagina Controller di rete (o con `setControllerClientSchedule` via la rotta, come admin).

### Task 15: Documenti e chiusura

- [ ] **ADR 0009** `docs/adr/0009-topologia-fase2-mappe-e-mac.md` (dal template): decisione *«le mappe passo passo si salvano (tabella `topology_maps` + `topology_position`), l'automatica si ricalcola; un oggetto fisico è un nodo per MAC vero e nome annunciato, mai per MAC virtuale o seriale dell'host; la tabella dei MAC per porta invecchia per 30 giorni, scritta da SNMP/SSH e dai client UniFi»*; alternative scartate (JSON in `tenant_settings`; storico degli spostamenti dei MAC; seriale come chiave); **cosa diventa difficile**: unire o separare a mano due oggetti non si può (serve una tabella); i job dei client spenti = attaccati solo da SNMP/SSH e LLDP; la finestra 7-20 è fissa nel codice; `mac_port_entries` ora ha due scrittori (apparato e controller) con chiave comune; la vecchia vista `default` di `topology_position` resta orfana.
- [ ] **ADR 0003**: in testa «la pagina e la disposizione sono superate dalla fase 2 (ADR 0009)».
- [ ] **CHANGELOG** `## [Non rilasciato] — <data>`: Aggiunte (mappa automatica e mappe passo passo; tabella dei MAC per porta; lettura dei client UniFi); Modifiche (la tabella dei MAC per porta non si cancella più a ogni lettura — perché: «dove è attaccato» deve sopravvivere a un PC spento; un oggetto con più indirizzi è un nodo solo — perché: Riccardo vedeva lo stesso router tre volte); Correzioni (i MAC virtuali VRRP non fondono più un host con un router).
- [ ] **CONTEXT.md** §6, voce «Mappa topologia»: fase 2 fatta, cosa vive dove, trappole (MAC virtuali, seriali degli host inaffidabili, job dei client spento di default, finestra 7-20).
- [ ] **Spec** §6: fase 2 = fatta con la versione; **bacheca** `~/.claude/lavori/piano-miglioramento-da-ipam.md` (Prossimo passo: fase 3 «le sedi», con il fatto che né cliente A né l'hub hanno sedi definite); `docs/scheda-mappa.md` se cambia la trappola corrente; lezioni nuove in `~/.claude/lezioni/DA-IPAM.md`.
- [ ] **Istruzioni a Riccardo passo passo** per guardare la mappa sull'hub e su cliente A a 1920: pagina, clic, cosa vede se va bene, cosa se va male.
- [ ] Rami di lavoro uniti in `dev` e cancellati, worktree tolti.

---

## Self-review (fatta)

- **Copertura della spec §10**: 10.1 (fatti) → Task 6 (MAC virtuali, alias), 7 (router non conta client), 11 (promuovi dal pannello); 10.2 (due modi, mappe con nome, +N, pannello, «crea da qui», niente ingresso automatico nelle mappe passo passo) → Task 8, 10, 11; 10.3 (cosa è un nodo, client come conteggio su switch/AP) → Task 7, 8, 11; 10.4 (un oggetto un nodo) → Task 6; 10.5 (MAC per porta: fonti, finestra 7-20 spenta di default, 30 giorni, porta di bordo, livello completo) → Task 1-5, 7, 14; 10.6 (`topology_maps`, `topology_position.view`, cosa vale per mappa e cosa per rete) → Task 1, 10, 11; 10.7 (prove e fixture) → Task 6-9, 13. §7 (stessi dati stesse coordinate, AP in più, nessuna scritta fuori, manuale vince, non visto non scompare) → Task 9, 13 + prove della fase 1 che restano. Icone con L3 distinguibile a 20 px → Task 11.
- **Fuori di proposito** (spec §6, fasi 3-4): sedi e livello 1, collegamenti fra sedi, ricerca che porta al punto oltre la lista, filtri, livello 3 porte, export drawio, clic destro; unire/separare a mano (spec §10.4).
- **Nomi coerenti**: `upsertMacPortEntries(id, entries, source)`, `macPortListFromPorts`, `parseStatStaResponse`, `mapClientsToPorts`, `syncUnifiClientsForController`, `unifiJobKind`, `inFinestraClient`, `setControllerClientSchedule`, `isVirtualMac`, `announcedNames`, `buildNodeIndex(…, neighbors)`, `attachMacs`, `nodeClass`, `buildTree`, `proposeHead`, `autoVisible`, `missingNeighbors`, `layoutTree`, `structureSig`, `nodeWidth`, `fitLabel`, `TopologyMapRow`, `setTopologyMapNodes`, `getTopologyMapView`, `saveTopologyTweaks`, `clearTopologyTweaks`, `setAutoHead`, `setNodeHidden`, `computeStatusByNode` — stessa firma in tutti i task.
- **Review Focus**: 1 → Task 7 prova 3; 2 → Task 6 prove 2 e 4; 3 → Task 10 + Task 11 (`topology-map-client`); 4 → Task 10; 5 → Task 3 (errore prima delle scritture) e Task 4 (finestra).
