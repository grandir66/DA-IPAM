// Lettura della risposta vera di stat/device (controller di DTS, 12/10,
// ridotta a 4 apparati e anonimizzata): SW-1 con LLDP verso SW-11, AP-3
// appeso a SW-1, SW-11 con LLDP verso altri, SW-2 offline senza LLDP.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  parseStatDeviceResponse,
  parseUnifiDevice,
  UnifiResponseError,
  type UnifiDevice,
} from "../unifi-device";
import { rawApInMesh } from "./support/unifi-ap-mesh";

const FIXTURE = path.join(__dirname, "fixtures", "unifi-stat-device.json");
const raw: unknown = JSON.parse(fs.readFileSync(FIXTURE, "utf-8"));

function byName(devs: UnifiDevice[], name: string): UnifiDevice {
  const d = devs.find((x) => x.name === name);
  assert.ok(d, `apparato ${name} assente`);
  return d;
}

test("fixture: i campi di versione non sono stati presi per IP dall'anonimizzatore", () => {
  // L'anonimizzatore della cattura del 12/10 aveva riscritto come IP la
  // versione di SW-2 (quattro numeri puntati): «10.99.0.27» accanto all'ip
  // 10.99.0.26. Il valore vero non è noto: corretto a mano in una forma da
  // versione. I campi IP veri (ip, inform_ip, gateway, ...) restano IP.
  const grezzo = raw as { data: Array<Record<string, unknown>> };
  const campi = ["version", "upgrade_to_firmware", "displayable_version", "required_version", "kernel_version"];
  for (const d of grezzo.data) {
    for (const c of campi) {
      const v = d[c];
      if (typeof v !== "string") continue;
      assert.doesNotMatch(v, /^10\.99\./, `${String(d.name)}.${c} = ${v}: è un indirizzo anonimizzato, non una versione`);
    }
  }
});

test("fixture vera: 4 apparati con tipo, modello, MAC, IP, seriale", () => {
  const devs = parseStatDeviceResponse(raw);
  assert.equal(devs.length, 4);
  const sw1 = byName(devs, "SW-1");
  assert.equal(sw1.type, "usw");
  assert.equal(sw1.model, "US8P60");
  assert.equal(sw1.mac, "02:00:00:00:00:08");
  assert.equal(sw1.ip, "10.99.0.7");
  assert.equal(sw1.serial, "SN000001");
  assert.equal(sw1.state, 1);
  assert.equal(sw1.adopted, true);
  assert.equal(byName(devs, "AP-3").type, "uap");
});

test("LLDP a livello di apparato: chassis_id (MAC), port_id, porta locale", () => {
  const sw1 = byName(parseStatDeviceResponse(raw), "SW-1");
  assert.equal(sw1.lldp_table.length, 3);
  const versoSw11 = sw1.lldp_table.find((e) => e.local_port_idx === 6);
  assert.ok(versoSw11);
  assert.equal(versoSw11.chassis_id, "02:00:00:00:00:04"); // MAC di SW-11
  assert.equal(versoSw11.port_id, "Port 14");
  assert.equal(versoSw11.local_port_name, "Port 6");
  assert.equal(versoSw11.is_wired, true);
  assert.deepEqual(versoSw11.mgmt_ips, []);
});

test("il vicino si risolve per MAC fra gli apparati della stessa risposta", () => {
  const devs = parseStatDeviceResponse(raw);
  const macs = new Map(devs.filter((d) => d.mac).map((d) => [d.mac, d.name]));
  const sw1 = byName(devs, "SW-1");
  const nomi = sw1.lldp_table.map((e) => (e.chassis_id ? macs.get(e.chassis_id) : undefined));
  assert.ok(nomi.includes("SW-11"));
});

test("AP: LLDP con chassis_id_subtype mac e port_id 'local Port N'; nessuna porta switch", () => {
  const ap = byName(parseStatDeviceResponse(raw), "AP-3");
  assert.equal(ap.lldp_table.length, 1);
  assert.equal(ap.lldp_table[0].chassis_id, "02:00:00:00:00:08"); // SW-1
  assert.equal(ap.lldp_table[0].chassis_id_subtype, "mac");
  assert.equal(ap.lldp_table[0].port_id, "local Port 7");
  assert.equal(ap.port_table.length, 0);
});

test("uplink: MAC e porta remota, nome del vicino quando il controller lo sa", () => {
  const devs = parseStatDeviceResponse(raw);
  const sw1 = byName(devs, "SW-1");
  assert.deepEqual(sw1.uplink, {
    port_idx: 6,
    uplink_mac: "02:00:00:00:00:04",
    uplink_remote_port: 14,
    uplink_device_name: "SW-11",
    uplink_source: "lldp_uplink",
    type: "wire",
  });
  const ap = byName(devs, "AP-3");
  assert.equal(ap.uplink?.uplink_mac, "02:00:00:00:00:08");
  assert.equal(ap.uplink?.uplink_remote_port, 7);
  assert.equal(ap.uplink?.uplink_device_name, "SW-1");
  // SW-2 offline: uplink ridotto, senza nome
  assert.equal(byName(devs, "SW-2").uplink?.uplink_device_name, null);
  assert.equal(byName(devs, "SW-2").uplink?.uplink_remote_port, 2);
});

test("uplink.type: «wire» e «wireless» come li manda il controller, altro → null", () => {
  const devs = parseStatDeviceResponse(raw);
  assert.equal(byName(devs, "SW-1").uplink?.type, "wire");
  // AP-4: AP in mesh, esce via radio verso AP-3 (valori inventati, forma vera).
  const mesh = parseUnifiDevice(rawApInMesh());
  assert.ok(mesh);
  assert.equal(mesh.uplink?.type, "wireless");
  assert.equal(mesh.uplink?.uplink_mac, "02:00:00:00:00:05");
  assert.equal(mesh.uplink?.uplink_remote_port, null);
  const base = { mac: "02:00:00:00:00:31", name: "X", type: "uap", state: 1 };
  for (const altro of ["mesh", "WIRE", "", 42, null]) {
    const d = parseUnifiDevice({ ...base, uplink: { uplink_mac: "02:00:00:00:00:08", type: altro } });
    assert.equal(d?.uplink?.type, null, `type ${JSON.stringify(altro)} deve dare null`);
  }
  assert.equal(parseUnifiDevice({ ...base, uplink: { uplink_mac: "02:00:00:00:00:08" } })?.uplink?.type, null);
});

test("porte: indice, nome, stato, velocità, PoE in watt, LAG come numero o null", () => {
  const sw11 = byName(parseStatDeviceResponse(raw), "SW-11");
  assert.equal(sw11.port_table.length, 26);
  const p1 = sw11.port_table.find((p) => p.port_idx === 1);
  assert.ok(p1);
  assert.equal(p1.name, "Port 1");
  assert.equal(p1.up, false);
  assert.equal(p1.speed, 0);
  assert.equal(p1.poe_power, 0);
  assert.equal(p1.aggregated_by, null);
  assert.equal(p1.port_poe, true);
  const uplink = sw11.port_table.find((p) => p.is_uplink);
  assert.ok(uplink, "una porta di uplink attesa");
});

test("apparato offline senza LLDP: nessun vicino inventato, porte senza stato noto", () => {
  const sw2 = byName(parseStatDeviceResponse(raw), "SW-2");
  assert.equal(sw2.state, 0);
  assert.deepEqual(sw2.lldp_table, []);
  assert.equal(sw2.port_table.length, 5);
  assert.equal(sw2.port_table[0].up, null);
  assert.equal(sw2.port_table[0].speed, null);
});

test("meta.rc diverso da ok → errore col messaggio del controller, mai 'zero apparati'", () => {
  assert.throws(
    () => parseStatDeviceResponse({ meta: { rc: "error", msg: "api.err.NoSiteContext" }, data: [] }),
    (e: unknown) => e instanceof UnifiResponseError && e.controllerMsg === "api.err.NoSiteContext",
  );
  assert.throws(() => parseStatDeviceResponse({ meta: { rc: "ok" } }), UnifiResponseError);
  assert.throws(() => parseStatDeviceResponse("<html>"), UnifiResponseError);
});

test("elementi malformati: saltati o con campi null, senza crash", () => {
  const devs = parseStatDeviceResponse({
    meta: { rc: "ok" },
    data: [null, 42, { type: "usw" }, { mac: "aa:bb", port_table: [{ name: "senza indice" }, "x"], lldp_table: "no" }],
  });
  assert.equal(devs.length, 2);
  assert.equal(devs[0].mac, null);
  assert.deepEqual(devs[0].port_table, []);
  assert.deepEqual(devs[1].port_table, []);
  assert.deepEqual(devs[1].lldp_table, []);
  assert.equal(parseUnifiDevice("non un oggetto"), null);
});

test("mgmt_ips: tiene solo le stringhe", () => {
  const d = parseUnifiDevice({ lldp_table: [{ chassis_id: "x", mgmt_ips: ["10.0.0.1", 5, "", null] }] });
  assert.deepEqual(d?.lldp_table[0].mgmt_ips, ["10.0.0.1"]);
});
