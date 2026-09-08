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
  RUOLO_DOMARC_A_LOCALE,
  traduzionePer,
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

test("il ruolo di chi ha già un'utenza NON viene sovrascritto da DA-Auth", () => {
  /*
   * Il ruolo di DA-Auth serve a UNA cosa sola: tradurlo per creare l'utenza
   * che non c'è. Su una che c'è già vale quello locale — chi l'ha messo lì
   * sapeva cosa faceva, e i due vocabolari non si equivalgono. Lo stesso vale
   * per i clienti: si assegnano alla creazione, non a ogni accesso.
   */
  const auth = readFileSync(join(process.cwd(), "src/lib/auth.ts"), "utf8");
  const blocco = auth.slice(auth.indexOf('id: "domarc"'), auth.indexOf('name: "credentials"'));
  assert.ok(blocco.includes("getUserByUsername"), "non cerca l'utenza locale");
  assert.ok(blocco.includes("role: user.role"), "il ruolo restituito non è quello locale");
  // `identita.role` e l'assegnazione dei clienti stanno SOLO nel ramo della
  // creazione: dopo, non si tocca più niente di quello che c'è.
  const creazione = blocco.indexOf("createUser(");
  assert.ok(blocco.lastIndexOf("identita.role") < creazione);
  assert.ok(blocco.lastIndexOf("setUserTenantAccess") > creazione);
});


test("la traduzione dei ruoli è scritta in chiaro, coi clienti per codice", () => {
  // Domarc è l'unico cliente vero qui dentro, e sono due righe dello stesso:
  // `70791` la sede, `70791a` l'infrastruttura a OVH.
  assert.deepEqual(traduzionePer("admin"), { ruolo: "superadmin" });
  assert.deepEqual(traduzionePer("tecnico_advanced"), {
    ruolo: "admin",
    tenant: ["70791", "70791a"],
  });
  assert.deepEqual(traduzionePer("readonly"), { ruolo: "viewer", tenant: ["70791", "70791a"] });
});


test("un ruolo senza traduzione non diventa il più basso: non si traduce", () => {
  /*
   * La tentazione è mappare l'ignoto su «viewer senza clienti» per non
   * bloccare nessuno. Sarebbe un permesso inventato: chi fa un altro mestiere
   * non entra in un inventario di rete per il fatto di lavorare qui. Se serve,
   * lo si dichiara su questa applicazione con un ruolo esplicito — che è
   * esattamente ciò per cui la dichiarazione esiste.
   */
  assert.equal(traduzionePer("standard"), null);
  assert.equal(traduzionePer("commerciale"), null);
  assert.equal(traduzionePer("un-ruolo-nuovo"), null);
  assert.equal(traduzionePer(""), null);
});


test("il superadmin non elenca clienti, e chi li elenca non è superadmin", () => {
  /*
   * `superadmin` vede tutti i tenant per costruzione (auth.ts li ricarica a
   * ogni accesso): elencarglieli sarebbe una lista da tenere allineata a mano
   * il giorno che nasce un cliente nuovo. Gli altri invece DEVONO elencarli,
   * altrimenti entrano e non vedono niente senza che si capisca perché.
   */
  for (const [domarc, t] of Object.entries(RUOLO_DOMARC_A_LOCALE)) {
    if (t.ruolo === "superadmin") {
      assert.equal(t.tenant, undefined, `${domarc}: un superadmin non elenca clienti`);
    } else {
      assert.ok(t.tenant && t.tenant.length > 0, `${domarc}: entrerebbe senza vedere niente`);
    }
  }
});


test("la creazione avviene solo su dichiarazione, e i clienti si risolvono per codice", () => {
  const auth = readFileSync(join(process.cwd(), "src/lib/auth.ts"), "utf8");
  const blocco = auth.slice(auth.indexOf('id: "domarc"'), auth.indexOf('name: "credentials"'));
  const creazione = blocco.indexOf("createUser(");

  assert.ok(blocco.includes("if (!identita.dichiarato)"), "non controlla la dichiarazione");
  // I due rifiuti vengono PRIMA della creazione: invertirli significherebbe
  // creare l'utenza e poi accorgersi che non si doveva.
  assert.ok(blocco.indexOf("if (!identita.dichiarato)") < creazione);
  assert.ok(blocco.indexOf("if (!traduzione)") < creazione);
  // Un codice cliente che non esiste viene saltato, non diventa «tutti».
  assert.ok(blocco.includes("continue"), "un codice sconosciuto non viene saltato");
});
