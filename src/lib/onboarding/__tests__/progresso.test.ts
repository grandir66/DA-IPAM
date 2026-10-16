/**
 * Punto raggiunto nel wizard di prima configurazione (tappa 4 credenziali, 15/10).
 *
 * Perché: «Esci» segnava il wizard completato e dimenticava tutto; riaprendolo
 * da Impostazioni si ripartiva dal primo passo, e router e rete già creati si
 * ricreavano (o la rete era rifiutata per sovrapposizione). Ora il punto
 * raggiunto e gli oggetti creati stanno nelle impostazioni dell'hub
 * (`onboarding_progresso:<cliente>`): un valore guasto non deve passare per
 * buono, e non deve far ripartire il wizard come se niente fosse.
 *
 * Run: node --import tsx --test src/lib/onboarding/__tests__/progresso.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { PASSI_WIZARD } from "../passi";
import { chiaveProgresso, leggiProgresso, scriviProgresso, validaProgresso, PROGRESSO_INIZIALE } from "../progresso";

describe("passi del wizard", () => {
  it("cinque passi, le credenziali per prime", () => {
    assert.deepEqual(
      PASSI_WIZARD.map((p) => p.titolo),
      ["Credenziali (archivio)", "Router / gateway", "DNS", "Active Directory", "Prima subnet"],
    );
  });
});

describe("validaProgresso", () => {
  it("un punto completo", () => {
    const esito = validaProgresso({ passo: 2, router_device_id: 7, network_id: null, ad_integration_id: null });
    assert.deepEqual(esito, { ok: true, progresso: { passo: 2, router_device_id: 7, network_id: null, ad_integration_id: null } });
  });

  it("gli id assenti valgono null", () => {
    const esito = validaProgresso({ passo: 0 });
    assert.deepEqual(esito, { ok: true, progresso: PROGRESSO_INIZIALE });
  });

  it("passo fuori dai cinque, decimale o testo: rifiutato", () => {
    for (const passo of [-1, 5, 1.5, "2", null, undefined]) {
      const esito = validaProgresso({ passo });
      assert.equal(esito.ok, false, String(passo));
      if (!esito.ok) assert.match(esito.errore, /passo/i);
    }
  });

  it("id non interi positivi: rifiutati (un «0» o un testo non è un oggetto creato)", () => {
    for (const id of [0, -3, 2.5, "7", true]) {
      const esito = validaProgresso({ passo: 1, router_device_id: id });
      assert.equal(esito.ok, false, String(id));
      if (!esito.ok) assert.match(esito.errore, /router_device_id/);
    }
  });

  it("un campo sconosciuto è un errore, non si ignora", () => {
    const esito = validaProgresso({ passo: 1, rete_id: 4 });
    assert.equal(esito.ok, false);
    if (!esito.ok) assert.match(esito.errore, /rete_id/);
  });

  it("non un oggetto: rifiutato", () => {
    for (const x of [null, [], "x", 3]) assert.equal(validaProgresso(x).ok, false);
  });
});

describe("lettura e scrittura del valore salvato", () => {
  it("assente o vuoto: nessun punto salvato", () => {
    assert.deepEqual(leggiProgresso(null), { stato: "assente" });
    assert.deepEqual(leggiProgresso(""), { stato: "assente" });
  });

  it("andata e ritorno", () => {
    const p = { passo: 4, router_device_id: 3, network_id: 9, ad_integration_id: 1 };
    assert.deepEqual(leggiProgresso(scriviProgresso(p)), { stato: "valido", progresso: p });
  });

  it("non JSON o fuori forma: «illeggibile» con il motivo, mai «assente»", () => {
    const a = leggiProgresso("{passo:2");
    assert.equal(a.stato, "illeggibile");
    const b = leggiProgresso(JSON.stringify({ passo: 9 }));
    assert.equal(b.stato, "illeggibile");
    if (b.stato === "illeggibile") assert.match(b.errore, /passo/i);
  });

  it("chiave per cliente", () => {
    assert.equal(chiaveProgresso("A001"), "onboarding_progresso:A001");
  });
});
