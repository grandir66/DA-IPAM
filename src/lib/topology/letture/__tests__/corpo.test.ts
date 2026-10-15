// M6 (revisione finale di T2): `PUT /api/topology/settings/letture` non aveva prove di comportamento, e T3 aggiunge
// `PUT /api/topology/settings/mappa` della stessa forma (spec §13.5.6, §13.11.4). Le decisioni sul corpo stanno in
// letture/corpo.ts, logica pura: qui si provano 400 (corpo), 409 (schema di T2 assente, solo per accendere) e lo strict.
// Il 403 a chi non è admin lo prova il lucchetto sul sorgente (api-auth-guards.test.ts) col censimento delle guardie:
// `mock.module` non gira sotto Node 22 con tsx e `requireAdmin` legge la sessione (piano di T3, «Scelte» 13).
import { test } from "node:test";
import assert from "node:assert/strict";
import { type Lettura } from "@/lib/topology/letture/interruttori";
import { decidiCorpoLetture, decidiCorpoMappa } from "@/lib/topology/letture/corpo";

const conSchema = { schemaPresente: () => true };
const senzaSchema = { schemaPresente: () => false };
const NON_BOOLEANO = "Indica se accendere (true) o spegnere (false)";

test("letture: accendere una lettura disponibile con lo schema → ok", () => {
  assert.deepEqual(decidiCorpoLetture({ lettura: "mikrotik", acceso: true }, conSchema), { ok: true, dati: { lettura: "mikrotik", acceso: true } });
});

test("letture: accendere senza lo schema di T2 → 409, detto", () => {
  assert.deepEqual(decidiCorpoLetture({ lettura: "mikrotik", acceso: true }, senzaSchema), {
    ok: false, status: 409, error: "Letture in più non disponibili: lo schema di questo cliente non è aggiornato",
  });
});

test("letture: spegnere si può sempre, anche senza schema", () => {
  assert.deepEqual(decidiCorpoLetture({ lettura: "mikrotik", acceso: false }, senzaSchema), { ok: true, dati: { lettura: "mikrotik", acceso: false } });
});

test("letture: `host` si accende (Task 7 di T2 rilasciato, v0.3.299)", () => {
  assert.deepEqual(decidiCorpoLetture({ lettura: "host", acceso: true }, conSchema), { ok: true, dati: { lettura: "host", acceso: true } });
});

// Tutte e quattro le letture sono disponibili (v0.3.299): il ramo «non disponibile» si prova con un
// elenco ristretto passato da fuori (lo stesso controllo, nello stesso ordine: prima la disponibilità, poi lo schema).
test("letture: il ramo «non disponibile» con un elenco ristretto; viene prima dello schema", () => {
  const soloMikrotik = new Set<Lettura>(["mikrotik"]);
  const atteso = { ok: false, status: 400, error: "Questa lettura non è disponibile in questa versione" };
  assert.deepEqual(decidiCorpoLetture({ lettura: "host", acceso: true }, { ...conSchema, disponibili: soloMikrotik }), atteso);
  assert.deepEqual(decidiCorpoLetture({ lettura: "host", acceso: true }, { ...senzaSchema, disponibili: soloMikrotik }), atteso);
  assert.deepEqual(decidiCorpoLetture({ lettura: "host", acceso: false }, { ...senzaSchema, disponibili: soloMikrotik }),
    { ok: true, dati: { lettura: "host", acceso: false } });
});

test("letture: un campo in più → 400 (corpo strict)", () => {
  assert.deepEqual(decidiCorpoLetture({ lettura: "mikrotik", acceso: true, x: 1 }, conSchema),
    { ok: false, status: 400, error: "Richiesta non valida" });
});

test("letture: lettura sconosciuta, acceso non booleano, corpo che non è un oggetto → 400 coi messaggi in italiano", () => {
  assert.deepEqual(decidiCorpoLetture({ lettura: "telnet", acceso: true }, conSchema), { ok: false, status: 400, error: "Lettura sconosciuta" });
  assert.deepEqual(decidiCorpoLetture({ lettura: "mikrotik", acceso: "true" }, conSchema), { ok: false, status: 400, error: NON_BOOLEANO });
  for (const raw of [null, "x", [], undefined, 1]) {
    assert.deepEqual(decidiCorpoLetture(raw, conSchema), { ok: false, status: 400, error: "Richiesta non valida" }, JSON.stringify(raw));
  }
});

test("letture: lo schema non si chiede per un corpo sbagliato né per spegnere", () => {
  let chiamate = 0;
  const conta = { schemaPresente: () => { chiamate++; return false; } };
  decidiCorpoLetture({ lettura: "telnet", acceso: true }, conta);
  decidiCorpoLetture({ lettura: "mikrotik", acceso: false }, conta);
  assert.equal(chiamate, 0);
});

test("mappa: accendere con lo schema → ok; senza → 409; spegnere senza schema → ok", () => {
  assert.deepEqual(decidiCorpoMappa({ acceso: true }, conSchema), { ok: true, dati: { acceso: true } });
  assert.deepEqual(decidiCorpoMappa({ acceso: true }, senzaSchema), {
    ok: false, status: 409, error: "Mappa nuova non disponibile: lo schema di questo cliente non è aggiornato",
  });
  assert.deepEqual(decidiCorpoMappa({ acceso: false }, senzaSchema), { ok: true, dati: { acceso: false } });
});

test("mappa: strict, non booleano, corpo che non è un oggetto → 400", () => {
  assert.deepEqual(decidiCorpoMappa({ acceso: true, da: "qualcuno" }, conSchema),
    { ok: false, status: 400, error: "Richiesta non valida" }, "chi e quando li scrive la rotta, non il corpo");
  assert.deepEqual(decidiCorpoMappa({ acceso: "true" }, conSchema), { ok: false, status: 400, error: NON_BOOLEANO });
  assert.deepEqual(decidiCorpoMappa({}, conSchema), { ok: false, status: 400, error: NON_BOOLEANO });
  for (const raw of [null, "x", []]) {
    assert.deepEqual(decidiCorpoMappa(raw, conSchema), { ok: false, status: 400, error: "Richiesta non valida" }, JSON.stringify(raw));
  }
});
