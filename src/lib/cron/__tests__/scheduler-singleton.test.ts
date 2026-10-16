/**
 * Lo scheduler deve avere UN SOLO elenco di cron per processo, anche quando il
 * modulo è caricato due volte (sotto tsx una rotta può vedere un'altra istanza
 * di `cron/scheduler`, come succedeva a `db-tenant` il 2026-09-02, ADR 0002).
 *
 * Difetto NUC-5, visto dal vivo sul cliente A il 2026-10-12: alle 15:04 il controllo
 * degli host è partito due volte nello stesso processo. Una rotta aveva chiamato
 * `reloadTenantScheduler` sulla sua copia del modulo: non vedeva i cron registrati
 * all'avvio, non li fermava e ne aggiungeva altri.
 *
 * Gira con DA_INVENT_DATA_DIR di prova, come tutto `npm test`.
 */
process.env.ENCRYPTION_KEY ||= "test-encryption-key-scheduler-singleton";

import { test } from "node:test";
import assert from "node:assert/strict";

test("due copie del modulo condividono i cron: la seconda ferma quelli della prima", () => {
  // seconda istanza dello stesso file, dipendenze condivise: come una rotta che
  // vede un'altra copia del modulo nello stesso processo
  const percorso = require.resolve("../scheduler");
  // require (non import): solo così si ottiene una seconda istanza del modulo
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const a = require(percorso) as typeof import("../scheduler");
  delete require.cache[percorso];
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const b = require(percorso) as typeof import("../scheduler");
  assert.notEqual(a, b, "servono due istanze distinte del modulo per la prova");

  const key = "TESTSINGLETON:1";
  a.scheduleJob(key, 1, 60, "TESTSINGLETON");
  try {
    assert.ok(a.activeJobKeys().includes(key));
    assert.ok(b.activeJobKeys().includes(key), "la seconda copia deve vedere il cron della prima");
    b.stopJob(key);
    assert.ok(!a.activeJobKeys().includes(key), "fermato dalla seconda copia, non deve restare attivo nella prima");
  } finally {
    a.stopJob(key);
  }
});
