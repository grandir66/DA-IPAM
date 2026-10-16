// Controller di rete (ADR 0007): client UniFi OS con chiave API, gestione
// delle righe (segreti, certificato, pianificazione), storico con potatura,
// passaggio della configurazione unica dell'hub, giro di lettura registrato.
// Niente rete: il controller è un trasporto finto che risponde con la
// risposta vera di stat/device (fixture anonimizzata del cliente A).
//
// Hub DB isolato: `support/hub-isolato` va importato PER PRIMO (il perché sta
// lì). I tenant stanno in DA_INVENT_DATA_DIR: lanciare con una cartella di prova.
import { removeTestHubDb } from "@/lib/integrations/__tests__/support/hub-isolato";
import path from "node:path";
import fs from "node:fs";
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { closeHubDb, getHubDb, setSetting } from "@/lib/db-hub";
import {
  CONTROLLER_RUNS_KEPT,
  deleteTenantDatabase,
  getTenantDb,
  getTenantSetting,
  listControllerScheduleJobs,
  recordControllerRun,
  setControllerClientSchedule,
  setControllerSchedule,
  withTenant,
  type ControllerRunInsert,
} from "@/lib/db-tenant";
import { encrypt } from "@/lib/crypto";
import {
  checkPresentedPin,
  createUnifiClient,
  isUnifiRequestAllowed,
  type UnifiHttpRequest,
  type UnifiTransportFactory,
} from "@/lib/integrations/unifi-api";
import type { UnifiCertPinStore } from "@/lib/integrations/types";
import {
  acceptControllerCertPin,
  checkControllerInput,
  createController,
  getControllerView,
  listControllerRunViews,
  listControllerViews,
  migrateLegacyUnifiConfig,
  parseControllerPatch,
  probeControllerInput,
  probeSavedController,
  removeController,
  setClientScheduleFor,
  syncController,
  unifiOsWarningFor,
  updateController,
} from "../service";
import type { ControllerInput } from "../types";

const T = "TESTCONTROLLERS";
const STAT_BODY = fs.readFileSync(
  path.join(__dirname, "..", "..", "integrations", "__tests__", "fixtures", "unifi-stat-device.json"),
  "utf-8",
);
const SITES_BODY = JSON.stringify({
  meta: { rc: "ok" },
  data: [
    { name: "default", desc: "Sede" },
    { name: "x7k2p9", desc: "Magazzino" },
  ],
});
const PIN_A = `sha256/${Buffer.alloc(32, 1).toString("base64")}`;
const PIN_B = `sha256/${Buffer.alloc(32, 2).toString("base64")}`;
const CHIAVE = "chiave-api-di-prova-0123456789ab";

const LEGACY_KEYS = ["mode", "url", "kind", "site", "username", "password", "api_token", "cert_pin"].map(
  (k) => `integration_unifi_${k}`,
);

beforeEach(() => {
  deleteTenantDatabase(T);
  for (const k of LEGACY_KEYS) setSetting(k, "");
  getHubDb().prepare("DELETE FROM tenants WHERE codice_cliente LIKE 'TESTCTRL%'").run();
});

after(() => {
  deleteTenantDatabase(T);
  closeHubDb();
  removeTestHubDb();
});

/** Console UniFi OS finta: accetta solo la chiave giusta, presenta l'impronta `pin`. */
function consoleFinta(pin = PIN_A, chiave = CHIAVE): { factory: UnifiTransportFactory; calls: UnifiHttpRequest[] } {
  const calls: UnifiHttpRequest[] = [];
  const factory: UnifiTransportFactory = (_base, pins) => async (req) => {
    // Come il trasporto vero: l'impronta si controlla prima che la richiesta parta.
    checkPresentedPin(pins, pin);
    calls.push(req);
    if (req.headers["X-API-KEY"] !== chiave) {
      return { status: 401, headers: {}, body: JSON.stringify({ error: { code: 401, message: "Unauthorized" } }) };
    }
    if (req.path === "/proxy/network/api/self/sites") return { status: 200, headers: {}, body: SITES_BODY };
    if (req.path === "/proxy/network/api/s/default/stat/device") return { status: 200, headers: {}, body: STAT_BODY };
    return { status: 404, headers: {}, body: "{}" };
  };
  return { factory, calls };
}

function memoriaPin(iniziale: string | null = null): UnifiCertPinStore & { valore: () => string | null } {
  let pin = iniziale;
  return {
    get: () => pin,
    set: (p) => {
      pin = p;
    },
    clear: () => {
      pin = null;
    },
    valore: () => pin,
  };
}

function input(campi: Partial<ControllerInput> = {}): ControllerInput {
  return {
    name: "DA-UDM-Beast",
    kind: "udm",
    url: "https://192.168.15.252",
    site: "default",
    username: "",
    password: "",
    apiKey: CHIAVE,
    enabled: true,
    scheduleMinutes: null,
    certPin: null,
    ...campi,
  };
}

function inTenant<R>(fn: () => R): R {
  return withTenant(T, fn);
}

function conta(tabella: string, where = "1=1", ...args: unknown[]): number {
  return (getTenantDb(T).prepare(`SELECT COUNT(*) AS n FROM ${tabella} WHERE ${where}`).get(...args) as { n: number }).n;
}

// ── Client UniFi OS ──────────────────────────────────────────────────────────

test("sola lettura: col prefisso UniFi OS passano solo stat/device, stat/sta e self/sites, nient'altro", () => {
  assert.equal(isUnifiRequestAllowed("GET", "/proxy/network/api/s/default/stat/device"), true);
  assert.equal(isUnifiRequestAllowed("GET", "/proxy/network/api/self/sites"), true);
  assert.equal(isUnifiRequestAllowed("GET", "/api/self/sites"), true);
  assert.equal(isUnifiRequestAllowed("GET", "/proxy/network/api/s/default/stat/sta"), true);
  assert.equal(isUnifiRequestAllowed("GET", "/proxy/network/api/s/default/cmd/stamgr"), false);
  assert.equal(isUnifiRequestAllowed("POST", "/proxy/network/api/s/default/cmd/devmgr"), false);
  assert.equal(isUnifiRequestAllowed("GET", "/proxy/network/integration/v1/sites"), false);
  assert.equal(isUnifiRequestAllowed("GET", "/proxy/network/api/s/../stat/device"), false);
});

test("console UniFi OS: legge con la chiave nell'intestazione, senza login, e dà anche i site", async () => {
  const { factory, calls } = consoleFinta();
  const pins = memoriaPin();
  const r = await createUnifiClient(
    { url: "https://192.168.15.252", kind: "udm", site: "default", apiToken: CHIAVE },
    pins,
    { transportFactory: factory },
  ).probe();
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.devices, 4);
    assert.deepEqual(r.sites, [
      { name: "default", desc: "Sede" },
      { name: "x7k2p9", desc: "Magazzino" },
    ]);
    assert.equal(r.certPinRecorded, true);
  }
  assert.deepEqual(
    calls.map((c) => `${c.method} ${c.path}`),
    ["GET /proxy/network/api/s/default/stat/device", "GET /proxy/network/api/self/sites"],
  );
  assert.equal(pins.valore(), PIN_A);
  assert.doesNotMatch(JSON.stringify(r), new RegExp(CHIAVE));
});

test("console UniFi OS: chiave rifiutata → errore «auth» che dice dove si crea la chiave", async () => {
  const r = await createUnifiClient(
    { url: "https://192.168.15.252", kind: "udm", site: "default", apiToken: "chiave-sbagliata" },
    memoriaPin(),
    { transportFactory: consoleFinta().factory },
  ).probe();
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.reason, "auth");
    assert.match(r.message, /Chiave API rifiutata.*Control Plane, poi Integrazioni/);
  }
});

test("console UniFi OS: certificato diverso da quello fissato → nessuna richiesta parte, la chiave non esce", async () => {
  const { factory, calls } = consoleFinta(PIN_B);
  const r = await createUnifiClient(
    { url: "https://192.168.15.252", kind: "udm", site: "default", apiToken: CHIAVE },
    memoriaPin(PIN_A),
    { transportFactory: factory },
  ).probe();
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.reason, "cert");
    assert.equal(r.presentedPin, PIN_B);
    assert.equal(r.expectedPin, PIN_A);
  }
  assert.equal(calls.length, 0);
});

test("console UniFi OS senza chiave: errore di configurazione, nessuna richiesta", async () => {
  const { factory, calls } = consoleFinta();
  const r = await createUnifiClient({ url: "https://192.168.15.252", kind: "udm" }, memoriaPin(), {
    transportFactory: factory,
  }).probe();
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.message, /Chiave API .* non configurata/);
  assert.equal(calls.length, 0);
});

// ── Modulo: validazione ──────────────────────────────────────────────────────

test("modulo: Omada si vede ma non si salva; http e site strani rifiutati; udm vuole la chiave", () => {
  const omada = checkControllerInput({ ...input(), kind: "omada" });
  assert.equal(omada.ok, false);
  if (!omada.ok) assert.match(omada.error, /Omada non è ancora disponibile/);
  const http = checkControllerInput({ ...input(), url: "http://192.168.15.252" });
  assert.equal(http.ok, false);
  const site = checkControllerInput({ ...input(), site: "../x" });
  assert.equal(site.ok, false);
  const senzaChiave = checkControllerInput({ ...input(), apiKey: "" });
  assert.equal(senzaChiave.ok, false);
  const orario = checkControllerInput({ ...input(), scheduleMinutes: 17 });
  assert.equal(orario.ok, false);
  const buono = checkControllerInput({ ...input(), url: "https://192.168.15.252/" });
  assert.equal(buono.ok, true);
  if (buono.ok) assert.equal(buono.value.url, "https://192.168.15.252");
});

// ── Righe: segreti, certificato, pianificazione ──────────────────────────────

test("la vista non porta mai i segreti, solo se ci sono; il DB li tiene cifrati", () => {
  const v = inTenant(() => createController(input()));
  assert.equal(v.apiKeySet, true);
  assert.equal(v.passwordSet, false);
  assert.doesNotMatch(JSON.stringify(inTenant(() => listControllerViews())), new RegExp(CHIAVE));
  const raw = getTenantDb(T).prepare("SELECT api_key_enc FROM network_controllers WHERE id = ?").get(v.id) as {
    api_key_enc: string;
  };
  assert.notEqual(raw.api_key_enc, CHIAVE);
  assert.match(raw.api_key_enc, /^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/i);
});

test("modifica allo stesso indirizzo: chiave vuota = non cambiare; indirizzo nuovo = impronta e chiave azzerate", () => {
  const v = inTenant(() => createController(input({ certPin: PIN_A })));
  assert.equal(v.certPin, PIN_A);
  const stesso = inTenant(() => updateController(v.id, input({ name: "UDM sede", apiKey: "" })));
  assert.equal(stesso?.name, "UDM sede");
  assert.equal(stesso?.apiKeySet, true);
  assert.equal(stesso?.certPin, PIN_A);
  // L'impronta della prova non sostituisce quella fissata.
  const tentativo = inTenant(() => updateController(v.id, input({ apiKey: "", certPin: PIN_B })));
  assert.equal(tentativo?.certPin, PIN_A);
  const altrove = inTenant(() => updateController(v.id, input({ url: "https://10.0.0.1", apiKey: "" })));
  assert.equal(altrove?.certPin, null);
  assert.equal(altrove?.apiKeySet, false, "la chiave vecchia non parte verso un host mai verificato");
});

test("modulo in modifica allo stesso indirizzo: la chiave salvata basta; a un altro indirizzo no", () => {
  const v = inTenant(() => createController(input()));
  const row = getTenantDb(T).prepare("SELECT * FROM network_controllers WHERE id = ?").get(v.id) as never;
  assert.equal(checkControllerInput({ ...input(), apiKey: "" }, row).ok, true);
  assert.equal(checkControllerInput({ ...input(), apiKey: "", url: "https://10.0.0.1" }, row).ok, false);
});

// ── UniFi OS con utente locale e password (ADR 0019) ────────────────────────

const PW_LOCALE = "pw-locale-di-prova-rgadmin";

/** Console UniFi OS finta che accetta solo rgadmin/PW_LOCALE e poi il cookie TOKEN. */
function consoleConUtente(pin = PIN_A): { factory: UnifiTransportFactory; calls: UnifiHttpRequest[] } {
  const calls: UnifiHttpRequest[] = [];
  const factory: UnifiTransportFactory = (_base, pins) => async (req) => {
    checkPresentedPin(pins, pin);
    calls.push(req);
    if (req.path === "/api/auth/login") {
      const b = JSON.parse(req.body ?? "{}") as { username?: string; password?: string };
      if (b.username === "rgadmin" && b.password === PW_LOCALE) {
        return { status: 200, headers: { "set-cookie": ["TOKEN=T1; path=/; httponly"], "x-csrf-token": "C1" }, body: "{}" };
      }
      return { status: 401, headers: {}, body: "{}" };
    }
    if (req.headers.Cookie !== "TOKEN=T1") return { status: 401, headers: {}, body: "{}" };
    if (req.path === "/api/auth/logout") return { status: 200, headers: {}, body: "{}" };
    if (req.path === "/proxy/network/api/self/sites") return { status: 200, headers: {}, body: SITES_BODY };
    if (req.path === "/proxy/network/api/s/default/stat/device") return { status: 200, headers: {}, body: STAT_BODY };
    return { status: 404, headers: {}, body: "{}" };
  };
  return { factory, calls };
}

const rigaDb = (id: number) => getTenantDb(T).prepare("SELECT * FROM network_controllers WHERE id = ?").get(id) as never;

test("UDM con utente locale: senza chiave né utente o senza password si rifiuta; salvato tiene utente e password, niente chiave", () => {
  const nessuno = checkControllerInput({ ...input(), apiKey: "" });
  assert.equal(nessuno.ok, false);
  if (!nessuno.ok) assert.match(nessuno.error, /chiave API.*utente locale/);
  const senzaPw = checkControllerInput({ ...input(), apiKey: "", username: "rgadmin" });
  assert.equal(senzaPw.ok, false);
  if (!senzaPw.ok) assert.match(senzaPw.error, /password/);
  const buono = checkControllerInput({ ...input(), apiKey: "", username: "rgadmin", password: PW_LOCALE });
  assert.equal(buono.ok, true);
  if (!buono.ok) return;
  const v = inTenant(() => createController(buono.value));
  assert.equal(v.kind, "udm");
  assert.equal(v.username, "rgadmin");
  assert.equal(v.passwordSet, true);
  assert.equal(v.apiKeySet, false);
  const raw = getTenantDb(T).prepare("SELECT password_enc FROM network_controllers WHERE id = ?").get(v.id) as {
    password_enc: string;
  };
  assert.notEqual(raw.password_enc, PW_LOCALE);
  assert.doesNotMatch(JSON.stringify(inTenant(() => listControllerViews())), new RegExp(PW_LOCALE));
});

test("pilota: il controller salvato self_hosted con utente e password, passato a UDM dalla pagina, entra col login senza ridare la password", async () => {
  const sh = inTenant(() =>
    createController(input({ kind: "self_hosted", apiKey: "", username: "rgadmin", password: PW_LOCALE })),
  );
  const check = checkControllerInput({ ...input(), apiKey: "", username: "rgadmin", password: "" }, rigaDb(sh.id));
  assert.equal(check.ok, true, check.ok ? "" : check.error);
  if (!check.ok) return;
  const prova = consoleConUtente();
  const r = await inTenant(() => probeControllerInput(check.value, sh.id, { transportFactory: prova.factory }));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(prova.calls[0].path, "/api/auth/login");
  const v = inTenant(() => updateController(sh.id, check.value));
  assert.equal(v?.kind, "udm");
  assert.equal(v?.username, "rgadmin");
  assert.equal(v?.passwordSet, true);
  assert.equal(v?.apiKeySet, false);
  const giro = consoleConUtente();
  const r2 = await inTenant(() => probeSavedController(sh.id, { transportFactory: giro.factory }));
  assert.equal(r2.ok, true, JSON.stringify(r2));
  assert.deepEqual(
    giro.calls.map((c) => c.path),
    ["/api/auth/login", "/proxy/network/api/s/default/stat/device", "/proxy/network/api/self/sites", "/api/auth/logout"],
  );
});

test("salvataggio di un self_hosted su una console UniFi OS: avviso «scegli UDM»; per UDM nessuna domanda", async () => {
  const calls: UnifiHttpRequest[] = [];
  const factory: UnifiTransportFactory = () => async (req) => {
    calls.push(req);
    return { status: 200, headers: {}, body: "<html><head><title>UniFi OS</title></head></html>" };
  };
  const sh = input({ kind: "self_hosted", apiKey: "", username: "rgadmin", password: PW_LOCALE });
  assert.match((await unifiOsWarningFor(sh, { transportFactory: factory })) ?? "", /Questo indirizzo è una console UniFi OS: scegli UDM/);
  assert.deepEqual(calls.map((c) => `${c.method} ${c.path}`), ["GET /"]);
  assert.equal(JSON.stringify(calls).includes(PW_LOCALE), false, "la domanda parte senza credenziali");
  assert.equal(await unifiOsWarningFor(input(), { transportFactory: factory }), null);
  assert.equal(calls.length, 1);
});

test("UDM: da chiave a utente si toglie la chiave (e la prova non la usa); da utente a chiave si tolgono utente e password", async () => {
  const v = inTenant(() => createController(input()));
  assert.equal(v.apiKeySet, true);
  const aUtente = checkControllerInput({ ...input(), apiKey: "", username: "rgadmin", password: PW_LOCALE }, rigaDb(v.id));
  assert.equal(aUtente.ok, true);
  if (!aUtente.ok) return;
  const prova = consoleConUtente();
  const r = await inTenant(() => probeControllerInput(aUtente.value, v.id, { transportFactory: prova.factory }));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(prova.calls[0].headers["X-API-KEY"], undefined, "la chiave salvata non parte se si è scelto l'utente");
  const u = inTenant(() => updateController(v.id, aUtente.value));
  assert.equal(u?.apiKeySet, false);
  assert.equal(u?.passwordSet, true);
  assert.equal(u?.username, "rgadmin");
  const aChiave = checkControllerInput({ ...input(), apiKey: CHIAVE }, rigaDb(v.id));
  assert.equal(aChiave.ok, true);
  if (!aChiave.ok) return;
  const k = inTenant(() => updateController(v.id, aChiave.value));
  assert.equal(k?.apiKeySet, true);
  assert.equal(k?.passwordSet, false);
  assert.equal(k?.username, "");
});

// Revisione del 16/10: su un UDM salvato con la chiave, il modulo su «Utente
// locale e password» con la password scritta e l'utente vuoto passava il
// controllo grazie alla chiave salvata, la password spariva in silenzio e la
// Prova riusciva con la CHIAVE: l'utente credeva di aver attivato l'utente.
test("UDM salvato con la chiave, modulo su «utente» senza utente: rifiutato, niente ripiego sulla chiave", () => {
  const v = inTenant(() => createController(input()));
  const dichiarato = checkControllerInput(
    { ...input(), apiKey: "", username: "", password: PW_LOCALE, udmAuth: "password" },
    rigaDb(v.id),
  );
  assert.equal(dichiarato.ok, false);
  if (!dichiarato.ok) assert.match(dichiarato.error, /utente locale/);
  // Anche senza il metodo nel corpo: una password senza utente non si scarta.
  const dedotto = checkControllerInput({ ...input(), apiKey: "", username: "", password: PW_LOCALE }, rigaDb(v.id));
  assert.equal(dedotto.ok, false);
  if (!dedotto.ok) assert.match(dedotto.error, /utente locale/);
  // Metodo «utente» scelto e campi vuoti: la chiave salvata non lo sostituisce.
  const vuoto = checkControllerInput({ ...input(), apiKey: "", udmAuth: "password" }, rigaDb(v.id));
  assert.equal(vuoto.ok, false);
  // Metodo «chiave» scelto con una password: non si scarta in silenzio.
  const misto = checkControllerInput({ ...input(), apiKey: "", password: PW_LOCALE, udmAuth: "api_key" }, rigaDb(v.id));
  assert.equal(misto.ok, false);
  // Il metodo scelto vale anche quando è giusto: chiave salvata e campi vuoti = chiave.
  const chiave = checkControllerInput({ ...input(), apiKey: "", udmAuth: "api_key" }, rigaDb(v.id));
  assert.equal(chiave.ok, true);
  if (chiave.ok) assert.equal(chiave.value.udmAuth, "api_key");
  assert.equal(inTenant(() => getControllerView(v.id))?.apiKeySet, true, "la riga resta com'era");
});

test("pianificazione: un job unifi_sync per controller con il suo id; spenta o controller cancellato = job via", () => {
  const v = inTenant(() => createController(input({ scheduleMinutes: 1440 })));
  assert.equal(v.scheduleMinutes, 1440);
  const job = getTenantDb(T).prepare("SELECT interval_minutes, enabled, config FROM scheduled_jobs WHERE job_type = 'unifi_sync'").all() as Array<{
    interval_minutes: number;
    enabled: number;
    config: string;
  }>;
  assert.equal(job.length, 1);
  assert.equal(job[0].interval_minutes, 1440);
  assert.equal(JSON.parse(job[0].config).controller_id, v.id);

  inTenant(() => updateController(v.id, input({ apiKey: "", scheduleMinutes: 60 })));
  assert.equal(conta("scheduled_jobs", "job_type = 'unifi_sync' AND interval_minutes = 60"), 1);
  // Spento: niente pianificazione, anche se il modulo ne chiede una.
  inTenant(() => updateController(v.id, input({ apiKey: "", enabled: false, scheduleMinutes: 60 })));
  assert.equal(conta("scheduled_jobs", "job_type = 'unifi_sync'"), 0);

  inTenant(() => updateController(v.id, input({ apiKey: "", scheduleMinutes: 120 })));
  assert.equal(conta("scheduled_jobs", "job_type = 'unifi_sync'"), 1);
  assert.equal(inTenant(() => removeController(v.id)), true);
  assert.equal(conta("scheduled_jobs", "job_type = 'unifi_sync'"), 0);
  assert.equal(conta("network_controllers"), 0);
});

type JobRow = { id: number; interval_minutes: number; enabled: number; config: string };
const jobUnifi = (): JobRow[] =>
  getTenantDb(T).prepare("SELECT id, interval_minutes, enabled, config FROM scheduled_jobs WHERE job_type = 'unifi_sync' ORDER BY id").all() as JobRow[];

test("job dei client: spento di default; acceso = un job unifi_sync ogni ora con cosa «client», che la pianificazione degli apparati non tocca", () => {
  const v = inTenant(() => createController(input()));
  assert.equal(v.clientSchedule, false, "spento di default");
  assert.equal(jobUnifi().length, 0);

  inTenant(() => setControllerClientSchedule(v.id, true));
  inTenant(() => setControllerClientSchedule(v.id, true)); // idempotente
  let jobs = jobUnifi();
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].interval_minutes, 60);
  assert.equal(jobs[0].enabled, 1);
  assert.deepEqual(JSON.parse(jobs[0].config), { controller_id: v.id, cosa: "client" });
  const clientJobId = jobs[0].id;

  // La pianificazione degli apparati crea il suo job e lascia stare quello dei client.
  inTenant(() => setControllerSchedule(v.id, 1440));
  jobs = jobUnifi();
  assert.equal(jobs.length, 2);
  assert.equal(jobs.find((j) => j.id === clientJobId)?.interval_minutes, 60);
  inTenant(() => setControllerSchedule(v.id, 120));
  assert.equal(jobUnifi().find((j) => j.id === clientJobId)?.interval_minutes, 60);
  // L'elenco delle pianificazioni degli apparati non vede il job dei client.
  const elenco = inTenant(() => listControllerScheduleJobs());
  assert.equal(elenco.length, 1);
  assert.notEqual(elenco[0].job_id, clientJobId);
  assert.equal(elenco[0].interval_minutes, 120);
  const vista = inTenant(() => getControllerView(v.id));
  assert.equal(vista?.scheduleMinutes, 120, "il job dei client non diventa la pianificazione degli apparati");
  assert.equal(vista?.clientSchedule, true);

  // Spegnere gli apparati non spegne i client, e viceversa.
  inTenant(() => setControllerSchedule(v.id, null));
  assert.deepEqual(jobUnifi().map((j) => j.id), [clientJobId]);
  inTenant(() => setControllerSchedule(v.id, 60));
  inTenant(() => setControllerClientSchedule(v.id, false));
  jobs = jobUnifi();
  assert.equal(jobs.length, 1);
  assert.equal(JSON.parse(jobs[0].config).cosa, undefined);
  assert.equal(inTenant(() => getControllerView(v.id))?.clientSchedule, false);

  // Cancellare il controller toglie tutti e due i job.
  inTenant(() => setControllerClientSchedule(v.id, true));
  assert.equal(jobUnifi().length, 2);
  assert.equal(inTenant(() => removeController(v.id)), true);
  assert.equal(jobUnifi().length, 0);
});

test("job dei client: spegnere il controller lo spegne; da spento o Omada non si accende", () => {
  const v = inTenant(() => createController(input({ scheduleMinutes: 60 })));
  assert.equal(inTenant(() => setClientScheduleFor(v.id, true)).ok, true);
  inTenant(() => updateController(v.id, input({ apiKey: "", enabled: false })));
  assert.equal(jobUnifi().length, 0, "controller spento: nessun job, né apparati né client");
  const rifiuto = inTenant(() => setClientScheduleFor(v.id, true));
  assert.equal(rifiuto.ok, false);
  assert.match(rifiuto.ok ? "" : rifiuto.error, /spento/);
  assert.equal(jobUnifi().length, 0);
  // Spegnere si può sempre; un controller che non c'è è «non trovato».
  assert.equal(inTenant(() => setClientScheduleFor(v.id, false)).ok, true);
  const assente = inTenant(() => setClientScheduleFor(v.id + 99, true));
  assert.equal(assente.ok === false && assente.status, 404);
});

test("PATCH del controller: accetta solo client_schedule booleano", () => {
  assert.deepEqual(parseControllerPatch({ client_schedule: true }), { ok: true, value: { clientSchedule: true } });
  assert.deepEqual(parseControllerPatch({ client_schedule: false }), { ok: true, value: { clientSchedule: false } });
  for (const body of [null, {}, { client_schedule: "si" }, { client_schedule: 1 }, { client_schedule: true, altro: 1 }]) {
    const r = parseControllerPatch(body);
    assert.equal(r.ok, false, JSON.stringify(body));
  }
});

test("accetta il nuovo certificato: solo se l'impronta fissata è ancora quella vista", () => {
  const v = inTenant(() => createController(input({ certPin: PIN_A })));
  const vecchia = inTenant(() => acceptControllerCertPin(v.id, PIN_B, null));
  assert.equal(vecchia.ok, false);
  if (!vecchia.ok) assert.equal(vecchia.status, 409);
  const buona = inTenant(() => acceptControllerCertPin(v.id, PIN_B, PIN_A));
  assert.equal(buona.ok, true);
  assert.equal(inTenant(() => listControllerViews())[0].certPin, PIN_B);
  const storta = inTenant(() => acceptControllerCertPin(v.id, "sha256/corta", PIN_B));
  assert.equal(storta.ok, false);
});

// ── Prova ────────────────────────────────────────────────────────────────────

test("prova dal modulo prima di salvare: l'impronta torna nel risultato, niente scritto nel DB", async () => {
  const r = await inTenant(() => probeControllerInput(input(), null, { transportFactory: consoleFinta().factory }));
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.certPin, PIN_A);
  assert.equal(conta("network_controllers"), 0);
});

test("prova in modifica allo stesso indirizzo: usa la chiave salvata; dalla riga, fissa l'impronta al primo uso", async () => {
  const v = inTenant(() => createController(input()));
  const r = await inTenant(() =>
    probeControllerInput(input({ apiKey: "" }), v.id, { transportFactory: consoleFinta().factory }),
  );
  assert.equal(r.ok, true);
  const r2 = await inTenant(() => probeSavedController(v.id, { transportFactory: consoleFinta().factory }));
  assert.equal(r2.ok, true);
  assert.equal(inTenant(() => listControllerViews())[0].certPin, PIN_A);
});

// ── Lettura registrata ───────────────────────────────────────────────────────

test("sincronizza ora: scrive apparati, porte e vicini, e il giro finisce nello storico e sulla riga", async () => {
  const v = inTenant(() => createController(input()));
  const r = await inTenant(() => syncController(v.id, "manual", "Riccardo", { clientOptions: { transportFactory: consoleFinta().factory } }));
  assert.equal(r.ok, true, r.errors.join("; "));
  assert.equal(r.total, 4);
  assert.equal(conta("network_devices", "vendor = 'ubiquiti'"), 4);
  const [vista] = inTenant(() => listControllerViews());
  assert.equal(vista.lastOk, true);
  assert.equal(vista.lastDevices, 4);
  assert.equal(vista.lastPorts, r.portsUpserted);
  assert.equal(vista.lastNeighbors, r.neighborsUpserted);
  const [giro] = inTenant(() => listControllerRunViews(v.id));
  assert.equal(giro.trigger, "manual");
  assert.equal(giro.triggeredBy, "Riccardo");
  assert.equal(giro.ok, true);
  assert.equal(giro.added, 4);
});

test("lettura fallita: niente scritto, l'esito resta nello storico, i conteggi dell'ultima buona non si toccano", async () => {
  const v = inTenant(() => createController(input()));
  await inTenant(() => syncController(v.id, "manual", null, { clientOptions: { transportFactory: consoleFinta().factory } }));
  const r = await inTenant(() =>
    syncController(v.id, "schedule", null, { clientOptions: { transportFactory: consoleFinta(PIN_A, "altra").factory } }),
  );
  assert.equal(r.ok, false);
  assert.match(r.failure ?? "", /Chiave API rifiutata/);
  const [vista] = inTenant(() => listControllerViews());
  assert.equal(vista.lastOk, false);
  assert.equal(vista.lastDevices, 4, "i conteggi restano quelli dell'ultima lettura riuscita");
  assert.equal(inTenant(() => listControllerRunViews(v.id)).length, 2);
});

test(`storico: si tengono le ultime ${CONTROLLER_RUNS_KEPT} letture per controller, le altre si potano`, () => {
  const v = inTenant(() => createController(input()));
  for (let i = 0; i < CONTROLLER_RUNS_KEPT + 7; i++) {
    inTenant(() =>
      recordControllerRun({
        controller_id: v.id,
        started_at: "2026-10-13 10:00:00",
        finished_at: "2026-10-13 10:00:01",
        trigger: "schedule",
        triggered_by: null,
        ok: 1,
        total: i,
        added: 0,
        updated: 0,
        skipped: 0,
        ports: 0,
        neighbors: 0,
        message: `giro ${i}`,
        errors_json: "[]",
        skipped_reasons_json: "[]",
        offline_json: "[]",
      }),
    );
  }
  assert.equal(conta("network_controller_runs", "controller_id = ?", v.id), CONTROLLER_RUNS_KEPT);
  assert.equal(inTenant(() => listControllerRunViews(v.id, 1))[0].message, `giro ${CONTROLLER_RUNS_KEPT + 6}`);
});

function giro(controllerId: number, trigger: ControllerRunInsert["trigger"], i: number, ok = 1): ControllerRunInsert {
  return {
    controller_id: controllerId,
    started_at: "2026-10-13 10:00:00",
    finished_at: "2026-10-13 10:00:01",
    trigger,
    triggered_by: null,
    ok,
    total: i,
    added: 0,
    updated: 0,
    skipped: 0,
    ports: 0,
    neighbors: 0,
    message: `${trigger} ${i}`,
    errors_json: "[]",
    skipped_reasons_json: "[]",
    offline_json: "[]",
  };
}

test("storico: letture dei client e degli apparati si potano ciascuna per conto suo; l'elenco mostra solo gli apparati", () => {
  const v = inTenant(() => createController(input()));
  inTenant(() => recordControllerRun(giro(v.id, "schedule", 1)));
  // Un giorno e mezzo di letture dei client ogni ora non deve spingere fuori quella degli apparati.
  for (let i = 0; i < CONTROLLER_RUNS_KEPT + 10; i++) {
    inTenant(() => recordControllerRun(giro(v.id, i % 2 ? "client:schedule" : "client:manual", i)));
  }
  assert.equal(conta("network_controller_runs", "controller_id = ? AND trigger LIKE 'client:%'", v.id), CONTROLLER_RUNS_KEPT);
  assert.equal(conta("network_controller_runs", "controller_id = ? AND trigger NOT LIKE 'client:%'", v.id), 1);
  const elenco = inTenant(() => listControllerRunViews(v.id, 10));
  assert.deepEqual(elenco.map((r) => r.message), ["schedule 1"]);
  assert.equal(elenco[0].kind, "apparati");

  for (let i = 0; i < CONTROLLER_RUNS_KEPT + 3; i++) inTenant(() => recordControllerRun(giro(v.id, "manual", 100 + i)));
  assert.equal(conta("network_controller_runs", "controller_id = ? AND trigger NOT LIKE 'client:%'", v.id), CONTROLLER_RUNS_KEPT);
  assert.equal(conta("network_controller_runs", "controller_id = ? AND trigger LIKE 'client:%'", v.id), CONTROLLER_RUNS_KEPT);
});

test("storico: una lettura dei client non tocca il riepilogo degli apparati e si vede come riga a sé sulla vista", () => {
  const v = inTenant(() => createController(input()));
  inTenant(() => recordControllerRun({ ...giro(v.id, "schedule", 37), ports: 120, neighbors: 9 }));
  inTenant(() => recordControllerRun({ ...giro(v.id, "client:schedule", 400), message: "Lettura client: 400 letti" }));
  inTenant(() => recordControllerRun({ ...giro(v.id, "client:schedule", 0, 0), message: "Lettura client: non raggiungibile" }));
  const vista = inTenant(() => getControllerView(v.id));
  assert.equal(vista?.lastDevices, 37, "i conteggi restano quelli degli apparati");
  assert.equal(vista?.lastPorts, 120);
  assert.equal(vista?.lastOk, true, "un giro dei client fallito non fa diventare rosso il controller");
  assert.equal(vista?.lastClientRun?.ok, false);
  assert.equal(vista?.lastClientRun?.message, "Lettura client: non raggiungibile");
  assert.equal(vista?.lastClientRun?.at, "2026-10-13 10:00:01");
  const elenco = inTenant(() => listControllerViews());
  assert.equal(elenco[0].lastClientRun?.message, "Lettura client: non raggiungibile");
});

// ── Configurazione vecchia dell'hub ──────────────────────────────────────────

function configurazioneVecchia(): string {
  const cifrata = encrypt("password-del-controller");
  setSetting("integration_unifi_mode", "external");
  setSetting("integration_unifi_url", "https://10.0.1.222:8443");
  setSetting("integration_unifi_kind", "self_hosted");
  setSetting("integration_unifi_site", "default");
  setSetting("integration_unifi_username", "map");
  setSetting("integration_unifi_password", cifrata);
  setSetting("integration_unifi_cert_pin", PIN_A);
  return cifrata;
}

test("configurazione vecchia: diventa la prima riga, segreto copiato cifrato com'è, impronta e job legati", () => {
  const cifrata = configurazioneVecchia();
  getTenantDb(T)
    .prepare("INSERT INTO scheduled_jobs (network_id, job_type, interval_minutes, enabled, config) VALUES (NULL, 'unifi_sync', 1440, 0, '{}')")
    .run();
  const m = inTenant(() => migrateLegacyUnifiConfig());
  assert.equal(m.state, "done");
  if (m.state === "done") assert.equal(m.jobsAttached, 1);
  const row = getTenantDb(T).prepare("SELECT * FROM network_controllers").get() as Record<string, unknown>;
  assert.equal(row.kind, "self_hosted");
  assert.equal(row.url, "https://10.0.1.222:8443");
  assert.equal(row.username, "map");
  assert.equal(row.password_enc, cifrata, "il segreto si copia senza decifrarlo");
  assert.equal(row.cert_pin, PIN_A);
  assert.equal(row.enabled, 1);
  assert.equal(row.origin, "legacy_hub");
  const job = getTenantDb(T).prepare("SELECT config FROM scheduled_jobs WHERE job_type = 'unifi_sync'").get() as { config: string };
  assert.equal(JSON.parse(job.config).controller_id, row.id);
  // Una volta sola.
  assert.equal(inTenant(() => migrateLegacyUnifiConfig()).state, "already");
  assert.equal(conta("network_controllers"), 1);
  assert.match(inTenant(() => getTenantSetting("controllers_legacy_unifi")) ?? "", /^done:/);
});

test("configurazione vecchia con la password ancora in chiaro: si cifra passando", () => {
  configurazioneVecchia();
  setSetting("integration_unifi_password", "in-chiaro");
  inTenant(() => migrateLegacyUnifiConfig());
  const row = getTenantDb(T).prepare("SELECT password_enc FROM network_controllers").get() as { password_enc: string };
  assert.notEqual(row.password_enc, "in-chiaro");
  assert.match(row.password_enc, /^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/i);
});

test("configurazione vecchia con più clienti attivi: non si indovina di chi sia, non si porta", () => {
  configurazioneVecchia();
  const ins = getHubDb().prepare("INSERT INTO tenants (codice_cliente, ragione_sociale, active) VALUES (?, ?, 1)");
  ins.run("TESTCTRL1", "Uno");
  ins.run("TESTCTRL2", "Due");
  const m = inTenant(() => migrateLegacyUnifiConfig());
  assert.equal(m.state, "skipped_multi_tenant");
  assert.equal(conta("network_controllers"), 0);
});

test("nessuna configurazione vecchia: niente da portare, e l'elenco la cerca una volta sola", () => {
  assert.deepEqual(inTenant(() => listControllerViews()), []);
  assert.equal(inTenant(() => getTenantSetting("controllers_legacy_unifi")), "nothing");
  // Configurata dopo il primo giro: non si porta più (la card che la scriveva non c'è).
  configurazioneVecchia();
  assert.deepEqual(inTenant(() => listControllerViews()), []);
});
