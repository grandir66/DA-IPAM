// L'interruttore della mappa nuova (spec §13.5.6, §13.11.4, T3.7): `topologia.mappa.cavi` in tenant_settings del DB del
// cliente, stessa forma delle letture di T2. Chiave assente, JSON rovinato o `acceso` diverso da `true` = SPENTO (D4): un
// cliente che non dichiara niente vede la mappa di T1. Spento si scrive comunque, con chi e quando: è la storia.
import { removeTestHubDb } from "@/lib/integrations/__tests__/support/hub-isolato";
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { closeHubDb } from "@/lib/db-hub";
import { deleteTenantDatabase, getTenantDb, getTenantSetting, setTenantSetting, withTenant } from "@/lib/db-tenant";
import { CHIAVE_MAPPA_CAVI, leggiMappaCavi, mappaCaviAccesa, scriviMappaCavi } from "@/lib/topology/letture/mappa";

const T = "TESTMAPPACAVI";
beforeEach(() => { getTenantDb(T).exec("DELETE FROM tenant_settings WHERE key LIKE 'topologia.%'"); });
after(() => { deleteTenantDatabase(T); closeHubDb(); removeTestHubDb(); });

test("la chiave è quella della spec", () => {
  assert.equal(CHIAVE_MAPPA_CAVI, "topologia.mappa.cavi");
});

test("chiave assente → spento, senza chi né quando", () => {
  withTenant(T, () => {
    assert.deepEqual(leggiMappaCavi(), { acceso: false, da: null, il: null });
    assert.equal(mappaCaviAccesa(), false);
  });
});

test("JSON rovinato o `acceso` diverso da true → spento", () => {
  withTenant(T, () => {
    for (const v of ["{", "true", '{"acceso":"true"}', '{"acceso":1}', "[]", "null"]) {
      setTenantSetting(CHIAVE_MAPPA_CAVI, v);
      assert.equal(mappaCaviAccesa(), false, v);
      assert.equal(leggiMappaCavi().acceso, false, v);
    }
  });
});

test("accesa e spenta, con chi e quando in UTC; le letture di T2 non si toccano", () => {
  withTenant(T, () => {
    assert.deepEqual(scriviMappaCavi(true, "prova", new Date("2026-10-16T08:00:00Z")), { acceso: true, da: "prova", il: "2026-10-16 08:00:00" });
    assert.deepEqual(leggiMappaCavi(), { acceso: true, da: "prova", il: "2026-10-16 08:00:00" });
    assert.equal(mappaCaviAccesa(), true);
    assert.deepEqual(scriviMappaCavi(false, "prova", new Date("2026-10-16T09:30:00Z")), { acceso: false, da: "prova", il: "2026-10-16 09:30:00" });
    assert.deepEqual(leggiMappaCavi(), { acceso: false, da: "prova", il: "2026-10-16 09:30:00" });
    assert.equal(mappaCaviAccesa(), false);
    assert.equal(getTenantSetting("topologia.lettura.mikrotik"), null, "l'interruttore della mappa non scrive quelli delle letture");
  });
});
