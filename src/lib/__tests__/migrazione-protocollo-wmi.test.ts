/**
 * Protocollo `wmi` e colonna `host_credentials.motivo` (piano 2026-11-04 accesso Windows, Task 2).
 * Zona delicata: si ricostruiscono due tabelle di credenziali nei DB dei clienti, perché un CHECK di SQLite non si altera.
 *
 * Si parte sempre dallo schema di PRIMA, scritto qui a mano e congelato, con righe vere: file su disco aperti da
 * `getTenantDb` (il percorso vero) oppure handle in memoria per i casi che servono a far fallire la copia. Il path legacy
 * (`ipam.db`) si prova in un processo a parte, da una copia di `data/ipam.empty.db`, il modello che ha ancora il CHECK
 * più vecchio.
 *
 * Run: node --import tsx --test src/lib/__tests__/migrazione-protocollo-wmi.test.ts
 */
import { TEST_DATA_DIR } from "@/lib/__tests__/support/data-dir-isolata";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { encrypt } from "@/lib/crypto";
import { resolveDataDir } from "@/lib/data-dir";
import { closeHubDb } from "@/lib/db-hub";
import {
  closeTenantDb,
  deleteTenantDatabase,
  getCredentialCoverageByCategory,
  getTenantDb,
  withTenant,
} from "@/lib/db-tenant";
import {
  TENANT_INDEXES_SQL,
  TENANT_SCHEMA_SQL,
  assicuraColonnaMotivoCredenziali,
  migraProtocolloWmi,
} from "@/lib/db-tenant-schema";
import { nuovaVoceEBindingDb, portaBinding, usataAdessoDb } from "@/lib/credentials/apparato-archivio";
import { convertiCredenzialiApparati } from "@/lib/credentials/converti-apparati";
import { DEFAULT_PORTS } from "@/lib/credentials/porte";
import { FONTI_ACQUISIZIONE, loginApparatoDb, resolveCredentialsForDb, scegliSegretoApparatoDb, sceltaLoginApparatoDb } from "@/lib/credentials/resolve";
import { leggiSegretoInline } from "@/lib/credentials/segreti";
import { erroreVocePerProtocollo, etichettaProtocollo, portaVoceValePer, tipiPerProtocollo } from "@/lib/credentials/tipi";
import { provaBinding } from "@/lib/devices/prova-binding";

const CHECK_REDFISH = "'ssh', 'snmp', 'winrm', 'api', 'redfish', 'onvif'";
const CHECK_VECCHISSIMO = "'ssh', 'snmp', 'winrm', 'api'";
const INLINE = { username: "CLIENTE\\scansioni", segreto: "cifrato-finto" };

/** Le due tabelle come sono sui tenant di oggi (5500d771): colonna per colonna, col CHECK che si passa. */
function hostCredentialsPrima(check: string, conMotivo = false): string {
  return `CREATE TABLE host_credentials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    host_id INTEGER NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
    credential_id INTEGER NOT NULL REFERENCES credentials(id) ON DELETE CASCADE,
    protocol_type TEXT NOT NULL CHECK(protocol_type IN (${check})),
    port INTEGER NOT NULL,
    validated INTEGER NOT NULL DEFAULT 0,
    validated_at TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    auto_detected INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    fail_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    last_attempt_at TEXT,
    backoff_until TEXT,${conMotivo ? "\n    motivo TEXT," : ""}
    UNIQUE(host_id, credential_id, protocol_type, port)
  )`;
}

function bindingPrima(check: string): string {
  return `CREATE TABLE device_credential_bindings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id INTEGER NOT NULL REFERENCES network_devices(id) ON DELETE CASCADE,
    credential_id INTEGER REFERENCES credentials(id) ON DELETE CASCADE,
    protocol_type TEXT NOT NULL CHECK(protocol_type IN (${check})),
    port INTEGER NOT NULL DEFAULT 22,
    sort_order INTEGER NOT NULL DEFAULT 0,
    inline_username TEXT,
    inline_encrypted_password TEXT,
    test_status TEXT NOT NULL DEFAULT 'untested' CHECK(test_status IN ('success', 'failed', 'untested')),
    test_message TEXT,
    tested_at TEXT,
    auto_detected INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(device_id, credential_id, protocol_type, port)
  )`;
}

const INDICI_PRIMA = [
  "CREATE INDEX idx_host_credentials_host ON host_credentials(host_id, sort_order)",
  "CREATE INDEX idx_host_credentials_validated ON host_credentials(host_id, validated)",
  "CREATE INDEX idx_dcb_device ON device_credential_bindings(device_id, sort_order)",
  "CREATE INDEX idx_dcb_credential ON device_credential_bindings(credential_id)",
];

/**
 * Righe da salvare: ogni colonna con un valore che non è il predefinito, una riga orfana (`host_id` 99 senza host: con i
 * vincoli accesi la copia la scarterebbe o fallirebbe) e, sulle due tabelle, una riga cancellata perché il contatore
 * AUTOINCREMENT resti sopra l'id più alto.
 */
function semina(d: Database.Database, opzioni: { conMotivo?: boolean } = {}): void {
  d.pragma("foreign_keys = OFF");
  d.prepare("INSERT INTO networks (id, cidr, name) VALUES (1, '10.70.0.0/24', 'rete-prova')").run();
  d.prepare("INSERT INTO hosts (id, network_id, ip) VALUES (1, 1, '10.70.0.5'), (2, 1, '10.70.0.6')").run();
  d.prepare("INSERT INTO credentials (id, name, credential_type) VALUES (1, 'voce-windows', 'windows'), (2, 'voce-ssh', 'ssh')").run();
  d.prepare("INSERT INTO network_devices (id, name, host, device_type, vendor, protocol) VALUES (1, 'server-prova', '10.70.0.5', 'server', 'windows', 'winrm')").run();
  const riga = d.prepare(
    `INSERT INTO host_credentials
       (id, host_id, credential_id, protocol_type, port, validated, validated_at, sort_order, auto_detected, created_at,
        fail_count, last_error, last_attempt_at, backoff_until)
     VALUES (@id, @host, @cred, @proto, @porta, @validata, @il, @ordine, @auto, @nata, @falli, @errore, @tentata, @fermo)`,
  );
  riga.run({ id: 5, host: 1, cred: 1, proto: "winrm", porta: 5985, validata: 1, il: "2026-10-01 08:00:00", ordine: 3, auto: 1, nata: "2026-01-02 03:04:05", falli: 0, errore: null, tentata: null, fermo: null });
  riga.run({ id: 9, host: 2, cred: 2, proto: "ssh", porta: 2222, validata: 0, il: null, ordine: 7, auto: 0, nata: "2026-02-03 04:05:06", falli: 4, errore: "Autenticazione rifiutata", tentata: "2026-11-01T10:00:00.000Z", fermo: "2099-01-01T00:00:00.000Z" });
  riga.run({ id: 12, host: 99, cred: 1, proto: "winrm", porta: 5986, validata: 1, il: "2026-09-09 09:09:09", ordine: 1, auto: 1, nata: "2026-03-04 05:06:07", falli: 1, errore: "Timeout", tentata: "2026-11-02T10:00:00.000Z", fermo: null });
  riga.run({ id: 40, host: 1, cred: 2, proto: "ssh", porta: 22, validata: 0, il: null, ordine: 9, auto: 0, nata: "2026-04-05 06:07:08", falli: 0, errore: null, tentata: null, fermo: null });
  d.prepare("DELETE FROM host_credentials WHERE id = 40").run();
  if (opzioni.conMotivo) d.prepare("UPDATE host_credentials SET motivo = 'diritti_mancanti' WHERE id = 9").run();

  const legame = d.prepare(
    `INSERT INTO device_credential_bindings
       (id, device_id, credential_id, protocol_type, port, sort_order, test_status, test_message, tested_at, auto_detected, created_at)
     VALUES (@id, 1, @cred, @proto, @porta, @ordine, @stato, @messaggio, @provato, @auto, @nato)`,
  );
  legame.run({ id: 3, cred: 1, proto: "winrm", porta: 5985, ordine: 2, stato: "success", messaggio: "WinRM funzionante", provato: "2026-10-02 08:00:00", auto: 1, nato: "2026-01-03 03:04:05" });
  legame.run({ id: 8, cred: 2, proto: "ssh", porta: 22, ordine: 5, stato: "failed", messaggio: "Rifiutata", provato: "2026-10-03 08:00:00", auto: 0, nato: "2026-01-04 03:04:05" });
  legame.run({ id: 30, cred: 2, proto: "ssh", porta: 2222, ordine: 6, stato: "untested", messaggio: null, provato: null, auto: 0, nato: "2026-01-05 03:04:05" });
  d.prepare("DELETE FROM device_credential_bindings WHERE id = 30").run();
  // Due inline uguali: con credential_id NULL il vincolo UNIQUE non le vede come doppione, una copia con DISTINCT o
  // con «INSERT OR IGNORE» su una chiave che tratta NULL come valore ne perderebbe una.
  const inline = d.prepare(
    `INSERT INTO device_credential_bindings (id, device_id, credential_id, protocol_type, port, inline_username, inline_encrypted_password)
     VALUES (?, 1, NULL, 'winrm', 5986, ?, ?)`,
  );
  for (const id of [10, 11]) inline.run(id, INLINE.username, INLINE.segreto);
  d.pragma("foreign_keys = ON");
}

/** Le due righe inline di `semina`, così come devono uscire dalla ricostruzione. */
function assertInlineIntatte(d: Database.Database): void {
  assert.deepEqual(
    d.prepare("SELECT id, credential_id, inline_username, inline_encrypted_password FROM device_credential_bindings WHERE credential_id IS NULL ORDER BY id").all(),
    [10, 11].map((id) => ({ id, credential_id: null, inline_username: INLINE.username, inline_encrypted_password: INLINE.segreto })),
  );
}

/** Un tenant su disco com'era prima: schema di oggi, salvo le due tabelle, poi chiuso. Lo apre `getTenantDb`. */
function tenantPrima(code: string, opzioni: { check?: string; conMotivo?: boolean } = {}): void {
  deleteTenantDatabase(code);
  const file = path.join(resolveDataDir(), "tenants", `${code}.db`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const d = new Database(file);
  d.pragma("foreign_keys = OFF");
  d.exec(TENANT_SCHEMA_SQL);
  d.exec(TENANT_INDEXES_SQL);
  d.exec("DROP TABLE host_credentials; DROP TABLE device_credential_bindings");
  const check = opzioni.check ?? CHECK_REDFISH;
  d.exec(hostCredentialsPrima(check, opzioni.conMotivo === true));
  d.exec(bindingPrima(check));
  for (const i of INDICI_PRIMA) d.exec(i);
  semina(d, { conMotivo: opzioni.conMotivo });
  d.close();
}

type Riga = Record<string, unknown>;

const righe = (d: Database.Database, tabella: string): Riga[] => d.prepare(`SELECT * FROM ${tabella} ORDER BY id`).all() as Riga[];

/** Le righe di una tabella prima di aprirla, senza passare da `getTenantDb`. */
function righeSuDisco(code: string, tabella: string): Riga[] {
  const d = new Database(path.join(resolveDataDir(), "tenants", `${code}.db`), { readonly: true });
  try {
    return righe(d, tabella);
  } finally {
    d.close();
  }
}

const contatore = (d: Database.Database, tabella: string): number =>
  (d.prepare("SELECT seq FROM sqlite_sequence WHERE name = ?").get(tabella) as { seq: number }).seq;

const forma = (d: Database.Database, tabella: string): unknown =>
  d.prepare(`SELECT name, type, "notnull", dflt_value, pk FROM pragma_table_info(?) ORDER BY cid`).all(tabella);

const indici = (d: Database.Database, tabella: string): string[] =>
  (d.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL ORDER BY name").all(tabella) as Array<{ name: string }>).map((r) => r.name);

/** Pagina radice e testo di ogni oggetto: una tabella ricostruita cambia pagina radice anche se il testo è uguale. */
const fotografia = (d: Database.Database): unknown =>
  d.prepare("SELECT type, name, rootpage, sql FROM sqlite_master WHERE tbl_name IN ('host_credentials', 'device_credential_bindings') ORDER BY type, name").all();

function conScritte<T>(fn: () => T): { valore: T; info: string[]; errori: string[] } {
  const info: string[] = [];
  const errori: string[] = [];
  const { info: origInfo, error: origError } = console;
  console.info = (...a: unknown[]) => void info.push(a.join(" "));
  console.error = (...a: unknown[]) => void errori.push(a.join(" "));
  try {
    return { valore: fn(), info, errori };
  } finally {
    console.info = origInfo;
    console.error = origError;
  }
}

/** Le due tabelle accettano `wmi`, un protocollo inventato no; il doppione resta vietato. */
function accettaWmi(d: Database.Database): void {
  d.prepare("INSERT INTO host_credentials (host_id, credential_id, protocol_type, port) VALUES (1, 1, 'wmi', 135)").run();
  d.prepare("INSERT INTO device_credential_bindings (device_id, credential_id, protocol_type, port) VALUES (1, 1, 'wmi', 135)").run();
  assert.throws(() => d.prepare("INSERT INTO host_credentials (host_id, credential_id, protocol_type, port) VALUES (1, 1, 'telnet', 23)").run(), /CHECK/);
  assert.throws(() => d.prepare("INSERT INTO device_credential_bindings (device_id, credential_id, protocol_type, port) VALUES (1, 1, 'telnet', 23)").run(), /CHECK/);
  assert.throws(() => d.prepare("INSERT INTO host_credentials (host_id, credential_id, protocol_type, port) VALUES (1, 1, 'wmi', 135)").run(), /UNIQUE/);
  assert.throws(() => d.prepare("INSERT INTO device_credential_bindings (device_id, credential_id, protocol_type, port) VALUES (1, 1, 'wmi', 135)").run(), /UNIQUE/);
}

const SENZA_MOTIVO = (r: Riga): Riga => Object.fromEntries(Object.entries(r).filter(([k]) => k !== "motivo"));

const creati: string[] = [];
function codice(nome: string): string {
  creati.push(nome);
  return nome;
}

after(() => {
  for (const c of creati) deleteTenantDatabase(c);
  closeHubDb();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

describe("apertura di un tenant di prima", () => {
  it("il CHECK con redfish rifiuta wmi: è il punto di partenza della prova", () => {
    const d = new Database(":memory:");
    d.pragma("foreign_keys = OFF");
    d.exec(hostCredentialsPrima(CHECK_REDFISH));
    assert.throws(() => d.prepare("INSERT INTO host_credentials (host_id, credential_id, protocol_type, port) VALUES (1, 1, 'wmi', 135)").run(), /CHECK/);
    d.close();
  });

  it("senza motivo: righe intatte colonna per colonna, wmi accettato, motivo NULL", () => {
    const c = codice("TESTWMIPRIMA");
    tenantPrima(c);
    const hostPrima = righeSuDisco(c, "host_credentials");
    const legamiPrima = righeSuDisco(c, "device_credential_bindings");
    assert.equal(hostPrima.length, 3);
    assert.equal(legamiPrima.length, 4);

    const d = getTenantDb(c);

    const hostDopo = righe(d, "host_credentials");
    assert.deepEqual(hostDopo.map(SENZA_MOTIVO), hostPrima);
    assert.ok(hostDopo.every((r) => r.motivo === null));
    assert.deepEqual(righe(d, "device_credential_bindings"), legamiPrima);
    assertInlineIntatte(d);
    accettaWmi(d);
  });

  it("il contatore AUTOINCREMENT non scende: un id cancellato non torna a un'altra riga", () => {
    const c = codice("TESTWMISEQ");
    tenantPrima(c);
    const d = getTenantDb(c);
    assert.equal(contatore(d, "host_credentials"), 40);
    assert.equal(contatore(d, "device_credential_bindings"), 30);
  });

  it("indici, forma della tabella e vincoli sono quelli di un tenant nuovo; nessuna tabella d'appoggio resta", () => {
    const vecchio = codice("TESTWMIFORMA");
    const nuovo = codice("TESTWMINUOVO1");
    tenantPrima(vecchio);
    deleteTenantDatabase(nuovo);
    const v = getTenantDb(vecchio);
    const n = getTenantDb(nuovo);
    for (const t of ["host_credentials", "device_credential_bindings"]) {
      assert.deepEqual(forma(v, t), forma(n, t), t);
      assert.deepEqual(indici(v, t), indici(n, t), t);
      assert.deepEqual(v.prepare(`PRAGMA foreign_key_list(${t})`).all(), n.prepare(`PRAGMA foreign_key_list(${t})`).all(), t);
    }
    assert.deepEqual(indici(v, "host_credentials"), ["idx_host_credentials_host", "idx_host_credentials_validated"]);
    assert.deepEqual(indici(v, "device_credential_bindings"), ["idx_dcb_credential", "idx_dcb_device"]);
    assert.deepEqual(v.prepare("SELECT name FROM sqlite_master WHERE name GLOB '*_wmi' OR name GLOB '*_v2'").all(), []);
    assert.equal(v.pragma("foreign_keys", { simple: true }), 1);
  });

  it("con motivo già presente: la ricostruzione lo porta con sé, valore compreso", () => {
    const c = codice("TESTWMICONMOTIVO");
    tenantPrima(c, { conMotivo: true });
    const prima = righeSuDisco(c, "host_credentials");
    assert.equal(prima.find((r) => r.id === 9)?.motivo, "diritti_mancanti");

    const d = getTenantDb(c);

    assert.deepEqual(righe(d, "host_credentials"), prima);
    accettaWmi(d);
  });

  it("col CHECK più vecchio, senza redfish: passa dalle due ricostruzioni e arriva allo stesso punto", () => {
    const c = codice("TESTWMIVECCHIO");
    tenantPrima(c, { check: CHECK_VECCHISSIMO });
    const hostPrima = righeSuDisco(c, "host_credentials");
    const legamiPrima = righeSuDisco(c, "device_credential_bindings");

    const d = getTenantDb(c);

    assert.deepEqual(righe(d, "host_credentials").map(SENZA_MOTIVO), hostPrima);
    assert.deepEqual(righe(d, "device_credential_bindings"), legamiPrima);
    assertInlineIntatte(d);
    d.prepare("INSERT INTO host_credentials (host_id, credential_id, protocol_type, port) VALUES (2, 1, 'redfish', 443)").run();
    accettaWmi(d);
  });

  it("CHECK già con wmi ma senza motivo: si aggiunge la colonna, nessuna ricostruzione", () => {
    const c = codice("TESTWMIMEZZO");
    tenantPrima(c, { check: `${CHECK_REDFISH}, 'wmi'` });
    const prima = righeSuDisco(c, "host_credentials");
    const { valore: d, info } = conScritte(() => getTenantDb(c));
    assert.deepEqual(righe(d, "host_credentials").map(SENZA_MOTIVO), prima);
    assert.ok(righe(d, "host_credentials").every((r) => "motivo" in r));
    assert.deepEqual(info.filter((m) => m.includes("(+ wmi)")), []);
  });

  it("il secondo avvio non fa niente: stesse pagine radice, stesse righe, nessun messaggio", () => {
    const c = codice("TESTWMIDUEVOLTE");
    tenantPrima(c);
    const d1 = getTenantDb(c);
    accettaWmi(d1);
    d1.prepare("UPDATE host_credentials SET motivo = 'firewall' WHERE id = 5").run();
    const foto = fotografia(d1);
    const hostPrima = righe(d1, "host_credentials");
    const legamiPrima = righe(d1, "device_credential_bindings");
    closeTenantDb(c);

    const { valore: d2, info, errori } = conScritte(() => getTenantDb(c));

    assert.deepEqual(fotografia(d2), foto);
    assert.deepEqual(righe(d2, "host_credentials"), hostPrima);
    assert.deepEqual(righe(d2, "device_credential_bindings"), legamiPrima);
    assert.deepEqual(info.filter((m) => m.includes("wmi") || m.includes("motivo")), []);
    assert.deepEqual(errori.filter((m) => m.includes("wmi") || m.includes("motivo")), []);
  });

  it("un tenant nuovo nasce già con wmi e motivo: la ricostruzione non scatta", () => {
    const c = codice("TESTWMINUOVO2");
    deleteTenantDatabase(c);
    const { valore: d, info } = conScritte(() => getTenantDb(c));
    assert.deepEqual(info.filter((m) => m.includes("wmi") || m.includes("motivo")), []);
    assert.equal(migraProtocolloWmi(d, "host_credentials"), false);
    assert.equal(migraProtocolloWmi(d, "device_credential_bindings"), false);
    assert.equal(assicuraColonnaMotivoCredenziali(d), false);
    for (const t of ["host_credentials", "device_credential_bindings"]) {
      assert.match((d.prepare("SELECT sql FROM sqlite_master WHERE name = ?").get(t) as { sql: string }).sql, /'wmi'/, t);
    }
  });

  it("una migrazione che non riesce lascia la tabella com'era e il tenant si apre lo stesso", () => {
    const c = codice("TESTWMIIGNOTA");
    tenantPrima(c);
    const file = path.join(resolveDataDir(), "tenants", `${c}.db`);
    const raw = new Database(file);
    raw.exec("ALTER TABLE host_credentials ADD COLUMN colonna_di_qualcuno TEXT");
    raw.close();
    const prima = righeSuDisco(c, "host_credentials");

    const { valore: d, errori } = conScritte(() => getTenantDb(c));

    assert.ok(errori.some((m) => m.includes("colonna_di_qualcuno")), errori.join("\n"));
    assert.deepEqual(righe(d, "host_credentials").map(SENZA_MOTIVO), prima);
    assert.equal(d.pragma("foreign_keys", { simple: true }), 1);
    assert.throws(() => d.prepare("INSERT INTO host_credentials (host_id, credential_id, protocol_type, port) VALUES (1, 1, 'wmi', 135)").run(), /CHECK/);
    // L'altra tabella va avanti da sola: un guasto non ne ferma due.
    d.prepare("INSERT INTO device_credential_bindings (device_id, credential_id, protocol_type, port) VALUES (1, 1, 'wmi', 135)").run();
  });
});

describe("ricostruzione a mano, per i casi che un tenant vero non dà", () => {
  function inMemoria(ddlHost: string): Database.Database {
    const d = new Database(":memory:");
    d.exec("CREATE TABLE hosts (id INTEGER PRIMARY KEY); CREATE TABLE credentials (id INTEGER PRIMARY KEY); CREATE TABLE network_devices (id INTEGER PRIMARY KEY)");
    d.exec("INSERT INTO hosts VALUES (1); INSERT INTO credentials VALUES (1); INSERT INTO network_devices VALUES (1)");
    d.exec(ddlHost);
    d.exec(bindingPrima(CHECK_REDFISH));
    return d;
  }

  const LEGACY = `CREATE TABLE host_credentials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    host_id INTEGER NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
    credential_id INTEGER NOT NULL REFERENCES credentials(id) ON DELETE CASCADE,
    protocol_type TEXT NOT NULL CHECK(protocol_type IN (${CHECK_REDFISH})),
    port INTEGER NOT NULL,
    validated INTEGER NOT NULL DEFAULT 0,
    validated_at TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    auto_detected INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  )`;

  it("senza la colonna motivo e senza le colonne dei fallimenti (forma del path legacy): si copia ciò che c'è", () => {
    const d = inMemoria(LEGACY);
    d.exec("CREATE UNIQUE INDEX idx_host_credentials_unique ON host_credentials(host_id, credential_id, protocol_type, port)");
    d.prepare("INSERT INTO host_credentials (id, host_id, credential_id, protocol_type, port, validated, sort_order) VALUES (7, 1, 1, 'winrm', 5985, 1, 4)").run();

    assert.equal(migraProtocolloWmi(d, "host_credentials"), true);

    const [r] = righe(d, "host_credentials");
    assert.equal(r.id, 7);
    assert.equal(r.validated, 1);
    assert.equal(r.sort_order, 4);
    assert.equal(r.fail_count, 0);
    assert.equal(r.motivo, null);
    assert.deepEqual(indici(d, "host_credentials"), ["idx_host_credentials_unique"]);
    d.close();
  });

  it("indici e trigger che lo schema non conosce tornano tali e quali", () => {
    const d = inMemoria(hostCredentialsPrima(CHECK_REDFISH));
    d.exec("CREATE TABLE conta (n INTEGER); INSERT INTO conta VALUES (0)");
    d.exec("CREATE INDEX idx_di_qualcuno ON host_credentials(port) WHERE port > 1000");
    d.exec("CREATE TRIGGER trg_di_qualcuno AFTER INSERT ON host_credentials BEGIN UPDATE conta SET n = n + 1; END");

    assert.equal(migraProtocolloWmi(d, "host_credentials"), true);

    assert.deepEqual(indici(d, "host_credentials"), ["idx_di_qualcuno"]);
    d.prepare("INSERT INTO host_credentials (host_id, credential_id, protocol_type, port) VALUES (1, 1, 'wmi', 135)").run();
    assert.deepEqual(d.prepare("SELECT n FROM conta").get(), { n: 1 });
    d.close();
  });

  it("se la copia non riesce la transazione torna indietro: tabella, righe e foreign_keys come prima", () => {
    // Forma di prima senza UNIQUE: due righe uguali passano qui e fanno fallire la copia nella tabella nuova.
    const d = inMemoria(hostCredentialsPrima(CHECK_REDFISH).replace(",\n    UNIQUE(host_id, credential_id, protocol_type, port)", ""));
    const ins = d.prepare("INSERT INTO host_credentials (host_id, credential_id, protocol_type, port) VALUES (1, 1, 'winrm', 5985)");
    ins.run();
    ins.run();
    const sql = d.prepare("SELECT sql FROM sqlite_master WHERE name = 'host_credentials'").get();
    const prima = righe(d, "host_credentials");

    assert.throws(() => migraProtocolloWmi(d, "host_credentials"), /UNIQUE/);

    assert.deepEqual(d.prepare("SELECT sql FROM sqlite_master WHERE name = 'host_credentials'").get(), sql);
    assert.deepEqual(righe(d, "host_credentials"), prima);
    assert.equal(d.prepare("SELECT 1 FROM sqlite_master WHERE name = 'host_credentials_wmi'").get(), undefined);
    assert.equal(d.pragma("foreign_keys", { simple: true }), 1);
    d.close();
  });

  it("un guasto dopo il DROP torna indietro: la RENAME fallisce e righe, sql e contatore restano", () => {
    const d = inMemoria(hostCredentialsPrima(CHECK_REDFISH));
    const ins = d.prepare("INSERT INTO host_credentials (id, host_id, credential_id, protocol_type, port) VALUES (?, 1, 1, 'winrm', ?)");
    ins.run(7, 5985);
    ins.run(21, 5986);
    d.prepare("DELETE FROM host_credentials WHERE id = 21").run();
    // Dopo il DROP la vista punta al vuoto, e SQLite rifiuta la RENAME perché non riesce a riscriverla.
    d.exec("CREATE VIEW vista_di_qualcuno AS SELECT id, port FROM host_credentials");
    const sql = d.prepare("SELECT sql FROM sqlite_master WHERE name = 'host_credentials'").get();
    const prima = righe(d, "host_credentials");

    assert.throws(() => migraProtocolloWmi(d, "host_credentials"), /vista_di_qualcuno.*no such table: main\.host_credentials/);

    assert.deepEqual(d.prepare("SELECT sql FROM sqlite_master WHERE name = 'host_credentials'").get(), sql);
    assert.deepEqual(righe(d, "host_credentials"), prima);
    assert.deepEqual(d.prepare("SELECT id, port FROM vista_di_qualcuno").all(), [{ id: 7, port: 5985 }]);
    assert.equal(contatore(d, "host_credentials"), 21);
    assert.equal(d.prepare("SELECT 1 FROM sqlite_master WHERE name = 'host_credentials_wmi'").get(), undefined);
    assert.equal(d.pragma("foreign_keys", { simple: true }), 1);
    d.close();
  });

  it("una colonna che la copia non conosce ferma tutto: si perderebbe in silenzio", () => {
    const d = inMemoria(hostCredentialsPrima(CHECK_REDFISH));
    d.exec("ALTER TABLE device_credential_bindings ADD COLUMN colonna_di_qualcuno TEXT");
    assert.throws(() => migraProtocolloWmi(d, "device_credential_bindings"), /colonna_di_qualcuno/);
    assert.ok(indici(d, "device_credential_bindings").length === 0);
    assert.ok((d.prepare("SELECT sql FROM sqlite_master WHERE name = 'device_credential_bindings'").get() as { sql: string }).sql.includes("'onvif'"));
    d.close();
  });

  it("assicuraColonnaMotivoCredenziali: aggiunge una volta sola, su una tabella assente non fa niente", () => {
    const d = inMemoria(hostCredentialsPrima(CHECK_REDFISH));
    assert.equal(assicuraColonnaMotivoCredenziali(d), true);
    assert.equal(assicuraColonnaMotivoCredenziali(d), false);
    d.exec("DROP TABLE host_credentials");
    assert.equal(assicuraColonnaMotivoCredenziali(d), false);
    d.close();
  });
});

describe("path legacy (ipam.db)", () => {
  it("un ipam.db dal modello con il CHECK più vecchio arriva a wmi e motivo aprendolo con getDb", () => {
    const cartella = fs.mkdtempSync(path.join(TEST_DATA_DIR, "legacy-"));
    const file = path.join(cartella, "ipam.db");
    fs.copyFileSync(path.join(process.cwd(), "data", "ipam.empty.db"), file);
    const raw = new Database(file);
    raw.pragma("foreign_keys = OFF");
    assert.ok(!(raw.prepare("SELECT sql FROM sqlite_master WHERE name = 'device_credential_bindings'").get() as { sql: string }).sql.includes("'wmi'"));
    // Il modello è più vecchio di host_credentials: la tabella si scrive com'era quando è nata, col CHECK di allora.
    raw.exec(`CREATE TABLE host_credentials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      host_id INTEGER NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
      credential_id INTEGER NOT NULL REFERENCES credentials(id) ON DELETE CASCADE,
      protocol_type TEXT NOT NULL CHECK(protocol_type IN (${CHECK_VECCHISSIMO})),
      port INTEGER NOT NULL,
      validated INTEGER NOT NULL DEFAULT 0,
      validated_at TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      auto_detected INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(host_id, credential_id, protocol_type, port)
    )`);
    raw.prepare("INSERT INTO networks (id, cidr, name) VALUES (1, '10.71.0.0/24', 'rete-legacy')").run();
    raw.prepare("INSERT INTO hosts (id, network_id, ip) VALUES (1, 1, '10.71.0.5')").run();
    raw.prepare("INSERT INTO credentials (id, name, credential_type) VALUES (1, 'voce-windows', 'windows')").run();
    raw.prepare("INSERT INTO host_credentials (id, host_id, credential_id, protocol_type, port, validated, sort_order) VALUES (6, 1, 1, 'winrm', 5985, 1, 3)").run();
    raw.prepare("INSERT INTO network_devices (id, name, host, device_type, vendor, protocol) VALUES (1, 'server-legacy', '10.71.0.5', 'router', 'windows', 'winrm')").run();
    const inline = raw.prepare(
      `INSERT INTO device_credential_bindings (id, device_id, credential_id, protocol_type, port, inline_username, inline_encrypted_password)
       VALUES (?, 1, NULL, 'winrm', 5986, ?, ?)`,
    );
    for (const id of [10, 11]) inline.run(id, INLINE.username, INLINE.segreto);
    raw.close();

    const programma = `
      const { getDb } = require("@/lib/db");
      const d = getDb();
      d.prepare("INSERT INTO host_credentials (host_id, credential_id, protocol_type, port) VALUES (1, 1, 'wmi', 135)").run();
      const righe = d.prepare("SELECT id, protocol_type, validated, sort_order, motivo FROM host_credentials ORDER BY id").all();
      const legami = d.prepare("SELECT id, credential_id, inline_username, inline_encrypted_password FROM device_credential_bindings ORDER BY id").all();
      process.stdout.write("ESITO" + JSON.stringify({ righe, legami }));
    `;
    const uscita = execFileSync(process.execPath, ["--import", "tsx", "-e", programma], {
      cwd: process.cwd(),
      env: { ...process.env, DA_INVENT_DATA_DIR: cartella, DA_IPAM_DB_PATH: file },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    assert.deepEqual(JSON.parse(uscita.slice(uscita.indexOf("ESITO") + 5)), {
      righe: [
        { id: 6, protocol_type: "winrm", validated: 1, sort_order: 3, motivo: null },
        { id: 7, protocol_type: "wmi", validated: 0, sort_order: 0, motivo: null },
      ],
      legami: [10, 11].map((id) => ({ id, credential_id: null, inline_username: INLINE.username, inline_encrypted_password: INLINE.segreto })),
    });
  });
});

describe("regola tipo ↔ protocollo", () => {
  it("wmi: voci windows, porta 135, nome WMI", () => {
    assert.equal(DEFAULT_PORTS.wmi, 135);
    assert.deepEqual(tipiPerProtocollo("wmi"), ["windows"]);
    assert.equal(etichettaProtocollo("wmi"), "WMI");
    assert.equal(portaVoceValePer("windows", "wmi"), false);
  });

  it("una voce non Windows non si lega a wmi; una Windows sì", () => {
    assert.match(erroreVocePerProtocollo(1, { name: "voce-ad", credential_type: "ad" }, "wmi") ?? "", /non vale per WMI/);
    assert.match(erroreVocePerProtocollo(1, { name: "voce-ssh", credential_type: "ssh" }, "wmi") ?? "", /non vale per WMI/);
    assert.equal(erroreVocePerProtocollo(1, { name: "voce-win", credential_type: "windows" }, "wmi"), null);
  });

  it("un binding inline wmi è di tipo windows, non ssh", () => {
    const e = leggiSegretoInline({ protocol_type: "wmi", inline_username: "dominio\\scansioni", inline_encrypted_password: encrypt("segreto-di-prova") });
    assert.equal(e.ok && e.tipo, "windows");
  });
});

describe("motore delle credenziali", () => {
  function tenantConApparato(codiceTenant: string, protocollo: string): { d: Database.Database; deviceId: number; voce: number } {
    deleteTenantDatabase(codiceTenant);
    const d = getTenantDb(codice(codiceTenant));
    const voce = Number(
      d.prepare("INSERT INTO credentials (name, credential_type, encrypted_username, encrypted_password) VALUES ('voce-windows', 'windows', ?, ?)")
        .run(encrypt("scansioni"), encrypt("segreto-di-prova")).lastInsertRowid,
    );
    const deviceId = Number(
      d.prepare("INSERT INTO network_devices (name, host, device_type, vendor, protocol, port) VALUES ('pc-prova', '10.72.0.5', 'server', 'windows', ?, 5985)")
        .run(protocollo).lastInsertRowid,
    );
    return { d, deviceId, voce };
  }

  const lega = (d: Database.Database, deviceId: number, voce: number, proto: string, porta: number, stato = "success") =>
    d.prepare("INSERT INTO device_credential_bindings (device_id, credential_id, protocol_type, port, test_status) VALUES (?, ?, ?, ?, ?)").run(deviceId, voce, proto, porta, stato);

  const apparato = (id: number, protocol: "winrm" | "ssh") => ({ id, name: "pc-prova", protocol, port: 5985, voci_provvisorie: undefined });

  it("apparato winrm con il solo legame wmi: loginApparatoDb dà l'accesso", () => {
    const { d, deviceId, voce } = tenantConApparato("TESTWMILOGIN", "winrm");
    assert.equal(loginApparatoDb(d, apparato(deviceId, "winrm")), null);
    lega(d, deviceId, voce, "wmi", 135);
    const accesso = loginApparatoDb(d, apparato(deviceId, "winrm"));
    assert.equal(accesso?.username, "scansioni");
    assert.equal(accesso?.password, "segreto-di-prova");
  });

  it("col legame winrm buono si usa quello: wmi resta il ripiego", () => {
    const { d, deviceId, voce } = tenantConApparato("TESTWMILOGIN2", "winrm");
    const altra = Number(
      d.prepare("INSERT INTO credentials (name, credential_type, encrypted_username, encrypted_password) VALUES ('voce-winrm', 'windows', ?, ?)")
        .run(encrypt("amministratore"), encrypt("altro-segreto")).lastInsertRowid,
    );
    lega(d, deviceId, voce, "wmi", 135);
    lega(d, deviceId, altra, "winrm", 5985);
    assert.equal(loginApparatoDb(d, apparato(deviceId, "winrm"))?.username, "amministratore");
  });

  it("la conversione della 2e, che passa le sue fonti, non arriva al legame wmi: ricostruisce la scelta di allora", () => {
    const { d, deviceId, voce } = tenantConApparato("TESTWMIFONTI", "winrm");
    lega(d, deviceId, voce, "wmi", 135);
    assert.equal(sceltaLoginApparatoDb(d, apparato(deviceId, "winrm"), { registra: false, fonti: FONTI_ACQUISIZIONE }).ok, false);
  });

  it("un legame wmi fallito non vale", () => {
    const { d, deviceId, voce } = tenantConApparato("TESTWMILOGIN3", "winrm");
    lega(d, deviceId, voce, "wmi", 135, "failed");
    assert.equal(loginApparatoDb(d, apparato(deviceId, "winrm")), null);
  });

  it("un apparato non winrm non prende il legame wmi", () => {
    const { d, deviceId, voce } = tenantConApparato("TESTWMILOGIN4", "ssh");
    lega(d, deviceId, voce, "wmi", 135);
    assert.equal(loginApparatoDb(d, apparato(deviceId, "ssh")), null);
  });

  it("«usata adesso» dice WMI e la 135, non WinRM", () => {
    const { d, deviceId, voce } = tenantConApparato("TESTWMIUSATA", "winrm");
    lega(d, deviceId, voce, "wmi", 135);
    const [r] = usataAdessoDb(d, deviceId);
    assert.equal(r.protocollo, "wmi");
    assert.equal(r.porta, 135);
    assert.equal(r.credential_id, voce);
  });

  it("il motore legge il segreto di una voce windows sul protocollo wmi", () => {
    const { d, deviceId, voce } = tenantConApparato("TESTWMISEGRETO", "winrm");
    lega(d, deviceId, voce, "wmi", 135);
    const s = scegliSegretoApparatoDb(d, deviceId, "wmi", { registra: false });
    assert.equal(s.ok, true, s.ok ? "" : s.motivo);
    assert.equal(s.ok && s.candidato.port, 135);
  });

  it("una voce Windows sulla 5986 resta sulla 135 per WMI: la riga dell'host e il suo backoff sono sulla 135", () => {
    const { d, voce } = tenantConApparato("TESTWMIPORTA", "winrm");
    d.prepare("UPDATE credentials SET port = 5986 WHERE id = ?").run(voce);
    d.prepare("INSERT INTO networks (id, cidr, name) VALUES (1, '10.72.0.0/24', 'rete-porta')").run();
    d.prepare("INSERT INTO hosts (id, network_id, ip) VALUES (1, 1, '10.72.0.9')").run();
    d.prepare("INSERT INTO network_credentials (network_id, credential_id, sort_order) VALUES (1, ?, 0)").run(voce);

    assert.deepEqual(resolveCredentialsForDb(d, { hostId: 1, networkId: 1 }, "wmi").map((c) => c.port), [135]);
    assert.deepEqual(resolveCredentialsForDb(d, { hostId: 1, networkId: 1 }, "winrm").map((c) => c.port), [5986]);
    assert.equal(portaBinding({ protocol: "winrm", port: 5985 }, "wmi", { credential_type: "windows", port: 5986 }), 135);
  });

  it("una voce nata da un binding wmi è Windows, non API", () => {
    const { d, deviceId } = tenantConApparato("TESTWMIVOCE", "winrm");
    const { voce } = nuovaVoceEBindingDb(d, deviceId, "wmi", 135, { username: "scansioni", password: "segreto-di-prova" });
    assert.deepEqual(d.prepare("SELECT credential_type FROM credentials WHERE id = ?").get(voce.id), { credential_type: "windows" });
  });

  it("la conversione degli inline non si ferma su un binding wmi e ne fa una voce Windows", () => {
    const { d, deviceId } = tenantConApparato("TESTWMICONVERTI", "winrm");
    d.prepare("INSERT INTO device_credential_bindings (device_id, credential_id, protocol_type, port, inline_username, inline_encrypted_password) VALUES (?, NULL, 'wmi', 135, 'scansioni', ?)")
      .run(deviceId, encrypt("segreto-di-prova"));
    convertiCredenzialiApparati(d, { aVuoto: false });
    const r = d.prepare(
      `SELECT c.credential_type FROM device_credential_bindings b JOIN credentials c ON c.id = b.credential_id
       WHERE b.device_id = ? AND b.protocol_type = 'wmi'`,
    ).get(deviceId);
    assert.deepEqual(r, { credential_type: "windows" });
  });

  // Task 8 del piano accesso Windows (04/11/2026): la prova del legame WMI ora esiste (query di identità, come la scansione).
  // Prima rispondeva «non disponibile»; la prova di quel comportamento è invertita di proposito, con una prova finta: niente rete.
  it("la prova del binding wmi è disponibile: usa la query di identità, non risponde «non disponibile»", async () => {
    const chiamate: string[] = [];
    const esito = await provaBinding(
      "10.72.0.5",
      { protocol_type: "wmi", port: 135, credential_id: null, inline_username: "scansioni", inline_encrypted_password: encrypt("segreto-di-prova") },
      "2c",
      { wmiIdentita: async (host) => { chiamate.push(host); return { hostname: "PC", dominio: null }; } },
    );
    assert.equal(esito.success, true);
    assert.equal(esito.nonDisponibile, undefined);
    assert.deepEqual(chiamate, ["10.72.0.5"]);
  });
});

describe("copertura delle credenziali", () => {
  it("un PC entrato solo via WMI è coperto, e l'etichetta del protocollo atteso non cambia", () => {
    const c = codice("TESTWMICOPERTURA");
    deleteTenantDatabase(c);
    const d = getTenantDb(c);
    d.prepare("INSERT INTO networks (id, cidr, name) VALUES (1, '10.73.0.0/24', 'rete-copertura')").run();
    d.prepare("INSERT INTO hosts (id, network_id, ip, attr_category) VALUES (1, 1, '10.73.0.5', 'compute.workstation')").run();
    d.prepare("INSERT INTO credentials (id, name, credential_type) VALUES (1, 'voce-windows', 'windows')").run();
    d.prepare("INSERT INTO host_credentials (host_id, credential_id, protocol_type, port, validated) VALUES (1, 1, 'wmi', 135, 1)").run();
    const riga = withTenant(c, () => getCredentialCoverageByCategory()).find((r) => r.category === "compute.workstation");
    assert.equal(riga?.withValidCredential, 1);
    assert.equal(riga?.expectedProtocol, "winrm");
  });
});
