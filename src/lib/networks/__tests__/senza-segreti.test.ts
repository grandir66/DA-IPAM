import { test } from "node:test";
import assert from "node:assert/strict";
import { reteSenzaSegreti, ruoloAdmin, communityPerLog } from "../senza-segreti";

const rete = { id: 1, name: "LAN", cidr: "10.0.0.0/24", snmp_community: "segreta-finta" };

test("chi non è admin non riceve la community, solo che è configurata", () => {
  const r = reteSenzaSegreti(rete, false);
  assert.equal(r.snmp_community, null);
  assert.equal(r.snmp_community_configurata, true);
  assert.ok(!JSON.stringify(r).includes("segreta-finta"));
  assert.equal(r.name, "LAN");
});

test("l'admin la legge (Riccardo, 14/11: leggibile dalla UI)", () => {
  const r = reteSenzaSegreti(rete, true);
  assert.equal(r.snmp_community, "segreta-finta");
  assert.equal(r.snmp_community_configurata, true);
});

test("community vuota o assente: non configurata", () => {
  assert.equal(reteSenzaSegreti({ id: 2, snmp_community: null }, false).snmp_community_configurata, false);
  assert.equal(reteSenzaSegreti({ id: 3, snmp_community: "  " }, true).snmp_community_configurata, false);
  assert.equal(reteSenzaSegreti({ id: 4 }, false).snmp_community_configurata, false);
});

test("ruoli", () => {
  assert.equal(ruoloAdmin("admin"), true);
  assert.equal(ruoloAdmin("superadmin"), true);
  assert.equal(ruoloAdmin("viewer"), false);
  assert.equal(ruoloAdmin(undefined), false);
});

test("il log dice quante community, mai quali", () => {
  const riga = communityPerLog(["segreta-finta", "public"]);
  assert.equal(riga, "2 community");
  assert.ok(!riga.includes("segreta-finta"));
  assert.equal(communityPerLog(["x"]), "1 community");
});
