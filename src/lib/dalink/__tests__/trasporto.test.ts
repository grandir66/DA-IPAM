/**
 * Tappa C1, Task 6: il trasporto verso DA-Link, con l'impronta del certificato.
 *
 * DA-Link presenta un certificato auto-firmato fino alla CA della tappa B: l'autorità
 * è l'impronta SPKI scritta da DA-Link in `oggetto.env`. Il token è il segreto
 * dell'istanza: non deve MAI partire su un socket non verificato. Per questo il pin
 * si controlla prima di scrivere un byte, e la richiesta viaggia sullo stesso socket
 * (non come in `scanner-edge-client.ts`, che verifica e poi apre un secondo socket).
 *
 * DA-Link finto su 127.0.0.1 col TLS vero e un certificato generato in memoria.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:https";
import type { AddressInfo } from "node:net";
import { createServer as createTcpServer } from "node:net";
import { normalizzaImpronta } from "../config";
import { ErroreDalink, postSegnale } from "../trasporto";
import { certificatoDiProva } from "./support/certificato";

const TOKEN = "dlk_" + "T".repeat(43);
const server: Server[] = [];
after(() => {
  for (const s of server) {
    s.closeAllConnections();
    s.close();
  }
});

interface Visto {
  metodo: string;
  url: string;
  auth: string;
  corpo: string;
}

async function dalinkFinto(
  risposta: (v: Visto) => { status: number; body: string },
): Promise<{ url: URL; impronta: string; visti: Visto[] }> {
  const c = certificatoDiProva("da-link.netbird.selfhosted");
  const visti: Visto[] = [];
  const srv = createServer({ key: c.key, cert: c.cert }, (req, res) => {
    let corpo = "";
    req.on("data", (d: Buffer) => (corpo += d.toString("utf8")));
    req.on("end", () => {
      const v = { metodo: req.method ?? "", url: req.url ?? "", auth: String(req.headers.authorization ?? ""), corpo };
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
  return { url: new URL(`https://127.0.0.1:${port}`), impronta: normalizzaImpronta(c.impronta) ?? "", visti };
}

const CORPO = JSON.stringify({ codcli: "99999", nodo: "99999-ipam" });

test("impronta giusta: la richiesta arriva col token e il corpo, si legge la risposta", async () => {
  const d = await dalinkFinto(() => ({ status: 200, body: '{"ricevuto_il":"2026-10-15 09:00:00"}' }));
  const r = await postSegnale(d.url, d.impronta, TOKEN, CORPO);
  assert.equal(r.status, 200);
  assert.match(r.body, /ricevuto_il/);
  assert.equal(d.visti.length, 1);
  assert.equal(d.visti[0].metodo, "POST");
  assert.equal(d.visti[0].url, "/api/v1/segnale");
  assert.equal(d.visti[0].auth, `Bearer ${TOKEN}`);
  assert.equal(d.visti[0].corpo, CORPO);
});

test("impronta sbagliata: errore di certificato e al server non arriva niente", async () => {
  const d = await dalinkFinto(() => ({ status: 200, body: "{}" }));
  const altra = `sha256/${Buffer.alloc(32, 9).toString("base64")}`;
  await assert.rejects(postSegnale(d.url, altra, TOKEN, CORPO), (e: unknown) => {
    assert.ok(e instanceof ErroreDalink);
    assert.equal(e.tipo, "cert");
    assert.ok(!e.message.includes(TOKEN));
    return true;
  });
  assert.equal(d.visti.length, 0, "il token è partito su un socket non verificato");
});

test("il prefisso di percorso dell'URL si tiene", async () => {
  const d = await dalinkFinto(() => ({ status: 200, body: "{}" }));
  const url = new URL(d.url.href + "base/");
  await postSegnale(url, d.impronta, TOKEN, CORPO);
  assert.equal(d.visti[0].url, "/base/api/v1/segnale");
});

test("errore HTTP: si restituisce lo stato, non si lancia", async () => {
  const d = await dalinkFinto(() => ({ status: 403, body: '{"detail":"no"}' }));
  const r = await postSegnale(d.url, d.impronta, TOKEN, CORPO);
  assert.equal(r.status, 403);
});

test("porta chiusa: errore di rete", async () => {
  const s = createTcpServer();
  await new Promise<void>((ok) => s.listen(0, "127.0.0.1", ok));
  const { port } = s.address() as AddressInfo;
  await new Promise<void>((ok) => s.close(() => ok()));
  await assert.rejects(postSegnale(new URL(`https://127.0.0.1:${port}`), `sha256/${"A".repeat(43)}=`, TOKEN, CORPO), (e: unknown) => {
    assert.ok(e instanceof ErroreDalink);
    assert.equal(e.tipo, "rete");
    return true;
  });
});

test("risposta oltre 64 KB: lettura interrotta, errore di risposta", async () => {
  const d = await dalinkFinto(() => ({ status: 200, body: "x".repeat(70 * 1024) }));
  await assert.rejects(postSegnale(d.url, d.impronta, TOKEN, CORPO), (e: unknown) => {
    assert.ok(e instanceof ErroreDalink);
    assert.equal(e.tipo, "risposta");
    return true;
  });
});

test("server che non risponde al TLS: errore di tempo", async () => {
  const muto = createTcpServer(() => {
    /* accetta e tace */
  });
  await new Promise<void>((ok) => muto.listen(0, "127.0.0.1", ok));
  const { port } = muto.address() as AddressInfo;
  try {
    await assert.rejects(
      postSegnale(new URL(`https://127.0.0.1:${port}`), `sha256/${"A".repeat(43)}=`, TOKEN, CORPO, { timeoutMs: 300 }),
      (e: unknown) => {
        assert.ok(e instanceof ErroreDalink);
        assert.equal(e.tipo, "tempo");
        return true;
      },
    );
  } finally {
    muto.close();
  }
});
