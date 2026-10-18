/**
 * Passo 4 del piano di solidità (16/10): la salute distingue «spento» da «guasto».
 *
 * - Un modulo spento o mai configurato dice `off` (status «never»), non `fail`, e la
 *   sua sonda non chiama niente.
 * - Patch Management acceso dice «locale, non verificato» (`unverified`), non `ok`
 *   dedotto dall'interruttore.
 * - Inventory Agent si giudica dall'età dell'ultimo inventario ricevuto.
 * - Network Services si giudica dal contenuto di `/api/v1/status`.
 *
 * Tenant temporaneo, hub isolato, nessuna rete: nessuna sonda di questo file deve
 * contattare qualcosa (un modulo acceso a metà si ferma prima della chiamata).
 * Hub DB isolato: `support/hub-isolato` va importato PER PRIMO (il perché sta lì).
 */
import { removeTestHubDb } from "../../integrations/__tests__/support/hub-isolato";
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { closeHubDb, setSetting } from "@/lib/db-hub";
import { deleteTenantDatabase, getTenantDb } from "@/lib/db-tenant";
import { setFeatureDisabled, setFeatureEnabled } from "@/lib/patch/feature";
import { INVENTORY_AGENT_SCHEMA_SQL } from "@/lib/inventory-agent/schema";
import {
  composeInventoryAgentHealth,
  composeNetServicesHealth,
  composePatchHealth,
  getModulesHealth,
  INVENTARIO_FERMO_ORE,
  INVENTARIO_FRESCO_ORE,
  isMeasuredVerdict,
  type ModuleHealthVerdict,
} from "../health";

const T = "TESTSPENTOGUASTO";
const P = "2026-10-16T08:00:00.000Z";
const ORA = Date.parse("2026-10-16T08:00:00Z");

// Le variabili d'ambiente accendono Network Services anche senza riga nel DB (MOD-19).
delete process.env.NET_SERVICES_API_URL;
delete process.env.NET_SERVICES_API_TOKEN;

const SETTINGS_TOCCATI = [
  "integration_librenms_mode",
  "integration_librenms_url",
  "integration_graylog_mode",
  "integration_graylog_url",
  "integration_wazuh_enabled",
  "integration_wazuh_url",
];

function spegniTutto(): void {
  for (const k of SETTINGS_TOCCATI) setSetting(k, "");
  setSetting("integration_librenms_mode", "disabled");
  setSetting("integration_graylog_mode", "disabled");
  setSetting("integration_wazuh_enabled", "0");
  for (const f of ["patch_management", "inventory_agent", "meshcentral", "network_services"]) {
    setFeatureDisabled(T, f);
  }
}

beforeEach(() => {
  deleteTenantDatabase(T);
  spegniTutto();
});

after(() => {
  deleteTenantDatabase(T);
  closeHubDb();
  removeTestHubDb();
});

async function verdetti(): Promise<Record<string, ModuleHealthVerdict>> {
  const h = await getModulesHealth(T, { force: true });
  return Object.fromEntries(h.map((x) => [x.key, x.verdict]));
}

test("istanza senza moduli: ogni modulo è spento, nessuno è in errore", async () => {
  // Visto a schermo il 15/10: ogni sonda diceva «fail» su un'istanza appena installata.
  const h = await getModulesHealth(T, { force: true });
  for (const m of h) {
    if (m.key === "appliance") continue; // la macchina si misura sempre
    assert.equal(m.verdict, "off", `${m.key}: ${m.detail}`);
    assert.equal(m.status, "never", m.key);
    assert.equal(m.repairAction, null, m.key);
  }
});

test("acceso a metà è un guasto, non uno spento: tabella dei casi", async () => {
  const casi: Array<[string, () => void, string, ModuleHealthVerdict]> = [
    ["LibreNMS acceso senza URL", () => setSetting("integration_librenms_mode", "external"), "librenms", "fail"],
    ["Graylog acceso senza URL", () => setSetting("integration_graylog_mode", "external"), "graylog", "fail"],
    ["Wazuh acceso senza URL", () => setSetting("integration_wazuh_enabled", "1"), "wazuh", "fail"],
    ["MeshCentral acceso senza parametri", () => setFeatureEnabled(T, "meshcentral", null), "meshcentral", "fail"],
    ["Network Services acceso senza bridge", () => setFeatureEnabled(T, "network_services", null), "network_services", "fail"],
    ["Patch Management acceso", () => setFeatureEnabled(T, "patch_management", null), "patch_management", "unverified"],
    ["Inventory Agent acceso, nessun inventario", () => setFeatureEnabled(T, "inventory_agent", null), "inventory_agent", "degraded"],
  ];
  for (const [nome, accendi, chiave, atteso] of casi) {
    spegniTutto();
    accendi();
    const v = await verdetti();
    assert.equal(v[chiave], atteso, nome);
  }
});

test("Inventory Agent acceso: il verdetto viene dall'ultimo inventario nel DB del cliente", async () => {
  setFeatureEnabled(T, "inventory_agent", null);
  const db = getTenantDb(T);
  db.exec(INVENTORY_AGENT_SCHEMA_SQL);
  db.prepare(
    "INSERT INTO inv_agent_endpoint (device_id, hostname, last_seen_at) VALUES ('pc-1', 'pc-1', datetime('now', '-2 hours'))",
  ).run();
  const [h] = await getModulesHealth(T, { force: true, only: "inventory_agent" });
  assert.equal(h.verdict, "ok");
  assert.match(h.detail ?? "", /Ultimo inventario 2 ore fa \(1 computer\)/);
  assert.ok(h.lastSyncAt);
});

test("Patch Management: spento o «locale, non verificato», mai «ok» dall'interruttore", () => {
  const off = composePatchHealth(P, false);
  assert.equal(off.verdict, "off");
  assert.equal(off.status, "never");
  const on = composePatchHealth(P, true);
  assert.equal(on.verdict, "unverified");
  assert.equal(on.status, "never");
  assert.equal(isMeasuredVerdict(on.verdict), false);
});

test("Inventory Agent: età dell'ultimo inventario, tabella dei casi", () => {
  const fa = (ore: number) => new Date(ORA - ore * 3_600_000).toISOString().replace("T", " ").slice(0, 19);
  const casi: Array<[string, boolean, string | null, ModuleHealthVerdict]> = [
    ["spento", false, null, "off"],
    ["acceso, mai ricevuto", true, null, "degraded"],
    ["30 minuti fa", true, fa(0.5), "ok"],
    ["al limite del fresco", true, fa(INVENTARIO_FRESCO_ORE), "ok"],
    ["appena oltre il fresco", true, fa(INVENTARIO_FRESCO_ORE + 1), "degraded"],
    ["al limite del fermo", true, fa(INVENTARIO_FERMO_ORE), "degraded"],
    ["oltre il fermo", true, fa(INVENTARIO_FERMO_ORE + 1), "fail"],
    ["data non leggibile", true, "ieri", "degraded"],
  ];
  for (const [nome, enabled, ultimo, atteso] of casi) {
    const h = composeInventoryAgentHealth(P, { enabled, ultimoInventario: ultimo, endpoint: 3, nowMs: ORA });
    assert.equal(h.verdict, atteso, nome);
    assert.equal(h.key, "inventory_agent");
  }
});

test("Network Services: verdetto dalla risposta del bridge, tabella dei casi", () => {
  const voce = (a: string, e: string) => ({ active: a, enabled: e, units: "x" });
  const tutti = { resolver: voce("active", "enabled"), adblock: voce("active", "enabled"), dns: voce("active", "enabled"), dhcp: voce("active", "enabled") };
  const casi: Array<[string, Parameters<typeof composeNetServicesHealth>[2], ModuleHealthVerdict]> = [
    ["bridge irraggiungibile", { ok: false, error: "timeout" }, "fail"],
    ["token rifiutato", { ok: false, error: "Token non valido (HTTP 401)" }, "fail"],
    ["200 ma non JSON", { ok: true, corpo: null }, "degraded"],
    ["tutti accesi", { ok: true, corpo: { services: tutti } }, "ok"],
    ["Kea fermo ma abilitato", { ok: true, corpo: { services: { ...tutti, dhcp: voce("inactive", "enabled") } } }, "degraded"],
    ["AdGuard spento a mano", { ok: true, corpo: { services: { ...tutti, adblock: voce("inactive", "disabled") } } }, "ok"],
  ];
  for (const [nome, probe, atteso] of casi) {
    const h = composeNetServicesHealth(P, "database", probe);
    assert.equal(h.verdict, atteso, nome);
  }
  const conServizi = composeNetServicesHealth(P, "database", { ok: true, corpo: { services: tutti } });
  assert.deepEqual(conServizi.servizi?.map((s) => s.nome), ["Unbound", "AdGuard", "PowerDNS", "Kea"]);
});

test("Network Services configurato dalle variabili d'ambiente: il dettaglio lo dice", () => {
  const ok = composeNetServicesHealth(P, "env", { ok: true, corpo: { services: {} } });
  assert.match(ok.detail ?? "", /variabili d'ambiente/);
  const ko = composeNetServicesHealth(P, "env", { ok: false, error: "timeout" });
  assert.match(ko.detail ?? "", /^timeout \(configurazione dalle variabili d'ambiente\)$/);
  const db = composeNetServicesHealth(P, "database", { ok: false, error: "timeout" });
  assert.equal(db.detail, "timeout");
});
