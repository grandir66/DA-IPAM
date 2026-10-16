/**
 * Un errore del server non deve diventare "lista vuota". Difetto UI-7 (analisi
 * 2026-10-12): Scansioni, IP esclusi, Anomalie e Tabella ARP trasformavano un
 * 401/409/500 o un server irraggiungibile in "Nessuna scansione eseguita" o in
 * dati vecchi lasciati a schermo. `fetchJson` distingue i casi e porta un
 * messaggio leggibile.
 */
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { fetchJson } from "../fetch-json";

const fetchVero = globalThis.fetch;
function finto(risposta: () => Promise<Response>) {
  globalThis.fetch = (() => risposta()) as typeof fetch;
}
const json = (body: unknown, status: number) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));

describe("fetchJson", () => {
  afterEach(() => { globalThis.fetch = fetchVero; });

  it("risposta buona: i dati", async () => {
    finto(() => json([{ id: 1 }], 200));
    assert.deepEqual(await fetchJson("/api/x"), { ok: true, data: [{ id: 1 }] });
  });

  it("errore del server: il suo messaggio, non una lista vuota", async () => {
    finto(() => json({ error: "Errore nel recupero dello storico" }, 500));
    const r = await fetchJson("/api/x");
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.status, 500);
      assert.equal(r.message, "Errore nel recupero dello storico");
    }
  });

  it("sessione scaduta: lo dice", async () => {
    finto(() => Promise.resolve(new Response("", { status: 401 })));
    const r = await fetchJson("/api/x");
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.message, /sessione/i);
  });

  it("errore senza testo: il codice HTTP", async () => {
    finto(() => Promise.resolve(new Response("<html>", { status: 502 })));
    const r = await fetchJson("/api/x");
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.message, /502/);
  });

  it("server irraggiungibile: lo dice", async () => {
    finto(() => Promise.reject(new TypeError("fetch failed")));
    const r = await fetchJson("/api/x");
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.status, null);
      assert.match(r.message, /raggiungibile/i);
    }
  });

  it("sessione scaduta vera: il proxy rimanda a /login e arriva la pagina HTML con 200", async () => {
    // NextAuth non risponde 401 alle /api: fa 307 verso /login e fetch segue il rinvio
    // (revisione 2026-10-12, riprodotto con il proxy vero).
    finto(() => {
      const r = new Response("<html>login</html>", { status: 200, headers: { "Content-Type": "text/html" } });
      Object.defineProperty(r, "redirected", { value: true });
      Object.defineProperty(r, "url", { value: "http://localhost/login?callbackUrl=%2Fapi%2Fx" });
      return Promise.resolve(r);
    });
    const r = await fetchJson("/api/x");
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.status, 401);
      assert.match(r.message, /sessione/i);
    }
  });

  it("200 ma il corpo non è JSON: errore, non dati vuoti", async () => {
    finto(() => Promise.resolve(new Response("<html>", { status: 200, headers: { "Content-Type": "text/html" } })));
    const r = await fetchJson("/api/x");
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.message, /non valida/i);
  });

  it("richiesta annullata: rilancia, così il chiamante la ignora", async () => {
    finto(() => Promise.reject(new DOMException("aborted", "AbortError")));
    await assert.rejects(fetchJson("/api/x"), { name: "AbortError" });
  });
});
