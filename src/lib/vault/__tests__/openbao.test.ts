/**
 * da-vault, passo 5 (piano 2026-10-23): backend `openbao` di `@domarc/vault`. Solo `fetch`, AppRole, token di 20
 * minuti, cache in memoria a tempo che carica la cartella dell'app, `X-Domarc-Utente` per le letture per conto di una
 * persona. Se OpenBao non risponde oltre la durata della cache: errore dichiarato, mai un ripiego muto.
 *
 * Contro un OpenBao finto (`support/openbao-finto.ts`) con l'orologio delle prove: nessun server, nessuna rete.
 *
 * Run: node --import tsx --test src/lib/vault/__tests__/openbao.test.ts
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { OpenBaoStore, DURATA_TOKEN_MS } from "../openbao";
import { ErroreVault } from "../tipi";
import { creaOpenBaoFinto, type OpenBaoFinto } from "./support/openbao-finto";

const MIN = 60_000;
const PASSWORD = "Pw-di-prova-7c1e!";
const TOKEN_API = "tok-di-prova-55aa";

let adesso = Date.parse("2026-10-23T08:00:00Z");
const ora = () => adesso;
let finto: OpenBaoFinto;

function store(extra: Partial<ConstructorParameters<typeof OpenBaoStore>[0]> = {}): OpenBaoStore {
  return new OpenBaoStore({
    url: finto.url,
    roleId: finto.roleId,
    secretId: () => finto.secretId,
    cartelle: ["app/da-ipam"],
    aggiornaOgniMs: 5 * MIN,
    durataCacheMs: 30 * MIN,
    fetch: finto.fetch,
    ora,
    ...extra,
  });
}

/** Tutto quello che passa da console durante `fn`. */
async function console_(fn: () => Promise<unknown>): Promise<string> {
  const righe: string[] = [];
  const orig = { log: console.log, info: console.info, warn: console.warn, error: console.error, debug: console.debug };
  for (const k of Object.keys(orig) as Array<keyof typeof orig>) {
    console[k] = (...a: unknown[]) => { righe.push(a.map((x) => (x instanceof Error ? `${x.message} ${x.stack}` : typeof x === "string" ? x : JSON.stringify(x))).join(" ")); };
  }
  try {
    await fn().catch(() => undefined);
  } finally {
    Object.assign(console, orig);
  }
  return righe.join("\n");
}

async function codiceDi(p: Promise<unknown> | (() => unknown)): Promise<string> {
  try {
    await (typeof p === "function" ? p() : p);
  } catch (e) {
    assert.ok(e instanceof ErroreVault, `atteso ErroreVault, arrivato ${String(e)}`);
    return e.codice;
  }
  return "nessun errore";
}

beforeEach(() => {
  adesso = Date.parse("2026-10-23T08:00:00Z");
  finto = creaOpenBaoFinto({ ora });
  finto.kv.set("app/da-ipam/encryption", { chiave: "chiave-di-prova" });
  finto.kv.set("app/da-ipam/integrazioni/librenms", { token: TOKEN_API, porta: 8090 });
  finto.kv.set("clienti/c1/firewall/ssh", { username: "admin", password: PASSWORD });
});

afterEach(() => {
  finto.giu = false;
});

describe("AppRole e token di 20 minuti", () => {
  it("il primo aggiornamento fa il login AppRole e usa il token nell'intestazione X-Vault-Token", async () => {
    const s = store();
    await s.aggiorna();
    assert.equal(finto.login, 1);
    const login = finto.richieste.find((r) => r.percorso === "/v1/auth/approle/login");
    assert.ok(login);
    assert.deepEqual(JSON.parse(login.corpo ?? "{}"), { role_id: finto.roleId, secret_id: finto.secretId });
    const altre = finto.richieste.filter((r) => r !== login);
    assert.ok(altre.length > 0);
    assert.ok(altre.every((r) => r.token?.startsWith("hvs.")));
  });

  it("il token vale al massimo 20 minuti anche se OpenBao ne concede di più", async () => {
    assert.equal(DURATA_TOKEN_MS, 20 * MIN);
    const s = store();
    await s.aggiorna();
    adesso += 18 * MIN;
    await s.aggiorna();
    assert.equal(finto.login, 1, "a 18 minuti il token vale ancora (si rinnova un minuto prima dei 20)");
    adesso += 3 * MIN;
    await s.aggiorna();
    assert.equal(finto.login, 2, "a 21 minuti serve un login nuovo");
  });

  it("un token più corto di 20 minuti si rinnova alla sua scadenza", async () => {
    finto.ttlSecondi = 600;
    const s = store();
    await s.aggiorna();
    adesso += 9 * MIN + 30_000;
    await s.aggiorna();
    assert.equal(finto.login, 2, "a un minuto dalla scadenza si rifà il login");
  });

  it("un 403 (token revocato) rifà il login una volta e ripete la richiesta", async () => {
    const s = store();
    await s.aggiorna();
    finto.revocaToken();
    assert.deepEqual(await s.get("clienti/c1/firewall/ssh"), { username: "admin", password: PASSWORD });
    assert.equal(finto.login, 2);
  });

  it("role_id o secret_id sbagliati: errore dichiarato, senza il secret_id nel messaggio", async () => {
    const s = store({ secretId: () => "sid-sbagliato-0001" });
    try {
      await s.aggiorna();
      assert.fail("doveva rifiutare");
    } catch (e) {
      assert.ok(e instanceof ErroreVault);
      assert.equal(e.codice, "rifiutato");
      assert.ok(!e.message.includes("sid-sbagliato-0001"));
    }
  });

  it("il file del secret_id manca o non si legge: ErroreVault(configurazione) con messaggio controllato, senza percorso né eccezione grezza", async () => {
    // Il lettore vero (avvio.ts) è `readFileSync`: su un file mancante lancia ENOENT con il percorso nel messaggio.
    const percorso = "/run/credentials/da-ipam.service/openbao-secret-id";
    for (const causa of ["ENOENT", "EACCES"]) {
      const s = store({
        secretId: () => {
          throw Object.assign(new Error(`${causa}: no such file or directory, open '${percorso}'`), { code: causa });
        },
      });
      try {
        await s.aggiorna();
        assert.fail("doveva rifiutare");
      } catch (e) {
        assert.ok(e instanceof ErroreVault, `atteso ErroreVault, arrivato ${String(e)}`);
        assert.equal(e.codice, "configurazione");
        assert.match(e.message, /secret_id/);
        assert.ok(!e.message.includes(percorso) && !e.message.includes("openbao-secret-id") && !e.message.includes(causa), e.message);
      }
    }
    assert.equal(finto.richieste.length, 0, "senza secret_id non deve uscire nessuna richiesta");
  });
});

describe("cache della cartella dell'app", () => {
  it("carica la cartella con le sottocartelle; le letture dopo non chiamano OpenBao", async () => {
    const s = store();
    await s.aggiorna();
    const prima = finto.richieste.length;
    assert.deepEqual(s.leggiSync("app/da-ipam/encryption"), { chiave: "chiave-di-prova" });
    assert.deepEqual(s.leggiSync("app/da-ipam/integrazioni/librenms"), { token: TOKEN_API, porta: "8090" });
    assert.deepEqual(await s.get("app/da-ipam/encryption"), { chiave: "chiave-di-prova" });
    assert.equal(finto.richieste.length, prima, "nessuna richiesta in più: si legge dalla cache");
  });

  it("i percorsi in più (i riferimenti delle credenziali) entrano nella cache", async () => {
    const s = store({ percorsiExtra: () => ["clienti/c1/firewall/ssh"] });
    await s.aggiorna();
    assert.deepEqual(s.leggiSync("clienti/c1/firewall/ssh"), { username: "admin", password: PASSWORD });
  });

  it("un percorso che non è in cache: non_trovato, senza leggere quel percorso da OpenBao (parte solo il giro di ricarica)", async () => {
    // Revisione PR #50 di DA-Vul-can, portata qui: la mancanza fa partire un giro di cache, mai una lettura diretta.
    const s = store();
    await s.aggiorna();
    const prima = finto.richieste.length;
    assert.equal(await codiceDi(() => s.leggiSync("clienti/c1/firewall/ssh")), "non_trovato");
    await new Promise((r) => setTimeout(r, 20));
    const nuove = finto.richieste.slice(prima);
    assert.ok(nuove.every((r) => !r.percorso.endsWith("/data/clienti/c1/firewall/ssh")), "lettura diretta del percorso mancante");
  });

  it("prima del primo caricamento la lettura dalla cache è non_pronto", async () => {
    const s = store();
    assert.equal(await codiceDi(() => s.leggiSync("app/da-ipam/encryption")), "non_pronto");
    assert.equal(s.stato().pronto, false);
  });

  it("un segreto cambiato in OpenBao si vede al giro successivo", async () => {
    const s = store();
    await s.aggiorna();
    finto.kv.set("app/da-ipam/encryption", { chiave: "chiave-nuova" });
    adesso += 5 * MIN;
    await s.aggiorna();
    assert.deepEqual(s.leggiSync("app/da-ipam/encryption"), { chiave: "chiave-nuova" });
  });

  it("un segreto tolto da OpenBao sparisce dalla cache al giro successivo", async () => {
    const s = store();
    await s.aggiorna();
    finto.kv.delete("app/da-ipam/encryption");
    await s.aggiorna();
    assert.equal(await codiceDi(() => s.leggiSync("app/da-ipam/encryption")), "non_trovato");
  });
});

describe("OpenBao che non risponde: cache a tempo, poi errore dichiarato", () => {
  it("entro la durata della cache si legge il valore di prima e lo stato lo dice (degradato)", async () => {
    const s = store();
    await s.aggiorna();
    finto.giu = true;
    adesso += 10 * MIN;
    await assert.rejects(s.aggiorna(), (e: unknown) => e instanceof ErroreVault && e.codice === "non_raggiungibile");
    assert.deepEqual(s.leggiSync("app/da-ipam/encryption"), { chiave: "chiave-di-prova" });
    const st = s.stato();
    assert.equal(st.pronto, true);
    assert.ok(st.pronto && st.degradato && /non risponde/.test(st.degradato));
  });

  it("oltre la durata della cache: leggiSync e get lanciano non_raggiungibile, lo stato non è pronto", async () => {
    const s = store();
    await s.aggiorna();
    finto.giu = true;
    adesso += 31 * MIN;
    assert.equal(await codiceDi(() => s.leggiSync("app/da-ipam/encryption")), "non_raggiungibile");
    assert.equal(await codiceDi(s.get("app/da-ipam/encryption")), "non_raggiungibile");
    const st = s.stato();
    assert.equal(st.pronto, false);
    assert.ok(!st.pronto && /OpenBao non risponde/.test(st.motivo));
  });

  it("OpenBao torna: il primo giro buono riapre la cache", async () => {
    const s = store();
    await s.aggiorna();
    finto.giu = true;
    adesso += 31 * MIN;
    assert.equal(s.stato().pronto, false);
    finto.giu = false;
    await s.aggiorna();
    assert.deepEqual(s.leggiSync("app/da-ipam/encryption"), { chiave: "chiave-di-prova" });
    assert.equal(s.stato().pronto, true);
  });

  it("mai caricato e OpenBao giù: get è non_raggiungibile", async () => {
    finto.giu = true;
    const s = store();
    assert.equal(await codiceDi(s.get("app/da-ipam/encryption")), "non_raggiungibile");
  });
});

describe("letture per conto di una persona", () => {
  it("get con perConto manda X-Domarc-Utente e va sempre a OpenBao", async () => {
    const s = store({ percorsiExtra: () => ["clienti/c1/firewall/ssh"] });
    await s.aggiorna();
    const prima = finto.richieste.length;
    assert.deepEqual(await s.get("clienti/c1/firewall/ssh", { perConto: "mario.rossi" }), { username: "admin", password: PASSWORD });
    const nuove = finto.richieste.slice(prima);
    assert.equal(nuove.length, 1);
    assert.equal(nuove[0].utente, "mario.rossi");
    assert.equal(nuove[0].percorso, "/v1/kv-domarc/data/clienti/c1/firewall/ssh");
  });

  it("le letture dell'app non mandano X-Domarc-Utente", async () => {
    const s = store();
    await s.aggiorna();
    await s.get("clienti/c1/firewall/ssh");
    assert.ok(finto.richieste.every((r) => r.utente === null));
  });

  it("con OpenBao giù una lettura per conto non ripiega sulla cache", async () => {
    const s = store({ percorsiExtra: () => ["clienti/c1/firewall/ssh"] });
    await s.aggiorna();
    finto.giu = true;
    assert.equal(await codiceDi(s.get("clienti/c1/firewall/ssh", { perConto: "mario.rossi" })), "non_raggiungibile");
  });

  it("un nome utente con a capo non entra nell'intestazione", async () => {
    const s = store();
    await s.aggiorna();
    assert.equal(await codiceDi(s.get("clienti/c1/firewall/ssh", { perConto: "mario\r\nX-Altro: 1" })), "configurazione");
  });
});

describe("scrittura, elenco, cancellazione", () => {
  it("put scrive nel KV v2, list dà i percorsi completi, delete toglie", async () => {
    const s = store();
    await s.put("clienti/c2/switch/snmp", { community: "comm-prova" });
    assert.deepEqual(finto.kv.get("clienti/c2/switch/snmp"), { community: "comm-prova" });
    assert.deepEqual(await s.list("clienti"), ["clienti/c1/firewall/ssh", "clienti/c2/switch/snmp"]);
    await s.delete("clienti/c2/switch/snmp");
    assert.equal(finto.kv.has("clienti/c2/switch/snmp"), false);
    assert.deepEqual(await s.list("clienti/c9"), []);
  });

  it("un percorso non valido è rifiutato prima di chiamare OpenBao", async () => {
    const s = store();
    for (const p of ["../sys/seal", "/clienti/c1", "Clienti/C1", "clienti//c1", "clienti/c1/../x"]) {
      assert.equal(await codiceDi(s.get(p)), "percorso_non_valido", p);
    }
    assert.equal(finto.richieste.length, 0);
  });
});

describe("log puliti", () => {
  it("nessun valore, token o secret_id nei log, anche negli errori", async () => {
    const s = store({ percorsiExtra: () => ["clienti/c1/firewall/ssh"] });
    const testo = await console_(async () => {
      await s.aggiorna();
      await s.get("clienti/c1/firewall/ssh", { perConto: "mario.rossi" });
      finto.revocaToken();
      await s.get("clienti/c1/firewall/ssh");
      finto.giu = true;
      adesso += 31 * MIN;
      await s.aggiorna().catch((e: unknown) => console.error("aggiornamento fallito", e));
      await s.get("app/da-ipam/encryption").catch((e: unknown) => console.error("lettura fallita", e));
    });
    for (const segreto of [PASSWORD, TOKEN_API, finto.secretId, "chiave-di-prova", "hvs."]) {
      assert.ok(!testo.includes(segreto), `nei log c'è ${segreto.slice(0, 4)}…`);
    }
  });
});
