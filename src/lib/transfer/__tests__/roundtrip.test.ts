// src/lib/transfer/__tests__/roundtrip.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { TENANT_SCHEMA_SQL, TENANT_INDEXES_SQL } from "../../db-tenant-schema";
import { HUB_SCHEMA_SQL } from "../../db-hub-schema";
import { rekeyColumns } from "../schema-introspect";
import { tableSpec } from "../table-registry";

function freshTenant(): Database.Database {
  const d = new Database(":memory:");
  d.exec(TENANT_SCHEMA_SQL);
  d.exec(TENANT_INDEXES_SQL);
  return d;
}

function freshHub(): Database.Database {
  const d = new Database(":memory:");
  d.exec(HUB_SCHEMA_SQL);
  return d;
}

test("export con chiave A → import con chiave B: secret decifrabili, conteggi coerenti", async () => {
  // --- Installazione SORGENTE, chiave A ---
  process.env.ENCRYPTION_KEY = "A".repeat(64);
  // import dinamico DOPO aver settato la env (i moduli leggono process.env al volo)
  const { exportTenant } = await import("../export");
  const cryptoA = await import("@/lib/crypto");

  const srcTenant = freshTenant();
  const srcHub = freshHub();
  srcTenant.prepare("INSERT INTO networks (cidr, name) VALUES (?, ?)").run("10.0.0.0/24", "LAN");
  srcTenant.prepare(
    "INSERT INTO credentials (name, credential_type, encrypted_username, encrypted_password) VALUES (?,?,?,?)",
  ).run("ssh-root", "ssh", cryptoA.encrypt("root"), cryptoA.encrypt("p@ss"));

  const bundle = exportTenant({
    tenantDb: srcTenant, hubDb: srcHub,
    options: {
      tenantCode: "DEFAULT", tiers: ["asset", "mirror"], includeVault: false,
      passphrase: "trasporto-123", exportedAt: "2026-06-25T10:00:00.000Z", appVersion: "test",
    },
  });
  assert.ok(bundle.length > 0);

  // --- Installazione DESTINAZIONE, chiave B (diversa) ---
  process.env.ENCRYPTION_KEY = "B".repeat(64);
  const { importTenant } = await import("../import");
  const cryptoB = await import("@/lib/crypto");

  const dstTenant = freshTenant();
  // FK enforcement ON prima dell'import: verifica che importTenant gestisca il toggle FK fuori dalla transazione
  dstTenant.pragma("foreign_keys = ON");
  const dstHub = freshHub();
  const res = importTenant({
    bundle, tenantDb: dstTenant, hubDb: dstHub,
    options: { tenantCode: "DEFAULT", passphrase: "trasporto-123", wipe: false },
  });

  // conteggi
  assert.equal(res.tables.networks, 1);
  assert.equal(res.tables.credentials, 1);
  assert.equal(res.rekeyedSecrets, 2);

  // il secret è ora cifrato con la chiave B e decifrabile con essa
  const cred = dstTenant.prepare("SELECT encrypted_username, encrypted_password FROM credentials").get() as {
    encrypted_username: string; encrypted_password: string;
  };
  assert.equal(cryptoB.decrypt(cred.encrypted_username), "root");
  assert.equal(cryptoB.decrypt(cred.encrypted_password), "p@ss");

  // integrità
  assert.equal(dstTenant.pragma("integrity_check", { simple: true }), "ok");
});

test("passphrase errata → import fallisce", async () => {
  process.env.ENCRYPTION_KEY = "A".repeat(64);
  const { exportTenant } = await import("../export");
  const { importTenant } = await import("../import");
  const src = freshTenant(); const srcHub = freshHub();
  src.prepare("INSERT INTO networks (cidr, name) VALUES (?, ?)").run("10.0.0.0/24", "LAN");
  const bundle = exportTenant({
    tenantDb: src, hubDb: srcHub,
    options: { tenantCode: "DEFAULT", tiers: [], includeVault: false, passphrase: "giusta", exportedAt: "2026-06-25T10:00:00.000Z", appVersion: "test" },
  });
  const dst = freshTenant(); const dstHub = freshHub();
  assert.throws(() => importTenant({
    bundle, tenantDb: dst, hubDb: dstHub,
    options: { tenantCode: "DEFAULT", passphrase: "SBAGLIATA", wipe: false },
  }), /Passphrase errata/);
});

test("network_devices cross-key: community_string + api_token + encrypted_password ri-cifrati con chiave B", async () => {
  // --- Installazione SORGENTE, chiave A ---
  process.env.ENCRYPTION_KEY = "A".repeat(64);
  const { exportTenant: exportA } = await import("../export");
  const cryptoA = await import("@/lib/crypto");

  const srcTenant = freshTenant();
  const srcHub = freshHub();
  srcTenant.prepare(
    `INSERT INTO network_devices
      (name, host, device_type, vendor, protocol, community_string, api_token, encrypted_password)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    "sw-core", "10.0.0.1", "switch", "hp", "snmp_v2",
    cryptoA.encrypt("public-snmp"),
    cryptoA.encrypt("tok-123"),
    cryptoA.encrypt("devpass"),
  );

  const bundle = exportA({
    tenantDb: srcTenant, hubDb: srcHub,
    options: {
      tenantCode: "DEFAULT", tiers: [], includeVault: false,
      passphrase: "x-key-test", exportedAt: "2026-06-26T00:00:00.000Z", appVersion: "test",
    },
  });

  // --- Installazione DESTINAZIONE, chiave B ---
  process.env.ENCRYPTION_KEY = "B".repeat(64);
  const { importTenant: importB } = await import("../import");
  const cryptoB = await import("@/lib/crypto");

  const dstTenant = freshTenant();
  dstTenant.pragma("foreign_keys = ON");
  const dstHub = freshHub();

  const res = importB({
    bundle, tenantDb: dstTenant, hubDb: dstHub,
    options: { tenantCode: "DEFAULT", passphrase: "x-key-test", wipe: false },
  });

  // deve aver ri-cifrato i 3 campi secret della riga
  assert.equal(res.tables.network_devices, 1, "riga importata");
  assert.ok(res.rekeyedSecrets >= 3, `rekeyedSecrets deve essere >= 3, got ${res.rekeyedSecrets}`);

  const row = dstTenant.prepare(
    "SELECT community_string, api_token, encrypted_password FROM network_devices",
  ).get() as { community_string: string; api_token: string; encrypted_password: string };

  assert.equal(cryptoB.decrypt(row.community_string), "public-snmp", "community_string decifrabile con chiave B");
  assert.equal(cryptoB.decrypt(row.api_token), "tok-123", "api_token decifrabile con chiave B");
  assert.equal(cryptoB.decrypt(row.encrypted_password), "devpass", "encrypted_password decifrabile con chiave B");

  assert.equal(dstTenant.pragma("integrity_check", { simple: true }), "ok");
});

test("guard: ogni colonna cifrata nota è nel rekey-set effettivo (heuristic ∪ secretColumns)", () => {
  // Le colonne cifrate complete del progetto: (table, column)
  const knownSecrets: Array<{ table: string; col: string; hub?: boolean }> = [
    { table: "credentials", col: "encrypted_username" },
    { table: "credentials", col: "encrypted_password" },
    { table: "network_devices", col: "encrypted_password" },
    { table: "network_devices", col: "community_string" },   // miss heuristic → secretColumns
    { table: "network_devices", col: "api_token" },           // miss heuristic → secretColumns
    { table: "device_credential_bindings", col: "inline_encrypted_password" },
    { table: "ad_integrations", col: "encrypted_username" },
    { table: "ad_integrations", col: "encrypted_password" },
    { table: "vuln_scanners", col: "token_encrypted" },
    { table: "system_credentials", col: "password_enc", hub: true },
    { table: "system_credentials", col: "api_token_enc", hub: true },
    { table: "system_credentials", col: "extra_json_enc", hub: true },
    { table: "tenants", col: "agent_token_encrypted", hub: true },
  ];

  const tenantDb = freshTenant();
  const hubDb = freshHub();

  for (const { table, col, hub } of knownSecrets) {
    const db = hub ? hubDb : tenantDb;
    const spec = tableSpec(table);
    const effective = new Set([
      ...rekeyColumns(db, table),
      ...((spec?.secretColumns ?? []).filter(() => true)),
    ]);
    assert.ok(
      effective.has(col),
      `REKEY MISS: ${table}.${col} non è nel rekey-set effettivo — aggiungere a secretColumns o rinominare la colonna`,
    );
  }
});


// Tappa 2c credenziali (T11): un bundle esportato prima della 2c porta voci
// `linux` e il segno `credenziali_t2_tipi` della sorgente (o nessuno). Un import
// con cancellazione sostituisce tenant_settings col contenuto del bundle, quindi
// il segno: l'import normalizza i tipi direttamente e riscrive il segno con
// l'esito, che si legge anche nella risposta. Senza, all'apertura dopo la
// conversione non ripartirebbe (segno del bundle) e resterebbero voci `linux`.
test("import di un bundle di prima della 2c: linux → ssh, segno riscritto, esito nella risposta", async () => {
  process.env.ENCRYPTION_KEY = "A".repeat(64);
  const { exportTenant } = await import("../export");
  const { importTenant } = await import("../import");
  const cryptoA = await import("@/lib/crypto");
  const src = freshTenant();
  src.prepare("INSERT INTO credentials (name, credential_type, encrypted_username, encrypted_password) VALUES (?, ?, ?, ?)").run(
    "Server Linux", "linux", cryptoA.encrypt("root"), cryptoA.encrypt("p"),
  );
  src.prepare("INSERT INTO tenant_settings (key, value) VALUES ('credenziali_t2_tipi', 'done:2026-01-01T00:00:00.000Z:dal-bundle')").run();
  const bundle = exportTenant({
    tenantDb: src, hubDb: freshHub(),
    options: { tenantCode: "DEFAULT", tiers: [], includeVault: false, passphrase: "trasporto-2c", exportedAt: "2026-10-16T10:00:00.000Z", appVersion: "test" },
  });
  const dst = freshTenant();
  const res = importTenant({ bundle, tenantDb: dst, hubDb: freshHub(), options: { tenantCode: "DEFAULT", passphrase: "trasporto-2c", wipe: true } });

  assert.equal((dst.prepare("SELECT credential_type FROM credentials").get() as { credential_type: string }).credential_type, "ssh");
  const segno = (dst.prepare("SELECT value FROM tenant_settings WHERE key = 'credenziali_t2_tipi'").get() as { value: string }).value;
  assert.match(segno, /^done:.*linux_ssh=1/);
  assert.notEqual(segno, "done:2026-01-01T00:00:00.000Z:dal-bundle");
  assert.equal(res.conversioni.credenziali_t2_tipi?.segno, segno);
  assert.match(res.conversioni.credenziali_t2_tipi?.dettaglio ?? "", /linux → ssh 1/);
});

// Tappa 2d credenziali (T16): un bundle esportato prima della 2d porta le
// catene vecchie per ruolo e nessun segno `credenziali_t2_catene` (o uno
// `errore:`, se la conversione della sorgente era fallita). Un import con
// cancellazione sostituisce tenant_settings col bundle: l'import converte le
// catene direttamente, senza chiavi dell'hub (gli id dell'hub di destinazione
// non dicono niente sul bundle), e riscrive il segno con l'esito, che va anche
// nella risposta.
for (const segnoSorgente of [null, "errore:UNIQUE constraint failed"] as const) {
  test(`import di un bundle di prima della 2d (segno ${segnoSorgente ?? "assente"}): catena vecchia nella lista, segno riscritto, esito nella risposta`, async () => {
    process.env.ENCRYPTION_KEY = "A".repeat(64);
    const { exportTenant } = await import("../export");
    const { importTenant } = await import("../import");
    const src = freshTenant();
    const net = Number(src.prepare("INSERT INTO networks (cidr, name) VALUES ('10.9.0.0/24', 'LAN')").run().lastInsertRowid);
    const cred = Number(src.prepare("INSERT INTO credentials (name, credential_type) VALUES ('Server', 'ssh')").run().lastInsertRowid);
    src.prepare("INSERT INTO network_host_credentials (network_id, credential_id, role, sort_order) VALUES (?, ?, 'ssh', 0)").run(net, cred);
    if (segnoSorgente) src.prepare("INSERT INTO tenant_settings (key, value) VALUES ('credenziali_t2_catene', ?)").run(segnoSorgente);
    const bundle = exportTenant({
      tenantDb: src, hubDb: freshHub(),
      options: { tenantCode: "DEFAULT", tiers: [], includeVault: false, passphrase: "trasporto-2d", exportedAt: "2026-10-16T10:00:00.000Z", appVersion: "test" },
    });
    const dst = freshTenant();
    const res = importTenant({ bundle, tenantDb: dst, hubDb: freshHub(), options: { tenantCode: "DEFAULT", passphrase: "trasporto-2d", wipe: true } });

    const lista = dst.prepare("SELECT credential_id FROM network_credentials WHERE network_id = ?").all(net) as Array<{ credential_id: number }>;
    assert.deepEqual(lista.map((r) => r.credential_id), [cred]);
    const segno = (dst.prepare("SELECT value FROM tenant_settings WHERE key = 'credenziali_t2_catene'").get() as { value: string }).value;
    assert.match(segno, /^done:.*lista=1/);
    assert.equal(res.conversioni.credenziali_t2_catene?.segno, segno);
    assert.match(res.conversioni.credenziali_t2_catene?.dettaglio ?? "", /1 voci nella lista/);
  });
}

// Revisione della 2d (16/10): un bundle esportato DOPO la 2d porta le liste già
// convertite, le catene vecchie congelate e il segno chiuso della sorgente.
// Riconvertire riporterebbe nella lista le voci che l'utente aveva tolto (e le
// righe host dei pin), contro la regola per cui col segno chiuso la
// conversione non si richiama (piano, «Casi da non dimenticare» 9). Con la
// cancellazione il segno in tenant_settings è quello del bundle: chiuso → non
// si converte, il segno resta, e la risposta lo dice.
for (const segnoSorgente of ["done", "parziale"] as const) {
  test(`import con cancellazione di un bundle di dopo la 2d (segno ${segnoSorgente}:): la voce tolta dalla lista non torna, il segno del bundle resta`, async () => {
    process.env.ENCRYPTION_KEY = "A".repeat(64);
    const { exportTenant } = await import("../export");
    const { importTenant } = await import("../import");
    const { convertiCateneVecchie, segnoCatene } = await import("@/lib/credentials/converti-catene");
    const src = freshTenant();
    const net = Number(src.prepare("INSERT INTO networks (cidr, name) VALUES ('10.9.0.0/24', 'LAN')").run().lastInsertRowid);
    const host = Number(src.prepare("INSERT INTO hosts (network_id, ip) VALUES (?, '10.9.0.5')").run(net).lastInsertRowid);
    const cred = Number(src.prepare("INSERT INTO credentials (name, credential_type) VALUES ('Server', 'ssh')").run().lastInsertRowid);
    src.prepare("INSERT INTO network_host_credentials (network_id, credential_id, role, sort_order) VALUES (?, ?, 'ssh', 0)").run(net, cred);
    src.prepare("INSERT INTO host_detect_credential (host_id, role, credential_id) VALUES (?, 'ssh', ?)").run(host, cred);
    // La 2d all'apertura della sorgente: conversione e segno.
    const esito = convertiCateneVecchie(src, null, { aVuoto: false });
    const segnoBundle = segnoSorgente === "done" ? segnoCatene(esito) : "parziale:2026-10-16T08:00:00.000Z:lista=1,saltate=1";
    src.prepare("INSERT INTO tenant_settings (key, value) VALUES ('credenziali_t2_catene', ?)").run(segnoBundle);
    // L'utente toglie la voce dalla lista della rete e la riga nata dal pin.
    src.prepare("DELETE FROM network_credentials WHERE network_id = ?").run(net);
    src.prepare("DELETE FROM host_credentials WHERE host_id = ?").run(host);
    const bundle = exportTenant({
      tenantDb: src, hubDb: freshHub(),
      options: { tenantCode: "DEFAULT", tiers: ["asset"], includeVault: false, passphrase: "trasporto-2d", exportedAt: "2026-10-20T10:00:00.000Z", appVersion: "test" },
    });
    const dst = freshTenant();
    const res = importTenant({ bundle, tenantDb: dst, hubDb: freshHub(), options: { tenantCode: "DEFAULT", passphrase: "trasporto-2d", wipe: true } });

    assert.equal((dst.prepare("SELECT COUNT(*) AS n FROM hosts").get() as { n: number }).n, 1, "l'host non è arrivato col bundle");
    assert.deepEqual(dst.prepare("SELECT credential_id FROM network_credentials WHERE network_id = ?").all(net), [], "la voce tolta dalla lista è tornata");
    assert.deepEqual(dst.prepare("SELECT credential_id FROM host_credentials WHERE host_id = ?").all(host), [], "la riga host tolta è tornata dal pin");
    const segno = (dst.prepare("SELECT value FROM tenant_settings WHERE key = 'credenziali_t2_catene'").get() as { value: string }).value;
    assert.equal(segno, segnoBundle);
    assert.equal(res.conversioni.credenziali_t2_catene?.segno, segnoBundle);
    assert.match(res.conversioni.credenziali_t2_catene?.dettaglio ?? "", /già nella sorgente del bundle/);
  });
}

// Tappa 2e credenziali (T19): un bundle esportato prima della 2e porta i
// binding inline e le colonne di network_devices, e nessun segno
// `credenziali_t2_apparati`. L'import converte direttamente e riscrive il
// segno con l'esito, che va anche nella risposta.
test("import di un bundle di prima della 2e: inline → voce, colonna → binding, segno riscritto, esito nella risposta", async () => {
  process.env.ENCRYPTION_KEY = "A".repeat(64);
  const { exportTenant } = await import("../export");
  const { importTenant } = await import("../import");
  const crypto = await import("@/lib/crypto");
  const src = freshTenant();
  const v = Number(src.prepare("INSERT INTO credentials (name, credential_type, encrypted_password) VALUES ('Community', 'snmp', ?)").run(crypto.encrypt("c-sede")).lastInsertRowid);
  const sw = Number(
    src.prepare("INSERT INTO network_devices (name, host, device_type, vendor, protocol, port, credential_id) VALUES ('Switch', '10.9.0.2', 'switch', 'hp', 'snmp_v2', 22, ?)").run(v).lastInsertRowid
  );
  const fw = Number(src.prepare("INSERT INTO network_devices (name, host, device_type, vendor, protocol, port) VALUES ('Firewall', '10.9.0.1', 'firewall', 'other', 'ssh', 22)").run().lastInsertRowid);
  src
    .prepare("INSERT INTO device_credential_bindings (device_id, protocol_type, port, inline_username, inline_encrypted_password, test_status) VALUES (?, 'ssh', 22, 'admin', ?, 'success')")
    .run(fw, crypto.encrypt("pw-fw"));
  const bundle = exportTenant({
    tenantDb: src, hubDb: freshHub(),
    options: { tenantCode: "DEFAULT", tiers: [], includeVault: false, passphrase: "trasporto-2e", exportedAt: "2026-10-16T10:00:00.000Z", appVersion: "test" },
  });
  const dst = freshTenant();
  const res = importTenant({ bundle, tenantDb: dst, hubDb: freshHub(), options: { tenantCode: "DEFAULT", passphrase: "trasporto-2e", wipe: true } });

  assert.deepEqual(dst.prepare("SELECT protocol_type, port, credential_id FROM device_credential_bindings WHERE device_id = ?").all(sw), [{ protocol_type: "snmp", port: 161, credential_id: v }]);
  assert.equal((dst.prepare("SELECT credential_id FROM network_devices WHERE id = ?").get(sw) as { credential_id: number | null }).credential_id, null);
  const b = dst.prepare("SELECT credential_id, inline_encrypted_password, test_status FROM device_credential_bindings WHERE device_id = ?").get(fw) as {
    credential_id: number | null; inline_encrypted_password: string | null; test_status: string;
  };
  assert.notEqual(b.credential_id, null);
  assert.equal(b.inline_encrypted_password, null);
  assert.equal(b.test_status, "success");
  const segno = (dst.prepare("SELECT value FROM tenant_settings WHERE key = 'credenziali_t2_apparati'").get() as { value: string }).value;
  assert.match(segno, /^done:.*binding_colonne=1,voci_nuove=1/);
  assert.equal(res.conversioni.credenziali_t2_apparati?.segno, segno);
  assert.match(res.conversioni.credenziali_t2_apparati?.dettaglio ?? "", /1 binding dalle colonne/);
});

// Un bundle esportato DOPO la 2e porta il segno chiuso della sorgente. Con la
// cancellazione il segno in tenant_settings è quello del bundle: chiuso → non
// si converte (come all'apertura del tenant), il segno resta, e la risposta
// lo dice. Altrimenti una colonna riscritta dal codice di prima riporterebbe
// il binding che l'utente aveva tolto.
for (const segnoSorgente of ["done", "parziale"] as const) {
  test(`import con cancellazione di un bundle di dopo la 2e (segno ${segnoSorgente}:): il binding tolto non torna, il segno del bundle resta`, async () => {
    process.env.ENCRYPTION_KEY = "A".repeat(64);
    const { exportTenant } = await import("../export");
    const { importTenant } = await import("../import");
    const crypto = await import("@/lib/crypto");
    const { convertiCredenzialiApparati, segnoApparati } = await import("@/lib/credentials/converti-apparati");
    const src = freshTenant();
    const v = Number(src.prepare("INSERT INTO credentials (name, credential_type, encrypted_password) VALUES ('Community', 'snmp', ?)").run(crypto.encrypt("c-sede")).lastInsertRowid);
    const sw = Number(
      src.prepare("INSERT INTO network_devices (name, host, device_type, vendor, protocol, port, credential_id) VALUES ('Switch', '10.9.0.2', 'switch', 'hp', 'snmp_v2', 22, ?)").run(v).lastInsertRowid
    );
    // La 2e all'apertura della sorgente: conversione e segno.
    const esito = convertiCredenzialiApparati(src, { aVuoto: false });
    const segnoBundle = segnoSorgente === "done" ? segnoApparati(esito) : "parziale:2026-10-16T08:00:00.000Z:binding_colonne=1,lasciati=1";
    src.prepare("INSERT INTO tenant_settings (key, value) VALUES ('credenziali_t2_apparati', ?)").run(segnoBundle);
    // L'utente toglie il binding; il codice di prima riscrive la colonna.
    src.prepare("DELETE FROM device_credential_bindings WHERE device_id = ?").run(sw);
    src.prepare("UPDATE network_devices SET credential_id = ? WHERE id = ?").run(v, sw);
    const bundle = exportTenant({
      tenantDb: src, hubDb: freshHub(),
      options: { tenantCode: "DEFAULT", tiers: [], includeVault: false, passphrase: "trasporto-2e", exportedAt: "2026-10-20T10:00:00.000Z", appVersion: "test" },
    });
    const dst = freshTenant();
    const res = importTenant({ bundle, tenantDb: dst, hubDb: freshHub(), options: { tenantCode: "DEFAULT", passphrase: "trasporto-2e", wipe: true } });

    assert.deepEqual(dst.prepare("SELECT id FROM device_credential_bindings WHERE device_id = ?").all(sw), [], "il binding tolto è tornato");
    assert.equal((dst.prepare("SELECT credential_id FROM network_devices WHERE id = ?").get(sw) as { credential_id: number | null }).credential_id, v);
    const segno = (dst.prepare("SELECT value FROM tenant_settings WHERE key = 'credenziali_t2_apparati'").get() as { value: string }).value;
    assert.equal(segno, segnoBundle);
    assert.equal(res.conversioni.credenziali_t2_apparati?.segno, segnoBundle);
    assert.match(res.conversioni.credenziali_t2_apparati?.dettaglio ?? "", /già nella sorgente del bundle/);
  });
}

// Tappa 2f credenziali (T22): un bundle esportato prima della 2f porta i
// segreti nelle righe di controller e AD, e nessun segno
// `credenziali_t2_integrazioni`. L'import converte direttamente e riscrive il
// segno con l'esito, che va anche nella risposta.
test("import di un bundle di prima della 2f: controller e AD → voci d'archivio, segno riscritto, esito nella risposta", async () => {
  process.env.ENCRYPTION_KEY = "A".repeat(64);
  const { exportTenant } = await import("../export");
  const { importTenant } = await import("../import");
  const crypto = await import("@/lib/crypto");
  const src = freshTenant();
  src.prepare("INSERT INTO network_controllers (name, vendor, kind, url, api_key_enc) VALUES ('Sede', 'unifi', 'udm', 'https://10.9.0.1', ?)").run(crypto.encrypt("chiave-2f"));
  src.prepare(
    "INSERT INTO ad_integrations (name, dc_host, domain, base_dn, encrypted_username, encrypted_password) VALUES ('dominio', 'dc1', 'ad.local', 'DC=ad', ?, ?)"
  ).run(crypto.encrypt("DOM\\ldap"), crypto.encrypt("pw-ldap"));
  const bundle = exportTenant({
    tenantDb: src, hubDb: freshHub(),
    options: { tenantCode: "DEFAULT", tiers: [], includeVault: false, passphrase: "trasporto-2f", exportedAt: "2026-10-16T10:00:00.000Z", appVersion: "test" },
  });
  const dst = freshTenant();
  const res = importTenant({ bundle, tenantDb: dst, hubDb: freshHub(), options: { tenantCode: "DEFAULT", passphrase: "trasporto-2f", wipe: true } });

  const c = dst.prepare("SELECT credential_id FROM network_controllers").get() as { credential_id: number | null };
  const a = dst.prepare("SELECT credential_id FROM ad_integrations").get() as { credential_id: number | null };
  assert.notEqual(c.credential_id, null);
  assert.notEqual(a.credential_id, null);
  const vc = dst.prepare("SELECT name, credential_type, encrypted_password FROM credentials WHERE id = ?").get(c.credential_id) as { name: string; credential_type: string; encrypted_password: string };
  assert.equal(vc.name, "UniFi · Sede");
  assert.equal(vc.credential_type, "unifi");
  assert.equal(crypto.decrypt(vc.encrypted_password), "chiave-2f");
  const segno = (dst.prepare("SELECT value FROM tenant_settings WHERE key = 'credenziali_t2_integrazioni'").get() as { value: string }).value;
  assert.match(segno, /^done:.*controller=1,chiave=1,utente=0,ad=1,lasciati=0/);
  assert.equal(res.conversioni.credenziali_t2_integrazioni?.segno, segno);
  assert.match(res.conversioni.credenziali_t2_integrazioni?.dettaglio ?? "", /controller #1 → voce #\d+ \(chiave, uguale\)/);
});

// Un bundle esportato DOPO la 2f porta il segno chiuso della sorgente. Con la
// cancellazione il segno in tenant_settings è quello del bundle: chiuso → non
// si converte (come all'apertura del tenant), il segno resta, e la risposta
// lo dice. Altrimenti un controller scollegato (spostato) si ricollegherebbe a
// una voce ricreata dalle colonne ancora piene, senza che nessuno l'abbia scelta.
for (const segnoSorgente of ["done", "parziale"] as const) {
  test(`import con cancellazione di un bundle di dopo la 2f (segno ${segnoSorgente}:): il controller scollegato resta scollegato, il segno del bundle resta`, async () => {
    process.env.ENCRYPTION_KEY = "A".repeat(64);
    const { exportTenant } = await import("../export");
    const { importTenant } = await import("../import");
    const crypto = await import("@/lib/crypto");
    const { convertiControllerEAd, segnoIntegrazioni } = await import("@/lib/credentials/converti-integrazioni");
    const src = freshTenant();
    const ctrl = Number(
      src.prepare("INSERT INTO network_controllers (name, vendor, kind, url, api_key_enc) VALUES ('Sede', 'unifi', 'udm', 'https://10.9.0.1', ?)").run(crypto.encrypt("chiave-2f")).lastInsertRowid
    );
    // La 2f all'apertura della sorgente: conversione e segno.
    const esito = convertiControllerEAd(src, { aVuoto: false });
    const segnoBundle = segnoSorgente === "done" ? segnoIntegrazioni(esito) : "parziale:2026-10-16T08:00:00.000Z:controller=1,chiave=1,utente=0,ad=0,lasciati=1";
    src.prepare("INSERT INTO tenant_settings (key, value) VALUES ('credenziali_t2_integrazioni', ?)").run(segnoBundle);
    // Il controller si sposta senza voce; le colonne (il caso peggiore) restano piene.
    src.prepare("UPDATE network_controllers SET credential_id = NULL, url = 'https://10.9.9.9' WHERE id = ?").run(ctrl);
    const voci = (src.prepare("SELECT COUNT(*) AS n FROM credentials").get() as { n: number }).n;
    const bundle = exportTenant({
      tenantDb: src, hubDb: freshHub(),
      options: { tenantCode: "DEFAULT", tiers: [], includeVault: false, passphrase: "trasporto-2f", exportedAt: "2026-10-20T10:00:00.000Z", appVersion: "test" },
    });
    const dst = freshTenant();
    const res = importTenant({ bundle, tenantDb: dst, hubDb: freshHub(), options: { tenantCode: "DEFAULT", passphrase: "trasporto-2f", wipe: true } });

    assert.equal((dst.prepare("SELECT credential_id FROM network_controllers WHERE id = ?").get(ctrl) as { credential_id: number | null }).credential_id, null, "il controller spostato si è ricollegato");
    assert.equal((dst.prepare("SELECT COUNT(*) AS n FROM credentials").get() as { n: number }).n, voci, "una voce è nata dalle colonne");
    const segno = (dst.prepare("SELECT value FROM tenant_settings WHERE key = 'credenziali_t2_integrazioni'").get() as { value: string }).value;
    assert.equal(segno, segnoBundle);
    assert.equal(res.conversioni.credenziali_t2_integrazioni?.segno, segnoBundle);
    assert.match(res.conversioni.credenziali_t2_integrazioni?.dettaglio ?? "", /già nella sorgente del bundle/);
  });
}
