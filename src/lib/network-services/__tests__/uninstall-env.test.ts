process.env.ENCRYPTION_KEY ||= "test-encryption-key-mod19-netsvc";

/**
 * MOD-19, revisione del 12/10: la conferma di «Disinstalla» di Network Services
 * prometteva «la voce sparisce dal menu e si cancellano URL e token del
 * bridge». Falso sulle appliance dove il bridge viene dalle variabili
 * d'ambiente NET_SERVICES_API_URL e NET_SERVICES_API_TOKEN (le scrive
 * scripts/appliance-integrate-fix.sh nel compose): uninstallNetServices mette
 * enabled=0 e config_json=NULL, e getNetServicesState ripiega sull'ambiente,
 * quindi il modulo resta attivo con lo stesso bridge.
 *
 * Queste prove eseguono install e disinstallazione vere sul database dell'hub
 * (in una cartella temporanea) e controllano che lo stato dica da dove viene
 * la configurazione, e che la conferma dica la verità in ciascun caso. Se la
 * tappa 7 (MOD-5) fa prevalere la disinstallazione sull'ambiente, la terza
 * prova fallisce e il testo va aggiornato insieme.
 */
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { getHubDb } from "@/lib/db-hub";
import {
  getNetServicesState,
  installNetServices,
  uninstallNetServices,
  NET_SERVICES_FEATURE_KEY,
} from "@/lib/network-services/feature";
import {
  netServicesUninstallConfirmText,
  NET_SERVICES_ENV_NOTE,
} from "@/lib/modules/uninstall-copy";

const T = "TESTMOD19NETSVC";
const ENV_URL = "https://192.0.2.53:8443";
const ENV_TOKEN = "token-ambiente-di-prova";
const SAVED = {
  url: process.env.NET_SERVICES_API_URL,
  token: process.env.NET_SERVICES_API_TOKEN,
};

function setEnv(on: boolean) {
  if (on) {
    process.env.NET_SERVICES_API_URL = ENV_URL;
    process.env.NET_SERVICES_API_TOKEN = ENV_TOKEN;
  } else {
    delete process.env.NET_SERVICES_API_URL;
    delete process.env.NET_SERVICES_API_TOKEN;
  }
}

afterEach(() => {
  uninstallNetServices(T);
  getHubDb()
    .prepare("DELETE FROM tenant_features WHERE tenant_code = ? AND feature_key = ?")
    .run(T, NET_SERVICES_FEATURE_KEY);
  if (SAVED.url === undefined) delete process.env.NET_SERVICES_API_URL;
  else process.env.NET_SERVICES_API_URL = SAVED.url;
  if (SAVED.token === undefined) delete process.env.NET_SERVICES_API_TOKEN;
  else process.env.NET_SERVICES_API_TOKEN = SAVED.token;
});

test("senza variabili d'ambiente: la disinstallazione spegne il modulo, come dice la conferma", async () => {
  setEnv(false);
  installNetServices(T, null, { apiUrl: "https://192.0.2.52:8443", apiToken: "token-salvato-qui" });
  const prima = await getNetServicesState(T);
  assert.equal(prima.source, "database");
  assert.equal(prima.envFallback, false);

  uninstallNetServices(T);
  const dopo = await getNetServicesState(T);
  assert.equal(dopo.enabled, false);
  assert.equal(dopo.source, null);

  const testo = netServicesUninstallConfirmText(prima.envFallback);
  assert.match(testo, /sparisce dal menu/);
  assert.match(testo, /si cancellano URL e token/);
});

test("bridge solo dalle variabili d'ambiente: lo stato lo dice", async () => {
  setEnv(true);
  const s = await getNetServicesState(T);
  assert.equal(s.enabled, true);
  assert.equal(s.configured, true);
  assert.equal(s.apiUrl, ENV_URL);
  assert.equal(s.source, "env");
  assert.equal(s.envFallback, true);
  // Al posto di «Disinstalla» la card dice da dove viene e come si spegne.
  assert.match(NET_SERVICES_ENV_NOTE, /NET_SERVICES_API_URL/);
  assert.match(NET_SERVICES_ENV_NOTE, /da qui non si disinstalla/);
});

test("bridge salvato qui e variabili d'ambiente presenti: dopo la disinstallazione il modulo resta attivo, e la conferma lo dice", async () => {
  setEnv(true);
  installNetServices(T, null, { apiUrl: "https://192.0.2.52:8443", apiToken: "token-salvato-qui" });
  const prima = await getNetServicesState(T);
  assert.equal(prima.source, "database");
  assert.equal(prima.envFallback, true);

  uninstallNetServices(T);
  const dopo = await getNetServicesState(T);
  assert.equal(dopo.enabled, true, "l'ambiente lo riaccende: la conferma non può dire che la voce sparisce");
  assert.equal(dopo.apiUrl, ENV_URL);
  assert.equal(dopo.source, "env");

  const testo = netServicesUninstallConfirmText(prima.envFallback);
  assert.doesNotMatch(testo, /sparisce dal menu/);
  assert.match(testo, /resta attivo/);
  assert.match(testo, /NET_SERVICES_API_URL/);
});
