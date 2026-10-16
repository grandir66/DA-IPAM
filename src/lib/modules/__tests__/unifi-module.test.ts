// I controller di rete nel registry dei moduli e in «Stato moduli» (ADR 0007).
// Tenant temporaneo, hub isolato, nessuna rete: «Stato moduli» non contatta
// più i controller, legge l'esito dell'ultima lettura salvata. L'unico
// indirizzo configurato è 127.0.0.1:1, chiuso: se una sonda partisse davvero,
// l'esito diventerebbe un errore e la prova lo vedrebbe.
// Hub DB isolato: `support/hub-isolato` va importato PER PRIMO (il perché sta lì).
import { removeTestHubDb } from "../../integrations/__tests__/support/hub-isolato";
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { closeHubDb } from "@/lib/db-hub";
import { deleteTenantDatabase, insertNetworkController, recordControllerRun, withTenant } from "@/lib/db-tenant";
import { MODULE_DESCRIPTORS, resolveModules } from "../registry";
import { getModulesHealth, PROBED_MODULE_KEYS } from "../health";

const T = "TESTUNIFIMODULO";

beforeEach(() => {
  deleteTenantDatabase(T);
});

after(() => {
  deleteTenantDatabase(T);
  closeHubDb();
  removeTestHubDb();
});

function unifiState() {
  return withTenant(T, async () => (await resolveModules(T, "admin")).find((m) => m.key === "unifi"));
}

function controller(enabled: number): number {
  return withTenant(T, () =>
    insertNetworkController({
      name: "UDM di prova",
      vendor: "unifi",
      kind: "udm",
      url: "https://127.0.0.1:1",
      site: "default",
      username: "",
      password_enc: "",
      api_key_enc: "x",
      cert_pin: null,
      enabled,
      origin: "manual",
    }),
  ).id;
}

function lettura(controllerId: number, ok: boolean): void {
  withTenant(T, () =>
    recordControllerRun({
      controller_id: controllerId,
      started_at: "2026-10-13 16:00:00",
      finished_at: "2026-10-13 16:00:05",
      trigger: "manual",
      triggered_by: "prova",
      ok: ok ? 1 : 0,
      total: ok ? 4 : 0,
      added: ok ? 4 : 0,
      updated: 0,
      skipped: 0,
      ports: ok ? 39 : 0,
      neighbors: ok ? 7 : 0,
      message: ok ? "4 apparati, 4 nuovi, 0 aggiornati" : "Controller UniFi: Chiave API rifiutata dalla console UniFi OS",
      errors_json: "[]",
      skipped_reasons_json: "[]",
      offline_json: "[]",
    }),
  );
}

test("descrittore: Controller UniFi, accesso nativo, si configura dalla pagina Controller di rete", () => {
  const d = MODULE_DESCRIPTORS.find((m) => m.key === "unifi");
  assert.ok(d, "manca il descrittore unifi");
  assert.equal(d.label, "Controller UniFi");
  assert.equal(d.access, "native");
  assert.equal(d.configHref, "/controllers");
  // «Sistema appliance» resta l'ultima voce.
  assert.equal(MODULE_DESCRIPTORS[MODULE_DESCRIPTORS.length - 1].key, "appliance");
});

test("registry: nessun controller → non installato, non configurato, dice dove aggiungerlo", async () => {
  const m = await unifiState();
  assert.ok(m, "resolveModules non riporta unifi");
  assert.equal(m.installed, false);
  assert.equal(m.configured, false);
  assert.equal(m.enabled, false);
  assert.match(m.note ?? "", /Controller di rete/);
});

test("registry: controller presente ma spento → installato, non configurato, lo dice", async () => {
  controller(0);
  const m = await unifiState();
  assert.ok(m);
  assert.equal(m.installed, true);
  assert.equal(m.configured, false);
  assert.match(m.note ?? "", /spenti/);
});

test("registry: controller acceso → attivo, apre /topology, console del controller come interfaccia esterna", async () => {
  controller(1);
  const m = await unifiState();
  assert.ok(m);
  assert.equal(m.installed, true);
  assert.equal(m.configured, true);
  assert.equal(m.enabled, true);
  assert.equal(m.uiUrl, "/topology");
  assert.equal(m.externalUiUrl, "https://127.0.0.1:1");
});

test("Stato moduli: escono tutti e soli i moduli con sonda; nessun controller è «Non configurato», non un errore", async () => {
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

test("Stato moduli: anche forzato non contatta il controller, legge l'ultima lettura salvata", async () => {
  const id = controller(1);
  lettura(id, true);
  // 127.0.0.1:1 è chiuso: una sonda vera darebbe errore.
  const [u] = await getModulesHealth(T, { force: true, only: "unifi" });
  assert.equal(u.key, "unifi");
  assert.equal(u.status, "ok");
  assert.match(u.message ?? "", /1 controller, 4 apparati/);
});

test("Stato moduli: l'ultima lettura fallita è un errore col nome del controller e il motivo", async () => {
  const id = controller(1);
  lettura(id, true);
  lettura(id, false);
  const [u] = await getModulesHealth(T, { force: true, only: "unifi" });
  assert.equal(u.status, "error");
  assert.match(u.message ?? "", /UDM di prova: .*Chiave API rifiutata/);
});
