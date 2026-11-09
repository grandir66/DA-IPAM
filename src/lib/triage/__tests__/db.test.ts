/**
 * Triage dei rilievi su un tenant vero in cartella isolata.
 * Run: node --import tsx --test src/lib/triage/__tests__/db.test.ts
 */
import "@/lib/__tests__/support/data-dir-isolata";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { closeHubDb } from "@/lib/db-hub";
import { closeTenantDb, deleteTenantDatabase, getTenantDb, withTenant } from "@/lib/db-tenant";
import { conteggiTriage, getTriage, setTriage } from "../db";

const T = "PROVATRIAGE";
after(() => {
  closeTenantDb(T);
  deleteTenantDatabase(T);
  closeHubDb();
});

test("stato e nota: scrittura, lettura a blocchi, conteggi", () => {
  withTenant(T, () => {
    const d = getTenantDb(T);
    setTriage(d, "CVE-2025-1", "in_corso", "  provata la 443  ", "mario");
    setTriage(d, "nvt:1.3.6", "fatto", "falso positivo", "mario");
    const m = getTriage(d, ["CVE-2025-1", "nvt:1.3.6", "CVE-ignota"]);
    assert.equal(m["CVE-2025-1"].stato, "in_corso");
    assert.equal(m["CVE-2025-1"].nota, "provata la 443"); // trim
    assert.equal(m["CVE-ignota"], undefined);
    assert.deepEqual(conteggiTriage(d), { da_fare: 0, in_corso: 1, fatto: 1, ignorato: 0 });
  });
});

test("da_fare con nota vuota cancella la riga; con nota resta", () => {
  withTenant(T, () => {
    const d = getTenantDb(T);
    setTriage(d, "CVE-2025-1", "da_fare", "", "mario"); // torna allo stato di partenza
    assert.equal(getTriage(d, ["CVE-2025-1"])["CVE-2025-1"], undefined);
    setTriage(d, "nvt:1.3.6", "da_fare", "lo rivedo dopo", "mario"); // nota conservata
    assert.equal(getTriage(d, ["nvt:1.3.6"])["nvt:1.3.6"].stato, "da_fare");
  });
});
