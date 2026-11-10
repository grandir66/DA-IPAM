/**
 * `agganciaTriage` (10/11/2026): l'aggancio del triage all'Elenco di Findings usato da
 * `elencoRilievi`. A ogni rilievo mette stato/nota per `chiaveTriage`; chi non ha una riga vale
 * «Da rivedere» (`da_fare`), così «N di M rivisti» conta anche i rilievi mai toccati.
 *
 * Run: node --import tsx --test src/lib/rilievi/__tests__/triage-aggancio.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { agganciaTriage } from "@/lib/rilievi/triage-aggancio";
import type { RilievoUnito } from "@/lib/rilievi/tipi";
import type { RigaTriage } from "@/lib/triage/db";

function rilievo(chiave: string): RilievoUnito {
  return {
    id: chiave,
    chiaveTriage: chiave,
    fonte: "giro",
    gravita: "Low",
    titolo: "t",
    prova: "p",
    rimedio: "r",
    ip: null,
    host_id: null,
    network_id: null,
    network_name: null,
    visto: null,
    cve_key: null,
    host_count: 1,
  };
}

test("aggancia stato/nota per chiaveTriage e conta; chi non ha riga è da_fare", () => {
  const righe = [rilievo("a"), rilievo("b"), rilievo("c")];
  const mappa: Record<string, RigaTriage> = {
    a: { chiave: "a", stato: "fatto", nota: "ok", aggiornato_il: "2026-11-10 10:00:00", aggiornato_da: "u" },
    b: { chiave: "b", stato: "in_corso", nota: "", aggiornato_il: "2026-11-10 09:00:00", aggiornato_da: null },
  };
  const conteggi = agganciaTriage(righe, mappa);
  assert.deepEqual(conteggi, { da_fare: 1, in_corso: 1, fatto: 1, ignorato: 0 });
  assert.equal(righe[0].triage?.stato, "fatto");
  assert.equal(righe[0].triage?.nota, "ok");
  assert.equal(righe[1].triage?.stato, "in_corso");
  assert.equal(righe[2].triage, undefined, "senza riga: nessun triage agganciato");
});

test("mappa vuota: tutti da_fare, nessun triage agganciato", () => {
  const righe = [rilievo("x"), rilievo("y")];
  const conteggi = agganciaTriage(righe, {});
  assert.deepEqual(conteggi, { da_fare: 2, in_corso: 0, fatto: 0, ignorato: 0 });
  assert.equal(righe[0].triage, undefined);
});
