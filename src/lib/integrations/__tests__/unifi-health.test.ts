// Sonda di salute del controller UniFi per «Stato moduli» (tappa 2, Task 7 e
// correzione 8): è il test di connessione, con tre differenze volute.
// - Non fissa mai l'impronta del certificato: la gira chiunque apra la
//   dashboard, e fidarsi di un certificato è una scelta dell'amministratore.
//   Senza impronta fissata non contatta il controller (la password non parte
//   verso un certificato mai visto) e lo dice.
// - Non logga sul controller a ogni apertura della dashboard: il risultato si
//   tiene qualche minuto, salvo «Verifica» (force) o configurazione cambiata.
// - Ha un tetto di tempo: la dashboard non aspetta i timeout del client.
// Niente rete: trasporto finto sulla risposta vera di stat/device (fixture).
// Hub DB isolato: `support/hub-isolato` va importato PER PRIMO (il perché sta lì).
import { removeTestHubDb } from "./support/hub-isolato";
import fs from "node:fs";
import path from "node:path";
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { closeHubDb, setSetting } from "@/lib/db-hub";
import { getIntegrationConfig, setIntegrationConfig, unifiCertPinStore } from "../config";
import { checkPresentedPin, type UnifiHttpRequest, type UnifiHttpResponse, type UnifiTransportFactory } from "../unifi-api";
import { composeUnifiHealth, isUnifiConfigured, readUnifiHealth, resetUnifiHealthMemo } from "../unifi-health";
import type { ComponentConfig } from "../types";

const STAT_BODY = fs.readFileSync(path.join(__dirname, "fixtures", "unifi-stat-device.json"), "utf-8");
const PIN = `sha256/${Buffer.alloc(32, 7).toString("base64")}`;
const ALTRO_PIN = `sha256/${Buffer.alloc(32, 9).toString("base64")}`;

const KEYS = ["mode", "url", "kind", "site", "username", "password", "api_token", "cert_pin"].map(
  (k) => `integration_unifi_${k}`,
);

beforeEach(() => {
  for (const k of KEYS) setSetting(k, "");
  resetUnifiHealthMemo();
});

after(() => {
  closeHubDb();
  removeTestHubDb();
});

function ok(body: unknown, headers: Record<string, string | string[]> = {}): UnifiHttpResponse {
  return { status: 200, headers, body: JSON.stringify(body) };
}

function controllerFinto(
  opts: { pin?: string; login?: UnifiHttpResponse; hang?: boolean } = {},
): { factory: UnifiTransportFactory; calls: UnifiHttpRequest[] } {
  const calls: UnifiHttpRequest[] = [];
  const factory: UnifiTransportFactory = (_base, pins) => async (req) => {
    // Come il trasporto vero: l'impronta si controlla prima di mandare la richiesta.
    checkPresentedPin(pins, opts.pin ?? PIN);
    calls.push(req);
    if (opts.hang) return new Promise<UnifiHttpResponse>(() => {});
    if (req.path === "/api/login") {
      return (
        opts.login ??
        ok({ meta: { rc: "ok" }, data: [] }, { "set-cookie": ["unifises=S1; Path=/; Secure", "csrf_token=C1; Path=/"] })
      );
    }
    if (req.path === "/api/logout") return ok({ meta: { rc: "ok" }, data: [] });
    return { status: 200, headers: {}, body: STAT_BODY };
  };
  return { factory, calls };
}

function configuraController(extra: Partial<ComponentConfig> = {}): void {
  setIntegrationConfig("unifi", {
    mode: "external",
    url: "https://10.99.0.10:8443",
    kind: "self_hosted",
    site: "default",
    username: "map",
    password: "segreto-di-prova",
    ...extra,
  });
}

// ── Senza contatto ───────────────────────────────────────────────────────────

test("spenta: «Non configurato», non un errore (configured=false), niente rete", async () => {
  const { factory, calls } = controllerFinto();
  const r = await readUnifiHealth({ clientOptions: { transportFactory: factory } });
  assert.equal(r.configured, false);
  assert.equal(r.detail, "Non configurato");
  assert.equal(r.repair, null);
  assert.equal(calls.length, 0);
});

test("accesa ma incompleta: dice cosa manca, niente rete", async () => {
  setIntegrationConfig("unifi", { mode: "external" });
  const { factory, calls } = controllerFinto();
  const r = await readUnifiHealth({ clientOptions: { transportFactory: factory } });
  assert.equal(r.configured, true);
  assert.equal(r.verdict, "fail");
  assert.match(r.detail, /mancano l'indirizzo, l'utente e la password/);
  assert.equal(r.repair, "reconfigure_unifi");
  assert.equal(calls.length, 0);
  assert.equal(isUnifiConfigured(getIntegrationConfig("unifi")), false);
});

test("tipo udm o cloud: «non ancora supportato», niente rete", async () => {
  for (const kind of ["udm", "cloud"] as const) {
    configuraController({ kind, apiToken: "tok" });
    unifiCertPinStore.set(PIN);
    const { factory, calls } = controllerFinto();
    const r = await readUnifiHealth({ force: true, clientOptions: { transportFactory: factory } });
    assert.equal(r.verdict, "fail");
    assert.match(r.detail, /non ancora supportat/);
    assert.equal(calls.length, 0, kind);
  }
});

test("completa ma mai provata: non contatta il controller e non fissa l'impronta", async () => {
  configuraController();
  assert.equal(isUnifiConfigured(getIntegrationConfig("unifi")), true);
  const { factory, calls } = controllerFinto();
  const r = await readUnifiHealth({ force: true, clientOptions: { transportFactory: factory } });
  assert.equal(r.verdict, "degraded");
  assert.match(r.detail, /Prova connessione/);
  assert.equal(calls.length, 0, "la password non deve partire verso un certificato mai visto");
  assert.equal(unifiCertPinStore.get(), null);
});

// ── Con contatto ─────────────────────────────────────────────────────────────

test("impronta fissata e controller che risponde: ok, apparati contati, impronta intatta", async () => {
  configuraController();
  unifiCertPinStore.set(PIN);
  const { factory, calls } = controllerFinto();
  const r = await readUnifiHealth({ clientOptions: { transportFactory: factory } });
  assert.equal(r.verdict, "ok");
  assert.equal(r.reachable, true);
  assert.equal(r.authOk, true);
  assert.equal(r.detail, "4 apparati letti dal controller");
  assert.deepEqual(
    calls.map((c) => `${c.method} ${c.path}`),
    ["POST /api/login", "GET /api/s/default/stat/device", "POST /api/logout"],
  );
  assert.equal(unifiCertPinStore.get(), PIN);
  assert.doesNotMatch(JSON.stringify(r), /segreto-di-prova/);
});

test("certificato cambiato: errore esplicito con l'azione sul certificato, impronta intatta", async () => {
  configuraController();
  unifiCertPinStore.set(PIN);
  const { factory, calls } = controllerFinto({ pin: ALTRO_PIN });
  const r = await readUnifiHealth({ clientOptions: { transportFactory: factory } });
  assert.equal(r.verdict, "fail");
  assert.equal(r.repair, "check_unifi_cert");
  assert.match(r.detail, /Certificato del controller cambiato/);
  assert.equal(calls.length, 0, "nessuna richiesta parte verso il certificato diverso");
  assert.equal(unifiCertPinStore.get(), PIN);
});

test("credenziali rifiutate: raggiungibile ma non autenticato", async () => {
  configuraController();
  unifiCertPinStore.set(PIN);
  const login = { status: 400, headers: {}, body: JSON.stringify({ meta: { rc: "error", msg: "api.err.Invalid" }, data: [] }) };
  const r = await readUnifiHealth({ clientOptions: { transportFactory: controllerFinto({ login }).factory } });
  assert.equal(r.verdict, "fail");
  assert.equal(r.reachable, true);
  assert.equal(r.authOk, false);
  assert.equal(r.repair, "reconfigure_unifi");
});

test("controller muto: risposta entro il tetto di tempo, non raggiungibile", async () => {
  configuraController();
  unifiCertPinStore.set(PIN);
  const t0 = Date.now();
  const r = await readUnifiHealth({ timeoutMs: 50, clientOptions: { transportFactory: controllerFinto({ hang: true }).factory } });
  assert.ok(Date.now() - t0 < 2_000);
  assert.equal(r.verdict, "fail");
  assert.equal(r.reachable, false);
  assert.match(r.detail, /entro/);
});

// ── Quante volte si logga sul controller ─────────────────────────────────────

test("il risultato si tiene: niente login a ogni apertura; «Verifica» e config cambiata rileggono", async () => {
  configuraController();
  unifiCertPinStore.set(PIN);
  const { factory, calls } = controllerFinto();
  const o = { clientOptions: { transportFactory: factory } };
  await readUnifiHealth(o);
  await readUnifiHealth(o);
  assert.equal(calls.length, 3, "la seconda lettura viene dal risultato tenuto");
  await readUnifiHealth({ ...o, force: true });
  assert.equal(calls.length, 6, "force rilegge");
  setIntegrationConfig("unifi", { username: "altro" });
  await readUnifiHealth(o);
  assert.equal(calls.length, 9, "con la configurazione cambiata il risultato vecchio non vale");
});

test("compose: spenta vince su tutto, anche con un risultato in mano", () => {
  const cfg = { ...getIntegrationConfig("unifi"), mode: "disabled" as const };
  const r = composeUnifiHealth(cfg, { ok: true, devices: 4, certPin: PIN, certPinRecorded: false });
  assert.equal(r.configured, false);
  assert.equal(r.detail, "Non configurato");
});
