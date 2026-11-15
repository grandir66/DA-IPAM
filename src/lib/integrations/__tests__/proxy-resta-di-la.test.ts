/**
 * Secondo giro di sicurezza, 16/11/2026. Due cose sul passaggio verso Wazuh e LibreNMS:
 * - l'indirizzo chiesto resta sul sistema configurato. Un percorso che dopo il prefisso comincia con `//altro`
 *   veniva risolto come un altro host: oggi lo ferma solo Next, che normalizza le barre doppie prima di arrivare
 *   qui (visto dal vivo: 308). Il passaggio non deve dipendere da quello.
 * - il sistema di là non può scrivere nel browser un cookie col nome di quelli di sessione di DA-IPAM.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildUpstreamUrl, intestazioniVersoDiLa, setCookieAmmesso } from "../reverse-proxy";

const OPZ = { upstreamOrigin: "https://librenms.interno:8443", basePath: "/api/integrations/proxy/librenms", insecureTls: true };

test("un percorso con la barra doppia resta sul sistema configurato", () => {
  const u = buildUpstreamUrl("https://ipam/api/integrations/proxy/librenms//altrove.example/x?a=1", OPZ);
  assert.equal(u.host, "librenms.interno:8443");
  assert.equal(u.search, "?a=1");
});

test("un percorso normale arriva com'era", () => {
  const u = buildUpstreamUrl("https://ipam/api/integrations/proxy/librenms/device/12?tab=porte", OPZ);
  assert.equal(u.href, "https://librenms.interno:8443/device/12?tab=porte");
  assert.equal(buildUpstreamUrl("https://ipam/api/integrations/proxy/librenms", OPZ).href, "https://librenms.interno:8443/");
});

test("di là non si scrive un cookie di sessione di DA-IPAM", () => {
  assert.equal(setCookieAmmesso("__Secure-authjs.session-token=XXX; Path=/; Secure"), false);
  assert.equal(setCookieAmmesso("authjs.csrf-token=XXX; Path=/"), false);
  assert.equal(setCookieAmmesso("laravel_session=YYY; Path=/; HttpOnly"), true);
});

/**
 * Visto dal vivo il 16/11/2026 sull'appliance di laboratorio (cattura del traffico verso LibreNMS): la richiesta
 * arrivava di là con un'intestazione `set-cookie` che portava il cookie di sessione di DA-IPAM appena rinnovato.
 * La mette Next sulla richiesta quando il controllo d'accesso rinnova la sessione; il taglio del 15/11 guardava
 * solo `cookie`. In una richiesta `set-cookie` non ha senso: non passa mai, e nemmeno le intestazioni interne di Next.
 */
test("verso di là non passano set-cookie né le intestazioni interne di Next", () => {
  const h = new Headers({
    "set-cookie": "__Secure-authjs.session-token=SEGRETO; Path=/; HttpOnly",
    "x-middleware-set-cookie": "__Secure-authjs.session-token=SEGRETO",
    "x-middleware-request-cookie": "__Secure-authjs.session-token=SEGRETO",
    cookie: "__Secure-authjs.session-token=SEGRETO; laravel_session=LNMS",
    authorization: "Bearer X",
    accept: "text/html",
    host: "ipam",
  });
  const fuori = intestazioniVersoDiLa(h);
  assert.equal(JSON.stringify(fuori).includes("SEGRETO"), false);
  assert.deepEqual(fuori, { cookie: "laravel_session=LNMS", accept: "text/html" });
});
