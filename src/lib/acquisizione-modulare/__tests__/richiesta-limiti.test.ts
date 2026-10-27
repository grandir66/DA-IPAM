/**
 * Limiti del collector nella richiesta dell'app (70151, 22/10): l'app chiedeva ai Comware IRF 4 s per comando e 90 s in
 * tutto (i valori di serie), mentre il collaudo del 21/10 girava a 15 s e 300 s. `display interface brief` andava oltre i
 * 4 s, il collector fermava il giro e `display vlan all` (VLAN e porte taggate) non partiva mai.
 *
 * Run: DA_INVENT_DATA_DIR=$(mktemp -d) node --import tsx --test src/lib/acquisizione-modulare/__tests__/richiesta-limiti.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { costruisciRichiesta, type LettoreSegreto } from "@/lib/acquisizione-modulare/richiesta";
import { acquisitionInputSchema as inputSchema } from "@/lib/acquisition/schema";

const leggi: LettoreSegreto = () => ({ ok: true, segreto: { forma: "utente", username: "lettore", password: "segreto-di-prova" } });
const ssh = { ssh: { credential_id: 1, nome: "HP-SW", port: 22 } } as never;

test("Comware: la richiesta porta i limiti del collaudo (15 s per comando, 240 s in tutto) e passa lo schema", () => {
  const r = costruisciRichiesta("hp-comware", { host: "192.0.2.80", protocol: "ssh" }, ssh, leggi);
  assert.ok(r.ok);
  const limiti = inputSchema.parse(r.richiesta).limits;
  assert.equal(limiti.timeout_ms, 15000);
  assert.equal(limiti.total_timeout_ms, 240000);
});

test("un collector senza limiti propri resta coi valori di serie", () => {
  const r = costruisciRichiesta("hp-procurve", { host: "192.0.2.81", protocol: "ssh" }, ssh, leggi);
  assert.ok(r.ok);
  assert.equal(inputSchema.parse(r.richiesta).limits.timeout_ms, 4000);
});
