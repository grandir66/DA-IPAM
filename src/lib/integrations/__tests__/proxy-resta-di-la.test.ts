/**
 * Secondo giro di sicurezza, 16/11/2026. Due cose sul passaggio verso Wazuh e LibreNMS:
 * - l'indirizzo chiesto resta sul sistema configurato. Un percorso che dopo il prefisso comincia con `//altro`
 *   veniva risolto come un altro host: oggi lo ferma solo Next, che normalizza le barre doppie prima di arrivare
 *   qui (visto dal vivo: 308). Il passaggio non deve dipendere da quello.
 * - il sistema di là non può scrivere nel browser un cookie col nome di quelli di sessione di DA-IPAM.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildUpstreamUrl, setCookieAmmesso } from "../reverse-proxy";

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
