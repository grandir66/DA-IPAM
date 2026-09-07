/**
 * Identità da DA-Auth — le parti pure, senza rete.
 *
 * Run: node --import tsx --test src/lib/__tests__/daauth.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { APPLICAZIONE, cookieDaAuth, urlAccessoDomarc, urlDaAuth } from "../daauth";

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
  const url = urlAccessoDomarc("https://da-ipam.domarc.it/login?domarc=1");
  assert.ok(url.startsWith(`${urlDaAuth()}/?da=ipam&ritorno=`));
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
