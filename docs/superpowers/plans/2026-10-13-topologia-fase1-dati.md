# Topologia, fase 1 «i dati giusti» — piano di lavoro

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** dare al motore della mappa i dati giusti — uplink UniFi salvato, vicini abbinati anche per MAC, apparato e host fusi in un nodo solo, proposte «promuovi ad apparato», sede = Ubicazione con subnet e apparato di testa, correzioni ai collegamenti, età dei collegamenti — senza ancora cambiare la mappa di oggi.

**Architecture:** migrazione additiva e idempotente dello schema tenant; la sync UniFi e la scrittura dei vicini smettono di buttare dati (uplink, età, fonte); un costruttore puro `buildTopologyModel` in `src/lib/topology/` calcola nodi fusi, collegamenti con fonte ed età, sedi e proposte; poche rotte API e tre punti d'interfaccia minimi (Ubicazioni, sede dell'apparato, pagina «Dati della mappa»). La mappa React Flow di oggi resta com'è: la sostituisce la fase 2.

**Tech Stack:** Next.js 16 / React 19 / TypeScript strict, better-sqlite3 (WAL), node test runner (`node --import tsx --test`), Zod v4, shadcn v4 su `@base-ui/react`.

**Spec:** `docs/superpowers/specs/2026-10-12-topology-map-design.md` (v2, approvata da Riccardo il 13/10). Decisioni prese il 13/10 prima di questo piano:
- soglia «non visto» = **2 giorni**, modificabile (impostazione `topology_link_stale_days`);
- a schermo alla fine della fase 1: **numeri prima/dopo + campi minimi** (testa e subnet nelle Ubicazioni, sede/armadio sull'apparato, elenco delle proposte con conferma);
- le proposte automatiche (sede dalla subnet, testa, «promuovi») **si usano nel calcolo segnate «proposto»**; nel DB del cliente si scrive solo una scelta confermata da un admin.

**Livello di controllo: COMPLETO** (schema DB e dati dei clienti). Prova vista fallire prima del codice, misura sul dato vero (copie dei DB di hub e DTS), backup prima di ogni scrittura, conferma di Riccardo prima di DTS e hub.

## Global Constraints

- Node 22 LTS (≥25 rompe `better-sqlite3`).
- Funzioni DB nuove solo in `src/lib/db-tenant.ts`, importato **staticamente** (ADR 0002; prova `no-dynamic-db-tenant-import.test.ts`). In `src/lib/db.ts` solo deleghe con `require("./db-tenant")`, come `upsertSwitchPorts`.
- Schema: colonne nuove sia in `src/lib/db-tenant-schema.ts` (tenant nuovi) sia nella migrazione inline (tenant esistenti). Migrazioni additive, idempotenti, in transazione; mai DROP o ricostruzioni di tabelle.
- **Indici sulle colonne nuove solo nella migrazione**, mai nello schema: lo schema gira prima della migrazione, e su un DB vecchio un `CREATE INDEX` su una colonna che ancora non c'è fa fallire l'apertura del tenant.
- Ogni rotta: `withTenantFromSession` + `requireAuth()` per le letture, `requireAdmin()` per le scritture (il censimento `src/lib/permessi/rotte.ts` le accetta da solo se rispettano il predefinito).
- Date del DB lette con `parseDbDate` (`src/lib/db-date.ts`), mai `new Date(x)`; nelle pagine ora italiana (`FUSO_UTENTI`).
- Caricamenti nel client con `fetchJson` + `LoadError`: un errore non diventa mai «lista vuota».
- Testi dell'interfaccia in italiano; stato mai col solo colore (Riccardo è daltonico): testo o simbolo accanto.
- Niente segreti, IP, MAC o nomi veri nei log, negli output degli script, nelle fixture: **il repo GitHub è pubblico**.
- `dev` arriva a DTS da solo entro 15 minuti (build + riavvio + migrazione): **nessun push su `dev` prima della conferma di Riccardo** (Task 16). Si lavora su rami propri, `main` non si tocca mai.
- Segreti: mai nel trascritto; a uno script solo come prima riga di stdin, dopo una prova con un valore finto; verso un server solo con `| ssh host 'read -r T; …'` (memoria «segreti-verso-ssh-prova-finta»). Dentro ssh `pgrep -x`, mai `pgrep -f`.
- Orari a Riccardo in ora italiana (journal e DB dei server sono UTC).
- Esito del cancello letto dal codice di uscita (`cmd > "$LOG" 2>&1; ESITO=$?`), log nello scratchpad della sessione, mai con nome fisso in `/tmp`.
- Al massimo **2 agenti** che compilano insieme, ciascuno nel **suo** worktree con la sua `DA_INVENT_DATA_DIR`.

## Review Focus

Casi che la spec implica e che nessuna prova «di base» tocca; ognuno ha la sua prova nel task indicato.

1. **Stesso apparato letto da due fonti** (poll SNMP/SSH e UniFi): oggi ciascuna cancella i vicini dell'altra; dopo, i vicini restano tutti, ognuno con la sua fonte e la sua età → prova in Task 2.
2. **MAC ambiguo** (MAC virtuale VRRP, router con lo stesso MAC su più VLAN, due apparati che dichiarano lo stesso MAC): non deve attaccare un collegamento all'apparato sbagliato; un MAC conteso non abbina → prova in Task 4.
3. **Nome del vicino che è un IP o un MAC** (`remote_device_name` = «192.168.1.1» o «aa:bb:…», come lo scrive il mapper UniFi): `normalizeName` taglia al primo punto e «192» abbinerebbe a caso → prova in Task 4.
4. **Correzione scritta su un host poi promosso ad apparato**: la correzione deve seguire il nodo (`host:40` → `dev:12`), non sparire → prova in Task 5.
5. **Subnet sovrapposte in sedi diverse** (10.0.0.0/16 in una sede, 10.0.5.0/24 in un'altra): vince il prefisso più lungo → prova in Task 6.
6. (in più) **Date in due formati** (`YYYY-MM-DD HH:MM:SS` UTC e ISO con `T…Z`) o nulle: età giusta, una data nulla non è «non visto» → prova in Task 5.

---

## Struttura dei file

| File | Cosa fa | Task |
| --- | --- | --- |
| `src/lib/db-tenant-schema.ts` | colonne nuove + tabella `topology_link_overrides` per i tenant nuovi | 1 |
| `src/lib/db-tenant.ts` | `migrateTopologyPhase1`, `upsertNeighbors` con età e fonte, `upsertSwitchPorts` con `is_uplink`, `setNetworkDeviceControllerFacts`, letture e scritture del modello | 1, 2, 3, 8 |
| `src/lib/db.ts` | `upsertNeighbors` diventa delega | 2 |
| `src/types/index.ts` | `SwitchPort.is_uplink?` | 3 |
| `src/lib/integrations/unifi-map.ts` | `mapUnifiUplink`, `is_uplink` nelle porte | 3 |
| `src/lib/integrations/unifi-sync.ts` | salva uplink e MAC del controller, vicini con fonte `unifi` | 3 |
| `src/lib/topology/model-types.ts` | tipi del modello | 4 |
| `src/lib/topology/node-index.ts` | fusione apparato↔host, indici IP/MAC/nome, risoluzione | 4 |
| `src/lib/topology/links.ts` | collegamenti: correzioni, uplink, LLDP/CDP/MNDP; fonte ed età | 5 |
| `src/lib/topology/sites.ts` | sede e armadio di ogni nodo, testa della sede | 6 |
| `src/lib/topology/model.ts` | `buildTopologyModel`: proposte, «da sistemare», conteggi | 7 |
| `src/lib/topology/settings.ts` | soglia «non visto» (impostazione dell'hub) | 8 |
| `src/lib/topology/api-input.ts` | validazione Zod dei corpi delle rotte | 10 |
| `src/lib/topology/anonimizza.ts` | anonimizzazione dei dati per le fixture | 9 |
| `scripts/estrai-fixture-topologia.ts` | estrae una fixture anonima da una copia di DB | 9 |
| `scripts/misura-topologia.ts` | numeri prima/dopo su una copia di DB, lettura UniFi facoltativa | 14 |
| `src/app/api/topology/model/route.ts` · `settings/route.ts` · `links/route.ts` · `links/[id]/route.ts` | API del modello | 10 |
| `src/app/api/locations/[id]/topology/route.ts` · `src/app/api/devices/[id]/location/route.ts` | testa e subnet della sede; sede dell'apparato | 10 |
| `src/components/topology/site-topology-dialog.tsx` + `inventory/locations/page.tsx` | testa e subnet nelle Ubicazioni | 11 |
| `src/components/topology/device-location-field.tsx` + `components/devices/edit-device-dialog.tsx` | sede/armadio sull'apparato | 12 |
| `src/app/(dashboard)/topology/dati/page.tsx` + `dati-client.tsx` | pagina «Dati della mappa» | 13 |
| `docs/adr/0008-topologia-dati-fase1.md`, `CHANGELOG.md`, `CONTEXT.md`, spec §8 | documenti | 15 |

## Tappe ed esecuzione

| Tappa | Task | Chi | Parallelo |
| --- | --- | --- | --- |
| A · Preparazione | 0 | sessione principale | — |
| B · Dati scritti giusti (zona rossa) | 1 → 2 → 3 | agente 1, worktree `topologia-f1` | **con C** |
| C · Costruttore puro | 4 → 5 → 6 → 7 | agente 2, worktree `topologia-f1-modello` | **con B** |
| D · Letture, fixture, API | 8 → 9 → 10 | un agente, dopo l'unione di B e C | — |
| E · Interfaccia minima | 11 + 12 ∥ 13 | due agenti | sì (2) |
| F · Misura e documenti | 14 → 15 | sessione principale | — |
| **G · Conferma** | **16** | **Riccardo** | — |
| H · Rilascio dopo la conferma | 17 | sessione principale | — |

Revisione: una per ogni task delle tappe B e D (zona rossa: schema, dati dei clienti), una sola a fine lavoro per C, E, F. Modello degli agenti: Opus per B e D (zona rossa), Sonnet per C ed E.

---

### Task 0: Preparazione (sessione principale)

**Files:** nessun codice. Spec: `docs/superpowers/specs/2026-10-12-topology-map-design.md`.

- [ ] **Step 1: controllare che nessuno lavori su DA-IPAM**

```bash
cd /Users/riccardo/Progetti/Domarc/DA-IPAM && git fetch -q origin && git worktree list && git log --oneline -3 origin/dev
for p in $(pgrep -x claude); do lsof -a -p "$p" -d cwd -Fn 2>/dev/null | grep '^n' | grep -i ipam; done
```
Atteso: worktree `t3b-nucleo` (fermo fino al 20/10, non si tocca) e nessuna sessione con cwd in DA-IPAM oltre a questa.

- [ ] **Step 2: due worktree da `origin/dev`**

```bash
cd /Users/riccardo/Progetti/Domarc/DA-IPAM
git worktree add -b topologia/fase1-dati .claude/worktrees/topologia-f1 origin/dev
git worktree add -b topologia/fase1-modello .claude/worktrees/topologia-f1-modello origin/dev
for w in topologia-f1 topologia-f1-modello; do (cd .claude/worktrees/$w && npm ci --no-audit --no-fund >/dev/null 2>&1; echo "$w npm ci exit=$?"); done
```

- [ ] **Step 3: spec approvata e piano nel ramo**

In `.claude/worktrees/topologia-f1/docs/superpowers/specs/2026-10-12-topology-map-design.md`:
- riga «Stato: **da approvare**» → «Stato: **approvata da Riccardo il 13/10** (piano della fase 1: `docs/superpowers/plans/2026-10-13-topologia-fase1-dati.md`)»;
- §8, voce «Soglia del «non visto»» → «**Deciso il 13/10: 2 giorni**, modificabile (impostazione `topology_link_stale_days`, 1–30). Con una lettura UniFi al giorno, un giorno esatto farebbe diventare grigio tutto a ogni lettura in ritardo.»

Copiare questo piano nel worktree e fare il commit:

```bash
cd /Users/riccardo/Progetti/Domarc/DA-IPAM
cp docs/superpowers/plans/2026-10-13-topologia-fase1-dati.md .claude/worktrees/topologia-f1/docs/superpowers/plans/
cd .claude/worktrees/topologia-f1
git add docs/superpowers/plans/2026-10-13-topologia-fase1-dati.md docs/superpowers/specs/2026-10-12-topology-map-design.md
git commit -m "docs(topologia): spec v2 approvata, soglia «non visto» 2 giorni, piano della fase 1"
rm /Users/riccardo/Progetti/Domarc/DA-IPAM/docs/superpowers/plans/2026-10-13-topologia-fase1-dati.md
```

- [ ] **Step 4: copie dei DB (sola lettura sui server)**

Vie d'accesso in `ACCESSI.md` (hub: VM 533 `192.168.4.8`, `/opt/da-invent`, tenant `70791`; DTS: `172.16.0.2`, `/opt/da-ipam`, tenant `71734`). Un solo ssh per server: spazio, copia coerente con l'API di backup di SQLite, impronta.

```bash
S=/private/tmp/claude-501/-Users-riccardo-Progetti/<sessione>/scratchpad/topologia-f1   # scratchpad della sessione che esegue
mkdir -p "$S/copie"
# hub (il DB è ~2 GB: prima lo spazio)
ssh <hub> 'cd /opt/da-invent && df -h /tmp | tail -1 && du -h data/tenants/70791.db | cut -f1 \
  && F=$(mktemp /tmp/copia-70791.XXXXXX) && node -e "const D=require(\"better-sqlite3\");new D(\"data/tenants/70791.db\",{readonly:true}).backup(process.argv[1]).then(()=>console.log(\"backup ok\"))" "$F" \
  && sha256sum "$F" && echo "FILE=$F"'
```
Poi `scp <hub>:<FILE> "$S/copie/70791.db"`, `shasum -a 256` uguale, e `ssh <hub> 'rm -f <FILE>'` (è la copia temporanea appena fatta, non dati di produzione). Stessa sequenza per DTS (`/opt/da-ipam`, `71734.db` → `$S/copie/71734.db`). Se lo spazio in `/tmp` non basta: fermarsi e dirlo, non copiare altrove a caso.

Atteso: due file in `$S/copie/`, impronte uguali alle remote. Nessuna scrittura sui server oltre al file temporaneo, poi tolto.

---

### Task 1: Migrazione dello schema (tappa B, worktree `topologia-f1`)

**Files:**
- Modify: `src/lib/db-tenant-schema.ts` (tabelle `networks`, `network_devices`, `switch_ports`, `locations`, `device_neighbors`, `topology_position`; tabella nuova `topology_link_overrides`)
- Modify: `src/lib/db-tenant.ts` (funzione `migrateTopologyPhase1` + chiamata in `getTenantDb`, accanto alle altre migrazioni runtime ~riga 620-700)
- Test: `src/lib/__tests__/topology-phase1-migration.test.ts`

**Interfaces:**
- Produces: `export function migrateTopologyPhase1(db: Database.Database): string[]` — restituisce le colonne aggiunte (`"tabella.colonna"`), `[]` se già fatta.
- Colonne nuove (nome e tipo esatti, li usano i task 2, 3, 8):
  - `network_devices`: `location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL`, `location_set_by TEXT`, `location_set_at TEXT`, `topology_role TEXT`, `topology_hidden INTEGER NOT NULL DEFAULT 0`, `controller_mac TEXT`, `uplink_mac TEXT`, `uplink_remote_port INTEGER`, `uplink_seen_at TEXT`
  - `switch_ports`: `is_uplink INTEGER NOT NULL DEFAULT 0`
  - `device_neighbors`: `first_seen TEXT`, `source TEXT NOT NULL DEFAULT 'device'`
  - `locations`: `head_device_id INTEGER REFERENCES network_devices(id) ON DELETE SET NULL`, `head_set_by TEXT`, `head_set_at TEXT`
  - `networks`: `location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL`, `location_set_by TEXT`, `location_set_at TEXT`
  - `topology_position`: `structure_sig TEXT` (serve alla fase 2: si mette ora per fare **una** sola migrazione confermata su DTS)
  - tabella `topology_link_overrides` (sotto)

`topology_role`, `topology_hidden` e `structure_sig` in questa fase non li legge nessuno: si aggiungono ora perché ogni migrazione su DTS chiede una conferma, e le fasi 2-4 sono a livello leggero.

- [ ] **Step 1: la prova che fallisce**

```ts
// src/lib/__tests__/topology-phase1-migration.test.ts
// Migrazione «topologia fase 1» (spec 2026-10-12-topology-map-design §5): solo
// colonne e una tabella nuove, idempotente, dati esistenti intatti. Il DB
// «vecchio» riproduce le tabelle come sono su dev al 13/10.
import { removeTestHubDb } from "@/lib/integrations/__tests__/support/hub-isolato";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { closeHubDb } from "@/lib/db-hub";
import { deleteTenantDatabase, getTenantDb, migrateTopologyPhase1 } from "@/lib/db-tenant";
import { TENANT_SCHEMA_SQL } from "@/lib/db-tenant-schema";

const T = "TESTTOPOF1MIG";

function dbVecchio(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE locations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, parent_id INTEGER REFERENCES locations(id) ON DELETE SET NULL, address TEXT, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE networks (id INTEGER PRIMARY KEY AUTOINCREMENT, cidr TEXT NOT NULL UNIQUE, name TEXT NOT NULL, gateway TEXT, location TEXT DEFAULT '');
    CREATE TABLE network_devices (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, host TEXT NOT NULL, device_type TEXT NOT NULL, vendor TEXT NOT NULL, protocol TEXT NOT NULL, host_id INTEGER, physical_device_id INTEGER);
    CREATE TABLE switch_ports (id INTEGER PRIMARY KEY AUTOINCREMENT, device_id INTEGER NOT NULL REFERENCES network_devices(id) ON DELETE CASCADE, port_index INTEGER NOT NULL, port_name TEXT NOT NULL, UNIQUE(device_id, port_index));
    CREATE TABLE device_neighbors (id INTEGER PRIMARY KEY AUTOINCREMENT, device_id INTEGER NOT NULL REFERENCES network_devices(id) ON DELETE CASCADE, local_port TEXT NOT NULL, remote_device_name TEXT NOT NULL DEFAULT '', remote_port TEXT NOT NULL DEFAULT '', protocol TEXT NOT NULL, remote_ip TEXT, remote_mac TEXT, remote_platform TEXT, timestamp TEXT DEFAULT (datetime('now')), UNIQUE(device_id, local_port, remote_device_name, remote_port));
    CREATE TABLE topology_position (id INTEGER PRIMARY KEY AUTOINCREMENT, view TEXT NOT NULL DEFAULT 'default', node_id TEXT NOT NULL, x REAL NOT NULL, y REAL NOT NULL, pinned INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(view, node_id));
  `);
  db.prepare("INSERT INTO network_devices (name, host, device_type, vendor, protocol) VALUES ('SW-1', '10.0.0.2', 'switch', 'ubiquiti', 'api')").run();
  db.prepare("INSERT INTO device_neighbors (device_id, local_port, remote_device_name, remote_port, protocol, timestamp) VALUES (1, 'Port 1', 'RTR-1', 'ether2', 'lldp', '2026-10-01 03:00:00')").run();
  return db;
}

const COLONNE = [
  "network_devices.location_id", "network_devices.location_set_by", "network_devices.location_set_at",
  "network_devices.topology_role", "network_devices.topology_hidden", "network_devices.controller_mac",
  "network_devices.uplink_mac", "network_devices.uplink_remote_port", "network_devices.uplink_seen_at",
  "switch_ports.is_uplink", "device_neighbors.first_seen", "device_neighbors.source",
  "locations.head_device_id", "locations.head_set_by", "locations.head_set_at",
  "networks.location_id", "networks.location_set_by", "networks.location_set_at",
  "topology_position.structure_sig",
];

function colonne(db: Database.Database, tabella: string): string[] {
  return (db.prepare(`PRAGMA table_info(${tabella})`).all() as Array<{ name: string }>).map((c) => c.name);
}

after(() => {
  deleteTenantDatabase(T);
  closeHubDb();
  removeTestHubDb();
});

test("su un DB vecchio aggiunge tutte le colonne, una volta sola", () => {
  const db = dbVecchio();
  assert.deepEqual([...migrateTopologyPhase1(db)].sort(), [...COLONNE].sort());
  assert.deepEqual(migrateTopologyPhase1(db), []);
  assert.ok(colonne(db, "topology_link_overrides").includes("a_node"));
});

test("i vicini esistenti tengono la data e nascono con first_seen = timestamp e fonte «device»", () => {
  const db = dbVecchio();
  migrateTopologyPhase1(db);
  const r = db.prepare("SELECT timestamp, first_seen, source FROM device_neighbors").get() as Record<string, string>;
  assert.deepEqual(r, { timestamp: "2026-10-01 03:00:00", first_seen: "2026-10-01 03:00:00", source: "device" });
});

test("testa della sede: se l'apparato sparisce resta NULL (niente cancellazioni a cascata)", () => {
  const db = dbVecchio();
  migrateTopologyPhase1(db);
  db.prepare("INSERT INTO locations (name) VALUES ('Sede A')").run();
  db.prepare("UPDATE locations SET head_device_id = 1 WHERE id = 1").run();
  db.prepare("DELETE FROM network_devices WHERE id = 1").run();
  assert.equal((db.prepare("SELECT head_device_id FROM locations WHERE id = 1").get() as { head_device_id: number | null }).head_device_id, null);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM locations").get() as { n: number }).n, 1);
});

test("lo schema dei tenant nuovi ha già tutte le colonne (la migrazione non aggiunge niente)", () => {
  const solo = new Database(":memory:");
  solo.exec(TENANT_SCHEMA_SQL);
  assert.deepEqual(migrateTopologyPhase1(solo), []);
});

test("un tenant nuovo si apre e ha le colonne", () => {
  const db = getTenantDb(T);
  for (const c of COLONNE) {
    const [tabella, colonna] = c.split(".");
    assert.ok(colonne(db, tabella).includes(colonna), `${c} manca nello schema dei tenant nuovi`);
  }
});
```

- [ ] **Step 2: vederla fallire**

```bash
cd /Users/riccardo/Progetti/Domarc/DA-IPAM/.claude/worktrees/topologia-f1
DA_INVENT_DATA_DIR=$(mktemp -d) node --import tsx --test src/lib/__tests__/topology-phase1-migration.test.ts
```
Atteso: FAIL, `migrateTopologyPhase1` non esportata.

- [ ] **Step 3: la migrazione in `db-tenant.ts`**

Sopra `getTenantDb`, accanto a `migrateScheduledJobsV8`:

```ts
/**
 * Migrazione runtime «topologia fase 1» (spec 2026-10-12-topology-map-design
 * §5, piano 2026-10-13-topologia-fase1-dati). Solo colonne e una tabella nuove,
 * in una transazione: o tutto o niente. Gli indici sulle colonne nuove stanno
 * QUI e non nello schema: lo schema gira prima, e su un DB vecchio un indice su
 * una colonna che ancora non c'è impedirebbe di aprire il tenant.
 * Esportata per le prove (`topology-phase1-migration.test.ts`).
 */
export function migrateTopologyPhase1(db: Database.Database): string[] {
  const added: string[] = [];
  const has = (table: string, col: string): boolean =>
    (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some((c) => c.name === col);
  const add = (table: string, col: string, ddl: string): void => {
    if (has(table, col)) return;
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${ddl}`);
    added.push(`${table}.${col}`);
  };
  db.transaction(() => {
    add("network_devices", "location_id", "INTEGER REFERENCES locations(id) ON DELETE SET NULL");
    add("network_devices", "location_set_by", "TEXT");
    add("network_devices", "location_set_at", "TEXT");
    add("network_devices", "topology_role", "TEXT");
    add("network_devices", "topology_hidden", "INTEGER NOT NULL DEFAULT 0");
    add("network_devices", "controller_mac", "TEXT");
    add("network_devices", "uplink_mac", "TEXT");
    add("network_devices", "uplink_remote_port", "INTEGER");
    add("network_devices", "uplink_seen_at", "TEXT");
    add("switch_ports", "is_uplink", "INTEGER NOT NULL DEFAULT 0");
    add("device_neighbors", "first_seen", "TEXT");
    add("device_neighbors", "source", "TEXT NOT NULL DEFAULT 'device'");
    add("locations", "head_device_id", "INTEGER REFERENCES network_devices(id) ON DELETE SET NULL");
    add("locations", "head_set_by", "TEXT");
    add("locations", "head_set_at", "TEXT");
    add("networks", "location_id", "INTEGER REFERENCES locations(id) ON DELETE SET NULL");
    add("networks", "location_set_by", "TEXT");
    add("networks", "location_set_at", "TEXT");
    add("topology_position", "structure_sig", "TEXT");
    if (added.includes("device_neighbors.first_seen")) {
      db.exec("UPDATE device_neighbors SET first_seen = timestamp WHERE first_seen IS NULL");
    }
    db.exec(`CREATE TABLE IF NOT EXISTS topology_link_overrides (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL CHECK(action IN ('add', 'ignore')),
      a_node TEXT NOT NULL,
      a_port TEXT NOT NULL DEFAULT '',
      b_node TEXT NOT NULL,
      b_port TEXT NOT NULL DEFAULT '',
      note TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    db.exec("CREATE INDEX IF NOT EXISTS idx_network_devices_location ON network_devices(location_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_networks_location ON networks(location_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_device_neighbors_timestamp ON device_neighbors(device_id, timestamp)");
  })();
  return added;
}
```

In `getTenantDb`, dopo il blocco della migrazione v8:

```ts
  // Topologia fase 1 (piano 2026-10-13): colonne e tabella delle correzioni.
  try {
    const added = migrateTopologyPhase1(newDb);
    if (added.length > 0) {
      console.info(`[db-tenant] ${tenantCode}: topologia fase 1, aggiunte ${added.length} colonne`);
    }
  } catch (e) {
    console.error(`[db-tenant] ${tenantCode}: migrazione topologia fase 1 fallita:`, e);
  }
```

- [ ] **Step 4: le colonne nello schema dei tenant nuovi**

In `src/lib/db-tenant-schema.ts`, nelle `CREATE TABLE IF NOT EXISTS` (prima della parentesi di chiusura, dopo l'ultima colonna, **senza indici**):
- `networks`: `location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL, location_set_by TEXT, location_set_at TEXT,` (prima di `created_at`)
- `network_devices`: le nove colonne dell'elenco sopra, dopo `physical_device_id`
- `switch_ports`: `is_uplink INTEGER NOT NULL DEFAULT 0,` dopo `stp_state`
- `locations`: `head_device_id INTEGER REFERENCES network_devices(id) ON DELETE SET NULL, head_set_by TEXT, head_set_at TEXT,` dopo `address`
- `device_neighbors`: `first_seen TEXT, source TEXT NOT NULL DEFAULT 'device',` dopo `remote_platform`
- `topology_position`: `structure_sig TEXT,` dopo `pinned`
- tabella `topology_link_overrides` identica a quella della migrazione, dopo `topology_position`.

Attenzione: `network_devices` è dichiarata prima di `locations` nello schema. Una `REFERENCES` verso una tabella dichiarata dopo va bene in SQLite (la FK si controlla alla scrittura, non alla creazione).

- [ ] **Step 5: vederla passare, con le prove vicine**

```bash
DA_INVENT_DATA_DIR=$(mktemp -d) node --import tsx --test src/lib/__tests__/topology-phase1-migration.test.ts src/lib/__tests__/scheduled-jobs-v8.test.ts src/lib/integrations/__tests__/unifi-sync.test.ts
npx tsc --noEmit
```
Atteso: tutto PASS, tsc pulito.

- [ ] **Step 6: commit**

```bash
git add src/lib/db-tenant.ts src/lib/db-tenant-schema.ts src/lib/__tests__/topology-phase1-migration.test.ts
git commit -m "feat(topologia): migrazione fase 1 — sede, testa, uplink, età e fonte dei vicini, correzioni"
```

---

### Task 2: I vicini non si cancellano più: età e fonte (tappa B)

**Files:**
- Modify: `src/lib/db-tenant.ts` (`upsertNeighbors`, ~riga 4640)
- Modify: `src/lib/db.ts` (`upsertNeighbors`, ~riga 5529: diventa delega)
- Test: `src/lib/__tests__/neighbors-age.test.ts`

**Interfaces:**
- Consumes: colonne `device_neighbors.first_seen`, `.source` (Task 1).
- Produces: `export type NeighborSource = "device" | "unifi";` e `upsertNeighbors(deviceId: number, neighbors: NeighborInput[], source: NeighborSource = "device"): void` (firma compatibile: i chiamanti di oggi non cambiano).

Comportamento nuovo: i vicini del giro si inseriscono o si aggiornano (`timestamp` = adesso, `first_seen` resta); quelli che il giro non riporta **restano**, con la loro data: è così che un collegamento sparito diventa «non visto da N giorni» (spec §3). Pulizia eseguita dall'app: un vicino non visto da più di 90 giorni si toglie alla scrittura successiva di quell'apparato.

Conseguenze da sapere (vanno nell'ADR 0008, Task 15):
- la mappa vecchia (`getTopologyData`) mostrerà anche i collegamenti non più visti: non la si filtra, la sostituisce la fase 2 (filtrarla svuoterebbe la mappa di DTS, dove UniFi non si legge da solo — vedi Task 16);
- l'attribuzione (`neighborSightings`, `ORDER BY dn.timestamp DESC LIMIT 5`) vede anche avvistamenti vecchi, i più recenti per primi: un host che era davvero vicino LLDP resta un'informazione vera.

- [ ] **Step 1: la prova che fallisce**

```ts
// src/lib/__tests__/neighbors-age.test.ts
// I vicini non si cancellano a ogni giro (topologia fase 1): un collegamento
// sparito invecchia e diventa «non visto»; due fonti sullo stesso apparato non
// si cancellano a vicenda; pulizia dopo 90 giorni fatta dall'app.
import { removeTestHubDb } from "@/lib/integrations/__tests__/support/hub-isolato";
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { closeHubDb } from "@/lib/db-hub";
import { deleteTenantDatabase, getTenantDb, upsertNeighbors, withTenant } from "@/lib/db-tenant";

const T = "TESTNEIGHAGE";
const db = () => getTenantDb(T);

beforeEach(() => {
  db().exec("DELETE FROM device_neighbors; DELETE FROM network_devices;");
  db().prepare("INSERT INTO network_devices (id, name, host, device_type, vendor, protocol) VALUES (1, 'SW-1', '10.0.0.2', 'switch', 'ubiquiti', 'api'), (2, 'SW-2', '10.0.0.3', 'switch', 'hp', 'snmp_v2')").run();
});
after(() => {
  deleteTenantDatabase(T);
  closeHubDb();
  removeTestHubDb();
});

const v = (remote: string, port = "Port 1") => ({ localPort: port, remoteDevice: remote, remotePort: "Port 9", protocol: "lldp" });
const righe = (id: number) =>
  db().prepare("SELECT remote_device_name, source, first_seen, timestamp FROM device_neighbors WHERE device_id = ? ORDER BY remote_device_name").all(id) as Array<Record<string, string>>;

test("un vicino che il giro non riporta resta, con la sua data", () => {
  withTenant(T, () => upsertNeighbors(1, [v("RTR-1"), v("AP-1", "Port 2")]));
  db().prepare("UPDATE device_neighbors SET timestamp = '2026-10-01 03:00:00', first_seen = '2026-09-01 03:00:00'").run();
  withTenant(T, () => upsertNeighbors(1, [v("RTR-1")]));
  const r = righe(1);
  assert.equal(r.length, 2);
  const ap = r.find((x) => x.remote_device_name === "AP-1")!;
  const rtr = r.find((x) => x.remote_device_name === "RTR-1")!;
  assert.equal(ap.timestamp, "2026-10-01 03:00:00", "il vicino sparito tiene la data dell'ultima volta");
  assert.notEqual(rtr.timestamp, "2026-10-01 03:00:00", "il vicino rivisto prende la data di adesso");
  assert.equal(rtr.first_seen, "2026-09-01 03:00:00", "first_seen non si sposta");
});

test("due fonti sullo stesso apparato non si cancellano a vicenda", () => {
  withTenant(T, () => upsertNeighbors(1, [v("RTR-1")], "unifi"));
  withTenant(T, () => upsertNeighbors(1, [v("SRV-1", "Port 5")]));
  const r = righe(1);
  assert.deepEqual(r.map((x) => [x.remote_device_name, x.source]), [["RTR-1", "unifi"], ["SRV-1", "device"]]);
});

test("pulizia: oltre 90 giorni si toglie, solo per l'apparato scritto", () => {
  withTenant(T, () => { upsertNeighbors(1, [v("OLD-1")]); upsertNeighbors(2, [v("OLD-2")]); });
  db().prepare("UPDATE device_neighbors SET timestamp = datetime('now', '-91 days')").run();
  withTenant(T, () => upsertNeighbors(1, [v("RTR-1")]));
  assert.deepEqual(righe(1).map((x) => x.remote_device_name), ["RTR-1"]);
  assert.deepEqual(righe(2).map((x) => x.remote_device_name), ["OLD-2"]);
});

test("stessa chiave due volte nello stesso giro: una riga, nessun errore", () => {
  withTenant(T, () => upsertNeighbors(1, [v("RTR-1"), { ...v("RTR-1"), protocol: "cdp" }]));
  assert.equal(righe(1).length, 1);
});
```

- [ ] **Step 2: vederla fallire**

```bash
DA_INVENT_DATA_DIR=$(mktemp -d) node --import tsx --test src/lib/__tests__/neighbors-age.test.ts
```
Atteso: FAIL nella prima prova (il `DELETE` di oggi toglie `AP-1`) e nella seconda.

- [ ] **Step 3: `upsertNeighbors` in `db-tenant.ts`**

Sostituire il corpo fino alla transazione (il ricalcolo dell'attribuzione che segue resta identico):

```ts
export type NeighborSource = "device" | "unifi";

/** Un vicino non visto da più di tanti giorni si toglie alla scrittura successiva del suo apparato. */
const NEIGHBOR_RETENTION_DAYS = 90;

export function upsertNeighbors(
  deviceId: number,
  neighbors: Array<{
    localPort: string;
    remoteDevice: string;
    remotePort: string;
    protocol: string;
    remoteIp?: string;
    remoteMac?: string;
    remotePlatform?: string;
  }>,
  source: NeighborSource = "device",
): void {
  const d = db();
  // Topologia fase 1: niente DELETE del giro. Chi c'è si aggiorna (timestamp =
  // adesso, first_seen resta), chi non c'è invecchia e diventa «non visto».
  // Due fonti sullo stesso apparato (poll SNMP/SSH e UniFi) non si cancellano
  // più a vicenda. ON CONFLICT copre anche due voci uguali nello stesso giro.
  const ins = d.prepare(`
    INSERT INTO device_neighbors (device_id, local_port, remote_device_name, remote_port, protocol, remote_ip, remote_mac, remote_platform, source, first_seen, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    ON CONFLICT(device_id, local_port, remote_device_name, remote_port) DO UPDATE SET
      protocol = excluded.protocol,
      remote_ip = excluded.remote_ip,
      remote_mac = excluded.remote_mac,
      remote_platform = excluded.remote_platform,
      source = excluded.source,
      timestamp = excluded.timestamp
  `);
  const prune = d.prepare("DELETE FROM device_neighbors WHERE device_id = ? AND timestamp < datetime('now', ?)");
  d.transaction(() => {
    for (const n of neighbors) {
      ins.run(deviceId, n.localPort, n.remoteDevice, n.remotePort, n.protocol, n.remoteIp ?? null, n.remoteMac ?? null, n.remotePlatform ?? null, source);
    }
    prune.run(deviceId, `-${NEIGHBOR_RETENTION_DAYS} days`);
  })();
  // … il blocco «Attribution v2» che segue resta com'è
```

- [ ] **Step 4: `db.ts` delega**

Sostituire l'intera `upsertNeighbors` di `src/lib/db.ts` con:

```ts
export function upsertNeighbors(...args: Parameters<typeof import("./db-tenant").upsertNeighbors>): void {
  // Delega al sorgente db-tenant (topologia fase 1: età e fonte dei vicini, niente
  // DELETE del giro): una copia sola, come upsertSwitchPorts. Il ramo
  // tappa3b/nucleo toglie questa funzione dal facade: nel rebase vince il nucleo.
  const tenant = require("./db-tenant") as typeof import("./db-tenant");
  tenant.upsertNeighbors(...args);
}
```

Verificare che i tre chiamanti girino con un contesto tenant (con la copia di `db.ts` ricadevano in silenzio su DEFAULT; `db-tenant` senza contesto lancia, ed è meglio):

```bash
grep -n "withTenantFromSession\|withTenant(" src/app/api/networks/bulk-scan-devices/route.ts src/app/api/devices/\[id\]/query/route.ts | head; grep -n "upsertNeighbors(device.id" -B60 src/lib/cron/jobs.ts | grep -n "withTenant\|assertTenantContext" | head -3
```
Atteso: le due rotte dentro `withTenantFromSession`; il job dentro un giro dello scheduler con contesto (guardia `assertTenantContext`). Se uno non lo è: fermarsi e dirlo nel rapporto del task.

- [ ] **Step 5: vederla passare**

```bash
DA_INVENT_DATA_DIR=$(mktemp -d) node --import tsx --test src/lib/__tests__/neighbors-age.test.ts src/lib/integrations/__tests__/unifi-sync.test.ts src/lib/__tests__/no-dynamic-db-tenant-import.test.ts
npx tsc --noEmit
```
Atteso: PASS. Se una prova esistente di `unifi-sync.test.ts` contava sulla cancellazione dei vicini, la si legge: se asserisce «il vicino sparito non c'è più», va riscritta in «il vicino sparito c'è ancora con la data vecchia» (è il comportamento chiesto dalla spec), scrivendolo nel messaggio di commit.

- [ ] **Step 6: commit**

```bash
git add src/lib/db-tenant.ts src/lib/db.ts src/lib/__tests__/neighbors-age.test.ts
git commit -m "feat(topologia): i vicini non si cancellano a ogni giro — età, fonte, pulizia a 90 giorni"
```

---

### Task 3: Uplink UniFi salvato (tappa B)

**Files:**
- Modify: `src/types/index.ts` (`SwitchPort`: `is_uplink?: number;` dopo `stp_state`)
- Modify: `src/lib/integrations/unifi-map.ts` (`mapUnifiUplink`; `is_uplink` in `mapUnifiPorts`)
- Modify: `src/lib/db-tenant.ts` (`upsertSwitchPorts` scrive `is_uplink`; `setNetworkDeviceControllerFacts` nuova, nella sezione «SYNC DA CONTROLLER»)
- Modify: `src/lib/integrations/unifi-sync.ts` (`writeDevice`, `UnifiSyncResult.uplinksSaved`)
- Modify: `src/lib/controllers/service.ts` (l'oggetto `empty(...)` di `ControllerSyncOutcome` prende `uplinksSaved: 0`)
- Test: `src/lib/integrations/__tests__/unifi-map.test.ts`, `src/lib/integrations/__tests__/unifi-sync.test.ts`

**Interfaces:**
- Consumes: colonne del Task 1; `upsertNeighbors(…, "unifi")` del Task 2.
- Produces:
  - `export interface UnifiUplinkFacts { controllerMac: string | null; uplinkMac: string | null; uplinkRemotePort: number | null }`
  - `export function mapUnifiUplink(d: UnifiDevice): UnifiUplinkFacts`
  - `export function setNetworkDeviceControllerFacts(deviceId: number, f: UnifiUplinkFacts): void` (in `db-tenant.ts`)
  - `UnifiSyncResult.uplinksSaved: number`

- [ ] **Step 1: le prove che falliscono**

In `unifi-map.test.ts` (stessa fixture vera già caricata nel file):

```ts
test("mapUnifiUplink: MAC del controller e uplink normalizzati; nessun uplink verso se stessi", () => {
  for (const d of FIXTURE_DEVICES) {
    const f = mapUnifiUplink(d);
    assert.equal(f.controllerMac, normalizeMacForStorage(d.mac));
    const atteso = normalizeMacForStorage(d.uplink?.uplink_mac ?? null);
    if (!atteso || atteso === f.controllerMac) {
      assert.equal(f.uplinkMac, null);
      assert.equal(f.uplinkRemotePort, null);
    } else {
      assert.equal(f.uplinkMac, atteso);
      assert.equal(f.uplinkRemotePort, d.uplink?.uplink_remote_port ?? null);
    }
  }
  assert.ok(FIXTURE_DEVICES.some((d) => mapUnifiUplink(d).uplinkMac !== null), "la fixture vera ha almeno un uplink");
});

test("mapUnifiPorts: is_uplink come lo dice il controller", () => {
  for (const d of FIXTURE_DEVICES) {
    const righe = mapUnifiPorts(d, buildUnifiMacIndex(FIXTURE_DEVICES));
    for (const p of d.port_table) {
      assert.equal(righe.find((r) => r.port_index === p.port_idx)?.is_uplink, p.is_uplink ? 1 : 0);
    }
  }
});
```
(se nel file non ci sono, aggiungere gli import di `mapUnifiUplink` e di `normalizeMacForStorage` da `@/lib/utils`).

In `unifi-sync.test.ts`:

```ts
test("uplink salvato: MAC e porta dell'uplink, data della lettura, porta di uplink segnata", async () => {
  const r = await sync();
  const conUplink = FIXTURE_DEVICES.filter((d) => d.state === 1 && mapUnifiUplink(d).uplinkMac !== null);
  assert.ok(conUplink.length > 0);
  assert.equal(r.uplinksSaved, conUplink.length);
  for (const d of conUplink) {
    const f = mapUnifiUplink(d);
    const row = getTenantDb(T).prepare("SELECT id, controller_mac, uplink_mac, uplink_remote_port, uplink_seen_at FROM network_devices WHERE name = ?").get(d.name) as Record<string, unknown>;
    assert.equal(row.controller_mac, f.controllerMac);
    assert.equal(row.uplink_mac, f.uplinkMac);
    assert.equal(row.uplink_remote_port, f.uplinkRemotePort);
    assert.ok(row.uplink_seen_at, "data della lettura scritta");
    const porte = getTenantDb(T).prepare("SELECT port_index FROM switch_ports WHERE device_id = ? AND is_uplink = 1").all(row.id) as Array<{ port_index: number }>;
    assert.deepEqual(porte.map((p) => p.port_index).sort(), d.port_table.filter((p) => p.is_uplink).map((p) => p.port_idx).sort());
  }
});

test("apparato offline: l'uplink di prima resta con la sua data", async () => {
  const d = FIXTURE_DEVICES.find((x) => x.state === 1 && mapUnifiUplink(x).uplinkMac !== null)!;
  await sync();
  getTenantDb(T).prepare("UPDATE network_devices SET uplink_seen_at = '2026-10-01 03:00:00' WHERE name = ?").run(d.name);
  const lista = risposta().map((x) => (x.name === d.name ? offline(d.name) : x));
  await sync(lista);
  const row = getTenantDb(T).prepare("SELECT uplink_seen_at FROM network_devices WHERE name = ?").get(d.name) as { uplink_seen_at: string };
  assert.equal(row.uplink_seen_at, "2026-10-01 03:00:00");
});

test("i vicini scritti dalla sync hanno fonte «unifi»", async () => {
  await sync();
  const fonti = getTenantDb(T).prepare("SELECT DISTINCT source FROM device_neighbors").all() as Array<{ source: string }>;
  assert.deepEqual(fonti.map((f) => f.source), ["unifi"]);
});
```
Le prove del file svuotano già il tenant nel `beforeEach`: verificarlo leggendo il file; se non lo fanno, svuotare `network_devices`, `switch_ports` e `device_neighbors` in testa a queste tre.

- [ ] **Step 2: vederle fallire**

```bash
DA_INVENT_DATA_DIR=$(mktemp -d) node --import tsx --test src/lib/integrations/__tests__/unifi-map.test.ts src/lib/integrations/__tests__/unifi-sync.test.ts
```
Atteso: FAIL (`mapUnifiUplink` non esiste, `uplinksSaved` undefined).

- [ ] **Step 3: mapper**

In `unifi-map.ts`, dopo `mapUnifiLldp`:

```ts
/** Ciò che il controller sa di un apparato oltre a porte e vicini: il suo MAC e verso chi esce. */
export interface UnifiUplinkFacts {
  controllerMac: string | null;
  uplinkMac: string | null;
  uplinkRemotePort: number | null;
}

/**
 * MAC dell'apparato e uplink (`uplink.uplink_mac`, `uplink_remote_port`), finora
 * letti e buttati (ADR 0005, limite «uplink non usato»). Un uplink verso se
 * stessi o senza MAC non è un collegamento: null.
 */
export function mapUnifiUplink(d: UnifiDevice): UnifiUplinkFacts {
  const controllerMac = normalizeMacForStorage(d.mac);
  const uplinkMac = normalizeMacForStorage(d.uplink?.uplink_mac ?? null);
  if (!uplinkMac || uplinkMac === controllerMac) {
    return { controllerMac, uplinkMac: null, uplinkRemotePort: null };
  }
  return { controllerMac, uplinkMac, uplinkRemotePort: d.uplink?.uplink_remote_port ?? null };
}
```

In `mapUnifiPorts`, nell'oggetto restituito, dopo `stp_state: p.stp_state,`: `is_uplink: p.is_uplink ? 1 : 0,`

- [ ] **Step 4: DB**

In `upsertSwitchPorts` (`db-tenant.ts`): aggiungere `is_uplink` in fondo all'elenco delle colonne dell'`INSERT`, un `?` in più nei `VALUES`, e `p.is_uplink ?? 0` in fondo a `stmt.run(...)`.

Nella sezione «SYNC DA CONTROLLER (UniFi)»:

```ts
/**
 * MAC del controller e uplink di un apparato (topologia fase 1). L'uplink si
 * scrive solo quando il controller lo riporta: se sparisce, quello di prima
 * resta con la sua data e invecchia («non visto»), come i vicini.
 */
export function setNetworkDeviceControllerFacts(
  deviceId: number,
  f: { controllerMac: string | null; uplinkMac: string | null; uplinkRemotePort: number | null },
): void {
  const d = db();
  if (f.controllerMac) {
    d.prepare("UPDATE network_devices SET controller_mac = ? WHERE id = ?").run(f.controllerMac, deviceId);
  }
  if (f.uplinkMac) {
    d.prepare(
      "UPDATE network_devices SET uplink_mac = ?, uplink_remote_port = ?, uplink_seen_at = datetime('now') WHERE id = ?",
    ).run(f.uplinkMac, f.uplinkRemotePort, deviceId);
  }
}
```

- [ ] **Step 5: sync**

In `unifi-sync.ts`:
- import `setNetworkDeviceControllerFacts` dal blocco `@/lib/db-tenant` e `mapUnifiUplink` dal blocco `./unifi-map`;
- `UnifiSyncResult`: `/** Apparati di cui si è salvato l'uplink in questo giro. */ uplinksSaved: number;` e `uplinksSaved: 0` nell'inizializzazione di `syncUnifiForTenant`;
- `WriteOutcome`: `uplink: boolean;`
- in `writeDevice`, `upsertNeighbors(nd.id, neighbors)` → `upsertNeighbors(nd.id, neighbors, "unifi")`; prima del `return`:

```ts
  // Uplink e MAC del controller (topologia fase 1). Offline: il controller
  // manda l'ultimo uplink noto, ma non è una lettura di adesso: si scrive solo il MAC.
  const facts = mapUnifiUplink(d);
  setNetworkDeviceControllerFacts(nd.id, connected ? facts : { ...facts, uplinkMac: null, uplinkRemotePort: null });
  const uplink = connected && facts.uplinkMac !== null;
```
e `uplink` nell'oggetto restituito;
- in `writeDevices`, dopo `result.neighborsUpserted += out.neighbors;`: `if (out.uplink) result.uplinksSaved++;`
- in `src/lib/controllers/service.ts`, nell'oggetto di `empty(...)`: `uplinksSaved: 0,`. Cercare altri letterali di `UnifiSyncResult`: `grep -rn "neighborsUpserted: 0" src | grep -v __tests__`.

- [ ] **Step 6: vederle passare**

```bash
DA_INVENT_DATA_DIR=$(mktemp -d) node --import tsx --test src/lib/integrations/__tests__/unifi-*.test.ts src/lib/controllers/__tests__/*.test.ts src/lib/__tests__/neighbors-age.test.ts
npx tsc --noEmit
```
Atteso: PASS.

- [ ] **Step 7: commit**

```bash
git add src/types/index.ts src/lib/integrations/unifi-map.ts src/lib/integrations/unifi-sync.ts src/lib/db-tenant.ts src/lib/controllers/service.ts src/lib/integrations/__tests__/unifi-map.test.ts src/lib/integrations/__tests__/unifi-sync.test.ts
git commit -m "feat(topologia): la sync UniFi salva uplink, porta di uplink e MAC del controller"
```

---

### Task 4: Tipi del modello e fusione apparato↔host (tappa C, worktree `topologia-f1-modello`)

**Files:**
- Create: `src/lib/topology/model-types.ts`
- Create: `src/lib/topology/node-index.ts`
- Test: `src/lib/topology/__tests__/node-index.test.ts`

**Interfaces:**
- Produces (li usano i task 5-10, nomi esatti):

```ts
// src/lib/topology/model-types.ts
/**
 * Tipi del modello della mappa (spec 2026-10-12-topology-map-design §3).
 * Logica pura: nessun import del DB. Gli id dei nodi sono "dev:<id>" (apparato
 * di rete) e "host:<id>" (host non fuso con un apparato).
 */
export type LinkSource = "manual" | "unifi_uplink" | "lldp" | "cdp" | "mndp";

/** Più basso = più affidabile (spec §3, «fonti in ordine di fiducia»). */
export const LINK_SOURCE_RANK: Readonly<Record<LinkSource, number>> = {
  manual: 0,
  unifi_uplink: 1,
  lldp: 2,
  cdp: 2,
  mndp: 2,
};

export interface ModelDeviceRow {
  id: number;
  name: string;
  host: string;
  device_type: string;
  vendor: string;
  model: string | null;
  enabled: number;
  host_id: number | null;
  physical_device_id: number | null;
  location_id: number | null;
  controller_mac: string | null;
  uplink_mac: string | null;
  uplink_remote_port: number | null;
  uplink_seen_at: string | null;
  topology_hidden: number;
  port_count: number;
}

export interface ModelHostRow {
  id: number;
  network_id: number;
  ip: string;
  mac: string | null;
  hostname: string | null;
  custom_name: string | null;
  classification: string | null;
  status: string | null;
  physical_device_id: number | null;
}

export interface ModelNeighborRow {
  device_id: number;
  local_port: string;
  remote_device_name: string;
  remote_port: string;
  protocol: string;
  remote_ip: string | null;
  remote_mac: string | null;
  timestamp: string | null;
  source: string;
}

export interface ModelUplinkPortRow {
  device_id: number;
  port_index: number;
  port_name: string;
}

export interface ModelLocationRow {
  id: number;
  name: string;
  parent_id: number | null;
  head_device_id: number | null;
}

export interface ModelNetworkRow {
  id: number;
  cidr: string;
  name: string;
  gateway: string | null;
  location_id: number | null;
}

export interface ModelKnownMacRow {
  device_id: number;
  mac: string;
}

export interface LinkOverrideRow {
  id: number;
  action: "add" | "ignore";
  a_node: string;
  a_port: string;
  b_node: string;
  b_port: string;
}

export interface TopologyModelInput {
  devices: ModelDeviceRow[];
  hosts: ModelHostRow[];
  neighbors: ModelNeighborRow[];
  uplinkPorts: ModelUplinkPortRow[];
  locations: ModelLocationRow[];
  networks: ModelNetworkRow[];
  knownMacs: ModelKnownMacRow[];
  overrides: LinkOverrideRow[];
  /** Orologio iniettato: stessi dati + stesso nowMs = stesso modello. */
  nowMs: number;
  /** Giorni dopo cui un collegamento è «non visto» (decisione 13/10: 2). */
  staleDays: number;
}

export interface MapNode {
  id: string;
  kind: "device" | "host";
  refId: number;
  name: string;
  /** device_type dell'apparato, o classificazione dell'host. */
  type: string;
  mgmtIp: string | null;
  /** Host assorbiti dall'apparato: niente doppi (spec §3). */
  fusedHostIds: number[];
  siteId: number | null;
  rackId: number | null;
  /** true = sede proposta dal sistema, non confermata da un admin. */
  siteProposed: boolean;
  hidden: boolean;
}

export interface MapLink {
  id: string;
  a: string;
  aPort: string;
  b: string;
  bPort: string;
  /** La fonte più affidabile fra quelle che vedono il collegamento. */
  source: LinkSource;
  sources: LinkSource[];
  /** Per un uplink UniFi: il nodo che esce (il figlio). */
  uplinkFrom: string | null;
  lastSeen: string | null;
  daysUnseen: number | null;
  stale: boolean;
}

export interface SiteInfo {
  locationId: number;
  name: string;
  headNodeId: string | null;
  headProposed: boolean;
  nodeIds: string[];
}

export interface PromoteProposal {
  hostId: number;
  name: string;
  ip: string;
  classification: string;
  links: number;
}

export interface UnmatchedNeighbor {
  deviceNodeId: string;
  localPort: string;
  remoteName: string;
  remoteIp: string | null;
  remoteMac: string | null;
}

export interface ModelCounts {
  nodes: number;
  devices: number;
  links: number;
  linksBySource: Record<LinkSource, number>;
  deviceLinks: number;
  attachedLinks: number;
  staleLinks: number;
  unmatchedNeighbors: number;
  isolatedDevices: number;
  fusedHosts: number;
  devicesWithoutSite: number;
  sitesWithHead: number;
  promoteProposals: number;
  suspiciousTypes: number;
}

export interface TopologyModel {
  nodes: MapNode[];
  links: MapLink[];
  sites: SiteInfo[];
  promote: PromoteProposal[];
  unmatched: UnmatchedNeighbor[];
  isolated: string[];
  suspicious: string[];
  withoutSite: string[];
  counts: ModelCounts;
}
```

- `node-index.ts`:
  - `export interface NodeIndex { nodes: Map<string, MapNode>; alias: Map<string, string>; byIp: Map<string, string | null>; byMac: Map<string, string | null>; byName: Map<string, string | null>; hostById: Map<number, ModelHostRow>; fusedHosts: number }`
  - `export function buildNodeIndex(devices: ModelDeviceRow[], hosts: ModelHostRow[], knownMacs: ModelKnownMacRow[]): NodeIndex`
  - `export function canonical(idx: NodeIndex, nodeId: string): string`
  - `export function useNode(idx: NodeIndex, nodeId: string): string | null` — crea al bisogno il nodo di un host
  - `export function resolveNode(idx: NodeIndex, ref: { ip?: string | null; mac?: string | null; name?: string | null }): string | null`

- [ ] **Step 1: la prova che fallisce**

```ts
// src/lib/topology/__tests__/node-index.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildNodeIndex, resolveNode, useNode, canonical } from "@/lib/topology/node-index";
import type { ModelDeviceRow, ModelHostRow } from "@/lib/topology/model-types";

export function dev(id: number, over: Partial<ModelDeviceRow> = {}): ModelDeviceRow {
  return {
    id, name: `SW-${id}`, host: `10.0.0.${id}`, device_type: "switch", vendor: "ubiquiti", model: null, enabled: 1,
    host_id: null, physical_device_id: null, location_id: null, controller_mac: null, uplink_mac: null,
    uplink_remote_port: null, uplink_seen_at: null, topology_hidden: 0, port_count: 8, ...over,
  };
}
export function host(id: number, over: Partial<ModelHostRow> = {}): ModelHostRow {
  return {
    id, network_id: 1, ip: `10.0.1.${id}`, mac: null, hostname: null, custom_name: null,
    classification: "server", status: "online", physical_device_id: null, ...over,
  };
}

test("l'host collegato all'apparato si fonde: IP, MAC e nome portano all'apparato", () => {
  const idx = buildNodeIndex(
    [dev(1, { host: "10.0.0.1", host_id: 40, name: "PVE-1", device_type: "hypervisor" })],
    [host(40, { ip: "10.0.0.1", mac: "AA-BB-CC-00-00-01", hostname: "pve-1.dominio.local", classification: "hypervisor" })],
    [],
  );
  assert.equal(idx.fusedHosts, 1);
  assert.equal(canonical(idx, "host:40"), "dev:1");
  assert.equal(resolveNode(idx, { mac: "aa:bb:cc:00:00:01" }), "dev:1");
  assert.equal(resolveNode(idx, { name: "PVE-1.altro.dominio" }), "dev:1");
  assert.deepEqual(idx.nodes.get("dev:1")?.fusedHostIds, [40]);
  assert.equal(idx.nodes.has("host:40"), false);
});

test("si fonde anche per stesso IP e per stessa identità fisica", () => {
  const idx = buildNodeIndex(
    [dev(1, { host: "10.0.0.1" }), dev(2, { host: "10.0.0.2", physical_device_id: 7 })],
    [host(40, { ip: "10.0.0.1" }), host(41, { ip: "10.9.9.9", physical_device_id: 7 })],
    [],
  );
  assert.equal(canonical(idx, "host:40"), "dev:1");
  assert.equal(canonical(idx, "host:41"), "dev:2");
});

test("MAC conteso fra due apparati: non abbina (Review Focus 2)", () => {
  const idx = buildNodeIndex(
    [dev(1, { controller_mac: "00:00:5e:00:01:01" }), dev(2)],
    [],
    [{ device_id: 2, mac: "00:00:5E:00:01:01" }],
  );
  assert.equal(resolveNode(idx, { mac: "00:00:5e:00:01:01" }), null);
  assert.equal(resolveNode(idx, { mac: "00:00:5e:00:01:01", name: "SW-2" }), "dev:2", "MAC conteso: si passa al nome");
});

test("nome uguale fra due apparati: non abbina per nome", () => {
  const idx = buildNodeIndex([dev(1, { name: "core" }), dev(2, { name: "CORE" })], [], []);
  assert.equal(resolveNode(idx, { name: "core" }), null);
});

test("un host non contende il nome a un apparato", () => {
  const idx = buildNodeIndex([dev(1, { name: "nas-1" })], [host(50, { hostname: "nas-1" })], []);
  assert.equal(resolveNode(idx, { name: "NAS-1" }), "dev:1");
});

test("un nome che è un IP o un MAC non si abbina come nome (Review Focus 3)", () => {
  const idx = buildNodeIndex(
    [dev(1, { name: "192" }), dev(2, { controller_mac: "aa:bb:cc:00:00:02" })],
    [],
    [],
  );
  assert.equal(resolveNode(idx, { name: "192.168.1.1" }), null);
  assert.equal(resolveNode(idx, { name: "AA:BB:CC:00:00:02" }), "dev:2", "un nome a forma di MAC vale come MAC");
});

test("un host non fuso diventa nodo solo quando serve", () => {
  const idx = buildNodeIndex([dev(1)], [host(60, { ip: "10.0.1.60", custom_name: "SRV-BACKUP" })], []);
  assert.equal(idx.nodes.has("host:60"), false);
  const id = resolveNode(idx, { ip: "10.0.1.60" });
  assert.equal(id, "host:60");
  assert.equal(idx.nodes.get("host:60")?.name, "SRV-BACKUP");
  assert.equal(useNode(idx, "host:999"), null);
});
```

- [ ] **Step 2: vederla fallire**

```bash
cd /Users/riccardo/Progetti/Domarc/DA-IPAM/.claude/worktrees/topologia-f1-modello
node --import tsx --test src/lib/topology/__tests__/node-index.test.ts
```
Atteso: FAIL, modulo inesistente.

- [ ] **Step 3: `model-types.ts`** (il testo intero è sopra, in «Interfaces»).

- [ ] **Step 4: `node-index.ts`**

```ts
// src/lib/topology/node-index.ts
/**
 * Nodi della mappa: un apparato di rete e il suo host sono UN nodo (spec §3,
 * «niente doppi»), e gli indici per abbinare un vicino a un nodo per IP, MAC e
 * nome. Una chiave contesa fra due oggetti diversi vale null: non si abbina a
 * caso (un MAC VRRP, due apparati con lo stesso nome). Logica pura.
 */
import type { MapNode, ModelDeviceRow, ModelHostRow, ModelKnownMacRow } from "@/lib/topology/model-types";
import { normalizeName } from "@/lib/topology/match";
import { normalizeMacForStorage } from "@/lib/utils";

export interface NodeIndex {
  nodes: Map<string, MapNode>;
  alias: Map<string, string>;
  byIp: Map<string, string | null>;
  byMac: Map<string, string | null>;
  byName: Map<string, string | null>;
  hostById: Map<number, ModelHostRow>;
  fusedHosts: number;
}

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
const MAC = /^[0-9a-f]{2}([:-]?)[0-9a-f]{2}(\1[0-9a-f]{2}){4}$/i;

/** Chiave di nome, o null se il «nome» è un IP o un MAC (normalizeName taglierebbe al primo punto). */
function nameKey(raw: string | null | undefined): string | null {
  const s = raw?.trim();
  if (!s || IPV4.test(s) || MAC.test(s)) return null;
  return normalizeName(s) || null;
}

/** weak = la chiave la mette un host: non la toglie a un apparato. */
function put(map: Map<string, string | null>, key: string | null, id: string, weak: boolean): void {
  if (!key) return;
  const cur = map.get(key);
  if (cur === undefined) {
    map.set(key, id);
    return;
  }
  if (cur === null || cur === id) return;
  if (weak && cur.startsWith("dev:")) return;
  map.set(key, null);
}

function hostNode(h: ModelHostRow): MapNode {
  return {
    id: `host:${h.id}`, kind: "host", refId: h.id, name: h.custom_name || h.hostname || h.ip,
    type: h.classification || "unknown", mgmtIp: h.ip || null, fusedHostIds: [],
    siteId: null, rackId: null, siteProposed: false, hidden: false,
  };
}

export function buildNodeIndex(devices: ModelDeviceRow[], hosts: ModelHostRow[], knownMacs: ModelKnownMacRow[]): NodeIndex {
  const idx: NodeIndex = {
    nodes: new Map(), alias: new Map(), byIp: new Map(), byMac: new Map(), byName: new Map(),
    hostById: new Map(), fusedHosts: 0,
  };
  const hostsByIp = new Map<string, ModelHostRow[]>();
  const hostsByPhys = new Map<number, ModelHostRow[]>();
  const sortedHosts = [...hosts].sort((a, b) => a.id - b.id);
  for (const h of sortedHosts) {
    idx.hostById.set(h.id, h);
    if (h.ip) hostsByIp.set(h.ip, [...(hostsByIp.get(h.ip) ?? []), h]);
    if (h.physical_device_id != null) hostsByPhys.set(h.physical_device_id, [...(hostsByPhys.get(h.physical_device_id) ?? []), h]);
  }

  const absorbedBy = new Map<number, string>();
  for (const d of [...devices].sort((a, b) => a.id - b.id)) {
    const id = `dev:${d.id}`;
    const fused: number[] = [];
    const take = (h: ModelHostRow | undefined): void => {
      if (h && !absorbedBy.has(h.id)) {
        absorbedBy.set(h.id, id);
        fused.push(h.id);
      }
    };
    if (d.host_id != null) take(idx.hostById.get(d.host_id));
    for (const h of hostsByIp.get(d.host) ?? []) take(h);
    if (d.physical_device_id != null) for (const h of hostsByPhys.get(d.physical_device_id) ?? []) take(h);
    idx.nodes.set(id, {
      id, kind: "device", refId: d.id, name: d.name, type: d.device_type, mgmtIp: d.host || null,
      fusedHostIds: fused.sort((a, b) => a - b), siteId: null, rackId: null, siteProposed: false,
      hidden: d.topology_hidden === 1,
    });
    put(idx.byIp, d.host || null, id, false);
    put(idx.byName, nameKey(d.name), id, false);
    put(idx.byMac, normalizeMacForStorage(d.controller_mac), id, false);
  }
  for (const r of knownMacs) {
    if (idx.nodes.has(`dev:${r.device_id}`)) put(idx.byMac, normalizeMacForStorage(r.mac), `dev:${r.device_id}`, false);
  }
  for (const [hostId, devId] of absorbedBy) {
    const h = idx.hostById.get(hostId);
    if (!h) continue;
    idx.alias.set(`host:${hostId}`, devId);
    put(idx.byIp, h.ip || null, devId, false);
    put(idx.byMac, normalizeMacForStorage(h.mac), devId, false);
    put(idx.byName, nameKey(h.hostname), devId, false);
    put(idx.byName, nameKey(h.custom_name), devId, false);
  }
  idx.fusedHosts = absorbedBy.size;
  for (const h of sortedHosts) {
    if (absorbedBy.has(h.id)) continue;
    const id = `host:${h.id}`;
    put(idx.byIp, h.ip || null, id, true);
    put(idx.byMac, normalizeMacForStorage(h.mac), id, true);
    put(idx.byName, nameKey(h.hostname), id, true);
    put(idx.byName, nameKey(h.custom_name), id, true);
  }
  return idx;
}

export function canonical(idx: NodeIndex, nodeId: string): string {
  return idx.alias.get(nodeId) ?? nodeId;
}

/** Il nodo (creato al bisogno se è un host), o null se non esiste. */
export function useNode(idx: NodeIndex, nodeId: string): string | null {
  const id = canonical(idx, nodeId);
  if (idx.nodes.has(id)) return id;
  const m = /^host:(\d+)$/.exec(id);
  const h = m ? idx.hostById.get(Number(m[1])) : undefined;
  if (!h) return null;
  idx.nodes.set(id, hostNode(h));
  return id;
}

/** Abbinamento di un vicino: IP, poi MAC, poi nome (spec §3). Una chiave contesa passa al criterio dopo. */
export function resolveNode(idx: NodeIndex, ref: { ip?: string | null; mac?: string | null; name?: string | null }): string | null {
  const name = ref.name?.trim() ?? "";
  const macs = [normalizeMacForStorage(ref.mac ?? null), MAC.test(name) ? normalizeMacForStorage(name) : null];
  const candidates: Array<string | null | undefined> = [
    ref.ip ? idx.byIp.get(ref.ip) : undefined,
    ...macs.map((m) => (m ? idx.byMac.get(m) : undefined)),
    IPV4.test(name) ? idx.byIp.get(name) : undefined,
    (() => {
      const k = nameKey(name);
      return k ? idx.byName.get(k) : undefined;
    })(),
  ];
  for (const c of candidates) {
    if (typeof c === "string") return useNode(idx, c);
  }
  return null;
}
```

- [ ] **Step 5: vederla passare**

```bash
node --import tsx --test src/lib/topology/__tests__/node-index.test.ts && npx tsc --noEmit
```
Atteso: PASS. Se `normalizeMacForStorage` restituisce un formato diverso da `aa:bb:cc:dd:ee:ff` minuscolo, le prove usano lei per costruire l'atteso: non si cambia la funzione.

- [ ] **Step 6: commit**

```bash
git add src/lib/topology/model-types.ts src/lib/topology/node-index.ts src/lib/topology/__tests__/node-index.test.ts
git commit -m "feat(topologia): modello — tipi, fusione apparato↔host, abbinamento per IP, MAC e nome"
```

---

### Task 5: Collegamenti con fonte, età e correzioni (tappa C)

**Files:**
- Create: `src/lib/topology/links.ts`
- Test: `src/lib/topology/__tests__/links.test.ts`

**Interfaces:**
- Consumes: `buildNodeIndex`, `resolveNode`, `useNode`, `canonical` (Task 4); tipi del Task 4.
- Produces: `export const DEFAULT_STALE_DAYS = 2;` · `export function buildLinks(input: TopologyModelInput, idx: NodeIndex): { links: MapLink[]; unmatched: UnmatchedNeighbor[] }` · `export function pairKey(a: string, b: string): string`

- [ ] **Step 1: la prova che fallisce**

```ts
// src/lib/topology/__tests__/links.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLinks } from "@/lib/topology/links";
import { buildNodeIndex } from "@/lib/topology/node-index";
import type { ModelNeighborRow, TopologyModelInput } from "@/lib/topology/model-types";
import { dev, host } from "./node-index.test";

const ADESSO = Date.parse("2026-10-13T12:00:00Z");

function input(over: Partial<TopologyModelInput>): TopologyModelInput {
  return {
    devices: [], hosts: [], neighbors: [], uplinkPorts: [], locations: [], networks: [], knownMacs: [],
    overrides: [], nowMs: ADESSO, staleDays: 2, ...over,
  };
}
function nb(device_id: number, over: Partial<ModelNeighborRow> = {}): ModelNeighborRow {
  return {
    device_id, local_port: "Port 1", remote_device_name: "", remote_port: "", protocol: "lldp",
    remote_ip: null, remote_mac: null, timestamp: "2026-10-13 03:00:00", source: "device", ...over,
  };
}
function run(i: TopologyModelInput) {
  return buildLinks(i, buildNodeIndex(i.devices, i.hosts, i.knownMacs));
}

test("vicino abbinato per MAC quando IP e nome non bastano", () => {
  const i = input({
    devices: [dev(1), dev(2, { name: "USW-AGG", controller_mac: "aa:bb:cc:00:00:02" })],
    neighbors: [nb(1, { remote_device_name: "aggregation", remote_mac: "AA:BB:CC:00:00:02", remote_port: "Port 3" })],
  });
  const { links, unmatched } = run(i);
  assert.equal(unmatched.length, 0);
  assert.deepEqual(links.map((l) => [l.a, l.aPort, l.b, l.bPort, l.source]), [["dev:1", "Port 1", "dev:2", "Port 3", "lldp"]]);
});

test("vicino che non si abbina a niente: contato, non inventato", () => {
  const { links, unmatched } = run(input({ devices: [dev(1)], neighbors: [nb(1, { remote_device_name: "sconosciuto", remote_ip: "10.9.9.9" })] }));
  assert.equal(links.length, 0);
  assert.deepEqual(unmatched, [{ deviceNodeId: "dev:1", localPort: "Port 1", remoteName: "sconosciuto", remoteIp: "10.9.9.9", remoteMac: null }]);
});

test("uplink UniFi: collegamento dal figlio al padre con le porte; con LLDP sulla stessa coppia vince l'uplink", () => {
  const i = input({
    devices: [
      dev(1, { controller_mac: "aa:bb:cc:00:00:01" }),
      dev(2, { uplink_mac: "aa:bb:cc:00:00:01", uplink_remote_port: 7, uplink_seen_at: "2026-10-13 03:00:00" }),
    ],
    uplinkPorts: [{ device_id: 2, port_index: 25, port_name: "SFP+ 1" }],
    neighbors: [nb(1, { local_port: "Port 7", remote_ip: "10.0.0.2", remote_port: "", timestamp: "2026-10-10 03:00:00" })],
  });
  const [l] = run(i).links;
  assert.equal(l.source, "unifi_uplink");
  assert.deepEqual(l.sources, ["unifi_uplink", "lldp"]);
  assert.equal(l.uplinkFrom, "dev:2");
  assert.deepEqual([l.a, l.aPort, l.b, l.bPort], ["dev:2", "SFP+ 1", "dev:1", "Port 7"]);
  assert.equal(l.lastSeen, "2026-10-13 03:00:00", "l'ultima volta è la più recente fra le fonti");
  assert.equal(l.stale, false);
});

test("uplink verso un MAC che il DB non conosce: nessun collegamento, nessun errore", () => {
  assert.equal(run(input({ devices: [dev(2, { uplink_mac: "de:ad:00:00:00:01", uplink_seen_at: "2026-10-13 03:00:00" })] })).links.length, 0);
});

test("la correzione manuale vince su LLDP: «ignora» toglie, «aggiungi» non invecchia mai", () => {
  const base = { devices: [dev(1), dev(2), dev(3)], neighbors: [nb(1, { remote_ip: "10.0.0.2", timestamp: "2026-09-01 03:00:00" })] };
  const ignorato = run(input({ ...base, overrides: [{ id: 1, action: "ignore", a_node: "dev:2", a_port: "", b_node: "dev:1", b_port: "" }] }));
  assert.equal(ignorato.links.length, 0);
  const aggiunto = run(input({ ...base, overrides: [{ id: 2, action: "add", a_node: "dev:1", a_port: "Port 9", b_node: "dev:3", b_port: "Port 1" }] }));
  const man = aggiunto.links.find((l) => l.source === "manual")!;
  assert.deepEqual([man.a, man.aPort, man.b, man.bPort, man.stale, man.daysUnseen], ["dev:1", "Port 9", "dev:3", "Port 1", false, null]);
});

test("una correzione su un host poi promosso segue il nodo (Review Focus 4)", () => {
  const i = input({
    devices: [dev(1), dev(2, { host_id: 40, host: "10.0.1.40" })],
    hosts: [host(40, { ip: "10.0.1.40" })],
    overrides: [{ id: 1, action: "add", a_node: "dev:1", a_port: "", b_node: "host:40", b_port: "" }],
  });
  assert.deepEqual(run(i).links.map((l) => [l.a, l.b]), [["dev:1", "dev:2"]]);
});

test("un collegamento sparito diventa «non visto», non scompare; date in due formati (Review Focus 6)", () => {
  const i = input({
    devices: [dev(1), dev(2), dev(3), dev(4)],
    neighbors: [
      nb(1, { remote_ip: "10.0.0.2", timestamp: "2026-10-10 11:00:00" }),
      nb(1, { local_port: "Port 2", remote_ip: "10.0.0.3", timestamp: "2026-10-12T12:00:00Z" }),
      nb(1, { local_port: "Port 3", remote_ip: "10.0.0.4", timestamp: null }),
    ],
  });
  const per = new Map(run(i).links.map((l) => [l.b, l]));
  assert.deepEqual([per.get("dev:2")?.stale, per.get("dev:2")?.daysUnseen], [true, 3]);
  assert.deepEqual([per.get("dev:3")?.stale, per.get("dev:3")?.daysUnseen], [false, 1]);
  assert.deepEqual([per.get("dev:4")?.stale, per.get("dev:4")?.daysUnseen], [false, null]);
});

test("stessi dati in ordine diverso: stesso risultato", () => {
  const neighbors = [
    nb(1, { remote_ip: "10.0.0.2" }), nb(2, { remote_ip: "10.0.0.1", local_port: "Port 5", remote_port: "Port 1" }),
    nb(3, { remote_ip: "10.0.0.1", local_port: "Port 2" }),
  ];
  const devices = [dev(1), dev(2), dev(3)];
  const a = run(input({ devices, neighbors }));
  const b = run(input({ devices: [...devices].reverse(), neighbors: [...neighbors].reverse() }));
  assert.deepEqual(a, b);
});
```

- [ ] **Step 2: vederla fallire** — `node --import tsx --test src/lib/topology/__tests__/links.test.ts` → FAIL, modulo inesistente.

- [ ] **Step 3: `links.ts`**

```ts
// src/lib/topology/links.ts
/**
 * Collegamenti della mappa (spec §3): correzioni manuali, uplink UniFi,
 * LLDP/CDP/MNDP. Uno per coppia di nodi, con la fonte più affidabile, tutte le
 * fonti che lo vedono e quando è stato visto l'ultima volta. Un collegamento
 * che sparisce non si cancella: dopo `staleDays` è «non visto da N giorni».
 * Logica pura.
 */
import { parseDbDate } from "@/lib/db-date";
import {
  LINK_SOURCE_RANK,
  type LinkSource,
  type MapLink,
  type TopologyModelInput,
  type UnmatchedNeighbor,
} from "@/lib/topology/model-types";
import { canonical, resolveNode, useNode, type NodeIndex } from "@/lib/topology/node-index";

export const DEFAULT_STALE_DAYS = 2;
const DAY_MS = 86_400_000;

interface Candidate {
  a: string;
  aPort: string;
  b: string;
  bPort: string;
  source: LinkSource;
  lastSeen: string | null;
  uplinkFrom: string | null;
}

export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function timeOf(s: string | null): number | null {
  if (!s) return null;
  const t = parseDbDate(s).getTime();
  return Number.isNaN(t) ? null : t;
}

function sourceOfProtocol(p: string): LinkSource {
  if (p === "cdp") return "cdp";
  if (p === "mndp") return "mndp";
  return "lldp";
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function mergeInto(link: MapLink, c: Candidate): void {
  const same = c.a === link.a;
  const cA = same ? c.aPort : c.bPort;
  const cB = same ? c.bPort : c.aPort;
  if (LINK_SOURCE_RANK[c.source] < LINK_SOURCE_RANK[link.source]) {
    link.source = c.source;
    if (cA) link.aPort = cA;
    if (cB) link.bPort = cB;
  } else {
    if (!link.aPort && cA) link.aPort = cA;
    if (!link.bPort && cB) link.bPort = cB;
  }
  if (!link.sources.includes(c.source)) link.sources.push(c.source);
  const t = timeOf(c.lastSeen);
  const cur = timeOf(link.lastSeen);
  if (t !== null && (cur === null || t > cur)) link.lastSeen = c.lastSeen;
  if (c.uplinkFrom) link.uplinkFrom = c.uplinkFrom;
}

export function buildLinks(input: TopologyModelInput, idx: NodeIndex): { links: MapLink[]; unmatched: UnmatchedNeighbor[] } {
  const ignored = new Set<string>();
  const candidates: Candidate[] = [];
  const unmatched: UnmatchedNeighbor[] = [];

  // 1. Correzioni manuali (la scelta manuale vince sempre).
  for (const o of [...input.overrides].sort((x, y) => x.id - y.id)) {
    const a = useNode(idx, canonical(idx, o.a_node));
    const b = useNode(idx, canonical(idx, o.b_node));
    if (!a || !b || a === b) continue;
    if (o.action === "ignore") ignored.add(pairKey(a, b));
    else candidates.push({ a, aPort: o.a_port, b, bPort: o.b_port, source: "manual", lastSeen: null, uplinkFrom: null });
  }

  // 2. Uplink UniFi: dal figlio (chi esce) al padre.
  const uplinkPort = new Map<number, string>();
  for (const p of [...input.uplinkPorts].sort((x, y) => x.device_id - y.device_id || x.port_index - y.port_index)) {
    if (!uplinkPort.has(p.device_id)) uplinkPort.set(p.device_id, p.port_name);
  }
  for (const d of [...input.devices].sort((x, y) => x.id - y.id)) {
    if (!d.uplink_mac) continue;
    const a = `dev:${d.id}`;
    const b = resolveNode(idx, { mac: d.uplink_mac });
    if (!b || b === a) continue;
    candidates.push({
      a, aPort: uplinkPort.get(d.id) ?? "", b,
      bPort: d.uplink_remote_port != null ? `Port ${d.uplink_remote_port}` : "",
      source: "unifi_uplink", lastSeen: d.uplink_seen_at, uplinkFrom: a,
    });
  }

  // 3. LLDP / CDP / MNDP: abbinati per IP, MAC, nome.
  const neighbors = [...input.neighbors].sort(
    (x, y) => x.device_id - y.device_id || cmp(x.local_port, y.local_port) || cmp(x.remote_device_name, y.remote_device_name) || cmp(x.remote_port, y.remote_port),
  );
  for (const n of neighbors) {
    const a = `dev:${n.device_id}`;
    if (!idx.nodes.has(a)) continue;
    const b = resolveNode(idx, { ip: n.remote_ip, mac: n.remote_mac, name: n.remote_device_name });
    if (!b) {
      unmatched.push({ deviceNodeId: a, localPort: n.local_port, remoteName: n.remote_device_name, remoteIp: n.remote_ip, remoteMac: n.remote_mac });
      continue;
    }
    if (b === a) continue;
    candidates.push({ a, aPort: n.local_port, b, bPort: n.remote_port, source: sourceOfProtocol(n.protocol), lastSeen: n.timestamp, uplinkFrom: null });
  }

  const merged = new Map<string, MapLink>();
  for (const c of candidates) {
    const key = pairKey(c.a, c.b);
    if (ignored.has(key)) continue;
    const cur = merged.get(key);
    if (cur) {
      mergeInto(cur, c);
      continue;
    }
    merged.set(key, {
      id: `link:${key}`, a: c.a, aPort: c.aPort, b: c.b, bPort: c.bPort, source: c.source, sources: [c.source],
      uplinkFrom: c.uplinkFrom, lastSeen: c.lastSeen, daysUnseen: null, stale: false,
    });
  }

  const links = [...merged.values()].sort((x, y) => cmp(x.id, y.id));
  for (const l of links) {
    l.sources.sort((x, y) => LINK_SOURCE_RANK[x] - LINK_SOURCE_RANK[y] || cmp(x, y));
    const t = timeOf(l.lastSeen);
    if (l.sources.includes("manual") || t === null) {
      l.stale = false;
      l.daysUnseen = null;
      continue;
    }
    const age = Math.max(0, input.nowMs - t);
    l.daysUnseen = Math.floor(age / DAY_MS);
    l.stale = age > input.staleDays * DAY_MS;
  }
  return { links, unmatched };
}
```

Nota per chi esegue: nella prova dell'uplink, il vicino LLDP è scritto da `dev:1` verso `dev:2`, mentre l'uplink va da `dev:2` a `dev:1`; con l'uplink al primo posto fra i candidati, `a` resta `dev:2`. È voluto: il figlio sta a sinistra.

- [ ] **Step 4: vederla passare** — `node --import tsx --test src/lib/topology/__tests__/*.test.ts && npx tsc --noEmit` → PASS.

- [ ] **Step 5: commit**

```bash
git add src/lib/topology/links.ts src/lib/topology/__tests__/links.test.ts
git commit -m "feat(topologia): collegamenti con fonte ed età; correzioni manuali che vincono; uplink UniFi"
```

---

### Task 6: Sede, armadio e testa (tappa C)

**Files:**
- Create: `src/lib/topology/sites.ts`
- Test: `src/lib/topology/__tests__/sites.test.ts`

**Interfaces:**
- Consumes: `NodeIndex` (Task 4), `MapLink[]` (Task 5).
- Produces: `export function assignSites(input: TopologyModelInput, idx: NodeIndex, links: MapLink[]): SiteInfo[]` — scrive `siteId`, `rackId`, `siteProposed` sui nodi dell'indice. `export const HEAD_TYPES = ["router", "firewall"] as const;`

Regole (spec §3):
1. **manuale**: `network_devices.location_id` → sede = antenato di primo livello, armadio = quell'ubicazione se non è la sede; `siteProposed = false`;
2. **dalla subnet**: la rete dell'host (`hosts.network_id`), poi le reti che contengono l'IP di gestione, prefisso più lungo prima; la prima con `location_id` dà la sede; `siteProposed = true`;
3. **dall'albero**: un nodo senza sede prende quella del padre del suo uplink UniFi; poi, se tutti i vicini con una sede sono nella stessa, quella; `siteProposed = true`; ripetuto finché cambia qualcosa;
4. **testa**: `locations.head_device_id` (manuale); altrimenti il router o firewall della sede che è gateway del maggior numero di subnet della sede (IP propri: gestione, host fusi, host col suo MAC); a pari merito nessuna proposta.

- [ ] **Step 1: la prova che fallisce**

```ts
// src/lib/topology/__tests__/sites.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { assignSites } from "@/lib/topology/sites";
import { buildLinks } from "@/lib/topology/links";
import { buildNodeIndex } from "@/lib/topology/node-index";
import type { ModelNetworkRow, TopologyModelInput } from "@/lib/topology/model-types";
import { dev, host } from "./node-index.test";

const SEDE_A = { id: 1, name: "Sede A", parent_id: null, head_device_id: null };
const SEDE_B = { id: 2, name: "Sede B", parent_id: null, head_device_id: null };
const ARMADIO_A = { id: 3, name: "Armadio 1", parent_id: 1, head_device_id: null };

function net(id: number, cidr: string, location_id: number | null, gateway: string | null = null): ModelNetworkRow {
  return { id, cidr, name: `Rete ${id}`, gateway, location_id };
}
function run(over: Partial<TopologyModelInput>) {
  const input: TopologyModelInput = {
    devices: [], hosts: [], neighbors: [], uplinkPorts: [], locations: [SEDE_A, SEDE_B, ARMADIO_A],
    networks: [], knownMacs: [], overrides: [], nowMs: Date.parse("2026-10-13T12:00:00Z"), staleDays: 2, ...over,
  };
  const idx = buildNodeIndex(input.devices, input.hosts, input.knownMacs);
  const { links } = buildLinks(input, idx);
  const sites = assignSites(input, idx, links);
  return { idx, sites, node: (id: string) => idx.nodes.get(id)! };
}

test("manuale nell'armadio: sede = l'antenato, armadio = l'ubicazione, confermato", () => {
  const { node } = run({ devices: [dev(1, { location_id: 3 })] });
  assert.deepEqual([node("dev:1").siteId, node("dev:1").rackId, node("dev:1").siteProposed], [1, 3, false]);
});

test("dalla subnet: proposta; la scelta manuale vince", () => {
  const { node } = run({
    devices: [dev(1, { host: "10.0.0.1" }), dev(2, { host: "10.0.0.2", location_id: 2 })],
    networks: [net(1, "10.0.0.0/24", 1)],
  });
  assert.deepEqual([node("dev:1").siteId, node("dev:1").siteProposed], [1, true]);
  assert.deepEqual([node("dev:2").siteId, node("dev:2").siteProposed], [2, false]);
});

test("subnet sovrapposte: vince il prefisso più lungo (Review Focus 5)", () => {
  const { node } = run({
    devices: [dev(1, { host: "10.0.5.10" }), dev(2, { host: "10.0.6.10" })],
    networks: [net(1, "10.0.0.0/16", 1), net(2, "10.0.5.0/24", 2)],
  });
  assert.equal(node("dev:1").siteId, 2);
  assert.equal(node("dev:2").siteId, 1);
});

test("dall'albero: lo switch senza subnet prende la sede del suo uplink", () => {
  const { node } = run({
    devices: [
      dev(1, { host: "10.0.0.1", controller_mac: "aa:bb:cc:00:00:01", device_type: "router" }),
      dev(2, { host: "192.168.99.2", uplink_mac: "aa:bb:cc:00:00:01", uplink_seen_at: "2026-10-13 03:00:00" }),
    ],
    networks: [net(1, "10.0.0.0/24", 1)],
  });
  assert.deepEqual([node("dev:2").siteId, node("dev:2").siteProposed], [1, true]);
});

test("vicini in due sedi diverse: resta senza sede", () => {
  const { node } = run({
    devices: [dev(1, { location_id: 1 }), dev(2, { location_id: 2 }), dev(3, { host: "192.168.99.3" })],
    neighbors: [
      { device_id: 3, local_port: "Port 1", remote_device_name: "", remote_port: "", protocol: "lldp", remote_ip: "10.0.0.1", remote_mac: null, timestamp: "2026-10-13 03:00:00", source: "device" },
      { device_id: 3, local_port: "Port 2", remote_device_name: "", remote_port: "", protocol: "lldp", remote_ip: "10.0.0.2", remote_mac: null, timestamp: "2026-10-13 03:00:00", source: "device" },
    ],
  });
  assert.equal(node("dev:3").siteId, null);
});

test("testa proposta: il router gateway di più subnet; a pari merito nessuna; la manuale vince", () => {
  const devices = [
    dev(1, { name: "MK-RTR-CORE", host: "10.0.0.1", device_type: "router" }),
    dev(2, { name: "UDM", host: "10.0.0.254", device_type: "router" }),
  ];
  const hosts = [host(10, { ip: "10.0.1.1", mac: "aa:bb:cc:00:00:01", network_id: 2 }), host(11, { ip: "10.0.0.1", mac: "aa:bb:cc:00:00:01" })];
  const networks = [net(1, "10.0.0.0/24", 1, "10.0.0.1"), net(2, "10.0.1.0/24", 1, "10.0.1.1"), net(3, "10.0.2.0/24", 1, "10.0.0.254")];
  const proposta = run({ devices, hosts, networks }).sites.find((s) => s.locationId === 1)!;
  assert.deepEqual([proposta.headNodeId, proposta.headProposed], ["dev:1", true]);

  const pari = run({ devices, networks: [net(1, "10.0.0.0/24", 1, "10.0.0.1"), net(3, "10.0.2.0/24", 1, "10.0.0.254")] }).sites.find((s) => s.locationId === 1)!;
  assert.equal(pari.headNodeId, null);

  const manuale = run({ devices, hosts, networks, locations: [{ ...SEDE_A, head_device_id: 2 }, SEDE_B, ARMADIO_A] }).sites.find((s) => s.locationId === 1)!;
  assert.deepEqual([manuale.headNodeId, manuale.headProposed], ["dev:2", false]);
});

test("ubicazioni in cerchio (dato sporco): nessun blocco", () => {
  const { node } = run({
    locations: [{ id: 5, name: "X", parent_id: 6, head_device_id: null }, { id: 6, name: "Y", parent_id: 5, head_device_id: null }],
    devices: [dev(1, { location_id: 5 })],
  });
  assert.ok(node("dev:1").siteId === 5 || node("dev:1").siteId === 6);
});
```

- [ ] **Step 2: vederla fallire** — `node --import tsx --test src/lib/topology/__tests__/sites.test.ts` → FAIL.

- [ ] **Step 3: `sites.ts`**

```ts
// src/lib/topology/sites.ts
/**
 * Sede e armadio di ogni nodo, e testa di ogni sede (spec §3). Sede = ubicazione
 * di primo livello; armadio = ubicazione figlia. Manuale > subnet > albero; le
 * proposte si usano nel calcolo segnate `siteProposed`/`headProposed` e non si
 * scrivono mai nel DB da qui (decisione 13/10). Logica pura.
 */
import type { MapLink, ModelNetworkRow, SiteInfo, TopologyModelInput } from "@/lib/topology/model-types";
import type { NodeIndex } from "@/lib/topology/node-index";
import { isIpInCidr, normalizeMacForStorage } from "@/lib/utils";

export const HEAD_TYPES = ["router", "firewall"] as const;

function prefixLen(cidr: string): number {
  const p = Number(cidr.split("/")[1]);
  return Number.isFinite(p) ? p : 0;
}

function inCidr(ip: string, cidr: string): boolean {
  try {
    return isIpInCidr(ip, cidr);
  } catch {
    return false;
  }
}

export function assignSites(input: TopologyModelInput, idx: NodeIndex, links: MapLink[]): SiteInfo[] {
  const locById = new Map(input.locations.map((l) => [l.id, l]));
  const topCache = new Map<number, number>();
  const topOf = (id: number): number => {
    const hit = topCache.get(id);
    if (hit !== undefined) return hit;
    const seen = new Set<number>([id]);
    let cur = id;
    for (;;) {
      const parent = locById.get(cur)?.parent_id;
      if (parent == null || !locById.has(parent) || seen.has(parent)) break;
      seen.add(parent);
      cur = parent;
    }
    topCache.set(id, cur);
    return cur;
  };

  const netById = new Map(input.networks.map((n) => [n.id, n]));
  const netsLongestFirst = [...input.networks].sort((a, b) => prefixLen(b.cidr) - prefixLen(a.cidr) || a.id - b.id);
  const devById = new Map(input.devices.map((d) => [d.id, d]));
  const nodes = [...idx.nodes.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const siteFromNetworks = (ip: string | null, hostIds: number[]): number | null => {
    const cands: ModelNetworkRow[] = [];
    if (ip) cands.push(...netsLongestFirst.filter((n) => inCidr(ip, n.cidr)));
    for (const hid of hostIds) {
      const n = netById.get(idx.hostById.get(hid)?.network_id ?? -1);
      if (n) cands.push(n);
    }
    const hit = cands.find((n) => n.location_id != null && locById.has(n.location_id));
    return hit ? topOf(hit.location_id as number) : null;
  };

  // 1-2. Manuale, poi subnet.
  for (const n of nodes) {
    const d = n.kind === "device" ? devById.get(n.refId) : undefined;
    if (d?.location_id != null && locById.has(d.location_id)) {
      const top = topOf(d.location_id);
      n.siteId = top;
      n.rackId = top === d.location_id ? null : d.location_id;
      n.siteProposed = false;
      continue;
    }
    const hostIds = n.kind === "host" ? [n.refId] : n.fusedHostIds;
    const site = siteFromNetworks(n.mgmtIp, hostIds);
    if (site !== null) {
      n.siteId = site;
      n.siteProposed = true;
    }
  }

  // 3. Albero: prima gli uplink (direzione nota), poi i vicini concordi.
  const adjacency = new Map<string, string[]>();
  for (const l of links) {
    adjacency.set(l.a, [...(adjacency.get(l.a) ?? []), l.b]);
    adjacency.set(l.b, [...(adjacency.get(l.b) ?? []), l.a]);
  }
  for (let guard = nodes.length + 1, changed = true; changed && guard > 0; guard--) {
    changed = false;
    for (const l of links) {
      if (!l.uplinkFrom) continue;
      const child = idx.nodes.get(l.uplinkFrom);
      const parent = idx.nodes.get(l.uplinkFrom === l.a ? l.b : l.a);
      if (child && parent && child.siteId === null && parent.siteId !== null) {
        child.siteId = parent.siteId;
        child.siteProposed = true;
        changed = true;
      }
    }
    if (changed) continue;
    for (const n of nodes) {
      if (n.siteId !== null) continue;
      const around = new Set<number>();
      for (const other of adjacency.get(n.id) ?? []) {
        const s = idx.nodes.get(other)?.siteId;
        if (s != null) around.add(s);
      }
      if (around.size === 1) {
        n.siteId = [...around][0];
        n.siteProposed = true;
        changed = true;
      }
    }
  }

  // 4. Testa.
  const ipsByNode = new Map<string, Set<string>>();
  const addIp = (id: string, ip: string | null | undefined) => {
    if (!ip) return;
    const s = ipsByNode.get(id) ?? new Set<string>();
    s.add(ip);
    ipsByNode.set(id, s);
  };
  for (const n of nodes) {
    addIp(n.id, n.mgmtIp);
    for (const h of n.fusedHostIds) addIp(n.id, idx.hostById.get(h)?.ip);
  }
  for (const h of idx.hostById.values()) {
    const owner = h.mac ? idx.byMac.get(normalizeMacForStorage(h.mac) ?? "") : undefined;
    if (typeof owner === "string" && owner.startsWith("dev:")) addIp(owner, h.ip);
  }

  const tops = input.locations
    .filter((l) => l.parent_id == null || !locById.has(l.parent_id))
    .sort((a, b) => a.name.localeCompare(b.name, "it") || a.id - b.id);
  return tops.map((loc) => {
    const nodeIds = nodes.filter((n) => n.siteId === loc.id).map((n) => n.id);
    if (loc.head_device_id != null && idx.nodes.has(`dev:${loc.head_device_id}`)) {
      return { locationId: loc.id, name: loc.name, headNodeId: `dev:${loc.head_device_id}`, headProposed: false, nodeIds };
    }
    const gateways = input.networks
      .filter((nw) => nw.gateway && nw.location_id != null && locById.has(nw.location_id) && topOf(nw.location_id) === loc.id)
      .map((nw) => nw.gateway as string);
    let best: string | null = null;
    let bestScore = 0;
    let tie = false;
    for (const id of nodeIds) {
      const n = idx.nodes.get(id);
      if (!n || n.kind !== "device" || !(HEAD_TYPES as readonly string[]).includes(n.type)) continue;
      const mine = ipsByNode.get(id) ?? new Set<string>();
      const score = gateways.filter((g) => mine.has(g)).length;
      if (score > bestScore) {
        best = id;
        bestScore = score;
        tie = false;
      } else if (score > 0 && score === bestScore) {
        tie = true;
      }
    }
    return { locationId: loc.id, name: loc.name, headNodeId: best && !tie ? best : null, headProposed: Boolean(best && !tie), nodeIds };
  });
}
```

- [ ] **Step 4: vederla passare** — `node --import tsx --test src/lib/topology/__tests__/*.test.ts && npx tsc --noEmit` → PASS.

- [ ] **Step 5: commit**

```bash
git add src/lib/topology/sites.ts src/lib/topology/__tests__/sites.test.ts
git commit -m "feat(topologia): sede e armadio di ogni nodo (manuale, subnet, albero) e testa della sede proposta"
```

---

### Task 7: Il modello intero: proposte, «da sistemare», conteggi (tappa C)

**Files:**
- Create: `src/lib/topology/model.ts`
- Test: `src/lib/topology/__tests__/model.test.ts`

**Interfaces:**
- Consumes: Task 4, 5, 6.
- Produces: `export function buildTopologyModel(input: TopologyModelInput): TopologyModel` · `export const PROMOTE_CLASSES = ["switch", "router", "access_point", "firewall"] as const;`

Definizioni (vanno anche nella pagina «Dati della mappa»):
- **proposta «promuovi»**: host non fuso, classificato switch/router/AP/firewall, con almeno un collegamento;
- **isolato**: apparato non nascosto senza collegamenti;
- **tipo sospetto**: isolato, di tipo switch o AP, senza porte lette (i 19 «switch» che sono PC sull'hub);
- **senza sede**: apparato non nascosto senza sede, né confermata né proposta;
- `deviceLinks` = collegamenti fra due apparati; `attachedLinks` = fra un apparato e un host.

- [ ] **Step 1: la prova che fallisce**

```ts
// src/lib/topology/__tests__/model.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTopologyModel } from "@/lib/topology/model";
import type { TopologyModelInput } from "@/lib/topology/model-types";
import { dev, host } from "./node-index.test";

function input(over: Partial<TopologyModelInput> = {}): TopologyModelInput {
  return {
    devices: [
      dev(1, { name: "RTR-1", device_type: "router", host: "10.0.0.1" }),
      dev(2, { name: "SW-2", host: "10.0.0.2" }),
      dev(3, { name: "SW-FALSO", host: "10.0.0.3", port_count: 0 }),
    ],
    hosts: [
      host(40, { ip: "10.0.0.40", classification: "switch", hostname: "sw-solo-host" }),
      host(41, { ip: "10.0.0.41", classification: "hypervisor", hostname: "pve-1" }),
    ],
    neighbors: [
      { device_id: 2, local_port: "Port 1", remote_device_name: "", remote_port: "ether2", protocol: "lldp", remote_ip: "10.0.0.1", remote_mac: null, timestamp: "2026-10-13 03:00:00", source: "device" },
      { device_id: 2, local_port: "Port 5", remote_device_name: "sw-solo-host", remote_port: "", protocol: "lldp", remote_ip: null, remote_mac: null, timestamp: "2026-10-13 03:00:00", source: "device" },
      { device_id: 2, local_port: "Port 6", remote_device_name: "pve-1", remote_port: "", protocol: "lldp", remote_ip: null, remote_mac: null, timestamp: "2026-10-01 03:00:00", source: "device" },
    ],
    uplinkPorts: [],
    locations: [{ id: 1, name: "Sede A", parent_id: null, head_device_id: null }],
    networks: [{ id: 1, cidr: "10.0.0.0/24", name: "LAN", gateway: "10.0.0.1", location_id: 1 }],
    knownMacs: [], overrides: [], nowMs: Date.parse("2026-10-13T12:00:00Z"), staleDays: 2, ...over,
  };
}

test("conteggi, proposte e «da sistemare»", () => {
  const m = buildTopologyModel(input());
  assert.deepEqual(m.promote.map((p) => [p.hostId, p.links]), [[40, 1]]);
  assert.deepEqual(m.isolated, ["dev:3"]);
  assert.deepEqual(m.suspicious, ["dev:3"]);
  assert.deepEqual(m.withoutSite, []);
  assert.equal(m.sites[0].headNodeId, "dev:1");
  assert.equal(m.counts.deviceLinks, 1);
  assert.equal(m.counts.attachedLinks, 2);
  assert.equal(m.counts.staleLinks, 1);
  assert.equal(m.counts.sitesWithHead, 1);
  assert.equal(m.counts.linksBySource.lldp, 3);
});

test("l'host promosso (ora apparato con host_id) esce dalle proposte", () => {
  const i = input();
  i.devices.push(dev(9, { name: "SW-PROMOSSO", host: "10.0.0.40", host_id: 40 }));
  assert.deepEqual(buildTopologyModel(i).promote, []);
});

test("stessi dati, stesso modello; un AP in più non cambia sedi e collegamenti degli altri", () => {
  const a = buildTopologyModel(input());
  assert.equal(JSON.stringify(a), JSON.stringify(buildTopologyModel(input())));
  const i = input();
  i.devices.push(dev(20, { name: "AP-1", device_type: "access_point", host: "10.0.0.20" }));
  i.neighbors.push({ device_id: 20, local_port: "eth0", remote_device_name: "SW-2", remote_port: "Port 8", protocol: "lldp", remote_ip: null, remote_mac: null, timestamp: "2026-10-13 03:00:00", source: "unifi" });
  const b = buildTopologyModel(i);
  for (const l of a.links) assert.deepEqual(b.links.find((x) => x.id === l.id), l);
  for (const n of a.nodes) assert.deepEqual(b.nodes.find((x) => x.id === n.id), n);
});
```

- [ ] **Step 2: vederla fallire** — `node --import tsx --test src/lib/topology/__tests__/model.test.ts` → FAIL.

- [ ] **Step 3: `model.ts`**

```ts
// src/lib/topology/model.ts
/**
 * Il modello della mappa (spec §3, fase 1 «i dati giusti»): nodi fusi,
 * collegamenti con fonte ed età, sedi con testa, proposte e «da sistemare».
 * Si calcola a ogni richiesta, non si salva. Logica pura.
 */
import { buildLinks } from "@/lib/topology/links";
import {
  LINK_SOURCE_RANK,
  type LinkSource,
  type ModelCounts,
  type TopologyModel,
  type TopologyModelInput,
} from "@/lib/topology/model-types";
import { buildNodeIndex } from "@/lib/topology/node-index";
import { assignSites } from "@/lib/topology/sites";

export const PROMOTE_CLASSES = ["switch", "router", "access_point", "firewall"] as const;
const SUSPICIOUS_TYPES = ["switch", "access_point"];

export function buildTopologyModel(input: TopologyModelInput): TopologyModel {
  const idx = buildNodeIndex(input.devices, input.hosts, input.knownMacs);
  const { links, unmatched } = buildLinks(input, idx);
  const sites = assignSites(input, idx, links);

  const degree = new Map<string, number>();
  for (const l of links) {
    degree.set(l.a, (degree.get(l.a) ?? 0) + 1);
    degree.set(l.b, (degree.get(l.b) ?? 0) + 1);
  }
  const nodes = [...idx.nodes.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const portCount = new Map(input.devices.map((d) => [d.id, d.port_count]));
  const devices = nodes.filter((n) => n.kind === "device");

  const promote = nodes
    .filter((n) => n.kind === "host" && (PROMOTE_CLASSES as readonly string[]).includes(n.type) && (degree.get(n.id) ?? 0) > 0)
    .map((n) => ({
      hostId: n.refId, name: n.name, ip: n.mgmtIp ?? "", classification: n.type, links: degree.get(n.id) ?? 0,
    }))
    .sort((a, b) => b.links - a.links || a.name.localeCompare(b.name, "it") || a.hostId - b.hostId);
  const isolated = devices.filter((n) => !n.hidden && (degree.get(n.id) ?? 0) === 0).map((n) => n.id);
  const suspicious = isolated.filter((id) => {
    const n = idx.nodes.get(id);
    return n !== undefined && SUSPICIOUS_TYPES.includes(n.type) && (portCount.get(n.refId) ?? 0) === 0;
  });
  const withoutSite = devices.filter((n) => !n.hidden && n.siteId === null).map((n) => n.id);

  const linksBySource = Object.fromEntries(
    (Object.keys(LINK_SOURCE_RANK) as LinkSource[]).map((s) => [s, links.filter((l) => l.source === s).length]),
  ) as Record<LinkSource, number>;
  const isDev = (id: string) => id.startsWith("dev:");
  const counts: ModelCounts = {
    nodes: nodes.length,
    devices: devices.length,
    links: links.length,
    linksBySource,
    deviceLinks: links.filter((l) => isDev(l.a) && isDev(l.b)).length,
    attachedLinks: links.filter((l) => isDev(l.a) !== isDev(l.b)).length,
    staleLinks: links.filter((l) => l.stale).length,
    unmatchedNeighbors: unmatched.length,
    isolatedDevices: isolated.length,
    fusedHosts: idx.fusedHosts,
    devicesWithoutSite: withoutSite.length,
    sitesWithHead: sites.filter((s) => s.headNodeId !== null).length,
    promoteProposals: promote.length,
    suspiciousTypes: suspicious.length,
  };
  return { nodes, links, sites, promote, unmatched, isolated, suspicious, withoutSite, counts };
}
```

- [ ] **Step 4: vederla passare** — `node --import tsx --test src/lib/topology/__tests__/*.test.ts && npx tsc --noEmit && npm run lint` → PASS (le prove della mappa vecchia `graph/layout/match/status` incluse).

- [ ] **Step 5: commit**

```bash
git add src/lib/topology/model.ts src/lib/topology/__tests__/model.test.ts
git commit -m "feat(topologia): buildTopologyModel — proposte «promuovi», da sistemare, conteggi"
```

---

### Unione delle tappe B e C (sessione principale)

- [ ] Revisione finale della tappa C (un revisore, tutta la cartella `src/lib/topology/`).
- [ ] Unire `topologia/fase1-modello` in `topologia/fase1-dati` e togliere il secondo worktree:

```bash
cd /Users/riccardo/Progetti/Domarc/DA-IPAM/.claude/worktrees/topologia-f1
git merge --no-ff topologia/fase1-modello -m "merge: costruttore del modello della topologia (fase 1)"
LOG="$S/cancello-unione.log"; (npm run lint && npx tsc --noEmit && DA_INVENT_DATA_DIR=$(mktemp -d) npm test) > "$LOG" 2>&1; ESITO=$?; echo "exit=$ESITO"; tail -5 "$LOG"
cd .. && git worktree remove topologia-f1-modello && git branch -d topologia/fase1-modello
```
Atteso: `exit=0`. Le due tappe toccano file diversi: nessun conflitto atteso; se c'è, si risolve a mano e lo si scrive.

---

### Task 8: Letture e scritture del modello nel DB (tappa D)

**Files:**
- Modify: `src/lib/db-tenant.ts` (sezione nuova «TOPOLOGIA — modello (fase 1)», in fondo, vicino a `getTopologyData`)
- Create: `src/lib/topology/settings.ts`
- Test: `src/lib/__tests__/topology-db.test.ts`

**Interfaces:**
- Consumes: tipi del Task 4; colonne del Task 1; `getNetworkDeviceKnownMacs` (esiste).
- Produces (in `db-tenant.ts`):
  - `getTopologyModelInput(staleDays: number, nowMs?: number): TopologyModelInput`
  - `setDeviceLocation(deviceId: number, locationId: number | null, author: string): { ok: true } | { ok: false; error: string }`
  - `getSiteTopology(locationId: number): SiteTopologyRow | null` con `interface SiteTopologyRow { location_id: number; head_device_id: number | null; head_set_by: string | null; head_set_at: string | null; network_ids: number[] }`
  - `setSiteTopology(locationId: number, input: { headDeviceId?: number | null; networkIds?: number[] }, author: string): { ok: true } | { ok: false; error: string }`
  - `listLinkOverrides(): LinkOverrideView[]` con `interface LinkOverrideView extends LinkOverrideRow { note: string | null; created_by: string | null; created_at: string }`
  - `addLinkOverride(input: { action: "add" | "ignore"; a_node: string; a_port: string; b_node: string; b_port: string; note: string | null }, author: string): number`
  - `deleteLinkOverride(id: number): boolean`
- Produces (in `settings.ts`): `getLinkStaleDays(): number` · `setLinkStaleDays(days: number): void` · `export const LINK_STALE_DAYS_MIN = 1, LINK_STALE_DAYS_MAX = 30;`

- [ ] **Step 1: la prova che fallisce**

```ts
// src/lib/__tests__/topology-db.test.ts
import { removeTestHubDb } from "@/lib/integrations/__tests__/support/hub-isolato";
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { closeHubDb } from "@/lib/db-hub";
import {
  addLinkOverride, deleteLinkOverride, deleteTenantDatabase, getSiteTopology, getTenantDb, getTopologyModelInput,
  listLinkOverrides, setDeviceLocation, setSiteTopology, withTenant,
} from "@/lib/db-tenant";
import { getLinkStaleDays, setLinkStaleDays } from "@/lib/topology/settings";

const T = "TESTTOPODB";
const db = () => getTenantDb(T);
const w = <R>(fn: () => R): R => withTenant(T, fn);

beforeEach(() => {
  db().exec("DELETE FROM topology_link_overrides; DELETE FROM switch_ports; DELETE FROM device_neighbors; DELETE FROM network_devices; DELETE FROM hosts; DELETE FROM networks; DELETE FROM locations;");
  db().exec(`
    INSERT INTO locations (id, name, parent_id) VALUES (1, 'Sede A', NULL), (2, 'Armadio 1', 1), (3, 'Sede B', NULL);
    INSERT INTO networks (id, cidr, name, gateway) VALUES (1, '10.0.0.0/24', 'LAN', '10.0.0.1'), (2, '10.0.1.0/24', 'VOIP', '10.0.1.1'), (3, '10.0.2.0/24', 'OSPITI', NULL);
    INSERT INTO network_devices (id, name, host, device_type, vendor, protocol) VALUES (1, 'RTR-1', '10.0.0.1', 'router', 'mikrotik', 'ssh'), (2, 'SW-2', '10.0.0.2', 'switch', 'ubiquiti', 'api');
    INSERT INTO switch_ports (device_id, port_index, port_name, is_uplink) VALUES (2, 1, 'Port 1', 1), (2, 2, 'Port 2', 0);
  `);
});
after(() => {
  deleteTenantDatabase(T);
  closeHubDb();
  removeTestHubDb();
});

test("getTopologyModelInput: righe nella forma del modello", () => {
  const i = w(() => getTopologyModelInput(2, 1_000));
  assert.equal(i.staleDays, 2);
  assert.equal(i.nowMs, 1_000);
  assert.deepEqual(i.devices.map((d) => [d.id, d.port_count, d.topology_hidden, d.location_id]), [[1, 0, 0, null], [2, 2, 0, null]]);
  assert.deepEqual(i.uplinkPorts, [{ device_id: 2, port_index: 1, port_name: "Port 1" }]);
  assert.equal(i.locations.length, 3);
});

test("sede dell'apparato: scritta con autore e data; ubicazione inesistente rifiutata", () => {
  assert.deepEqual(w(() => setDeviceLocation(2, 2, "riccardo")), { ok: true });
  const r = db().prepare("SELECT location_id, location_set_by, location_set_at FROM network_devices WHERE id = 2").get() as Record<string, unknown>;
  assert.equal(r.location_id, 2);
  assert.equal(r.location_set_by, "riccardo");
  assert.ok(r.location_set_at);
  assert.equal(w(() => setDeviceLocation(2, 99, "riccardo")).ok, false);
  assert.deepEqual(w(() => setDeviceLocation(2, null, "riccardo")), { ok: true });
});

test("testa e subnet: solo su una sede; l'elenco delle subnet si sostituisce", () => {
  assert.equal(w(() => setSiteTopology(2, { headDeviceId: 1 }, "riccardo")).ok, false, "un armadio non ha testa");
  assert.deepEqual(w(() => setSiteTopology(1, { headDeviceId: 1, networkIds: [1, 2] }, "riccardo")), { ok: true });
  assert.deepEqual(w(() => getSiteTopology(1))?.network_ids, [1, 2]);
  assert.deepEqual(w(() => setSiteTopology(1, { networkIds: [2, 3] }, "riccardo")), { ok: true });
  assert.deepEqual(w(() => getSiteTopology(1))?.network_ids, [2, 3]);
  assert.equal(w(() => getSiteTopology(1))?.head_device_id, 1, "la testa resta se non la si tocca");
  assert.equal(w(() => setSiteTopology(1, { networkIds: [99] }, "riccardo")).ok, false);
  assert.equal(w(() => setSiteTopology(1, { headDeviceId: 99 }, "riccardo")).ok, false);
  const net1 = db().prepare("SELECT location_id, location_set_by FROM networks WHERE id = 1").get() as Record<string, unknown>;
  assert.deepEqual(net1, { location_id: null, location_set_by: "riccardo" });
});

test("correzioni ai collegamenti: aggiungi, elenca, togli", () => {
  const id = w(() => addLinkOverride({ action: "ignore", a_node: "dev:1", a_port: "", b_node: "host:5", b_port: "", note: "doppio" }, "riccardo"));
  const lista = w(() => listLinkOverrides());
  assert.equal(lista.length, 1);
  assert.equal(lista[0].created_by, "riccardo");
  assert.equal(w(() => deleteLinkOverride(id)), true);
  assert.equal(w(() => deleteLinkOverride(id)), false);
});

test("soglia «non visto»: 2 di partenza, limiti 1-30", () => {
  assert.equal(getLinkStaleDays(), 2);
  setLinkStaleDays(5);
  assert.equal(getLinkStaleDays(), 5);
  assert.throws(() => setLinkStaleDays(0));
  assert.throws(() => setLinkStaleDays(31));
  setLinkStaleDays(2);
});
```

- [ ] **Step 2: vederla fallire** — `DA_INVENT_DATA_DIR=$(mktemp -d) node --import tsx --test src/lib/__tests__/topology-db.test.ts` → FAIL.

- [ ] **Step 3: `settings.ts`**

```ts
// src/lib/topology/settings.ts
/**
 * Soglia «non visto» dei collegamenti (decisione di Riccardo, 13/10: 2 giorni;
 * con una lettura UniFi al giorno un giorno esatto farebbe diventare grigio
 * tutto a ogni lettura in ritardo). Impostazione dell'hub: un'installazione =
 * un cliente.
 */
import { getSetting, setSetting } from "@/lib/db-hub";
import { DEFAULT_STALE_DAYS } from "@/lib/topology/links";

const KEY = "topology_link_stale_days";
export const LINK_STALE_DAYS_MIN = 1;
export const LINK_STALE_DAYS_MAX = 30;

export function getLinkStaleDays(): number {
  const n = Number(getSetting(KEY));
  return Number.isInteger(n) && n >= LINK_STALE_DAYS_MIN && n <= LINK_STALE_DAYS_MAX ? n : DEFAULT_STALE_DAYS;
}

export function setLinkStaleDays(days: number): void {
  if (!Number.isInteger(days) || days < LINK_STALE_DAYS_MIN || days > LINK_STALE_DAYS_MAX) {
    throw new Error(`La soglia va da ${LINK_STALE_DAYS_MIN} a ${LINK_STALE_DAYS_MAX} giorni`);
  }
  setSetting(KEY, String(days));
}
```

- [ ] **Step 4: le funzioni in `db-tenant.ts`**

```ts
// ═══════════════════════════════════════════════════════════════════════════
// TOPOLOGIA — modello (fase 1, piano 2026-10-13): letture in blocco (no N+1)
// e le sole scritture che un admin conferma (sede, testa, subnet, correzioni).
// ═══════════════════════════════════════════════════════════════════════════

type ModelInput = import("@/lib/topology/model-types").TopologyModelInput;
type Esito = { ok: true } | { ok: false; error: string };

export function getTopologyModelInput(staleDays: number, nowMs: number = Date.now()): ModelInput {
  const d = db();
  return {
    devices: d.prepare(`
      SELECT nd.id, nd.name, nd.host, nd.device_type, nd.vendor, nd.model, nd.enabled, nd.host_id, nd.physical_device_id,
             nd.location_id, nd.controller_mac, nd.uplink_mac, nd.uplink_remote_port, nd.uplink_seen_at, nd.topology_hidden,
             COALESCE(sp.n, 0) AS port_count
        FROM network_devices nd
        LEFT JOIN (SELECT device_id, COUNT(*) AS n FROM switch_ports GROUP BY device_id) sp ON sp.device_id = nd.id
       ORDER BY nd.id`).all() as ModelInput["devices"],
    hosts: d.prepare(`
      SELECT id, network_id, ip, mac, hostname, custom_name, classification, status, physical_device_id
        FROM hosts ORDER BY id`).all() as ModelInput["hosts"],
    neighbors: d.prepare(`
      SELECT device_id, local_port, remote_device_name, remote_port, protocol, remote_ip, remote_mac, timestamp, source
        FROM device_neighbors`).all() as ModelInput["neighbors"],
    uplinkPorts: d.prepare(`
      SELECT device_id, port_index, port_name FROM switch_ports WHERE is_uplink = 1 ORDER BY device_id, port_index`).all() as ModelInput["uplinkPorts"],
    locations: d.prepare("SELECT id, name, parent_id, head_device_id FROM locations ORDER BY id").all() as ModelInput["locations"],
    networks: d.prepare("SELECT id, cidr, name, gateway, location_id FROM networks ORDER BY id").all() as ModelInput["networks"],
    knownMacs: getNetworkDeviceKnownMacs(),
    overrides: d.prepare("SELECT id, action, a_node, a_port, b_node, b_port FROM topology_link_overrides ORDER BY id").all() as ModelInput["overrides"],
    nowMs,
    staleDays,
  };
}

export function setDeviceLocation(deviceId: number, locationId: number | null, author: string): Esito {
  const d = db();
  if (!d.prepare("SELECT 1 FROM network_devices WHERE id = ?").get(deviceId)) return { ok: false, error: "Apparato non trovato" };
  if (locationId !== null && !d.prepare("SELECT 1 FROM locations WHERE id = ?").get(locationId)) {
    return { ok: false, error: "Ubicazione non trovata" };
  }
  d.prepare("UPDATE network_devices SET location_id = ?, location_set_by = ?, location_set_at = datetime('now') WHERE id = ?")
    .run(locationId, author, deviceId);
  return { ok: true };
}

export interface SiteTopologyRow {
  location_id: number;
  head_device_id: number | null;
  head_set_by: string | null;
  head_set_at: string | null;
  network_ids: number[];
}

export function getSiteTopology(locationId: number): SiteTopologyRow | null {
  const d = db();
  const loc = d.prepare("SELECT id, head_device_id, head_set_by, head_set_at FROM locations WHERE id = ?").get(locationId) as
    | { id: number; head_device_id: number | null; head_set_by: string | null; head_set_at: string | null }
    | undefined;
  if (!loc) return null;
  const nets = d.prepare("SELECT id FROM networks WHERE location_id = ? ORDER BY id").all(locationId) as Array<{ id: number }>;
  return { location_id: loc.id, head_device_id: loc.head_device_id, head_set_by: loc.head_set_by, head_set_at: loc.head_set_at, network_ids: nets.map((n) => n.id) };
}

/** Testa e subnet di una SEDE (ubicazione di primo livello). `networkIds` sostituisce l'elenco. */
export function setSiteTopology(locationId: number, input: { headDeviceId?: number | null; networkIds?: number[] }, author: string): Esito {
  const d = db();
  const loc = d.prepare("SELECT parent_id FROM locations WHERE id = ?").get(locationId) as { parent_id: number | null } | undefined;
  if (!loc) return { ok: false, error: "Ubicazione non trovata" };
  if (loc.parent_id !== null) return { ok: false, error: "Testa e subnet si scelgono solo per una sede (ubicazione di primo livello)" };
  if (input.headDeviceId != null && !d.prepare("SELECT 1 FROM network_devices WHERE id = ?").get(input.headDeviceId)) {
    return { ok: false, error: "Apparato di testa non trovato" };
  }
  const ids = [...new Set(input.networkIds ?? [])];
  if (ids.length > 0) {
    const found = d.prepare(`SELECT COUNT(*) AS n FROM networks WHERE id IN (${ids.map(() => "?").join(",")})`).get(...ids) as { n: number };
    if (found.n !== ids.length) return { ok: false, error: "Una delle subnet non esiste" };
  }
  d.transaction(() => {
    if (input.headDeviceId !== undefined) {
      d.prepare("UPDATE locations SET head_device_id = ?, head_set_by = ?, head_set_at = datetime('now'), updated_at = datetime('now') WHERE id = ?")
        .run(input.headDeviceId, author, locationId);
    }
    if (input.networkIds !== undefined) {
      const keep = ids.length > 0 ? `AND id NOT IN (${ids.map(() => "?").join(",")})` : "";
      d.prepare(`UPDATE networks SET location_id = NULL, location_set_by = ?, location_set_at = datetime('now') WHERE location_id = ? ${keep}`)
        .run(author, locationId, ...ids);
      if (ids.length > 0) {
        d.prepare(`UPDATE networks SET location_id = ?, location_set_by = ?, location_set_at = datetime('now') WHERE id IN (${ids.map(() => "?").join(",")})`)
          .run(locationId, author, ...ids);
      }
    }
  })();
  return { ok: true };
}

export interface LinkOverrideView extends import("@/lib/topology/model-types").LinkOverrideRow {
  note: string | null;
  created_by: string | null;
  created_at: string;
}

export function listLinkOverrides(): LinkOverrideView[] {
  return db().prepare("SELECT * FROM topology_link_overrides ORDER BY id").all() as LinkOverrideView[];
}

export function addLinkOverride(
  input: { action: "add" | "ignore"; a_node: string; a_port: string; b_node: string; b_port: string; note: string | null },
  author: string,
): number {
  const r = db().prepare(
    "INSERT INTO topology_link_overrides (action, a_node, a_port, b_node, b_port, note, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(input.action, input.a_node, input.a_port, input.b_node, input.b_port, input.note, author);
  return Number(r.lastInsertRowid);
}

export function deleteLinkOverride(id: number): boolean {
  return db().prepare("DELETE FROM topology_link_overrides WHERE id = ?").run(id).changes > 0;
}
```

Spostare una subnet da una sede a un'altra = scriverla nell'elenco della nuova sede: `setSiteTopology` la toglie alla vecchia senza dirlo. La finestra di dialogo del Task 11 mostra di chi è oggi ogni subnet, così lo spostamento si vede prima del salvataggio.

- [ ] **Step 5: vederla passare** — `DA_INVENT_DATA_DIR=$(mktemp -d) node --import tsx --test src/lib/__tests__/topology-db.test.ts src/lib/__tests__/no-dynamic-db-tenant-import.test.ts && npx tsc --noEmit` → PASS.

- [ ] **Step 6: commit**

```bash
git add src/lib/db-tenant.ts src/lib/topology/settings.ts src/lib/__tests__/topology-db.test.ts
git commit -m "feat(topologia): letture del modello in blocco, sede, testa e subnet confermate, correzioni, soglia"
```

---

### Task 9: Fixture anonime di Domarc e DTS (tappa D)

**Files:**
- Create: `src/lib/topology/anonimizza.ts`
- Create: `scripts/estrai-fixture-topologia.ts`
- Create: `src/lib/topology/__tests__/fixtures/topologia-domarc.json`, `topologia-cliente-a.json` (generate)
- Test: `src/lib/topology/__tests__/anonimizza.test.ts`, `src/lib/topology/__tests__/fixture-anonime.test.ts`, `src/lib/topology/__tests__/model-fixtures.test.ts`

**Interfaces:**
- Consumes: `getTopologyModelInput` (Task 8), `buildTopologyModel` (Task 7), `buildTopologyGraph` (mappa vecchia, `graph.ts`), `PROMOTE_CLASSES`.
- Produces: `export function anonimizzaInput(input: TopologyModelInput): TopologyModelInput` — forma identica, nessun nome, IP o MAC veri; reti, contenimenti, gateway, MAC condivisi e nomi uguali restano tali.

**Il repo è pubblico.** Le fixture escono dalla copia del DB del cliente: la prova `fixture-anonime.test.ts` è il cancello che impedisce di pubblicare un nome, un IP o un MAC vero.

Regole di `anonimizzaInput`:
- **IP**: ogni rete «esterna» (non contenuta in un'altra), in ordine di id, prende un blocco nuovo allineato alla sua dimensione dentro `10.0.0.0/8`; un IP o una rete interna si sposta con lo stesso scarto. IP fuori da ogni rete → `172.31.x.y` in sequenza. Se lo spazio finisce: errore, niente fixture.
- **MAC**: ogni MAC diverso (normalizzato) → `02:00:00:xx:xx:xx` in sequenza (indirizzo «locale»).
- **Nomi**: un dizionario sul nome normalizzato (`normalizeName`) → `<SIGLA>-<n>` per apparati (`RTR`, `SW`, `AP`, `FW`, `HV`, `NAS`, `SRV`, `DEV` secondo `device_type`), `host-<n>` per gli host, `ext-<n>` per i nomi che compaiono solo nei vicini; lo stesso nome normalizzato dà sempre lo stesso pseudonimo, così l'abbinamento per nome resta quello vero. Un `remote_device_name` a forma di IP o MAC si mappa come IP o MAC.
- **Ubicazioni**: `Sede-<n>` (primo livello), `Ubicazione-<n>` (le altre). **Reti**: `Rete-<n>`.
- Porte, protocolli, tipi, classificazioni, conteggi, date: restano (non identificano il cliente). `model` → null.
- Host: solo quelli che servono al modello (fusi con un apparato, abbinati da un vicino, o classificati come in `PROMOTE_CLASSES`): la fixture resta piccola.

- [ ] **Step 1: le prove che falliscono**

```ts
// src/lib/topology/__tests__/anonimizza.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { anonimizzaInput } from "@/lib/topology/anonimizza";
import { buildTopologyModel } from "@/lib/topology/model";
import type { TopologyModelInput } from "@/lib/topology/model-types";
import { dev, host } from "./node-index.test";

const VERO: TopologyModelInput = {
  devices: [
    dev(1, { name: "MK-RTR-CORE", host: "192.168.15.1", device_type: "router", controller_mac: "f4:1e:57:aa:bb:01" }),
    dev(2, { name: "USW-Piano1", host: "192.168.15.20", uplink_mac: "f4:1e:57:aa:bb:01", uplink_seen_at: "2026-10-13 03:00:00" }),
  ],
  hosts: [host(7, { ip: "192.168.20.5", mac: "F4-1E-57-AA-BB-01", hostname: "mk-rtr-core.domarc.local", network_id: 2 })],
  neighbors: [{ device_id: 2, local_port: "Port 1", remote_device_name: "MK-RTR-CORE", remote_port: "ether3", protocol: "lldp", remote_ip: null, remote_mac: null, timestamp: "2026-10-13 03:00:00", source: "unifi" }],
  uplinkPorts: [],
  locations: [{ id: 1, name: "Domarc Bergamo", parent_id: null, head_device_id: null }],
  networks: [
    { id: 1, cidr: "192.168.15.0/24", name: "LAN uffici", gateway: "192.168.15.1", location_id: 1 },
    { id: 2, cidr: "192.168.20.0/24", name: "Server", gateway: "192.168.20.1", location_id: 1 },
  ],
  knownMacs: [{ device_id: 1, mac: "f4:1e:57:aa:bb:01" }],
  overrides: [], nowMs: Date.parse("2026-10-13T12:00:00Z"), staleDays: 2,
};

test("nessun nome, IP o MAC vero esce", () => {
  const testo = JSON.stringify(anonimizzaInput(VERO));
  for (const vero of ["MK-RTR-CORE", "USW-Piano1", "domarc", "Bergamo", "192.168.", "f4:1e:57", "F4-1E-57", "LAN uffici"]) {
    assert.equal(testo.toLowerCase().includes(vero.toLowerCase()), false, `«${vero}» è nella fixture`);
  }
});

test("la forma resta: stesso modello, stessi conteggi", () => {
  const prima = buildTopologyModel(VERO).counts;
  const dopo = buildTopologyModel(anonimizzaInput(VERO)).counts;
  assert.deepEqual(dopo, prima);
});

test("lo spazio degli indirizzi finito: errore, niente fixture", () => {
  const troppe = { ...VERO, networks: [{ id: 1, cidr: "0.0.0.0/0", name: "x", gateway: null, location_id: null }, { id: 2, cidr: "11.0.0.0/8", name: "y", gateway: null, location_id: null }] };
  assert.throws(() => anonimizzaInput(troppe));
});
```

```ts
// src/lib/topology/__tests__/fixture-anonime.test.ts
// Il repo è pubblico: una fixture con un nome, un IP o un MAC vero non passa.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const DIR = path.join(__dirname, "fixtures");
const FILES = fs.readdirSync(DIR).filter((f) => f.startsWith("topologia-") && f.endsWith(".json"));
const IP = /\b\d{1,3}(?:\.\d{1,3}){3}\b/g;
const MAC = /\b[0-9a-f]{2}(?::[0-9a-f]{2}){5}\b/gi;
const NOME = /^(RTR|SW|AP|FW|HV|NAS|SRV|DEV|host|ext|Sede|Ubicazione|Rete)-\d+$/;

test("ci sono le due fixture", () => {
  assert.deepEqual(FILES.sort(), ["topologia-domarc.json", "topologia-cliente-a.json"]);
});

for (const f of FILES) {
  test(`${f}: solo indirizzi finti e nomi pseudonimi`, () => {
    const testo = fs.readFileSync(path.join(DIR, f), "utf8");
    for (const ip of testo.match(IP) ?? []) assert.ok(ip.startsWith("10.") || ip.startsWith("172.31."), `IP vero? ${ip}`);
    for (const mac of testo.match(MAC) ?? []) assert.ok(mac.toLowerCase().startsWith("02:00:00:"), `MAC vero? ${mac}`);
    for (const parola of ["domarc", "dts", "bergamo"]) assert.equal(testo.toLowerCase().includes(parola), false, parola);
    const j = JSON.parse(testo) as { devices: Array<{ name: string }>; hosts: Array<{ hostname: string | null; custom_name: string | null }>; locations: Array<{ name: string }>; networks: Array<{ name: string }> };
    for (const n of [
      ...j.devices.map((d) => d.name), ...j.locations.map((l) => l.name), ...j.networks.map((n) => n.name),
      ...j.hosts.flatMap((h) => [h.hostname, h.custom_name]).filter((x): x is string => x !== null),
    ]) {
      // un hostname a forma di IP diventa l'IP finto, non un pseudonimo
      assert.ok(NOME.test(n) || /^(10|172\.31)\.\d+\.\d+(\.\d+)?$/.test(n), `nome vero? ${n}`);
    }
  });
}
```

- [ ] **Step 2: vederle fallire** — `node --import tsx --test src/lib/topology/__tests__/anonimizza.test.ts src/lib/topology/__tests__/fixture-anonime.test.ts` → FAIL (modulo e fixture assenti).

- [ ] **Step 3: `anonimizza.ts`**

```ts
// src/lib/topology/anonimizza.ts
/**
 * Dati del modello resi anonimi per le fixture (il repo è pubblico): IP, MAC e
 * nomi sostituiti in modo coerente, così contenimenti delle reti, gateway, MAC
 * condivisi e nomi uguali restano tali e il modello dà gli stessi conteggi.
 */
import type { TopologyModelInput } from "@/lib/topology/model-types";
import { normalizeName } from "@/lib/topology/match";
import { normalizeMacForStorage } from "@/lib/utils";

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
const MAC = /^[0-9a-f]{2}([:-]?)[0-9a-f]{2}(\1[0-9a-f]{2}){4}$/i;
const SIGLA: Record<string, string> = {
  router: "RTR", switch: "SW", access_point: "AP", firewall: "FW", hypervisor: "HV", nas: "NAS", server: "SRV",
};

const toInt = (ip: string): number => ip.split(".").reduce((a, o) => a * 256 + Number(o), 0);
const toIp = (n: number): string => [24, 16, 8, 0].map((s) => Math.floor(n / 2 ** s) % 256).join(".");

function parseCidr(cidr: string): { base: number; len: number } | null {
  const [ip, l] = cidr.split("/");
  const len = Number(l);
  if (!IPV4.test(ip) || !Number.isInteger(len) || len < 0 || len > 32) return null;
  const size = 2 ** (32 - len);
  return { base: Math.floor(toInt(ip) / size) * size, len };
}

export function anonimizzaInput(input: TopologyModelInput): TopologyModelInput {
  // Reti esterne → blocchi nuovi in 10.0.0.0/8, allineati alla loro dimensione.
  const parsed = input.networks
    .map((n) => ({ n, c: parseCidr(n.cidr) }))
    .filter((x): x is { n: (typeof input.networks)[number]; c: { base: number; len: number } } => x.c !== null);
  const contains = (o: { base: number; len: number }, ip: number) => ip >= o.base && ip < o.base + 2 ** (32 - o.len);
  const outer = parsed
    .filter((x) => !parsed.some((y) => y !== x && y.c.len < x.c.len && contains(y.c, x.c.base)))
    .sort((a, b) => a.n.id - b.n.id);
  const blocks: Array<{ from: number; len: number; to: number }> = [];
  let next = toInt("10.0.0.0");
  const END = toInt("10.255.255.255");
  for (const { c } of outer) {
    if (blocks.some((b) => b.from === c.base && b.len === c.len)) continue;
    const size = 2 ** (32 - c.len);
    const to = Math.ceil(next / size) * size;
    if (to + size - 1 > END) throw new Error("anonimizzaInput: le reti non stanno in 10.0.0.0/8");
    blocks.push({ from: c.base, len: c.len, to });
    next = to + size;
  }
  let fuori = toInt("172.31.0.1");
  const ipMap = new Map<string, string>();
  const ip = (v: string | null): string | null => {
    if (!v || !IPV4.test(v)) return v;
    const hit = ipMap.get(v);
    if (hit) return hit;
    const n = toInt(v);
    const b = blocks.find((x) => contains({ base: x.from, len: x.len }, n));
    const out = b ? toIp(b.to + (n - b.from)) : toIp(fuori++);
    ipMap.set(v, out);
    return out;
  };
  const cidr = (v: string): string => {
    const c = parseCidr(v);
    return c ? `${ip(toIp(c.base))}/${c.len}` : "0.0.0.0/32";
  };

  const macMap = new Map<string, string>();
  const mac = (v: string | null): string | null => {
    const k = normalizeMacForStorage(v);
    if (!k) return null;
    let out = macMap.get(k);
    if (!out) {
      const n = macMap.size + 1;
      out = `02:00:00:${[16, 8, 0].map((s) => ((n >> s) & 255).toString(16).padStart(2, "0")).join(":")}`;
      macMap.set(k, out);
    }
    return out;
  };

  const nameMap = new Map<string, string>();
  const counters = new Map<string, number>();
  const pseudo = (raw: string | null, prefix: string): string | null => {
    if (raw === null || raw.trim() === "") return raw;
    if (IPV4.test(raw.trim())) return ip(raw.trim());
    if (MAC.test(raw.trim())) return mac(raw.trim());
    const key = normalizeName(raw);
    let out = nameMap.get(key);
    if (!out) {
      const n = (counters.get(prefix) ?? 0) + 1;
      counters.set(prefix, n);
      out = `${prefix}-${n}`;
      nameMap.set(key, out);
    }
    return out;
  };

  const devices = [...input.devices].sort((a, b) => a.id - b.id).map((d) => ({
    ...d, name: pseudo(d.name, SIGLA[d.device_type] ?? "DEV") as string, host: ip(d.host) as string, model: null,
    controller_mac: mac(d.controller_mac), uplink_mac: mac(d.uplink_mac),
  }));
  const hosts = [...input.hosts].sort((a, b) => a.id - b.id).map((h) => ({
    ...h, ip: ip(h.ip) as string, mac: mac(h.mac), hostname: pseudo(h.hostname, "host"), custom_name: pseudo(h.custom_name, "host"),
  }));
  const neighbors = input.neighbors.map((n) => ({
    ...n, remote_device_name: pseudo(n.remote_device_name, "ext") ?? "", remote_ip: ip(n.remote_ip), remote_mac: mac(n.remote_mac),
  }));
  let sede = 0;
  let altra = 0;
  const locations = [...input.locations].sort((a, b) => a.id - b.id).map((l) => ({
    ...l, name: l.parent_id == null ? `Sede-${++sede}` : `Ubicazione-${++altra}`,
  }));
  const networks = [...input.networks].sort((a, b) => a.id - b.id).map((n, i) => ({
    ...n, cidr: cidr(n.cidr), name: `Rete-${i + 1}`, gateway: ip(n.gateway),
  }));
  return {
    ...input, devices, hosts, neighbors, locations, networks,
    knownMacs: input.knownMacs.map((k) => ({ ...k, mac: mac(k.mac) as string })),
    uplinkPorts: input.uplinkPorts.map((p) => ({ ...p })),
    overrides: input.overrides.map((o) => ({ ...o })),
  };
}
```

Attenzione, per chi esegue: i nomi degli apparati prendono lo pseudonimo **prima** di quelli dei vicini (`devices` è mappato per primo), così un vicino col nome di un apparato prende la sigla dell'apparato e non `ext-n`. Nella prova «la forma resta» questo è ciò che tiene uguale `deviceLinks`.

- [ ] **Step 4: lo script d'estrazione**

```ts
// scripts/estrai-fixture-topologia.ts
/**
 * Estrae una fixture ANONIMA del modello della topologia da una COPIA del DB di
 * un tenant (piano topologia fase 1, Task 9). Copia della copia in una cartella
 * temporanea (stesse guardie di prova-giri-sovrapposti), migrazione applicata
 * lì, sola lettura. Tiene solo gli host che servono al modello. Stampa solo
 * conteggi.
 *
 * Uso:  npx tsx scripts/estrai-fixture-topologia.ts <copia.db> --cartella <scratchpad> --uscita <file.json>
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { controllaPercorsi } from "../src/lib/scanner/__tests__/support/percorsi-prova";

function uso(msg?: string): number {
  if (msg) process.stderr.write(`${msg}\n`);
  process.stderr.write("Uso: npx tsx scripts/estrai-fixture-topologia.ts <copia.db> --cartella <scratchpad> --uscita <file.json>\n");
  return 2;
}

async function main(): Promise<number> {
  const a = process.argv.slice(2);
  const val = (k: string) => (a.indexOf(k) >= 0 ? a[a.indexOf(k) + 1] : undefined);
  const cartella = val("--cartella");
  const uscita = val("--uscita");
  const liberi = a.filter((x, i) => !x.startsWith("--") && a[i - 1] !== "--cartella" && a[i - 1] !== "--uscita");
  if (!cartella || !uscita || liberi.length !== 1) return uso();
  const sorgente = path.resolve(liberi[0]);
  const tenant = path.basename(sorgente).replace(/\.db$/i, "");
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(tenant)) return uso("Nome del file non valido come codice tenant.");

  const lavoro = path.join(path.resolve(cartella), `fixture-topologia-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  const dataDir = path.join(lavoro, "data");
  const hubDb = path.join(lavoro, "hub.db");
  const errori = controllaPercorsi({ scratchpad: cartella, sorgente, dataDir, hubDb, repo: process.cwd() });
  if (errori.length > 0) return uso(`Non parto:\n${errori.map((e) => `  - ${e}`).join("\n")}`);

  const dest = path.join(dataDir, "tenants", `${tenant}.db`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(sorgente, dest);
  process.env.DA_INVENT_DATA_DIR = dataDir;
  process.env.DA_IPAM_HUB_DB_PATH = hubDb;
  process.env.ENCRYPTION_KEY ||= crypto.randomBytes(16).toString("hex");
  for (const k of ["log", "info", "warn", "debug"] as const) console[k] = () => {};

  const { withTenant, getTopologyModelInput } = await import("../src/lib/db-tenant");
  const { anonimizzaInput } = await import("../src/lib/topology/anonimizza");
  const { buildNodeIndex, resolveNode } = await import("../src/lib/topology/node-index");
  const { PROMOTE_CLASSES } = await import("../src/lib/topology/model");

  const input = withTenant(tenant, () => getTopologyModelInput(2));
  // Solo gli host che servono: fusi, abbinati da un vicino o da un uplink, candidati alla promozione.
  const idx = buildNodeIndex(input.devices, input.hosts, input.knownMacs);
  const servono = new Set<number>([...idx.alias.keys()].map((k) => Number(k.slice(5))));
  for (const n of input.neighbors) {
    const id = resolveNode(idx, { ip: n.remote_ip, mac: n.remote_mac, name: n.remote_device_name });
    if (id?.startsWith("host:")) servono.add(Number(id.slice(5)));
  }
  for (const h of input.hosts) if ((PROMOTE_CLASSES as readonly string[]).includes(h.classification ?? "")) servono.add(h.id);
  const ridotto = { ...input, hosts: input.hosts.filter((h) => servono.has(h.id)) };
  const anonimo = anonimizzaInput(ridotto);
  fs.writeFileSync(path.resolve(uscita), `${JSON.stringify(anonimo, null, 1)}\n`);
  process.stdout.write(
    `apparati ${anonimo.devices.length} · host ${anonimo.hosts.length} (di ${input.hosts.length}) · vicini ${anonimo.neighbors.length} · reti ${anonimo.networks.length} · ubicazioni ${anonimo.locations.length}\n`,
  );
  return 0;
}

main().then((c) => process.exit(c), (e) => { process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`); process.exit(2); });
```

- [ ] **Step 5: estrarre le due fixture dalle copie del Task 0**

```bash
cd /Users/riccardo/Progetti/Domarc/DA-IPAM/.claude/worktrees/topologia-f1
F=src/lib/topology/__tests__/fixtures; mkdir -p "$F"
npx tsx scripts/estrai-fixture-topologia.ts "$S/copie/70791.db" --cartella "$S" --uscita "$F/topologia-domarc.json"; echo "exit=$?"
npx tsx scripts/estrai-fixture-topologia.ts "$S/copie/71734.db" --cartella "$S" --uscita "$F/topologia-cliente-a.json"; echo "exit=$?"
node --import tsx --test src/lib/topology/__tests__/fixture-anonime.test.ts src/lib/topology/__tests__/anonimizza.test.ts
```
Atteso: `exit=0` due volte, prove PASS. **Se `fixture-anonime` fallisce, le fixture non si committano**: si corregge `anonimizzaInput` e si rigenera. Prima del commit si guarda a occhio un campione: `head -c 1500 "$F/topologia-cliente-a.json"`.

- [ ] **Step 6: le prove sulla forma vera**

```ts
// src/lib/topology/__tests__/model-fixtures.test.ts
// Il modello sulle fixture anonime di Domarc e DTS (estratte il <data> dalle
// copie dei DB, Task 9): il modello nuovo non perde niente rispetto alla mappa
// vecchia, ed è stabile. I numeri fissati sotto sono quelli misurati alla prima
// estrazione: se cambiano, si legge il perché prima di riscriverli.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildTopologyModel } from "@/lib/topology/model";
import { buildTopologyGraph } from "@/lib/topology/graph";
import type { TopologyModelInput } from "@/lib/topology/model-types";

function carica(nome: string): TopologyModelInput {
  return JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", nome), "utf8")) as TopologyModelInput;
}

function vecchiaMappa(i: TopologyModelInput) {
  const g = buildTopologyGraph({
    devices: i.devices.map((d) => ({ id: d.id, name: d.name, device_type: d.device_type, model: d.model, host: d.host, enabled: d.enabled })),
    hosts: i.hosts.map((h) => ({ id: h.id, ip: h.ip, hostname: h.hostname, custom_name: h.custom_name, classification: h.classification ?? "unknown", status: h.status, last_response_time_ms: null, last_seen: null, model: null, network_id: h.network_id })),
    neighbors: i.neighbors.map((n) => ({ device_id: n.device_id, local_port: n.local_port, remote_device_name: n.remote_device_name, remote_port: n.remote_port, protocol: n.protocol, remote_ip: n.remote_ip })),
    statusByNode: new Map(),
  });
  return {
    deviceLinks: g.edges.filter((e) => e.source.startsWith("dev:") && e.target.startsWith("dev:")).length,
    external: g.nodes.filter((n) => n.kind === "external").length,
  };
}

for (const nome of ["topologia-domarc.json", "topologia-cliente-a.json"]) {
  test(`${nome}: il modello nuovo non perde collegamenti fra apparati`, () => {
    const i = carica(nome);
    const m = buildTopologyModel(i);
    const v = vecchiaMappa(i);
    // Se fallisce, non si abbassa: un collegamento perso viene quasi sempre da una
    // chiave che il modello nuovo giudica contesa (MAC o nome) e la mappa vecchia
    // assegnava all'ultimo arrivato. Si legge quale, e lo si scrive.
    assert.ok(m.counts.deviceLinks >= v.deviceLinks, `nuovo ${m.counts.deviceLinks} < vecchio ${v.deviceLinks}`);
  });

  test(`${nome}: stessi dati, stesso modello`, () => {
    const i = carica(nome);
    assert.equal(JSON.stringify(buildTopologyModel(i)), JSON.stringify(buildTopologyModel(carica(nome))));
  });
}

test("Domarc: i doppi apparato/host si fondono (spec §2: almeno i 5 Proxmox)", () => {
  assert.ok(buildTopologyModel(carica("topologia-domarc.json")).counts.fusedHosts >= 5);
});

// Numeri misurati alla prima estrazione (Task 9, Step 7): si riscrivono solo sapendo perché cambiano.
const MISURATI: Record<string, Partial<Record<string, number>>> = {
  "topologia-domarc.json": {},
  "topologia-cliente-a.json": {},
};
for (const [nome, attesi] of Object.entries(MISURATI)) {
  test(`${nome}: conteggi misurati`, () => {
    const c = buildTopologyModel(carica(nome)).counts as unknown as Record<string, number>;
    for (const [k, v] of Object.entries(attesi)) assert.equal(c[k], v, k);
  });
}
```

- [ ] **Step 7: fissare i numeri misurati**

```bash
node --import tsx -e 'const fs=require("fs");const {buildTopologyModel}=require("./src/lib/topology/model");for(const f of ["topologia-domarc.json","topologia-cliente-a.json"]){const c=buildTopologyModel(JSON.parse(fs.readFileSync("src/lib/topology/__tests__/fixtures/"+f,"utf8"))).counts;console.log(f,JSON.stringify({deviceLinks:c.deviceLinks,attachedLinks:c.attachedLinks,unmatchedNeighbors:c.unmatchedNeighbors,isolatedDevices:c.isolatedDevices,fusedHosts:c.fusedHosts,promoteProposals:c.promoteProposals,suspiciousTypes:c.suspiciousTypes}))}'
```
Scrivere i due oggetti stampati in `MISURATI` e la data dell'estrazione nel commento in testa, poi rilanciare: PASS. Se `fusedHosts` di Domarc è sotto 5, **non** si abbassa la soglia: si capisce perché i Proxmox non si fondono (host_id, IP, identità fisica) e lo si scrive nel rapporto del task.

- [ ] **Step 8: commit**

```bash
git add src/lib/topology/anonimizza.ts scripts/estrai-fixture-topologia.ts src/lib/topology/__tests__/anonimizza.test.ts src/lib/topology/__tests__/fixture-anonime.test.ts src/lib/topology/__tests__/model-fixtures.test.ts src/lib/topology/__tests__/fixtures/topologia-domarc.json src/lib/topology/__tests__/fixtures/topologia-cliente-a.json
git commit -m "test(topologia): fixture anonime di Domarc e DTS e prove del modello sulla forma vera"
```

---

### Task 10: Le rotte API (tappa D)

**Files:**
- Create: `src/lib/topology/api-input.ts` + `src/lib/topology/__tests__/api-input.test.ts`
- Create: `src/app/api/topology/model/route.ts` (GET)
- Create: `src/app/api/topology/settings/route.ts` (GET, PUT)
- Create: `src/app/api/topology/links/route.ts` (GET, POST) · `src/app/api/topology/links/[id]/route.ts` (DELETE)
- Create: `src/app/api/locations/[id]/topology/route.ts` (GET, PUT)
- Create: `src/app/api/devices/[id]/location/route.ts` (GET, PUT)

**Interfaces:**
- Consumes: Task 7, 8.
- Produces (li usano i task 11-13):
  - `GET /api/topology/model` → `TopologyModel & { staleDays: number }`
  - `GET /api/topology/settings` → `{ staleDays }`; `PUT { staleDays: number }` → `{ staleDays }`
  - `GET /api/topology/links` → `LinkOverrideView[]`; `POST { action, a_node, a_port?, b_node, b_port?, note? }` → `{ id }`; `DELETE /api/topology/links/:id` → `{ ok: true }`
  - `GET /api/locations/:id/topology` → `SiteTopologyView` (sotto); `PUT { head_device_id?: number|null, network_ids?: number[] }` → `SiteTopologyView`
  - `GET /api/devices/:id/location` → `DeviceLocationView` (sotto); `PUT { location_id: number|null }` → `DeviceLocationView`

```ts
// tipi delle risposte, in src/lib/topology/api-input.ts
export interface SiteTopologyView {
  location_id: number;
  head_device_id: number | null;
  head_set_by: string | null;
  head_set_at: string | null;
  network_ids: number[];
  proposed_head: { device_id: number; name: string } | null;
  devices: Array<{ id: number; name: string; device_type: string; host: string }>;
  networks: Array<{ id: number; cidr: string; name: string; location_id: number | null; location_name: string | null }>;
}
export interface DeviceLocationView {
  location_id: number | null;
  location_set_by: string | null;
  location_set_at: string | null;
  proposed_site: { id: number; name: string } | null;
}
```

- [ ] **Step 1: la prova che fallisce (validazione)**

```ts
// src/lib/topology/__tests__/api-input.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLinkOverrideBody, parseSiteTopologyBody, parseDeviceLocationBody, parseStaleDaysBody } from "@/lib/topology/api-input";

test("correzione: nodi nella forma dev:N / host:N, azione nota, porte facoltative", () => {
  assert.deepEqual(parseLinkOverrideBody({ action: "add", a_node: "dev:1", b_node: "host:2" }), {
    ok: true, data: { action: "add", a_node: "dev:1", a_port: "", b_node: "host:2", b_port: "", note: null },
  });
  assert.equal(parseLinkOverrideBody({ action: "add", a_node: "dev:1", b_node: "dev:1" }).ok, false, "un nodo con se stesso");
  assert.equal(parseLinkOverrideBody({ action: "sposta", a_node: "dev:1", b_node: "dev:2" }).ok, false);
  assert.equal(parseLinkOverrideBody({ action: "add", a_node: "ext:x", b_node: "dev:2" }).ok, false);
});

test("sede: testa e subnet facoltative, interi positivi", () => {
  assert.deepEqual(parseSiteTopologyBody({ head_device_id: null, network_ids: [1, 2] }), { ok: true, data: { headDeviceId: null, networkIds: [1, 2] } });
  assert.deepEqual(parseSiteTopologyBody({}), { ok: true, data: {} });
  assert.equal(parseSiteTopologyBody({ network_ids: [-1] }).ok, false);
});

test("sede dell'apparato e soglia", () => {
  assert.deepEqual(parseDeviceLocationBody({ location_id: null }), { ok: true, data: { locationId: null } });
  assert.equal(parseDeviceLocationBody({}).ok, false);
  assert.deepEqual(parseStaleDaysBody({ staleDays: 3 }), { ok: true, data: 3 });
  assert.equal(parseStaleDaysBody({ staleDays: 0 }).ok, false);
});
```

- [ ] **Step 2: vederla fallire** — `node --import tsx --test src/lib/topology/__tests__/api-input.test.ts` → FAIL.

- [ ] **Step 3: `api-input.ts`**

```ts
// src/lib/topology/api-input.ts
import { z } from "zod";
import { LINK_STALE_DAYS_MAX, LINK_STALE_DAYS_MIN } from "@/lib/topology/settings";

export type Parsed<T> = { ok: true; data: T } | { ok: false; error: string };

const NODE = z.string().regex(/^(dev|host):\d+$/, "Nodo non valido");
const ID = z.number().int().positive();

function first(e: z.ZodError): string {
  return e.issues[0]?.message ?? "Dati non validi";
}

const linkSchema = z.object({
  action: z.enum(["add", "ignore"]),
  a_node: NODE,
  a_port: z.string().max(100).optional().default(""),
  b_node: NODE,
  b_port: z.string().max(100).optional().default(""),
  note: z.string().max(500).nullish().transform((v) => v ?? null),
});

export function parseLinkOverrideBody(raw: unknown): Parsed<z.infer<typeof linkSchema>> {
  const r = linkSchema.safeParse(raw);
  if (!r.success) return { ok: false, error: first(r.error) };
  if (r.data.a_node === r.data.b_node) return { ok: false, error: "Un collegamento unisce due nodi diversi" };
  return { ok: true, data: r.data };
}

const siteSchema = z.object({ head_device_id: ID.nullable().optional(), network_ids: z.array(ID).max(500).optional() });

export function parseSiteTopologyBody(raw: unknown): Parsed<{ headDeviceId?: number | null; networkIds?: number[] }> {
  const r = siteSchema.safeParse(raw);
  if (!r.success) return { ok: false, error: first(r.error) };
  const data: { headDeviceId?: number | null; networkIds?: number[] } = {};
  if (r.data.head_device_id !== undefined) data.headDeviceId = r.data.head_device_id;
  if (r.data.network_ids !== undefined) data.networkIds = r.data.network_ids;
  return { ok: true, data };
}

const deviceLocationSchema = z.object({ location_id: ID.nullable() });

export function parseDeviceLocationBody(raw: unknown): Parsed<{ locationId: number | null }> {
  const r = deviceLocationSchema.safeParse(raw);
  return r.success ? { ok: true, data: { locationId: r.data.location_id } } : { ok: false, error: first(r.error) };
}

const staleSchema = z.object({ staleDays: z.number().int().min(LINK_STALE_DAYS_MIN).max(LINK_STALE_DAYS_MAX) });

export function parseStaleDaysBody(raw: unknown): Parsed<number> {
  const r = staleSchema.safeParse(raw);
  return r.success ? { ok: true, data: r.data.staleDays } : { ok: false, error: `La soglia va da ${LINK_STALE_DAYS_MIN} a ${LINK_STALE_DAYS_MAX} giorni` };
}
```
più le due interfacce `SiteTopologyView` e `DeviceLocationView` scritte sopra.

- [ ] **Step 4: le rotte**

Forma comune (copiare da `src/app/api/locations/route.ts`): `withTenantFromSession(async () => { const s = await requireAuth() | requireAdmin(); if (isAuthError(s)) return s; try { … } catch (error) { console.error("…", error); return NextResponse.json({ error: "…" }, { status: 500 }); } })`, header `Cache-Control: no-store` sulle letture (`NO_STORE` da `@/lib/controllers/route-helpers`), autore = `actorOf(s) ?? "sconosciuto"` (stesso modulo), id dalla rotta con `parseControllerId` (stesso modulo: accetta un intero positivo). Corpo con `readJson(req)` (stesso modulo). In Next 16 `params` è una Promise: `{ params }: { params: Promise<{ id: string }> }` e `const { id } = await params;`.

`src/app/api/topology/model/route.ts`:

```ts
import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getTopologyModelInput } from "@/lib/db-tenant";
import { buildTopologyModel } from "@/lib/topology/model";
import { getLinkStaleDays } from "@/lib/topology/settings";
import { NO_STORE } from "@/lib/controllers/route-helpers";

export async function GET() {
  return withTenantFromSession(async () => {
    const s = await requireAuth();
    if (isAuthError(s)) return s;
    try {
      const staleDays = getLinkStaleDays();
      const model = buildTopologyModel(getTopologyModelInput(staleDays));
      return NextResponse.json({ ...model, staleDays }, { headers: NO_STORE });
    } catch (error) {
      console.error("[topology] modello:", error);
      return NextResponse.json({ error: "Errore nel calcolo del modello della mappa" }, { status: 500 });
    }
  });
}
```

`src/app/api/locations/[id]/topology/route.ts` (il più ricco; le altre seguono lo stesso schema):

```ts
import { NextResponse } from "next/server";
import { requireAdmin, requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getNetworkDevices, getNetworks, getLocations, getSiteTopology, getTopologyModelInput, setSiteTopology } from "@/lib/db-tenant";
import { buildTopologyModel } from "@/lib/topology/model";
import { getLinkStaleDays } from "@/lib/topology/settings";
import { parseSiteTopologyBody, type SiteTopologyView } from "@/lib/topology/api-input";
import { NO_STORE, actorOf, notFound, parseControllerId, readJson } from "@/lib/controllers/route-helpers";

function view(id: number): SiteTopologyView | null {
  const row = getSiteTopology(id);
  if (!row) return null;
  const model = buildTopologyModel(getTopologyModelInput(getLinkStaleDays()));
  const site = model.sites.find((s) => s.locationId === id);
  const head = site?.headProposed && site.headNodeId ? model.nodes.find((n) => n.id === site.headNodeId) : undefined;
  const locName = new Map(getLocations().map((l) => [l.id, l.name]));
  const devices = getNetworkDevices()
    .map((d) => ({ id: d.id, name: d.name, device_type: d.device_type, host: d.host }))
    .sort((a, b) => Number(!["router", "firewall"].includes(a.device_type)) - Number(!["router", "firewall"].includes(b.device_type)) || a.name.localeCompare(b.name, "it"));
  const model_nets = new Map(getTopologyModelInput(getLinkStaleDays()).networks.map((n) => [n.id, n.location_id]));
  const networks = getNetworks().map((n) => {
    const lid = model_nets.get(n.id) ?? null;
    return { id: n.id, cidr: n.cidr, name: n.name, location_id: lid, location_name: lid !== null ? (locName.get(lid) ?? null) : null };
  });
  return { ...row, proposed_head: head ? { device_id: head.refId, name: head.name } : null, devices, networks };
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withTenantFromSession(async () => {
    const s = await requireAuth();
    if (isAuthError(s)) return s;
    const id = parseControllerId((await params).id);
    if (id === null) return notFound();
    try {
      const v = view(id);
      return v ? NextResponse.json(v, { headers: NO_STORE }) : notFound();
    } catch (error) {
      console.error("[topology] sede:", error);
      return NextResponse.json({ error: "Errore nella lettura della sede" }, { status: 500 });
    }
  });
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withTenantFromSession(async () => {
    const s = await requireAdmin();
    if (isAuthError(s)) return s;
    const id = parseControllerId((await params).id);
    if (id === null) return notFound();
    const body = parseSiteTopologyBody(await readJson(req));
    if (!body.ok) return NextResponse.json({ error: body.error }, { status: 400 });
    try {
      const r = setSiteTopology(id, body.data, actorOf(s) ?? "sconosciuto");
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
      return NextResponse.json(view(id), { headers: NO_STORE });
    } catch (error) {
      console.error("[topology] sede, scrittura:", error);
      return NextResponse.json({ error: "Errore nel salvataggio della sede" }, { status: 500 });
    }
  });
}
```
Correzione da fare scrivendo: `view` chiama `getTopologyModelInput` due volte; tenere una sola chiamata (`const input = …; const model = buildTopologyModel(input);` e `input.networks` per le subnet). Verificare che `getNetworks`, `getNetworkDevices` e `getLocations` esistano in `db-tenant.ts` con questi nomi (`grep -n "^export function getNetworks\b\|^export function getNetworkDevices\b" src/lib/db-tenant.ts`); se `getNetworks` ha un altro nome, usare quello.

`src/app/api/devices/[id]/location/route.ts`: GET → `DeviceLocationView` da `network_devices` (una funzione `getDeviceLocation(id)` in `db-tenant.ts`: `SELECT location_id, location_set_by, location_set_at FROM network_devices WHERE id = ?`) più `proposed_site` = sede proposta del nodo `dev:<id>` nel modello (solo se `siteProposed`); PUT (admin) → `setDeviceLocation`, poi la vista.

`settings`: GET (auth) `{ staleDays: getLinkStaleDays() }`; PUT (admin) `parseStaleDaysBody` → `setLinkStaleDays`.

`links`: GET (auth) `listLinkOverrides()`; POST (admin) `parseLinkOverrideBody` → `addLinkOverride(data, autore)` → `{ id }` (201); `links/[id]` DELETE (admin) `deleteLinkOverride(id)` → `{ ok: true }` o 404.

- [ ] **Step 5: il censimento delle rotte e il resto**

```bash
DA_INVENT_DATA_DIR=$(mktemp -d) node --import tsx --test src/lib/topology/__tests__/api-input.test.ts src/lib/permessi/__tests__/rotte-censite.test.ts src/lib/__tests__/api-auth-guards.test.ts
npx tsc --noEmit && npm run lint
```
Atteso: PASS. Le rotte nuove hanno le guardie predefinite (letture `auth`, scritture `admin`): il censimento non chiede voci nuove. Se la prova le segnala, si legge il messaggio: non si aggiunge un'eccezione per farla tacere.

- [ ] **Step 6: commit**

```bash
git add src/lib/topology/api-input.ts src/lib/topology/__tests__/api-input.test.ts src/app/api/topology src/app/api/locations/\[id\]/topology src/app/api/devices/\[id\]/location src/lib/db-tenant.ts
git commit -m "feat(topologia): API del modello, della sede, della sede dell'apparato, delle correzioni e della soglia"
```

---

### Task 11: Testa e subnet nelle Ubicazioni (tappa E, agente 1)

**Files:**
- Create: `src/components/topology/site-topology-dialog.tsx`
- Modify: `src/app/(dashboard)/inventory/locations/page.tsx` (un pulsante «Mappa» sulle sole ubicazioni di primo livello)

**Interfaces:**
- Consumes: `GET/PUT /api/locations/:id/topology` → `SiteTopologyView` (Task 10).

Cosa si vede (oggetto per oggetto; regola grafica: l'interfaccia si propone prima, e questa è la proposta approvata con «Numeri + campi minimi» il 13/10):
- sulla riga di ogni **sede** (ubicazione di primo livello) un pulsante «Mappa»; sugli armadi no;
- la finestra «Mappa — <sede>» ha due parti:
  1. **Apparato di testa**: una tendina (router e firewall per primi, poi gli altri per nome; voce «— nessuna —»). Sotto, in testo: se c'è una proposta, «Proposta del sistema: <nome> (gateway di più subnet della sede)»; se la testa è scelta, «Scelta da <autore> il <data in ora italiana>»;
  2. **Subnet della sede**: elenco con casella per ogni rete (`cidr · nome`); accanto a una rete che oggi è di un'altra sede, «ora in <altra sede>»: spuntarla la sposta qui.
- «Salva» manda **un solo** PUT con `head_device_id` e `network_ids`; dopo il salvataggio la finestra ricarica la vista (la proposta di testa può cambiare con le subnet). Errori del server in un riquadro dentro la finestra, col testo del server.

- [ ] **Step 1: il componente**

```tsx
// src/components/topology/site-topology-dialog.tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogScrollableArea, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LoadError } from "@/components/shared/load-error";
import { fetchJson } from "@/lib/fetch-json";
import { parseDbDate, FUSO_UTENTI } from "@/lib/db-date";
import type { SiteTopologyView } from "@/lib/topology/api-input";

const NESSUNA = "none";

export function SiteTopologyDialog({ location, open, onOpenChange }: {
  location: { id: number; name: string };
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [view, setView] = useState<SiteTopologyView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [head, setHead] = useState<string>(NESSUNA);
  const [nets, setNets] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const r = await fetchJson<SiteTopologyView>(`/api/locations/${location.id}/topology`, { cache: "no-store" });
    if (!r.ok) {
      setError(r.message);
      return;
    }
    setView(r.data);
    setHead(r.data.head_device_id != null ? String(r.data.head_device_id) : NESSUNA);
    setNets(new Set(r.data.network_ids));
  }, [location.id]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  async function save() {
    setSaving(true);
    setError(null);
    const r = await fetchJson<SiteTopologyView>(`/api/locations/${location.id}/topology`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ head_device_id: head === NESSUNA ? null : Number(head), network_ids: [...nets] }),
    });
    setSaving(false);
    if (!r.ok) {
      setError(r.message);
      return;
    }
    setView(r.data);
    setNets(new Set(r.data.network_ids));
  }

  const toggle = (id: number) =>
    setNets((cur) => {
      const n = new Set(cur);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Mappa — {location.name}</DialogTitle>
        </DialogHeader>
        <DialogScrollableArea>
          {error && <LoadError message={error} onRetry={view ? undefined : load} />}
          {view && (
            <div className="space-y-6">
              <div className="space-y-2">
                <Label>Apparato di testa</Label>
                <Select value={head} onValueChange={(v) => setHead(v ?? NESSUNA)}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NESSUNA}>— nessuna —</SelectItem>
                    {view.devices.map((d) => (
                      <SelectItem key={d.id} value={String(d.id)}>{d.name} · {d.host}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {view.proposed_head && view.head_device_id == null && (
                  <p className="text-sm">Proposta del sistema: <strong>{view.proposed_head.name}</strong> (gateway di più subnet della sede)</p>
                )}
                {view.head_device_id != null && view.head_set_by && view.head_set_at && (
                  <p className="text-sm text-muted-foreground">
                    Scelta da {view.head_set_by} il {parseDbDate(view.head_set_at).toLocaleString("it-IT", { timeZone: FUSO_UTENTI })}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label>Subnet della sede</Label>
                <ul className="max-h-80 space-y-1 overflow-y-auto">
                  {view.networks.map((n) => (
                    <li key={n.id} className="flex items-center gap-2 text-sm">
                      <Checkbox id={`net-${n.id}`} checked={nets.has(n.id)} onCheckedChange={() => toggle(n.id)} />
                      <label htmlFor={`net-${n.id}`} className="font-mono">{n.cidr}</label>
                      <span>· {n.name}</span>
                      {n.location_id !== null && n.location_id !== location.id && (
                        <span className="text-muted-foreground">— ora in {n.location_name ?? `ubicazione ${n.location_id}`}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </DialogScrollableArea>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Chiudi</Button>
          <Button onClick={save} disabled={!view || saving}>{saving ? "Salvataggio…" : "Salva"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```
Prima di scrivere, leggere `src/components/ui/checkbox.tsx` e `select.tsx`: se `onCheckedChange`/`onValueChange` hanno firme diverse (base-ui), adeguarsi a quelle. Il colore non porta significato: le informazioni sono tutte in testo.

- [ ] **Step 2: il pulsante nella pagina** — in `inventory/locations/page.tsx`, sulle righe con `parent_id === null`, un `<Button variant="outline" size="sm">Mappa</Button>` che apre `<SiteTopologyDialog location={…} open … />` (uno stato `mappaPer: Location | null`).

- [ ] **Step 3: tipi e lint** — `npx tsc --noEmit && npm run lint` → puliti.

- [ ] **Step 4: commit**

```bash
git add src/components/topology/site-topology-dialog.tsx "src/app/(dashboard)/inventory/locations/page.tsx"
git commit -m "feat(topologia): nelle Ubicazioni, testa e subnet di una sede con la proposta del sistema"
```

---

### Task 12: Sede e armadio sull'apparato (tappa E, agente 1)

**Files:**
- Create: `src/components/topology/device-location-field.tsx`
- Modify: `src/components/devices/edit-device-dialog.tsx`

**Interfaces:**
- Consumes: `GET /api/locations` (esiste, admin), `GET/PUT /api/devices/:id/location` → `DeviceLocationView` (Task 10).
- Produces: `export function DeviceLocationField(props: { deviceId: number; onReady: (save: () => Promise<string | null>) => void })` — il campo carica da sé; la finestra chiama `save()` al suo «Salva» (restituisce un messaggio d'errore o null).

Cosa si vede: nella finestra «Modifica apparato», un campo **«Sede / armadio»**: tendina con le ubicazioni scritte per intero («Sede A › Piano 1 › Armadio 2») e la voce «— nessuna —». Sotto, in testo: «Proposta del sistema: <sede>» se l'apparato non ha una sede scelta e il sistema ne propone una; «Scelta da <autore> il <data>» se c'è. Il valore si salva con il «Salva» della finestra, solo se è cambiato.

- [ ] **Step 1: il campo**

```tsx
// src/components/topology/device-location-field.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fetchJson } from "@/lib/fetch-json";
import { parseDbDate, FUSO_UTENTI } from "@/lib/db-date";
import type { DeviceLocationView } from "@/lib/topology/api-input";
import type { Location } from "@/types";

const NESSUNA = "none";

function labels(locs: Location[]): Array<{ id: number; label: string }> {
  const byId = new Map(locs.map((l) => [l.id, l]));
  const full = (l: Location): string => {
    const parts: string[] = [];
    const seen = new Set<number>();
    for (let cur: Location | undefined = l; cur && !seen.has(cur.id); cur = cur.parent_id != null ? byId.get(cur.parent_id) : undefined) {
      seen.add(cur.id);
      parts.unshift(cur.name);
    }
    return parts.join(" › ");
  };
  return locs.map((l) => ({ id: l.id, label: full(l) })).sort((a, b) => a.label.localeCompare(b.label, "it"));
}

export function DeviceLocationField({ deviceId, onReady }: { deviceId: number; onReady: (save: () => Promise<string | null>) => void }) {
  const [opts, setOpts] = useState<Array<{ id: number; label: string }>>([]);
  const [view, setView] = useState<DeviceLocationView | null>(null);
  const [value, setValue] = useState(NESSUNA);
  const [error, setError] = useState<string | null>(null);
  const valueRef = useRef(value);
  valueRef.current = value;

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [l, v] = await Promise.all([
        fetchJson<Location[]>("/api/locations", { cache: "no-store" }),
        fetchJson<DeviceLocationView>(`/api/devices/${deviceId}/location`, { cache: "no-store" }),
      ]);
      if (!alive) return;
      if (!l.ok || !v.ok) {
        setError(!l.ok ? l.message : !v.ok ? v.message : null);
        return;
      }
      setOpts(labels(l.data));
      setView(v.data);
      setValue(v.data.location_id != null ? String(v.data.location_id) : NESSUNA);
    })();
    return () => {
      alive = false;
    };
  }, [deviceId]);

  useEffect(() => {
    onReady(async () => {
      if (!view) return error;
      const next = valueRef.current === NESSUNA ? null : Number(valueRef.current);
      if (next === view.location_id) return null;
      const r = await fetchJson<DeviceLocationView>(`/api/devices/${deviceId}/location`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ location_id: next }),
      });
      return r.ok ? null : `Sede non salvata: ${r.message}`;
    });
  }, [deviceId, view, error, onReady]);

  return (
    <div className="space-y-2">
      <Label>Sede / armadio</Label>
      {error ? (
        <p className="text-sm">Sede non disponibile: {error}</p>
      ) : (
        <Select value={value} onValueChange={(v) => setValue(v ?? NESSUNA)}>
          <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={NESSUNA}>— nessuna —</SelectItem>
            {opts.map((o) => <SelectItem key={o.id} value={String(o.id)}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
      )}
      {view?.location_id == null && view?.proposed_site && (
        <p className="text-sm">Proposta del sistema: <strong>{view.proposed_site.name}</strong></p>
      )}
      {view?.location_id != null && view.location_set_by && view.location_set_at && (
        <p className="text-sm text-muted-foreground">
          Scelta da {view.location_set_by} il {parseDbDate(view.location_set_at).toLocaleString("it-IT", { timeZone: FUSO_UTENTI })}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: nella finestra** — leggere `edit-device-dialog.tsx`; aggiungere `const saveLocation = useRef<() => Promise<string | null>>(async () => null);`, rendere `<DeviceLocationField deviceId={device.id} onReady={useCallback((f) => { saveLocation.current = f; }, [])} />` dopo i campi esistenti, e nel gestore del «Salva», **dopo** il salvataggio dell'apparato riuscito: `const errLoc = await saveLocation.current(); if (errLoc) { /* mostrare errLoc come gli altri errori della finestra, senza chiuderla */ }`.

- [ ] **Step 3: tipi e lint** — `npx tsc --noEmit && npm run lint` → puliti.

- [ ] **Step 4: commit**

```bash
git add src/components/topology/device-location-field.tsx src/components/devices/edit-device-dialog.tsx
git commit -m "feat(topologia): sede e armadio nella finestra dell'apparato, con la proposta del sistema"
```

---

### Task 13: La pagina «Dati della mappa» (tappa E, agente 2)

**Files:**
- Create: `src/app/(dashboard)/topology/dati/page.tsx`, `src/app/(dashboard)/topology/dati/dati-client.tsx`
- Modify: `src/app/(dashboard)/topology/page.tsx` (un collegamento «Dati della mappa» accanto al titolo)

**Interfaces:**
- Consumes: `GET /api/topology/model`, `GET/PUT /api/topology/settings` (Task 10).

Cosa si vede, in quest'ordine, senza fasce di spiegazione in cima (memoria «lo spazio sullo schermo è un vincolo»):
1. **Numeri**: una tabella a due colonne (voce · numero), con le voci in italiano: Apparati · Nodi · Collegamenti (di cui: fra apparati, verso host attaccati) · per fonte (manuale, uplink UniFi, LLDP, CDP, MNDP) · Non visti da più di N giorni · Vicini non abbinati · Apparati isolati · Host fusi negli apparati · Apparati senza sede · Sedi con testa · Proposte «promuovi» · Tipi sospetti.
2. **Proposte «promuovi ad apparato»**: tabella nome · IP · classificazione · collegamenti · azione «Promuovi» (collegamento a `/objects/<hostId>?promote=1`: apre la promozione che esiste già, con la sua conferma).
3. **Apparati senza sede** e **Tipi sospetti**: due tabelle nome · tipo · IP · «Apri» (`/devices/<id>`).
4. **Collegamenti non visti**: tabella A (porta) · B (porta) · fonte · «non visto da N g».
5. **Sedi**: tabella sede · testa (nome + «proposta» oppure «scelta») · apparati.
6. **Soglia «non visto»**: campo numerico 1–30 + «Salva» (solo admin: chi non lo è riceve 403 e lo vede scritto).

Ogni tabella mostra al più 200 righe e, sotto, «+ altri N». Lo stato è scritto in parole («proposta», «scelta», «non visto da 3 g»): niente significati affidati al solo colore. I nomi dei nodi si leggono da `model.nodes` (mappa id → nome).

- [ ] **Step 1: `page.tsx`**

```tsx
// src/app/(dashboard)/topology/dati/page.tsx
import { DatiClient } from "./dati-client";

export default function DatiMappaPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">Dati della mappa</h1>
      <DatiClient />
    </div>
  );
}
```

- [ ] **Step 2: `dati-client.tsx`**

```tsx
// src/app/(dashboard)/topology/dati/dati-client.tsx
"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LoadError } from "@/components/shared/load-error";
import { fetchJson } from "@/lib/fetch-json";
import type { MapLink, TopologyModel } from "@/lib/topology/model-types";

type Model = TopologyModel & { staleDays: number };
const MAX = 200;
const FONTE: Record<string, string> = { manual: "manuale", unifi_uplink: "uplink UniFi", lldp: "LLDP", cdp: "CDP", mndp: "MNDP" };

function Altri({ n }: { n: number }) {
  return n > MAX ? <p className="mt-2 text-sm text-muted-foreground">+ altri {n - MAX}</p> : null;
}

export function DatiClient() {
  const [m, setM] = useState<Model | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [soglia, setSoglia] = useState("");
  const [esitoSoglia, setEsitoSoglia] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const r = await fetchJson<Model>("/api/topology/model", { cache: "no-store" });
    if (!r.ok) {
      setError(r.message);
      return;
    }
    setM(r.data);
    setSoglia(String(r.data.staleDays));
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function salvaSoglia() {
    setEsitoSoglia(null);
    const r = await fetchJson<{ staleDays: number }>("/api/topology/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ staleDays: Number(soglia) }),
    });
    setEsitoSoglia(r.ok ? `Salvata: ${r.data.staleDays} giorni` : r.message);
    if (r.ok) void load();
  }

  if (error) return <LoadError message={error} onRetry={load} />;
  if (!m) return <p className="text-sm text-muted-foreground">Caricamento…</p>;

  const nome = new Map(m.nodes.map((n) => [n.id, n]));
  const nn = (id: string) => nome.get(id)?.name ?? id;
  const c = m.counts;
  const numeri: Array<[string, number]> = [
    ["Apparati", c.devices], ["Nodi", c.nodes], ["Collegamenti", c.links],
    ["— fra apparati", c.deviceLinks], ["— verso host attaccati", c.attachedLinks],
    ...Object.entries(c.linksBySource).map(([k, v]) => [`— fonte ${FONTE[k] ?? k}`, v] as [string, number]),
    [`Non visti da più di ${m.staleDays} giorni`, c.staleLinks], ["Vicini non abbinati", c.unmatchedNeighbors],
    ["Apparati isolati", c.isolatedDevices], ["Host fusi negli apparati", c.fusedHosts],
    ["Apparati senza sede", c.devicesWithoutSite], ["Sedi con testa", c.sitesWithHead],
    ["Proposte «promuovi ad apparato»", c.promoteProposals], ["Tipi sospetti", c.suspiciousTypes],
  ];
  const stale: MapLink[] = m.links.filter((l) => l.stale);
  const apparati = (ids: string[]) => ids.slice(0, MAX).map((id) => nome.get(id)).filter((n) => n !== undefined);

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card>
        <CardHeader><CardTitle>Numeri</CardTitle></CardHeader>
        <CardContent>
          <Table><TableBody>
            {numeri.map(([k, v]) => (
              <TableRow key={k}><TableCell>{k}</TableCell><TableCell className="text-right tabular-nums">{v}</TableCell></TableRow>
            ))}
          </TableBody></Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Sedi</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>Sede</TableHead><TableHead>Testa</TableHead><TableHead className="text-right">Nodi</TableHead></TableRow></TableHeader>
            <TableBody>
              {m.sites.map((s) => (
                <TableRow key={s.locationId}>
                  <TableCell>{s.name}</TableCell>
                  <TableCell>{s.headNodeId ? `${nn(s.headNodeId)} — ${s.headProposed ? "proposta" : "scelta"}` : "nessuna"}</TableCell>
                  <TableCell className="text-right tabular-nums">{s.nodeIds.length}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="mt-4 flex items-end gap-2">
            <div>
              <label htmlFor="soglia" className="text-sm">Soglia «non visto» (giorni)</label>
              <Input id="soglia" type="number" min={1} max={30} value={soglia} onChange={(e) => setSoglia(e.target.value)} className="w-24" />
            </div>
            <Button variant="outline" onClick={salvaSoglia}>Salva</Button>
            {esitoSoglia && <span className="text-sm">{esitoSoglia}</span>}
          </div>
        </CardContent>
      </Card>

      <Card className="xl:col-span-2">
        <CardHeader><CardTitle>Proposte «promuovi ad apparato»</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>Nome</TableHead><TableHead>IP</TableHead><TableHead>Classificazione</TableHead><TableHead className="text-right">Collegamenti</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {m.promote.slice(0, MAX).map((p) => (
                <TableRow key={p.hostId}>
                  <TableCell>{p.name}</TableCell><TableCell className="font-mono">{p.ip}</TableCell><TableCell>{p.classification}</TableCell>
                  <TableCell className="text-right tabular-nums">{p.links}</TableCell>
                  <TableCell><Link className="underline" href={`/objects/${p.hostId}?promote=1`}>Promuovi</Link></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Altri n={m.promote.length} />
        </CardContent>
      </Card>

      {([["Apparati senza sede", m.withoutSite], ["Tipi sospetti", m.suspicious]] as Array<[string, string[]]>).map(([titolo, ids]) => (
        <Card key={titolo}>
          <CardHeader><CardTitle>{titolo}</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>Nome</TableHead><TableHead>Tipo</TableHead><TableHead>IP</TableHead><TableHead /></TableRow></TableHeader>
              <TableBody>
                {apparati(ids).map((n) => (
                  <TableRow key={n!.id}>
                    <TableCell>{n!.name}</TableCell><TableCell>{n!.type}</TableCell><TableCell className="font-mono">{n!.mgmtIp}</TableCell>
                    <TableCell><Link className="underline" href={`/devices/${n!.refId}`}>Apri</Link></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Altri n={ids.length} />
          </CardContent>
        </Card>
      ))}

      <Card className="xl:col-span-2">
        <CardHeader><CardTitle>Collegamenti non visti</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>Da</TableHead><TableHead>A</TableHead><TableHead>Fonte</TableHead><TableHead>Stato</TableHead></TableRow></TableHeader>
            <TableBody>
              {stale.slice(0, MAX).map((l) => (
                <TableRow key={l.id}>
                  <TableCell>{nn(l.a)}{l.aPort ? ` (${l.aPort})` : ""}</TableCell>
                  <TableCell>{nn(l.b)}{l.bPort ? ` (${l.bPort})` : ""}</TableCell>
                  <TableCell>{FONTE[l.source] ?? l.source}</TableCell>
                  <TableCell>non visto da {l.daysUnseen} g</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Altri n={stale.length} />
        </CardContent>
      </Card>
    </div>
  );
}
```
Togliere i `!` sostituendo `.filter((n) => n !== undefined)` con un filtro tipizzato (`(n): n is MapNode => n !== undefined`): il lint del progetto potrebbe vietarli.

- [ ] **Step 3: il collegamento dalla mappa** — in `topology/page.tsx`, accanto al titolo: `<Link href="/topology/dati" className="text-sm underline">Dati della mappa</Link>`.

- [ ] **Step 4: tipi, lint, build** — `npx tsc --noEmit && npm run lint && npm run build` → puliti (la build serve qui perché è una pagina nuova).

- [ ] **Step 5: commit**

```bash
git add "src/app/(dashboard)/topology/dati" "src/app/(dashboard)/topology/page.tsx"
git commit -m "feat(topologia): pagina «Dati della mappa» — numeri, proposte, da sistemare, sedi, soglia"
```

---

### Task 14: Lo script di misura e la misura sulle copie (tappa F, sessione principale)

**Files:**
- Create: `scripts/misura-topologia.ts`

**Interfaces:**
- Consumes: tutto quanto sopra; `createUnifiClient` (`src/lib/integrations/unifi-api.ts`), `syncUnifiForTenant`, `buildTopologyGraph` (mappa vecchia).

Cosa fa, sulla copia della copia (stesse guardie di `prova-giri-sovrapposti.ts`):
1. `PRAGMA integrity_check` prima; apertura del tenant = **migrazione** (colonne aggiunte e durata); `integrity_check` dopo;
2. **prima**: la mappa vecchia (`getTopologyData` + `buildTopologyGraph`) → collegamenti fra apparati, nodi esterni, apparati isolati;
3. **dopo**: `buildTopologyModel` → tutti i `counts`;
4. con `--unifi <id del controller> --segreto-stdin`: legge il controller **in sola lettura** con il segreto dato come prima riga di stdin (chiave API per `udm`, password per `self_hosted`; l'impronta del certificato è quella salvata nella copia, e una nuova non si scrive da nessuna parte), sincronizza **sulla copia**, e ripete il punto 3;
5. stampa **solo conteggi** (niente nomi, IP, MAC); con `--json` lo stesso in JSON. Uscita 0 = fatto, 1 = integrità rovinata, 2 = non partito.

- [ ] **Step 1: lo script**

```ts
// scripts/misura-topologia.ts
/**
 * misura-topologia.ts — numeri della topologia prima/dopo la fase 1 su una COPIA
 * del DB di un tenant (piano 2026-10-13-topologia-fase1-dati, Task 14).
 * Copia della copia in una cartella temporanea; migrazione applicata lì; con
 * --unifi legge il controller in sola lettura e scrive solo sulla copia.
 * Stampa solo conteggi.
 *
 * Uso:  npx tsx scripts/misura-topologia.ts <copia.db> --cartella <scratchpad> [--unifi <id> --segreto-stdin] [--json]
 *   Il segreto (chiave API o password del controller) arriva come PRIMA RIGA di
 *   stdin, mai in un argomento. Uscita: 0 fatto, 1 integrità rovinata, 2 non partito.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import readline from "node:readline";
import { controllaPercorsi } from "../src/lib/scanner/__tests__/support/percorsi-prova";

function uso(msg?: string): number {
  if (msg) process.stderr.write(`${msg}\n`);
  process.stderr.write("Uso: npx tsx scripts/misura-topologia.ts <copia.db> --cartella <scratchpad> [--unifi <id> --segreto-stdin] [--json]\n");
  return 2;
}

async function primaRiga(): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin });
  for await (const line of rl) {
    rl.close();
    return line.trim();
  }
  return "";
}

async function main(): Promise<number> {
  const a = process.argv.slice(2);
  const val = (k: string) => (a.indexOf(k) >= 0 ? a[a.indexOf(k) + 1] : undefined);
  const cartella = val("--cartella");
  const unifi = val("--unifi");
  const json = a.includes("--json");
  const conSegreto = a.includes("--segreto-stdin");
  const liberi = a.filter((x, i) => !x.startsWith("--") && !["--cartella", "--unifi"].includes(a[i - 1] ?? ""));
  if (!cartella || liberi.length !== 1) return uso();
  if (unifi !== undefined && (!/^\d+$/.test(unifi) || !conSegreto)) return uso("--unifi vuole l'id del controller e --segreto-stdin.");

  const sorgente = path.resolve(liberi[0]);
  const tenant = path.basename(sorgente).replace(/\.db$/i, "");
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(tenant)) return uso("Nome del file non valido come codice tenant.");
  const lavoro = path.join(path.resolve(cartella), `misura-topologia-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  const dataDir = path.join(lavoro, "data");
  const hubDb = path.join(lavoro, "hub.db");
  const errori = controllaPercorsi({ scratchpad: cartella, sorgente, dataDir, hubDb, repo: process.cwd() });
  if (errori.length > 0) return uso(`Non parto:\n${errori.map((e) => `  - ${e}`).join("\n")}`);

  const segreto = conSegreto ? await primaRiga() : "";
  if (conSegreto && !segreto) return uso("Nessun segreto sulla prima riga di stdin.");

  const dest = path.join(dataDir, "tenants", `${tenant}.db`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(sorgente, dest);
  process.env.DA_INVENT_DATA_DIR = dataDir;
  process.env.DA_IPAM_HUB_DB_PATH = hubDb;
  process.env.ENCRYPTION_KEY ||= crypto.randomBytes(16).toString("hex");
  const registro = path.join(lavoro, "misura.log");
  for (const k of ["log", "info", "warn", "error", "debug"] as const) {
    console[k] = (...p: unknown[]) => fs.appendFileSync(registro, `[${k}] ${p.map(String).join(" ")}\n`);
  }

  const Database = (await import("better-sqlite3")).default;
  const integrita = (f: string) => {
    const d = new Database(f, { readonly: true });
    try {
      return (d.prepare("PRAGMA integrity_check").all() as Array<{ integrity_check: string }>).map((r) => r.integrity_check).join(";");
    } finally {
      d.close();
    }
  };
  const out: Record<string, unknown> = { tenant, integrita_prima: integrita(dest) };

  const t0 = Date.now();
  const tenantDb = await import("../src/lib/db-tenant");
  const db = tenantDb.getTenantDb(tenant);
  out.migrazione_ms = Date.now() - t0;
  out.integrita_dopo = (db.prepare("PRAGMA integrity_check").all() as Array<{ integrity_check: string }>).map((r) => r.integrity_check).join(";");

  const { buildTopologyGraph } = await import("../src/lib/topology/graph");
  const { buildTopologyModel } = await import("../src/lib/topology/model");
  const vecchia = tenantDb.withTenant(tenant, () => {
    const d = tenantDb.getTopologyData();
    const g = buildTopologyGraph({ devices: d.devices, hosts: d.hosts, neighbors: d.neighbors, statusByNode: new Map() });
    const grado = new Map<string, number>();
    for (const e of g.edges) for (const n of [e.source, e.target]) grado.set(n, (grado.get(n) ?? 0) + 1);
    return {
      collegamenti_fra_apparati: g.edges.filter((e) => e.source.startsWith("dev:") && e.target.startsWith("dev:")).length,
      nodi_esterni: g.nodes.filter((n) => n.kind === "external").length,
      apparati_isolati: g.nodes.filter((n) => n.kind === "device" && !grado.has(n.id)).length,
    };
  });
  out.prima = vecchia;
  out.dopo = tenantDb.withTenant(tenant, () => buildTopologyModel(tenantDb.getTopologyModelInput(2)).counts);

  if (unifi !== undefined) {
    const { createUnifiClient } = await import("../src/lib/integrations/unifi-api");
    const { syncUnifiForTenant } = await import("../src/lib/integrations/unifi-sync");
    const row = db.prepare("SELECT kind, url, site, username, cert_pin FROM network_controllers WHERE id = ?").get(Number(unifi)) as
      | { kind: string; url: string; site: string; username: string; cert_pin: string | null }
      | undefined;
    if (!row) return uso(`Controller ${unifi} assente nella copia.`);
    let pin = row.cert_pin;
    const store = { get: () => pin, set: (p: string) => { pin = p; }, clear: () => { pin = null; } };
    const cfg = row.kind === "udm"
      ? { url: row.url, kind: "udm" as const, site: row.site, apiToken: segreto }
      : { url: row.url, kind: "self_hosted" as const, site: row.site, username: row.username, password: segreto };
    const r = await tenantDb.withTenant(tenant, () => syncUnifiForTenant({ source: createUnifiClient(cfg, store) }));
    out.lettura_unifi = { apparati: r.total, nuovi: r.added, aggiornati: r.updated, saltati: r.skipped, porte: r.portsUpserted, vicini: r.neighborsUpserted, uplink: r.uplinksSaved, errori: r.errors.length };
    out.dopo_lettura = tenantDb.withTenant(tenant, () => buildTopologyModel(tenantDb.getTopologyModelInput(2)).counts);
  }
  out.integrita_finale = (db.prepare("PRAGMA integrity_check").all() as Array<{ integrity_check: string }>).map((r) => r.integrity_check).join(";");

  process.stdout.write(json ? `${JSON.stringify(out, null, 1)}\n` : `${Object.entries(out).map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`).join("\n")}\n`);
  return out.integrita_finale === "ok" && out.integrita_dopo === "ok" ? 0 : 1;
}

main().then((c) => process.exit(c), (e) => { process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`); process.exit(2); });
```
Da verificare scrivendo (non si indovina): la firma di `createUnifiClient` accetta uno store senza `matchesOrigin` (è facoltativo in `UnifiCertPinStore`); `UnifiKind` contiene `"udm"` e `"self_hosted"`; il messaggio d'errore di `syncUnifiForTenant` non contiene il segreto (lo si controlla nel log: `grep -c` del segreto nel registro **senza stamparlo**: `grep -cF -f <(printf '%s\n' "$T") "$REG"` dentro la stessa pipe che lo legge, oppure si salta se il segreto non è in una variabile).

- [ ] **Step 2: prova con un segreto finto (obbligatoria prima di quello vero)**

```bash
cd /Users/riccardo/Progetti/Domarc/DA-IPAM/.claude/worktrees/topologia-f1
printf 'finto-non-valido\n' | npx tsx scripts/misura-topologia.ts "$S/copie/70791.db" --cartella "$S" --unifi 1 --segreto-stdin; echo "exit=$?"
```
Atteso: `exit=0`, `lettura_unifi` con `errori: 1` (il controller rifiuta: 401) e nessuna scrittura; nell'output e nel trascritto la stringa finta **non** compare. Se compare, ci si ferma e si corregge prima del segreto vero.

- [ ] **Step 3: la misura vera**

Hub (Domarc, controller #1 = UDM Beast, chiave API nel vault `da-IPAM-accessi.md` sezione «UNIFI DOMARC»). Il segreto va allo script come prima riga di stdin da un filtro che **fallisce chiuso** (una riga che non riconosce non la stampa: esce con errore), nella stessa pipe:

```bash
<filtro del vault che stampa SOLO il valore della chiave UNIFI DOMARC, o esce ≠0> \
  | npx tsx scripts/misura-topologia.ts "$S/copie/70791.db" --cartella "$S" --unifi 1 --segreto-stdin --json > "$S/misura-70791.json"; echo "exit=$?"
```
Prima di usarlo, il filtro si prova **sul vault** con l'output rediretto in `wc -c` (lunghezza, non il valore). Se il formato del vault non si capisce senza stamparlo, ci si ferma e si chiede a Riccardo come leggerlo (memoria «segreti-verso-ssh-prova-finta»: tre chiavi bruciate così).

DTS (tenant 71734, controller self-hosted 172.16.1.222:8443, utente e password nel vault (`dts-appliance-credentials.md`, sezione UNIFI)): stessa cosa, **se il controller risponde dal Mac** (il 12/10 sì). Se non risponde: misura senza `--unifi` e lo si scrive nella richiesta di conferma («i numeri dell'uplink di DTS si vedranno solo dopo la prima lettura su DTS»).

Atteso, per entrambi: `exit=0`, `integrita_*: ok`, `migrazione_ms`, `prima` e `dopo` (e `dopo_lettura`). Questi numeri vanno nella richiesta di conferma (Task 16).

- [ ] **Step 4: commit**

```bash
git add scripts/misura-topologia.ts
git commit -m "chore(topologia): script di misura prima/dopo su una copia del DB, con lettura UniFi facoltativa"
```

---

### Task 15: Documenti, cancello completo, verifica a schermo in locale (tappa F)

**Files:**
- Create: `docs/adr/0008-topologia-dati-fase1.md`
- Modify: `docs/adr/0005-unifi-controller-integration.md` (i due limiti «uplink non usato» e «due scrittori su porte e vicini» → «superato per i vicini e l'uplink dall'ADR 0008; le porte restano a un solo scrittore per apparato»), `docs/adr/0003-topology-map.md` (in testa: «La disposizione con dagre è superata dalla spec v2 del 13/10; il modello dei dati dall'ADR 0008»), `CHANGELOG.md`, `CONTEXT.md` (§6 «Mappa topologia»)

- [ ] **Step 1: ADR 0008** (dal template `0000-template.md`): Stato «accettata» 2026-10-13 · Contesto (spec v2 §2: 16 collegamenti fra apparati su 88 vicini, doppi, uplink buttato) · Decisione: *«i vicini non si cancellano più: si aggiornano, invecchiano e dopo 90 giorni si tolgono; l'uplink UniFi si salva; sede, testa e subnet sono scelte confermate; tutto il resto il modello lo calcola a ogni richiesta e non lo salva»* · Alternative scartate (tabella storica dei collegamenti a parte: un secondo scrittore e un secondo posto da tenere coerente; uplink come riga di `device_neighbors`: il CHECK su `protocol` chiederebbe di ricostruire la tabella, vietato su tabelle con FK) · Conseguenze, con **«cosa diventa difficile in futuro»**: la mappa vecchia e l'attribuzione vedono anche i vicini vecchi; `device_neighbors` cresce fino alla pulizia a 90 giorni; dove un controller non si legge da solo (DTS oggi) tutto invecchia in due giorni; il ramo `tappa3b/nucleo` toglie `upsertNeighbors` dal facade `db.ts` (nel rebase vince il nucleo).

- [ ] **Step 2: CHANGELOG** in `## [Non rilasciato] — 2026-10-13`: *Aggiunte* — pagina «Dati della mappa», testa e subnet nelle Ubicazioni, sede sull'apparato, uplink UniFi salvato; *Modifiche* — i collegamenti non si cancellano più a ogni lettura (perché: la spec chiede «non visto da N giorni» invece di linee che spariscono, e due fonti sullo stesso apparato si cancellavano a vicenda); *Correzioni* — vicini abbinati anche per MAC (prima il MAC del vicino si leggeva e si ignorava).

- [ ] **Step 3: CONTEXT.md** — §6, voce «Mappa topologia»: modello nuovo in `src/lib/topology/model.ts` accanto alla mappa vecchia; la mappa vecchia resta finché la fase 2 non la sostituisce; trappola «i vicini non si cancellano più (ADR 0008)»; misura con `scripts/misura-topologia.ts`.

- [ ] **Step 4: release sul ramo e cancello completo**

```bash
cd /Users/riccardo/Progetti/Domarc/DA-IPAM/.claude/worktrees/topologia-f1
git fetch -q origin && git rebase origin/dev   # se dev si è mosso: rebase, e il cancello si rifà dopo
npm run version:release
LOG="$S/cancello-f1.log"; (npm run lint && npx tsc --noEmit && DA_INVENT_DATA_DIR=$(mktemp -d) npm test && npm run build) > "$LOG" 2>&1; ESITO=$?; echo "exit=$ESITO"; grep -E "^# (tests|pass|fail)" "$LOG"
```
Atteso: `exit=0`, `# fail 0` (al 13/10 c'era **una** prova rossa nota su 1670: se è la stessa, la si nomina nel rapporto; se è un'altra, ci si ferma). Il push del ramo di lavoro (non di `dev`) è libero: `git push -u origin topologia/fase1-dati`.

- [ ] **Step 5: a schermo, in locale, sulla copia** (non sul dato vero dei clienti fuori dal Mac)

App locale sulla copia della copia di DTS, hub di prova con un utente creato al primo avvio da `/setup` (password generata sul posto, scritta in un file `chmod 600` nello scratchpad, mai stampata):

```bash
U="$S/ui"; mkdir -p "$U/data/tenants" && cp "$S/copie/71734.db" "$U/data/tenants/71734.db"
DA_INVENT_DATA_DIR="$U/data" DA_IPAM_HUB_DB_PATH="$U/hub.db" ENCRYPTION_KEY=$(openssl rand -hex 16) npx next dev -p 3101 > "$U/dev.log" 2>&1 &
echo $! > "$U/dev.pid"
```
Se `/setup` non registra un tenant col codice `71734`, lo si registra prima di avviare con `createTenant` di `db-hub` (come fa `scripts/prova-giri-sovrapposti.ts`), con le stesse variabili d'ambiente. Con Playwright, a **1920×1080** e a **1280×800**: `/setup` (utente e tenant `71734`), poi `/topology/dati`, `/inventory/locations` → «Mappa» su una sede (scegliere 2 subnet e una testa, salvare, rileggere), un apparato → «Modifica» → «Sede / armadio» (scegliere, salvare, riaprire). Foto nello scratchpad. Si controlla: nessuna scritta fuori dai riquadri, «+ altri N» dove serve, stato scritto in parole, errori in vista (provare con il server spento: si vede l'errore, non una lista vuota). Alla fine: `kill "$(cat "$U/dev.pid")"`.

- [ ] **Step 6: revisione finale** — un revisore sull'intero ramo (`git diff origin/dev...topologia/fase1-dati`), con questo piano e la spec in mano. Le correzioni senza nuova revisione; poi il cancello del passo 4 una volta, verde.

- [ ] **Step 7: commit dei documenti**

```bash
git add docs/adr/0008-topologia-dati-fase1.md docs/adr/0005-unifi-controller-integration.md docs/adr/0003-topology-map.md CHANGELOG.md CONTEXT.md
git commit -m "docs(topologia): ADR 0008 sui dati della mappa, CHANGELOG e CONTEXT della fase 1"
git push origin topologia/fase1-dati
```

---

### Task 16: LA CONFERMA (tappa G — Riccardo)

Nessun push su `dev` prima di qui. Si presenta a Riccardo **in una volta sola**, in italiano semplice, con gli orari in ora italiana:

1. **Cosa cambia** in tre righe (vicini che invecchiano invece di sparire, uplink salvato, sede/testa/subnet scelte a mano, pagina «Dati della mappa»; la mappa di oggi resta uguale).
2. **I numeri misurati sulle copie** (Task 14), hub e DTS affiancati: integrità prima/dopo, durata della migrazione, mappa vecchia vs modello nuovo (collegamenti fra apparati, attaccati, non abbinati, isolati, doppi fusi, senza sede, proposte), e dopo la lettura UniFi (uplink salvati).
3. **Le scritture da autorizzare, una per una**:
   - (a) **push su `dev`** = rilascio a DTS entro 15 minuti: build, riavvio, migrazione dello schema (19 colonne e una tabella) sul DB del cliente. Prima: copia del DB di DTS sul server (`data/backups/71734-pre-topologia-f1-<ora>.db`);
   - (b) **hub**: copia del DB 70791 (~2 GB, spazio controllato prima), aggiornamento come da skill `deploy-prod`, migrazione;
   - (c) **hub**: una lettura UniFi a mano del controller #1 (la UDM) per salvare subito gli uplink, invece di aspettare le 03:00;
   - (d) **DTS**: una lettura UniFi a mano con copia del DB prima;
   - (e) **DTS, proposta**: creare la lettura UniFi pianificata ogni giorno alle 03:00 (oggi non c'è: senza, dopo due giorni tutti i collegamenti di DTS risultano «non visti»).
4. **Cosa non si tocca**: edge, canale edge↔DA-Vul-can, `main`, controller (sempre in sola lettura).

Si attende la risposta. Se Riccardo autorizza solo una parte, si fa solo quella e si scrive cosa resta.

---

### Task 17: Rilascio dopo la conferma (tappa H, sessione principale)

Solo i punti autorizzati al Task 16. Ogni passo: comando, codice d'uscita, verifica dove la cosa succede (journal con l'ora dell'ultima riga), ora italiana nel rapporto.

- [ ] **(a) DTS**: copia del DB sul server (stessa via del Task 0, ma il file resta in `/opt/da-ipam/data/backups/`), poi

```bash
cd /Users/riccardo/Progetti/Domarc/DA-IPAM/.claude/worktrees/topologia-f1
git fetch -q origin && git rebase origin/dev && <cancello del Task 15 passo 4, verde>
git push origin HEAD:dev
```
Entro 15 minuti, **un solo ssh** a DTS: `systemctl is-active da-ipam`, versione servita (`curl -s localhost:<porta>/api/version`), `journalctl -u da-ipam --since "-20 min" | grep -E "topologia fase 1|migrazione topologia"`, `PRAGMA quick_check` in sola lettura sul DB del tenant, `pgrep -x node`. Atteso: attivo, versione nuova, «aggiunte 19 colonne» una volta, `quick_check` ok. Se la riga dice «fallita»: si legge il journal intero da quel momento, non si riprova a tentoni (REGOLA #0).

- [ ] **(b) hub**: `df` e copia del DB, poi la skill `deploy-prod` (git pull di `dev` + `npm run build` + riavvio, mai il build senza riavvio subito dopo). Stesse verifiche di (a), tenant 70791 e 70791a.

- [ ] **(c)/(d) letture UniFi**: dalla pagina Rete → Controller di rete («Leggi ora») oppure via API con la sessione di Riccardo, a sua scelta; conteggi dello storico della lettura confrontati con `lettura_unifi` della misura (Task 14).

- [ ] **(e) DTS**: job `unifi_sync` del controller di DTS, ogni giorno alle 03:00, dalla pagina Controller di rete.

- [ ] **A schermo sul dato vero**: Riccardo guarda sull'hub, a 1920, `/topology/dati` e la finestra «Mappa» di una sede, con istruzioni passo passo (pagina, clic, cosa vede se va bene, cosa se va male). Le foto le fa lui o le fa la sessione se gli dà l'accesso.

- [ ] **Chiusura**: ramo `topologia/fase1-dati` unito (già in `dev`) e cancellato, worktree tolto; `CONTEXT.md` (fotografia del 13/10 o del giorno), bacheca `~/.claude/lavori/piano-miglioramento-da-ipam.md` (Prossimo passo: fase 2 «l'albero della sede», livello leggero, sessione nuova; diario con i numeri veri); spec §6 fase 1 = fatta; `docs/scheda-mappa.md` se cambia la trappola corrente; lezioni nuove in `~/.claude/lezioni/DA-IPAM.md`.

---

## Self-review (fatta)

- **Copertura della spec (fase 1)**: uplink UniFi salvato → Task 3; abbinamento per MAC → Task 4-5; fusione apparato↔host → Task 4; «promuovi ad apparato» → Task 7 + 13 (conferma con la promozione che esiste); sede = Ubicazione con subnet e testa → Task 6, 8, 11, 12; tabella delle correzioni → Task 1, 8, 10 (interfaccia col clic destro: fase 4, spec §6); età dei collegamenti → Task 1, 2, 5; soglia «non visto» (spec §8) → Task 0, 8, 13; prove sulla forma vera con fixture DTS e Domarc (spec §7) → Task 9; garanzie «manuale vince su LLDP», «sparito diventa non visto», «stessi dati stesso risultato» → Task 5, 7; «un AP in più non sposta gli altri rami» → Task 7 per i dati (per le coordinate: fase 2); copia del DB, numeri, conferma (spec §7) → Task 0, 14, 16.
- **Fuori di proposito** (fasi successive della spec): disposizione, icone, fascia degli attaccati, tabella MAC delle porte per gli attaccati, livelli 1-3, ricerca, filtri, export drawio, correzioni col clic destro; ruolo e nascosto hanno la colonna ma nessuna logica.
- **Nomi coerenti**: `getTopologyModelInput(staleDays, nowMs?)`, `buildTopologyModel(input)`, `upsertNeighbors(id, list, source)`, `setNetworkDeviceControllerFacts`, `setSiteTopology`, `setDeviceLocation`, `SiteTopologyView`, `DeviceLocationView` usati con la stessa firma in tutti i task.
