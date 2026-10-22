// Aggiunta in blocco dalla Discovery (tavola 2026-10-23, oggetto 9): la risposta della rotta di una sola aggiunta diventa
// l'esito della riga. Forme vere della rotta `POST /api/integrations/librenms/host` (v0.9.878).
//
// Run: node --import tsx --test src/lib/integrations/__tests__/librenms-blocco.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { esitoRigaLibrenms } from "../librenms-blocco";

test("200: aggiunto, o già presente e aggiornato", () => {
  assert.deepEqual(esitoRigaLibrenms(200, { librenms_device_id: 77, added: true }), { stato: "aggiunto", librenms_device_id: 77 });
  assert.deepEqual(esitoRigaLibrenms(200, { librenms_device_id: 77, added: false }), { stato: "gia_presente", librenms_device_id: 77 });
});

test("422 col codice: senza SNMP a parte, gli altri rifiuti col motivo; la rete è un errore", () => {
  const senza = "LibreNMS ha rifiutato l'aggiunta: Nessuna credenziale SNMP per questo oggetto";
  assert.deepEqual(esitoRigaLibrenms(422, { error: senza, codice: "senza_snmp" }), { stato: "senza_snmp", motivo: senza });
  assert.deepEqual(esitoRigaLibrenms(422, { error: "LibreNMS ha rifiutato l'aggiunta: Could not connect", codice: "snmp_non_risponde" }), {
    stato: "rifiutato", motivo: "LibreNMS ha rifiutato l'aggiunta: Could not connect",
  });
  assert.equal(esitoRigaLibrenms(422, { error: "LibreNMS http://x: timeout", codice: "rete" }).stato, "errore");
});

test("errori senza codice o senza corpo: errore col motivo o lo stato HTTP", () => {
  assert.deepEqual(esitoRigaLibrenms(422, { error: "Host non trovato" }), { stato: "errore", motivo: "Host non trovato" });
  assert.deepEqual(esitoRigaLibrenms(403, null), { stato: "errore", motivo: "errore 403" });
  assert.deepEqual(esitoRigaLibrenms(200, {}), { stato: "errore", motivo: "errore 200" });
});
