/**
 * da-vault, ADR 0035: la richiesta HTTP sincrona (worker + Atomics.wait) che usa `OpenBaoStore.putSync/getSync`, provata
 * con un server vero in un processo a parte (il thread che chiama è fermo mentre aspetta, quindi il server non può stare
 * nello stesso processo).
 *
 * Run: node --import tsx --test src/lib/vault/__tests__/fetch-sync.test.ts
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import { fetchSync } from "../fetch-sync";
import { OpenBaoStore } from "../openbao";
import { ErroreVault } from "../tipi";

interface Server {
  figlio: ChildProcess;
  url: string;
  roleId: string;
  secretId: string;
}

function avvia(env: Record<string, string> = {}): Promise<Server> {
  return new Promise((ok, no) => {
    const figlio = spawn(process.execPath, ["--import", "tsx", join(process.cwd(), "src/lib/vault/__tests__/support/serve-finto.ts")], {
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "inherit"],
    });
    let testo = "";
    figlio.stdout?.on("data", (d: Buffer) => {
      testo += d.toString("utf8");
      const i = testo.indexOf("\n");
      if (i >= 0) ok({ figlio, ...(JSON.parse(testo.slice(0, i)) as { url: string; roleId: string; secretId: string }) });
    });
    figlio.on("error", no);
    figlio.on("exit", (c) => no(new Error(`server di prova uscito (${c})`)));
  });
}

let normale: Server;
let lento: Server;

before(async () => {
  normale = await avvia();
  lento = await avvia({ LENTO: "1" });
});

after(() => {
  for (const s of [normale, lento]) {
    s.figlio.removeAllListeners("exit");
    s.figlio.kill();
  }
});

describe("fetchSync (il worker)", () => {
  it("fa la richiesta e dà stato e testo, senza che il thread chiamante torni all'event loop", () => {
    const r = fetchSync(`${normale.url}/v1/auth/approle/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role_id: normale.roleId, secret_id: normale.secretId }),
      timeoutMs: 5000,
    });
    assert.equal(r.status, 200);
    assert.match(r.testo, /client_token/);
  });

  it("uno stato di errore è una risposta, non un'eccezione", () => {
    const r = fetchSync(`${normale.url}/v1/kv-domarc/data/x`, { method: "GET", headers: {}, timeoutMs: 5000 });
    assert.equal(r.status, 403);
  });

  it("connessione rifiutata: ErroreVault non_raggiungibile, subito", () => {
    const t = Date.now();
    assert.throws(
      () => fetchSync("http://127.0.0.1:1/x", { method: "GET", headers: {}, timeoutMs: 5000 }),
      (e: unknown) => e instanceof ErroreVault && e.codice === "non_raggiungibile" && /OpenBao non risponde/.test(e.message),
    );
    assert.ok(Date.now() - t < 4000, "non aspetta il timeout");
  });

  it("server che non risponde: scade al timeout della richiesta e lo dice", () => {
    const t = Date.now();
    assert.throws(
      () => fetchSync(`${lento.url}/x`, { method: "GET", headers: {}, timeoutMs: 700 }),
      (e: unknown) => e instanceof ErroreVault && e.codice === "non_raggiungibile" && /TimeoutError/.test(e.message),
    );
    const durata = Date.now() - t;
    assert.ok(durata >= 600 && durata < 4000, `durata ${durata} ms`);
  });
});

describe("OpenBaoStore.putSync / getSync con il trasporto vero", () => {
  const nuovo = (s: Server, extra: Partial<ConstructorParameters<typeof OpenBaoStore>[0]> = {}) =>
    new OpenBaoStore({ url: s.url, roleId: s.roleId, secretId: () => s.secretId, cartelle: [], ...extra });

  it("scrive, rilegge e il valore c'è anche per una lettura asincrona (un altro percorso HTTP)", async () => {
    const store = nuovo(normale);
    store.putSync("clienti/c1/da-ipam/fw-1", { username: "admin", password: "pw-sync-1" });
    assert.deepEqual({ ...store.getSync("clienti/c1/da-ipam/fw-1") }, { username: "admin", password: "pw-sync-1" });
    const altro = nuovo(normale); // un altro store, un altro token: legge ciò che è davvero in OpenBao
    assert.deepEqual({ ...(await altro.get("clienti/c1/da-ipam/fw-1")) }, { username: "admin", password: "pw-sync-1" });
  });

  it("un segreto che non c'è: non_trovato; OpenBao irraggiungibile: non_raggiungibile", () => {
    assert.throws(() => nuovo(normale).getSync("clienti/c1/da-ipam/non-c-e"), (e: unknown) => e instanceof ErroreVault && e.codice === "non_trovato");
    const giu = new OpenBaoStore({ url: "http://127.0.0.1:1", roleId: "r", secretId: () => "s", cartelle: [] });
    assert.throws(() => giu.putSync("clienti/c1/da-ipam/x-1", { password: "p" }), (e: unknown) => e instanceof ErroreVault && e.codice === "non_raggiungibile");
  });

  it("il login rifiutato (secret_id sbagliato) è un rifiuto dichiarato, senza il secret_id nel messaggio", () => {
    const store = new OpenBaoStore({ url: normale.url, roleId: normale.roleId, secretId: () => "secret-id-sbagliato-xyz", cartelle: [] });
    let messaggio = "";
    try {
      store.putSync("clienti/c1/da-ipam/x-1", { password: "p" });
    } catch (e) {
      messaggio = (e as Error).message;
    }
    assert.match(messaggio, /rifiutato il login AppRole/);
    assert.ok(!messaggio.includes("secret-id-sbagliato-xyz"));
  });
});
