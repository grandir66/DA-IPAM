/**
 * Sonde integrate con DA-Link (spec DA-Vul-can 2026-10-20, §8.2): la lettura di
 * `/api/v1/health` della sonda locale per il blocco `edge` del segnale.
 *
 * - modulo edge non configurato (nessuna riga in `vuln_scanners`, o senza indirizzo):
 *   null, il blocco non esce e alla sonda non si chiede niente;
 * - la stessa fiducia TLS delle altre chiamate alla sonda: pin SPKI di `cert_pin`
 *   (`rawRequest` di `scanner-edge-client.ts`); un pin diverso è «non raggiungibile»,
 *   mai una risposta accettata;
 * - timeout breve e totale: una sonda appesa non ferma il segnale;
 * - ogni guasto (rete, TLS, 5xx, risposta non JSON) è `raggiungibile: false`: un
 *   errore di trasporto non è un «ok», e non porta il suo messaggio.
 *
 * Sonde finte su 127.0.0.1 col TLS vero (certificato generato in memoria).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import https from "node:https";
import type { AddressInfo } from "node:net";
import { X509Certificate } from "node:crypto";
import Database from "better-sqlite3";
import { TENANT_SCHEMA_SQL } from "@/lib/db-tenant-schema";
import { spkiPinFromDer } from "@/lib/vuln/scanner-edge-client";
import { leggiEdgeSonda, scannerEdgeDaDb } from "../edge-sonda";
import { certificatoDiProva } from "./support/certificato";

const HEALTH = {
  ok: true,
  version: "0.8.121",
  scanner_id: "x",
  sealed_mode: false,
  tls_active: true,
  versione_vera: "0.8.121",
  hub: { esito: "ok", motivo: null, ultimo_battito_il: "2026-10-20T08:00:00Z", ultimo_ok_il: "2026-10-20T08:00:00Z", ultimo_errore_il: null, ultimo_errore_motivo: null, errori_consecutivi: 0 },
  aggiornamento: null,
  disco: { total_gb: 77.0, free_gb: 37.2 },
};

async function inAscolto(server: http.Server | https.Server): Promise<number> {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  return (server.address() as AddressInfo).port;
}

function chiudi(server: http.Server | https.Server): Promise<void> {
  server.closeAllConnections?.();
  return new Promise((r) => server.close(() => r()));
}

test("scannerEdgeDaDb: nessuna riga → null (modulo edge non configurato)", () => {
  const db = new Database(":memory:");
  db.exec(TENANT_SCHEMA_SQL);
  assert.equal(scannerEdgeDaDb(db), null);
  db.close();
});

test("scannerEdgeDaDb: indirizzo e pin dalla riga vera, anche se lo scanner è stato spento dagli errori", () => {
  const db = new Database(":memory:");
  db.exec(TENANT_SCHEMA_SQL);
  db.prepare(
    "INSERT INTO vuln_scanners (name, base_url, token_encrypted, enabled, cert_pin, auto_disabled_at) VALUES ('edge', 'https://127.0.0.1:8443', 'x', 0, 'sha256/abc', '2026-10-20 08:00:00')",
  ).run();
  assert.deepEqual(scannerEdgeDaDb(db), { base_url: "https://127.0.0.1:8443", cert_pin: "sha256/abc" });
  db.close();
});

// Contratto 8.2: «assente se il modulo edge non c'è». Spento per scelta (`enabled=0` senza
// `auto_disabled_at`) = non c'è; spento dalla sequenza di errori = c'è, ed è proprio lì che
// serve sapere se la sonda risponde (revisione del 20/10).
test("scannerEdgeDaDb: spento per scelta (enabled=0, auto_disabled_at vuoto) → null", () => {
  const db = new Database(":memory:");
  db.exec(TENANT_SCHEMA_SQL);
  db.prepare("INSERT INTO vuln_scanners (name, base_url, token_encrypted, enabled, cert_pin) VALUES ('edge', 'https://127.0.0.1:8443', 'x', 0, 'sha256/abc')").run();
  assert.equal(scannerEdgeDaDb(db), null);
  db.prepare("UPDATE vuln_scanners SET auto_disabled_at = ''").run();
  assert.equal(scannerEdgeDaDb(db), null, "stringa vuota = nessuno spegnimento automatico");
  db.prepare("UPDATE vuln_scanners SET enabled = 1").run();
  assert.deepEqual(scannerEdgeDaDb(db), { base_url: "https://127.0.0.1:8443", cert_pin: "sha256/abc" }, "acceso → c'è");
  db.close();
});

test("scannerEdgeDaDb: riga senza indirizzo → null", () => {
  const db = new Database(":memory:");
  db.exec(TENANT_SCHEMA_SQL);
  db.prepare("INSERT INTO vuln_scanners (name, base_url, token_encrypted, enabled) VALUES ('edge', '  ', 'x', 1)").run();
  assert.equal(scannerEdgeDaDb(db), null);
  db.close();
});

test("modulo edge non configurato: null e alla sonda non si chiede niente", async () => {
  let chiesto = false;
  const r = await leggiEdgeSonda("DEFAULT", {
    scanner: () => null,
    salute: async () => {
      chiesto = true;
      return HEALTH;
    },
  });
  assert.equal(r, null);
  assert.equal(chiesto, false);
});

test("la lettura usa indirizzo e pin della riga dello scanner (stessa fiducia delle altre chiamate)", async () => {
  const visti: unknown[] = [];
  const r = await leggiEdgeSonda("DEFAULT", {
    scanner: () => ({ base_url: "https://10.9.9.9:8443", cert_pin: "sha256/PIN" }),
    salute: async (url, pin, ms) => {
      visti.push([url, pin, ms > 0 && ms <= 5000]);
      return HEALTH;
    },
  });
  assert.deepEqual(visti, [["https://10.9.9.9:8443", "sha256/PIN", true]]);
  assert.deepEqual(r, { raggiungibile: true, health: HEALTH });
});

test("errore di trasporto: raggiungibile false, nessun messaggio", async () => {
  const r = await leggiEdgeSonda("DEFAULT", {
    scanner: () => ({ base_url: "https://10.9.9.9:8443", cert_pin: null }),
    salute: async () => {
      throw new Error("network: connect ECONNREFUSED 10.9.9.9:8443");
    },
  });
  assert.deepEqual(r, { raggiungibile: false });
});

test("lettura della riga che fallisce: null (non so se c'è), mai un errore che ferma il segnale", async () => {
  const r = await leggiEdgeSonda("DEFAULT", {
    scanner: () => {
      throw new Error("SQLITE_BUSY");
    },
  });
  assert.equal(r, null);
});

test("sonda appesa: raggiungibile false entro il timeout, il segnale non aspetta", async () => {
  const t0 = Date.now();
  const r = await leggiEdgeSonda(
    "DEFAULT",
    { scanner: () => ({ base_url: "http://10.9.9.9", cert_pin: null }), salute: () => new Promise(() => {}) },
    150,
  );
  assert.deepEqual(r, { raggiungibile: false });
  assert.ok(Date.now() - t0 < 1500, `ha aspettato ${Date.now() - t0} ms`);
});

test("TLS vero col pin giusto: la risposta della sonda arriva com'è", async () => {
  const c = certificatoDiProva("scanner-edge");
  const pin = spkiPinFromDer(new X509Certificate(c.cert).raw);
  const server = https.createServer({ key: c.key, cert: c.cert }, (req, res) => {
    res.writeHead(req.url === "/api/v1/health" ? 200 : 404, { "Content-Type": "application/json" });
    res.end(JSON.stringify(HEALTH));
  });
  const port = await inAscolto(server);
  try {
    const r = await leggiEdgeSonda("DEFAULT", { scanner: () => ({ base_url: `https://127.0.0.1:${port}/`, cert_pin: pin }) });
    assert.deepEqual(r, { raggiungibile: true, health: HEALTH });
  } finally {
    await chiudi(server);
  }
});

test("TLS vero con un pin diverso: non raggiungibile, la risposta non si accetta", async () => {
  const c = certificatoDiProva("scanner-edge");
  const altro = certificatoDiProva("impostore");
  const pinAltro = spkiPinFromDer(new X509Certificate(altro.cert).raw);
  let servite = 0;
  const server = https.createServer({ key: c.key, cert: c.cert }, (_req, res) => {
    servite += 1;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(HEALTH));
  });
  const port = await inAscolto(server);
  try {
    const r = await leggiEdgeSonda("DEFAULT", { scanner: () => ({ base_url: `https://127.0.0.1:${port}`, cert_pin: pinAltro }) });
    assert.deepEqual(r, { raggiungibile: false });
    assert.equal(servite, 0, "col pin sbagliato la richiesta non parte nemmeno");
  } finally {
    await chiudi(server);
  }
});

test("sonda vera che risponde 500 o non JSON: raggiungibile false", async () => {
  for (const [codice, corpo] of [
    [500, '{"detail":"errore interno su /var/lib/x"}'],
    [200, "<html>proxy</html>"],
  ] as const) {
    const server = http.createServer((_req, res) => {
      res.writeHead(codice);
      res.end(corpo);
    });
    const port = await inAscolto(server);
    try {
      const r = await leggiEdgeSonda("DEFAULT", { scanner: () => ({ base_url: `http://127.0.0.1:${port}`, cert_pin: null }) });
      assert.deepEqual(r, { raggiungibile: false }, `codice ${codice}`);
    } finally {
      await chiudi(server);
    }
  }
});

test("sonda vera che accetta la connessione e non risponde: timeout, raggiungibile false", async () => {
  const server = http.createServer(() => {
    // non risponde mai
  });
  const port = await inAscolto(server);
  const t0 = Date.now();
  try {
    const r = await leggiEdgeSonda("DEFAULT", { scanner: () => ({ base_url: `http://127.0.0.1:${port}`, cert_pin: null }) }, 200);
    assert.deepEqual(r, { raggiungibile: false });
    assert.ok(Date.now() - t0 < 1500, `ha aspettato ${Date.now() - t0} ms`);
  } finally {
    await chiudi(server);
  }
});

// Revisione del 20/10: allo scadere la richiesta si chiude davvero (non resta appesa dietro
// al segnale), e la risposta ha un tetto. Il timeout del socket di `rawRequest` è di
// inattività: una sonda che risponde a goccia lo rinnova all'infinito.
test("allo scadere la lettura riceve l'ordine di fermarsi (AbortSignal)", async () => {
  let segnale: AbortSignal | undefined;
  const r = await leggiEdgeSonda(
    "DEFAULT",
    {
      scanner: () => ({ base_url: "http://10.9.9.9", cert_pin: null }),
      salute: (_u, _p, _ms, s) => {
        segnale = s;
        return new Promise(() => {});
      },
    },
    100,
  );
  assert.deepEqual(r, { raggiungibile: false });
  assert.equal(segnale?.aborted, true);
});

test("sonda vera che risponde a goccia: timeout, e la connessione si chiude davvero", async () => {
  let chiusaIl = 0;
  const tic: NodeJS.Timeout[] = [];
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.write("{");
    tic.push(setInterval(() => res.write(" "), 50));
    req.socket.on("close", () => {
      chiusaIl = Date.now();
    });
  });
  const port = await inAscolto(server);
  const t0 = Date.now();
  try {
    const r = await leggiEdgeSonda("DEFAULT", { scanner: () => ({ base_url: `http://127.0.0.1:${port}`, cert_pin: null }) }, 300);
    assert.deepEqual(r, { raggiungibile: false });
    assert.ok(Date.now() - t0 < 1500, `ha aspettato ${Date.now() - t0} ms`);
    await new Promise((res) => setTimeout(res, 300));
    assert.ok(chiusaIl > 0, "la connessione verso la sonda è rimasta aperta dopo il timeout");
    assert.ok(chiusaIl - t0 < 1000, `chiusa dopo ${chiusaIl - t0} ms`);
  } finally {
    for (const t of tic) clearInterval(t);
    await chiudi(server);
  }
});

test("risposta oltre i 64 KB: non è lo stato della sonda, raggiungibile false", async () => {
  const grande = JSON.stringify({ ...HEALTH, imbottitura: "x".repeat(70 * 1024) });
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(grande);
  });
  const port = await inAscolto(server);
  try {
    const r = await leggiEdgeSonda("DEFAULT", { scanner: () => ({ base_url: `http://127.0.0.1:${port}`, cert_pin: null }) });
    assert.deepEqual(r, { raggiungibile: false });
  } finally {
    await chiudi(server);
  }
});

test("risposta sotto il tetto: passa", async () => {
  const media = { ...HEALTH, imbottitura: "x".repeat(30 * 1024) };
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(media));
  });
  const port = await inAscolto(server);
  try {
    const r = await leggiEdgeSonda("DEFAULT", { scanner: () => ({ base_url: `http://127.0.0.1:${port}`, cert_pin: null }) });
    assert.deepEqual(r, { raggiungibile: true, health: media });
  } finally {
    await chiudi(server);
  }
});
