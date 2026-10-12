/**
 * INVARIANTE (T3-26, SEC-6 parte viewer): l'accesso automatico a LibreNMS,
 * che entra con la password admin salvata nell'hub, lo usa solo chi è almeno
 * admin. Per un viewer (o un ruolo sconosciuto) il proxy inoltra senza accesso
 * automatico e senza i cookie di LibreNMS, la rotta di accesso automatico
 * rimanda all'URL diretto, i link portano all'URL diretto e il vault non
 * contiene mai l'URL di accesso automatico.
 *
 * Perché (12/10, tappa 3): il proxy e la rotta /librenms/sso chiedevano solo
 * una sessione: un utente in sola lettura entrava in LibreNMS come admin e
 * poteva amministrarlo.
 *
 * Tre parti: le decisioni con dipendenze finte (contatori sulle chiamate);
 * le rotte e i chiamanti letti dal sorgente (la sessione di NextAuth esiste
 * solo dentro una richiesta di Next); il vault su un hub temporaneo.
 *
 * Run: DA_INVENT_DATA_DIR=$(mktemp -d) node --import tsx --test src/lib/integrations/__tests__/librenms-accesso.test.ts
 */
process.env.ENCRYPTION_KEY ||= "test-encryption-key-librenms-accesso";

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { setSetting } from "@/lib/db-hub";
import { createCredential, listCredentials, syncFromLegacySettings } from "@/lib/credentials-vault";
import {
  LIBRENMS_ACCESSO_AUTOMATICO_PATH,
  eUrlAccessoAutomaticoLibreNMS,
  gestisciAccessoAutomaticoLibreNMS,
  gestisciProxyLibreNMS,
  scegliUrlOperatoreLibreNMS,
  type DipendenzeAccessoAutomaticoLibreNMS,
  type DipendenzeProxyLibreNMS,
} from "../librenms-accesso";

const RADICE = process.cwd();
const URL_DIRETTO = "https://192.168.99.51:7443/";
const COOKIE_ADMIN = "XSRF-TOKEN=eyJpdiI6ImFkbWluIn0%3D; laravel_session=eyJpdiI6InNlc3Npb25lLWFkbWluIn0%3D";
// Cookie del browser: sessione di DA-IPAM più una sessione LibreNMS rimasta da
// un accesso automatico precedente (Path del proxy).
const COOKIE_BROWSER =
  "authjs.session-token=eyJhbGciOiJkaXIifQ..abc; laravel_session=eyJpdiI6InZlY2NoaWEifQ%3D%3D; XSRF-TOKEN=eyJpdiI6InZlY2NoaW8ifQ%3D%3D";

function finte(automaticoAcceso = true) {
  const conta = { attivo: 0, login: 0, allega: 0 };
  const inoltrate: Request[] = [];
  const deps: DipendenzeProxyLibreNMS = {
    accessoAutomaticoAttivo: () => {
      conta.attivo++;
      return automaticoAcceso;
    },
    cookieAccessoAutomatico: async () => {
      conta.login++;
      return COOKIE_ADMIN;
    },
    inoltra: async (req) => {
      inoltrate.push(req);
      return new Response("<html>LibreNMS</html>", { status: 200, headers: { "content-type": "text/html" } });
    },
    allegaCookie: async (resp) => {
      conta.allega++;
      return resp;
    },
  };
  return { conta, inoltrate, deps };
}

const richiesta = (percorso = "/api/integrations/proxy/librenms/devices") =>
  new Request(`https://192.168.99.51:3001${percorso}`, { headers: { cookie: COOKIE_BROWSER } });

const nomiCookie = (req: Request) =>
  (req.headers.get("cookie") ?? "")
    .split(";")
    .map((p) => p.trim().split("=")[0])
    .filter(Boolean);

test("proxy, viewer con accesso automatico acceso: nessun login, nessun cookie di LibreNMS", async () => {
  for (const ruolo of ["viewer", undefined, null, "", "Admin", "operator"]) {
    const { conta, inoltrate, deps } = finte(true);
    const resp = await gestisciProxyLibreNMS(richiesta(), ruolo, deps);
    assert.equal(resp.status, 200);
    assert.equal(conta.login, 0, `ruolo ${String(ruolo)}: accesso automatico chiamato`);
    assert.equal(conta.allega, 0, `ruolo ${String(ruolo)}: cookie allegati`);
    assert.equal(inoltrate.length, 1);
    assert.deepEqual(nomiCookie(inoltrate[0]!), ["authjs.session-token"], `ruolo ${String(ruolo)}`);
  }
});

test("proxy, admin e superadmin: accesso automatico come prima", async () => {
  for (const ruolo of ["admin", "superadmin"]) {
    const { conta, inoltrate, deps } = finte(true);
    const resp = await gestisciProxyLibreNMS(richiesta(), ruolo, deps);
    assert.equal(resp.status, 200);
    assert.equal(conta.login, 1);
    assert.equal(conta.allega, 1);
    const cookie = inoltrate[0]!.headers.get("cookie") ?? "";
    assert.match(cookie, /laravel_session=eyJpdiI6InNlc3Npb25lLWFkbWluIn0%3D/);
    assert.doesNotMatch(cookie, /vecchi/, "la sessione LibreNMS del browser va sostituita");
    assert.match(cookie, /authjs\.session-token=/);
  }
});

test("proxy, admin sulla pagina di login: dopo l'accesso automatico va alla home del proxy", async () => {
  const { inoltrate, deps } = finte(true);
  await gestisciProxyLibreNMS(richiesta("/api/integrations/proxy/librenms/login"), "admin", deps);
  assert.equal(inoltrate.length, 2);
  assert.equal(new URL(inoltrate[1]!.url).pathname, "/api/integrations/proxy/librenms/");
});

test("proxy, admin con accesso automatico spento: inoltra la richiesta com'è, senza login", async () => {
  const { conta, inoltrate, deps } = finte(false);
  await gestisciProxyLibreNMS(richiesta(), "admin", deps);
  assert.equal(conta.login, 0);
  assert.equal(inoltrate.length, 1);
  assert.equal(inoltrate[0]!.headers.get("cookie"), COOKIE_BROWSER, "la sessione LibreNMS dell'admin resta");
});

test("proxy, admin con login non riuscito: 502 senza inoltro", async () => {
  const { inoltrate, deps } = finte(true);
  deps.cookieAccessoAutomatico = async () => null;
  const resp = await gestisciProxyLibreNMS(richiesta(), "admin", deps);
  assert.equal(resp.status, 502);
  assert.equal(inoltrate.length, 0);
});

function finteSso() {
  const conta = { login: 0 };
  const deps: DipendenzeAccessoAutomaticoLibreNMS = {
    accessoAutomaticoAttivo: () => true,
    cookieAccessoAutomatico: async () => {
      conta.login++;
      return COOKIE_ADMIN;
    },
    setCookieDiretti: (c) => c.split(";").map((p) => `${p.trim()}; Path=/; Secure; SameSite=Lax`),
  };
  return { conta, deps };
}

test("rotta di accesso automatico: il viewer va all'URL diretto senza cookie", async () => {
  for (const ruolo of ["viewer", undefined, "sconosciuto"]) {
    const { conta, deps } = finteSso();
    const resp = await gestisciAccessoAutomaticoLibreNMS(URL_DIRETTO, ruolo, deps);
    assert.equal(resp.status, 302);
    assert.equal(resp.headers.get("location"), URL_DIRETTO);
    assert.equal(resp.headers.get("set-cookie"), null);
    assert.equal(conta.login, 0, `ruolo ${String(ruolo)}`);
  }
});

test("rotta di accesso automatico: l'admin entra coi cookie come prima", async () => {
  const { conta, deps } = finteSso();
  const resp = await gestisciAccessoAutomaticoLibreNMS(URL_DIRETTO, "admin", deps);
  assert.equal(resp.status, 302);
  assert.equal(resp.headers.get("location"), URL_DIRETTO);
  assert.match(resp.headers.get("set-cookie") ?? "", /laravel_session=/);
  assert.equal(conta.login, 1);
});

test("URL dei link: diretto per viewer e ruolo sconosciuto, accesso automatico per l'admin", () => {
  let chiesto = 0;
  const acceso = () => {
    chiesto++;
    return true;
  };
  for (const ruolo of ["viewer", undefined, null, "Admin"]) {
    assert.equal(scegliUrlOperatoreLibreNMS(URL_DIRETTO, ruolo, acceso), URL_DIRETTO);
  }
  assert.equal(chiesto, 0, "per chi non è admin non si interroga nemmeno l'accesso automatico");
  assert.equal(scegliUrlOperatoreLibreNMS(URL_DIRETTO, "admin", acceso), LIBRENMS_ACCESSO_AUTOMATICO_PATH);
  assert.equal(scegliUrlOperatoreLibreNMS(URL_DIRETTO, "superadmin", acceso), LIBRENMS_ACCESSO_AUTOMATICO_PATH);
  assert.equal(scegliUrlOperatoreLibreNMS(URL_DIRETTO, "admin", () => false), URL_DIRETTO);
  assert.equal(scegliUrlOperatoreLibreNMS("", "admin", acceso), "");
});

test("riconosce l'URL di accesso automatico, relativo o assoluto", () => {
  assert.equal(eUrlAccessoAutomaticoLibreNMS("/api/integrations/librenms/sso"), true);
  assert.equal(eUrlAccessoAutomaticoLibreNMS("https://192.168.99.51:3001/api/integrations/librenms/sso/"), true);
  assert.equal(eUrlAccessoAutomaticoLibreNMS(URL_DIRETTO), false);
  assert.equal(eUrlAccessoAutomaticoLibreNMS(null), false);
  assert.equal(eUrlAccessoAutomaticoLibreNMS(""), false);
});

// --- rotte e chiamanti, letti dal sorgente ---------------------------------

const leggi = (rel: string) => readFileSync(join(RADICE, rel), "utf8");

test("le rotte passano il ruolo della sessione alle decisioni", () => {
  const proxy = leggi("src/app/api/integrations/proxy/librenms/[[...path]]/route.ts");
  assert.match(proxy, /gestisciProxyLibreNMS\(\s*req,\s*\w+\.user\.role/);
  assert.doesNotMatch(proxy, /librenmsAutologinCookieHeader\(\)/, "il login automatico passa solo dalla decisione");
  const sso = leggi("src/app/api/integrations/librenms/sso/route.ts");
  assert.match(sso, /gestisciAccessoAutomaticoLibreNMS\([^)]*\w+\.user\.role/);
});

test("i link verso LibreNMS si risolvono col ruolo (parametro obbligatorio)", () => {
  const auth = leggi("src/lib/integrations/librenms-proxy-auth.ts");
  assert.match(auth, /export function resolveLibreNMSOperatorUrl\(\s*browserUrl: string,\s*ruolo: unknown\s*\)/);
  for (const rel of ["src/app/api/integrations/active/route.ts", "src/lib/modules/registry.ts"]) {
    const src = leggi(rel);
    for (const m of src.matchAll(/resolveLibreNMSOperatorUrl\(([^)]*)\)/g)) {
      assert.match(m[1]!, /,/, `${rel}: chiamata senza ruolo`);
    }
  }
  const vault = leggi("src/lib/credentials-vault.ts");
  assert.doesNotMatch(vault, /resolveLibreNMSOperatorUrl/, "il vault salva l'URL diretto");
});

// --- vault su hub temporaneo -----------------------------------------------

test("il vault non contiene mai l'URL di accesso automatico", () => {
  setSetting("integration_librenms_mode", "managed");
  setSetting("integration_librenms_url", "http://127.0.0.1:8000");
  setSetting("integration_librenms_ui_url", "https://192.168.99.51:7443");
  setSetting("integration_librenms_api_token", "0123456789abcdef0123456789abcdef");
  setSetting("integration_librenms_admin_password", "Pw-di-prova-123");

  // Voce lasciata da una versione precedente, che salvava l'URL di accesso automatico.
  createCredential({
    kind: "librenms",
    label: "LibreNMS Dashboard (vecchia)",
    url: LIBRENMS_ACCESSO_AUTOMATICO_PATH,
    username: "admin",
    password: "Pw-di-prova-123",
  });

  syncFromLegacySettings();

  const lnms = listCredentials().filter((c) => c.kind === "librenms");
  assert.ok(lnms.length >= 2, "atteso almeno la voce vecchia e la Dashboard");
  for (const c of lnms) {
    assert.equal(eUrlAccessoAutomaticoLibreNMS(c.url), false, `voce «${c.label}»`);
  }
  const vecchia = lnms.find((c) => c.label === "LibreNMS Dashboard (vecchia)");
  assert.equal(vecchia?.url?.replace(/\/+$/, ""), "https://192.168.99.51:7443");
});
