/**
 * Ricostruzione di `credentials` senza CHECK sui tipi (tappa 2c credenziali,
 * T11 del piano `plans/2026-10-15-tappa2-archivio-credenziali.md`).
 *
 * Perché: il CHECK ammette 5 tipi e SQLite non lo cambia senza ricostruire la
 * tabella, che è la più referenziata del tenant (10 chiavi esterne, 5 in
 * CASCADE). Rischi coperti:
 *   1. ricostruire con le chiavi esterne accese cancellerebbe a cascata le
 *      righe figlie (154 in H1, 62 in A il 15/10): qui una riga per colonna
 *      figlia, contate prima e dopo; le figlie si ricavano da
 *      `PRAGMA foreign_key_list`, non da un elenco fisso (dopo la 2f sono 12);
 *   2. gli orfani che ci sono già (2 in H1) non devono diventare di più, né
 *      far fallire la migrazione: qui 1 orfano, prima e dopo;
 *   3. il contatore AUTOINCREMENT si conserva: un id cancellato non si riusa;
 *   4. chiamata dentro una transazione aperta il PRAGMA foreign_keys non ha
 *      effetto: si rifiuta senza toccare niente;
 *   5. DEFAULT dell'hub e i DB nati dal vecchio `ipam.db` hanno definizioni
 *      diverse (3 o 5 tipi, nome con o senza virgolette, `port` assente);
 *   6. il segno `credenziali_t2_tipi`: con `done:` la conversione non si
 *      richiama (le modifiche degli utenti non si annullano), con `errore:` si
 *      riprova all'apertura dopo, e il tenant si apre comunque;
 *   7. `prova-a-vuoto.ts` scrive (fa girare le migrazioni): con l'ambiente
 *      del servizio verso i dati veri deve lavorare solo sulla copia.
 *
 * Run: DA_INVENT_DATA_DIR="$(mktemp -d "${TMPDIR:-/tmp}/ipam.XXXXXX")" node --import tsx --test src/lib/__tests__/migrazione-credenziali-tipi.test.ts
 */
import { TEST_DATA_DIR } from "@/lib/__tests__/support/data-dir-isolata";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import Database from "better-sqlite3";

import { TENANT_SCHEMA_SQL, TENANT_INDEXES_SQL } from "@/lib/db-tenant-schema";
import { cartellaTenant, closeTenantDb, deleteTenantDatabase, getTenantDb, withTenant } from "@/lib/db-tenant";
import { closeHubDb, getHubDb } from "@/lib/db-hub";
import { encrypt } from "@/lib/crypto";
import { migraCredenzialiTipi } from "@/lib/credentials/migra-credenziali-tipi";

// ── Le definizioni che esistono davvero sui server ──────────────────────────

/** Tenant creati prima della Fase 4b: 7 colonne, 5 tipi; poi gli ALTER (v3, porta in fondo). */
const DEF_TENANT_7 = `CREATE TABLE IF NOT EXISTS credentials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  credential_type TEXT NOT NULL CHECK(credential_type IN ('ssh', 'snmp', 'api', 'windows', 'linux')),
  encrypted_username TEXT,
  encrypted_password TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
)`;
const ALTER_V3 = ["encrypted_auth_key", "auth_protocol", "encrypted_priv_key", "priv_protocol", "security_level"].map(
  (c) => `ALTER TABLE credentials ADD COLUMN ${c} TEXT`
);
const ALTER_PORTA = "ALTER TABLE credentials ADD COLUMN port INTEGER";

/**
 * Controller e AD come erano prima della 2f (T22), senza `credential_id`: la
 * forma di H1 e A al rilascio della 2c, con 10 figlie. Dalla 2f lo schema di
 * oggi le ha, e le figlie sono 12.
 */
const TABELLE_PRIMA_2F = [
  `CREATE TABLE IF NOT EXISTS network_controllers (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, vendor TEXT NOT NULL, kind TEXT NOT NULL, url TEXT NOT NULL,
    site TEXT NOT NULL DEFAULT 'default', username TEXT NOT NULL DEFAULT '', password_enc TEXT NOT NULL DEFAULT '',
    api_key_enc TEXT NOT NULL DEFAULT '', cert_pin TEXT, enabled INTEGER NOT NULL DEFAULT 1, last_run_at TEXT, last_ok INTEGER,
    last_message TEXT, last_devices INTEGER, last_ports INTEGER, last_neighbors INTEGER, origin TEXT NOT NULL DEFAULT 'manual',
    created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS ad_integrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, dc_host TEXT NOT NULL, domain TEXT NOT NULL, base_dn TEXT NOT NULL,
    encrypted_username TEXT NOT NULL, encrypted_password TEXT NOT NULL, use_ssl INTEGER NOT NULL DEFAULT 1, port INTEGER NOT NULL DEFAULT 636,
    enabled INTEGER NOT NULL DEFAULT 1, winrm_credential_id INTEGER REFERENCES credentials(id) ON DELETE SET NULL,
    dhcp_leases_count INTEGER DEFAULT 0, last_sync_at TEXT, last_sync_status TEXT, computers_count INTEGER DEFAULT 0,
    users_count INTEGER DEFAULT 0, groups_count INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')), UNIQUE(dc_host, domain)
  )`,
];

/** Vecchio ipam.db, db.ts:273-286: nome senza virgolette, 3 tipi, v3 nella CREATE. */
const DEF_IPAM_3 = `CREATE TABLE IF NOT EXISTS credentials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      credential_type TEXT NOT NULL CHECK(credential_type IN ('ssh', 'snmp', 'api')),
      encrypted_username TEXT,
      encrypted_password TEXT,
      encrypted_auth_key TEXT,
      auth_protocol TEXT,
      encrypted_priv_key TEXT,
      priv_protocol TEXT,
      security_level TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )`;

/** Vecchio ipam.db dopo db.ts:663-674: credentials_host_new rinominata, quindi fra virgolette in sqlite_master. */
function creaDefIpamVirgolette(db: Database.Database): void {
  db.exec(`CREATE TABLE credentials_host_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        credential_type TEXT NOT NULL CHECK(credential_type IN ('ssh', 'snmp', 'api', 'windows', 'linux')),
        encrypted_username TEXT,
        encrypted_password TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )`);
  db.exec("ALTER TABLE credentials_host_new RENAME TO credentials");
}

const FIGLIE_10 = [
  "ad_integrations.winrm_credential_id",
  "device_credential_bindings.credential_id",
  "host_credentials.credential_id",
  "host_detect_credential.credential_id",
  "network_credentials.credential_id",
  "network_devices.credential_id",
  "network_devices.snmp_credential_id",
  "network_host_credentials.credential_id",
  "proxmox_hosts.credential_id",
  "software_scans.credential_id",
];

function sqlCredenziali(db: Database.Database): string {
  return (db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'credentials'").get() as { sql: string }).sql;
}

function seq(db: Database.Database): number | null {
  const r = db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'credentials'").get() as { seq: number } | undefined;
  return r?.seq ?? null;
}

function conta(db: Database.Database, chiave: string): number {
  const [t, c] = chiave.split(".");
  return (db.prepare(`SELECT COUNT(*) AS n FROM "${t}" WHERE "${c}" IS NOT NULL`).get() as { n: number }).n;
}

/** DB del tenant con la definizione vecchia di credentials e il resto dello schema di oggi. */
function dbVecchio(crea: (db: Database.Database) => void): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  crea(db);
  db.exec(TENANT_SCHEMA_SQL);
  db.exec(TENANT_INDEXES_SQL);
  return db;
}

/** Tre voci (id 1, 2, 5), contatore a 9, una riga figlia per ognuna delle 10 colonne, 1 orfano. */
function popola(db: Database.Database): void {
  const ins = db.prepare("INSERT INTO credentials (id, name, credential_type, encrypted_username, encrypted_password) VALUES (?, ?, ?, ?, ?)");
  ins.run(1, "SSH root", "ssh", "u-cifrato", "p-cifrato");
  ins.run(2, "Community", "snmp", null, "c-cifrata");
  ins.run(5, "Server Linux", "linux", "u2", "p2");
  db.prepare("UPDATE sqlite_sequence SET seq = 9 WHERE name = 'credentials'").run();
  const rete = Number(db.prepare("INSERT INTO networks (cidr, name) VALUES ('10.88.0.0/24', 'Rete')").run().lastInsertRowid);
  const host = Number(db.prepare("INSERT INTO hosts (network_id, ip) VALUES (?, '10.88.0.10')").run(rete).lastInsertRowid);
  const app = Number(
    db
      .prepare("INSERT INTO network_devices (name, host, device_type, vendor, protocol, credential_id, snmp_credential_id) VALUES ('sw', '10.88.0.2', 'switch', 'hp', 'ssh', 1, 2)")
      .run().lastInsertRowid
  );
  db.prepare("INSERT INTO network_host_credentials (network_id, credential_id, role) VALUES (?, 5, 'linux')").run(rete);
  db.prepare("INSERT INTO host_detect_credential (host_id, role, credential_id) VALUES (?, 'ssh', 1)").run(host);
  db.prepare("INSERT INTO network_credentials (network_id, credential_id) VALUES (?, 2)").run(rete);
  db.prepare("INSERT INTO host_credentials (host_id, credential_id, protocol_type, port) VALUES (?, 1, 'ssh', 22)").run(host);
  db.prepare("INSERT INTO device_credential_bindings (device_id, credential_id, protocol_type, port) VALUES (?, 1, 'ssh', 22)").run(app);
  db.prepare("INSERT INTO proxmox_hosts (name, host, credential_id) VALUES ('pve', '10.88.0.5', 1)").run();
  db.prepare(
    `INSERT INTO ad_integrations (name, dc_host, domain, base_dn, encrypted_username, encrypted_password, winrm_credential_id)
     VALUES ('AD', 'dc.prova', 'prova', 'DC=prova', 'u', 'p', 1)`
  ).run();
  db.prepare(
    "INSERT INTO software_scans (host_id, started_at, status, os_family, probe, credential_id) VALUES (?, datetime('now'), 'ok', 'linux', 'ssh', 5)"
  ).run(host);
  // L'orfano che c'è già (in H1 sono 2): una riga di host_credentials verso una voce che non esiste.
  db.pragma("foreign_keys = OFF");
  db.prepare("INSERT INTO host_credentials (host_id, credential_id, protocol_type, port) VALUES (?, 99, 'snmp', 161)").run(host);
  db.pragma("foreign_keys = ON");
  // Indice, trigger e vista da ricreare.
  db.exec("CREATE INDEX idx_prova_credentials_nome ON credentials(name)");
  db.exec("CREATE TRIGGER trg_prova_credentials AFTER UPDATE OF name ON credentials BEGIN SELECT 1; END");
  db.exec("CREATE VIEW v_prova_credentials AS SELECT c.id, c.name, COUNT(h.id) AS righe FROM credentials c LEFT JOIN host_credentials h ON h.credential_id = c.id GROUP BY c.id");
}

describe("migraCredenzialiTipi sulla definizione vecchia completa", () => {
  it("stessi id, stesse figlie, contatore conservato, orfani uguali; dopo si inserisce un tipo nuovo", () => {
    const db = dbVecchio((d) => {
      d.exec(DEF_TENANT_7);
      for (const a of [...ALTER_V3, ALTER_PORTA]) d.exec(a);
      for (const t of TABELLE_PRIMA_2F) d.exec(t);
    });
    popola(db);
    assert.equal((db.prepare("PRAGMA table_info(credentials)").all() as unknown[]).length, 13, "13 colonne, porta in fondo");
    assert.throws(() => db.prepare("INSERT INTO credentials (name, credential_type) VALUES ('x', 'unifi')").run(), /CHECK/);
    const righePrima = db.prepare("SELECT * FROM credentials ORDER BY id").all();
    const colonnePrima = db.prepare("PRAGMA table_info(credentials)").all();
    const figliPrima = Object.fromEntries(FIGLIE_10.map((k) => [k, conta(db, k)]));
    assert.equal(figliPrima["host_credentials.credential_id"], 2, "la riga buona e l'orfano");
    assert.equal((db.prepare("PRAGMA foreign_key_check").all() as unknown[]).length, 1);

    const esito = migraCredenzialiTipi(db);

    assert.equal(esito.eseguita, true);
    assert.equal(esito.righe, 3);
    assert.deepEqual(esito.figli, figliPrima);
    assert.equal(esito.violazioniPrima, 1);
    assert.equal(esito.violazioniDopo, 1);
    assert.equal(esito.seq, 9);
    assert.deepEqual(db.prepare("SELECT * FROM credentials ORDER BY id").all(), righePrima);
    assert.deepEqual(db.prepare("PRAGMA table_info(credentials)").all(), colonnePrima);
    for (const k of FIGLIE_10) assert.equal(conta(db, k), figliPrima[k], k);
    assert.equal(seq(db), 9);
    assert.equal((db.prepare("PRAGMA foreign_key_check").all() as unknown[]).length, 1);
    assert.equal(db.pragma("foreign_keys", { simple: true }), 1, "chiavi esterne riaccese");
    assert.doesNotMatch(sqlCredenziali(db), /CHECK/i);
    assert.match(sqlCredenziali(db), /^CREATE TABLE "?credentials"? \(/);
    for (const [tipo, nome] of [["index", "idx_prova_credentials_nome"], ["trigger", "trg_prova_credentials"], ["view", "v_prova_credentials"]]) {
      assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type = ? AND name = ?").get(tipo, nome), `${tipo} ${nome} non ricreato`);
    }
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM v_prova_credentials").get() as { n: number }).n, 3);
    const nuova = Number(db.prepare("INSERT INTO credentials (name, credential_type) VALUES ('Controller', 'unifi')").run().lastInsertRowid);
    assert.equal(nuova, 10, "il contatore riparte da 9, non da max(id)");
    // Le chiavi esterne valgono ancora: cancellare una voce porta via le figlie CASCADE.
    db.prepare("DELETE FROM credentials WHERE id = 2").run();
    assert.equal(conta(db, "network_credentials.credential_id"), 0);
  });

  it("con le due colonne del T22 (schema di oggi) conta 12 figlie, ricavate dallo schema, e le ritrova tutte", () => {
    const db = dbVecchio((d) => {
      d.exec(DEF_TENANT_7);
      for (const a of [...ALTER_V3, ALTER_PORTA]) d.exec(a);
    });
    popola(db);
    db.prepare("INSERT INTO network_controllers (name, vendor, kind, url, credential_id) VALUES ('UniFi', 'ubiquiti', 'unifi', 'https://u', 1)").run();
    db.prepare("UPDATE ad_integrations SET credential_id = 1").run();

    const esito = migraCredenzialiTipi(db);

    assert.equal(Object.keys(esito.figli).length, 12);
    assert.equal(esito.figli["network_controllers.credential_id"], 1);
    assert.equal(esito.figli["ad_integrations.credential_id"], 1);
    assert.equal(conta(db, "network_controllers.credential_id"), 1);
    assert.equal(conta(db, "ad_integrations.credential_id"), 1);
  });

  it("dentro una transazione aperta rifiuta senza toccare niente", () => {
    const db = dbVecchio((d) => {
      d.exec(DEF_TENANT_7);
      for (const a of [...ALTER_V3, ALTER_PORTA]) d.exec(a);
    });
    popola(db);
    const sqlPrima = sqlCredenziali(db);
    db.exec("BEGIN");
    assert.throws(() => migraCredenzialiTipi(db), /transazione/);
    db.exec("ROLLBACK");
    assert.equal(sqlCredenziali(db), sqlPrima);
    assert.equal(db.pragma("foreign_keys", { simple: true }), 1);
    assert.equal(conta(db, "network_credentials.credential_id"), 1);
  });

  it("seconda chiamata: nessun effetto", () => {
    const db = dbVecchio((d) => {
      d.exec(DEF_TENANT_7);
      for (const a of [...ALTER_V3, ALTER_PORTA]) d.exec(a);
    });
    popola(db);
    migraCredenzialiTipi(db);
    const sql = sqlCredenziali(db);
    const righe = db.prepare("SELECT * FROM credentials ORDER BY id").all();
    const esito = migraCredenzialiTipi(db);
    assert.equal(esito.eseguita, false);
    assert.equal(sqlCredenziali(db), sql);
    assert.deepEqual(db.prepare("SELECT * FROM credentials ORDER BY id").all(), righe);
  });

  it("definizione con un CHECK sul tipo che non si riconosce: errore, niente ricostruzione alla cieca", () => {
    const db = dbVecchio((d) => {
      d.exec("CREATE TABLE credentials (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, credential_type TEXT NOT NULL, CHECK (credential_type <> ''))");
    });
    assert.throws(() => migraCredenzialiTipi(db), /non riconosciut/);
  });
});

describe("migraCredenzialiTipi sulle definizioni del vecchio ipam.db", () => {
  const casi: Array<[string, (d: Database.Database) => void]> = [
    [
      "senza virgolette, 3 tipi, più gli ALTER di db.ts",
      (d) => {
        d.exec(DEF_IPAM_3);
        d.exec(ALTER_PORTA);
      },
    ],
    [
      "fra virgolette, 5 tipi e 7 colonne (db.ts:663-674), più gli ALTER",
      (d) => {
        creaDefIpamVirgolette(d);
        for (const a of [...ALTER_V3, ALTER_PORTA]) d.exec(a);
      },
    ],
  ];
  for (const [titolo, crea] of casi) {
    it(titolo, () => {
      const db = dbVecchio(crea);
      db.prepare("INSERT INTO credentials (id, name, credential_type, encrypted_password) VALUES (4, 'Community', 'snmp', 'c')").run();
      const rete = Number(db.prepare("INSERT INTO networks (cidr, name) VALUES ('10.90.0.0/24', 'Rete')").run().lastInsertRowid);
      db.prepare("INSERT INTO network_credentials (network_id, credential_id) VALUES (?, 4)").run(rete);
      const righe = db.prepare("SELECT * FROM credentials ORDER BY id").all();
      const esito = migraCredenzialiTipi(db);
      assert.equal(esito.eseguita, true);
      assert.equal(esito.righe, 1);
      assert.doesNotMatch(sqlCredenziali(db), /CHECK/i);
      assert.deepEqual(db.prepare("SELECT * FROM credentials ORDER BY id").all(), righe);
      db.prepare("INSERT INTO credentials (name, credential_type) VALUES ('v3', 'snmp_v3')").run();
    });
  }
});

// ── All'apertura del tenant: ordine, segno, errori ──────────────────────────

function segno(db: Database.Database): string | null {
  const r = db.prepare("SELECT value FROM tenant_settings WHERE key = 'credenziali_t2_tipi'").get() as { value: string } | undefined;
  return r?.value ?? null;
}

function riapri(code: string): Database.Database {
  closeTenantDb(code);
  return withTenant(code, () => getTenantDb(code));
}

describe("getTenantDb: ricostruzione e normalizzazione col segno credenziali_t2_tipi", () => {
  const DEF = "TESTCREDDEFAULT";
  const SEGNO = "TESTCREDSEGNO";
  after(() => {
    deleteTenantDatabase(DEF);
    deleteTenantDatabase(SEGNO);
  });

  it("DEFAULT con lo schema vecchio (senza port): prima gli ALTER, poi la ricostruzione, linux → ssh, segno done", () => {
    fs.mkdirSync(cartellaTenant(), { recursive: true });
    const file = path.join(cartellaTenant(), `${DEF}.db`);
    const vecchio = new Database(file);
    creaDefIpamVirgolette(vecchio);
    for (const a of ALTER_V3) vecchio.exec(a);
    vecchio.prepare("INSERT INTO credentials (id, name, credential_type, encrypted_username, encrypted_password) VALUES (3, 'Linux', 'linux', ?, ?)").run(
      encrypt("root"),
      encrypt("p")
    );
    vecchio.prepare("UPDATE sqlite_sequence SET seq = 7 WHERE name = 'credentials'").run();
    vecchio.close();

    const db = withTenant(DEF, () => getTenantDb(DEF));

    const colonne = (db.prepare("PRAGMA table_info(credentials)").all() as Array<{ name: string }>).map((c) => c.name);
    for (const c of ["port", "auth_method", "encrypted_private_key", "encrypted_key_passphrase"]) assert.ok(colonne.includes(c), `manca ${c}`);
    assert.doesNotMatch(sqlCredenziali(db), /CHECK/i);
    assert.equal((db.prepare("SELECT credential_type FROM credentials WHERE id = 3").get() as { credential_type: string }).credential_type, "ssh");
    assert.equal(seq(db), 7);
    assert.match(segno(db) ?? "", /^done:\d{4}-\d{2}-\d{2}T[^:]+:\d{2}:[^:]+:.*linux_ssh=1/);
  });

  it("col segno done la conversione non si richiama: la voce tolta non torna, una voce scritta dopo resta com'è", () => {
    let db = withTenant(SEGNO, () => getTenantDb(SEGNO));
    assert.match(segno(db) ?? "", /^done:/);
    // Uno stato di prima della 2c: un'ibrida usata da un apparato SNMPv3, segno assente.
    db.prepare("DELETE FROM tenant_settings WHERE key = 'credenziali_t2_tipi'").run();
    const ib = Number(
      db
        .prepare(
          "INSERT INTO credentials (name, credential_type, encrypted_username, encrypted_password, security_level, encrypted_auth_key) VALUES ('Ibrida', 'snmp', ?, ?, 'authNoPriv', ?)"
        )
        .run(encrypt("u"), encrypt("c"), encrypt("k")).lastInsertRowid
    );
    db.prepare("INSERT INTO network_devices (name, host, device_type, vendor, protocol, credential_id) VALUES ('v3', '10.89.0.2', 'switch', 'hp', 'snmp_v3', ?)").run(ib);
    db = riapri(SEGNO);
    const nata = db.prepare("SELECT id FROM credentials WHERE name = 'Ibrida (v3)'").get() as { id: number } | undefined;
    assert.ok(nata, "la divisione non è avvenuta");
    assert.match(segno(db) ?? "", /^done:.*ibride=1/);

    // L'utente toglie la voce nata dalla conversione e scrive una voce linux (il validatore la accetta fino al T13).
    db.prepare("DELETE FROM credentials WHERE id = ?").run(nata.id);
    const lin = Number(db.prepare("INSERT INTO credentials (name, credential_type) VALUES ('Dopo', 'linux')").run().lastInsertRowid);
    db = riapri(SEGNO);
    assert.equal(db.prepare("SELECT id FROM credentials WHERE name = 'Ibrida (v3)'").get(), undefined, "la voce tolta è tornata");
    assert.equal((db.prepare("SELECT credential_type FROM credentials WHERE id = ?").get(lin) as { credential_type: string }).credential_type, "linux");
  });

  it("errore: segno errore:, il tenant si apre, all'apertura dopo si riprova", () => {
    let db = riapri(SEGNO);
    db.prepare("DELETE FROM tenant_settings WHERE key = 'credenziali_t2_tipi'").run();
    const id = Number(db.prepare("INSERT INTO credentials (name, credential_type) VALUES ('Da convertire', 'linux')").run().lastInsertRowid);
    db.exec("CREATE TRIGGER trg_prova_blocca BEFORE UPDATE OF credential_type ON credentials BEGIN SELECT RAISE(ABORT, 'conversione bloccata dalla prova'); END");
    db = riapri(SEGNO);
    assert.match(segno(db) ?? "", /^errore:.*conversione bloccata dalla prova/);
    assert.equal((db.prepare("SELECT credential_type FROM credentials WHERE id = ?").get(id) as { credential_type: string }).credential_type, "linux");
    db.exec("DROP TRIGGER trg_prova_blocca");
    db = riapri(SEGNO);
    assert.match(segno(db) ?? "", /^done:/);
    assert.equal((db.prepare("SELECT credential_type FROM credentials WHERE id = ?").get(id) as { credential_type: string }).credential_type, "ssh");
  });

  it("tipo sconosciuto: segno parziale:, la voce resta", () => {
    let db = riapri(SEGNO);
    db.prepare("DELETE FROM tenant_settings WHERE key = 'credenziali_t2_tipi'").run();
    db.prepare("INSERT INTO credentials (name, credential_type) VALUES ('Telnet', 'telnet')").run();
    db = riapri(SEGNO);
    assert.match(segno(db) ?? "", /^parziale:.*lasciate=1/);
    assert.ok(db.prepare("SELECT 1 FROM credentials WHERE credential_type = 'telnet'").get());
  });
});

// ── prova-a-vuoto.ts: lavora sulla copia, mai sui dati del servizio ─────────

const REPO = process.cwd();
const SCRIPT = path.join(REPO, "scripts", "credenziali", "prova-a-vuoto.ts");
const TPAV = "TESTPROVAVUOTO";

function statoCartella(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const giro = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) giro(p);
      else {
        const s = fs.statSync(p);
        out[path.relative(dir, p)] = `${s.mtimeMs}:${s.size}`;
      }
    }
  };
  giro(dir);
  return out;
}

function lancia(args: string[], datiServizio: string) {
  const env: NodeJS.ProcessEnv = { ...process.env, DA_INVENT_DATA_DIR: datiServizio };
  delete env.DA_IPAM_HUB_DB_PATH;
  return spawnSync(process.execPath, ["--import", "tsx", SCRIPT, ...args], { cwd: REPO, env, encoding: "utf8", timeout: 180_000 });
}

/** Una cartella dati con hub.db e un tenant con lo schema vecchio di credentials e una voce linux. */
function cartellaDati(dir: string): void {
  fs.mkdirSync(path.join(dir, "tenants"), { recursive: true });
  fs.copyFileSync(path.join(TEST_DATA_DIR, "hub.db"), path.join(dir, "hub.db"));
  const d = new Database(path.join(dir, "tenants", `${TPAV}.db`));
  d.exec(DEF_TENANT_7);
  for (const a of [...ALTER_V3, ALTER_PORTA]) d.exec(a);
  d.prepare("INSERT INTO credentials (name, credential_type, encrypted_username, encrypted_password) VALUES ('Linux', 'linux', ?, ?)").run(
    encrypt("root"),
    encrypt("p")
  );
  d.close();
}

function leggi(file: string): { tipo: string; segno: string | null } {
  const d = new Database(file, { readonly: true });
  try {
    const tipo = (d.prepare("SELECT credential_type FROM credentials").get() as { credential_type: string }).credential_type;
    const haSettings = d.prepare("SELECT 1 FROM sqlite_master WHERE name = 'tenant_settings'").get();
    const s = haSettings ? (d.prepare("SELECT value FROM tenant_settings WHERE key = 'credenziali_t2_tipi'").get() as { value: string } | undefined) : undefined;
    return { tipo, segno: s?.value ?? null };
  } finally {
    d.close();
  }
}

describe("prova-a-vuoto.ts sulla copia", () => {
  let radice = "";
  let servizio = "";
  let copia = "";
  before(() => {
    getHubDb();
    closeHubDb();
    radice = fs.mkdtempSync(path.join(os.tmpdir(), "prova-a-vuoto-"));
    servizio = path.join(radice, "servizio");
    copia = path.join(radice, "copia");
    cartellaDati(servizio);
    cartellaDati(copia);
  });
  after(() => {
    if (radice) fs.rmSync(radice, { recursive: true, force: true });
  });

  it("con DA_INVENT_DATA_DIR verso il servizio lavora su --dati e lascia il servizio intatto", () => {
    const statoServizio = statoCartella(servizio);
    const r = lancia(["--dati", copia], servizio);
    assert.equal(r.status, 0, `uscita ${r.status}\n${r.stdout}\n${r.stderr}`);
    assert.deepEqual(statoCartella(servizio), statoServizio, "la cartella del servizio è stata toccata");
    assert.deepEqual(leggi(path.join(servizio, "tenants", `${TPAV}.db`)), { tipo: "linux", segno: null });
    const c = leggi(path.join(copia, "tenants", `${TPAV}.db`));
    assert.equal(c.tipo, "ssh");
    assert.match(c.segno ?? "", /^done:/);
    const blocco = r.stdout.split(`== Tenant ${TPAV}`)[1] ?? "";
    assert.match(blocco, /credentials: righe 1 → 1/);
    assert.match(blocco, /violazioni 0 → 0/);
    assert.match(blocco, /#1 «Linux»: linux → ssh/);
    assert.match(blocco, /seconda apertura: nessun cambiamento/);
  });

  it("--dati uguale alla cartella del servizio: esce con 2 senza aprire niente", () => {
    const statoServizio = statoCartella(servizio);
    const r = lancia(["--dati", servizio], servizio);
    assert.equal(r.status, 2, `uscita ${r.status}\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr, /Non parto/);
    assert.deepEqual(statoCartella(servizio), statoServizio);
  });
});
