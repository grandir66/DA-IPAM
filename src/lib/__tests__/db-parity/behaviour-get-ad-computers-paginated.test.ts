/**
 * `getAdComputersPaginated` (NUC-2 gruppo 2, T3-07): una copia sola, quella tenant.
 *
 * Il filtro «attivi negli ultimi N giorni» confrontava come testo l'ultimo
 * accesso, scritto nella forma ISO con la `T`, con `datetime('now', …)`, che
 * ha lo spazio: nel giorno di confine la `T` vince sempre e passavano accessi
 * fuori dalla finestra di qualche ora. La copia tenant porta la data nella forma
 * di SQLite prima del confronto.
 *
 * Misura sulla copia del DB DTS (13/10): ad_computers 240 date ISO su 241,
 * ad_users 101 su 104; con la finestra di 7 giorni gli utenti attivi passano da
 * 63 a 61, i computer restano 71; con 30, 90 e 365 giorni nessuna differenza.
 */
import { TEST_DATA_DIR } from "../support/data-dir-isolata";

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as facciata from "@/lib/db";
import * as tenant from "@/lib/db-tenant";
import { closeHubDb } from "@/lib/db-hub";
import { adConAccessi, nelTenant } from "./comportamento";

after(() => {
  facciata.closeDb();
  tenant.closeAllTenantDbs();
  closeHubDb();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

test("getAdComputersPaginated: attivi negli ultimi 7 giorni, con le date ISO e con quelle di SQLite", () => {
  const r = nelTenant("computer7g", adConAccessi("ad_computers"), () => facciata.getAdComputersPaginated(1, 1, 50, undefined, 7));
  assert.deepEqual(r.rows.map((x) => x.sam_account_name).sort(), ["recente-iso", "recente-sqlite"]);
  assert.equal(r.total, 2);
});

test("getAdComputersPaginated: senza finestra tutti, ordinati per nome; la pagina conta il totale", () => {
  const r = nelTenant("computertutti", adConAccessi("ad_computers"), () => facciata.getAdComputersPaginated(1, 2, 2));
  assert.equal(r.total, 5);
  assert.deepEqual(r.rows.map((x) => x.sam_account_name), ["recente-iso", "recente-sqlite"]);
});
