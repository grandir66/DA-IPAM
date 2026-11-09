import { test } from "node:test";
import assert from "node:assert/strict";
import { leggiPromptTecnico } from "@/lib/estrazione/prompt-tecnico";
import { righeRotte, stessoApparato, validaBusta } from "@/lib/estrazione/busta";
import { validaSnapshotSalvato } from "@/lib/acquisition/schema";
import { ricevePorteDaSnapshot } from "@/lib/acquisition/catalogo";

// Riccardo, 09/11/2026: «inghiottire il json» del tecnico. L'esempio del prompt è il dato di prova: se il prompt cambia
// forma e l'import no (o viceversa), questa prova se ne accorge.
function esempio(): Record<string, unknown> {
  const p = leggiPromptTecnico();
  assert.ok(p);
  const blocco = /```json\n([\s\S]*?)```/.exec(p);
  assert.ok(blocco, "manca l'esempio JSON nel prompt");
  return JSON.parse(blocco[1]) as Record<string, unknown>;
}

test("l'esempio del prompt è una busta valida, con collector del tecnico fuori catalogo", () => {
  const v = validaBusta(esempio(), "switch");
  assert.ok(v.ok, v.ok ? "" : v.errori.join("; "));
  assert.equal(v.snapshot.collector, "zyxel-switch");
  assert.deepEqual(v.snapshot.origine, { tipo: "tecnico", famiglia: "switch" });
  assert.equal(v.snapshot.routes?.data.length, 1);
  assert.equal(ricevePorteDaSnapshot(v.snapshot), true);
  // Riletto dall'archivio passa ancora, e senza `origine` un collector fuori catalogo no.
  assert.equal(validaSnapshotSalvato(JSON.parse(JSON.stringify(v.snapshot))).success, true);
  const senza = { ...JSON.parse(JSON.stringify(v.snapshot)) };
  delete senza.origine;
  assert.equal(validaSnapshotSalvato(senza).success, false);
});

test("un apparato che non è switch né router non riceve porte da un collector del tecnico", () => {
  const v = validaBusta(esempio(), null);
  assert.ok(v.ok);
  assert.equal(ricevePorteDaSnapshot(v.snapshot), false);
});

test("busta incoerente o fuori formato: errori detti, niente import", () => {
  const e = esempio();
  (e.snapshot as Record<string, unknown>).collector = "altro-collector";
  const v = validaBusta(e, "switch");
  assert.equal(v.ok, false);
  assert.match(v.ok ? "" : v.errori.join(), /diverso da provenienza\.parser\.id/);
  const f = esempio();
  ((f.snapshot as Record<string, unknown>).interfaces as Record<string, unknown>).status = "forse";
  assert.equal(validaBusta(f, "switch").ok, false);
  assert.equal(validaBusta({ formato: "altro" }, "switch").ok, false);
});

test("identità: decide il seriale, poi l'indirizzo", () => {
  const v = validaBusta(esempio(), "switch");
  assert.ok(v.ok);
  assert.equal(stessoApparato({ host: "198.51.100.9", serial_number: "s000000000001" }, v.busta, v.snapshot).ok, true);
  assert.equal(stessoApparato({ host: "192.0.2.10", serial_number: "S999" }, v.busta, v.snapshot).ok, false);
  assert.equal(stessoApparato({ host: "192.0.2.10", serial_number: null }, v.busta, v.snapshot).ok, true);
  assert.equal(stessoApparato({ host: "192.0.2.99", serial_number: null }, v.busta, v.snapshot).ok, false);
});

test("rotte: forma di routing_table, protocolli fuori CHECK in «other», doppioni tolti", () => {
  const r = righeRotte([
    { destination: "0.0.0.0", prefix_len: 0, gateway: "192.0.2.1", interface: "vlan10", protocol: "static", metric: null, distance: 1, active: true, vrf: null },
    { destination: "0.0.0.0", prefix_len: 0, gateway: "192.0.2.1", interface: "vlan10", protocol: "static", metric: null, distance: 1, active: true, vrf: null },
    { destination: "198.51.100.0/24", prefix_len: 24, gateway: null, interface: "vlan20", protocol: "eigrp", metric: 5.4, distance: null, active: null, vrf: null },
  ]);
  assert.deepEqual(r, [
    { destination: "0.0.0.0/0", gateway: "192.0.2.1", interface_name: "vlan10", protocol: "static", distance: 1, active: true },
    { destination: "198.51.100.0/24", gateway: null, interface_name: "vlan20", protocol: "other", metric: 5, active: true },
  ]);
});
