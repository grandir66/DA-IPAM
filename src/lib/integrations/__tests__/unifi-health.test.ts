// Salute dei controller di rete per «Stato moduli» (ADR 0007): parte pura,
// dai controller del tenant al verdetto. Nessuna rete e nessun DB: la lettura
// dal DB è provata in modules/__tests__/unifi-module.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { composeControllersHealth } from "../unifi-health";
import type { NetworkControllerView } from "@/lib/controllers/types";

function c(campi: Partial<NetworkControllerView> = {}): NetworkControllerView {
  return {
    id: 1,
    name: "UDM",
    vendor: "unifi",
    kind: "udm",
    url: "https://192.168.1.1",
    site: "default",
    username: "",
    passwordSet: false,
    apiKeySet: true,
    certPin: null,
    enabled: true,
    lastRunAt: null,
    lastOk: null,
    lastMessage: null,
    lastDevices: null,
    lastPorts: null,
    lastNeighbors: null,
    origin: "manual",
    scheduleMinutes: null,
    clientSchedule: false,
    lastClientRun: null,
    credentialId: 1,
    credentialName: "UniFi · UDM",
    credentialMethod: "chiave",
    credentialState: "voce",
    ...campi,
  };
}

test("nessun controller, o tutti spenti: «Non configurato», non un errore", () => {
  for (const lista of [[], [c({ enabled: false })]]) {
    const r = composeControllersHealth(lista);
    assert.equal(r.configured, false);
    assert.equal(r.verdict, "off");
    assert.equal(r.detail, "Non configurato");
    assert.equal(r.repair, null);
  }
});

test("Omada non conta: non si legge ancora", () => {
  const r = composeControllersHealth([c({ kind: "omada", vendor: "omada" })]);
  assert.equal(r.configured, false);
});

test("acceso e mai letto: degradato, dice quale e cosa fare", () => {
  const r = composeControllersHealth([c({ name: "DA-UDM-Beast" })]);
  assert.equal(r.configured, true);
  assert.equal(r.verdict, "degraded");
  assert.match(r.detail, /DA-UDM-Beast: mai letto/);
});

test("tutti letti bene: ok, coi controller e gli apparati dell'ultima lettura, e l'ora dell'ultima", () => {
  const r = composeControllersHealth([
    c({ id: 1, lastOk: true, lastDevices: 42, lastRunAt: "2026-10-13 16:00:00" }),
    c({ id: 2, lastOk: true, lastDevices: 74, lastRunAt: "2026-10-13 17:00:00" }),
  ]);
  assert.equal(r.verdict, "ok");
  assert.equal(r.detail, "2 controller, 116 apparati all'ultima lettura");
  assert.equal(r.lastSyncAt, "2026-10-13 17:00:00");
});

test("una lettura fallita: errore col nome e il motivo; certificato → controllo del certificato", () => {
  const r = composeControllersHealth([
    c({ id: 1, lastOk: true, lastDevices: 42 }),
    c({ id: 2, name: "Cliente A", lastOk: false, lastMessage: "Certificato del controller cambiato: …" }),
  ]);
  assert.equal(r.verdict, "fail");
  assert.match(r.detail, /^Cliente A: Certificato del controller cambiato/);
  assert.equal(r.repair, "check_unifi_cert");
  assert.equal(r.authOk, false);
});

test("controller non raggiungibile: reachable false, il resto si riconfigura", () => {
  const r = composeControllersHealth([c({ lastOk: false, lastMessage: "Controller non raggiungibile: connessione rifiutata" })]);
  assert.equal(r.reachable, false);
  assert.equal(r.repair, "reconfigure_unifi");
});
