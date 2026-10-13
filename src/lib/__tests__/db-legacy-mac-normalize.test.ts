/**
 * Migrazione `migration_mac_normalize_v1` del vecchio `ipam.db` (T3-08).
 *
 * Dopo aver normalizzato i MAC, la migrazione ricalcola l'assegnazione degli
 * indirizzi (`hosts.ip_assignment`, da lease DHCP e AD). Quando il ramo del
 * vecchio database è passato in `db-legacy.ts`, la chiamata puntava alla copia
 * per tenant, che senza un cliente scelto lancia «Nessun contesto tenant»:
 * l'errore lo assorbiva il `catch` della migrazione, il flag era già scritto e
 * il ricalcolo non si rifaceva più (revisione della parte 3b, 13/10). Il
 * ricalcolo deve girare sul database che si sta migrando.
 */
import { TEST_DATA_DIR } from "./support/data-dir-isolata";

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
// Dalla facciata, come i chiamanti veri: `getDb()` senza un cliente scelto e
// senza hub apre il vecchio ipam.db (e il cricchetto vieta di importare
// db-legacy.ts da altri file).
import { closeDb, getDb } from "@/lib/db";

after(() => {
  closeDb();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

test("migrazione MAC del vecchio ipam.db: ricalcola ip_assignment sul database che migra", () => {
  const d = getDb();
  const rete = d.prepare("INSERT INTO networks (cidr, name) VALUES ('10.40.0.0/24', 'Uffici')").run().lastInsertRowid;
  d.prepare(
    "INSERT INTO hosts (network_id, ip, mac, ip_assignment) VALUES (?, '10.40.0.20', '00:1A:2B:3C:4D:02', 'static')",
  ).run(rete);
  d.prepare(
    "INSERT INTO dhcp_leases (source_type, ip_address, mac_address, dynamic_lease, network_id) VALUES ('mikrotik', '10.40.0.20', '00:1A:2B:3C:4D:02', 1, ?)",
  ).run(rete);
  d.prepare("DELETE FROM settings WHERE key = 'migration_mac_normalize_v1'").run();
  closeDb();

  const riaperto = getDb();
  const flag = riaperto.prepare("SELECT value FROM settings WHERE key = 'migration_mac_normalize_v1'").get() as { value: string } | undefined;
  const h = riaperto.prepare("SELECT ip_assignment FROM hosts WHERE ip = '10.40.0.20'").get() as { ip_assignment: string };
  assert.equal(flag?.value, "1");
  assert.equal(h.ip_assignment, "dynamic", "il lease dinamico del router deve dare 'dynamic'");
});
