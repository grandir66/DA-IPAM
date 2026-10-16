// Verifica «apertura per il browser» (passo 4b, 16/10/2026): server HTTPS finti
// su 127.0.0.1 con certificati generati sul momento. Ogni caso del piano ha il
// suo esito, mai «ok» per sbaglio: certificato non fidato, nome errato, scaduto,
// login richiesto, riquadro bloccato da X-Frame-Options o da CSP frame-ancestors.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:https";
import type { AddressInfo } from "node:net";
import type { IncomingMessage, ServerResponse } from "node:http";
import { X509Certificate } from "node:crypto";
import {
  frameAncestors,
  giudicaRiquadro,
  sorgenteAmmette,
  verificaApertura,
} from "../apertura-browser";
import { autoritaFinta, certificatoFinto, type CertificatoFinto } from "./certificati-finti";

const CA = autoritaFinta();
const GIORNO = 86_400_000;

const servers: Server[] = [];
after(() => {
  for (const s of servers) {
    s.closeAllConnections();
    s.close();
  }
});

type Gestore = (req: IncomingMessage, res: ServerResponse) => void;

const PAGINA = "<!doctype html><title>Interfaccia</title><p>ciao</p>";
const LOGIN = '<!doctype html><form action="/login" method="post"><input name="username"><input type="password" name="password"></form>';

const pagina: Gestore = (_req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(PAGINA);
};

async function avvia(cert: CertificatoFinto, gestore: Gestore = pagina): Promise<string> {
  const srv = createServer(cert, gestore);
  servers.push(srv);
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
  return `https://127.0.0.1:${(srv.address() as AddressInfo).port}/`;
}

const fidato = () => certificatoFinto({ cn: "appliance", nomi: ["127.0.0.1", "appliance.local"], firmatoDa: CA });
const impronta = (c: CertificatoFinto) => new X509Certificate(c.cert).fingerprint256;

test("certificato fidato, nome giusto, in date: si apre", async () => {
  const url = await avvia(fidato());
  const v = await verificaApertura({ etichetta: "UI", url, modo: "scheda", loginProprio: true, ca: [CA.cert] });
  assert.equal(v.esito, "ok", v.spiegazione);
  assert.deepEqual(v.problemi, []);
  assert.equal(v.stato, 200);
  assert.equal(v.istruzioneCertificato, undefined);
});

test("autofirmato: certificato non fidato, con l'impronta da confrontare e l'istruzione per accettarlo", async () => {
  const cert = certificatoFinto({ cn: "appliance", nomi: ["127.0.0.1"] });
  const url = await avvia(cert);
  const v = await verificaApertura({ etichetta: "UI", url, modo: "scheda", loginProprio: true });
  assert.equal(v.esito, "certificato_non_fidato");
  assert.deepEqual(v.problemi, ["certificato_non_fidato"]);
  assert.equal(v.certificato?.autofirmato, true);
  assert.equal(v.certificato?.impronta256, impronta(cert));
  assert.match(v.istruzioneCertificato ?? "", new RegExp(impronta(cert)));
  assert.match(v.istruzioneCertificato ?? "", /CA interna di DA-Link/);
  assert.match(v.spiegazione, /autofirmato/i);
  // La pagina dietro l'avviso è stata letta comunque (come dopo «accetta»).
  assert.equal(v.stato, 200);
});

test("nome errato: il certificato non contiene il nome con cui si apre", async () => {
  const url = await avvia(certificatoFinto({ cn: "altro", nomi: ["altro.example"], firmatoDa: CA }));
  const v = await verificaApertura({ etichetta: "UI", url, modo: "scheda", loginProprio: true, ca: [CA.cert] });
  assert.equal(v.esito, "nome_errato");
  assert.deepEqual(v.problemi, ["nome_errato"]);
  assert.deepEqual(v.certificato?.nomi, ["altro.example"]);
  assert.match(v.spiegazione, /127\.0\.0\.1/);
  assert.match(v.spiegazione, /altro\.example/);
});

test("autofirmato E col nome sbagliato: esito principale il nome, tutti e due fra i problemi", async () => {
  const url = await avvia(certificatoFinto({ cn: "altro", nomi: ["altro.example"] }));
  const v = await verificaApertura({ etichetta: "UI", url, modo: "scheda", loginProprio: true });
  assert.equal(v.esito, "nome_errato");
  assert.deepEqual(v.problemi, ["nome_errato", "certificato_non_fidato"]);
});

test("scaduto: esito distinto, anche se firmato da un'autorità fidata", async () => {
  const url = await avvia(
    certificatoFinto({
      cn: "appliance",
      nomi: ["127.0.0.1"],
      firmatoDa: CA,
      dal: new Date(Date.now() - 40 * GIORNO),
      al: new Date(Date.now() - 10 * GIORNO),
    }),
  );
  const v = await verificaApertura({ etichetta: "UI", url, modo: "scheda", loginProprio: true, ca: [CA.cert] });
  assert.equal(v.esito, "scaduto");
  assert.deepEqual(v.problemi, ["scaduto"]);
  assert.match(v.spiegazione, /rigenerato/);
});

test("tre certificati diversi danno tre esiti diversi, mai «ok»", async () => {
  const esiti = new Set<string>();
  for (const cert of [
    certificatoFinto({ cn: "a", nomi: ["127.0.0.1"] }),
    certificatoFinto({ cn: "b", nomi: ["altro.example"], firmatoDa: CA }),
    certificatoFinto({ cn: "c", nomi: ["127.0.0.1"], firmatoDa: CA, al: new Date(Date.now() - GIORNO), dal: new Date(Date.now() - 2 * GIORNO) }),
  ]) {
    const url = await avvia(cert);
    const v = await verificaApertura({ etichetta: "UI", url, modo: "scheda", loginProprio: true, ca: [CA.cert] });
    assert.notEqual(v.esito, "ok");
    esiti.add(v.esito);
  }
  assert.deepEqual([...esiti].sort(), ["certificato_non_fidato", "nome_errato", "scaduto"]);
});

const conLogin: Gestore = (req, res) => {
  if (req.url === "/login") {
    res.setHeader("Content-Type", "text/html");
    res.end(LOGIN);
    return;
  }
  res.statusCode = 302;
  res.setHeader("Location", "/login");
  res.end();
};

test("rinvio al login dove ci si aspetta l'accesso automatico: login richiesto", async () => {
  const url = await avvia(fidato(), conLogin);
  const v = await verificaApertura({ etichetta: "UI", url, modo: "scheda", loginProprio: false, ca: [CA.cert] });
  assert.equal(v.esito, "login_richiesto");
  assert.equal(v.paginaDiLogin, true);
  assert.match(v.rimandaA ?? "", /\/login$/);
});

test("modulo col suo login: arrivare alla pagina di login è normale", async () => {
  const url = await avvia(fidato(), conLogin);
  const v = await verificaApertura({ etichetta: "UI", url, modo: "scheda", loginProprio: true, ca: [CA.cert] });
  assert.equal(v.esito, "ok");
  assert.equal(v.paginaDiLogin, true);
  assert.match(v.spiegazione, /login del modulo/);
});

test("login riconosciuto dal contenuto (200 con campo password), senza rinvio", async () => {
  const url = await avvia(fidato(), (_req, res) => {
    res.setHeader("Content-Type", "text/html");
    res.end(LOGIN);
  });
  const v = await verificaApertura({ etichetta: "UI", url, modo: "scheda", loginProprio: false, ca: [CA.cert] });
  assert.equal(v.esito, "login_richiesto");
});

test("X-Frame-Options: DENY blocca il riquadro, non la scheda", async () => {
  const url = await avvia(fidato(), (_req, res) => {
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Content-Type", "text/html");
    res.end(PAGINA);
  });
  const riquadro = await verificaApertura({
    etichetta: "UI", url, modo: "riquadro", loginProprio: true, ca: [CA.cert], origineDaIpam: "https://appliance.local",
  });
  assert.equal(riquadro.esito, "iframe_bloccato");
  assert.match(riquadro.spiegazione, /X-Frame-Options: DENY/);
  const scheda = await verificaApertura({ etichetta: "UI", url, modo: "scheda", loginProprio: true, ca: [CA.cert] });
  assert.equal(scheda.esito, "ok");
});

test("CSP frame-ancestors: blocca l'origine non ammessa e dice quali sono ammesse", async () => {
  const url = await avvia(fidato(), (_req, res) => {
    res.setHeader("Content-Security-Policy", "default-src 'self'; frame-ancestors 'self' https://10.0.0.1");
    // frame-ancestors vince su X-Frame-Options.
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Content-Type", "text/html");
    res.end(PAGINA);
  });
  const perNome = await verificaApertura({
    etichetta: "Sessione", url, modo: "riquadro", loginProprio: true, ca: [CA.cert], origineDaIpam: "https://appliance.local",
  });
  assert.equal(perNome.esito, "iframe_bloccato");
  assert.deepEqual(perNome.originiAmmesse, ["'self'", "https://10.0.0.1"]);
  assert.equal(perNome.origineDaIpam, "https://appliance.local");
  assert.match(perNome.spiegazione, /frame-ancestors/);

  const perIp = await verificaApertura({
    etichetta: "Sessione", url, modo: "riquadro", loginProprio: true, ca: [CA.cert], origineDaIpam: "https://10.0.0.1",
  });
  assert.equal(perIp.esito, "ok", perIp.spiegazione);
});

test("risposta JSON 401: l'URL porta all'API, non all'interfaccia", async () => {
  const url = await avvia(fidato(), (_req, res) => {
    res.statusCode = 401;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "unauthorized" }));
  });
  const v = await verificaApertura({ etichetta: "UI", url, modo: "scheda", loginProprio: true, ca: [CA.cert] });
  assert.equal(v.esito, "risposta_api");
});

test("porta chiusa: non raggiungibile, con il motivo", async () => {
  const url = await avvia(fidato());
  const porta = new URL(url).port;
  const srv = servers.pop()!;
  srv.closeAllConnections();
  await new Promise<void>((r) => srv.close(() => r()));
  const v = await verificaApertura({ etichetta: "UI", url: `https://127.0.0.1:${porta}/`, modo: "scheda", loginProprio: true });
  assert.equal(v.esito, "non_raggiungibile");
  assert.match(v.spiegazione, /ECONNREFUSED/);
});

test("URL non valido: nessun indirizzo, nessuna chiamata", async () => {
  const v = await verificaApertura({ etichetta: "UI", url: "/api/integrations/librenms/sso", modo: "scheda", loginProprio: true });
  assert.equal(v.esito, "senza_url");
});

// ── Parti pure ───────────────────────────────────────────────────────────────

test("frame-ancestors: lettura delle sorgenti da una o più policy", () => {
  assert.deepEqual(frameAncestors("default-src 'self'; frame-ancestors 'self' https://a"), [["'self'", "https://a"]]);
  assert.deepEqual(frameAncestors(["frame-ancestors 'none'", "script-src x"]), [["'none'"]]);
  assert.deepEqual(frameAncestors(undefined), []);
});

test("sorgenti di frame-ancestors: self, none, *, schema, jolly e porte", () => {
  const ui = new URL("https://appliance.local:4443/");
  const o = (s: string) => new URL(s);
  assert.equal(sorgenteAmmette("'self'", o("https://appliance.local:4443"), ui), true);
  assert.equal(sorgenteAmmette("'self'", o("https://appliance.local"), ui), false, "porta diversa = origine diversa");
  assert.equal(sorgenteAmmette("'none'", o("https://appliance.local"), ui), false);
  assert.equal(sorgenteAmmette("*", o("https://x.example"), ui), true);
  assert.equal(sorgenteAmmette("https:", o("https://x.example"), ui), true);
  assert.equal(sorgenteAmmette("https://appliance.local", o("https://appliance.local"), ui), true);
  assert.equal(sorgenteAmmette("https://appliance.local", o("https://appliance.local:8443"), ui), false);
  assert.equal(sorgenteAmmette("https://appliance.local:*", o("https://appliance.local:8443"), ui), true);
  assert.equal(sorgenteAmmette("https://*.example", o("https://da.example"), ui), true);
  assert.equal(sorgenteAmmette("https://*.example", o("https://example"), ui), false);
  assert.equal(sorgenteAmmette("http://appliance.local", o("https://appliance.local:443"), ui), false, "porta 80 ≠ 443");
});

test("riquadro: SAMEORIGIN ammette solo la stessa origine; http dentro https è contenuto misto", () => {
  const ui = new URL("https://appliance.local:7443/");
  assert.equal(giudicaRiquadro({ "x-frame-options": "SAMEORIGIN" }, ui, new URL("https://appliance.local")).bloccato, true);
  assert.equal(giudicaRiquadro({ "x-frame-options": "SAMEORIGIN" }, ui, new URL("https://appliance.local:7443")).bloccato, false);
  assert.equal(giudicaRiquadro({}, ui, new URL("https://appliance.local")).bloccato, false);
  const misto = giudicaRiquadro({}, new URL("http://appliance.local:9000/"), new URL("https://appliance.local"));
  assert.equal(misto.bloccato, true);
  assert.match(misto.motivo ?? "", /contenuto misto/);
});
