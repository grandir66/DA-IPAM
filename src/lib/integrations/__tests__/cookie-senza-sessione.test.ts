/**
 * Il passaggio verso Wazuh e LibreNMS non porta di là il cookie di sessione di DA-IPAM (analisi del 15/11/2026:
 * arrivava a ogni richiesta, e chi controlla quel server entrava in DA-IPAM da amministratore).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { cookieSenzaSessione } from "../reverse-proxy";

test("i cookie di Auth.js non passano, con ogni prefisso e a pezzi", () => {
  const c = "authjs.session-token=AAA; __Secure-authjs.session-token.0=BBB; __Host-authjs.csrf-token=CCC; next-auth.session-token=DDD; laravel_session=EEE; XSRF-TOKEN=FFF";
  assert.equal(cookieSenzaSessione(c), "laravel_session=EEE; XSRF-TOKEN=FFF");
});

test("senza altri cookie non resta niente", () => {
  assert.equal(cookieSenzaSessione("__Secure-authjs.session-token=AAA"), "");
  assert.equal(cookieSenzaSessione(null), "");
  assert.equal(cookieSenzaSessione("  "), "");
});

test("un cookie col nome simile ma non di Auth.js resta", () => {
  assert.equal(cookieSenzaSessione("mioauthjs.x=1; authjs_altro=2"), "mioauthjs.x=1; authjs_altro=2");
});
