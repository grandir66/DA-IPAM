/**
 * UI-20 (piano di miglioramento, tappa 1, 12/10): le righe «Stato moduli» della
 * dashboard aprivano sempre la configurazione (configHref), anche per un
 * modulo attivo che ha la sua pagina; e un modulo mai installato diceva «Mai
 * eseguita», che si legge come «c'è ma non ha ancora girato».
 *
 * Le prove usano i descrittori veri del registry e stati con la forma che
 * resolveModules restituisce.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { MODULE_DESCRIPTORS, type ModuleKey, type ModuleState } from "@/lib/modules/registry";
import type { ModuleHealth } from "@/lib/modules/health";
import { moduleRowTarget } from "@/lib/modules/dashboard-rows";

function desc(key: ModuleKey) {
  const d = MODULE_DESCRIPTORS.find((m) => m.key === key);
  assert.ok(d, `descrittore ${key} mancante`);
  return d;
}

function stato(key: ModuleKey, over: Partial<ModuleState>): ModuleState {
  return {
    ...desc(key),
    installed: true,
    configured: true,
    enabled: true,
    uiUrl: null,
    uiIsInternal: true,
    ...over,
  };
}

function salute(key: ModuleKey, verdict: ModuleHealth["verdict"]): ModuleHealth {
  const probedAt = "2026-10-12T08:00:00.000Z";
  return {
    key,
    status: verdict === "ok" ? "ok" : verdict === "degraded" ? "warning" : "error",
    message: null,
    lastSync: null,
    probedAt,
    reachable: verdict !== "fail",
    authOk: verdict !== "fail",
    lastSyncAt: null,
    verdict,
    detail: null,
    repairAction: null,
  };
}

test("modulo nativo attivo e configurato: la riga apre la sua pagina", () => {
  const s = stato("edge", { uiUrl: "/vulnerabilities", uiIsInternal: true });
  const t = moduleRowTarget(desc("edge"), s, salute("edge", "ok"));
  assert.equal(t.href, "/vulnerabilities");
  assert.equal(t.apre, "modulo");
  assert.equal(t.notaStato, null);

  const p = stato("patch_management", { uiUrl: "/patch-management" });
  assert.equal(moduleRowTarget(desc("patch_management"), p, salute("patch_management", "ok")).href, "/patch-management");
});

test("modulo con interfaccia esterna attivo: la riga apre la pagina del modulo, non l'URL esterno (il Launchpad non c'è più, 19/10)", () => {
  const s = stato("librenms", {
    access: "external",
    uiUrl: "https://192.0.2.10:8090/",
    uiIsInternal: false,
  });
  const t = moduleRowTarget(desc("librenms"), s, salute("librenms", "ok"));
  assert.equal(t.href, "/settings/moduli/librenms");
  assert.equal(t.apre, "pagina_modulo");
});

test("modulo non installato: apre la configurazione e dice che non è attivo (non «Mai eseguita»)", () => {
  const s = stato("patch_management", {
    installed: false,
    configured: false,
    enabled: false,
    uiUrl: "/patch-management",
  });
  const t = moduleRowTarget(desc("patch_management"), s, undefined);
  assert.equal(t.href, "/settings?tab=moduli#module-patch_management");
  assert.ok(t.href.startsWith("/settings?tab=moduli"));
  assert.equal(t.apre, "configurazione");
  assert.equal(t.notaStato, "Modulo non attivo");
});

test("modulo installato ma non configurato: apre la configurazione", () => {
  const s = stato("meshcentral", { configured: false, enabled: false, uiUrl: "/rmm" });
  const t = moduleRowTarget(desc("meshcentral"), s, undefined);
  assert.ok(t.href.startsWith("/settings?tab=moduli"));
  assert.equal(t.apre, "configurazione");
  assert.equal(t.notaStato, "Modulo non attivo: da configurare");
});

test("modulo configurato ma spento (edge auto-disabilitato): apre la configurazione", () => {
  const s = stato("edge", { enabled: false, uiUrl: "/vulnerabilities" });
  const t = moduleRowTarget(desc("edge"), s, salute("edge", "fail"));
  assert.ok(t.href.startsWith("/settings?tab=moduli"));
  assert.equal(t.notaStato, "Modulo disattivato");
});

test("modulo esterno attivo ma in errore: apre la configurazione, dove si vede l'errore", () => {
  // Il Launchpad nasconde i moduli in errore (isModuleLaunchable): mandarci
  // l'utente sarebbe un link che porta a una pagina dove il modulo non c'è.
  const ext = stato("graylog", { access: "external", uiUrl: "https://192.0.2.11:9000/", uiIsInternal: false });
  const t = moduleRowTarget(desc("graylog"), ext, salute("graylog", "fail"));
  assert.ok(t.href.startsWith("/settings?tab=moduli"));
  assert.equal(t.apre, "configurazione");
  assert.equal(t.notaStato, null, "è attivo: la colonna resta l'ora della verifica");
});

test("modulo nativo attivo ma in errore: apre comunque la sua pagina in DA-IPAM", () => {
  // Revisione del 12/10: la regola «in errore → configurazione» vale per il
  // Launchpad, che nasconde i moduli in errore. Le pagine native lavorano sui
  // dati locali (findings importati, nodi in cache) anche con la sonda in
  // errore: Scanner-Edge con l'appliance spenta deve aprire /vulnerabilities.
  const edge = stato("edge", { uiUrl: "/vulnerabilities", uiIsInternal: true });
  const t = moduleRowTarget(desc("edge"), edge, salute("edge", "fail"));
  assert.equal(t.href, "/vulnerabilities");
  assert.equal(t.apre, "modulo");
  assert.equal(t.notaStato, null);

  const mesh = stato("meshcentral", { uiUrl: "/rmm", uiIsInternal: true });
  assert.equal(moduleRowTarget(desc("meshcentral"), mesh, salute("meshcentral", "fail")).href, "/rmm");
});

test("modulo non installato: la riga non conta fra quelli in errore", () => {
  // Revisione del 12/10: MeshCentral disinstallato lascia i parametri di
  // collegamento e la sonda continua a girare; un suo errore non deve
  // accendere «1 in errore» su un modulo che l'utente ha tolto.
  const s = stato("meshcentral", { installed: false, configured: false, enabled: false, uiUrl: "/rmm" });
  assert.equal(moduleRowTarget(desc("meshcentral"), s, salute("meshcentral", "fail")).contaNegliErrori, false);
});

test("modulo installato, anche spento o da configurare: la riga conta fra quelli in errore", () => {
  // Lo Scanner-Edge auto-disabilitato dopo 5 errori è un guasto vero: resta nel conteggio.
  const spento = stato("edge", { enabled: false, uiUrl: "/vulnerabilities" });
  assert.equal(moduleRowTarget(desc("edge"), spento, salute("edge", "fail")).contaNegliErrori, true);
  const daConfigurare = stato("meshcentral", { configured: false, enabled: false, uiUrl: "/rmm" });
  assert.equal(moduleRowTarget(desc("meshcentral"), daConfigurare, undefined).contaNegliErrori, true);
  const attivo = stato("edge", { uiUrl: "/vulnerabilities" });
  assert.equal(moduleRowTarget(desc("edge"), attivo, salute("edge", "ok")).contaNegliErrori, true);
  // Senza stato nel registry (Sistema appliance) la riga conta come prima.
  assert.equal(moduleRowTarget(desc("appliance"), undefined, salute("appliance", "fail")).contaNegliErrori, true);
});

test("modulo attivo senza una pagina da aprire: apre la configurazione", () => {
  // Graylog senza voce nel vault del Launchpad: uiUrl null.
  const s = stato("graylog", { access: "external", uiUrl: null, uiIsInternal: false });
  const t = moduleRowTarget(desc("graylog"), s, salute("graylog", "ok"));
  assert.ok(t.href.startsWith("/settings?tab=moduli"));
});

test("riga senza stato del registry (Sistema appliance): resta sulla configurazione", () => {
  const t = moduleRowTarget(desc("appliance"), undefined, salute("appliance", "ok"));
  assert.equal(t.href, "/settings?tab=moduli");
  assert.equal(t.apre, "configurazione");
  assert.equal(t.notaStato, null);
});

test("Patch Management acceso, «locale, non verificato»: apre la pagina e lo dice al posto dell'ora", () => {
  // Passo 4 (16/10): prima la sonda diceva «ok» dall'interruttore.
  const p = stato("patch_management", { uiUrl: "/patch-management" });
  const t = moduleRowTarget(desc("patch_management"), p, salute("patch_management", "unverified"));
  assert.equal(t.href, "/patch-management");
  assert.equal(t.apre, "modulo");
  assert.equal(t.notaStato, "Locale, non verificato");
});

// Revisione del 19/10: l'MDM non ha una pagina in /settings/moduli; la riga portava a
// «Modulo sconosciuto». Va alla sua pagina di configurazione.
test("MDM attivo con console esterna: la riga va a /settings/mdm, non a una pagina che non c'è", () => {
  const s = stato("mdm", { access: "external", uiUrl: "https://mdm.esempio.it", uiIsInternal: false, configHref: "/settings/mdm" });
  const t = moduleRowTarget(desc("mdm"), s, salute("mdm", "ok"));
  assert.equal(t.href, "/settings/mdm");
});
