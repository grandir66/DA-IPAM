/**
 * da-vault (ADR 0035, rilievo di revisione): `putSync` ferma il thread. Prima ogni richiesta (login, POST, GET di
 * rilettura, secondo login dopo un 403) aveva il suo timeout: nel caso peggiore ~15-20 s di blocco. Ora UN budget per
 * chiamata, con una scadenza condivisa: ogni richiesta ha al più il tempo che resta.
 *
 * Run: node --import tsx --test src/lib/vault/__tests__/sync-budget.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { OpenBaoStore } from "../openbao";
import { ErroreVault } from "../tipi";
import type { FetchSync } from "../fetch-sync";

const dormi = (ms: number): void => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
};

/** Un trasporto finto: ogni richiesta "dura" `durate[i]` ms (o fino al suo timeout, se è più corto, e allora scade). */
function trasporto(durate: number[], usati: number[]): FetchSync {
  let i = 0;
  return (url, r) => {
    usati.push(r.timeoutMs);
    const dura = durate[i++] ?? 0;
    if (dura > r.timeoutMs) {
      dormi(r.timeoutMs);
      throw new ErroreVault("non_raggiungibile", "OpenBao non risponde (TimeoutError)");
    }
    dormi(dura);
    if (url.endsWith("auth/approle/login")) return { status: 200, testo: JSON.stringify({ auth: { client_token: "t", lease_duration: 3600 } }) };
    if (r.method === "GET") return { status: 200, testo: JSON.stringify({ data: { data: { password: "p" } } }) };
    return { status: 200, testo: "{}" };
  };
}

const store = (fetchSync: FetchSync) =>
  new OpenBaoStore({ url: "http://x", roleId: "r", secretId: () => "s", cartelle: [], timeoutSyncMs: 600, fetchSync });

describe("putSync: un solo budget", () => {
  it("login lento + scrittura lenta + rilettura che si pianta: ogni richiesta ha solo il tempo che resta, il totale non supera il budget", () => {
    // Guasto provato: con un timeout per richiesta la rilettura avrebbe avuto di nuovo 600 ms (totale ~1100+).
    const usati: number[] = [];
    const s = store(trasporto([200, 200, 99_999], usati));
    const t = Date.now();
    assert.throws(() => s.putSync("clienti/c1/da-ipam/x-1", { password: "p" }), (e: unknown) => e instanceof ErroreVault && e.codice === "non_raggiungibile");
    const durata = Date.now() - t;
    assert.equal(usati.length, 3);
    assert.ok(usati[0] <= 600 && usati[1] <= 420 && usati[2] <= 220, `timeout dati alle richieste: ${usati.join(", ")}`);
    assert.ok(durata < 600 + 150, `durata ${durata} ms (budget 600)`);
  });

  it("dopo una chiamata il budget si azzera: la successiva ha di nuovo tutto il suo tempo", () => {
    const usati: number[] = [];
    const s = store(trasporto([0, 0, 0, 0, 0, 0], usati));
    s.putSync("clienti/c1/da-ipam/x-1", { password: "p" });
    s.getSync("clienti/c1/da-ipam/x-1");
    assert.ok(usati[usati.length - 1] > 500, `timeout della richiesta dopo: ${usati[usati.length - 1]}`);
  });
});
