// Lettori puri dell'API di LibreNMS (piano 2026-10-22 LibreNMS, task 3) sulle uscite vere anonimizzate dell'hub del 22/10
// (`fixtures/librenms/`, 25 righe per parte) e su una forma sconosciuta per parte (`fixtures/librenms/forma-sconosciuta/`).
//
// Run: node --import tsx --test src/lib/integrations/__tests__/librenms-lettori.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import {
  esitoHttp,
  leggiApparati,
  leggiArp,
  leggiInventario,
  leggiMacPorta,
  leggiPorte,
  leggiSensori,
  leggiVicini,
  leggiVlan,
  normalizzaMac,
  vlanDaRiga,
  type Esito,
} from "../librenms-lettori";

const FIX = path.join(__dirname, "fixtures", "librenms");
const vera = (f: string): unknown => JSON.parse(fs.readFileSync(path.join(FIX, f), "utf8"));
const ignota = (f: string): unknown => JSON.parse(fs.readFileSync(path.join(FIX, "forma-sconosciuta", f), "utf8"));
function righe<T>(e: Esito<T>): T[] {
  assert.equal(e.esito, "letto", e.esito === "non_so" ? `non so: ${e.codice}` : "");
  return e.esito === "letto" ? e.righe : [];
}

test("apparati: 25 righe, chiavi e campi del dispositivo", () => {
  const r = righe(leggiApparati(vera("devices.json")));
  assert.equal(r.length, 25);
  const ccr = r.find((x) => x.librenms_device_id === 5);
  assert.equal(ccr?.os, "routeros");
  assert.equal(ccr?.ip, "192.0.2.3");
  assert.ok(r.some((x) => x.last_polled === null), "c'è un apparato mai interrogato (last_polled nullo)");
});

test("porte: 25 righe; MAC con i due punti, VLAN da testo a numero", () => {
  const r = righe(leggiPorte(vera("ports.json")));
  assert.equal(r.length, 25);
  const p = r.find((x) => x.port_id === 3);
  assert.equal(p?.mac, "02:00:00:00:00:04");
  assert.equal(p?.vlan, 666);
  assert.equal(p?.speed, 10_000_000_000);
  assert.equal(r.find((x) => x.port_id === 1)?.speed, null);
});

test("vicini: 25 righe, 11 verso apparati che LibreNMS vede ma non interroga (remote_device_id 0)", () => {
  const r = righe(leggiVicini(vera("links.json")));
  assert.equal(r.length, 25);
  assert.equal(r.filter((x) => x.remote_device_id === 0).length, 11);
  const v = r.find((x) => x.link_id === 4);
  assert.equal(v?.librenms_device_id, 41);
  assert.equal(v?.protocol, "lldp");
});

test("VLAN: il numero è vlan_vlan, non l'id di riga", () => {
  const r = righe(leggiVlan(vera("vlans.json")));
  assert.equal(r.length, 25);
  assert.deepEqual(r.slice(0, 3).map((x) => x.vlan_id), [1, 2, 4]);
  assert.equal(vlanDaRiga(vera("vlans.json")).get(3), 4, "riga 3 = VLAN 4");
});

test("MAC per porta: 25 righe; vlan_id 0 = non nota; un id di riga si traduce col numero della VLAN", () => {
  const corpo = vera("fdb.json");
  const r = righe(leggiMacPorta(corpo));
  assert.equal(r.length, 25);
  assert.equal(r[0].mac, "02:00:00:00:00:05");
  assert.equal(r[0].vlan_id, null);
  const conRiga = { status: "ok", ports_fdb: [{ port_id: 4, device_id: 1, mac_address: "02:00:00:00:00:05", vlan_id: 3, updated_at: null }] };
  assert.equal(righe(leggiMacPorta(conRiga, vlanDaRiga(vera("vlans.json"))))[0].vlan_id, 4);
  assert.equal(righe(leggiMacPorta(conRiga))[0].vlan_id, null, "senza la mappa la VLAN non si indovina");
});

test("ARP: 25 righe da /resources/ip/arp/all; 0.0.0.0/0 risponde vuoto (fotografia vuota, non «non so»)", () => {
  const r = righe(leggiArp(vera("arp-all.json")));
  assert.equal(r.length, 25);
  assert.deepEqual([r[0].ip, r[0].mac, r[0].port_id], ["192.0.2.19", "02:00:00:00:00:23", 447]);
  assert.deepEqual(leggiArp(vera("arp-0.json")), { esito: "letto", righe: [] });
});

test("sensori: 25 righe con classe, valore e limiti; i tolti (sensor_deleted 1) no", () => {
  const corpo = vera("sensors.json") as { status: string; sensors: Array<Record<string, unknown>> };
  const r = righe(leggiSensori(corpo));
  assert.equal(r.length, 25);
  const t = r.find((x) => x.sensor_id === 115);
  assert.deepEqual([t?.classe, t?.valore, t?.limite_alto], ["temperature", 46, 80]);
  const tolto = { ...corpo, sensors: corpo.sensors.map((s, i) => (i === 0 ? { ...s, sensor_deleted: 1 } : s)) };
  assert.equal(righe(leggiSensori(tolto)).length, 24);
});

test("inventario: per apparato, contenuto_in e modello; un device_id diverso è una forma nuova", () => {
  const r = righe(leggiInventario(1, vera("inventory-2.json")));
  assert.equal(r.length, 10);
  assert.deepEqual([r[0].ent_index, r[0].classe, r[0].contenuto_in, r[0].modello], [65536, "chassis", 0, null]);
  assert.equal(r[3].modello, "entPhysicalModelName-283");
  assert.equal(righe(leggiInventario(5, vera("inventory-1.json"))).length, 1);
  assert.deepEqual(leggiInventario(9, vera("inventory-1.json")), { esito: "non_so", codice: "campo_device_id" });
});

test("forma sconosciuta, una per parte: «non so» col codice, mai righe a metà", () => {
  assert.deepEqual(leggiApparati(ignota("devices.json")), { esito: "non_so", codice: "forma" });
  assert.deepEqual(leggiPorte(ignota("ports.json")), { esito: "non_so", codice: "campo_port_id" });
  assert.deepEqual(leggiVicini(ignota("links.json")), { esito: "non_so", codice: "chiave_assente" });
  assert.deepEqual(leggiVlan(ignota("vlans.json")), { esito: "non_so", codice: "campo_vlan_vlan" });
  assert.deepEqual(leggiMacPorta(ignota("fdb.json")), { esito: "non_so", codice: "campo_mac_address" });
  assert.deepEqual(leggiArp(ignota("arp.json")), { esito: "non_so", codice: "campo_ipv4_address" });
  assert.deepEqual(leggiSensori(ignota("sensors.json")), { esito: "non_so", codice: "campo_sensor_current" });
  assert.deepEqual(leggiInventario(1, ignota("inventory.json")), { esito: "non_so", codice: "forma" });
  // La rotta della VLAN per porta che non c'è (404 vero dell'hub): status "error" = forma.
  assert.deepEqual(leggiPorte(vera("ports-vlans.json")), { esito: "non_so", codice: "forma" });
  for (const corpo of [null, "testo", [], { status: "error", message: "x" }]) {
    assert.equal(leggiApparati(corpo).esito, "non_so");
  }
});

test("HTTP diverso da 200 = non so; MAC normalizzati o rifiutati", () => {
  assert.equal(esitoHttp(200), null);
  assert.deepEqual(esitoHttp(404), { esito: "non_so", codice: "http_404" });
  assert.equal(normalizzaMac("02-00-00-AA-BB-CC"), "02:00:00:aa:bb:cc");
  assert.equal(normalizzaMac("0200.00aa.bbcc"), "02:00:00:aa:bb:cc");
  assert.equal(normalizzaMac("02:00:00:aa:bb"), null);
  assert.equal(normalizzaMac("zz0000aabbcc"), null);
});
