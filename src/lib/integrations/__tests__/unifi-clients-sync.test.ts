// Giro di lettura dei client UniFi di UN controller (topologia fase 2, Task 3):
// stat/sta → righe della tabella dei MAC per porta con source "unifi".
// Niente rete: una console UniFi OS finta (trasporto sostituito) che risponde
// con la fixture inventata di stat/sta. Il client si costruisce come la
// sincronizzazione degli apparati: stessa chiave cifrata, stessa impronta.
//
// Hub DB isolato: `support/hub-isolato` va importato PER PRIMO (il perché sta lì).
import { removeTestHubDb } from "@/lib/integrations/__tests__/support/hub-isolato";
import path from "node:path";
import fs from "node:fs";
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { closeHubDb } from "@/lib/db-hub";
import { deleteTenantDatabase, getTenantDb, withTenant } from "@/lib/db-tenant";
import { checkPresentedPin, UnifiApiError, type UnifiHttpRequest, type UnifiTransportFactory } from "@/lib/integrations/unifi-api";
import { createController, listControllerClientRunViews, listControllerRunViews, listControllerViews } from "@/lib/controllers/service";
import { syncUnifiClientsForController } from "@/lib/integrations/unifi-clients-sync";
import type { ControllerInput } from "@/lib/controllers/types";

const T = "TESTUNIFICLIENTS";
const STA_BODY = fs.readFileSync(path.join(__dirname, "fixtures", "unifi-stat-sta.json"), "utf-8");
const PIN = `sha256/${Buffer.alloc(32, 7).toString("base64")}`;
const CHIAVE = "chiave-api-di-prova-client-0123456";

const db = () => getTenantDb(T);
const w = <R>(fn: () => R): R => withTenant(T, fn);

type Riga = { device_id: number; mac: string; port_name: string; source: string; timestamp: string };
const righe = () =>
  db().prepare("SELECT device_id, mac, port_name, source, timestamp FROM mac_port_entries ORDER BY device_id, mac").all() as Riga[];

beforeEach(() => {
  deleteTenantDatabase(T);
  // Switch e AP UniFi del tenant, col MAC del controller (minuscolo: si confronta normalizzato).
  db().exec(`
    INSERT INTO network_devices (id, name, host, device_type, vendor, protocol, controller_mac) VALUES
      (10, 'sw-prova', '192.0.2.2', 'switch', 'ubiquiti', 'api', '02:00:00:00:00:a1'),
      (20, 'ap-prova', '192.0.2.3', 'access_point', 'ubiquiti', 'api', '02:00:00:00:00:b1'),
      (30, 'altro', '192.0.2.4', 'switch', 'hp', 'snmp_v2', NULL);
    INSERT INTO switch_ports (device_id, port_index, port_name) VALUES (10, 5, 'Porta-cinque'), (10, 7, 'Port 7');
  `);
});

after(() => {
  deleteTenantDatabase(T);
  closeHubDb();
  removeTestHubDb();
});

function input(campi: Partial<ControllerInput> = {}): ControllerInput {
  return {
    name: "console-prova",
    kind: "udm",
    url: "https://192.0.2.1",
    site: "default",
    username: "",
    password: "",
    apiKey: CHIAVE,
    enabled: true,
    scheduleMinutes: null,
    certPin: null,
    ...campi,
  };
}

/** Console UniFi OS finta: accetta solo la chiave giusta, presenta l'impronta `pin`. */
function consoleFinta(o: { pin?: string; rete?: boolean } = {}): { factory: UnifiTransportFactory; calls: UnifiHttpRequest[] } {
  const calls: UnifiHttpRequest[] = [];
  const factory: UnifiTransportFactory = (_base, pins) => async (req) => {
    checkPresentedPin(pins, o.pin ?? PIN);
    if (o.rete) throw new UnifiApiError("network", "Controller non raggiungibile: tempo scaduto (ETIMEDOUT)");
    calls.push(req);
    if (req.headers["X-API-KEY"] !== CHIAVE) {
      return { status: 401, headers: {}, body: JSON.stringify({ error: { code: 401, message: "Unauthorized" } }) };
    }
    if (req.path === "/proxy/network/api/s/default/stat/sta") return { status: 200, headers: {}, body: STA_BODY };
    return { status: 404, headers: {}, body: "{}" };
  };
  return { factory, calls };
}

test("lettura riuscita: cablato sulla porta dello switch, wireless sull'AP («wifi»), source unifi; storico «Lettura client»", async () => {
  const v = w(() => createController(input({ certPin: PIN })));
  // Conteggi dell'ultima lettura degli APPARATI: la lettura dei client non li deve toccare.
  db().prepare("UPDATE network_controllers SET last_ok = 1, last_devices = 4, last_ports = 30, last_message = 'apparati' WHERE id = ?").run(v.id);
  const { factory, calls } = consoleFinta();

  const r = await w(() => syncUnifiClientsForController(v.id, "manual", { clientOptions: { transportFactory: factory } }));

  assert.deepEqual(r, { ok: true, clients: 3, saved: 2, unmatched: 1, failure: null });
  assert.deepEqual(
    calls.map((c) => `${c.method} ${c.path}`),
    ["GET /proxy/network/api/s/default/stat/sta"],
    "una sola richiesta, in lettura",
  );
  assert.deepEqual(
    righe().map(({ device_id, mac, port_name, source }) => ({ device_id, mac, port_name, source })),
    [
      { device_id: 10, mac: "02:00:00:00:10:01", port_name: "Porta-cinque", source: "unifi" },
      { device_id: 20, mac: "02:00:00:00:10:02", port_name: "wifi", source: "unifi" },
    ],
  );
  const [giro] = w(() => listControllerClientRunViews(v.id));
  assert.equal(giro.ok, true);
  assert.equal(giro.kind, "client");
  assert.equal(giro.trigger, "manual");
  assert.equal(
    getTenantDb(T).prepare("SELECT trigger FROM network_controller_runs WHERE id = ?").pluck().get(giro.id),
    "client:manual",
  );
  assert.equal(w(() => listControllerRunViews(v.id)).length, 0, "lo storico degli apparati non vede le letture dei client");
  assert.equal(giro.total, 3);
  assert.equal(giro.ports, 2);
  assert.equal(giro.skipped, 1);
  assert.equal(giro.message, "Lettura client: 3 letti, 2 salvati, 1 non abbinati");
  const [vista] = w(() => listControllerViews());
  assert.equal(vista.lastDevices, 4, "i conteggi degli apparati restano quelli della loro lettura");
  assert.equal(vista.lastPorts, 30);
  assert.equal(vista.lastMessage, "apparati");
});

for (const [caso, opzioni, motivo] of [
  ["chiave rifiutata", { factory: () => consoleFinta().factory, cfg: { apiKey: "chiave-sbagliata-0000000000000000" } }, /Chiave API rifiutata/],
  ["controller irraggiungibile", { factory: () => consoleFinta({ rete: true }).factory, cfg: {} }, /non raggiungibile/],
  ["certificato cambiato", { factory: () => consoleFinta({ pin: `sha256/${Buffer.alloc(32, 9).toString("base64")}` }).factory, cfg: {} }, /certificato/i],
] as const) {
  test(`errore del controller (${caso}): niente scritto, le righe esistenti restano com'erano, il giro fallito è nello storico`, async () => {
    const v = w(() => createController(input({ certPin: PIN, ...opzioni.cfg })));
    db().exec(`INSERT INTO mac_port_entries (device_id, mac, port_name, vlan, port_status, speed, timestamp, first_seen, source)
               VALUES (10, '02:00:00:00:10:01', 'Port 5', NULL, NULL, NULL, '2026-10-01 08:00:00', '2026-09-01 08:00:00', 'device')`);
    const prima = righe();

    const r = await w(() => syncUnifiClientsForController(v.id, "schedule", { clientOptions: { transportFactory: opzioni.factory() } }));

    assert.equal(r.ok, false);
    assert.equal(r.clients, 0);
    assert.equal(r.saved, 0);
    assert.match(r.failure ?? "", motivo);
    assert.deepEqual(righe(), prima, "un errore non è «zero client»: le righe esistenti invecchiano, non si toccano");
    const [giro] = w(() => listControllerClientRunViews(v.id));
    assert.equal(giro.ok, false);
    assert.equal(giro.trigger, "schedule");
    assert.equal(giro.kind, "client");
    assert.match(giro.message ?? "", /^Lettura client: /);
  });
}

test("controller inesistente o spento: niente lettura, niente scritto", async () => {
  const { factory, calls } = consoleFinta();
  const assente = await w(() => syncUnifiClientsForController(999, "manual", { clientOptions: { transportFactory: factory } }));
  assert.equal(assente.ok, false);
  assert.match(assente.failure ?? "", /non trovato/);

  const v = w(() => createController(input({ certPin: PIN, enabled: false })));
  const spento = await w(() => syncUnifiClientsForController(v.id, "schedule", { clientOptions: { transportFactory: factory } }));
  assert.equal(spento.ok, false);
  assert.match(spento.failure ?? "", /spento/);
  assert.equal(calls.length, 0);
  assert.equal(righe().length, 0);
});

test("nessun MAC, nome o IP nei log del giro", async () => {
  const v = w(() => createController(input({ certPin: PIN })));
  const scritto: string[] = [];
  const originali = { log: console.log, info: console.info, warn: console.warn, error: console.error };
  for (const k of ["log", "info", "warn", "error"] as const) {
    console[k] = (...a: unknown[]) => {
      scritto.push(a.map(String).join(" "));
    };
  }
  try {
    await w(() => syncUnifiClientsForController(v.id, "manual", { clientOptions: { transportFactory: consoleFinta().factory } }));
    await w(() => syncUnifiClientsForController(v.id, "manual", { clientOptions: { transportFactory: consoleFinta({ rete: true }).factory } }));
  } finally {
    Object.assign(console, originali);
  }
  const tutto = scritto.join("\n");
  assert.doesNotMatch(tutto, /02:00:00|client-\d|192\.0\.2\./);
});
