// Console UniFi OS con utente locale e password (ADR 0019, 16/10): sul pilota
// l'account locale `rgadmin` non può creare la chiave API, quindi si entra con
// POST /api/auth/login (cookie TOKEN + X-CSRF-Token) e si esce con
// POST /api/auth/logout. Nessuna rete verso sistemi veri: un trasporto finto.
// Un 401/403/429 al login non si ritenta MAI nello stesso giro: la console
// blocca l'account dopo troppi tentativi.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  anonymousProbe,
  checkPresentedPin,
  createUnifiClient,
  detectUnifiOs,
  isUnifiRequestAllowed,
  UnifiApiError,
  type UnifiHttpRequest,
  type UnifiHttpResponse,
  type UnifiTransportFactory,
} from "../unifi-api";
import type { UnifiCertPinStore } from "../types";

const STAT_BODY = fs.readFileSync(path.join(__dirname, "fixtures", "unifi-stat-device.json"), "utf-8");
const PASSWORD = "Pw-Locale-Che-Non-Deve-Comparire";
const CFG = { url: "https://192.168.99.250", kind: "udm" as const, site: "default", username: "rgadmin", password: PASSWORD };
const PIN = "sha256/CONSOLE=";

function memoryStore(initial: string | null = null): UnifiCertPinStore & { value: string | null } {
  const s = {
    value: initial,
    get: () => s.value,
    set: (p: string) => {
      s.value = p;
    },
    clear: () => {
      s.value = null;
    },
  };
  return s;
}

function json(status: number, body: unknown, headers: Record<string, string | string[]> = {}): UnifiHttpResponse {
  return { status, headers, body: JSON.stringify(body) };
}

const LOGIN_OK = json(
  200,
  { unique_id: "u1", username: "rgadmin", isOwner: false },
  { "set-cookie": ["TOKEN=JWT-SESSIONE; path=/; samesite=strict; secure; httponly"], "x-csrf-token": "CSRF-1" },
);

/** Console finta: login con utente e password, letture solo col cookie TOKEN giusto. */
function consoleFinta(o: { login?: UnifiHttpResponse; device?: UnifiHttpResponse } = {}) {
  const calls: UnifiHttpRequest[] = [];
  const factory: UnifiTransportFactory = (_base, pins) => async (req) => {
    checkPresentedPin(pins, PIN);
    calls.push({ ...req, headers: { ...req.headers } });
    if (req.path === "/api/auth/login") return o.login ?? LOGIN_OK;
    if (req.headers.Cookie !== "TOKEN=JWT-SESSIONE") return json(401, { error: "unauthorized" });
    if (req.path === "/api/auth/logout") return json(200, {});
    if (req.path === "/proxy/network/api/s/default/stat/device") {
      // La console rinnova il CSRF: le richieste dopo devono usare quello nuovo.
      const r = o.device ?? { status: 200, headers: {}, body: STAT_BODY };
      return { ...r, headers: { ...r.headers, "x-updated-csrf-token": "CSRF-2" } };
    }
    if (req.path === "/proxy/network/api/self/sites") {
      return json(200, { meta: { rc: "ok" }, data: [{ name: "default", desc: "Sede" }] });
    }
    return json(404, {});
  };
  return { factory, calls };
}

const percorsi = (calls: UnifiHttpRequest[]) => calls.map((c) => `${c.method} ${c.path}`);

// ── Sola lettura ─────────────────────────────────────────────────────────────

test("sola lettura: in più passano SOLO POST /api/auth/login e POST /api/auth/logout", () => {
  assert.equal(isUnifiRequestAllowed("POST", "/api/auth/login"), true);
  assert.equal(isUnifiRequestAllowed("POST", "/api/auth/logout"), true);
  for (const [m, p] of [
    ["GET", "/api/auth/login"],
    ["PUT", "/api/auth/login"],
    ["DELETE", "/api/auth/logout"],
    ["POST", "/api/auth/mfa"],
    ["POST", "/api/auth/login/"],
    ["POST", "/proxy/network/api/auth/login"],
    ["POST", "/api/users/self"],
    ["POST", "/proxy/network/api/s/default/cmd/devmgr"],
    ["GET", "/"],
  ] as const) {
    assert.equal(isUnifiRequestAllowed(m, p), false, `${m} ${p} deve essere rifiutata`);
  }
});

// ── Login riuscito ───────────────────────────────────────────────────────────

test("utente locale: login → letture col cookie TOKEN e il CSRF (aggiornato) → logout; pin fissato dopo il successo", async () => {
  const store = memoryStore();
  const { factory, calls } = consoleFinta();
  const r = await createUnifiClient(CFG, store, { transportFactory: factory }).probe();
  assert.equal(r.ok, true, JSON.stringify(r));
  if (r.ok) {
    assert.equal(r.devices, 4);
    assert.deepEqual(r.sites, [{ name: "default", desc: "Sede" }]);
    assert.equal(r.certPinRecorded, true);
  }
  assert.deepEqual(percorsi(calls), [
    "POST /api/auth/login",
    "GET /proxy/network/api/s/default/stat/device",
    "GET /proxy/network/api/self/sites",
    "POST /api/auth/logout",
  ]);
  assert.deepEqual(JSON.parse(calls[0].body ?? "{}"), { username: "rgadmin", password: PASSWORD, rememberMe: false });
  assert.equal(calls[0].headers.Cookie, undefined, "il login parte senza sessione");
  assert.equal(calls[0].headers["X-API-KEY"], undefined);
  assert.equal(calls[1].headers.Cookie, "TOKEN=JWT-SESSIONE");
  assert.equal(calls[1].headers["X-CSRF-Token"], "CSRF-1");
  assert.equal(calls[2].headers["X-CSRF-Token"], "CSRF-2", "il CSRF rinnovato dalla console vale per le richieste dopo");
  assert.equal(calls[3].headers.Cookie, "TOKEN=JWT-SESSIONE");
  assert.equal(calls[3].headers["X-CSRF-Token"], "CSRF-2");
  assert.equal(store.value, PIN);
  assert.doesNotMatch(JSON.stringify(r), new RegExp(PASSWORD));
});

test("utente locale: lettura fallita → logout fatto lo stesso, pin non fissato", async () => {
  const store = memoryStore();
  const { factory, calls } = consoleFinta({ device: json(502, {}) });
  await assert.rejects(
    createUnifiClient(CFG, store, { transportFactory: factory }).listDevices(),
    (e: unknown) => e instanceof UnifiApiError && e.reason === "server",
  );
  assert.equal(calls.at(-1)?.path, "/api/auth/logout");
  assert.equal(store.value, null);
});

test("utente locale: la console accetta il login ma non dà il cookie TOKEN → errore, nessuna lettura", async () => {
  const { factory, calls } = consoleFinta({ login: json(200, {}, { "x-csrf-token": "C" }) });
  const r = await createUnifiClient(CFG, memoryStore(), { transportFactory: factory }).probe();
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.message, /sessione/);
  assert.deepEqual(percorsi(calls), ["POST /api/auth/login"]);
});

test("la chiave API, se c'è, vince: niente login", async () => {
  const calls: UnifiHttpRequest[] = [];
  const factory: UnifiTransportFactory = () => async (req) => {
    calls.push(req);
    return req.path.endsWith("/stat/device") ? { status: 200, headers: {}, body: STAT_BODY } : json(404, {});
  };
  await createUnifiClient({ ...CFG, apiToken: "k" }, memoryStore(), { transportFactory: factory }).listDevices();
  assert.deepEqual(percorsi(calls), ["GET /proxy/network/api/s/default/stat/device"]);
  assert.equal(calls[0].headers["X-API-KEY"], "k");
});

test("console senza chiave né utente: errore di configurazione che nomina tutte e due le vie, nessuna richiesta", async () => {
  const { factory, calls } = consoleFinta();
  const r = await createUnifiClient({ url: CFG.url, kind: "udm" }, memoryStore(), { transportFactory: factory }).probe();
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.reason, "config");
    assert.match(r.message, /chiave API/i);
    assert.match(r.message, /utente locale/i);
  }
  assert.equal(calls.length, 0);
});

// ── Login rifiutato: messaggi chiari, nessun secondo tentativo ───────────────

for (const [status, re] of [
  [401, /utente o password non accettati dalla console/i],
  [403, /permessi sull'app Network.*verifica in due passaggi.*account locale senza 2FA/i],
  [429, /la console ha bloccato i tentativi: riprova fra qualche minuto/i],
] as const) {
  test(`utente locale: login ${status} → «auth» col messaggio giusto, UN solo tentativo, niente logout né letture`, async () => {
    const { factory, calls } = consoleFinta({ login: json(status, { code: "X", message: "no" }) });
    const client = createUnifiClient(CFG, memoryStore(), { transportFactory: factory });
    const r = await client.probe();
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.reason, "auth");
      assert.match(r.message, re);
      assert.doesNotMatch(r.message, new RegExp(PASSWORD));
    }
    assert.deepEqual(percorsi(calls), ["POST /api/auth/login"]);
    // Anche la lettura degli apparati (il giro pianificato) prova una volta sola.
    calls.length = 0;
    await assert.rejects(client.listDevices(), (e: unknown) => e instanceof UnifiApiError && re.test(e.message));
    assert.deepEqual(percorsi(calls), ["POST /api/auth/login"]);
  });
}

// Revisione del 16/10: un 404 (o un rinvio) al login di una «console UniFi
// OS» vuol dire che l'indirizzo non è una console (es. Network Application
// classica su :8443 scelta come UDM); il messaggio diceva «per una console
// UniFi OS il tipo è udm», cioè il tipo già scelto.
for (const res of [json(404, {}), { status: 302, headers: { location: "/manage" }, body: "" }] as UnifiHttpResponse[]) {
  test(`utente locale: login ${res.status} → «non è una console UniFi OS, il tipo è self-hosted», un solo tentativo`, async () => {
    const { factory, calls } = consoleFinta({ login: res });
    const r = await createUnifiClient(CFG, memoryStore(), { transportFactory: factory }).probe();
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.reason, "config");
      assert.match(r.message, /non risponde come console UniFi OS/);
      assert.match(r.message, /self-hosted/);
      assert.doesNotMatch(r.message, /il tipo è «udm»/);
    }
    assert.deepEqual(percorsi(calls), ["POST /api/auth/login"]);
  });
}

// ── self_hosted puntato a una console UniFi OS ───────────────────────────────

const UNIFI_OS_HTML = '<!doctype html><html><head><title>UniFi OS</title></head><body></body></html>';

test("self_hosted su una console UniFi OS: il login fallisce e il messaggio dice di scegliere UDM", async () => {
  const calls: UnifiHttpRequest[] = [];
  const factory: UnifiTransportFactory = (_base, pins) => async (req) => {
    checkPresentedPin(pins, PIN);
    calls.push(req);
    if (req.method === "GET" && req.path === "/") return { status: 200, headers: {}, body: UNIFI_OS_HTML };
    return json(404, {});
  };
  const r = await createUnifiClient(
    { url: CFG.url, kind: "self_hosted", site: "default", username: "rgadmin", password: PASSWORD },
    memoryStore(),
    { transportFactory: factory },
  ).probe();
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.message, /Questo indirizzo è una console UniFi OS: scegli UDM/);
  assert.deepEqual(percorsi(calls), ["POST /api/login", "GET /"]);
  assert.equal(calls[1].headers.Cookie, undefined, "la domanda «sei UniFi OS?» parte senza credenziali");
  assert.equal(calls[1].body, undefined);
});

test("self_hosted vero con password sbagliata: il messaggio resta quello delle credenziali", async () => {
  const factory: UnifiTransportFactory = () => async (req) => {
    if (req.method === "GET" && req.path === "/") return { status: 302, headers: { location: "/manage" }, body: "" };
    return json(400, { meta: { rc: "error", msg: "api.err.Invalid" }, data: [] });
  };
  const r = await createUnifiClient(
    { url: "https://10.99.0.10:8443", kind: "self_hosted", site: "default", username: "map", password: PASSWORD },
    memoryStore(),
    { transportFactory: factory },
  ).probe();
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.message, /Credenziali del controller rifiutate/);
});

test("detectUnifiOs: true solo per il titolo «UniFi OS»; errori di rete = false (resta l'errore di prima)", async () => {
  const con = (res: UnifiHttpResponse | Error): UnifiTransportFactory => () => async () => {
    if (res instanceof Error) throw res;
    return res;
  };
  assert.equal(await detectUnifiOs(CFG.url, { transportFactory: con({ status: 200, headers: {}, body: UNIFI_OS_HTML }) }), true);
  assert.equal(await detectUnifiOs(CFG.url, { transportFactory: con({ status: 302, headers: {}, body: "" }) }), false);
  assert.equal(
    await detectUnifiOs(CFG.url, { transportFactory: con({ status: 200, headers: {}, body: "<title>UniFi Network</title>" }) }),
    false,
  );
  assert.equal(await detectUnifiOs(CFG.url, { transportFactory: con(new Error("ECONNREFUSED")) }), false);
  assert.equal(await detectUnifiOs("http://x", { transportFactory: con({ status: 200, headers: {}, body: UNIFI_OS_HTML }) }), false);
});

// Revisione del 16/10: la GET / anonima partiva sul trasporto nudo, fuori da
// ogni cancello; ora passa da `anonymousProbe`, che ammette solo quella.
test("anonymousProbe: passa SOLO GET / senza corpo e senza intestazioni oltre Accept", async () => {
  const sent: UnifiHttpRequest[] = [];
  const gate = anonymousProbe(async (req) => {
    sent.push(req);
    return { status: 200, headers: {}, body: "" };
  });
  await gate({ method: "GET", path: "/", headers: { Accept: "text/html" }, timeoutMs: 1000 });
  const rifiutate: Array<Omit<UnifiHttpRequest, "timeoutMs">> = [
    { method: "GET", path: "/api/self/sites", headers: {} },
    { method: "GET", path: "/proxy/network/api/s/default/stat/device", headers: {} },
    { method: "POST", path: "/", headers: {} },
    { method: "GET", path: "/", headers: {}, body: "x" },
    { method: "GET", path: "/", headers: { Cookie: "TOKEN=x" } },
    { method: "GET", path: "/", headers: { cookie: "TOKEN=x" } },
    { method: "GET", path: "/", headers: { "X-API-KEY": "k" } },
    { method: "GET", path: "/", headers: { "X-CSRF-Token": "c" } },
    { method: "GET", path: "/", headers: { Authorization: "Bearer x" } },
  ];
  for (const req of rifiutate) {
    await assert.rejects(gate({ ...req, timeoutMs: 1000 }), (e: unknown) => e instanceof UnifiApiError, JSON.stringify(req));
  }
  assert.equal(sent.length, 1, "solo la GET / anonima arriva al trasporto");
});
