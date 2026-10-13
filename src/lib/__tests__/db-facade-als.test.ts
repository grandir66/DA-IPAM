/**
 * La facciata `db.ts` riesporta le funzioni spostate in `db-tenant.ts` (NUC-2,
 * gruppo 1a, T3-05): qui si prova che la riesportazione è davvero la stessa
 * cosa, e non una seconda copia che può tornare a separarsi.
 *
 * - Identità: per ogni nome spostato, l'export di `db.ts` è lo STESSO oggetto
 *   funzione di `db-tenant.ts`.
 * - Contesto condiviso: `withTenant` preso dalla facciata e il codice letto da
 *   `db-tenant` e da `currentFacadeTenant` coincidono, anche dopo un `await`, e
 *   una lettura presa dalla facciata legge il database di quel tenant. Il test
 *   sugli import dinamici (`no-dynamic-db-tenant-import.test.ts`) vieta solo
 *   quelli: non dimostra che le due vie usino la stessa AsyncLocalStorage
 *   (incidente 2026-09-02: una seconda istanza di `db-tenant` aveva il contesto
 *   vuoto e i dati finirono nel tenant sbagliato). Lo dimostra questa prova,
 *   eseguita con tsx come le installazioni da sorgente.
 * - Fuori contesto una lettura spostata non ripiega più: lancia, e non apre né
 *   DEFAULT né il vecchio `ipam.db` (la copia della facciata ripiegava).
 */
import { TEST_DATA_DIR } from "./support/data-dir-isolata";

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import * as facciata from "@/lib/db";
import * as tenant from "@/lib/db-tenant";
import { SPOSTATE } from "./support/facciata-spostate";

const TENANT_A = "TESTALSFACCIATAA";
const TENANT_B = "TESTALSFACCIATAB";

after(() => {
  tenant.deleteTenantDatabase(TENANT_A);
  tenant.deleteTenantDatabase(TENANT_B);
  facciata.closeDb();
  tenant.closeAllTenantDbs();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

test("ogni funzione spostata: db.ts esporta lo stesso oggetto di db-tenant.ts", () => {
  const f = facciata as unknown as Record<string, unknown>;
  const t = tenant as unknown as Record<string, unknown>;
  const nonFunzioni = SPOSTATE.filter((n) => typeof t[n] !== "function");
  assert.deepEqual(nonFunzioni, [], "nomi spostati che db-tenant.ts non esporta come funzione");
  const copie = SPOSTATE.filter((n) => f[n] !== t[n]);
  assert.deepEqual(copie, [], "db.ts ha ancora una copia propria di queste funzioni");
});

test("withTenant della facciata: db-tenant e currentFacadeTenant vedono lo stesso codice, anche dopo un await", async () => {
  await facciata.withTenant(TENANT_A, async () => {
    assert.equal(tenant.getCurrentTenantCode(), TENANT_A);
    assert.equal(facciata.currentFacadeTenant(), TENANT_A);
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(tenant.getCurrentTenantCode(), TENANT_A);
    assert.equal(facciata.currentFacadeTenant(), TENANT_A);
  });
  assert.equal(tenant.getCurrentTenantCode(), null);
  assert.equal(facciata.currentFacadeTenant(), null);
});

test("una lettura presa dalla facciata legge il database del tenant del contesto", () => {
  tenant
    .getTenantDb(TENANT_A)
    .prepare("INSERT INTO networks (cidr, name) VALUES (?, ?)")
    .run("10.77.0.0/24", "Rete del tenant A");
  tenant.getTenantDb(TENANT_B); // vuoto

  const inA = facciata.withTenant(TENANT_A, () => facciata.getNetworks().map((n) => n.cidr));
  const inB = facciata.withTenant(TENANT_B, () => facciata.getNetworks().map((n) => n.cidr));
  assert.deepEqual(inA, ["10.77.0.0/24"]);
  assert.deepEqual(inB, []);
});

test("fuori contesto una lettura spostata lancia e non apre DEFAULT né ipam.db", () => {
  const defaultDb = path.join(TEST_DATA_DIR, "tenants", "DEFAULT.db");
  const legacyDb = path.join(TEST_DATA_DIR, "ipam.db");
  assert.equal(tenant.getCurrentTenantCode(), null);
  assert.throws(() => facciata.getNetworks(), /Nessun contesto tenant/);
  assert.ok(!fs.existsSync(defaultDb), "la lettura ha aperto DEFAULT.db");
  assert.ok(!fs.existsSync(legacyDb), "la lettura ha aperto il vecchio ipam.db");
});
