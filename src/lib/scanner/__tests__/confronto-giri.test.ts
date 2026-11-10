import assert from "node:assert/strict";
import { test } from "node:test";
import { confrontaGiriRete, type StatoGiroRete } from "../confronto-giri";

const ipA = "192.0.2.10";
const ipB = "192.0.2.11";
const ipC = "192.0.2.12";
const macA = "00:01:02:03:04:05";
const macB = "00:01:02:03:04:06";
const macC = "00:01:02:03:04:07";

const prima: StatoGiroRete = {
  id: "prima", tenant: "prova", reteId: 1, perimetro: "copertura",
  fineMs: 10, esito: "riuscito", ipVerificati: [ipA, ipB, ipC],
  host: [
    { ip: ipA, mac: macA, porte: [{ protocollo: "tcp", porta: 53, esito: "chiusa" }] },
    { ip: ipB, mac: macB },
  ],
};

const dopo: StatoGiroRete = {
  ...prima, id: "dopo", fineMs: 20,
  host: [
    { ip: ipA, mac: "0001.0203.0405", porte: [
      { protocollo: "udp", porta: 53, esito: "aperta" },
      { protocollo: "tcp", porta: 53, esito: "aperta" },
    ] },
    { ip: ipB, mac: macC, porte: [{ protocollo: "tcp", porta: 80, esito: "aperta" }] },
    { ip: ipC, mac: "00:01:02:03:04:08" },
  ],
};

test("distingue porta nuova, porta appena osservata, cambio MAC e host nuovo", () => {
  assert.deepEqual(confrontaGiriRete(prima, dopo), {
    stato: "confrontabile", eventi: [
      { tipo: "porta_nuova", ip: ipA, protocollo: "tcp", porta: 53 },
      { tipo: "porta_rilevata", ip: ipA, protocollo: "udp", porta: 53 },
      { tipo: "mac_cambiato", ip: ipB, prima: macB, dopo: macC },
      { tipo: "host_nuovo", ip: ipC, mac: "00:01:02:03:04:08" },
    ],
  });
});

test("rifiuta un giro parziale, una rete diversa e lo stesso giro ripetuto", () => {
  for (const patch of [{ esito: "parziale" as const }, { reteId: 2 }, { tenant: "altro" }, { perimetro: "diverso" }, { id: prima.id }]) {
    assert.equal(confrontaGiriRete(prima, { ...dopo, ...patch }).stato, "non_confrontabile");
  }
});

test("non deduce un host nuovo da un IP mai provato o da un MAC già visto", () => {
  const esito = confrontaGiriRete(
    { ...prima, ipVerificati: [ipB, ipC] },
    { ...dopo, host: [{ ip: ipA, mac: macC }, { ip: ipC, mac: macB }] },
  );
  assert.deepEqual(esito, { stato: "confrontabile", eventi: [] });
});

test("ignora conflitti di osservazione, indirizzi virtuali e identità ambigue", () => {
  const esito = confrontaGiriRete(
    { ...prima, host: [
      { ip: ipA, mac: macA },
      { ip: ipA, mac: macC },
      { ip: ipB, mac: "00:00:5e:00:01:01" },
    ] },
    { ...dopo, host: [{ ip: ipA, mac: macB }, { ip: ipB, mac: macC }] },
  );
  assert.deepEqual(esito, { stato: "confrontabile", eventi: [] });
});

test("un MAC condiviso o locale non dimostra la comparsa di un apparato", () => {
  const esito = confrontaGiriRete(
    { ...prima, host: [] },
    { ...dopo, host: [{ ip: ipA, mac: macC }, { ip: ipB, mac: macC }, { ip: ipC, mac: "02:01:02:03:04:08" }] },
  );
  assert.deepEqual(esito, { stato: "confrontabile", eventi: [] });
});
