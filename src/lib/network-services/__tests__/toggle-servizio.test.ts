/**
 * Accensione/spegnimento di un servizio del bridge (passo 2 del piano di
 * solidità, 2026-10-16): una funzione sola per le due pagine, che non lancia mai
 * e porta sempre un messaggio.
 */
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { toggleServizio } from "../toggle-servizio";

const fetchVero = globalThis.fetch;
let corpo: string | null = null;
function finto(risposta: () => Promise<Response>) {
  globalThis.fetch = ((_input: string, init?: RequestInit) => {
    corpo = typeof init?.body === "string" ? init.body : null;
    return risposta();
  }) as typeof fetch;
}
const json = (body: unknown, status: number) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));

describe("toggleServizio", () => {
  afterEach(() => { globalThis.fetch = fetchVero; });

  it("riuscito: messaggio di conferma, manda enable", async () => {
    finto(() => json({ ok: true, results: [] }, 200));
    const e = await toggleServizio("dns", true, "DNS autoritativo");
    assert.deepEqual(e, { ok: true, messaggio: "DNS autoritativo abilitato" });
    assert.deepEqual(JSON.parse(corpo ?? "{}"), { enable: true });
  });

  it("bridge che fallisce (502): il dettaglio del server", async () => {
    finto(() => json({ ok: false, error: "pdns.service: systemctl error" }, 502));
    const e = await toggleServizio("dns", false, "DNS autoritativo");
    assert.equal(e.ok, false);
    assert.match(e.messaggio, /disabilitazione non riuscita — pdns\.service: systemctl error/);
  });

  it("200 con ok:false: il dettaglio dalle unità", async () => {
    finto(() => json({ ok: false, results: [{ unit: "kea", out: "failed" }] }, 200));
    const e = await toggleServizio("dhcp", true, "DHCP");
    assert.equal(e.ok, false);
    assert.match(e.messaggio, /kea: failed/);
  });

  it("sessione scaduta: lo dice", async () => {
    finto(() => json({ error: "Non autenticato" }, 401));
    const e = await toggleServizio("adblock", true, "Filtro DNS");
    assert.equal(e.ok, false);
    assert.match(e.messaggio, /sessione scaduta/i);
  });

  it("rete giù: non lancia, lo dice", async () => {
    finto(() => Promise.reject(new TypeError("fetch failed")));
    const e = await toggleServizio("resolver", true, "Resolver");
    assert.equal(e.ok, false);
    assert.match(e.messaggio, /raggiungibile/i);
  });
});
