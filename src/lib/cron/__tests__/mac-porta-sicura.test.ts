// Revisione finale I1: un errore nella scrittura dei MAC per porta (indice
// unico mancante perché la migrazione di fase 2 è fallita all'apertura del
// tenant, una riga storta) non deve fermare vicini e routing dello switch, che
// nel giro SNMP vengono dopo. Una riga di log col solo id dell'apparato.
//
// Hub isolato importato per primo (il perché sta in support/hub-isolato).
import { removeTestHubDb } from "@/lib/integrations/__tests__/support/hub-isolato";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { closeHubDb } from "@/lib/db-hub";
import { salvaMacPorta } from "@/lib/cron/jobs";

after(() => {
  closeHubDb();
  removeTestHubDb();
});

function catturaWarn<R>(fn: () => R): { righe: string[]; esito: R } {
  const righe: string[] = [];
  const orig = console.warn;
  console.warn = (...a: unknown[]) => {
    righe.push(a.map(String).join(" "));
  };
  try {
    return { righe, esito: fn() };
  } finally {
    console.warn = orig;
  }
}

const RIGA = { mac: "02:00:00:00:00:01", port_name: "Port 1", vlan: null, port_status: null, speed: null };

test("una scrittura che lancia non esce: false e una riga di log col solo id dell'apparato", () => {
  const { righe, esito } = catturaWarn(() =>
    salvaMacPorta(7, [RIGA], () => {
      const e = new Error("ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint (02:00:00:00:00:01)");
      throw Object.assign(e, { code: "SQLITE_ERROR" });
    }),
  );
  assert.equal(esito, false);
  assert.equal(righe.length, 1);
  assert.match(righe[0], /#7/);
  assert.match(righe[0], /SQLITE_ERROR/);
  assert.doesNotMatch(righe[0], /02:00:00/, "niente MAC nel log");
});

test("una scrittura riuscita: true, fonte «device», nessun log", () => {
  const chiamate: Array<[number, number, string]> = [];
  const { righe, esito } = catturaWarn(() => salvaMacPorta(7, [RIGA], (id, rows, fonte) => { chiamate.push([id, rows.length, fonte]); }));
  assert.equal(esito, true);
  assert.deepEqual(chiamate, [[7, 1, "device"]]);
  assert.deepEqual(righe, []);
});
