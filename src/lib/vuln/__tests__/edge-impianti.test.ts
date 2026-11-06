/**
 * Gli impianti arrivano a Edge, che li toglie da ogni motore (72729, 06/11/2026: celle frigo
 * bloccate). Edge da solo non conosce il costruttore: HMS e Schneider del 72729 hanno classe `unknown`.
 *
 * Run: node --import tsx --test src/lib/vuln/__tests__/edge-impianti.test.ts
 */
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "0".repeat(64);
import "@/lib/__tests__/support/data-dir-isolata";

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { closeHubDb } from "@/lib/db-hub";
import { closeTenantDb, deleteTenantDatabase, getTenantDb, withTenant } from "@/lib/db-tenant";
import { impiantiDaMandare } from "@/lib/vuln/edge-credenziali-esito";
import { ipImpiantiDellaRete } from "@/lib/vuln/edge-subnet-bridge";

const T = "EDGEIMP06";

after(() => {
  try { closeTenantDb(T); deleteTenantDatabase(T); } catch { /* già tolto */ }
  closeHubDb();
});

test("si riconoscono per classe, costruttore e porta; un PC no", async () => {
  await withTenant(T, async () => {
    const d = getTenantDb(T);
    const n = Number(d.prepare("INSERT INTO networks (cidr, name) VALUES ('10.5.0.0/24', 'x')").run().lastInsertRowid);
    const h = d.prepare("INSERT INTO hosts (network_id, ip, status, classification, vendor, open_ports) VALUES (?, ?, 'online', ?, ?, ?)");
    h.run(n, "10.5.0.1", "workstation", "HP Inc.", null);
    h.run(n, "10.5.0.2", "plc", "CREVIS Co., LTD", null);
    h.run(n, "10.5.0.3", "unknown", "HMS Industrial Networks", null);
    h.run(n, "10.5.0.4", "unknown", null, JSON.stringify([{ port: 502 }]));
    assert.deepEqual(ipImpiantiDellaRete(n), ["10.5.0.2", "10.5.0.3", "10.5.0.4"]);
  });
});

test("si manda solo quello che la sonda non ha", () => {
  assert.deepEqual(impiantiDaMandare(["10.5.0.2"], ["10.5.0.2", "10.5.0.3"]), false);
  assert.deepEqual(impiantiDaMandare(["10.5.0.2", "10.5.0.3"], ["10.5.0.2"]), true);
  assert.deepEqual(impiantiDaMandare(["10.5.0.2"], undefined), true);
  assert.deepEqual(impiantiDaMandare([], undefined), false);
});
