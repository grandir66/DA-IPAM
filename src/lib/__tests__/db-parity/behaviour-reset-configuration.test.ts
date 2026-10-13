/**
 * `resetConfiguration` (NUC-2 gruppo 2, T3-07): una copia sola, quella tenant.
 *
 * La copia della facciata cancellava anche `users`, `settings` e
 * `device_fingerprint_rules`, tabelle che stanno nell'hub e non nel database
 * del tenant: dentro un tenant lanciava «no such table» e la transazione non
 * cancellava niente. La copia tenant svuota solo le tabelle del tenant, e in
 * più credenziali, AD, vicini, rotte e gruppi multi-indirizzo, che la facciata
 * lasciava.
 *
 * Misura sulla copia del DB DTS (13/10): la copia della facciata fallisce
 * («no such table: users») e lascia le 10 tabelle controllate com'erano; la
 * copia tenant le svuota tutte e 10.
 */
import { TEST_DATA_DIR } from "../support/data-dir-isolata";

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import type Database from "better-sqlite3";
import * as facciata from "@/lib/db";
import * as tenant from "@/lib/db-tenant";
import { closeHubDb } from "@/lib/db-hub";
import { APPARATO, HOST, retiHostCredenziali } from "./gruppo1b/fixture";
import { nelTenant } from "./comportamento";

after(() => {
  facciata.closeDb();
  tenant.closeAllTenantDbs();
  closeHubDb();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

const TABELLE = [
  "hosts", "networks", "network_devices", "credentials", "host_credentials", "network_credentials",
  "device_credential_bindings", "device_neighbors", "routing_table", "multihomed_links",
  "ad_integrations", "ad_computers", "ad_users", "scheduled_jobs",
];

function cliente(db: Database.Database): void {
  retiHostCredenziali(db);
  db.prepare("INSERT INTO device_neighbors (device_id, local_port, remote_device_name, remote_port, protocol) VALUES (?, '1/48', 'vicino', 'ge-0/0/1', 'lldp')").run(APPARATO.switchCore);
  db.prepare("INSERT INTO routing_table (device_id, destination, gateway, interface_name, protocol, active) VALUES (?, '0.0.0.0/0', '192.0.2.1', 'ether1', 'static', 1)").run(APPARATO.router);
  db.prepare("INSERT INTO multihomed_links (group_id, host_id, match_type, match_value, is_primary) VALUES ('g', ?, 'hostname', 'srv', 1)").run(HOST.server);
  db.prepare(
    "INSERT INTO ad_integrations (id, name, dc_host, domain, base_dn, encrypted_username, encrypted_password) VALUES (1, 'Dominio', 'dc01', 'dominio.local', 'DC=dominio,DC=local', 'u', 'p')",
  ).run();
  db.prepare("INSERT INTO ad_computers (integration_id, object_guid, sam_account_name, distinguished_name) VALUES (1, 'g1', 'PC01$', 'CN=PC01')").run();
  db.prepare("INSERT INTO ad_users (integration_id, object_guid, sam_account_name) VALUES (1, 'g2', 'mario')").run();
}

test("resetConfiguration: dentro un tenant non lancia e svuota anche credenziali, AD e vicini", () => {
  const r = nelTenant("rcsvuota", cliente, (db) => {
    const conta = () => Object.fromEntries(TABELLE.map((t) => [t, (db.prepare(`SELECT COUNT(*) c FROM ${t}`).get() as { c: number }).c]));
    const prima = conta();
    facciata.resetConfiguration();
    return { prima, dopo: conta() };
  });
  for (const t of ["hosts", "credentials", "host_credentials", "device_neighbors", "ad_computers", "ad_users"]) {
    assert.ok((r.prima[t] as number) > 0, `la prova deve partire con righe in ${t}`);
  }
  assert.deepEqual(r.dopo, Object.fromEntries(TABELLE.map((t) => [t, 0])));
});
