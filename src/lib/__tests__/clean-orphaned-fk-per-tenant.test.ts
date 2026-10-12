/**
 * La pulizia dei riferimenti orfani gira su OGNI tenant, non solo sul primo.
 * Prima la bandierina «già fatto» era una sola per tutto il processo: sull'hub
 * con più tenant la pulizia avveniva sul primo database toccato e mai sugli
 * altri (NUC-2, revisione 2026-10-12).
 * Lanciare con DA_INVENT_DATA_DIR di prova.
 */
process.env.ENCRYPTION_KEY ||= "test-encryption-key-fk-per-tenant";

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { withTenant, getTenantDb, deleteTenantDatabase } from "@/lib/db-tenant";
import { cleanOrphanedForeignKeys } from "@/lib/db";

const TENANTS = ["TESTFKORFANIUNO", "TESTFKORFANIDUE"];
after(() => TENANTS.forEach((t) => deleteTenantDatabase(t)));

function orfanoIn(codice: string): void {
  const db = getTenantDb(codice);
  db.pragma("foreign_keys = OFF");
  db.prepare(
    "INSERT INTO mac_ip_mapping (mac_normalized, mac_display, ip, source, network_id, host_id) VALUES ('aabbcc0000ff', 'AA:BB:CC:00:00:FF', '10.40.0.9', 'arp', 900, 901)",
  ).run();
  db.pragma("foreign_keys = ON");
}

test("due tenant uno dopo l'altro: la pulizia gira su entrambi", () => {
  for (const codice of TENANTS) {
    withTenant(codice, () => {
      orfanoIn(codice);
      cleanOrphanedForeignKeys();
      const riga = getTenantDb(codice).prepare("SELECT network_id, host_id FROM mac_ip_mapping").get() as { network_id: number | null; host_id: number | null };
      assert.deepEqual(riga, { network_id: null, host_id: null }, `orfani rimasti nel tenant ${codice}`);
    });
  }
});
