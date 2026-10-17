// LibreNMS solo locale (passo 5 del piano di solidità, 16/10).
// Hub DB isolato: `support/hub-isolato` va importato PER PRIMO.
import { removeTestHubDb } from "./support/hub-isolato";
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { closeHubDb, getSetting, setSetting } from "@/lib/db-hub";
import { getIntegrationConfig, setIntegrationConfig } from "../config";
import {
  CONFERMA_CONVERSIONE_LIBRENMS,
  conversioneInAppliance,
  modiAccettati,
  rifiutoModo,
} from "../librenms-modo";
import {
  ETICHETTA_APPLIANCE,
  mostraConversione,
  vistaScheda,
  vociModalita,
  type StatoScheda,
} from "../scheda-integrazione";

const CHIAVI = ["mode", "url", "api_token", "ui_url"].map((k) => `integration_librenms_${k}`);

beforeEach(() => {
  for (const k of CHIAVI) setSetting(k, "");
  setSetting("integration_librenms_mode", "disabled");
});

after(() => {
  closeHubDb();
  removeTestHubDb();
});

// ── Modi accettati ───────────────────────────────────────────────────────────

test("LibreNMS accetta appliance accanto a managed; external resta accettato (lo scrive l'installatore)", () => {
  assert.deepEqual([...modiAccettati("librenms")].sort(), ["appliance", "disabled", "external", "managed"]);
  for (const m of ["appliance", "managed", "external", "disabled"] as const) {
    assert.equal(rifiutoModo("librenms", m), null, m);
  }
  assert.equal(rifiutoModo("librenms", undefined), null);
});

test("appliance vale solo per LibreNMS: Graylog e Loki lo rifiutano con un motivo in italiano", () => {
  assert.match(rifiutoModo("graylog", "appliance") ?? "", /solo per LibreNMS/);
  assert.match(rifiutoModo("loki", "appliance") ?? "", /solo per LibreNMS/);
  assert.equal(rifiutoModo("graylog", "external"), null);
  assert.equal(rifiutoModo("loki", "managed"), null);
});

// ── Righe esistenti: niente migrazione automatica ────────────────────────────

test("una riga external esistente resta external e funzionante alla lettura (nessuna migrazione)", () => {
  setSetting("integration_librenms_mode", "external");
  setSetting("integration_librenms_url", "http://127.0.0.1:8000");
  setIntegrationConfig("librenms", { apiToken: "tok-esistente" });
  const cfg = getIntegrationConfig("librenms");
  assert.equal(cfg.mode, "external");
  assert.equal(cfg.url, "http://127.0.0.1:8000");
  assert.equal(cfg.apiToken, "tok-esistente");
  // Rilettura: il DB non è stato toccato.
  assert.equal(getSetting("integration_librenms_mode"), "external");
});

test("appliance si salva e si rilegge come ogni altro modo", () => {
  setIntegrationConfig("librenms", { mode: "appliance", url: "http://127.0.0.1:8000", apiToken: "t" });
  const cfg = getIntegrationConfig("librenms");
  assert.equal(cfg.mode, "appliance");
  assert.equal(cfg.apiToken, "t");
});

// ── Conversione esplicita ────────────────────────────────────────────────────

test("conversione: da external con indirizzo → appliance; cambia solo il modo", () => {
  setIntegrationConfig("librenms", { mode: "external", url: "http://127.0.0.1:8000", apiToken: "tok", uiUrl: "https://lnms.example.test:7443" });
  const esito = conversioneInAppliance(getIntegrationConfig("librenms"));
  assert.deepEqual(esito, { ok: true, da: "external", a: "appliance" });
  // Quello che fa la rotta dopo l'ok.
  if (esito.ok) setIntegrationConfig("librenms", { mode: esito.a });
  const dopo = getIntegrationConfig("librenms");
  assert.equal(dopo.mode, "appliance");
  assert.equal(dopo.url, "http://127.0.0.1:8000");
  assert.equal(dopo.apiToken, "tok");
  assert.equal(dopo.uiUrl, "https://lnms.example.test:7443");
});

test("conversione rifiutata (409) se già appliance, da managed/disabled o senza indirizzo", () => {
  const casi = [
    { mode: "appliance" as const, url: "http://127.0.0.1:8000", motivo: /già/ },
    { mode: "managed" as const, url: "http://127.0.0.1:8090", motivo: /solo una configurazione «Istanza esterna»/ },
    { mode: "disabled" as const, url: "", motivo: /solo una configurazione «Istanza esterna»/ },
    { mode: "external" as const, url: "  ", motivo: /non ha un indirizzo/ },
  ];
  for (const c of casi) {
    const esito = conversioneInAppliance(c);
    assert.equal(esito.ok, false, c.mode);
    if (!esito.ok) {
      assert.equal(esito.status, 409);
      assert.match(esito.error, c.motivo);
    }
  }
});

test("la conferma è in italiano e dice che cambia solo la modalità", () => {
  assert.match(CONFERMA_CONVERSIONE_LIBRENMS, /Installato dall'appliance/);
  assert.match(CONFERMA_CONVERSIONE_LIBRENMS, /Cambia soltanto la modalità/);
});

// ── Tendina della scheda ─────────────────────────────────────────────────────

const base: StatoScheda = {
  dallAppliance: false,
  dockerAvailable: true,
  managed: false,
  installing: false,
  containerRunning: false,
};

test("LibreNMS nuovo: niente «Istanza esterna» in tendina, c'è «Installato dall'appliance»", () => {
  for (const salvato of ["disabled", "managed", "appliance", null] as const) {
    const voci = vociModalita("librenms", salvato, vistaScheda(base));
    assert.deepEqual(voci.map((v) => v.value), ["disabled", "managed", "appliance"], String(salvato));
    assert.equal(voci.find((v) => v.value === "appliance")?.label, ETICHETTA_APPLIANCE);
    assert.equal(mostraConversione("librenms", salvato), false);
  }
});

test("LibreNMS salvato external: la voce resta leggibile e si propone «Converti»", () => {
  const voci = vociModalita("librenms", "external", vistaScheda({ ...base, dallAppliance: true }));
  assert.deepEqual(voci.map((v) => v.value), ["disabled", "managed", "appliance", "external"]);
  assert.equal(voci.find((v) => v.value === "external")?.label, "Istanza esterna (da convertire)");
  assert.equal(mostraConversione("librenms", "external"), true);
});

test("Graylog e Loki: tendina come prima, niente appliance, niente Converti", () => {
  for (const c of ["graylog", "loki"] as const) {
    const voci = vociModalita(c, "disabled", vistaScheda(base));
    assert.deepEqual(voci.map((v) => v.value), ["disabled", "managed", "external"]);
    assert.equal(voci[2].label, "Istanza esterna");
    assert.equal(mostraConversione(c, "external"), false);
  }
});

test("Docker locale resta non selezionabile con il LibreNMS dell'appliance presente", () => {
  const voci = vociModalita("librenms", "appliance", vistaScheda({ ...base, dallAppliance: true }));
  const managed = voci.find((v) => v.value === "managed");
  assert.equal(managed?.disabled, true);
  assert.equal(managed?.label, "Docker locale (c'è già)");
});
