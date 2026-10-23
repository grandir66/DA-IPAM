// Pagina «Abbinamenti» (piano 2026-10-23-abbinamenti): i gruppi e la conferma. I casi vengono dalla misura sull'hub .8
// del 23/10: PC con asset senza assegnatario, PC senza asset (workstation/notebook), un server con una proposta
// (da-sns), un Mac classificato «voip» (categoria da scegliere), un PC assegnato a mano a un altro (PC-MAX).
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { migrateAssegnatariAd } from "@/lib/db-tenant";
import { TENANT_SCHEMA_SQL } from "@/lib/db-tenant-schema";
import { registraAccessi } from "../db";
import { confermaAbbinamenti, elencoAbbinamenti } from "../abbinamenti";

function dbProva(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(TENANT_SCHEMA_SQL);
  migrateAssegnatariAd(db);
  db.exec("ALTER TABLE network_devices ADD COLUMN host_id INTEGER REFERENCES hosts(id) ON DELETE SET NULL");
  db.prepare("INSERT INTO ad_integrations (id, name, dc_host, domain, base_dn, encrypted_username, encrypted_password) VALUES (1, 'AD', 'dc', 'cliente.local', 'DC=x', 'x', 'x')").run();
  const u = db.prepare("INSERT INTO ad_users (integration_id, object_guid, sam_account_name, display_name, email, enabled, given_name, surname) VALUES (1, ?, ?, ?, ?, 1, ?, ?)");
  u.run("g-1", "marzia", "Marzia Miari", "m.miari@cliente.it", "Marzia", "Miari");
  u.run("g-2", "l.aguzzoli", "Luca Aguzzoli", "l.aguzzoli@cliente.it", "Luca", "Aguzzoli");
  u.run("g-3", "donato", "Donato Apadula", "d.apadula@cliente.it", "Donato", "Apadula");
  u.run("g-4", "r.lucchi", "Riccardo Lucchi", "r.lucchi@cliente.it", "Riccardo", "Lucchi");
  u.run("g-5", "massimo", "Massimo Malagola", "m.malagola@cliente.it", "Massimo", "Malagola");
  u.run("g-6", "s.annovi", "Simone Annovi", "s.annovi@cliente.it", "Simone", "Annovi");
  db.prepare("INSERT INTO networks (id, cidr, name) VALUES (1, '192.168.4.0/24', 'lan')").run();
  const h = db.prepare("INSERT INTO hosts (id, network_id, ip, hostname, classification, model) VALUES (?, 1, ?, ?, ?, ?)");
  h.run(1, "192.168.4.132", "PC-MIARI.cliente.local", "workstation", null);
  h.run(2, "192.168.4.140", "NB-AGUZZOLI", "notebook", "Latitude 5440");
  h.run(3, "192.168.4.8", "da-sns", "server", null);
  h.run(4, "192.168.4.150", "Mac", "voip", null);
  h.run(5, "192.168.4.160", "PC-MAX", "workstation", null);
  h.run(6, "192.168.4.170", "PC-POCHI", "workstation", null);
  // PC-MIARI in inventario tramite l'apparato (come 32 asset su 34 sull'hub); PC-MAX assegnato a mano a Simone.
  db.prepare("INSERT INTO network_devices (id, name, host, device_type, vendor, protocol, enabled, host_id) VALUES (1, 'PC-MIARI', '192.168.4.132', 'server', 'windows', 'winrm', 1, 1)").run();
  db.prepare("INSERT INTO inventory_assets (id, hostname, network_device_id, categoria) VALUES (10, 'PC-MIARI', 1, 'Desktop')").run();
  db.prepare("INSERT INTO asset_assignees (id, name, ad_integration_id, ad_object_guid, origine) VALUES (50, 'Simone Annovi', 1, 'g-6', 'ad')").run();
  db.prepare("INSERT INTO inventory_assets (id, hostname, host_id, categoria, asset_assignee_id) VALUES (11, 'PC-MAX', 5, 'Desktop', 50)").run();
  const oggi = new Date().toISOString().slice(0, 10);
  const a = (hostId: number, account: string, n: number, fonte: "wazuh_tastiera" | "wazuh_rete" = "wazuh_tastiera") =>
    ({ hostId, account, fonte, giorno: oggi, conteggio: n, ultimo: `${oggi} 10:00:00` });
  registraAccessi(db, [a(1, "marzia", 108), a(2, "l.aguzzoli", 221), a(3, "donato", 9, "wazuh_rete"), a(4, "r.lucchi", 112, "wazuh_rete"), a(5, "massimo", 36, "wazuh_rete"), a(6, "marzia", 2)], "somma");
  return db;
}

const tutti = { gruppo: "tutti" as const, soloSenzaAsset: false, cerca: null, pagina: 1, perPagina: 50 };

test("gruppi: proposti con e senza asset, server escluso anche senza asset, da rivedere, pochi dati", () => {
  const db = dbProva();
  const e = elencoAbbinamenti(db, tutti);
  const per = Object.fromEntries(e.voci.map((v) => [v.pc, [v.gruppo, v.persona?.account ?? null, v.asset?.id ?? null, v.categoriaProposta]]));
  assert.deepEqual(per, {
    "PC-MIARI": ["proposto", "marzia", 10, null],
    "NB-AGUZZOLI": ["proposto", "l.aguzzoli", null, "Laptop"],
    "da-sns": ["escluso", "donato", null, null],
    Mac: ["proposto", "r.lucchi", null, null],
    "PC-MAX": ["da_rivedere", "massimo", 11, null],
    "PC-POCHI": ["pochi_dati", null, null, "Desktop"],
  });
  assert.deepEqual(e.contatori, { proposto: 3, da_rivedere: 1, abbinato: 0, pochi_dati: 1, escluso: 1 });
  assert.match(String(e.voci.find((v) => v.pc === "da-sns")?.motivo), /server/);
  assert.deepEqual(e.proposti[4], { account: "r.lucchi", creaAsset: true, importaAssegnatario: true, categoriaDaScegliere: true, omonimi: false });
  assert.equal(elencoAbbinamenti(db, { ...tutti, gruppo: "proposto", soloSenzaAsset: true }).totale, 2);
  assert.equal(elencoAbbinamenti(db, { ...tutti, cerca: "miari" }).totale, 1);
});

test("conferma: crea assegnatari e asset, assegna, scrive il diario; il Mac senza categoria si salta, con la categoria passa", () => {
  const db = dbProva();
  const r = confermaAbbinamenti(db, [
    { hostId: 1, account: "marzia" },
    { hostId: 2, account: "l.aguzzoli" },
    { hostId: 4, account: "r.lucchi" },
  ], 7);
  assert.deepEqual(r, { assegnati: 2, assetCreati: 1, assetCollegati: 0, assegnatariCreati: 2, saltati: [{ hostId: 4, motivo: "categoria dell'asset da scegliere" }] });
  const nb = db.prepare("SELECT a.categoria, a.modello, a.ip_address, aa.name FROM inventory_assets a JOIN asset_assignees aa ON aa.id = a.asset_assignee_id WHERE a.host_id = 2").get();
  assert.deepEqual(nb, { categoria: "Laptop", modello: "Latitude 5440", ip_address: "192.168.4.140", name: "Luca Aguzzoli" });
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM inventory_audit_log WHERE user_id = 7").get() as { n: number }).n, 3, "create + 2 assegnazioni");
  assert.deepEqual(confermaAbbinamenti(db, [{ hostId: 4, account: "r.lucchi", categoria: "Other" }], 7).assegnati, 1);
  const dopo = elencoAbbinamenti(db, tutti);
  assert.equal(dopo.contatori.abbinato, 3);
  assert.equal(dopo.contatori.proposto, 0);
});

test("conferma: da rivedere solo se chiesto; persona cambiata, escluso o già abbinato si saltano col motivo", () => {
  const db = dbProva();
  const r = confermaAbbinamenti(db, [
    { hostId: 5, account: "massimo" },
    { hostId: 1, account: "donato" },
    { hostId: 3, account: "donato" },
    { hostId: 6, account: "marzia" },
  ], null);
  assert.equal(r.assegnati, 1);
  assert.deepEqual(r.saltati.map((s) => [s.hostId, s.motivo.split(" (")[0]]), [[1, "la persona proposta è cambiata"], [3, "non più proposto"], [6, "non più proposto"]]);
  assert.equal((db.prepare("SELECT aa.name FROM inventory_assets a JOIN asset_assignees aa ON aa.id = a.asset_assignee_id WHERE a.id = 11").get() as { name: string }).name, "Massimo Malagola");
  assert.deepEqual(confermaAbbinamenti(db, [{ hostId: 5, account: "massimo" }], null).saltati, [{ hostId: 5, motivo: "già abbinato" }]);
});

test("omonimi: un asset col nome del PC legato ad altro chiede «Collega» o «Crea nuovo»; più asset per persona vanno bene", () => {
  const db = dbProva();
  // Come NB-AGUZZOLI n. 31 sull'hub: stesso nome, legato all'apparato di un altro IP (oggi un iPhone).
  db.prepare("INSERT INTO hosts (id, network_id, ip, hostname, classification) VALUES (7, 1, '192.168.4.172', 'iPhone', 'workstation')").run();
  db.prepare("INSERT INTO network_devices (id, name, host, device_type, vendor, protocol, enabled, host_id) VALUES (2, 'x', '192.168.4.172', 'server', 'windows', 'winrm', 1, 7)").run();
  db.prepare("INSERT INTO inventory_assets (id, hostname, network_device_id, categoria, ip_address) VALUES (31, 'NB-AGUZZOLI', 2, 'Desktop', '192.168.4.172')").run();
  const v = elencoAbbinamenti(db, tutti).voci.find((x) => x.pc === "NB-AGUZZOLI")!;
  assert.deepEqual(v.omonimi.map((o) => o.id), [31]);
  assert.equal(elencoAbbinamenti(db, tutti).proposti[2].omonimi, true);
  // Senza scelta: saltato. Con «Collega»: l'asset 31 passa sull'host 2, perde l'apparato vecchio, e va a Luca.
  assert.match(confermaAbbinamenti(db, [{ hostId: 2, account: "l.aguzzoli" }], 7).saltati[0].motivo, /stesso nome/);
  const r = confermaAbbinamenti(db, [{ hostId: 2, account: "l.aguzzoli", asset: 31 }], 7);
  assert.deepEqual([r.assegnati, r.assetCollegati, r.assetCreati], [1, 1, 0]);
  assert.deepEqual(db.prepare("SELECT host_id, network_device_id, ip_address FROM inventory_assets WHERE id = 31").get(), { host_id: 2, network_device_id: null, ip_address: "192.168.4.140" });
  assert.deepEqual(
    db.prepare("SELECT field_name, old_value, new_value FROM inventory_audit_log WHERE asset_id = 31 ORDER BY id").all(),
    [
      { field_name: "host_id", old_value: null, new_value: "2" },
      { field_name: "network_device_id", old_value: "2", new_value: null },
      { field_name: "ip_address", old_value: "192.168.4.172", new_value: "192.168.4.140" },
      { field_name: "asset_assignee_id", old_value: null, new_value: String((db.prepare("SELECT asset_assignee_id AS a FROM inventory_assets WHERE id = 31").get() as { a: number }).a) },
    ],
  );
  // «Crea nuovo» su un altro omonimo e la stessa persona su due asset: si può.
  db.prepare("INSERT INTO hosts (id, network_id, ip, hostname, classification) VALUES (8, 1, '192.168.4.190', 'NB-AGUZZOLI', 'notebook')").run();
  registraAccessi(db, [{ hostId: 8, account: "l.aguzzoli", fonte: "wazuh_tastiera", giorno: new Date().toISOString().slice(0, 10), conteggio: 9, ultimo: null }], "somma");
  const n = confermaAbbinamenti(db, [{ hostId: 8, account: "l.aguzzoli", asset: "nuovo" }], 7);
  assert.deepEqual([n.assegnati, n.assetCreati], [1, 1]);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM inventory_assets a JOIN asset_assignees aa ON aa.id = a.asset_assignee_id WHERE aa.name = 'Luca Aguzzoli'").get() as { n: number }).n, 2);
  // Un numero che non è fra gli omonimi non passa.
  assert.match(confermaAbbinamenti(db, [{ hostId: 4, account: "r.lucchi", asset: 999 }], 7).saltati[0].motivo, /non ha più lo stesso nome/);
});
