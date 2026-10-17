// Import JSON dei moduli: Deploy-Appliance manda `extra.mode = "appliance"` per il
// LibreNMS che installa lui (seguito del passo 5, 16/10). Senza, resta `external`.
// Hub DB isolato: `support/hub-isolato` va importato PER PRIMO.
import { removeTestHubDb } from "@/lib/integrations/__tests__/support/hub-isolato";
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { closeHubDb, setSetting } from "@/lib/db-hub";
import { getIntegrationConfig, setIntegrationConfig } from "@/lib/integrations/config";
import { rifiutoModo } from "@/lib/integrations/librenms-modo";
import { configIntegrazioneDaImport, modoDaImport } from "../import-integrazione";
import { ModuleImportEntrySchema, type ModuleImportEntry } from "../import-schema";

const CHIAVI = ["librenms", "graylog"].flatMap((c) =>
  ["mode", "url", "api_token", "ui_url"].map((k) => `integration_${c}_${k}`),
);

beforeEach(() => {
  for (const k of CHIAVI) setSetting(k, "");
});

after(() => {
  closeHubDb();
  removeTestHubDb();
});

function voce(v: unknown): ModuleImportEntry & { module: "librenms" | "graylog" } {
  const e = ModuleImportEntrySchema.parse(v);
  assert.ok(e.module === "librenms" || e.module === "graylog");
  return { ...e, module: e.module };
}

test("LibreNMS con extra.mode = appliance → appliance", () => {
  assert.equal(modoDaImport("librenms", { mode: "appliance" }), "appliance");
  const cfg = configIntegrazioneDaImport(
    voce({ module: "librenms", url: "https://192.0.2.10:8443", api_url: "http://192.0.2.10:8000", api_key: "t0k3n", extra: { mode: "appliance" } }),
  );
  assert.equal(cfg.mode, "appliance");
  assert.equal(cfg.url, "http://192.0.2.10:8000");
  assert.equal(cfg.uiUrl, "https://192.0.2.10:8443");
  assert.equal(cfg.apiToken, "t0k3n");
});

test("LibreNMS senza extra.mode (installatore vecchio) → external, come prima", () => {
  assert.equal(modoDaImport("librenms", undefined), "external");
  assert.equal(modoDaImport("librenms", {}), "external");
  const cfg = configIntegrazioneDaImport(voce({ module: "librenms", url: "http://192.0.2.10:8000", api_key: "t" }));
  assert.equal(cfg.mode, "external");
});

test("valori diversi da «appliance» esatto restano external", () => {
  for (const m of ["Appliance", " appliance", "managed", "external", "", 1, true, null]) {
    assert.equal(modoDaImport("librenms", { mode: m }), "external", String(m));
  }
});

test("Graylog ignora extra.mode = appliance (il modo vale solo per LibreNMS)", () => {
  assert.equal(modoDaImport("graylog", { mode: "appliance" }), "external");
  const cfg = configIntegrazioneDaImport(
    voce({ module: "graylog", url: "http://192.0.2.11:9000", username: "admin", password: "x", extra: { mode: "appliance" } }),
  );
  assert.equal(cfg.mode, "external");
  assert.equal(rifiutoModo("graylog", cfg.mode), null);
  assert.equal(cfg.username, "admin");
});

test("senza url né api_url l'import rifiuta, come prima", () => {
  assert.throws(() => configIntegrazioneDaImport(voce({ module: "librenms", extra: { mode: "appliance" } })), /richiede url o api_url/);
});

test("salvata e riletta: appliance per LibreNMS dall'import, external senza mode", () => {
  setIntegrationConfig("librenms", configIntegrazioneDaImport(
    voce({ module: "librenms", url: "http://192.0.2.10:8000", api_key: "t", extra: { mode: "appliance" } }),
  ));
  assert.equal(getIntegrationConfig("librenms").mode, "appliance");
  setIntegrationConfig("librenms", configIntegrazioneDaImport(voce({ module: "librenms", url: "http://192.0.2.10:8000", api_key: "t" })));
  assert.equal(getIntegrationConfig("librenms").mode, "external");
});

test("la rotta d'import usa il modo calcolato, non più «external» scritto a mano", () => {
  const src = readFileSync(join(process.cwd(), "src/app/api/modules/import/route.ts"), "utf8");
  assert.match(src, /configIntegrazioneDaImport\(/);
  assert.doesNotMatch(src, /mode:\s*"external"/);
});
