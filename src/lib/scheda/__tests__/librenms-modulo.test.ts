/**
 * Pagina del modulo LibreNMS (task 8): testi delle parti, dei rifiuti e delle liste lunghe.
 *
 * Run: DA_INVENT_DATA_DIR=$(mktemp -d) node --import tsx --test src/lib/scheda/__tests__/librenms-modulo.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { codiceLeggibile, motivoRifiuto, statoParte, visibili } from "../librenms-modulo";

const parte = (esito: string, codice: string | null, letto_il: string | null) => ({ esito, righe: null, letto_il, tentato_il: "2026-10-22 10:15:00", codice });

describe("statoParte", () => {
  it("letta, non so con righe di prima, non so senza righe, mai letta", () => {
    assert.deepEqual(statoParte(parte("letto", null, "2026-10-22 10:15:00")), { tono: "ok", segno: "✓", testo: "letta" });
    assert.equal(statoParte(parte("non_so", "http_500", "2026-10-22 10:00:00")).testo, "non so (HTTP 500): restano le righe di prima");
    assert.equal(statoParte(parte("non_so", "forma", null)).testo, "non so (forma)");
    assert.equal(statoParte(parte("mai", null, null)).tono, "nd");
  });
});

describe("rifiuti e liste lunghe", () => {
  it("motivo breve dal codice", () => {
    assert.equal(motivoRifiuto("snmp_non_risponde"), "SNMP non risponde");
    assert.equal(motivoRifiuto("altro"), "rifiutato");
    assert.equal(codiceLeggibile(null), "?");
  });
  it("le prime 10 e quante altre", () => {
    const l = Array.from({ length: 13 }, (_, i) => i);
    assert.deepEqual([visibili(l, false).mostrate.length, visibili(l, false).altre], [10, 3]);
    assert.deepEqual([visibili(l, true).mostrate.length, visibili(l, true).altre], [13, 0]);
    assert.equal(visibili([1, 2], false).altre, 0);
  });
});
