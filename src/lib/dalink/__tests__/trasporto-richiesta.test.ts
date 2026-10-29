/**
 * Vault semplice, passo 6 (piano DA-Link `2026-10-29-vault-passo6-app.md`, S1): `richiestaDalink`, la richiesta
 * generica verso DA-Link sullo stesso socket verificato del segnale di vita.
 *
 * Il gettone del vault è il segreto dell'app: come il token del segnale non deve MAI partire verso un certificato che
 * non è quello della configurazione. Qui la prova sta sul socket: un server TLS grezzo conta i byte di applicazione che
 * riceve dopo l'handshake, e con l'impronta sbagliata devono essere zero.
 *
 * DA-Link finto su 127.0.0.1 col TLS vero e un certificato generato in memoria; la verifica non si spegne mai.
 *
 * Run: node --import tsx --test src/lib/dalink/__tests__/trasporto-richiesta.test.ts
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:https";
import type { AddressInfo } from "node:net";
import { createServer as createTcpServer } from "node:net";
import { createServer as createTlsServer, type Server as TlsServer } from "node:tls";
import { normalizzaImpronta } from "../config";
import { ErroreDalink, richiestaDalink } from "../trasporto";
import { certificatoDiProva } from "./support/certificato";

const GETTONE = "dlv_" + "G".repeat(43);
const server: Array<Server | TlsServer> = [];
after(() => {
  for (const s of server) {
    if ("closeAllConnections" in s) s.closeAllConnections();
    s.close();
  }
});

interface Visto {
  metodo: string;
  url: string;
  auth: string;
  tipo: string;
  corpo: string;
}

async function dalinkFinto(risposta: (v: Visto) => { status: number; body: string }): Promise<{ base: string; impronta: string; visti: Visto[] }> {
  const c = certificatoDiProva("da-link");
  const visti: Visto[] = [];
  const srv = createServer({ key: c.key, cert: c.cert }, (req, res) => {
    let corpo = "";
    req.on("data", (d: Buffer) => (corpo += d.toString("utf8")));
    req.on("end", () => {
      const v = {
        metodo: req.method ?? "",
        url: req.url ?? "",
        auth: String(req.headers.authorization ?? ""),
        tipo: String(req.headers["content-type"] ?? ""),
        corpo,
      };
      visti.push(v);
      const r = risposta(v);
      res.statusCode = r.status;
      res.setHeader("Content-Type", "application/json");
      res.end(r.body);
    });
  });
  server.push(srv);
  await new Promise<void>((ok) => srv.listen(0, "127.0.0.1", ok));
  const { port } = srv.address() as AddressInfo;
  return { base: `https://127.0.0.1:${port}`, impronta: normalizzaImpronta(c.impronta) ?? "", visti };
}

test("GET con l'URL completo (percorso e query) e le intestazioni del chiamante", async () => {
  const d = await dalinkFinto(() => ({ status: 200, body: '{"valori":{},"versione":1}' }));
  const r = await richiestaDalink(new URL(`${d.base}/api/v1/vault/voce?percorso=app%2Fda-ipam%2Fx`), d.impronta, "GET", {
    Authorization: `Bearer ${GETTONE}`,
    Accept: "application/json",
  });
  assert.equal(r.status, 200);
  assert.match(r.body, /versione/);
  assert.equal(d.visti.length, 1);
  assert.equal(d.visti[0].metodo, "GET");
  assert.equal(d.visti[0].url, "/api/v1/vault/voce?percorso=app%2Fda-ipam%2Fx");
  assert.equal(d.visti[0].auth, `Bearer ${GETTONE}`);
  assert.equal(d.visti[0].corpo, "");
});

test("PUT col corpo: arriva intero, col suo Content-Length", async () => {
  const d = await dalinkFinto(() => ({ status: 200, body: '{"versione":2}' }));
  const corpo = JSON.stringify({ percorso: "app/da-ipam/x", valori: { password: "è-ü-ß" }, versione_attesa: 1 });
  const r = await richiestaDalink(new URL(`${d.base}/api/v1/vault/voce`), d.impronta, "PUT", { "Content-Type": "application/json" }, corpo);
  assert.equal(r.status, 200);
  assert.equal(d.visti[0].metodo, "PUT");
  assert.equal(d.visti[0].tipo, "application/json");
  assert.equal(d.visti[0].corpo, corpo);
});

test("DELETE con 204: stato e corpo vuoto", async () => {
  const d = await dalinkFinto(() => ({ status: 204, body: "" }));
  const r = await richiestaDalink(new URL(`${d.base}/api/v1/vault/voce?percorso=a&versione_attesa=3`), d.impronta, "DELETE", {});
  assert.equal(r.status, 204);
  assert.equal(r.body, "");
  assert.equal(d.visti[0].metodo, "DELETE");
});

test("errore HTTP: si restituisce lo stato, non si lancia", async () => {
  const d = await dalinkFinto(() => ({ status: 401, body: '{"detail":"gettone mancante o non valido"}' }));
  const r = await richiestaDalink(new URL(`${d.base}/api/v1/vault/ambito`), d.impronta, "GET", {});
  assert.equal(r.status, 401);
});

test("impronta sbagliata: errore di certificato e sul socket non arriva nemmeno un byte dopo l'handshake", async () => {
  const c = certificatoDiProva("da-link");
  let byteRicevuti = 0;
  let connessioni = 0;
  const grezzo = createTlsServer({ key: c.key, cert: c.cert }, (s) => {
    s.on("data", (d: Buffer) => (byteRicevuti += d.length));
    s.on("error", () => undefined);
  });
  // La connessione TCP; l'handshake dal lato del client lo prova l'errore «cert» (ha letto il certificato).
  grezzo.on("connection", () => (connessioni += 1));
  grezzo.on("tlsClientError", () => undefined);
  server.push(grezzo);
  await new Promise<void>((ok) => grezzo.listen(0, "127.0.0.1", ok));
  const { port } = grezzo.address() as AddressInfo;
  const altra = `sha256/${Buffer.alloc(32, 9).toString("base64")}`;
  await assert.rejects(
    richiestaDalink(new URL(`https://127.0.0.1:${port}/api/v1/vault/ambito`), altra, "GET", { Authorization: `Bearer ${GETTONE}` }),
    (e: unknown) => {
      assert.ok(e instanceof ErroreDalink);
      assert.equal(e.tipo, "cert");
      assert.ok(!e.message.includes(GETTONE));
      return true;
    },
  );
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(connessioni, 1, "la premessa: il client si è collegato");
  assert.equal(byteRicevuti, 0, "il gettone è partito su un socket non verificato");
});

test("impronta giusta sullo stesso server grezzo: i byte arrivano (la prova sopra vede davvero i dati)", async () => {
  const c = certificatoDiProva("da-link");
  let ricevuto = "";
  const grezzo = createTlsServer({ key: c.key, cert: c.cert }, (s) => {
    s.on("data", (d: Buffer) => {
      ricevuto += d.toString("utf8");
      if (ricevuto.includes("\r\n\r\n")) s.end("HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}");
    });
    s.on("error", () => undefined);
  });
  server.push(grezzo);
  await new Promise<void>((ok) => grezzo.listen(0, "127.0.0.1", ok));
  const { port } = grezzo.address() as AddressInfo;
  const r = await richiestaDalink(new URL(`https://127.0.0.1:${port}/api/v1/vault/ambito`), normalizzaImpronta(c.impronta) ?? "", "GET", {
    Authorization: `Bearer ${GETTONE}`,
  });
  assert.equal(r.status, 200);
  assert.match(ricevuto, /^GET \/api\/v1\/vault\/ambito HTTP\/1\.1/);
});

test("limite della risposta: di serie 64 KB, alzabile dal chiamante", async () => {
  const d = await dalinkFinto(() => ({ status: 200, body: "x".repeat(70 * 1024) }));
  const url = new URL(`${d.base}/api/v1/vault/ambito`);
  await assert.rejects(richiestaDalink(url, d.impronta, "GET", {}), (e: unknown) => e instanceof ErroreDalink && e.tipo === "risposta");
  const r = await richiestaDalink(url, d.impronta, "GET", {}, undefined, { maxRisposta: 1024 * 1024 });
  assert.equal(r.body.length, 70 * 1024);
});

test("porta chiusa: errore di rete; server muto: errore di tempo", async () => {
  const s = createTcpServer();
  await new Promise<void>((ok) => s.listen(0, "127.0.0.1", ok));
  const { port } = s.address() as AddressInfo;
  await new Promise<void>((ok) => s.close(() => ok()));
  await assert.rejects(richiestaDalink(new URL(`https://127.0.0.1:${port}/x`), `sha256/${"A".repeat(43)}=`, "GET", {}), (e: unknown) => e instanceof ErroreDalink && e.tipo === "rete");

  const muto = createTcpServer(() => {
    /* accetta e tace */
  });
  await new Promise<void>((ok) => muto.listen(0, "127.0.0.1", ok));
  const p2 = (muto.address() as AddressInfo).port;
  try {
    await assert.rejects(
      richiestaDalink(new URL(`https://127.0.0.1:${p2}/x`), `sha256/${"A".repeat(43)}=`, "GET", {}, undefined, { timeoutMs: 300 }),
      (e: unknown) => e instanceof ErroreDalink && e.tipo === "tempo",
    );
  } finally {
    muto.close();
  }
});
