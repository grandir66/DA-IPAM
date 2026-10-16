import { describe, it } from "node:test";
import assert from "node:assert";
import { withLockRetry, isLockError } from "../retry";

describe("isLockError", () => {
  it("riconosce 'database is locked'", () => {
    assert.equal(isLockError(new Error("database is locked")), true);
  });
  it("riconosce SQLITE_BUSY_SNAPSHOT", () => {
    assert.equal(isLockError(new Error("SQLITE_BUSY_SNAPSHOT: cannot start a transaction within a transaction")), true);
  });
  it("case-insensitive su BUSY/locked", () => {
    assert.equal(isLockError(new Error("Database Is LOCKED")), true);
  });
  it("errore non di lock → false", () => {
    assert.equal(isLockError(new Error("host non trovato")), false);
  });
  it("valore non Error → false", () => {
    assert.equal(isLockError("qualcosa"), false);
  });
});

describe("withLockRetry", () => {
  it("successo al primo tentativo: nessun retry, nessuna attesa", async () => {
    const waits: number[] = [];
    let calls = 0;
    const result = await withLockRetry(() => { calls++; return 42; }, {
      sleep: async (ms) => { waits.push(ms); },
    });
    assert.equal(result, 42);
    assert.equal(calls, 1);
    assert.deepEqual(waits, []);
  });

  it("fallisce 2 volte per lock poi riesce: 2 attese, 3 chiamate totali", async () => {
    const waits: number[] = [];
    let calls = 0;
    const result = await withLockRetry(() => {
      calls++;
      if (calls < 3) throw new Error("database is locked");
      return "ok";
    }, { sleep: async (ms) => { waits.push(ms); } });
    assert.equal(result, "ok");
    assert.equal(calls, 3);
    assert.deepEqual(waits, [500, 1500]);
  });

  it("esaurisce tutti i retry (3) su lock persistente: 4 chiamate, attese 500/1500/4000, poi rilancia l'errore originale", async () => {
    const waits: number[] = [];
    let calls = 0;
    await assert.rejects(
      () => withLockRetry(() => { calls++; throw new Error("SQLITE_BUSY_SNAPSHOT"); }, {
        sleep: async (ms) => { waits.push(ms); },
      }),
      /SQLITE_BUSY_SNAPSHOT/
    );
    assert.equal(calls, 4);
    assert.deepEqual(waits, [500, 1500, 4000]);
  });

  it("errore non di lock → rilancia subito, nessun retry/attesa", async () => {
    const waits: number[] = [];
    let calls = 0;
    await assert.rejects(
      () => withLockRetry(() => { calls++; throw new Error("colonna inesistente"); }, {
        sleep: async (ms) => { waits.push(ms); },
      }),
      /colonna inesistente/
    );
    assert.equal(calls, 1);
    assert.deepEqual(waits, []);
  });
});
