/**
 * Rimedio C (11/11/2026, hub 533): un nome di serie non fa gruppo (otto iPhone erano un apparato solo), e le righe
 * vecchie di un telefono che gira tornano archiviabili (l'S25 aveva 6 righe, tenute per sempre perché in un gruppo).
 *
 * Run: node --import tsx --test src/lib/hosts/__tests__/indirizzi-passati.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { nomeGenerico } from "../nomi-generici";
import { indirizziPassati } from "../pulizia-candidati";

describe("nomeGenerico", () => {
  it("i nomi di serie, anche col dominio o un numero in coda", () => {
    for (const n of ["iPhone", "iphone.domarc.it", "iPhone-2", "iPad", "Watch", "Mac", "MikroTik", "Meross_Smart_Plug", "MacBook-Pro"]) assert.equal(nomeGenerico(n), true, n);
  });
  it("un nome che distingue non è di serie", () => {
    for (const n of ["S25-Ultra-di-riccardo", "iPhone-di-Anna", "DA-ADRA", "NB-AGUZZOLI", "Fairphone-5-5G", "MikroTik-CED", "", null]) assert.equal(nomeGenerico(n), false, String(n));
  });
});

const base = { mac: "4A:08:63:EA:11:AF", hostname: "S25-Ultra-di-riccardo", gruppo: "g1", escluso: "gruppo multihomed", recuperato: 0, sessioni: 0 };

describe("indirizziPassati", () => {
  it("le righe più vecchie del gruppo tornano archiviabili, la più recente no", () => {
    const righe = [
      { ...base, id: 1, last_seen: "2026-08-28 15:00:18", escluso: "classificazione a mano" },
      { ...base, id: 2, last_seen: "2026-09-23 14:00:18" },
      { ...base, id: 3, last_seen: "2026-11-09 11:15:06" },
    ];
    assert.deepEqual([...indirizziPassati(righe)].sort(), [1, 2]);
  });
  it("una protezione forte resta: apparato, credenziali, nome scritto a mano, recupero, sessioni remote", () => {
    const righe = [
      { ...base, id: 1, last_seen: "2026-08-01 10:00:00", escluso: "apparato" },
      { ...base, id: 2, last_seen: "2026-08-01 10:00:00", escluso: "credenziali" },
      { ...base, id: 3, last_seen: "2026-08-01 10:00:00", escluso: "nome scritto a mano" },
      { ...base, id: 4, last_seen: "2026-08-01 10:00:00", recuperato: 1 },
      { ...base, id: 5, last_seen: "2026-08-01 10:00:00", sessioni: 1 },
      { ...base, id: 6, last_seen: "2026-11-09 11:15:06" },
    ];
    assert.equal(indirizziPassati(righe).size, 0);
  });
  it("MAC vero (un server con più schede), nome di serie, o riga senza gruppo: resta protetta", () => {
    const righe = [
      { ...base, id: 1, mac: "00:11:32:AA:BB:01", hostname: "DA-ADRA", last_seen: "2026-08-01 10:00:00" },
      { ...base, id: 2, mac: "00:11:32:AA:BB:02", hostname: "DA-ADRA", last_seen: "2026-11-09 10:00:00" },
      { ...base, id: 3, gruppo: "g2", hostname: "iPhone", last_seen: "2026-08-01 10:00:00" },
      { ...base, id: 4, gruppo: "g2", hostname: "iPhone", last_seen: "2026-11-09 10:00:00" },
      { ...base, id: 5, gruppo: null, escluso: "classificazione a mano", last_seen: "2026-08-01 10:00:00" },
    ];
    assert.equal(indirizziPassati(righe).size, 0);
  });
});
