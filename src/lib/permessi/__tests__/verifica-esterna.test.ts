/**
 * Verifica dei permessi dal di fuori (T3-30): casi e giudizio.
 *
 * Perché (12/10, tappa 3): il censimento legge il codice, ma un middleware o
 * una rotta che fa qualcosa prima della guardia non si vedono lì. La verifica
 * chiede all'applicazione accesa; questa prova controlla che i casi siano solo
 * letture e che il giudizio riconosca le risposte del codice di prima di
 * T3-25/T3-26 (segreti al viewer, accesso automatico a LibreNMS per il viewer,
 * avanzamento delle installazioni leggibile) come fallimenti. Le risposte finte
 * hanno la forma di quelle vere delle rotte.
 *
 * Run: node --import tsx --test src/lib/permessi/__tests__/verifica-esterna.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { censisci, consentitiDaAuthConfig, eConsentita, gestoriDellAlbero } from "../rotte";
import {
  casiDiVerifica,
  giudica,
  percorsoConcreto,
  riepiloga,
  type Caso,
  type Risposta,
} from "../verifica-esterna";

const RADICE = process.cwd();
const CONSENTITI = consentitiDaAuthConfig(readFileSync(join(RADICE, "src", "lib", "auth.config.ts"), "utf8"));
const { valutazioni } = censisci(gestoriDellAlbero(RADICE).gestori, CONSENTITI);
const CASI = casiDiVerifica(valutazioni, CONSENTITI);

const risposta = (r: Partial<Risposta>): Risposta => ({ status: 200, location: null, setCookie: [], corpo: "", ...r });
const caso = (percorso: string, chi: Caso["chi"] = "viewer"): Caso => {
  const c = CASI.find((x) => x.percorso === percorso && x.chi === chi);
  assert.ok(c, `caso ${chi} ${percorso} mancante`);
  return c;
};

// ---------------------------------------------------------------------------
// Casi
// ---------------------------------------------------------------------------

test("percorsi: segmenti dinamici a 0, «tutto il resto» facoltativo tolto", () => {
  assert.equal(percorsoConcreto("/api/integrations/install-progress/[jobId]"), "/api/integrations/install-progress/0");
  assert.equal(percorsoConcreto("/api/integrations/proxy/wazuh/[[...path]]"), "/api/integrations/proxy/wazuh");
  assert.equal(percorsoConcreto("/api/files/[...path]"), "/api/files/0");
  assert.equal(percorsoConcreto("/api/hosts"), "/api/hosts");
});

test("casi: solo GET, la verifica non scrive", () => {
  assert.ok(CASI.length > 0);
  for (const c of CASI) assert.equal(c.metodo, "GET", `${c.chi} ${c.percorso}`);
});

test("casi: nessuna rotta pubblica fra quelle che l'anonimo deve vedersi rifiutare", () => {
  for (const c of CASI.filter((x) => x.chi === "anonimo")) {
    assert.equal(eConsentita(c.origine, CONSENTITI), false, c.origine);
  }
  // Ogni lettura non pubblica ha il suo caso anonimo.
  const letture = new Set(valutazioni.filter((v) => v.metodo === "GET" && !eConsentita(v.rotta, CONSENTITI)).map((v) => v.rotta));
  const coperte = new Set(CASI.filter((x) => x.chi === "anonimo").map((x) => x.origine));
  assert.deepEqual([...letture].filter((r) => !coperte.has(r)), []);
});

test("casi: il viewer prova solo letture con la guardia admin, mai quelle che gli sono aperte", () => {
  const perRotta = new Map(valutazioni.filter((v) => v.metodo === "GET").map((v) => [v.rotta, v]));
  for (const c of CASI.filter((x) => x.attesa === "rifiuto-viewer")) {
    const v = perRotta.get(c.origine);
    assert.ok(v, c.origine);
    assert.ok(["admin", "admin-o-onboarding", "superadmin"].includes(v.guardia), `${c.origine}: guardia ${v.guardia}`);
  }
  // La prova di connessione è aperta al viewer e contatta l'indirizzo salvato:
  // la verifica non deve chiamarla.
  assert.equal(CASI.some((x) => x.chi === "viewer" && x.origine === "/api/integrations/[component]/test-connection"), false);
});

test("casi: ci sono quelli di SEC-13, SEC-5 e SEC-6", () => {
  assert.equal(caso("/api/integrations/install-progress/0").attesa, "rifiuto-viewer");
  assert.equal(caso("/api/integrations/librenms").attesa, "config-senza-segreti");
  assert.equal(caso("/api/integrations/graylog").attesa, "config-senza-segreti");
  assert.equal(caso("/api/integrations/librenms/sso").attesa, "accesso-automatico-negato");
  assert.equal(caso("/api/settings", "viewer").attesa, "impostazioni-senza-segreti");
});

test("SEC-5: impostazioni dell'hub al viewer — prima con le chiavi dei segreti, ora senza e col segno", () => {
  const c = caso("/api/settings", "viewer");
  const libere = { public_hub_url: "https://hub.esempio.lan", host_linux_credential_id: "3" };
  const prima = risposta({ corpo: JSON.stringify({ ...libere, integration_librenms_admin_password: "pw-finta" }) });
  assert.equal(giudica(c, prima).esito, "ko");
  assert.match(giudica(c, prima).nota, /integration_librenms_admin_password/);
  // Codice di prima su un hub senza segreti salvati: senza il segno non prova niente.
  assert.equal(giudica(c, risposta({ corpo: JSON.stringify(libere) })).esito, "ko");
  assert.equal(giudica(c, risposta({ corpo: JSON.stringify({ ...libere, _segreti_nascosti: "4" }) })).esito, "ok");
  assert.equal(giudica(c, risposta({ status: 403 })).esito, "ko");
});

// ---------------------------------------------------------------------------
// Giudizio: le risposte di prima falliscono, quelle di oggi passano
// ---------------------------------------------------------------------------

test("anonimo: 401 o rinvio a /login passano; 200 fallisce", () => {
  const c = caso("/api/hosts", "anonimo");
  assert.equal(giudica(c, risposta({ status: 401 })).esito, "ok");
  assert.equal(giudica(c, risposta({ status: 307, location: "http://127.0.0.1:3001/login?callbackUrl=%2Fapi%2Fhosts" })).esito, "ok");
  assert.equal(giudica(c, risposta({ status: 307, location: "http://127.0.0.1:3001/altro" })).esito, "ko");
  assert.equal(giudica(c, risposta({ status: 200, corpo: "[]" })).esito, "ko");
});

test("SEC-13: avanzamento d'installazione al viewer — prima 404 (letto oltre la guardia), ora 403", () => {
  const c = caso("/api/integrations/install-progress/0");
  const prima = giudica(c, risposta({ status: 404, corpo: JSON.stringify({ error: "Job non trovato" }) }));
  assert.equal(prima.esito, "ko");
  assert.equal(giudica(c, risposta({ status: 403, corpo: JSON.stringify({ error: "Richiesti privilegi di amministratore" }) })).esito, "ok");
  // Una sessione non valida non vale come prova del ruolo.
  assert.match(giudica(c, risposta({ status: 401 })).nota, /sessione del viewer non è valida/);
});

test("SEC-5: configurazione al viewer — prima coi segreti, ora vuoti coi flag «impostato»", () => {
  const c = caso("/api/integrations/librenms");
  const base = { mode: "managed", url: "http://librenms.local:8000", username: "admin", containerName: "librenms" };
  const prima = risposta({
    corpo: JSON.stringify({ component: "librenms", config: { ...base, apiToken: "tok-finto", password: "pw-finta" }, browserUrl: "", containerStatus: null }),
  });
  assert.match(giudica(c, prima).nota, /apiToken, password/);
  assert.equal(giudica(c, prima).esito, "ko");

  // Codice di prima con i segreti vuoti: passerebbe se si guardassero solo i valori.
  const primaVuota = risposta({ corpo: JSON.stringify({ component: "librenms", config: { ...base, apiToken: "" }, browserUrl: "" }) });
  assert.equal(giudica(c, primaVuota).esito, "ko");

  const ora = risposta({
    corpo: JSON.stringify({
      component: "librenms",
      config: { ...base, apiToken: "", password: "", adminPassword: "", apiTokenSet: true, passwordSet: true, adminPasswordSet: false },
      browserUrl: "",
      containerStatus: null,
    }),
  });
  assert.equal(giudica(c, ora).esito, "ok");
  assert.equal(giudica(c, risposta({ status: 200, corpo: "non json" })).esito, "ko");
  assert.equal(giudica(c, risposta({ status: 403 })).esito, "ko");
});

test("SEC-6: accesso automatico a LibreNMS per il viewer — prima coi cookie, ora rinvio diretto", () => {
  const c = caso("/api/integrations/librenms/sso");
  const prima = risposta({
    status: 302,
    location: "https://librenms.local:7443/",
    setCookie: ["laravel_session=finto; Path=/; HttpOnly", "XSRF-TOKEN=finto; Path=/"],
  });
  assert.equal(giudica(c, prima).esito, "ko");
  assert.equal(giudica(c, risposta({ status: 302, location: "https://librenms.local:7443/" })).esito, "ok");
  // Senza LibreNMS configurato non c'è niente da negare: lo si dice, non è un verde.
  assert.equal(giudica(c, risposta({ status: 404, corpo: "LibreNMS non configurato" })).esito, "non-provato");
});

test("riepilogo: conta gli esiti", () => {
  assert.deepEqual(
    riepiloga([
      { esito: "ok", nota: "" },
      { esito: "ko", nota: "" },
      { esito: "non-provato", nota: "" },
      { esito: "ok", nota: "" },
    ]),
    { ok: 2, ko: 1, "non-provato": 1 },
  );
});
