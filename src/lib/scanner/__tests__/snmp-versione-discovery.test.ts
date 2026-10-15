/**
 * Discovery: prima la v2c (com'era), poi la v1, e dice quale ha risposto.
 *
 * INCIDENTE (DTS, 2026-10-15): gli AP Ubiquiti 172.16.3.4-7 in v2c vanno in
 * timeout e in v1 rispondono; la discovery parlava solo v2c e non li vedeva.
 * Chi interroga un apparato noto passa `versioni: [quella dell'apparato]`:
 * con una sola versione il comportamento è quello di prima (niente v1 in più).
 */
import { removeTestHubDb } from "@/lib/integrations/__tests__/support/hub-isolato";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { closeHubDb } from "@/lib/db-hub";
import { querySnmpInfoMultiCommunity, querySnmpSysGroupMultiCommunity } from "@/lib/scanner/snmp-query";
import { avviaAgenteFinto, type AgenteFinto } from "@/lib/protocols/__tests__/support/agente-snmp-finto";

// Il ripiego su `snmpwalk` da riga di comando non c'entra con queste prove (e su CI non c'è).
process.env.DA_INVENT_SNMPWALK_CLI = "false";

const SYS = {
  "1.3.6.1.2.1.1.1.0": "Linux finto armv5",
  "1.3.6.1.2.1.1.5.0": "ap-finto",
  "1.3.6.1.2.1.1.2.0": "1.3.6.1.4.1.10002.1",
};
const aperti: AgenteFinto[] = [];
after(async () => {
  for (const a of aperti) await a.chiudi();
  closeHubDb();
  removeTestHubDb();
});
async function agente(versioni: Array<"1" | "2c">): Promise<AgenteFinto> {
  const a = await avviaAgenteFinto({ versioni, valori: SYS });
  aperti.push(a);
  return a;
}

test("sysGroup su un agente solo v1: v2c muta, poi v1 risponde → snmpVersion «1»", async () => {
  const a = await agente(["1"]);
  const r = await querySnmpSysGroupMultiCommunity("127.0.0.1", ["public"], a.porta);
  assert.equal(r.snmpVersion, "1");
  assert.equal(r.sysName, "ap-finto");
  assert.equal(r.sysObjectID, "1.3.6.1.4.1.10002.1");
  assert.deepEqual([...new Set(a.versioniViste())], ["2c", "1"], "prima v2c, poi v1");
});

test("sysGroup su un agente v2c: si ferma alla v2c, nessuna richiesta v1", async () => {
  const a = await agente(["2c"]);
  const r = await querySnmpSysGroupMultiCommunity("127.0.0.1", ["public"], a.porta);
  assert.equal(r.snmpVersion, "2c");
  assert.deepEqual([...new Set(a.versioniViste())], ["2c"]);
});

test("sysGroup con più community: tutte in v2c prima di passare alla v1", async () => {
  const a = await agente(["1"]);
  const r = await querySnmpSysGroupMultiCommunity("127.0.0.1", ["prima", "seconda"], a.porta);
  assert.equal(r.snmpVersion, "1");
  assert.equal(r.community, "prima");
  const ordine = a.richieste.map((x) => x.versione);
  assert.ok(ordine.lastIndexOf("2c") < ordine.indexOf("1"), `ordine visto: ${ordine.join(",")}`);
});

test("versioni: ['2c'] (apparato non rilevato, punto che parlava v2c) su un agente solo v1: nessuna risposta, come prima", async () => {
  const a = await agente(["1"]);
  const r = await querySnmpSysGroupMultiCommunity("127.0.0.1", ["public"], a.porta, ["2c"]);
  assert.equal(r.snmpVersion, null);
  assert.equal(r.sysName, null);
  assert.deepEqual([...new Set(a.versioniViste())], ["2c"]);
});

test("lettura completa (querySnmpInfoMultiCommunity) su un agente solo v1: risponde e lo dice", async () => {
  const a = await agente(["1"]);
  const r = await querySnmpInfoMultiCommunity("127.0.0.1", ["public"], a.porta);
  assert.equal(r.snmpVersion, "1");
  assert.equal(r.sysName, "ap-finto");
  assert.equal(r.community, "public");
  assert.equal(a.richieste[0].versione, "2c", "la prima richiesta resta v2c");
  assert.ok(a.richieste.slice(1).some((x) => x.versione === "1"));
});

test("lettura completa con versioni: ['1'] (apparato rilevato v1): parla solo v1", async () => {
  const a = await agente(["1"]);
  const r = await querySnmpInfoMultiCommunity("127.0.0.1", ["public"], a.porta, { versioni: ["1"] });
  assert.equal(r.snmpVersion, "1");
  assert.deepEqual([...new Set(a.versioniViste())], ["1"]);
});
