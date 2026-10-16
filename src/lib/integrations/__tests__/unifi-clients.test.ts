// Client collegati letti dal controller UniFi (stat/sta, sola lettura) →
// righe della tabella dei MAC per porta (topologia fase 2, Task 3). Logica pura:
// fixture inventata con la forma vera (MAC 02:00:00, localmente amministrati).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { parseStatStaResponse, mapClientsToPorts } from "@/lib/integrations/unifi-clients";
import { UnifiResponseError } from "@/lib/integrations/unifi-device";

const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/unifi-stat-sta.json"), "utf8"));

test("parser: tiene cablati e wireless, scarta le voci senza MAC", () => {
  const c = parseStatStaResponse(fixture);
  assert.equal(c.length, 3);
  assert.deepEqual(c.map((x) => x.isWired), [true, false, true]);
});

test("parser: MAC normalizzati, porta dello switch e AP letti, campi assenti a null", () => {
  const [cablato, wireless, senzaSwitch] = parseStatStaResponse(fixture);
  assert.deepEqual(cablato, { mac: "02:00:00:00:10:01", isWired: true, swMac: "02:00:00:00:00:A1", swPort: 5, apMac: null, lastSeen: 1791818864 });
  assert.equal(wireless.apMac, "02:00:00:00:00:B1");
  assert.equal(senzaSwitch.swMac, null);
  assert.equal(senzaSwitch.swPort, null);
});

test("parser: le voci che non sono oggetti si saltano, non fanno cadere la lettura", () => {
  assert.equal(parseStatStaResponse({ meta: { rc: "ok" }, data: [null, 3, "x", { mac: "02:00:00:00:10:09" }] }).length, 1);
});

test("una risposta con rc di errore è un errore, non zero client", () => {
  assert.throws(() => parseStatStaResponse({ meta: { rc: "error", msg: "api.err.NoPermission" }, data: [] }));
});

test("rc di errore e data mancante: UnifiResponseError col messaggio del controller (il client lo classifica)", () => {
  assert.throws(
    () => parseStatStaResponse({ meta: { rc: "error", msg: "api.err.NoPermission" }, data: [] }),
    (e: unknown) => e instanceof UnifiResponseError && e.controllerMsg === "api.err.NoPermission",
  );
  assert.throws(() => parseStatStaResponse({ meta: { rc: "ok" } }), UnifiResponseError);
  assert.throws(() => parseStatStaResponse(null), UnifiResponseError);
});

test("cablato → porta dello switch per indice; wireless → 'wifi' dell'AP; senza switch noto → non abbinato", () => {
  const clients = parseStatStaResponse(fixture);
  const devices = [{ id: 10, controller_mac: clients[0].swMac }, { id: 20, controller_mac: clients[1].apMac }];
  const { byDevice, unmatched } = mapClientsToPorts(clients, devices, new Map([["10|5", "Port 5"]]));
  assert.deepEqual(byDevice.get(10), [{ mac: clients[0].mac, port_name: "Port 5" }]);
  assert.deepEqual(byDevice.get(20), [{ mac: clients[1].mac, port_name: "wifi" }]);
  assert.equal(unmatched, 1);
});

test("porta senza nome in switch_ports → «Port N», come la scrive la lettura degli apparati", () => {
  const clients = parseStatStaResponse(fixture);
  // controller_mac scritto in minuscolo: il confronto avviene sui MAC normalizzati.
  const { byDevice } = mapClientsToPorts(clients, [{ id: 10, controller_mac: "02:00:00:00:00:a1" }], new Map());
  assert.deepEqual(byDevice.get(10), [{ mac: clients[0].mac, port_name: "Port 5" }]);
});

test("switch o AP che il tenant non conosce → non abbinato, niente righe", () => {
  const clients = parseStatStaResponse(fixture);
  const { byDevice, unmatched } = mapClientsToPorts(clients, [], new Map());
  assert.equal(byDevice.size, 0);
  assert.equal(unmatched, 3);
});
