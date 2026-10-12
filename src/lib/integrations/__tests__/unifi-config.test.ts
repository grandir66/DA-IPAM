// Configurazione hub dell'integrazione UniFi (tappa 2, Task 1).
// Hub DB isolato: `support/hub-isolato` va importato PER PRIMO (il perché sta
// lì: assegnato qui in testa, il percorso arrivava tardi e la prova scriveva
// nell'hub condiviso della cartella dati).
import { removeTestHubDb } from "./support/hub-isolato";
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { closeHubDb, getSetting, setSetting } from "@/lib/db-hub";
import { getIntegrationConfig, setIntegrationConfig, unifiCertPinStore } from "../config";
import type { ComponentConfig } from "../types";

const KEYS = [
  "mode", "url", "kind", "site", "username", "password", "api_token", "cert_pin",
].map((k) => `integration_unifi_${k}`);

beforeEach(() => {
  for (const k of KEYS) setSetting(k, "");
});

after(() => {
  closeHubDb();
  removeTestHubDb();
});

test("nasce spenta: modo disabled, controller self_hosted, site default, nessun pin", () => {
  const cfg = getIntegrationConfig("unifi");
  assert.equal(cfg.mode, "disabled");
  assert.equal(cfg.kind, "self_hosted");
  assert.equal(cfg.site, "default");
  assert.equal(cfg.certPin, undefined);
});

test("salva e rilegge url, kind, site, utente; la password resta cifrata nel DB", () => {
  setIntegrationConfig("unifi", {
    mode: "external",
    url: " https://10.99.0.10:8443 ",
    kind: "self_hosted",
    site: " 3oumjv0i ",
    username: " map ",
    password: "s3gret0 con spazi",
  });
  const cfg = getIntegrationConfig("unifi");
  assert.equal(cfg.mode, "external");
  assert.equal(cfg.url, "https://10.99.0.10:8443");
  assert.equal(cfg.site, "3oumjv0i");
  assert.equal(cfg.username, "map");
  assert.equal(cfg.password, "s3gret0 con spazi");
  assert.equal(cfg.browserUrl, "https://10.99.0.10:8443");
  const raw = getSetting("integration_unifi_password") ?? "";
  assert.match(raw, /^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/i, "la password deve essere cifrata");
  assert.ok(!raw.includes("s3gret0"));
});

test("password e token in sola scrittura: un campo vuoto non cancella quello salvato", () => {
  setIntegrationConfig("unifi", { password: "prima", apiToken: "tok-1" });
  setIntegrationConfig("unifi", { password: "", apiToken: "   " });
  const cfg = getIntegrationConfig("unifi");
  assert.equal(cfg.password, "prima");
  assert.equal(cfg.apiToken, "tok-1");
});

test("fail-closed: un mode inatteso nel DB (managed, vuoto) vale disabled", () => {
  setSetting("integration_unifi_mode", "managed");
  assert.equal(getIntegrationConfig("unifi").mode, "disabled");
  setSetting("integration_unifi_mode", "");
  assert.equal(getIntegrationConfig("unifi").mode, "disabled");
});

test("un kind sconosciuto nel DB vale self_hosted", () => {
  setSetting("integration_unifi_kind", "boh");
  assert.equal(getIntegrationConfig("unifi").kind, "self_hosted");
});

test("il pin si salva in forma canonica sha256/<base64>", () => {
  unifiCertPinStore.set("  AAAAbbbbCCCC=  \n");
  assert.equal(unifiCertPinStore.get(), "sha256/AAAAbbbbCCCC=");
  assert.equal(getIntegrationConfig("unifi").certPin, "sha256/AAAAbbbbCCCC=");
});

test("il PUT generico non scrive il pin: il rinnovo è un'azione esplicita", () => {
  unifiCertPinStore.set("sha256/PRIMO=");
  setIntegrationConfig("unifi", { certPin: "sha256/ALTRO=" } as Partial<ComponentConfig>);
  assert.equal(unifiCertPinStore.get(), "sha256/PRIMO=");
});

test("stesso controller (barra finale, maiuscole) → il pin resta", () => {
  setIntegrationConfig("unifi", { url: "https://10.99.0.10:8443" });
  unifiCertPinStore.set("sha256/PRIMO=");
  setIntegrationConfig("unifi", { url: "https://10.99.0.10:8443/" });
  assert.equal(unifiCertPinStore.get(), "sha256/PRIMO=");
});

test("controller diverso → il pin si azzera (primo uso nuovo, non 'certificato cambiato')", () => {
  setIntegrationConfig("unifi", { url: "https://10.99.0.10:8443" });
  unifiCertPinStore.set("sha256/PRIMO=");
  setIntegrationConfig("unifi", { url: "https://10.99.0.11:8443" });
  assert.equal(unifiCertPinStore.get(), null);
});

test("controller diverso senza password nuova: quella salvata si cancella, non parte verso un host mai verificato", () => {
  setIntegrationConfig("unifi", { url: "https://10.99.0.10:8443", username: "map", password: "vera" });
  // Una cifra sbagliata, o un server di chi non conosce la password: il pin è
  // azzerato e il primo certificato che arriva sarebbe accettato.
  setIntegrationConfig("unifi", { url: "https://10.99.0.11:8443", username: "map" });
  assert.equal(getIntegrationConfig("unifi").password, "");
});

test("controller diverso con la password nella stessa richiesta: vale quella nuova", () => {
  setIntegrationConfig("unifi", { url: "https://10.99.0.10:8443", password: "vecchia" });
  setIntegrationConfig("unifi", { url: "https://10.99.0.11:8443", password: "nuova" });
  assert.equal(getIntegrationConfig("unifi").password, "nuova");
});

test("stesso controller (barra finale, maiuscole): la password resta", () => {
  setIntegrationConfig("unifi", { url: "https://10.99.0.10:8443", password: "vera" });
  setIntegrationConfig("unifi", { url: "HTTPS://10.99.0.10:8443/", site: "default" });
  assert.equal(getIntegrationConfig("unifi").password, "vera");
});

test("l'impronta si salva solo per il controller configurato adesso", () => {
  setIntegrationConfig("unifi", { url: "https://10.99.0.10:8443/" });
  assert.equal(unifiCertPinStore.matchesOrigin?.("https://10.99.0.10:8443"), true);
  assert.equal(unifiCertPinStore.matchesOrigin?.("https://10.99.0.11:8443"), false);
});

test("le chiavi unifi non toccano quelle di graylog", () => {
  setSetting("integration_graylog_username", "admin-graylog");
  setIntegrationConfig("unifi", { username: "map" });
  assert.equal(getSetting("integration_graylog_username"), "admin-graylog");
});
