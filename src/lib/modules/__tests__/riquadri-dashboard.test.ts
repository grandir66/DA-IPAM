/**
 * Riquadri «Stato moduli» della dashboard (Riccardo, 20/10): un riquadro piccolo per
 * applicativo, nome, ultimo aggiornamento, stato dal colore (con simbolo e luminanza:
 * Riccardo è daltonico). Tutti i moduli possibili, quelli non configurati in grigio.
 *
 * Run: node --import tsx --test src/lib/modules/__tests__/riquadri-dashboard.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { completaRiquadri, statoRiquadro, tempoFa } from "../riquadri-dashboard";

const riga = (key: string, x: Record<string, unknown> = {}) => ({ key, label: key, status: "ok" as const, lastSync: null, message: null, href: "/", ...x });

test("stato: non installato o non configurato → grigio; poi ok, attenzione, guasto, da verificare", () => {
  assert.equal(statoRiquadro(riga("a", { contaNegliErrori: false })), "non_configurato");
  assert.equal(statoRiquadro(riga("a")), "ok");
  assert.equal(statoRiquadro(riga("a", { status: "warning" })), "attenzione");
  assert.equal(statoRiquadro(riga("a", { status: "stale" })), "attenzione");
  assert.equal(statoRiquadro(riga("a", { status: "error" })), "guasto");
  assert.equal(statoRiquadro(riga("a", { status: "never" })), "da_verificare");
  // Patch: locale, nessuna sonda → da verificare, non verde.
  assert.equal(statoRiquadro(riga("patch_management", { status: "never", notaStato: "Locale, non verificato" })), "da_verificare");
});

test("tutti i moduli possibili: quelli senza riga arrivano in grigio, AD e Zabbix compresi", () => {
  const r = completaRiquadri(
    [riga("edge"), riga("ad_1", { label: "Active Directory: domarc.it" })],
    [{ key: "edge", label: "Scanner-Edge", configHref: "/x" }, { key: "nis2_inventory", label: "Inventario NIS2", configHref: "/settings/moduli/nis2_inventory" }],
    { zabbix: null },
  );
  assert.deepEqual(r.map((x) => x.key), ["edge", "nis2_inventory", "zabbix", "ad_1"]);
  assert.equal(statoRiquadro(r[1]), "non_configurato");
  assert.equal(statoRiquadro(r[2]), "non_configurato");
  // Nessuna integrazione AD: compare comunque, in grigio.
  const senzaAd = completaRiquadri([riga("edge")], [{ key: "edge", label: "Scanner-Edge", configHref: "/x" }], { zabbix: { enabled: true, fallimenti: 0, ultimoErrore: null, ultimaLetturaOk: "2026-10-20 09:00:00" } });
  assert.ok(senzaAd.some((x) => x.key === "ad" && x.contaNegliErrori === false));
  assert.equal(statoRiquadro(senzaAd.find((x) => x.key === "zabbix")!), "ok");
});

test("tempo in forma breve", () => {
  const ora = new Date("2026-10-20T10:00:00Z");
  assert.equal(tempoFa("2026-10-20 09:57:00", ora), "3 min fa");
  assert.equal(tempoFa("2026-10-20 07:00:00", ora), "3 h fa");
  assert.equal(tempoFa("2026-10-18 10:00:00", ora), "2 g fa");
  assert.equal(tempoFa("2026-10-20 09:59:40", ora), "adesso");
  assert.equal(tempoFa(null, ora), null);
});

test("un modulo acceso senza sonda di salute è «da verificare», non grigio", () => {
  const r = completaRiquadri([], [{ key: "nis2_inventory", label: "Inventario NIS2", configHref: "/x", enabled: true }], { zabbix: null });
  assert.equal(statoRiquadro(r[0]), "da_verificare");
});

// Revisione del 20/10: installato ma spento era bianco «?», in Impostazioni grigio «Spento».
test("modulo installato ma spento (sonda «never», abilitato false) → grigio", () => {
  assert.equal(statoRiquadro(riga("librenms", { status: "never", abilitato: false })), "non_configurato");
  assert.equal(statoRiquadro(riga("librenms", { status: "error", abilitato: false })), "guasto");
});

// Revisione del 20/10: Zabbix era verde solo perché acceso, anche con le letture che fallivano.
test("Zabbix: lo stato viene dalle letture", () => {
  const z = (x: Record<string, unknown>) => completaRiquadri([], [], { zabbix: { enabled: true, fallimenti: 0, ultimoErrore: null, ultimaLetturaOk: null, ...x } }).find((r) => r.key === "zabbix")!;
  assert.equal(statoRiquadro(z({ ultimaLetturaOk: "2026-10-20 09:00:00" })), "ok");
  assert.equal(statoRiquadro(z({ fallimenti: 1, ultimoErrore: "401" })), "attenzione");
  assert.equal(statoRiquadro(z({ fallimenti: 3, ultimoErrore: "401" })), "guasto");
  assert.equal(statoRiquadro(z({})), "da_verificare");
  assert.equal(statoRiquadro(completaRiquadri([], [], { zabbix: { enabled: false, fallimenti: 0, ultimoErrore: null, ultimaLetturaOk: null } }).find((r) => r.key === "zabbix")!), "non_configurato");
});
