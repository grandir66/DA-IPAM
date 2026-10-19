/**
 * Gruppo «Applicativi» del menu (Riccardo, 19/10): il Launchpad a tessere e le voci
 * sparse dei moduli erano un doppione. Ogni prodotto ha la sua sezione con le pagine
 * interne di DA-IPAM e la sua console; le pagine interne restano anche a prodotto
 * spento (da «Controller di rete» si aggiunge il primo controller), le console e le
 * sezioni dei moduli opzionali solo coi moduli accesi.
 *
 * Run: node --import tsx --test src/lib/modules/__tests__/voci-applicativi.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { vociApplicativi, type ModuloPerMenu } from "../voci-applicativi";

const m = (key: string, x: Partial<ModuloPerMenu> = {}): ModuloPerMenu => ({
  key, label: key, enabled: true, uiUrl: null, uiIsInternal: true, externalUiUrl: null, ...x,
});

test("tutto spento: nessuna voce (le pagine interne stanno in Sicurezza e in Network)", () => {
  assert.deepEqual(vociApplicativi([], false), []);
});

test("moduli accesi: sezioni dei moduli opzionali, poi tutte le console esterne", () => {
  const v = vociApplicativi([
    m("edge", { externalUiUrl: "https://edge:6443" }),
    m("wazuh", { uiUrl: "https://wazuh", uiIsInternal: false }),
    m("unifi", { externalUiUrl: "https://unifi" }),
    m("patch_management", { uiUrl: "/patch-management" }),
    m("meshcentral", { uiUrl: "/rmm", externalUiUrl: "https://mesh" }),
    m("librenms", { uiUrl: "https://lnms", uiIsInternal: false }),
    m("graylog", { uiUrl: "https://gl", uiIsInternal: false }),
    m("mdm", { uiUrl: "https://mdm", uiIsInternal: false }),
  ], true);
  assert.deepEqual(v.map((x) => x.href), [
    "/patch-management", "/patch-management/cve", "/patch-management/history",
    "/rmm", "https://mesh",
    "/zabbix",
    "https://edge:6443", "https://wazuh", "https://unifi", "https://lnms", "https://gl", "https://mdm",
  ]);
  assert.deepEqual(v.filter((x) => x.divider).map((x) => x.divider), ["Patch Management", "Controllo remoto", "Zabbix", "Console esterne"]);
  assert.ok(v.filter((x) => x.href.startsWith("https://")).every((x) => x.esterno));
});

test("un modulo spento non porta la sua console anche se l'indirizzo c'è", () => {
  const v = vociApplicativi([m("librenms", { enabled: false, uiUrl: "https://lnms", uiIsInternal: false }), m("edge", { enabled: false, externalUiUrl: "https://edge" })], false);
  assert.deepEqual(v, []);
});
