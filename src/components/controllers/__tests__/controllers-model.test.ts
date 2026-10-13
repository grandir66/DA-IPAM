/**
 * Pagina «Controller di rete»: la parte pura (etichette, modulo, corpo del
 * salvataggio, esiti, lettura difensiva delle risposte) con dati nella forma
 * vera delle rotte.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildControllerPayload,
  buildTogglePayload,
  clientRunLine,
  clientScheduleLabel,
  controllerStatus,
  countOrDash,
  describeProbe,
  describeSync,
  emptyControllerForm,
  formatDuration,
  formatRome,
  formFromController,
  formMissing,
  kindLabel,
  parseControllerDetail,
  parseControllerList,
  parseProbeResult,
  parseSyncResponse,
  probeOneLine,
  runOrigin,
  scheduleFromValue,
  scheduleLabel,
  secretPlaceholder,
  SCHEDULE_OPTIONS,
} from "../controllers-model";
import type { NetworkControllerView } from "@/lib/controllers/types";

const PIN_A = `sha256/${Buffer.alloc(32, 1).toString("base64")}`;
const PIN_B = `sha256/${Buffer.alloc(32, 2).toString("base64")}`;

function ctrl(over: Partial<NetworkControllerView> = {}): NetworkControllerView {
  return {
    id: 3,
    name: "DTS",
    vendor: "unifi",
    kind: "self_hosted",
    url: "https://10.0.0.5:8443",
    site: "default",
    username: "ro",
    passwordSet: true,
    apiKeySet: false,
    certPin: PIN_A,
    enabled: true,
    lastRunAt: "2026-10-13 16:40:00",
    lastOk: true,
    lastMessage: null,
    lastDevices: 12,
    lastPorts: 240,
    lastNeighbors: 31,
    origin: "manual",
    scheduleMinutes: 240,
    clientSchedule: false,
    lastClientRun: null,
    ...over,
  };
}

describe("etichette", () => {
  it("tipo", () => {
    assert.equal(kindLabel("udm"), "UniFi OS");
    assert.equal(kindLabel("self_hosted"), "UniFi (self-hosted)");
    assert.equal(kindLabel("omada"), "Omada");
  });

  it("stato: tre valori distinti anche senza colore", () => {
    assert.equal(controllerStatus(ctrl()).label, "● Attivo");
    assert.equal(controllerStatus(ctrl({ lastOk: null, lastRunAt: null })).key, "active");
    assert.equal(controllerStatus(ctrl({ enabled: false })).label, "○ Spento");
    const e = controllerStatus(ctrl({ lastOk: false, lastMessage: "401" }));
    assert.equal(e.label, "▲ Errore");
    assert.equal(e.tooltip, "401");
    // spento vince sull'errore: un controller spento non sta sbagliando niente
    assert.equal(controllerStatus(ctrl({ enabled: false, lastOk: false })).key, "off");
  });

  it("pianificazione", () => {
    assert.equal(scheduleLabel(null), "spenta");
    assert.equal(scheduleLabel(60), "ogni ora");
    assert.equal(scheduleLabel(120), "ogni 2 ore");
    assert.equal(scheduleLabel(1440), "ogni giorno (03:00)");
    assert.deepEqual(
      SCHEDULE_OPTIONS.map((o) => o.value),
      ["", "60", "120", "240", "360", "720", "1440"],
    );
    assert.equal(scheduleFromValue(""), null);
    assert.equal(scheduleFromValue("360"), 360);
    assert.equal(scheduleFromValue("7"), null);
  });

  it("ora italiana dal formato SQLite (UTC senza fuso)", () => {
    // 16:40 UTC il 13 ottobre = 18:40 a Roma (ora legale)
    assert.equal(formatRome("2026-10-13 16:40:00"), "13/10 18:40");
    // inverno: +1
    assert.equal(formatRome("2026-01-05 08:00:00"), "05/01 09:00");
    assert.equal(formatRome(null), "mai");
    assert.equal(formatRome("non è una data"), "mai");
  });

  it("numeri e durata", () => {
    assert.equal(countOrDash(null), "–");
    assert.equal(countOrDash(0), "0");
    assert.equal(formatDuration("2026-10-13 16:40:00", "2026-10-13 16:40:03"), "3 s");
    assert.equal(formatDuration("2026-10-13 16:40:00", "2026-10-13 16:41:05"), "1 min 5 s");
    assert.equal(formatDuration("x", "y"), "–");
  });

  it("origine della lettura", () => {
    assert.equal(runOrigin({ trigger: "schedule", triggeredBy: null }), "pianificata");
    assert.equal(runOrigin({ trigger: "manual", triggeredBy: "riccardo" }), "a mano · riccardo");
    assert.equal(runOrigin({ trigger: "manual", triggeredBy: null }), "a mano");
  });
});

describe("modulo e corpo del salvataggio", () => {
  it("modulo nuovo: udm, attivo, pianificazione spenta, site default", () => {
    const f = emptyControllerForm();
    assert.equal(f.kind, "udm");
    assert.equal(f.enabled, true);
    assert.equal(f.schedule, "");
    assert.equal(f.site, "default");
  });

  it("in modifica i segreti restano vuoti", () => {
    const f = formFromController(ctrl());
    assert.equal(f.password, "");
    assert.equal(f.apiKey, "");
    assert.equal(f.schedule, "240");
    assert.equal(f.username, "ro");
  });

  it("udm manda la chiave e non l'utente; self-hosted il contrario", () => {
    const udm = buildControllerPayload(
      { ...emptyControllerForm(), name: " UDM ", url: " https://1.1.1.1 ", apiKey: " k ", username: "x", password: "y" },
      PIN_A,
    );
    assert.equal(udm.name, "UDM");
    assert.equal(udm.url, "https://1.1.1.1");
    assert.equal(udm.apiKey, "k");
    assert.equal(udm.username, "");
    assert.equal(udm.password, "");
    assert.equal(udm.certPin, PIN_A);
    const sh = buildControllerPayload({
      ...emptyControllerForm(),
      kind: "self_hosted",
      name: "A",
      url: "https://h:8443",
      username: " ro ",
      password: "pw",
      apiKey: "k",
      site: " ",
      schedule: "1440",
    });
    assert.equal(sh.username, "ro");
    assert.equal(sh.password, "pw");
    assert.equal(sh.apiKey, "");
    assert.equal(sh.site, "default");
    assert.equal(sh.scheduleMinutes, 1440);
    assert.equal("certPin" in sh, false);
  });

  it("attiva/disattiva non tocca i segreti né la pianificazione", () => {
    const p = buildTogglePayload(ctrl());
    assert.equal(p.enabled, false);
    assert.equal(p.password, "");
    assert.equal(p.apiKey, "");
    assert.equal(p.scheduleMinutes, 240);
    assert.equal("certPin" in p, false);
  });

  it("campi obbligatori e segnaposto", () => {
    assert.equal(formMissing(emptyControllerForm()), "Scrivi un nome");
    assert.equal(formMissing({ ...emptyControllerForm(), name: "a" }), "Scrivi l'indirizzo del controller");
    assert.equal(formMissing({ ...emptyControllerForm(), name: "a", url: "https://x" }), null);
    assert.match(secretPlaceholder(true), /lascia vuoto/);
    assert.equal(secretPlaceholder(false), "");
  });
});

describe("esito della prova", () => {
  it("ok: numero di apparati, site e impronta", () => {
    const r = parseProbeResult({
      ok: true,
      devices: 12,
      certPin: PIN_A,
      certPinRecorded: false,
      sites: [{ name: "abc", desc: "Sede" }, { nome: "rotto" }],
    });
    assert.ok(r);
    assert.deepEqual(r.sites, [{ name: "abc", desc: "Sede" }]);
    assert.equal(r.certPin, PIN_A);
    assert.equal(describeProbe(r).title, "12 apparati letti");
    assert.equal(probeOneLine(r), "12 apparati letti");
  });

  it("certificato cambiato: le due impronte", () => {
    const r = parseProbeResult({
      ok: false,
      reason: "cert",
      message: "impronta diversa",
      presentedPin: PIN_B,
      expectedPin: PIN_A,
    });
    assert.ok(r);
    const v = describeProbe(r);
    assert.equal(v.tone, "error");
    assert.deepEqual(v.pins, { expected: PIN_A, presented: PIN_B });
    assert.match(probeOneLine(r), /Certificato del controller cambiato: impronta diversa/);
  });

  it("errore senza impronte e motivo sconosciuto", () => {
    const r = parseProbeResult({ ok: false, reason: "boh", message: "x" });
    assert.ok(r);
    assert.equal(r.reason, "unknown");
    assert.equal(describeProbe(r).pins, null);
  });

  it("risposta che non è una prova", () => {
    assert.equal(parseProbeResult(null), null);
    assert.equal(parseProbeResult({ error: "Non autorizzato" }), null);
  });
});

describe("esito della sincronizzazione", () => {
  it("completata con i numeri", () => {
    const s = parseSyncResponse({
      ok: true,
      failure: null,
      total: 5,
      added: 2,
      updated: 3,
      skipped: 0,
      portsUpserted: 80,
      neighborsUpserted: 9,
      errors: [],
      skippedReasons: [],
      offline: [],
    });
    assert.ok(s);
    const v = describeSync(s);
    assert.equal(v.tone, "ok");
    assert.equal(v.text, "Sincronizzazione completata: 2 nuovi, 3 aggiornati, 80 porte, 9 vicini, 0 errori");
  });

  it("con errori è un avviso, fallita è un errore", () => {
    const w = parseSyncResponse({ ok: true, errors: ["sw1: timeout"] });
    assert.ok(w);
    assert.equal(describeSync(w).tone, "warning");
    const f = parseSyncResponse({ ok: false, failure: "Accesso rifiutato" });
    assert.ok(f);
    assert.equal(describeSync(f).tone, "error");
    assert.match(describeSync(f).text, /niente è stato scritto: Accesso rifiutato/);
  });

  it("campi mancanti o di tipo sbagliato non rompono", () => {
    const s = parseSyncResponse({ ok: true, added: "3", errors: "x", offline: [1, "sw2"] });
    assert.ok(s);
    assert.equal(s.added, 0);
    assert.deepEqual(s.errors, []);
    assert.deepEqual(s.offline, ["sw2"]);
    assert.equal(parseSyncResponse({ error: "no" }), null);
  });
});

describe("lettura delle risposte", () => {
  it("elenco: scarta le righe che non sono controller", () => {
    const l = parseControllerList({ controllers: [ctrl(), { id: 1 }, null, ctrl({ id: 4, kind: "udm" })] });
    assert.deepEqual(l?.map((c) => c.id), [3, 4]);
    assert.equal(parseControllerList({ error: "x" }), null);
    assert.equal(parseControllerList(null), null);
  });

  it("dettaglio: letture con liste difensive", () => {
    const d = parseControllerDetail({
      controller: ctrl(),
      runs: [{ id: 9, startedAt: "2026-10-13 16:40:00", finishedAt: "2026-10-13 16:40:02", ok: true }, { x: 1 }],
    });
    assert.ok(d);
    assert.equal(d.runs.length, 1);
    assert.deepEqual(d.runs[0].errors, []);
    assert.equal(parseControllerDetail({ runs: [] }), null);
  });
});

describe("lettura dei client (ogni ora 7-20)", () => {
  it("lo stato si dice a parole, non solo con la casella", () => {
    assert.equal(clientScheduleLabel(ctrl()), "Client: non letti");
    assert.equal(clientScheduleLabel(ctrl({ clientSchedule: true })), "Client: letti ogni ora dalle 7 alle 20");
    // Una risposta senza il campo (server più vecchio) non accende niente.
    assert.equal(clientScheduleLabel({ ...ctrl(), clientSchedule: undefined as unknown as boolean }), "Client: non letti");
  });

  it("riga dell'ultima lettura dei client, in ora italiana, con l'esito in parole", () => {
    assert.equal(clientRunLine(ctrl()), "Ultima lettura dei client: mai");
    assert.equal(
      clientRunLine(ctrl({ lastClientRun: { at: "2026-10-13 16:00:04", ok: true, message: "Lettura client: 40 letti, 38 salvati, 2 non abbinati" } })),
      "Ultima lettura dei client: 13/10 18:00 · ok · 40 letti, 38 salvati, 2 non abbinati",
    );
    assert.equal(
      clientRunLine(ctrl({ lastClientRun: { at: "2026-12-01 07:00:00", ok: false, message: "Lettura client: Controller non raggiungibile" } })),
      "Ultima lettura dei client: 01/12 08:00 · ▲ non riuscita · Controller non raggiungibile",
    );
    assert.equal(
      clientRunLine({ ...ctrl(), lastClientRun: "rotto" as unknown as NetworkControllerView["lastClientRun"] }),
      "Ultima lettura dei client: mai",
    );
  });
});
