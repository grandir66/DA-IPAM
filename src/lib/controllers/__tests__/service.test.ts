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
  createCredential,
  deleteTenantDatabase,
  getTenantDb,
  getTenantSetting,
  insertNetworkController,
  listControllerScheduleJobs,
  recordControllerRun,
  setControllerClientSchedule,
  setControllerSchedule,
  withTenant,
  type ControllerRunInsert,
  type NetworkControllerInsert,
} from "@/lib/db-tenant";
import { decrypt, encrypt } from "@/lib/crypto";
import { convertiControllerEAd } from "@/lib/credentials/converti-integrazioni";
import { riepilogoRipieghi } from "@/lib/db-maintenance/ripieghi";
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
  controllerClientConfig,
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
import type { ControllerInput, NetworkControllerRow } from "../types";

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

/** La voce d'archivio puntata dal controller (tappa 2f, T23). */
function voceDi(controllerId: number): Record<string, string | null> {
  const v = getTenantDb(T)
    .prepare("SELECT c.* FROM credentials c JOIN network_controllers nc ON nc.credential_id = c.id WHERE nc.id = ?")
    .get(controllerId) as Record<string, string | null> | undefined;
  assert.ok(v, `il controller #${controllerId} non punta nessuna voce`);
  return v;
}

test("la vista non porta mai i segreti, solo se ci sono; la voce dell'archivio li tiene cifrati, le colonne restano vuote", () => {
  const v = inTenant(() => createController(input()));
  assert.equal(v.apiKeySet, true);
  assert.equal(v.passwordSet, false);
  assert.doesNotMatch(JSON.stringify(inTenant(() => listControllerViews())), new RegExp(CHIAVE));
  const voce = voceDi(v.id);
  assert.notEqual(voce.encrypted_password, CHIAVE);
  assert.match(voce.encrypted_password ?? "", /^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/i);
  const raw = getTenantDb(T).prepare("SELECT api_key_enc, password_enc FROM network_controllers WHERE id = ?").get(v.id) as {
    api_key_enc: string;
    password_enc: string;
  };
  assert.deepEqual(raw, { api_key_enc: "", password_enc: "" }, "un controller nuovo non scrive i segreti nelle colonne vecchie");
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
  assert.equal(inTenant(() => checkControllerInput({ ...input(), apiKey: "" }, row)).ok, true);
  assert.equal(inTenant(() => checkControllerInput({ ...input(), apiKey: "", url: "https://10.0.0.1" }, row)).ok, false);
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

test("UDM con utente locale: senza chiave né utente o senza password si rifiuta; salvato tiene utente e password nella voce, niente chiave", () => {
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
  assert.equal(v.credentialMethod, "utente");
  assert.equal(v.passwordSet, true);
  assert.equal(v.apiKeySet, false);
  const voce = voceDi(v.id);
  assert.equal(voce.credential_type, "unifi");
  assert.equal(voce.auth_method, "utente");
  assert.equal(decrypt(voce.encrypted_username ?? ""), "rgadmin");
  assert.notEqual(voce.encrypted_password, PW_LOCALE);
  assert.equal(decrypt(voce.encrypted_password ?? ""), PW_LOCALE);
  assert.doesNotMatch(JSON.stringify(inTenant(() => listControllerViews())), new RegExp(PW_LOCALE));
});

test("pilota: il controller salvato self_hosted con utente e password, passato a UDM dalla pagina, entra col login senza ridare la password", async () => {
  const sh = inTenant(() =>
    createController(input({ kind: "self_hosted", apiKey: "", username: "rgadmin", password: PW_LOCALE })),
  );
  const check = inTenant(() => checkControllerInput({ ...input(), apiKey: "", username: "rgadmin", password: "" }, rigaDb(sh.id)));
  assert.equal(check.ok, true, check.ok ? "" : check.error);
  if (!check.ok) return;
  const prova = consoleConUtente();
  const r = await inTenant(() => probeControllerInput(check.value, sh.id, { transportFactory: prova.factory }));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(prova.calls[0].path, "/api/auth/login");
  const v = inTenant(() => updateController(sh.id, check.value));
  assert.equal(v?.kind, "udm");
  assert.equal(v?.credentialId, sh.credentialId, "la voce a utente vale anche per la console UniFi OS (ADR 0019)");
  assert.equal(v?.credentialMethod, "utente");
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

test("UDM: da chiave a utente vale la voce nuova a utente (e la prova non usa la chiave); da utente a chiave la voce nuova a chiave", async () => {
  const v = inTenant(() => createController(input()));
  assert.equal(v.apiKeySet, true);
  const aUtente = inTenant(() => checkControllerInput({ ...input(), apiKey: "", username: "rgadmin", password: PW_LOCALE }, rigaDb(v.id)));
  assert.equal(aUtente.ok, true);
  if (!aUtente.ok) return;
  const prova = consoleConUtente();
  const r = await inTenant(() => probeControllerInput(aUtente.value, v.id, { transportFactory: prova.factory }));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(prova.calls[0].headers["X-API-KEY"], undefined, "la chiave salvata non parte se si è scelto l'utente");
  const u = inTenant(() => updateController(v.id, aUtente.value));
  assert.equal(u?.apiKeySet, false);
  assert.equal(u?.passwordSet, true);
  assert.equal(u?.credentialMethod, "utente");
  assert.notEqual(u?.credentialId, v.credentialId);
  const aChiave = inTenant(() => checkControllerInput({ ...input(), apiKey: CHIAVE }, rigaDb(v.id)));
  assert.equal(aChiave.ok, true);
  if (!aChiave.ok) return;
  const k = inTenant(() => updateController(v.id, aChiave.value));
  assert.equal(k?.apiKeySet, true);
  assert.equal(k?.passwordSet, false);
  assert.equal(k?.credentialMethod, "chiave");
});

// Revisione del 16/10: su un UDM salvato con la chiave, il modulo su «Utente
// locale e password» con la password scritta e l'utente vuoto passava il
// controllo grazie alla chiave salvata, la password spariva in silenzio e la
// Prova riusciva con la CHIAVE: l'utente credeva di aver attivato l'utente.
test("UDM salvato con la chiave, modulo su «utente» senza utente: rifiutato, niente ripiego sulla chiave", () => {
  const v = inTenant(() => createController(input()));
  const dichiarato = inTenant(() =>
    checkControllerInput({ ...input(), apiKey: "", username: "", password: PW_LOCALE, udmAuth: "password" }, rigaDb(v.id)),
  );
  assert.equal(dichiarato.ok, false);
  if (!dichiarato.ok) assert.match(dichiarato.error, /utente locale/);
  // Anche senza il metodo nel corpo: una password senza utente non si scarta.
  const dedotto = inTenant(() => checkControllerInput({ ...input(), apiKey: "", username: "", password: PW_LOCALE }, rigaDb(v.id)));
  assert.equal(dedotto.ok, false);
  if (!dedotto.ok) assert.match(dedotto.error, /utente locale/);
  // Metodo «utente» scelto e campi vuoti: la chiave salvata non lo sostituisce.
  const vuoto = inTenant(() => checkControllerInput({ ...input(), apiKey: "", udmAuth: "password" }, rigaDb(v.id)));
  assert.equal(vuoto.ok, false);
  // Metodo «chiave» scelto con una password: non si scarta in silenzio.
  const misto = inTenant(() => checkControllerInput({ ...input(), apiKey: "", password: PW_LOCALE, udmAuth: "api_key" }, rigaDb(v.id)));
  assert.equal(misto.ok, false);
  // Il metodo scelto vale anche quando è giusto: chiave salvata e campi vuoti = chiave.
  const chiave = inTenant(() => checkControllerInput({ ...input(), apiKey: "", udmAuth: "api_key" }, rigaDb(v.id)));
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

test("configurazione vecchia: diventa prima una voce dell'archivio e poi la riga; segreto copiato cifrato com'è, impronta e job legati", () => {
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
  assert.equal(row.cert_pin, PIN_A);
  assert.equal(row.enabled, 1);
  assert.equal(row.origin, "legacy_hub");
  // Tappa 2f (T23): il segreto sta nella voce, le colonne vecchie restano vuote.
  assert.equal(row.password_enc, "");
  assert.equal(row.api_key_enc, "");
  const voce = voceDi(row.id as number);
  assert.equal(voce.name, "UniFi · Controller UniFi 10.0.1.222");
  assert.equal(voce.credential_type, "unifi");
  assert.equal(voce.auth_method, "utente");
  assert.equal(voce.encrypted_password, cifrata, "il segreto si copia senza decifrarlo");
  assert.equal(decrypt(voce.encrypted_username ?? ""), "map");
  const job = getTenantDb(T).prepare("SELECT config FROM scheduled_jobs WHERE job_type = 'unifi_sync'").get() as { config: string };
  assert.equal(JSON.parse(job.config).controller_id, row.id);
  // Una volta sola.
  assert.equal(inTenant(() => migrateLegacyUnifiConfig()).state, "already");
  assert.equal(conta("network_controllers"), 1);
  assert.equal(conta("credentials"), 1);
  assert.match(inTenant(() => getTenantSetting("controllers_legacy_unifi")) ?? "", /^done:/);
});

test("configurazione vecchia di una console UniFi OS: la chiave API diventa una voce «Controller UniFi» a chiave", () => {
  configurazioneVecchia();
  const chiave = encrypt("chiave-hub");
  setSetting("integration_unifi_kind", "udm");
  setSetting("integration_unifi_api_token", chiave);
  inTenant(() => migrateLegacyUnifiConfig());
  const row = getTenantDb(T).prepare("SELECT id, kind, username, api_key_enc FROM network_controllers").get() as {
    id: number;
    kind: string;
    username: string;
    api_key_enc: string;
  };
  assert.equal(row.kind, "udm");
  assert.equal(row.api_key_enc, "");
  const voce = voceDi(row.id);
  assert.equal(voce.auth_method, "chiave");
  assert.equal(voce.encrypted_password, chiave);
  assert.equal(voce.encrypted_username, null);
});

test("configurazione vecchia con la password ancora in chiaro: si cifra passando", () => {
  configurazioneVecchia();
  setSetting("integration_unifi_password", "in-chiaro");
  inTenant(() => migrateLegacyUnifiConfig());
  const row = getTenantDb(T).prepare("SELECT id FROM network_controllers").get() as { id: number };
  const voce = voceDi(row.id);
  assert.notEqual(voce.encrypted_password, "in-chiaro");
  assert.match(voce.encrypted_password ?? "", /^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/i);
  assert.equal(decrypt(voce.encrypted_password ?? ""), "in-chiaro");
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

// ── Credenziale dall'archivio (tappa 2f credenziali, T23) ───────────────────
//
// Dalla 2f il controller entra con una voce dell'archivio (`credential_id`).
// Le colonne della riga (`username`, `password_enc`, `api_key_enc`) restano
// piene fino alla 2g solo per le righe convertite dal T22, e si leggono solo
// per le righe MAI convertite (segno `credenziali_t2_integrazioni` diverso da
// `done:`), registrando il ripiego. Un cambio d'indirizzo scollega la voce e
// svuota le colonne: il segreto non parte verso un host che nessuno ha scelto.

const SEGNO_2F = "credenziali_t2_integrazioni";
const PARZIALE_2F = "parziale:2026-10-16T08:00:00.000Z:controller=0,chiave=0,utente=0,ad=0,lasciati=1";
const DONE_2F = "done:2026-10-16T08:00:00.000Z:controller=1,chiave=1,utente=0,ad=0,lasciati=0";

function segna2f(valore: string): void {
  getTenantDb(T)
    .prepare("INSERT INTO tenant_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(SEGNO_2F, valore);
}

/** Riga com'era prima della 2f: segreti nelle colonne, nessuna voce. */
function rigaVecchia(campi: Partial<NetworkControllerInsert> & Pick<NetworkControllerInsert, "kind">): number {
  return inTenant(() =>
    insertNetworkController({
      name: "Vecchio",
      vendor: "unifi",
      url: "https://192.168.15.252",
      site: "default",
      username: "",
      password_enc: "",
      api_key_enc: "",
      cert_pin: null,
      enabled: 1,
      origin: "manual",
      ...campi,
    }),
  ).id;
}

const riga2f = (id: number) => getTenantDb(T).prepare("SELECT * FROM network_controllers WHERE id = ?").get(id) as NetworkControllerRow;
const ripieghiRiga = () => (riepilogoRipieghi(500).per_caso as Record<string, number | undefined>).cred_riga_integrazione ?? 0;

test("T23: un controller con la voce costruisce la stessa configurazione del client che nasceva dalle colonne", () => {
  const ids = [
    rigaVecchia({ kind: "udm", name: "Sede", api_key_enc: encrypt(CHIAVE) }),
    rigaVecchia({ kind: "self_hosted", name: "Cliente A", url: "https://10.0.1.222:8443", username: "map", password_enc: encrypt("pw-map") }),
    rigaVecchia({ kind: "udm", name: "Pilota", username: "rgadmin", password_enc: encrypt(PW_LOCALE) }),
  ];
  segna2f(PARZIALE_2F);
  const prima = ids.map((id) => inTenant(() => controllerClientConfig(riga2f(id))));
  const esito = convertiControllerEAd(getTenantDb(T), { aVuoto: false });
  assert.deepEqual(esito.controller.map((c) => c.metodo), ["chiave", "utente", "utente"]);
  const dopo = ids.map((id) => inTenant(() => controllerClientConfig(riga2f(id))));
  for (let i = 0; i < ids.length; i++) {
    const a = prima[i];
    const b = dopo[i];
    assert.ok(a.ok && b.ok, JSON.stringify({ a, b }));
    if (!a.ok || !b.ok) continue;
    assert.equal(a.fonte, "colonne");
    assert.equal(b.fonte, "voce");
    assert.deepEqual(b.config, a.config, `controller #${ids[i]}`);
  }
});

test("T23: cambio d'indirizzo senza voce né segreti nuovi → voce scollegata, colonne vuote, «Credenziale mancante», nessuna richiesta verso il nuovo indirizzo", async () => {
  const id = rigaVecchia({ kind: "udm", api_key_enc: encrypt(CHIAVE), cert_pin: PIN_A });
  convertiControllerEAd(getTenantDb(T), { aVuoto: false });
  const convertita = riga2f(id);
  assert.notEqual(convertita.credential_id, null);
  assert.notEqual(convertita.api_key_enc, "", "dopo la conversione le colonne restano piene fino alla 2g");
  // Dalla pagina il controllo lo rifiuta: va scelta di nuovo una voce.
  const rifiuto = inTenant(() => checkControllerInput({ ...input(), apiKey: "", url: "https://10.0.0.9" }, convertita));
  assert.equal(rifiuto.ok, false);
  if (!rifiuto.ok) assert.match(rifiuto.error, /indirizzo/);
  // Il servizio, chiamato comunque: scollega e svuota.
  const v = inTenant(() => updateController(id, input({ url: "https://10.0.0.9", apiKey: "" })));
  const riga = riga2f(id);
  assert.equal(riga.credential_id, null);
  assert.equal(riga.api_key_enc, "");
  assert.equal(riga.password_enc, "");
  assert.equal(riga.cert_pin, null);
  assert.equal(v?.credentialId, null);
  assert.equal(v?.apiKeySet, false);
  const cfg = inTenant(() => controllerClientConfig(riga));
  assert.equal(cfg.ok, false);
  if (!cfg.ok) assert.match(cfg.motivo, /Credenziale mancante/);
  const finta = consoleFinta();
  const prova = await inTenant(() => probeSavedController(id, { transportFactory: finta.factory }));
  assert.equal(prova.ok, false);
  if (!prova.ok) assert.match(prova.message, /Credenziale mancante/);
  const giro = await inTenant(() => syncController(id, "manual", null, { clientOptions: { transportFactory: finta.factory } }));
  assert.equal(giro.ok, false);
  assert.match(giro.failure ?? "", /Credenziale mancante/);
  assert.equal(finta.calls.length, 0, "nessuna richiesta parte verso il nuovo indirizzo");
});

test("T23: cambio d'indirizzo con la voce scelta di nuovo nella stessa richiesta → la voce resta, colonne e impronta azzerate", () => {
  const id = rigaVecchia({ kind: "udm", api_key_enc: encrypt(CHIAVE), cert_pin: PIN_A });
  convertiControllerEAd(getTenantDb(T), { aVuoto: false });
  const voce = riga2f(id).credential_id as number;
  const check = inTenant(() => checkControllerInput({ ...input(), apiKey: "", url: "https://10.0.0.9", credentialId: voce }, riga2f(id)));
  assert.equal(check.ok, true, check.ok ? "" : check.error);
  if (!check.ok) return;
  inTenant(() => updateController(id, check.value));
  const riga = riga2f(id);
  assert.equal(riga.credential_id, voce);
  assert.equal(riga.api_key_enc, "");
  assert.equal(riga.cert_pin, null);
});

test("T23: tipo ↔ metodo della voce (ADR 0019): UniFi OS con chiave o con utente, self-hosted solo con utente; il resto è 400", () => {
  const chiave = inTenant(() => createController(input({ name: "Con chiave" }))).credentialId as number;
  const utente = inTenant(() =>
    createController(input({ name: "Con utente", apiKey: "", username: "rgadmin", password: PW_LOCALE, udmAuth: "password" })),
  ).credentialId as number;
  const ssh = inTenant(() =>
    createCredential({ name: "Linux", credential_type: "ssh", encrypted_username: encrypt("root"), encrypted_password: encrypt("pw") }),
  ).id;
  const check = (corpo: Record<string, unknown>) => inTenant(() => checkControllerInput(corpo));
  // UniFi OS: tutte e due; senza metodo nel corpo il metodo è quello della voce.
  const c1 = check({ ...input(), apiKey: "", credentialId: chiave });
  assert.equal(c1.ok && c1.value.udmAuth, "api_key");
  const c2 = check({ ...input(), apiKey: "", credentialId: utente });
  assert.equal(c2.ok && c2.value.udmAuth, "password");
  // UniFi OS col metodo scelto diverso da quello della voce: 400.
  const m1 = check({ ...input(), apiKey: "", credentialId: utente, udmAuth: "api_key" });
  assert.equal(m1.ok, false);
  if (!m1.ok) assert.match(m1.error, /utente e password/);
  assert.equal(check({ ...input(), apiKey: "", credentialId: chiave, udmAuth: "password" }).ok, false);
  // Self-hosted: solo utente.
  const sh = check({ ...input(), kind: "self_hosted", apiKey: "", credentialId: chiave });
  assert.equal(sh.ok, false);
  if (!sh.ok) assert.match(sh.error, /chiave API/);
  assert.equal(check({ ...input(), kind: "self_hosted", apiKey: "", credentialId: utente }).ok, true);
  // Una voce d'altro tipo, una che non c'è, o voce e segreti insieme: 400.
  const altro = check({ ...input(), apiKey: "", credentialId: ssh });
  assert.equal(altro.ok, false);
  if (!altro.ok) assert.match(altro.error, /non vale per il controller UniFi/);
  assert.equal(check({ ...input(), apiKey: "", credentialId: 99999 }).ok, false);
  const insieme = check({ ...input(), credentialId: chiave });
  assert.equal(insieme.ok, false, "voce scelta e chiave scritta insieme");
  // Un self-hosted salvato con la voce a utente, passato a UDM «chiave» senza chiave nuova: 400.
  const shRiga = inTenant(() => createController(input({ name: "Self", kind: "self_hosted", apiKey: "", username: "map", password: "pw" })));
  assert.equal(inTenant(() => checkControllerInput({ ...input(), apiKey: "", udmAuth: "api_key" }, riga2f(shRiga.id))).ok, false);
});

test("T23: segreti nuovi → voce «UniFi · <nome>» nell'archivio, niente nelle colonne; un nome già preso prende «(controller #id)»", () => {
  const a = inTenant(() => createController(input()));
  assert.equal(a.credentialName, "UniFi · DA-UDM-Beast");
  assert.equal(a.credentialMethod, "chiave");
  const voce = voceDi(a.id);
  assert.equal(voce.credential_type, "unifi");
  assert.equal(voce.auth_method, "chiave");
  assert.equal(decrypt(voce.encrypted_password ?? ""), CHIAVE);
  const b = inTenant(() => createController(input()));
  assert.equal(b.credentialName, `UniFi · DA-UDM-Beast (controller #${b.id})`);
  assert.notEqual(b.credentialId, a.credentialId);
  // La voce scelta da un altro controller si può condividere: nessuna voce nuova.
  const prima = conta("credentials");
  const c = inTenant(() => createController(input({ name: "Terzo", apiKey: "", credentialId: a.credentialId })));
  assert.equal(c.credentialId, a.credentialId);
  assert.equal(c.credentialName, "UniFi · DA-UDM-Beast");
  assert.equal(conta("credentials"), prima);
  const righe = getTenantDb(T).prepare("SELECT password_enc, api_key_enc FROM network_controllers WHERE id = ?").get(c.id);
  assert.deepEqual(righe, { password_enc: "", api_key_enc: "" });
});

test("T23: riga mai convertita (colonne piene, segno parziale:) → si legge dalle colonne, il ripiego si registra e la riga lo dice", async () => {
  const id = rigaVecchia({ kind: "udm", api_key_enc: encrypt(CHIAVE) });
  segna2f(PARZIALE_2F);
  const prima = ripieghiRiga();
  const r = await inTenant(() => syncController(id, "manual", null, { clientOptions: { transportFactory: consoleFinta().factory } }));
  assert.equal(r.ok, true, r.errors.join("; "));
  assert.ok(ripieghiRiga() > prima, "cred_riga_integrazione registrato");
  const vista = inTenant(() => getControllerView(id));
  assert.equal(vista?.lastOk, true);
  assert.match(vista?.lastMessage ?? "", /Credenziale ancora nella forma vecchia/);
  const p = await inTenant(() => probeSavedController(id, { transportFactory: consoleFinta().factory }));
  assert.equal(p.ok, true, JSON.stringify(p));
  // Si può accendere, spegnere e rinominare senza scegliere una voce: resta sulle colonne.
  const check = inTenant(() => checkControllerInput({ ...input(), name: "Rinominato", apiKey: "" }, riga2f(id)));
  assert.equal(check.ok, true, check.ok ? "" : check.error);
});

test("T23: voce cancellata col segno done: → «Credenziale mancante» anche con le colonne piene: nessuna richiesta, nessun ripiego", async () => {
  const id = rigaVecchia({ kind: "udm", api_key_enc: encrypt(CHIAVE) });
  convertiControllerEAd(getTenantDb(T), { aVuoto: false });
  segna2f(DONE_2F);
  // resetConfiguration o D8 = (b): la voce sparisce, ON DELETE SET NULL.
  getTenantDb(T).prepare("DELETE FROM credentials WHERE id = ?").run(riga2f(id).credential_id);
  const riga = riga2f(id);
  assert.equal(riga.credential_id, null);
  assert.notEqual(riga.api_key_enc, "", "le colonne della riga sono ancora piene");
  const prima = ripieghiRiga();
  const finta = consoleFinta();
  const r = await inTenant(() => syncController(id, "schedule", null, { clientOptions: { transportFactory: finta.factory } }));
  assert.equal(r.ok, false);
  assert.match(r.failure ?? "", /Credenziale mancante/);
  const p = await inTenant(() => probeSavedController(id, { transportFactory: finta.factory }));
  assert.equal(p.ok, false);
  if (!p.ok) assert.match(p.message, /Credenziale mancante/);
  assert.equal(finta.calls.length, 0);
  assert.equal(ripieghiRiga(), prima, "nessun ripiego: la riga è stata convertita");
  // E il modulo non la tiene buona senza una scelta.
  assert.equal(inTenant(() => checkControllerInput({ ...input(), apiKey: "" }, riga)).ok, false);
});
