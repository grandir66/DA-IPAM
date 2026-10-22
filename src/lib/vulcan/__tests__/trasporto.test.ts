/**
 * A-IPAM, Task 5: il trasporto HTTPS verso l'hub DA-Vul-can.
 *
 * Verifica TLS normale (mai `rejectUnauthorized: false`): l'hub vero ha un certificato
 * jolly valido e si fida delle CA di sistema. Qui un hub finto su questa macchina, col
 * TLS vero e un certificato auto-firmato generato in memoria, di cui la prova (e solo
 * lei) si fida passandolo come `ca`. Il gettone non deve MAI partire su un socket non
 * verificato, e nessun messaggio d'errore deve contenere il gettone o la porta.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { createServer, type Server } from "node:https";
import { createServer as createTcpServer, type AddressInfo, type Server as TcpServer } from "node:net";
import { ErroreHub, MAX_RISPOSTA_HUB, chiamaHub, type RichiestaHub } from "../trasporto";
import { certificatoDiProva } from "@/lib/dalink/__tests__/support/certificato";

const TOKEN = "Gt_" + "a1B2c3D4".repeat(7);
const aperti: (Server | TcpServer)[] = [];
after(() => {
  for (const s of aperti) {
    if ("closeAllConnections" in s) s.closeAllConnections();
    s.close();
  }
});

interface Visto {
  metodo: string;
  percorso: string;
  intestazioni: Record<string, string | string[] | undefined>;
  corpo: Buffer;
}

async function hubFinto(
  risposta: (v: Visto) => { status: number; body: string; headers?: Record<string, string> } | null,
  cn = "localhost",
): Promise<{ url: URL; ca: string; visti: Visto[]; porta: number }> {
  const c = certificatoDiProva(cn);
  const visti: Visto[] = [];
  const srv = createServer({ key: c.key, cert: c.cert }, (req, res) => {
    const pezzi: Buffer[] = [];
    req.on("data", (d: Buffer) => pezzi.push(d));
    req.on("end", () => {
      const v = { metodo: req.method ?? "", percorso: req.url ?? "", intestazioni: req.headers, corpo: Buffer.concat(pezzi) };
      visti.push(v);
      const r = risposta(v);
      if (!r) return; // l'hub che non risponde
      res.writeHead(r.status, { "Content-Type": "application/json", ...(r.headers ?? {}) });
      res.end(r.body);
    });
  });
  aperti.push(srv);
  // Senza indirizzo: ascolta su IPv4 e IPv6, così «localhost» arriva comunque.
  await new Promise<void>((ok) => srv.listen(0, ok));
  const { port } = srv.address() as AddressInfo;
  return { url: new URL(`https://localhost:${port}`), ca: c.cert, visti, porta: port };
}

const JSON_AD = JSON.stringify({ codcli: "70791", run_id: 8, findings: [{ id: "x", testo: "àè€" }] });
const GZ = zlib.gzipSync(Buffer.from(JSON_AD, "utf8"));
const sha = (s: string | Buffer) => crypto.createHash("sha256").update(s).digest("hex");

function base(h: { url: URL; ca: string }, extra: Partial<RichiestaHub> = {}): RichiestaHub {
  return { url: h.url, token: TOKEN, versione: "0.9.870", metodo: "POST", percorso: "/api/ipam/ad-health", corpoGz: GZ, ca: h.ca, ...extra };
}

function senzaSegreti(e: unknown, porta: number): ErroreHub {
  assert.ok(e instanceof ErroreHub, `atteso ErroreHub, avuto ${String(e)}`);
  assert.ok(!e.message.includes(TOKEN), "il gettone non sta nel messaggio");
  assert.ok(!e.message.includes(String(porta)), "la porta non sta nel messaggio");
  assert.ok(!e.message.includes("localhost") && !e.message.includes("127.0.0.1"), "l'indirizzo non sta nel messaggio");
  assert.ok(!(e.stack ?? "").includes(TOKEN));
  return e;
}

test("POST: gettone, gzip, versione e corpo decompresso identico (stesso sha256)", async () => {
  const h = await hubFinto(() => ({ status: 201, body: '{"report_id":272}' }));
  const r = await chiamaHub(base(h));
  assert.deepEqual(r, { status: 201, body: '{"report_id":272}' });
  assert.equal(h.visti.length, 1);
  const v = h.visti[0];
  assert.equal(v.metodo, "POST");
  assert.equal(v.percorso, "/api/ipam/ad-health");
  assert.equal(v.intestazioni.authorization, `Bearer ${TOKEN}`);
  assert.equal(v.intestazioni["content-encoding"], "gzip");
  assert.equal(v.intestazioni["content-type"], "application/json");
  assert.equal(v.intestazioni["x-da-ipam-version"], "0.9.870");
  assert.equal(v.intestazioni["content-length"], String(GZ.length));
  const testo = zlib.gunzipSync(v.corpo).toString("utf8");
  assert.equal(testo, JSON_AD);
  assert.equal(sha(testo), sha(JSON_AD));
});

test("GET ping: nessun corpo, nessun Content-Encoding, il gettone sì", async () => {
  const h = await hubFinto(() => ({ status: 200, body: '{"fonte_id":3,"codcli":"70791","nodo":"70791-ipam"}' }));
  const r = await chiamaHub(base(h, { metodo: "GET", percorso: "/api/ipam/ping", corpoGz: undefined }));
  assert.equal(r.status, 200);
  const v = h.visti[0];
  assert.equal(v.metodo, "GET");
  assert.equal(v.percorso, "/api/ipam/ping");
  assert.equal(v.intestazioni.authorization, `Bearer ${TOKEN}`);
  assert.equal(v.intestazioni["content-encoding"], undefined);
  assert.equal(v.corpo.length, 0);
});

test("certificato auto-firmato senza `ca`: ErroreHub cert, l'hub finto non vede niente", async () => {
  const h = await hubFinto(() => ({ status: 201, body: "{}" }));
  await assert.rejects(chiamaHub(base(h, { ca: undefined })), (e: unknown) => {
    assert.equal(senzaSegreti(e, h.porta).tipo, "cert");
    assert.match((e as Error).message, /certificato dell'hub non valido: niente inviato/);
    return true;
  });
  assert.equal(h.visti.length, 0);
});

test("certificato fidato ma per un altro nome: ErroreHub cert, niente inviato", async () => {
  const h = await hubFinto(() => ({ status: 201, body: "{}" }), "da-vulcan.esempio.invalid");
  await assert.rejects(chiamaHub(base(h)), (e: unknown) => {
    assert.equal(senzaSegreti(e, h.porta).tipo, "cert");
    return true;
  });
  assert.equal(h.visti.length, 0);
});

test("porta chiusa: ErroreHub rete", async () => {
  const tcp = createTcpServer();
  await new Promise<void>((ok) => tcp.listen(0, "127.0.0.1", ok));
  const { port } = tcp.address() as AddressInfo;
  await new Promise<void>((ok) => tcp.close(() => ok()));
  const url = new URL(`https://127.0.0.1:${port}`);
  await assert.rejects(chiamaHub(base({ url, ca: "" }, { ca: undefined })), (e: unknown) => {
    assert.equal(senzaSegreti(e, port).tipo, "rete");
    return true;
  });
});

test("nome che non si risolve: ErroreHub rete «nome non risolto»", async () => {
  const url = new URL("https://hub-che-non-esiste.invalid");
  await assert.rejects(chiamaHub(base({ url, ca: "" }, { ca: undefined, timeoutMs: 10_000 })), (e: unknown) => {
    assert.equal(senzaSegreti(e, 443).tipo, "rete");
    assert.match((e as Error).message, /nome non risolto/);
    assert.ok(!(e as Error).message.includes("invalid"));
    return true;
  });
});

test("hub che non risponde: ErroreHub tempo entro timeoutMs", async () => {
  const h = await hubFinto(() => null);
  const t0 = Date.now();
  await assert.rejects(chiamaHub(base(h, { timeoutMs: 300 })), (e: unknown) => {
    assert.equal(senzaSegreti(e, h.porta).tipo, "tempo");
    assert.match((e as Error).message, /non ha risposto in tempo/);
    return true;
  });
  assert.ok(Date.now() - t0 < 2_000, "il tempo massimo vale per tutta la chiamata");
});

test("TLS che non parte (TCP muto): ErroreHub tempo, nessun byte del gettone", async () => {
  const ricevuto: Buffer[] = [];
  const tcp = createTcpServer((s) => s.on("data", (d: Buffer) => ricevuto.push(d)));
  aperti.push(tcp);
  await new Promise<void>((ok) => tcp.listen(0, "127.0.0.1", ok));
  const { port } = tcp.address() as AddressInfo;
  const url = new URL(`https://127.0.0.1:${port}`);
  await assert.rejects(chiamaHub(base({ url, ca: "" }, { ca: undefined, timeoutMs: 300 })), (e: unknown) => {
    assert.equal(senzaSegreti(e, port).tipo, "tempo");
    return true;
  });
  assert.ok(!Buffer.concat(ricevuto).toString("latin1").includes(TOKEN));
});

test("302: restituito com'è, nessun rimando seguito", async () => {
  const h = await hubFinto((v) =>
    v.percorso === "/altrove" ? { status: 200, body: "{}" } : { status: 302, body: "", headers: { Location: "/altrove" } },
  );
  const r = await chiamaHub(base(h));
  assert.equal(r.status, 302);
  assert.equal(h.visti.length, 1);
});

test("stati d'errore dell'hub: restituiti com'è (li interpreta il giro)", async () => {
  for (const status of [400, 401, 403, 404, 409, 413, 422, 500, 503]) {
    const h = await hubFinto(() => ({ status, body: `{"error":"x${status}"}` }));
    const r = await chiamaHub(base(h));
    assert.equal(r.status, status);
  }
});

test("risposta oltre 64 KB: ErroreHub risposta", async () => {
  const h = await hubFinto(() => ({ status: 200, body: "x".repeat(MAX_RISPOSTA_HUB + 10) }));
  await assert.rejects(chiamaHub(base(h)), (e: unknown) => {
    assert.equal(senzaSegreti(e, h.porta).tipo, "risposta");
    return true;
  });
});

test("POST senza corpo o GET con corpo: rifiutati prima della rete", async () => {
  const h = await hubFinto(() => ({ status: 200, body: "{}" }));
  await assert.rejects(chiamaHub(base(h, { corpoGz: undefined })), ErroreHub);
  await assert.rejects(chiamaHub(base(h, { metodo: "GET", percorso: "/api/ipam/ping" })), ErroreHub);
  await assert.rejects(chiamaHub(base(h, { url: new URL(`http://localhost:${h.porta}`) })), ErroreHub);
  assert.equal(h.visti.length, 0);
});
