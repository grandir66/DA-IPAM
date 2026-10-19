/**
 * «Aggiorna ora» passa dal servizio d'aggiornamento (passo 1c, 16/10/2026): lettura
 * dello stato, avanzamento dopo il clic, quando smettere di seguirlo, avvio del
 * servizio con systemctl finto.
 *
 * Run: node --import tsx --test src/lib/__tests__/aggiornamento-stato.test.ts
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  decidiSeguito,
  ERRORI_DI_FILA_MAX,
  interpretaStatoAggiornamento,
  SEGUITO_MAX_MS,
  STATO_VUOTO,
  valutaAvanzamento,
  type StatoAggiornamento,
} from "../aggiornamento-stato";
import {
  avviaAggiornamento,
  cartellaBuildAttiva,
  leggiRichiestaInAttesa,
  leggiStatoAggiornamento,
  unitaAggiornamento,
} from "../aggiornamento-servizio";

const T0 = "2026-10-16T10:00:00.000Z";
const PRIMA = "2026-10-16T09:00:00.000Z";
const DOPO = "2026-10-16T10:01:00.000Z";

function statoCon(parziale: Partial<StatoAggiornamento>): StatoAggiornamento {
  return { ...STATO_VUOTO, ...parziale };
}

function tentativo(esito: "in_corso" | "riuscito" | "fallito" | "interrotto" | "pronto_non_avviato", iniziatoIl: string, extra = {}) {
  return {
    commit: "a".repeat(40),
    daCommit: null,
    iniziatoIl,
    finitoIl: null,
    fase: "build",
    esito,
    messaggio: null,
    avvisi: [],
    tentativi: 1,
    ...extra,
  };
}

describe("interpretaStatoAggiornamento", () => {
  test("il file di scripts/stato-aggiornamento.mjs si legge per intero", () => {
    const s = interpretaStatoAggiornamento({
      commit_avviato: "abc",
      ultimo_tentativo: {
        commit: "def",
        da_commit: "abc",
        iniziato_il: T0,
        finito_il: DOPO,
        fase: "salute",
        esito: "fallito",
        messaggio: "fase salute: l'app non risponde",
        avvisi: ["uno", 2],
        tentativi: 2,
      },
      ultimo_successo: { commit: "abc", il: PRIMA, nota: null },
      ultimo_controllo: { il: DOPO, esito: "aggiornamento_avviato", richiesto_da_interfaccia: true },
    });
    assert.equal(s.commitAvviato, "abc");
    assert.equal(s.ultimoTentativo?.esito, "fallito");
    assert.equal(s.ultimoTentativo?.fase, "salute");
    assert.deepEqual(s.ultimoTentativo?.avvisi, ["uno"], "gli avvisi che non sono testo si scartano");
    assert.equal(s.ultimoTentativo?.tentativi, 2);
    assert.equal(s.ultimoSuccesso?.il, PRIMA);
    assert.deepEqual(s.ultimoControllo, { il: DOPO, esito: "aggiornamento_avviato", richiestoDaInterfaccia: true });
  });

  test("forme strane non rompono la pagina", () => {
    assert.deepEqual(interpretaStatoAggiornamento(null), STATO_VUOTO);
    assert.deepEqual(interpretaStatoAggiornamento([1, 2]), STATO_VUOTO);
    const s = interpretaStatoAggiornamento({
      commit_avviato: 7,
      ultimo_tentativo: { esito: "riuscito" },
      ultimo_controllo: { il: T0, esito: "inventato" },
    });
    assert.deepEqual(s, STATO_VUOTO);
  });
});

describe("valutaAvanzamento", () => {
  test("conta solo ciò che succede dopo il clic", () => {
    const vecchio = statoCon({
      ultimoTentativo: tentativo("fallito", PRIMA),
      ultimoControllo: { il: PRIMA, esito: "gia_aggiornato", richiestoDaInterfaccia: false },
    });
    assert.deepEqual(valutaAvanzamento(vecchio, T0), { tipo: "in_attesa" });
  });

  test("tentativo nuovo: in corso, riuscito, fallito con messaggio, interrotto", () => {
    assert.deepEqual(valutaAvanzamento(statoCon({ ultimoTentativo: tentativo("in_corso", DOPO) }), T0), {
      tipo: "in_corso",
      fase: "build",
    });
    assert.equal(valutaAvanzamento(statoCon({ ultimoTentativo: tentativo("riuscito", DOPO) }), T0).tipo, "riuscito");
    assert.deepEqual(
      valutaAvanzamento(statoCon({ ultimoTentativo: tentativo("fallito", DOPO, { messaggio: "fase build: rotto" }) }), T0),
      { tipo: "fallito", messaggio: "fase build: rotto" },
    );
    const interrotto = valutaAvanzamento(statoCon({ ultimoTentativo: tentativo("interrotto", DOPO) }), T0);
    assert.equal(interrotto.tipo, "fallito");
    assert.match(interrotto.tipo === "fallito" ? interrotto.messaggio : "", /interrotto/);
  });

  test("giro senza tentativo: già aggiornato, solo documentazione, fetch fallito", () => {
    const conControllo = (esito: "gia_aggiornato" | "solo_documentazione" | "fetch_fallito" | "aggiornamento_avviato") =>
      statoCon({ ultimoControllo: { il: DOPO, esito, richiestoDaInterfaccia: true } });
    assert.deepEqual(valutaAvanzamento(conControllo("gia_aggiornato"), T0), { tipo: "nessuna_novita" });
    assert.equal(valutaAvanzamento(conControllo("solo_documentazione"), T0).tipo, "riuscito");
    assert.equal(valutaAvanzamento(conControllo("fetch_fallito"), T0).tipo, "fallito");
    assert.equal(valutaAvanzamento(conControllo("aggiornamento_avviato"), T0).tipo, "in_corso");
  });
});

describe("decidiSeguito", () => {
  const base = { erroriDiFila: 0, trascorsiMs: 1000 };
  test("in corso si continua; esiti finali si ferma", () => {
    assert.deepEqual(decidiSeguito({ ...base, status: 200, avanzamento: { tipo: "in_corso", fase: "build" } }), {
      azione: "continua",
      erroriDiFila: 0,
    });
    for (const [tipo, motivo] of [
      ["riuscito", "riuscito"],
      ["nessuna_novita", "nessuna_novita"],
    ] as const) {
      const avanzamento = tipo === "riuscito" ? { tipo, nota: null } : { tipo };
      assert.deepEqual(decidiSeguito({ ...base, status: 200, avanzamento }), { azione: "ferma", motivo });
    }
    assert.deepEqual(decidiSeguito({ ...base, status: 200, avanzamento: { tipo: "fallito", messaggio: "x" } }), {
      azione: "ferma",
      motivo: "fallito",
    });
  });

  test("durante il riavvio la rete giù o un 502 si tollerano, poi ci si ferma con una spiegazione", () => {
    assert.deepEqual(decidiSeguito({ ...base, status: null, avanzamento: null }), { azione: "continua", erroriDiFila: 1 });
    assert.deepEqual(decidiSeguito({ ...base, status: 502, avanzamento: null, erroriDiFila: 5 }), {
      azione: "continua",
      erroriDiFila: 6,
    });
    assert.deepEqual(decidiSeguito({ ...base, status: null, avanzamento: null, erroriDiFila: ERRORI_DI_FILA_MAX }), {
      azione: "ferma",
      motivo: "irraggiungibile",
    });
  });

  test("sessione scaduta e tempo massimo fermano il seguito", () => {
    assert.deepEqual(decidiSeguito({ ...base, status: 401, avanzamento: null }), { azione: "ferma", motivo: "sessione" });
    assert.deepEqual(
      decidiSeguito({ status: 200, avanzamento: { tipo: "in_corso", fase: null }, erroriDiFila: 0, trascorsiMs: SEGUITO_MAX_MS + 1 }),
      { azione: "ferma", motivo: "tempo" },
    );
  });
});

describe("aggiornamento-servizio", () => {
  test("l'unità d'aggiornamento è quella dell'app con -update", () => {
    assert.equal(unitaAggiornamento("da-ipam.service"), "da-ipam-update.service");
    assert.equal(unitaAggiornamento("da-invent.service"), "da-invent-update.service");
    assert.equal(unitaAggiornamento(null), null);
    assert.equal(unitaAggiornamento("da-ipam-update.service"), null, "mai il servizio d'aggiornamento di se stesso");
  });

  test("avvio riuscito: richiesta lasciata con l'ora, systemctl --no-block start", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agg-servizio-"));
    const richiesta = path.join(dir, "data", "aggiornamento-richiesto");
    const chiamate: string[][] = [];
    const esito = await avviaAggiornamento(
      "da-ipam-update.service",
      async (args) => {
        chiamate.push(args);
        return { codice: 0, stderr: "" };
      },
      richiesta,
    );
    assert.equal(esito.ok, true);
    assert.deepEqual(chiamate, [["--no-block", "start", "da-ipam-update.service"]]);
    assert.equal(leggiRichiestaInAttesa(richiesta), esito.ok ? esito.richiestoIl : "");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("avvio rifiutato: errore leggibile e nessuna richiesta lasciata al timer", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agg-servizio-"));
    const richiesta = path.join(dir, "aggiornamento-richiesto");
    const esito = await avviaAggiornamento(
      "da-ipam-update.service",
      async () => ({ codice: 4, stderr: "Access denied" }),
      richiesta,
    );
    assert.equal(esito.ok, false);
    assert.match(esito.ok ? "" : esito.errore, /Access denied/);
    assert.equal(fs.existsSync(richiesta), false);
    assert.equal(leggiRichiestaInAttesa(richiesta), null);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("file di stato assente o a metà: stato vuoto, nessun errore", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agg-servizio-"));
    const file = path.join(dir, "aggiornamento.json");
    assert.deepEqual(leggiStatoAggiornamento(file), STATO_VUOTO);
    fs.writeFileSync(file, '{"commit_avviato": "ab');
    assert.deepEqual(leggiStatoAggiornamento(file), STATO_VUOTO);
    fs.writeFileSync(file, JSON.stringify({ commit_avviato: "abc" }));
    assert.equal(leggiStatoAggiornamento(file).commitAvviato, "abc");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("la cartella della build segue .next-attiva come next.config.ts", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agg-servizio-"));
    assert.equal(cartellaBuildAttiva(dir), path.join(dir, ".next"));
    fs.writeFileSync(path.join(dir, ".next-attiva"), ".next-b\n");
    assert.equal(cartellaBuildAttiva(dir), path.join(dir, ".next-b"));
    fs.writeFileSync(path.join(dir, ".next-attiva"), "../altrove\n");
    assert.equal(cartellaBuildAttiva(dir), path.join(dir, ".next"));
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

// Analisi del 19/10, F03 e F04: l'esito si dice com'è, non «riuscito» e basta.
describe("valutaAvanzamento: servizio fermo e avvisi", () => {
  test("pronto_non_avviato: non è riuscito, e il messaggio dice di avviare il servizio", () => {
    const v = valutaAvanzamento(statoCon({ ultimoTentativo: tentativo("pronto_non_avviato", DOPO) }), T0);
    assert.equal(v.tipo, "fallito");
    assert.match(v.tipo === "fallito" ? v.messaggio : "", /servizio/);
  });
  test("riuscito con avvisi: la nota li riporta", () => {
    const v = valutaAvanzamento(statoCon({ ultimoTentativo: tentativo("riuscito", DOPO, { avvisi: ["verify-install fallito"] }) }), T0);
    assert.deepEqual(v, { tipo: "riuscito", nota: "con avvisi: verify-install fallito" });
  });
  test("lo stato su file con pronto_non_avviato si legge", () => {
    const s = interpretaStatoAggiornamento({ ultimo_tentativo: { commit: "abc", iniziato_il: T0, esito: "pronto_non_avviato", avvisi: [] } });
    assert.equal(s.ultimoTentativo?.esito, "pronto_non_avviato");
  });
});
