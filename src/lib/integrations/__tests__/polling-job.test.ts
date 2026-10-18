/**
 * Polling dell'avanzamento di un'installazione (passo 2 del piano di solidità,
 * 2026-10-16): ogni risposta deve dare un esito e, se il polling si ferma senza
 * esito, un messaggio. Prima un 401/404/500 o la rete giù lasciavano la
 * rotellina accesa per sempre, muta.
 */
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  interrogaJob,
  valutaRisposta,
  MAX_ERRORI_CONSECUTIVI,
  MSG_ESITO_SCONOSCIUTO,
  MSG_SESSIONE_SCADUTA,
} from "../polling-job";
import type { InstallJob } from "../types";

const fetchVero = globalThis.fetch;
let chiamate: string[] = [];
function finto(risposta: () => Promise<Response>) {
  chiamate = [];
  globalThis.fetch = ((input: string) => {
    chiamate.push(String(input));
    return risposta();
  }) as typeof fetch;
}
const json = (body: unknown, status: number) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));

function job(phase: InstallJob["phase"], extra: Partial<InstallJob> = {}): InstallJob {
  return { id: "j1", component: "librenms", phase, log: ["riga"], startedAt: "2026-10-16T10:00:00Z", ...extra };
}

describe("polling-job: interrogaJob con risposte finte", () => {
  afterEach(() => { globalThis.fetch = fetchVero; });

  it("200 con job in corso: continua, nessun messaggio, errori azzerati", async () => {
    finto(() => json(job("pulling"), 200));
    const p = await interrogaJob("j1", 3);
    assert.equal(p.esito, "in_corso");
    assert.equal(p.continua, true);
    assert.equal(p.errori, 0);
    assert.equal(p.messaggio, null);
    assert.equal(p.job?.phase, "pulling");
    assert.equal(chiamate[0], "/api/integrations/install-progress/j1");
  });

  it("200 con job finito bene o male: si ferma, l'esito è nel job", async () => {
    finto(() => json(job("done"), 200));
    const ok = await interrogaJob("j1", 0);
    assert.equal(ok.esito, "finito");
    assert.equal(ok.continua, false);
    assert.equal(ok.job?.phase, "done");

    finto(() => json(job("error", { error: "pull fallito" }), 200));
    const ko = await interrogaJob("j1", 0);
    assert.equal(ko.esito, "finito");
    assert.equal(ko.continua, false);
    assert.equal(ko.job?.error, "pull fallito");
  });

  it("401: sessione scaduta, polling fermo, lo dice", async () => {
    finto(() => json({ error: "Non autenticato" }, 401));
    const p = await interrogaJob("j1", 0);
    assert.equal(p.esito, "sessione_scaduta");
    assert.equal(p.continua, false);
    assert.equal(p.messaggio, MSG_SESSIONE_SCADUTA);
    assert.match(p.messaggio ?? "", /sessione scaduta/i);
  });

  it("404: esito sconosciuto perché il servizio è ripartito, polling fermo", async () => {
    finto(() => json({ error: "Job non trovato" }, 404));
    const p = await interrogaJob("j1", 0);
    assert.equal(p.esito, "esito_sconosciuto");
    assert.equal(p.continua, false);
    assert.equal(p.messaggio, MSG_ESITO_SCONOSCIUTO);
    assert.match(p.messaggio ?? "", /esito sconosciuto: il servizio è stato riavviato/i);
  });

  it("500: si riprova col messaggio a schermo, poi ci si ferma alla soglia", async () => {
    finto(() => json({ error: "Errore interno" }, 500));
    let errori = 0;
    for (let i = 1; i < MAX_ERRORI_CONSECUTIVI; i++) {
      const p = await interrogaJob("j1", errori);
      assert.equal(p.esito, "errore_temporaneo");
      assert.equal(p.continua, true);
      assert.equal(p.errori, i);
      assert.match(p.messaggio ?? "", /Errore interno/);
      assert.match(p.messaggio ?? "", new RegExp(`tentativo ${i} di ${MAX_ERRORI_CONSECUTIVI}`));
      errori = p.errori;
    }
    const ultimo = await interrogaJob("j1", errori);
    assert.equal(ultimo.esito, "errore_ripetuto");
    assert.equal(ultimo.continua, false);
    assert.match(ultimo.messaggio ?? "", /si è fermato/);
  });

  it("rete giù: conta come errore, con «Server non raggiungibile»; alla soglia si ferma", async () => {
    finto(() => Promise.reject(new TypeError("fetch failed")));
    const primo = await interrogaJob("j1", 0);
    assert.equal(primo.esito, "errore_temporaneo");
    assert.equal(primo.continua, true);
    assert.match(primo.messaggio ?? "", /raggiungibile/i);

    const ultimo = await interrogaJob("j1", MAX_ERRORI_CONSECUTIVI - 1);
    assert.equal(ultimo.esito, "errore_ripetuto");
    assert.equal(ultimo.continua, false);
    assert.match(ultimo.messaggio ?? "", /raggiungibile/i);
  });

  it("una risposta buona dopo errori azzera il conto", async () => {
    finto(() => json(job("creating"), 200));
    const p = await interrogaJob("j1", MAX_ERRORI_CONSECUTIVI - 1);
    assert.equal(p.errori, 0);
    assert.equal(p.continua, true);
  });

  it("200 che non è un job (es. HTML o corpo strano): errore, non avanzamento", async () => {
    finto(() => json({ qualcosa: true }, 200));
    const p = await interrogaJob("j1", 0);
    assert.equal(p.esito, "errore_temporaneo");
    assert.equal(p.job, null);
    assert.match(p.messaggio ?? "", /non valida/i);
  });
});

describe("polling-job: valutaRisposta", () => {
  it("nessun esito si ferma senza messaggio, tranne il job finito", () => {
    const casi = [
      valutaRisposta({ ok: false, status: 401, message: "x" }, 0),
      valutaRisposta({ ok: false, status: 404, message: "x" }, 0),
      valutaRisposta({ ok: false, status: 503, message: "x" }, MAX_ERRORI_CONSECUTIVI - 1),
      valutaRisposta({ ok: false, status: null, message: "x" }, MAX_ERRORI_CONSECUTIVI - 1),
    ];
    for (const p of casi) {
      assert.equal(p.continua, false);
      assert.ok(p.messaggio && p.messaggio.length > 0);
    }
  });

  it("la soglia si può cambiare", () => {
    const p = valutaRisposta({ ok: false, status: 500, message: "x" }, 1, 2);
    assert.equal(p.esito, "errore_ripetuto");
  });
});
