/**
 * La pulizia dei riferimenti orfani gira su OGNI tenant, non solo sul primo.
 * Prima la bandierina «già fatto» era una sola per tutto il processo: sull'hub
 * con più tenant la pulizia avveniva sul primo database toccato e mai sugli
 * altri (NUC-2, revisione 2026-10-12).
 * La cartella dati è di prova (import per primo): senza, `npm test` dalla
 * cartella principale lavorerebbe nel `data/` vero di sviluppo.
 */
import { TEST_DATA_DIR } from "./support/data-dir-isolata";

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { withTenant, getTenantDb, deleteTenantDatabase, closeAllTenantDbs } from "@/lib/db-tenant";
import { cleanOrphanedForeignKeys } from "@/lib/db";

const TENANTS = ["TESTFKORFANIUNO", "TESTFKORFANIDUE"];
after(() => {
  TENANTS.forEach((t) => deleteTenantDatabase(t));
  closeAllTenantDbs();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

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
