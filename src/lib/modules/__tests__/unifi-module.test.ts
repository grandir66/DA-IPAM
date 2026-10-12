// Il controller UniFi nel registry dei moduli e in «Stato moduli» (tappa 2,
// Task 7 e correzione 8 del piano UniFi). Tenant temporaneo, hub isolato,
// nessuna rete verso sistemi veri: l'unico indirizzo contattato è
// 127.0.0.1:1, chiuso (connessione rifiutata subito).
// Hub DB isolato: `support/hub-isolato` va importato PER PRIMO (il perché sta lì).
import { removeTestHubDb } from "../../integrations/__tests__/support/hub-isolato";
import fs from "node:fs";
import path from "node:path";
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { closeHubDb, setSetting } from "@/lib/db-hub";
import { deleteTenantDatabase, withTenant } from "@/lib/db-tenant";
import { setIntegrationConfig, unifiCertPinStore } from "@/lib/integrations/config";
import { checkPresentedPin, type UnifiTransportFactory } from "@/lib/integrations/unifi-api";
import { readUnifiHealth, resetUnifiHealthMemo } from "@/lib/integrations/unifi-health";
import { MODULE_DESCRIPTORS, resolveModules } from "../registry";
import { getModulesHealth, invalidateModulesHealth, PROBED_MODULE_KEYS } from "../health";

const T = "TESTUNIFIMODULO";
const PIN = `sha256/${Buffer.alloc(32, 5).toString("base64")}`;
const STAT_BODY = fs.readFileSync(
  path.join(__dirname, "..", "..", "integrations", "__tests__", "fixtures", "unifi-stat-device.json"),
  "utf-8",
);
const KEYS = ["mode", "url", "kind", "site", "username", "password", "api_token", "cert_pin"].map(
  (k) => `integration_unifi_${k}`,
);

beforeEach(() => {
  deleteTenantDatabase(T);
  for (const k of KEYS) setSetting(k, "");
  resetUnifiHealthMemo();
});

after(() => {
  deleteTenantDatabase(T);
  closeHubDb();
  removeTestHubDb();
});

function unifiState() {
  return withTenant(T, async () => (await resolveModules(T)).find((m) => m.key === "unifi"));
}

test("descrittore: Controller UniFi, accesso nativo, card in Impostazioni → Moduli", () => {
  const d = MODULE_DESCRIPTORS.find((m) => m.key === "unifi");
  assert.ok(d, "manca il descrittore unifi");
  assert.equal(d.label, "Controller UniFi");
  assert.equal(d.access, "native");
  assert.equal(d.configHref, "/settings?tab=moduli#module-unifi");
  // «Sistema appliance» resta l'ultima voce.
  assert.equal(MODULE_DESCRIPTORS[MODULE_DESCRIPTORS.length - 1].key, "appliance");
});

test("registry: spenta → non installato, non configurato, con la nota sulla card", async () => {
  const m = await unifiState();
  assert.ok(m, "resolveModules non riporta unifi");
  assert.equal(m.installed, false);
  assert.equal(m.configured, false);
  assert.equal(m.enabled, false);
  assert.match(m.note ?? "", /card Controller UniFi/);
});

test("registry: accesa ma senza password → installato, non configurato, dice cosa manca", async () => {
  setIntegrationConfig("unifi", { mode: "external", url: "https://127.0.0.1:1", username: "map" });
  const m = await unifiState();
  assert.ok(m);
  assert.equal(m.installed, true);
  assert.equal(m.configured, false);
  assert.match(m.note ?? "", /manca la password/);
});

test("registry: configurata → attiva, apre /topology, console del controller come interfaccia esterna", async () => {
  setIntegrationConfig("unifi", { mode: "external", url: "https://127.0.0.1:1", username: "map", password: "x" });
  const m = await unifiState();
  assert.ok(m);
  assert.equal(m.installed, true);
  assert.equal(m.configured, true);
  assert.equal(m.enabled, true);
  assert.equal(m.uiUrl, "/topology");
  assert.equal(m.externalUiUrl, "https://127.0.0.1:1");
});

test("Stato moduli: escono tutti e soli i moduli con sonda; UniFi spento è «Non configurato», non un errore", async () => {
  const health = await getModulesHealth(T, { force: true });
  assert.deepEqual(
    health.map((h) => h.key),
    [...PROBED_MODULE_KEYS],
  );
  const u = health.find((h) => h.key === "unifi");
  assert.ok(u);
  assert.equal(u.status, "never");
  assert.equal(u.message, "Non configurato");
});

test("Stato moduli: la verifica forzata di un altro modulo non diventa un login sul controller", async () => {
  setIntegrationConfig("unifi", { mode: "external", url: "https://127.0.0.1:1", username: "map", password: "x" });
  unifiCertPinStore.set(PIN);
  // Un risultato preso col controller finto, per questa stessa configurazione.
  const finto: UnifiTransportFactory = (_b, pins) => async (req) => {
    checkPresentedPin(pins, PIN);
    if (req.path === "/api/login") {
      return {
        status: 200,
        headers: { "set-cookie": ["unifises=S1; Path=/; Secure"] },
        body: JSON.stringify({ meta: { rc: "ok" }, data: [] }),
      };
    }
    if (req.path === "/api/logout") return { status: 200, headers: {}, body: JSON.stringify({ meta: { rc: "ok" }, data: [] }) };
    return { status: 200, headers: {}, body: STAT_BODY };
  };
  const preso = await readUnifiHealth({ clientOptions: { transportFactory: finto } });
  assert.equal(preso.verdict, "ok");

  // La notifica disco forza «appliance» ogni 30 minuti: per UniFi vale il risultato tenuto.
  const [u1] = (await getModulesHealth(T, { force: true })).filter((h) => h.key === "unifi");
  assert.equal(u1.status, "error", "force senza only rilegge anche il controller (127.0.0.1:1 chiuso)");

  resetUnifiHealthMemo();
  await readUnifiHealth({ clientOptions: { transportFactory: finto } });
  const conAppliance = await getModulesHealth(T, { force: true, only: "appliance" });
  assert.deepEqual(conAppliance.map((h) => h.key), ["appliance"]);
  invalidateModulesHealth(T);
  const [u2] = (await getModulesHealth(T)).filter((h) => h.key === "unifi");
  assert.equal(u2.status, "ok", "la verifica di «appliance» non ha riletto il controller");
  assert.equal(u2.message, "4 apparati letti dal controller");

  const [u3] = await getModulesHealth(T, { force: true, only: "unifi" });
  assert.equal(u3.key, "unifi");
  assert.equal(u3.status, "error", "«Verifica» su UniFi rilegge davvero");
  assert.equal(u3.reachable, false);
});

test("Stato moduli: la notifica disco ogni 30 minuti non rilegge il controller nemmeno a risultato scaduto", async (t) => {
  setIntegrationConfig("unifi", { mode: "external", url: "https://127.0.0.1:1", username: "map", password: "x" });
  unifiCertPinStore.set(PIN);
  const finto: UnifiTransportFactory = (_b, pins) => async (req) => {
    checkPresentedPin(pins, PIN);
    if (req.path === "/api/login") {
      return {
        status: 200,
        headers: { "set-cookie": ["unifises=S1; Path=/; Secure"] },
        body: JSON.stringify({ meta: { rc: "ok" }, data: [] }),
      };
    }
    if (req.path === "/api/logout") return { status: 200, headers: {}, body: JSON.stringify({ meta: { rc: "ok" }, data: [] }) };
    return { status: 200, headers: {}, body: STAT_BODY };
  };
  // Solo l'orologio è finto: rete e timeout restano veri.
  const inizio = Date.now();
  t.mock.timers.enable({ apis: ["Date"], now: inizio });
  assert.equal((await readUnifiHealth({ clientOptions: { transportFactory: finto } })).verdict, "ok");

  // Mezz'ora dopo: il risultato tenuto (5 minuti) è scaduto, scatta il cron della notifica disco.
  t.mock.timers.tick(30 * 60_000);
  const rows = await getModulesHealth(T, { force: true, only: "appliance" });
  assert.deepEqual(rows.map((h) => h.key), ["appliance"]);

  // Se la sonda UniFi fosse partita avrebbe provato 127.0.0.1:1 (chiuso) e
  // tenuto quel risultato d'errore: tornando all'inizio si leggerebbe lui.
  t.mock.timers.setTime(inizio);
  const r = await readUnifiHealth();
  assert.equal(r.verdict, "ok", "la notifica disco ha fatto un login sul controller");
  assert.equal(r.detail, "4 apparati letti dal controller");
});
