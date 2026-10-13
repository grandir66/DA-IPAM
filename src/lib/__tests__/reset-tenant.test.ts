/**
 * Reset del cliente (decisione di Riccardo, 13/10): dalla fusione delle copie del
 * database (T3-07) «Reset configurazione» cancella davvero i dati del tenant.
 * Si prova che: un codice sbagliato non cancella e non copia niente; con il codice
 * giusto la copia esiste e contiene i dati PRIMA che il tenant venga svuotato; se la
 * copia non si può fare, non si cancella niente.
 */
import { TEST_DATA_DIR } from "./support/data-dir-isolata";

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import * as tenant from "@/lib/db-tenant";
import { resetTenantConCopia, ResetRifiutato, cartellaCopieReset } from "@/lib/reset/reset-tenant";

const T = "TESTRESETCOPIA";
const ORA = new Date(2026, 9, 13, 10, 0, 0);

function semina() {
  tenant.getTenantDb(T).prepare("DELETE FROM networks").run();
  tenant.withTenant(T, () => {
    tenant.createNetwork({ cidr: "10.99.0.0/24", name: "rete di prova" } as Parameters<typeof tenant.createNetwork>[0]);
  });
}
const reti = () => (tenant.getTenantDb(T).prepare("SELECT count(*) n FROM networks").get() as { n: number }).n;

after(() => {
  tenant.deleteTenantDatabase(T);
  tenant.closeAllTenantDbs();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

test("codice sbagliato: niente copia, niente cancellato", async () => {
  semina();
  await tenant.withTenant(T, async () => {
    await assert.rejects(resetTenantConCopia(T, "ALTRO", ORA), ResetRifiutato);
  });
  assert.equal(reti(), 1);
  assert.equal(fs.existsSync(path.join(cartellaCopieReset(), `${T}-pre-reset-20261013-100000.db`)), false);
});

test("codice giusto: copia con i dati, poi il tenant è vuoto", async () => {
  semina();
  const nome = await tenant.withTenant(T, () => resetTenantConCopia(T, ` ${T} `, ORA));
  assert.equal(nome, `${T}-pre-reset-20261013-100000.db`);
  assert.equal(reti(), 0);
  const copia = new Database(path.join(cartellaCopieReset(), nome), { readonly: true });
  assert.equal((copia.prepare("SELECT count(*) n FROM networks").get() as { n: number }).n, 1);
  copia.close();
});

test("copia impossibile: niente cancellato", async () => {
  semina();
  const cartella = cartellaCopieReset();
  fs.rmSync(cartella, { recursive: true, force: true });
  fs.writeFileSync(cartella, "non sono una cartella");
  try {
    await tenant.withTenant(T, async () => {
      await assert.rejects(resetTenantConCopia(T, T, ORA));
    });
    assert.equal(reti(), 1);
  } finally {
    fs.rmSync(cartella, { force: true });
  }
});
