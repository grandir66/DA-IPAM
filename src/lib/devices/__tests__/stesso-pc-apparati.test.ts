// Un PC, un apparato, un asset (23/11/2026). Casi veri del 70791: PC-APADULA aveva #26 all'IP vecchio 4.121 (senza riga,
// con due inventari software e la credenziale) e #1313 sulla riga viva 4.174; NB-AGUZZOLI aveva l'apparato su 3.108
// offline mentre il PC era vivo su 5.150. Ogni apparato aveva il suo asset NIS2.
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { migrateAssegnatariAd, recomputeMultihomedLinks } from "@/lib/db-tenant";
import { TENANT_SCHEMA_SQL } from "@/lib/db-tenant-schema";
import { applicaApparatiPc, pianoApparatiPc, seguiIpVivoPc } from "../stesso-pc-apparati";

const fa = (g: number) => new Date(Date.now() - g * 86_400_000).toISOString().replace("T", " ").slice(0, 19);

function dbProva(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(TENANT_SCHEMA_SQL);
  migrateAssegnatariAd(db);
  db.exec("ALTER TABLE network_devices ADD COLUMN host_id INTEGER REFERENCES hosts(id) ON DELETE SET NULL");
  db.prepare("INSERT INTO ad_integrations (id, name, dc_host, domain, base_dn, encrypted_username, encrypted_password) VALUES (1, 'AD', 'dc', 'x.local', 'DC=x', 'x', 'x')").run();
  const c = db.prepare("INSERT INTO ad_computers (integration_id, object_guid, sam_account_name, distinguished_name, operating_system, enabled) VALUES (1, ?, ?, ?, 'Windows 11 Pro', 1)");
  c.run("c-1", "PC-APADULA$", "CN=PC-APADULA"); c.run("c-2", "NB-AGUZZOLI$", "CN=NB-AGUZZOLI"); c.run("c-3", "PC-SALA$", "CN=PC-SALA");
  db.prepare("INSERT INTO networks (id, cidr, name) VALUES (4, '192.168.4.0/22', 'lan'), (9, '192.168.3.0/24', 'wifi')").run();
  const h = db.prepare("INSERT INTO hosts (id, network_id, ip, mac, hostname, classification, status, last_seen) VALUES (?, ?, ?, ?, ?, 'workstation', ?, ?)");
  h.run(92, 4, "192.168.4.174", "70:5A:0F:11:22:33", "PC-APADULA.x.local", "online", fa(0));
  h.run(552, 4, "192.168.5.150", "E8:EA:6A:8C:68:3C", "NB-AGUZZOLI", "online", fa(0));
  h.run(592, 9, "192.168.3.108", "C0:A8:10:26:85:81", "NB-AGUZZOLI", "offline", fa(0));
  h.run(30, 4, "192.168.4.30", "00:AA:BB:CC:DD:01", "PC-SALA", "online", fa(0));
  const nd = db.prepare("INSERT INTO network_devices (id, name, host, device_type, vendor, protocol, enabled, host_id) VALUES (?, ?, ?, 'switch', 'windows', 'winrm', 1, ?)");
  nd.run(26, "PC-APADULA", "192.168.4.121", null);
  nd.run(1313, "PC-APADULA.x.local", "192.168.4.174", 92);
  nd.run(1327, "NB-AGUZZOLI", "192.168.3.108", 592);
  nd.run(40, "PC-SALA", "192.168.4.40", null);
  nd.run(41, "PC-SALA", "192.168.4.30", 30);
  db.prepare("INSERT INTO credentials (id, name, credential_type) VALUES (5, 'dominio', 'windows')").run();
  const b = db.prepare("INSERT INTO device_credential_bindings (device_id, credential_id, protocol_type, port) VALUES (?, 5, 'winrm', 5985)");
  b.run(26); b.run(1313);
  const s = db.prepare("INSERT INTO software_scans (device_id, started_at, status, os_family, probe) VALUES (?, ?, 'ok', 'windows', 'winrm')");
  s.run(26, fa(180)); s.run(26, fa(170));
  db.prepare("INSERT INTO asset_assignees (id, name) VALUES (7, 'Donato Apadula'), (8, 'Mario Rossi'), (9, 'Anna Bianchi')").run();
  const a = db.prepare("INSERT INTO inventory_assets (id, hostname, network_device_id, asset_assignee_id, categoria) VALUES (?, ?, ?, ?, 'Desktop')");
  a.run(100, "PC-APADULA", 26, 7); a.run(101, "PC-APADULA", 1313, null);
  a.run(102, "NB-AGUZZOLI", 1327, null);
  a.run(103, "PC-SALA", 40, 8); a.run(104, "PC-SALA", 41, 9);
  recomputeMultihomedLinks(db);
  return db;
}

test("piano: resta l'apparato della riga viva, il doppione all'IP vecchio si unisce; l'apparato offline va sulla riga viva", () => {
  const p = Object.fromEntries(pianoApparatiPc(dbProva()).map((x) => [x.pc, x]));
  assert.deepEqual([p["pc-apadula"].tieni, p["pc-apadula"].daUnire, p["pc-apadula"].verso, p["pc-apadula"].salta], [1313, [26], null, null]);
  assert.deepEqual(p["pc-apadula"].asset, { tieni: 101, daUnire: [100], assegnatario: 7 });
  assert.deepEqual([p["nb-aguzzoli"].tieni, p["nb-aguzzoli"].daUnire, p["nb-aguzzoli"].verso], [1327, [], { hostId: 552, ip: "192.168.5.150", online: true }]);
  assert.match(p["pc-sala"].salta ?? "", /assegnatari diversi/);
});

test("applica: storia e credenziale passano, un asset con l'assegnatario, doppione via; NB-AGUZZOLI segue l'IP vivo; PC-SALA intatto", () => {
  const db = dbProva();
  const e = applicaApparatiPc(db, pianoApparatiPc(db), 3);
  assert.deepEqual([e.uniti, e.spostati, e.assetUniti, e.saltati.map((x) => x.pc)], [1, 1, 1, ["pc-sala"]]);
  const q = (sql: string) => db.prepare(sql).all();
  assert.deepEqual(q("SELECT id FROM network_devices WHERE name LIKE 'PC-APADULA%'"), [{ id: 1313 }]);
  assert.deepEqual(q("SELECT COUNT(*) AS n FROM software_scans WHERE device_id = 1313"), [{ n: 2 }], "lo storico software non si perde");
  assert.deepEqual(q("SELECT COUNT(*) AS n FROM device_credential_bindings WHERE device_id = 1313"), [{ n: 1 }], "credenziale una sola, non doppia");
  assert.deepEqual(q("SELECT id, asset_assignee_id AS a FROM inventory_assets WHERE hostname = 'PC-APADULA'"), [{ id: 101, a: 7 }]);
  assert.deepEqual(q("SELECT host, host_id FROM network_devices WHERE id = 1327"), [{ host: "192.168.5.150", host_id: 552 }]);
  assert.deepEqual(q("SELECT host_id, ip_address FROM inventory_assets WHERE id = 102"), [{ host_id: 552, ip_address: "192.168.5.150" }]);
  assert.deepEqual(q("SELECT COUNT(*) AS n FROM network_devices WHERE name = 'PC-SALA'"), [{ n: 2 }], "assegnatari diversi: non si tocca");
  assert.equal(pianoApparatiPc(db).filter((p) => !p.salta).length, 0, "un secondo giro non ha più niente da fare");
});

test("giro dopo la scansione: verso una riga offline non sposta, ma unisce i doppioni", () => {
  const db = dbProva();
  db.prepare("UPDATE hosts SET status = 'offline' WHERE id = 552").run();
  db.prepare("UPDATE hosts SET status = 'online' WHERE id = 592").run();
  const e = seguiIpVivoPc(db);
  assert.equal(e.uniti, 1, "PC-APADULA unito comunque");
  assert.deepEqual(db.prepare("SELECT host FROM network_devices WHERE id = 1327").get(), { host: "192.168.3.108" }, "resta sulla riga viva 3.108");
});
