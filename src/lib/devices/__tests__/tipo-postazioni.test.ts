// Il tipo degli apparati che sono postazioni (23/11/2026). Sul 70791 i PC degli apparati automatici erano «switch» (22),
// «server» (6) e «nas» (2), tutti con classificazione «workstation».
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { TENANT_SCHEMA_SQL } from "@/lib/db-tenant-schema";
import { resolveDeviceTypeForCreate } from "@/lib/device-product-profiles";
import { deviceTypeDaClassificazione } from "../rendi-apparato";
import { allineaTipoPostazioni } from "../tipo-postazioni";

test("nascono «workstation»: dagli apparati automatici e da «Rendi apparato»", () => {
  for (const c of ["workstation", "notebook", "thin_client"]) {
    assert.equal(resolveDeviceTypeForCreate({ product_profile: "generic_windows" as never, classification: c }), "workstation", c);
    assert.equal(deviceTypeDaClassificazione(c), "workstation", c);
  }
  assert.equal(resolveDeviceTypeForCreate({ product_profile: "generic_windows" as never, classification: "server_windows" }), "server", "un server resta server");
  assert.equal(deviceTypeDaClassificazione("stampante"), "stampante");
});

test("quelli che ci sono si correggono da soli: solo dai ripieghi, idempotente, nel log per nome", () => {
  const db = new Database(":memory:");
  db.exec(TENANT_SCHEMA_SQL);
  const nd = db.prepare("INSERT INTO network_devices (id, name, host, device_type, vendor, protocol, classification) VALUES (?, ?, ?, ?, 'windows', 'winrm', ?)");
  nd.run(31, "NB-AGUZZOLI", "10.0.0.1", "switch", "workstation");
  nd.run(1316, "PC-MIARI", "10.0.0.2", "server", "workstation");
  nd.run(40, "NB-X", "10.0.0.3", "nas", "notebook");
  nd.run(50, "GW", "10.0.0.4", "router", "workstation");
  nd.run(60, "SRV", "10.0.0.5", "server", "server_windows");
  const log: string[] = [];
  assert.equal(allineaTipoPostazioni(db, (r) => log.push(r)), 3);
  const tipo = (id: number) => (db.prepare("SELECT device_type AS t FROM network_devices WHERE id = ?").get(id) as { t: string }).t;
  assert.deepEqual([31, 1316, 40, 50, 60].map(tipo), ["workstation", "workstation", "workstation", "router", "server"]);
  assert.equal(log.length, 3);
  assert.match(log[0], /NB-AGUZZOLI switch -> workstation/);
  assert.equal(allineaTipoPostazioni(db, (r) => log.push(r)), 0, "la seconda volta niente");
});
