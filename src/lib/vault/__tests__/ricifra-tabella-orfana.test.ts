/**
 * La ricifra su un database che ha ancora tabelle figlie di una tabella tolta (15/11/2026, VM di laboratorio:
 * `inv_agent_license` e `inv_agent_runtime` citavano `inv_agent_report`, sparita con l'agente il 20/10).
 * Preparare un UPDATE su una tabella così fallisce con «no such table: main.…», anche a vuoto e anche se la tabella
 * non ha niente di cifrato. L'UPDATE si prepara solo quando c'è una riga da riscrivere.
 *
 * Run: node --import tsx --test src/lib/vault/__tests__/ricifra-tabella-orfana.test.ts
 */
import { TEST_DATA_DIR } from "@/lib/__tests__/support/data-dir-isolata";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import Database from "better-sqlite3";
import { closeHubDb } from "@/lib/db-hub";
import { closeTenantDb } from "@/lib/db-tenant";
import { ricifra } from "../ricifra";
import { chiudiVault, impostaChiaveDati } from "../stato";
import { popola } from "./support/dati-ricifra";

const T = "RICIFRAORF";
let K: Buffer;

before(() => {
  delete process.env.DA_VAULT_LOCALE;
  popola(T);
  K = randomBytes(32);
  process.env.DA_VAULT_LOCALE = "1";
  impostaChiaveDati(K, "passphrase");
  closeTenantDb(T);
  closeHubDb();
  const db = new Database(join(TEST_DATA_DIR, "tenants", `${T}.db`));
  db.exec("CREATE TABLE orfana_figlia (id INTEGER PRIMARY KEY, padre_id INTEGER NOT NULL REFERENCES padre_tolto(id) ON DELETE CASCADE, nota TEXT)");
  db.close();
});

after(() => {
  delete process.env.DA_VAULT_LOCALE;
  chiudiVault(null);
  closeTenantDb(T);
  closeHubDb();
});

describe("ricifra con una tabella figlia di una tabella tolta", () => {
  it("la prova a vuoto e la ricifra vera arrivano in fondo", () => {
    const vuoto = ricifra({ dataDir: TEST_DATA_DIR, chiaveNuova: K, applica: false });
    assert.ok(vuoto.totale > 0, "la prova non vale: niente da ricifrare");
    const vero = ricifra({ dataDir: TEST_DATA_DIR, chiaveNuova: K, applica: true });
    assert.equal(vero.totale, vuoto.totale);
  });
});
