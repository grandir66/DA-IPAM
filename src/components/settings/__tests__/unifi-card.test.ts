/**
 * Card «Controller UniFi» (tappa 2, Task 7 del piano UniFi): la parte pura
 * (modulo, corpo del salvataggio, testi degli esiti) e la vista resa sul
 * server con dati finti nella forma vera delle risposte delle rotte.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  buildUnifiPayload,
  describeUnifiProbe,
  describeUnifiSync,
  isUnifiFormDirty,
  parseUnifiSavedConfig,
  parseUnifiSyncResponse,
  unifiFormFromConfig,
  type UnifiSavedConfig,
} from "../unifi-card-model";
import { UnifiCardView, type UnifiCardViewProps } from "../unifi-card";

const PIN_A = `sha256/${Buffer.alloc(32, 1).toString("base64")}`;
const PIN_B = `sha256/${Buffer.alloc(32, 2).toString("base64")}`;

/** Come risponde GET /api/integrations/unifi a integrazione spenta (stato di fabbrica). */
const GET_SPENTA = {
  component: "unifi",
  config: {
    mode: "disabled",
    url: "",
    apiToken: "",
    containerName: "",
    kind: "self_hosted",
    site: "default",
    username: "",
    browserUrl: "",
    password: "",
    passwordSet: false,
    apiTokenSet: false,
  },
  browserUrl: "",
  containerStatus: null,
};

/** …e a integrazione configurata, con l'impronta fissata. */
const GET_ACCESA = {
  ...GET_SPENTA,
  config: {
    ...GET_SPENTA.config,
    mode: "external",
    url: "https://10.99.0.10:8443",
    site: "3oumjv0i",
    username: "lettore",
    passwordSet: true,
    certPin: PIN_A,
    browserUrl: "https://10.99.0.10:8443",
  },
};

/** Risposta di POST /api/integrations/unifi/sync con avvisi. */
const SYNC_CON_AVVISI = {
  ok: true,
  tenantCode: "T1",
  total: 4,
  added: 3,
  updated: 0,
  skipped: 1,
  skippedReasons: ["AP-9: apparato senza indirizzo IP"],
  portsUpserted: 62,
  neighborsUpserted: 5,
  errors: ["SW-2: zero porte dal controller, il DB ne ha 24: porte lasciate com'erano"],
};

function vista(over: Partial<UnifiCardViewProps> & { saved?: UnifiSavedConfig } = {}): string {
  const saved = over.saved ?? parseUnifiSavedConfig(GET_SPENTA);
  const props: UnifiCardViewProps = {
    isAdmin: true,
    saved,
    form: unifiFormFromConfig(saved),
    busy: null,
    probe: null,
    sync: null,
    pinAction: null,
    onFormChange: () => {},
    onSave: () => {},
    onTest: () => {},
    onSync: () => {},
    onPinAction: () => {},
    onConfirmPinAction: () => {},
    ...over,
  };
  return renderToStaticMarkup(h(UnifiCardView, props));
}

/** Il tag <button> che contiene il testo dato. */
function bottone(html: string, testo: string): string | null {
  for (const m of html.matchAll(/<button[^>]*>[\s\S]*?<\/button>/g)) {
    if (m[0].includes(testo)) return m[0];
  }
  return null;
}

/** Il pulsante col testo dato è fermo (attributo `disabled`, non la classe `disabled:`). */
function fermo(html: string, testo: string): boolean {
  const b = bottone(html, testo);
  assert.ok(b, `manca il pulsante «${testo}»`);
  return /^<button[^>]*\sdisabled=""/.test(b);
}

describe("modulo e salvataggio", () => {
  it("la risposta del GET diventa configurazione salvata, senza segreti", () => {
    const cfg = parseUnifiSavedConfig(GET_ACCESA);
    assert.equal(cfg.mode, "external");
    assert.equal(cfg.passwordSet, true);
    assert.equal(cfg.certPin, PIN_A);
    const form = unifiFormFromConfig(cfg);
    assert.equal(form.password, "");
    assert.equal(isUnifiFormDirty(form, cfg), false);
  });

  it("valori inattesi dal server valgono «spento» e «self-hosted»", () => {
    const cfg = parseUnifiSavedConfig({ config: { mode: "managed", kind: "boh" } });
    assert.equal(cfg.mode, "disabled");
    assert.equal(cfg.kind, "self_hosted");
    assert.equal(cfg.site, "default");
    assert.equal(parseUnifiSavedConfig(null).mode, "disabled");
  });

  it("password e chiave partono solo se scritte", () => {
    const form = unifiFormFromConfig(parseUnifiSavedConfig(GET_ACCESA));
    const body = buildUnifiPayload(form);
    assert.equal("password" in body, false);
    assert.equal("apiToken" in body, false);
    assert.deepEqual(buildUnifiPayload({ ...form, password: " con spazi ", url: " https://x:8443 " }), {
      mode: "external",
      kind: "self_hosted",
      url: "https://x:8443",
      site: "3oumjv0i",
      username: "lettore",
      password: " con spazi ",
    });
  });

  it("una modifica (anche solo la password) rende il modulo da salvare", () => {
    const cfg = parseUnifiSavedConfig(GET_ACCESA);
    const form = unifiFormFromConfig(cfg);
    assert.equal(isUnifiFormDirty({ ...form, password: "nuova" }, cfg), true);
    assert.equal(isUnifiFormDirty({ ...form, mode: "disabled" }, cfg), true);
    assert.equal(isUnifiFormDirty({ ...form, url: `${form.url} ` }, cfg), false);
  });
});

describe("esiti", () => {
  it("prova riuscita al primo collegamento: apparati e certificato fissato", () => {
    const v = describeUnifiProbe({ ok: true, devices: 74, certPin: PIN_A, certPinRecorded: true });
    assert.equal(v.tone, "ok");
    assert.match(v.title, /74 apparati/);
    assert.match(v.detail ?? "", /fissato/);
  });

  it("certificato cambiato: titolo chiaro e le due impronte", () => {
    const v = describeUnifiProbe({
      ok: false,
      reason: "cert",
      message: "Certificato del controller cambiato: …",
      presentedPin: PIN_B,
      expectedPin: PIN_A,
    });
    assert.equal(v.tone, "error");
    assert.equal(v.title, "Certificato del controller cambiato");
    assert.deepEqual(v.pins, { expected: PIN_A, presented: PIN_B });
  });

  it("sync: la risposta di errore (403) non è un resoconto", () => {
    assert.equal(parseUnifiSyncResponse({ error: "Accesso negato" }), null);
  });

  it("sync con avvisi: conteggi in colonne separate, motivi ed errori uno per riga", () => {
    const s = parseUnifiSyncResponse(SYNC_CON_AVVISI);
    assert.ok(s);
    const v = describeUnifiSync(s);
    assert.equal(v.tone, "warning");
    assert.deepEqual(
      v.counts.map((c) => `${c.label}=${c.value}`),
      ["Apparati letti=4", "Aggiunti=3", "Aggiornati=0", "Porte=62", "Vicini=5", "Saltati=1"],
    );
    assert.equal(v.errors.length, 1);
    assert.equal(v.skippedReasons.length, 1);
  });

  it("sync fallita: tono d'errore e «niente è stato scritto»", () => {
    const s = parseUnifiSyncResponse({ ok: false, total: 0, errors: ["Controller UniFi: Controller non raggiungibile"] });
    assert.ok(s);
    const v = describeUnifiSync(s);
    assert.equal(v.tone, "error");
    assert.match(v.title, /niente è stato scritto/);
  });
});

describe("vista resa", () => {
  it("spenta: badge Disattivato, nessun certificato, niente «Sincronizza ora», Salva fermo senza modifiche", () => {
    const html = vista();
    assert.match(html, /Controller UniFi/);
    assert.match(html, /Disattivato/);
    assert.match(html, /Nessun certificato fissato/);
    assert.equal(bottone(html, "Sincronizza ora"), null);
    assert.equal(fermo(html, "Salva"), true);
    assert.equal(fermo(html, "Prova connessione"), false);
    // Modalità e tipo mostrano l'etichetta, non il valore tecnico.
    assert.match(html, /Disattivata/);
    assert.match(html, /Self-hosted \(UniFi Network Application\)/);
  });

  it("accesa: impronta fissata con «Dimentica il certificato», password impostata ma mai mostrata, console", () => {
    const html = vista({ saved: parseUnifiSavedConfig(GET_ACCESA) });
    assert.match(html, />Attivo</);
    assert.ok(html.includes(PIN_A));
    assert.ok(bottone(html, "Dimentica il certificato"));
    assert.match(html, /Impostata: lascia vuoto per non cambiarla/);
    assert.ok(bottone(html, "Sincronizza ora"));
    assert.match(html, /Apri la console del controller/);
  });

  it("modifiche non salvate: prova e sync ferme, con il perché", () => {
    const saved = parseUnifiSavedConfig(GET_ACCESA);
    const html = vista({ saved, form: { ...unifiFormFromConfig(saved), username: "altro" } });
    assert.match(html, /Modifiche non salvate/);
    assert.equal(fermo(html, "Prova connessione"), true);
    assert.equal(fermo(html, "Sincronizza ora"), true);
    assert.equal(fermo(html, "Salva"), false);
  });

  it("certificato cambiato: le due impronte e «Accetta la nuova impronta»", () => {
    const html = vista({
      saved: parseUnifiSavedConfig(GET_ACCESA),
      probe: { ok: false, reason: "cert", message: "Certificato del controller cambiato", presentedPin: PIN_B, expectedPin: PIN_A },
    });
    assert.match(html, /Impronta fissata al primo collegamento/);
    assert.match(html, /Impronta presentata adesso/);
    assert.ok(html.includes(PIN_B));
    assert.ok(bottone(html, "Accetta la nuova impronta"));
  });

  it("resoconto della sync: conteggi, motivi dei saltati ed errori", () => {
    const html = vista({ saved: parseUnifiSavedConfig(GET_ACCESA), sync: parseUnifiSyncResponse(SYNC_CON_AVVISI) });
    assert.match(html, /Sincronizzazione completata, con avvisi/);
    assert.match(html, /Aggiunti<\/dt><dd[^>]*>3</);
    assert.match(html, /Porte<\/dt><dd[^>]*>62</);
    assert.match(html, /Saltati, con il motivo/);
    assert.match(html, /AP-9: apparato senza indirizzo IP/);
    assert.match(html, /SW-2: zero porte/);
  });

  it("utente non amministratore: tutto fermo, nessuna azione sul certificato", () => {
    const html = vista({ isAdmin: false, saved: parseUnifiSavedConfig(GET_ACCESA) });
    assert.match(html, /Solo un amministratore/);
    assert.equal(fermo(html, "Prova connessione"), true);
    assert.equal(fermo(html, "Sincronizza ora"), true);
    assert.equal(bottone(html, "Dimentica il certificato"), null);
  });

  it("tipo cloud: chiave API al posto di indirizzo, utente e password, con l'avviso «non ancora supportato»", () => {
    const saved = parseUnifiSavedConfig(GET_SPENTA);
    const html = vista({ saved, form: { ...unifiFormFromConfig(saved), kind: "cloud" } });
    assert.match(html, /Chiave API/);
    assert.doesNotMatch(html, /Indirizzo del controller/);
    assert.doesNotMatch(html, /unifi-password/);
    assert.match(html, /non è ancora supportato/);
  });
});
