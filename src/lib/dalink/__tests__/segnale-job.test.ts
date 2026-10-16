/**
 * Tappa C1, Task 8: il timer del segnale di vita.
 *
 * Mai due giri insieme: il timer e il pulsante «Invia adesso» (o il cambio di livello)
 * possono arrivare nello stesso momento, e il secondo aspetta il primo invece di
 * mandare un altro segnale. Lo stato sta su globalThis: le rotte di Next e server.ts
 * caricano istanze diverse dello stesso modulo.
 * Il giro senza configurazione non chiama la rete: lo prova invio.test.ts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { avviaSegnaleDalink, inviaAdesso } from "../segnale-job";
import type { EsitoGiro } from "../invio";

const OK: EsitoGiro = { esito: "ok", dettaglio: "ricevuto" };
const attesa = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("due richieste insieme: un giro solo, stesso esito", async () => {
  let giri = 0;
  let sblocca: (e: EsitoGiro) => void = () => {};
  const giro = () => {
    giri += 1;
    return new Promise<EsitoGiro>((r) => (sblocca = r));
  };
  const a = inviaAdesso(giro);
  const b = inviaAdesso(giro);
  sblocca(OK);
  assert.deepEqual(await a, OK);
  assert.deepEqual(await b, OK);
  assert.equal(giri, 1);
  // Finito il giro, se ne può fare un altro.
  const c = inviaAdesso(async () => {
    giri += 1;
    return OK;
  });
  await c;
  assert.equal(giri, 2);
});

test("il timer gira, e lo stop lo ferma", async () => {
  let giri = 0;
  const stop = avviaSegnaleDalink({
    primoMs: 5,
    ogniMs: 15,
    giro: async () => {
      giri += 1;
      return OK;
    },
  });
  await attesa(60);
  stop();
  const visti = giri;
  assert.ok(visti >= 2, `giri: ${visti}`);
  await attesa(50);
  assert.equal(giri, visti, "dopo lo stop non gira più");
});

test("avviato due volte: un solo timer", async () => {
  let giri = 0;
  const giro = async () => {
    giri += 1;
    return OK;
  };
  const stop1 = avviaSegnaleDalink({ primoMs: 5, ogniMs: 1000, giro });
  const stop2 = avviaSegnaleDalink({ primoMs: 5, ogniMs: 1000, giro });
  await attesa(40);
  stop1();
  stop2();
  assert.equal(giri, 1);
});

test("un giro che lancia non ferma il timer", async () => {
  let giri = 0;
  const stop = avviaSegnaleDalink({
    primoMs: 5,
    ogniMs: 15,
    giro: async () => {
      giri += 1;
      throw new Error("imprevisto");
    },
  });
  await attesa(60);
  stop();
  assert.ok(giri >= 2);
});
