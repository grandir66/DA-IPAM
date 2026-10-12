// Client del controller UniFi (tappa 2, Task 3): pin del certificato,
// sola lettura, classificazione degli errori, flusso login→lettura→logout.
// Nessuna rete verso sistemi veri: un trasporto finto e, per il TLS, un
// controller finto su 127.0.0.1 con certificato generato in memoria.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createServer, type Server } from "node:https";
import type { AddressInfo } from "node:net";
import { generateKeyPairSync, sign } from "node:crypto";
import {
  checkPresentedPin,
  classifyUnifiHttpError,
  createUnifiClient,
  decideCertPin,
  isUnifiRequestAllowed,
  UnifiApiError,
  UNIFI_CERT_CHANGED_MESSAGE,
  type UnifiHttpRequest,
  type UnifiHttpResponse,
  type UnifiPinSession,
  type UnifiTransportFactory,
} from "../unifi-api";
import type { UnifiCertPinStore } from "../types";

const FIXTURE_BODY = fs.readFileSync(path.join(__dirname, "fixtures", "unifi-stat-device.json"), "utf-8");
const PASSWORD = "Pw-Che-Non-Deve-Comparire";
const CFG = { url: "https://10.99.0.10:8443", kind: "self_hosted" as const, site: "3oumjv0i", username: "map", password: PASSWORD };

function memoryStore(initial: string | null = null): UnifiCertPinStore & { value: string | null; writes: number } {
  const s = {
    value: initial,
    writes: 0,
    get: () => s.value,
    set: (p: string) => {
      s.value = p;
      s.writes++;
    },
    clear: () => {
      s.value = null;
    },
  };
  return s;
}

// ── Pin: logica pura ─────────────────────────────────────────────────────────

test("pin: nessuna impronta salvata → si registra quella presentata", () => {
  assert.deepEqual(decideCertPin(null, "sha256/A="), { action: "record", pin: "sha256/A=" });
  assert.deepEqual(decideCertPin("", "sha256/A="), { action: "record", pin: "sha256/A=" });
  assert.deepEqual(decideCertPin("  ", "sha256/A="), { action: "record", pin: "sha256/A=" });
});

test("pin: uguale → si procede; diversa → mismatch con le due impronte", () => {
  assert.deepEqual(decideCertPin("sha256/A=", "sha256/A="), { action: "match", pin: "sha256/A=" });
  assert.deepEqual(decideCertPin("sha256/A=", "sha256/B="), {
    action: "mismatch",
    expected: "sha256/A=",
    presented: "sha256/B=",
  });
});

test("pin in sessione: il primo contatto fissa l'impronta anche per le connessioni successive", () => {
  const pins: UnifiPinSession = { expected: null, recorded: null };
  checkPresentedPin(pins, "sha256/A=");
  assert.deepEqual(pins, { expected: "sha256/A=", recorded: "sha256/A=" });
  checkPresentedPin(pins, "sha256/A=");
  assert.throws(
    () => checkPresentedPin(pins, "sha256/B="),
    (e: unknown) =>
      e instanceof UnifiApiError &&
      e.reason === "cert" &&
      /certificato del controller cambiato/i.test(e.message) &&
      e.presentedPin === "sha256/B=" &&
      e.expectedPin === "sha256/A=",
  );
});

test("pin salvato e certificato diverso → errore esplicito, niente da registrare", () => {
  const pins: UnifiPinSession = { expected: "sha256/A=", recorded: null };
  assert.throws(() => checkPresentedPin(pins, "sha256/B="), UnifiApiError);
  assert.equal(pins.recorded, null);
  assert.equal(pins.expected, "sha256/A=");
});

// ── Sola lettura ─────────────────────────────────────────────────────────────

test("sola lettura: ammessi solo login, logout e stat/device di un site valido", () => {
  assert.equal(isUnifiRequestAllowed("POST", "/api/login"), true);
  assert.equal(isUnifiRequestAllowed("POST", "/api/logout"), true);
  assert.equal(isUnifiRequestAllowed("GET", "/api/s/default/stat/device"), true);
  assert.equal(isUnifiRequestAllowed("GET", "/api/s/3oumjv0i/stat/device"), true);
  for (const [m, p] of [
    ["POST", "/api/s/default/cmd/devmgr"],
    ["PUT", "/api/s/default/rest/device/abc"],
    ["DELETE", "/api/s/default/rest/user/abc"],
    ["POST", "/api/s/default/stat/device"],
    ["GET", "/api/s/../stat/device"],
    ["GET", "/api/s/a%2Fb/stat/device"],
    ["GET", "/api/s/default/stat/sta"],
    ["GET", "/api/login"],
  ] as const) {
    assert.equal(isUnifiRequestAllowed(m, p), false, `${m} ${p} deve essere rifiutata`);
  }
});

// ── Classificazione ──────────────────────────────────────────────────────────

test("classificazione: credenziali, 2FA, site, permessi, percorso, server", () => {
  const login = { step: "login" as const };
  const lettura = { step: "lettura" as const, site: "boh" };
  assert.equal(classifyUnifiHttpError(400, "api.err.Invalid", login).reason, "auth");
  assert.equal(classifyUnifiHttpError(401, null, lettura).reason, "auth");
  assert.equal(classifyUnifiHttpError(403, null, login).reason, "auth");
  assert.equal(classifyUnifiHttpError(429, null, login).reason, "auth");
  assert.match(classifyUnifiHttpError(499, "api.err.Ubic2faTokenRequired", login).message, /due passaggi/);
  const site = classifyUnifiHttpError(400, "api.err.NoSiteContext", lettura);
  assert.equal(site.reason, "config");
  assert.match(site.message, /«boh»/);
  assert.equal(classifyUnifiHttpError(400, "api.err.NoPermission", lettura).reason, "auth");
  assert.equal(classifyUnifiHttpError(404, null, login).reason, "config");
  assert.equal(classifyUnifiHttpError(302, null, login).reason, "config");
  assert.equal(classifyUnifiHttpError(502, null, lettura).reason, "server");
  assert.equal(classifyUnifiHttpError(418, null, lettura).reason, "unknown");
});

// ── Flusso con trasporto finto ───────────────────────────────────────────────

interface FakeOpts {
  presentedPin?: string;
  login?: UnifiHttpResponse;
  stat?: UnifiHttpResponse;
  /** Chiamata mentre si serve stat/device: per cambiare lo stato a metà sessione. */
  duranteLettura?: () => void;
}

function json(status: number, body: unknown, headers: Record<string, string | string[]> = {}): UnifiHttpResponse {
  return { status, headers, body: JSON.stringify(body) };
}

const LOGIN_OK = json(200, { meta: { rc: "ok" }, data: [] }, {
  "set-cookie": ["unifises=SESS1; Path=/; Secure; HttpOnly", "csrf_token=CSRF1; Path=/; Secure"],
});

function fakeController(o: FakeOpts = {}): { factory: UnifiTransportFactory; calls: UnifiHttpRequest[] } {
  const calls: UnifiHttpRequest[] = [];
  const factory: UnifiTransportFactory = (_base, pins) => async (req) => {
    // Come il trasporto vero: l'impronta si controlla prima di mandare la richiesta.
    checkPresentedPin(pins, o.presentedPin ?? "sha256/CONTROLLER=");
    calls.push(req);
    if (req.path === "/api/login") return o.login ?? LOGIN_OK;
    if (req.path === "/api/logout") return json(200, { meta: { rc: "ok" }, data: [] });
    o.duranteLettura?.();
    return o.stat ?? { status: 200, headers: {}, body: FIXTURE_BODY };
  };
  return { factory, calls };
}

test("flusso: login → stat/device con cookie e CSRF → logout; 4 apparati; pin fissato dopo il successo", async () => {
  const store = memoryStore();
  const { factory, calls } = fakeController();
  const devices = await createUnifiClient(CFG, store, { transportFactory: factory }).listDevices();
  assert.equal(devices.length, 4);
  assert.deepEqual(
    calls.map((c) => `${c.method} ${c.path}`),
    ["POST /api/login", "GET /api/s/3oumjv0i/stat/device", "POST /api/logout"],
  );
  assert.deepEqual(JSON.parse(calls[0].body ?? "{}"), { username: "map", password: PASSWORD, remember: false });
  assert.match(calls[1].headers.Cookie, /unifises=SESS1/);
  assert.equal(calls[1].headers["X-CSRF-Token"], "CSRF1");
  assert.equal(calls[2].headers["X-CSRF-Token"], "CSRF1");
  assert.equal(store.value, "sha256/CONTROLLER=");
});

test("il CSRF nell'intestazione della risposta vince sul cookie", async () => {
  const { factory, calls } = fakeController({
    login: { ...LOGIN_OK, headers: { ...LOGIN_OK.headers, "x-csrf-token": "HDR-CSRF" } },
  });
  await createUnifiClient(CFG, memoryStore(), { transportFactory: factory }).listDevices();
  assert.equal(calls[1].headers["X-CSRF-Token"], "HDR-CSRF");
});

test("probe riuscito: numero di apparati e pin registrato al primo uso, poi solo confrontato", async () => {
  const store = memoryStore();
  const { factory } = fakeController();
  const first = await createUnifiClient(CFG, store, { transportFactory: factory }).probe();
  assert.deepEqual(first, { ok: true, devices: 4, certPin: "sha256/CONTROLLER=", certPinRecorded: true });
  const second = await createUnifiClient(CFG, store, { transportFactory: factory }).probe();
  assert.deepEqual(second, { ok: true, devices: 4, certPin: "sha256/CONTROLLER=", certPinRecorded: false });
  assert.equal(store.writes, 1);
});

test("primo uso: se a metà sessione qualcuno fissa un'impronta, la sessione non la sovrascrive", async () => {
  // Una prova riuscita (o un «Dimentica» seguito da una prova) mentre la sync
  // legge: l'impronta verificata dall'amministratore resta.
  const store = memoryStore();
  const { factory } = fakeController({
    duranteLettura: () => {
      store.value = "sha256/VERIFICATA=";
    },
  });
  const r = await createUnifiClient(CFG, store, { transportFactory: factory }).probe();
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.certPinRecorded, false);
  assert.equal(store.value, "sha256/VERIFICATA=");
  assert.equal(store.writes, 0);
});

test("primo uso: se nel frattempo la configurazione punta a un altro controller, l'impronta non si salva", async () => {
  const store = memoryStore();
  let origineConfigurata = "https://10.99.0.10:8443";
  const conOrigine: UnifiCertPinStore = { ...store, set: store.set, matchesOrigin: (o: string) => o === origineConfigurata };
  const { factory } = fakeController({
    duranteLettura: () => {
      origineConfigurata = "https://10.99.0.11:8443"; // l'amministratore cambia indirizzo
    },
  });
  const r = await createUnifiClient(CFG, conOrigine, { transportFactory: factory }).probe();
  assert.equal(r.ok && r.certPinRecorded, false);
  assert.equal(store.value, null);
  // Stesso controller dall'inizio alla fine: si salva.
  origineConfigurata = "https://10.99.0.10:8443";
  const ok = await createUnifiClient(CFG, conOrigine, {
    transportFactory: fakeController().factory,
  }).probe();
  assert.equal(ok.ok && ok.certPinRecorded, true);
  assert.equal(store.value, "sha256/CONTROLLER=");
});

test("lettura fallita: logout fatto lo stesso, errore server, pin NON registrato", async () => {
  const store = memoryStore();
  const { factory, calls } = fakeController({ stat: json(500, { meta: { rc: "error" } }) });
  const r = await createUnifiClient(CFG, store, { transportFactory: factory }).probe();
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.reason, "server");
  assert.equal(calls.at(-1)?.path, "/api/logout");
  assert.equal(store.value, null);
});

test("credenziali rifiutate (400 api.err.Invalid): auth, niente lettura, password mai nel messaggio", async () => {
  const { factory, calls } = fakeController({ login: json(400, { meta: { rc: "error", msg: "api.err.Invalid" }, data: [] }) });
  const r = await createUnifiClient(CFG, memoryStore(), { transportFactory: factory }).probe();
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.reason, "auth");
  assert.equal(calls.length, 1);
  assert.ok(!JSON.stringify(r).includes(PASSWORD));
});

test("site inesistente (rc error NoSiteContext con HTTP 200 o 400) → config col nome del site", async () => {
  for (const status of [200, 400]) {
    const { factory } = fakeController({ stat: json(status, { meta: { rc: "error", msg: "api.err.NoSiteContext" }, data: [] }) });
    const r = await createUnifiClient(CFG, memoryStore(), { transportFactory: factory }).probe();
    assert.equal(r.ok === false && r.reason, "config", `HTTP ${status}`);
    assert.match(r.ok === false ? r.message : "", /3oumjv0i/);
  }
});

test("certificato cambiato: errore esplicito, nessuna richiesta partita, pin vecchio intatto", async () => {
  const store = memoryStore("sha256/VECCHIO=");
  const { factory, calls } = fakeController({ presentedPin: "sha256/NUOVO=" });
  const r = await createUnifiClient(CFG, store, { transportFactory: factory }).probe();
  assert.deepEqual(r, {
    ok: false,
    reason: "cert",
    message: UNIFI_CERT_CHANGED_MESSAGE,
    presentedPin: "sha256/NUOVO=",
    expectedPin: "sha256/VECCHIO=",
  });
  assert.equal(calls.length, 0);
  assert.equal(store.value, "sha256/VECCHIO=");
});

test("backend udm e cloud: «non ancora implementato», nessuna richiesta", async () => {
  for (const kind of ["udm", "cloud"] as const) {
    const { factory, calls } = fakeController();
    const client = createUnifiClient({ ...CFG, kind }, memoryStore(), { transportFactory: factory });
    const r = await client.probe();
    assert.equal(r.ok === false && r.reason, "not_implemented");
    assert.match(r.ok === false ? r.message : "", /non ancora implementato/);
    await assert.rejects(client.listDevices(), (e: unknown) => e instanceof UnifiApiError && e.reason === "not_implemented");
    assert.equal(calls.length, 0);
  }
});

test("configurazione incompleta o insicura → config, nessuna richiesta", async () => {
  const casi = [
    { ...CFG, url: "" },
    { ...CFG, url: "http://10.99.0.10:8443" },
    { ...CFG, url: "non un url" },
    { ...CFG, password: "" },
    { ...CFG, username: " " },
    { ...CFG, site: "../rest" },
  ];
  for (const cfg of casi) {
    const { factory, calls } = fakeController();
    const r = await createUnifiClient(cfg, memoryStore(), { transportFactory: factory }).probe();
    assert.equal(r.ok === false && r.reason, "config", JSON.stringify({ ...cfg, password: "***" }));
    assert.equal(calls.length, 0);
  }
});

test("risposta non JSON (non è un controller) → config, non un crash", async () => {
  const { factory } = fakeController({ login: { status: 200, headers: {}, body: "<html>ciao</html>" } });
  const r = await createUnifiClient(CFG, memoryStore(), { transportFactory: factory }).probe();
  assert.equal(r.ok === false && r.reason, "config");
});

// ── TLS vero su 127.0.0.1: il pin si verifica prima di mandare la password ──

/** Certificato autofirmato minimo (X.509 v1, ECDSA P-256), solo per questa prova. */
function selfSignedCert(cn: string): { key: string; cert: string } {
  const tlv = (tag: number, content: Buffer): Buffer => {
    const n = content.length;
    let len: Buffer;
    if (n < 0x80) len = Buffer.from([n]);
    else {
      const hex = n.toString(16);
      const b = Buffer.from(hex.length % 2 ? `0${hex}` : hex, "hex");
      len = Buffer.concat([Buffer.from([0x80 | b.length]), b]);
    }
    return Buffer.concat([Buffer.from([tag]), len, content]);
  };
  const seq = (...items: Buffer[]): Buffer => tlv(0x30, Buffer.concat(items));
  const ecdsaSha256 = seq(Buffer.from("06082a8648ce3d040302", "hex"));
  const name = seq(tlv(0x31, seq(Buffer.from("0603550403", "hex"), tlv(0x0c, Buffer.from(cn)))));
  const utc = (d: Date): Buffer =>
    tlv(0x17, Buffer.from(`${d.toISOString().replace(/[-:T]/g, "").slice(2, 14)}Z`));
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const now = Date.now();
  const tbs = seq(
    tlv(0x02, Buffer.from([0x01])),
    ecdsaSha256,
    name,
    seq(utc(new Date(now - 3_600_000)), utc(new Date(now + 3_600_000))),
    name,
    publicKey.export({ type: "spki", format: "der" }),
  );
  const der = seq(tbs, ecdsaSha256, tlv(0x03, Buffer.concat([Buffer.from([0]), sign("sha256", tbs, privateKey)])));
  const b64 = der.toString("base64").match(/.{1,64}/g) ?? [];
  return {
    key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    cert: `-----BEGIN CERTIFICATE-----\n${b64.join("\n")}\n-----END CERTIFICATE-----\n`,
  };
}

interface FakeServer {
  url: string;
  seen: string[];
  loginBodies: string[];
}

const servers: Server[] = [];
after(() => {
  for (const s of servers) {
    s.closeAllConnections();
    s.close();
  }
});

async function startFakeController(cn: string): Promise<FakeServer> {
  const seen: string[] = [];
  const loginBodies: string[] = [];
  const srv = createServer(selfSignedCert(cn), (req, res) => {
    let body = "";
    req.on("data", (c: Buffer) => (body += c.toString("utf-8")));
    req.on("end", () => {
      seen.push(`${req.method} ${req.url}`);
      res.setHeader("Content-Type", "application/json");
      if (req.method === "POST" && req.url === "/api/login") {
        loginBodies.push(body);
        res.setHeader("Set-Cookie", ["unifises=TLS-SESS; Path=/; Secure; HttpOnly", "csrf_token=TLS-CSRF; Path=/; Secure"]);
        res.end(JSON.stringify({ meta: { rc: "ok" }, data: [] }));
        return;
      }
      if (req.method === "GET" && req.url === "/api/s/default/stat/device") {
        if (!String(req.headers.cookie ?? "").includes("unifises=TLS-SESS")) {
          res.statusCode = 401;
          res.end(JSON.stringify({ meta: { rc: "error", msg: "api.err.LoginRequired" }, data: [] }));
          return;
        }
        res.end(FIXTURE_BODY);
        return;
      }
      if (req.method === "POST" && req.url === "/api/logout") {
        res.end(JSON.stringify({ meta: { rc: "ok" }, data: [] }));
        return;
      }
      res.statusCode = 404;
      res.end("{}");
    });
  });
  servers.push(srv);
  await new Promise<void>((resolve) => srv.listen(0, "127.0.0.1", resolve));
  const { port } = srv.address() as AddressInfo;
  return { url: `https://127.0.0.1:${port}`, seen, loginBodies };
}

test("TLS vero: primo uso fissa il pin, poi combacia; un altro certificato è rifiutato prima del login", async () => {
  const store = memoryStore();
  const cfg = { url: "", kind: "self_hosted" as const, site: "default", username: "map", password: PASSWORD };

  const a = await startFakeController("controller-a");
  const first = await createUnifiClient({ ...cfg, url: a.url }, store).probe();
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(first.ok && first.devices, 4);
  assert.equal(first.ok && first.certPinRecorded, true);
  assert.match(store.value ?? "", /^sha256\/[A-Za-z0-9+/]+=*$/);
  assert.deepEqual(a.seen, ["POST /api/login", "GET /api/s/default/stat/device", "POST /api/logout"]);
  assert.equal(JSON.parse(a.loginBodies[0]).password, PASSWORD);

  const pinA = store.value;
  const again = await createUnifiClient({ ...cfg, url: a.url }, store).probe();
  assert.equal(again.ok && again.certPinRecorded, false);
  assert.equal(store.value, pinA);

  // Stesso indirizzo logico, certificato diverso (controller sostituito o
  // intercettato): la connessione si chiude prima di qualunque richiesta.
  const b = await startFakeController("controller-b");
  const third = await createUnifiClient({ ...cfg, url: b.url }, store).probe();
  assert.equal(third.ok, false);
  assert.equal(third.ok === false && third.reason, "cert");
  assert.equal(third.ok === false && third.expectedPin, pinA);
  assert.deepEqual(b.seen, [], "il controller sconosciuto non deve ricevere nessuna richiesta");
  assert.equal(b.loginBodies.length, 0);
  assert.equal(store.value, pinA);
});

test("TLS vero: porta chiusa → network, non cert", async () => {
  const a = await startFakeController("chiuso");
  const url = a.url;
  for (const s of servers.splice(servers.length - 1)) {
    s.closeAllConnections();
    await new Promise<void>((resolve) => s.close(() => resolve()));
  }
  const r = await createUnifiClient(
    { url, kind: "self_hosted", site: "default", username: "map", password: PASSWORD },
    memoryStore(),
    { loginTimeoutMs: 3000 },
  ).probe();
  assert.equal(r.ok === false && r.reason, "network", JSON.stringify(r));
});
