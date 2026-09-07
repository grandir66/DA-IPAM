/**
 * Identità da DA-Auth — le parti pure, senza rete.
 *
 * Run: node --import tsx --test src/lib/__tests__/daauth.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  APPLICAZIONE,
  accessoDomarcAttivo,
  cookieDaAuth,
  identitaDaAuth,
  urlAccessoDomarc,
  urlDaAuth,
} from "../daauth";

test("senza DAAUTH_URL l'accesso Domarc non esiste", async () => {
  /*
   * DA-INVENT è installato ANCHE presso i clienti, su appliance che non hanno
   * — e non devono avere — un servizio di autenticazione Domarc da contattare.
   * Quindi la funzione nasce spenta e non ha un valore predefinito: un default
   * puntato su auth.domarc.it farebbe comparire su ogni appliance un bottone
   * che tenta di parlare con un nostro servizio.
   *
   * Questa prova gira in un ambiente dove DAAUTH_URL non è impostata: è lo
   * stato di un'appliance appena installata.
   */
  const prima = process.env.DAAUTH_URL;
  delete process.env.DAAUTH_URL;
  try {
    assert.equal(urlDaAuth(), "");
    assert.equal(accessoDomarcAttivo(), false);
    assert.equal(urlAccessoDomarc(urlDaAuth(), "https://qualsiasi/login"), "");
    // Nemmeno con un cookie in mano si contatta nessuno: se una richiesta
    // arrivasse, non deve partire una connessione verso l'esterno.
    assert.equal(await identitaDaAuth("da_auth=un-cookie-qualunque"), null);
  } finally {
    if (prima === undefined) delete process.env.DAAUTH_URL;
    else process.env.DAAUTH_URL = prima;
  }
});

test("con DAAUTH_URL impostata la funzione si accende", () => {
  const prima = process.env.DAAUTH_URL;
  process.env.DAAUTH_URL = "https://auth.domarc.it/";
  try {
    // La barra finale non deve raddoppiarsi nell'indirizzo costruito.
    assert.equal(urlDaAuth(), "https://auth.domarc.it");
    assert.equal(accessoDomarcAttivo(), true);
  } finally {
    if (prima === undefined) delete process.env.DAAUTH_URL;
    else process.env.DAAUTH_URL = prima;
  }
});

test("il bottone compare solo se il servizio lo dichiara", () => {
  /*
   * La pagina è un componente client e non può leggere `process.env` del
   * server: riceve l'indirizzo da `/api/setup`. Se quella riga sparisse, il
   * bottone non comparirebbe mai (innocuo) — ma se sparisse la condizione,
   * comparirebbe su ogni appliance di cliente, che è il danno.
   */
  const setup = readFileSync(join(process.cwd(), "src/app/api/setup/route.ts"), "utf8");
  assert.ok(setup.includes("daauthUrl"), "/api/setup non dichiara più l'indirizzo");

  const pagina = readFileSync(join(process.cwd(), "src/app/login/page.tsx"), "utf8");
  assert.ok(pagina.includes("{daauthUrl && ("), "il bottone non è più condizionato");
});

test("il cookie si estrae per nome intero, non per somiglianza", () => {
  assert.equal(cookieDaAuth("da_auth=abc123"), "abc123");
  assert.equal(cookieDaAuth("altro=x; da_auth=abc123; terzo=y"), "abc123");
  assert.equal(cookieDaAuth("  da_auth = abc123 "), "abc123");
  // Il caso che una regex generosa sbaglierebbe: un cookie che CONTIENE il
  // nome non è quel cookie.
  assert.equal(cookieDaAuth("non_da_auth=falso"), "");
  assert.equal(cookieDaAuth("da_auth_vecchio=falso"), "");
  assert.equal(cookieDaAuth(""), "");
  assert.equal(cookieDaAuth(null), "");
  assert.equal(cookieDaAuth(undefined), "");
});

test("un cookie senza valore non diventa un cookie valido", () => {
  assert.equal(cookieDaAuth("da_auth="), "");
  assert.equal(cookieDaAuth("da_auth"), "");
});

test("l'indirizzo di accesso porta l'applicazione e il ritorno codificato", () => {
  const url = urlAccessoDomarc("https://auth.domarc.it", "https://da-ipam.domarc.it/login?domarc=1");
  assert.ok(url.startsWith("https://auth.domarc.it/?da=ipam&ritorno="));
  assert.ok(url.includes("https%3A%2F%2Fda-ipam.domarc.it%2Flogin%3Fdomarc%3D1"));
  // Senza codifica il `?domarc=1` verrebbe letto come un parametro di
  // auth.domarc.it e il ritorno arriverebbe troncato.
  assert.ok(!url.endsWith("?domarc=1"));
});

test("la chiave dell'applicazione è quella che DA-Auth conosce", () => {
  // Metà di un invariante che vive in due repo: in DA-Auth la voce si chiama
  // `ipam` (servizio/applicazioni.py). Sbagliarla non dà errore — DA-Auth
  // risponderebbe col ruolo generale invece che con quello di questa
  // applicazione, in silenzio.
  assert.equal(APPLICAZIONE, "ipam");
});

test("il login locale non è stato spento: è la riserva", () => {
  /*
   * Deciso il 2026-09-08. Se DA-Auth si ferma, si deve poter entrare lo
   * stesso: il provider `credentials` con bcrypt resta, e la pagina di
   * accesso continua a mostrare username e password. Una prova che guarda il
   * sorgente perché è una decisione, non un dettaglio: chi un giorno
   * volesse toglierlo deve farlo di proposito, non per pulizia.
   */
  const auth = readFileSync(join(process.cwd(), "src/lib/auth.ts"), "utf8");
  assert.ok(auth.includes('id: "domarc"'), "manca il provider DA-Auth");
  assert.ok(auth.includes("bcrypt.compare"), "il login locale di riserva è sparito");

  const pagina = readFileSync(join(process.cwd(), "src/app/login/page.tsx"), "utf8");
  assert.ok(pagina.includes('name="password"'), "la pagina non offre più la riserva");
  assert.ok(pagina.includes("entraConDomarc"), "la pagina non offre l'accesso Domarc");
});

test("chi arriva da DA-Auth deve esistere anche qui", () => {
  /*
   * Nessun auto-provisioning, come in DA-Auth per gli account Microsoft senza
   * utenza Domarc. Qui conta doppio: una riga creata al volo non avrebbe
   * tenant (inutile) o li avrebbe sbagliati (dannoso). E il ruolo resta
   * quello LOCALE, non quello che dice DA-Auth: i due sistemi parlano
   * vocabolari diversi, e tradurli in silenzio darebbe a qualcuno più
   * permessi di quelli che ha oggi.
   */
  const auth = readFileSync(join(process.cwd(), "src/lib/auth.ts"), "utf8");
  const blocco = auth.slice(auth.indexOf('id: "domarc"'), auth.indexOf('name: "credentials"'));
  assert.ok(blocco.includes("getUserByUsername"), "non cerca l'utenza locale");
  assert.ok(blocco.includes("if (!user)"), "non rifiuta chi non ha utenza qui");
  assert.ok(
    !blocco.includes("identita.role"),
    "il ruolo di DA-Auth non deve sovrascrivere quello locale",
  );
});
