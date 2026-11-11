/**
 * Le altre fonti di dati della casa: apparati nuovi, tenuti d'occhio, disponibilità, sistemi, certificati.
 *
 * Run: node --import tsx --test src/lib/cliente/__tests__/altri-dati.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { apparatiNuovi, certificati, disponibilita, importantiSpenti, percento, sistemaDa, sistemiOperativi } from "../altri-dati";

function base(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE hosts (id INTEGER PRIMARY KEY, ip TEXT, custom_name TEXT, hostname TEXT, attr_category TEXT,
      first_seen TEXT, last_seen TEXT, status TEXT, known_host INTEGER DEFAULT 0);
    CREATE TABLE status_history (id INTEGER PRIMARY KEY, host_id INTEGER, status TEXT, checked_at TEXT);
    CREATE TABLE wazuh_os (agent_id TEXT, os_name TEXT, os_version TEXT);
    CREATE TABLE servizi_rete (id INTEGER PRIMARY KEY, host_id INTEGER, porta INTEGER, tls_json TEXT);
  `);
  return db;
}

test("apparatiNuovi: solo gli ultimi 7 giorni, i più recenti prima", () => {
  const db = base();
  db.exec(`
    INSERT INTO hosts (id, ip, hostname, attr_category, first_seen, status) VALUES
      (1, '10.0.0.1', 'vecchio', NULL, datetime('now', '-30 days'), 'online'),
      (2, '10.0.0.2', 'ieri', 'voip.phone', datetime('now', '-1 day'), 'online'),
      (3, '10.0.0.3', NULL, NULL, datetime('now', '-3 days'), 'online');
  `);
  const n = apparatiNuovi(db);
  assert.equal(n.totale, 2);
  assert.deepEqual(n.apparati.map((a) => a.nome), ["ieri", "10.0.0.3"]);
  assert.equal(n.apparati[0]?.cosa, "telefono");
  assert.equal(n.apparati[1]?.cosa, null);
});

test("importantiSpenti: null se nessuno è segnato, altrimenti i segnati e gli spenti", () => {
  const db = base();
  assert.equal(importantiSpenti(db), null);
  db.exec(`
    INSERT INTO hosts (id, ip, hostname, status, known_host, last_seen) VALUES
      (1, '10.0.0.1', 'srv1', 'online', 1, datetime('now')),
      (2, '10.0.0.2', 'srv2', 'offline', 1, datetime('now', '-2 days')),
      (3, '10.0.0.3', 'pc', 'offline', 0, datetime('now', '-2 days'));
  `);
  const i = importantiSpenti(db);
  assert.equal(i?.segnati, 2);
  assert.deepEqual(i?.spenti.map((s) => s.nome), ["srv2"]);
});

test("percento: il 100 solo se non è mancato nessun controllo", () => {
  assert.equal(percento(1000, 1000), 100);
  assert.equal(percento(9999, 10000), 99.9);
  assert.equal(percento(950, 1000), 95);
  assert.equal(percento(0, 0), 0);
});

test("disponibilita: solo gli apparati tenuti d'occhio con abbastanza controlli, i peggiori prima", () => {
  const db = base();
  db.exec(`
    INSERT INTO hosts (id, ip, hostname, status, known_host) VALUES
      (1, '10.0.0.1', 'sempre', 'online', 1), (2, '10.0.0.2', 'a-meta', 'online', 1),
      (3, '10.0.0.3', 'pochi', 'online', 1), (4, '10.0.0.4', 'non-segnato', 'online', 0);
  `);
  const metti = db.prepare("INSERT INTO status_history (host_id, status, checked_at) VALUES (?, ?, datetime('now', ?))");
  for (let i = 0; i < 40; i++) {
    metti.run(1, "online", `-${i} hours`);
    metti.run(2, i % 2 === 0 ? "online" : "offline", `-${i} hours`);
    metti.run(4, "online", `-${i} hours`);
  }
  for (let i = 0; i < 5; i++) metti.run(3, "online", `-${i} hours`);
  metti.run(1, "offline", "-60 days");
  const d = disponibilita(db);
  assert.deepEqual(d?.apparati.map((a) => [a.nome, a.percento]), [["a-meta", 50], ["sempre", 100]]);
  assert.equal(d?.media, 75);
});

test("sistemaDa: nomi leggibili e fuori supporto solo dove è certo", () => {
  assert.deepEqual(sistemaDa("Microsoft Windows 10 Pro", "10.0.19045.6456"), { nome: "Windows 10", fuoriSupporto: true });
  assert.deepEqual(sistemaDa("Microsoft Windows 11 Pro Education", "10.0.26200.1"), { nome: "Windows 11", fuoriSupporto: false });
  assert.deepEqual(sistemaDa("Microsoft Windows Server 2012 R2 Standard", "6.3"), { nome: "Windows Server 2012 R2", fuoriSupporto: true });
  assert.deepEqual(sistemaDa("Microsoft Windows Server 2019 Standard", "10.0.17763"), { nome: "Windows Server 2019", fuoriSupporto: false });
  assert.deepEqual(sistemaDa("Ubuntu", "20.04.6 LTS (Focal Fossa)"), { nome: "Ubuntu 20.04", fuoriSupporto: true });
  assert.deepEqual(sistemaDa("Ubuntu", "24.04.4 LTS (Noble Numbat)"), { nome: "Ubuntu 24.04", fuoriSupporto: false });
  assert.deepEqual(sistemaDa("Debian GNU/Linux", "13 (trixie)"), { nome: "Debian 13", fuoriSupporto: false });
  assert.deepEqual(sistemaDa("Debian GNU/Linux", "11 (bullseye)"), { nome: "Debian 11", fuoriSupporto: true });
  assert.deepEqual(sistemaDa("macOS", "15.1"), { nome: "macOS", fuoriSupporto: false });
  assert.deepEqual(sistemaDa(null, null), { nome: "Sconosciuto", fuoriSupporto: false });
});

test("sistemiOperativi: raggruppa le edizioni e conta le macchine fuori supporto", () => {
  const db = base();
  assert.equal(sistemiOperativi(db), null);
  db.exec(`
    INSERT INTO wazuh_os VALUES ('1', 'Microsoft Windows 11 Pro', '10.0.26200.1'), ('2', 'Microsoft Windows 11 Pro Education', '10.0.26200.2'),
      ('3', 'Microsoft Windows 10 Pro', '10.0.19045.1'), ('4', 'Debian GNU/Linux', '13 (trixie)');
  `);
  const s = sistemiOperativi(db);
  assert.equal(s?.macchine, 4);
  assert.equal(s?.fuoriSupporto, 1);
  assert.deepEqual(s?.sistemi[0], { nome: "Windows 11", macchine: 2, fuoriSupporto: false });
});

test("certificati: scaduti e in scadenza entro 30 giorni, senza quelli firmati da sé", () => {
  const db = base();
  assert.equal(certificati(db), null);
  db.exec("INSERT INTO hosts (id, ip, hostname, status) VALUES (1, '10.0.0.1', 'web', 'online'), (2, '10.0.0.2', NULL, 'online')");
  const ora = new Date("2026-11-11T12:00:00Z");
  const metti = db.prepare("INSERT INTO servizi_rete (host_id, porta, tls_json) VALUES (?, ?, ?)");
  metti.run(1, 443, JSON.stringify({ subject_cn: "sito.it", not_after: "2026-11-21 12:00:00", self_signed: false }));
  metti.run(1, 8443, JSON.stringify({ subject_cn: "vecchio.it", not_after: "2026-11-01 12:00:00", self_signed: false }));
  metti.run(2, 443, JSON.stringify({ subject_cn: "lontano.it", not_after: "2027-11-01 12:00:00", self_signed: false }));
  metti.run(2, 8443, JSON.stringify({ subject_cn: "fabbrica", not_after: "2020-01-01 00:00:00", self_signed: true }));
  metti.run(2, 9443, "{non json");
  const c = certificati(db, ora);
  assert.equal(c?.controllati, 3);
  assert.equal(c?.scaduti, 1);
  assert.equal(c?.inScadenza, 1);
  assert.deepEqual(c?.elenco.map((x) => [x.nome, x.dove, x.giorni, x.scaduto]), [
    ["vecchio.it", "web:8443", -10, true],
    ["sito.it", "web:443", 10, false],
  ]);
});
