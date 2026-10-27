// Trasporto verso l'API di lettura del centro (passo 7.4): TLS vero su 127.0.0.1 con
// certificati generati in memoria. La verifica non si spegne mai:
// - senza impronta: catena fino a un'autorità fidata e nome giusto, o niente;
// - con impronta: quel certificato, o niente;
// e in nessun caso fallito la chiave arriva al server.
// Tempi: 5 s per aprire, 15 s in tutto (qui accorciati).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createHash, X509Certificate } from "node:crypto";
import { createServer, type Server } from "node:https";
import { createServer as createTcpServer, type AddressInfo, type Server as TcpServer } from "node:net";
import { autoritaFinta, certificatoFinto } from "@/lib/modules/__tests__/certificati-finti";
import { leggiPannello, svuotaCachePannello, type DipendenzePannello } from "../servizio";
import { salvaConfigLettura } from "../config";
import {
  certificatoCorrisponde,
  ErroreLettura,
  normalizzaImprontaLettura,
  trasportoTls,
  TEMPO_CONNESSIONE_MS,
  TEMPO_TOTALE_MS,
} from "../trasporto";
import { CODCLI, rispondi, statoBase } from "./support/centro-finto";
import Database from "better-sqlite3";

process.env.ENCRYPTION_KEY ||= "chiave-di-prova-del-pannello-zabbix";

const CHIAVE = `zl1.a1b2c3d4.${"B".repeat(43)}`;
const serverAperti: Array<Server | TcpServer> = [];
after(() => {
  for (const s of serverAperti) {
    if ("closeAllConnections" in s) s.closeAllConnections();
    s.close();
  }
});

interface Visto {
  url: string;
  auth: string;
}

async function centroHttps(
  cert: { key: string; cert: string },
  opz: { muto?: boolean } = {},
): Promise<{ base: URL; visti: Visto[] }> {
  const visti: Visto[] = [];
  const stato = statoBase();
  const srv = createServer({ key: cert.key, cert: cert.cert }, (req, res) => {
    visti.push({ url: req.url ?? "", auth: String(req.headers.authorization ?? "") });
    if (opz.muto) return; // non risponde mai
    const r = rispondi(stato, req.url ?? "/");
    res.statusCode = r.status;
    res.setHeader("Content-Type", "application/json");
    res.end(r.body);
  });
  serverAperti.push(srv);
  await new Promise<void>((ok) => srv.listen(0, "127.0.0.1", ok));
  const { port } = srv.address() as AddressInfo;
  return { base: new URL(`https://127.0.0.1:${port}/wizard`), visti };
}

function spki(certPem: string): string {
  const der = new X509Certificate(certPem).publicKey.export({ type: "spki", format: "der" });
  return `sha256//${createHash("sha256").update(der).digest("base64")}`;
}
function sha256Cert(certPem: string): string {
  return new X509Certificate(certPem).fingerprint256; // «AB:CD:…», come il browser
}

const PERCORSO = "/wizard/api/lettura/v1/cliente";

test("tempi del §6: 5 s per aprire la connessione, 15 s in tutto", () => {
  assert.equal(TEMPO_CONNESSIONE_MS, 5_000);
  assert.equal(TEMPO_TOTALE_MS, 15_000);
});

test("impronta: le forme accettate e quelle rifiutate", () => {
  const b64 = Buffer.alloc(32, 7).toString("base64");
  assert.equal(normalizzaImprontaLettura(`sha256//${b64}`), `sha256/${b64}`);
  assert.equal(normalizzaImprontaLettura(`sha256/${b64}`), `sha256/${b64}`);
  const hex = "AB".repeat(32);
  assert.equal(normalizzaImprontaLettura(hex.match(/../g)!.join(":")), hex.toLowerCase());
  assert.equal(normalizzaImprontaLettura(hex), hex.toLowerCase());
  for (const no of ["", "sha256//corta=", "AB:CD", "md5/xxx", "zz".repeat(32)]) {
    assert.equal(normalizzaImprontaLettura(no), null, no);
  }
});

test("con impronta SPKI giusta: risponde, e la chiave arriva solo dopo la verifica", async () => {
  const c = certificatoFinto({ cn: "centro-zabbix" });
  const s = await centroHttps(c);
  const t = trasportoTls({ base: s.base, chiave: CHIAVE, impronta: normalizzaImprontaLettura(spki(c.cert)) });
  const r = await t(PERCORSO);
  assert.equal(r.status, 200);
  assert.equal(s.visti[0]!.auth, `Bearer ${CHIAVE}`);
  assert.equal(JSON.parse(r.body).codcli, CODCLI);
});

test("con impronta SHA-256 del certificato (come la mostra il browser): risponde", async () => {
  const c = certificatoFinto({ cn: "centro-zabbix" });
  const s = await centroHttps(c);
  const imp = normalizzaImprontaLettura(sha256Cert(c.cert))!;
  assert.ok(certificatoCorrisponde(new X509Certificate(c.cert).raw, imp));
  const r = await trasportoTls({ base: s.base, chiave: CHIAVE, impronta: imp })(PERCORSO);
  assert.equal(r.status, 200);
});

test("impronta sbagliata: errore di certificato e il server non riceve niente", async () => {
  const c = certificatoFinto({ cn: "centro-zabbix" });
  const altro = certificatoFinto({ cn: "impostore" });
  const s = await centroHttps(c);
  await assert.rejects(
    trasportoTls({ base: s.base, chiave: CHIAVE, impronta: normalizzaImprontaLettura(spki(altro.cert)) })(PERCORSO),
    (e: unknown) => e instanceof ErroreLettura && e.tipo === "certificato" && !e.message.includes(CHIAVE),
  );
  assert.equal(s.visti.length, 0);
});

test("senza impronta, certificato autofirmato: rifiutato (nessuna verifica spenta), niente inviato", async () => {
  const c = certificatoFinto({ cn: "centro-zabbix", nomi: ["127.0.0.1"] });
  const s = await centroHttps(c);
  await assert.rejects(
    trasportoTls({ base: s.base, chiave: CHIAVE, impronta: null })(PERCORSO),
    (e: unknown) => e instanceof ErroreLettura && e.tipo === "certificato",
  );
  assert.equal(s.visti.length, 0);
});

test("senza impronta, catena fidata e nome giusto: risponde", async () => {
  const ca = autoritaFinta();
  const c = certificatoFinto({ cn: "centro-zabbix", nomi: ["127.0.0.1"], firmatoDa: ca });
  const s = await centroHttps(c);
  const r = await trasportoTls({ base: s.base, chiave: CHIAVE, impronta: null, ca: [ca.cert] })(PERCORSO);
  assert.equal(r.status, 200);
});

test("senza impronta, catena fidata ma nome sbagliato: rifiutato, niente inviato", async () => {
  const ca = autoritaFinta();
  const c = certificatoFinto({ cn: "altro", nomi: ["192.0.2.50"], firmatoDa: ca });
  const s = await centroHttps(c);
  await assert.rejects(
    trasportoTls({ base: s.base, chiave: CHIAVE, impronta: null, ca: [ca.cert] })(PERCORSO),
    (e: unknown) => e instanceof ErroreLettura && e.tipo === "certificato" && /nome/.test(e.message),
  );
  assert.equal(s.visti.length, 0);
});

test("http:// rifiutato prima di aprire qualunque connessione", async () => {
  await assert.rejects(
    trasportoTls({ base: new URL("http://127.0.0.1:9/wizard"), chiave: CHIAVE, impronta: null })(PERCORSO),
    (e: unknown) => e instanceof ErroreLettura && /https/.test(e.message),
  );
});

// Quale limite è scattato lo dice il messaggio («aperto la connessione», non «risposto entro»), non
// l'orologio: il 27/10 `Date.now() - t0 < 1_500` è fallito a 19,9 s con il Mac a carico 24. Il limite
// totale è lungo apposta, così un limite di apertura rotto non si nasconde dietro quello totale; il
// `timeout` della prova è solo il freno contro un blocco, largo per non dipendere dalla macchina.
test("connessione che non completa il TLS: «tempo» entro il limite di apertura", { timeout: 30_000 }, async () => {
  const tcp = createTcpServer(() => {
    /* accetta e tace */
  });
  serverAperti.push(tcp);
  await new Promise<void>((ok) => tcp.listen(0, "127.0.0.1", ok));
  const { port } = tcp.address() as AddressInfo;
  await assert.rejects(
    trasportoTls({
      base: new URL(`https://127.0.0.1:${port}/wizard`),
      chiave: CHIAVE,
      impronta: normalizzaImprontaLettura(`sha256//${Buffer.alloc(32).toString("base64")}`),
      tempoConnessioneMs: 300,
      tempoTotaleMs: 120_000,
    })(PERCORSO),
    (e: unknown) => e instanceof ErroreLettura && e.tipo === "tempo" && /aperto la connessione/.test(e.message),
  );
});

test("server che apre ma non risponde: «tempo» al limite totale", async () => {
  const c = certificatoFinto({ cn: "centro-zabbix" });
  const s = await centroHttps(c, { muto: true });
  await assert.rejects(
    trasportoTls({
      base: s.base,
      chiave: CHIAVE,
      impronta: normalizzaImprontaLettura(spki(c.cert)),
      tempoConnessioneMs: 1_000,
      tempoTotaleMs: 400,
    })(PERCORSO),
    (e: unknown) => e instanceof ErroreLettura && e.tipo === "tempo",
  );
});

test("da capo a fondo: pannello vero sul centro finto in HTTPS con impronta", async () => {
  svuotaCachePannello();
  const c = certificatoFinto({ cn: "centro-zabbix" });
  const s = await centroHttps(c);
  const db = new Database(":memory:");
  db.exec("CREATE TABLE hosts (id INTEGER PRIMARY KEY, network_id INTEGER, ip TEXT NOT NULL, hostname TEXT, custom_name TEXT)");
  const salvata = salvaConfigLettura(
    db,
    { baseUrl: s.base.toString(), chiave: CHIAVE, impronta: spki(c.cert), codcli: CODCLI, enabled: true },
    "prova",
  );
  assert.ok(salvata.ok);
  const d: DipendenzePannello = {
    tenant: "PROVA-HTTPS",
    db,
    acquistato: () => true,
    trasporto: (cfg, chiave) => trasportoTls({ base: new URL(cfg.baseUrl), chiave, impronta: cfg.impronta }),
    proxyLocale: () => ({ stato: "assente", nome: null }),
    adesso: () => new Date(),
  };
  const p = await leggiPannello(d);
  assert.equal(p.stato, "ok", JSON.stringify(p));
  assert.ok(s.visti.every((v) => v.auth === `Bearer ${CHIAVE}`));
  assert.deepEqual(
    s.visti.map((v) => new URL(v.url, "https://x.invalid").pathname),
    [
      "/wizard/api/lettura/v1/cliente",
      "/wizard/api/lettura/v1/host",
      "/wizard/api/lettura/v1/problemi",
      "/wizard/api/lettura/v1/valori",
    ],
  );
});
