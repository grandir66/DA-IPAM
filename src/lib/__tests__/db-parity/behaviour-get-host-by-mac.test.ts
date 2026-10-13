/**
 * `getHostByMac` (NUC-2 gruppo 2, T3-07): una copia sola, quella tenant.
 *
 * Il MAC non è unico fra gli host (più interfacce, VRRP/HSRP, macchine
 * clonate). La copia della facciata prendeva una riga qualsiasi; la copia
 * tenant preferisce l'host con l'IP indicato e altrimenti il primo per id
 * (correzione B4 del 2026-06-23: vulnerabilità attribuite all'host sbagliato).
 *
 * Misura sulla copia del DB DTS (13/10): 106 MAC condivisi da 330 host; senza
 * IP preferito l'esito è lo stesso nelle due copie per tutti e 106.
 */
import { TEST_DATA_DIR } from "../support/data-dir-isolata";

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import type Database from "better-sqlite3";
import * as facciata from "@/lib/db";
import * as tenant from "@/lib/db-tenant";
import { closeHubDb } from "@/lib/db-hub";
import { RETE_SERVER, RETE_UFFICI, retiHostCredenziali } from "./gruppo1b/fixture";
import { nelTenant } from "./comportamento";

after(() => {
  facciata.closeDb();
  tenant.closeAllTenantDbs();
  closeHubDb();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

/** Lo stesso MAC su tre host: due interfacce dello stesso apparato e un clone. */
function macCondiviso(db: Database.Database): void {
  retiHostCredenziali(db);
  const h = db.prepare("INSERT INTO hosts (network_id, ip, mac, hostname, status) VALUES (?, ?, ?, ?, 'online')");
  h.run(RETE_SERVER, "10.41.0.50", "00:1A:2B:3C:4D:EE", "fw-lato-server");
  h.run(RETE_UFFICI, "10.40.0.50", "00:1a:2b:3c:4d:ee", "fw-lato-uffici");
  h.run(RETE_UFFICI, "10.40.0.51", "00-1A-2B-3C-4D-EE", "fw-clone");
}

test("getHostByMac: con l'IP preferito dà l'host con quell'IP", () => {
  const ip = nelTenant("ghbmpreferito", macCondiviso, () => facciata.getHostByMac("001A2B3C4DEE", "10.40.0.51")?.ip);
  assert.equal(ip, "10.40.0.51");
});

test("getHostByMac: senza IP preferito, o con un IP che non c'è, dà il primo per id", () => {
  const r = nelTenant("ghbmprimo", macCondiviso, (db) => {
    const primo = (db.prepare("SELECT MIN(id) id FROM hosts WHERE hostname LIKE 'fw-%'").get() as { id: number }).id;
    return { primo, senza: facciata.getHostByMac("00:1A:2B:3C:4D:EE")?.id, assente: facciata.getHostByMac("00:1A:2B:3C:4D:EE", "10.40.0.99")?.id };
  });
  assert.equal(r.senza, r.primo);
  assert.equal(r.assente, r.primo);
});

test("getHostByMac: MAC corto o sconosciuto, nessun host", () => {
  const r = nelTenant("ghbmnessuno", macCondiviso, () => [facciata.getHostByMac("00:1A"), facciata.getHostByMac("00:1A:2B:3C:4D:FF")]);
  assert.deepEqual(r, [undefined, undefined]);
});
