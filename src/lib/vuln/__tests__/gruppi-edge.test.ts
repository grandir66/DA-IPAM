process.env.ENCRYPTION_KEY ||= "test-encryption-key-gruppi-edge-0123456789";

/**
 * Contratto IPAM → Edge per lanciare un gruppo di device (piano profili-per-device, Passo 4, 06/11/2026).
 *
 * Perché: al 72729 nove PLC sono spariti dentro una scansione della loro rete (05-06/11/2026; la causa
 * NON è accertata). Se una sonda non ha ancora la rotta dei gruppi, IPAM NON ripiega sulla scansione
 * della rete intera: dice «da aggiornare» e non lancia niente. Qui la sonda è un vero server HTTP con le
 * risposte come le scrive Edge: il 404 di una rotta assente è il JSON di FastAPI `{"detail":"Not Found"}`,
 * gli errori nostri sono testo semplice (`Response(content=str(exc.detail))` in main.py).
 *
 * Run: DA_INVENT_DATA_DIR=$(mktemp -d) node --import tsx --test src/lib/vuln/__tests__/gruppi-edge.test.ts
 */
import "./support/dati-isolati";
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { withTenant, getTenantDb, deleteTenantDatabase } from "@/lib/db-tenant";
import { closeHubDb, createTenant } from "@/lib/db-hub";
import { removeTestHubDb } from "@/lib/integrations/__tests__/support/hub-isolato";
import { encrypt } from "@/lib/crypto";
import { avviaGruppoEdge } from "@/lib/vuln/edge-subnet-bridge";
import { leggiRispostaGruppo } from "@/lib/vuln/gruppi-edge";

const T = "TESTGRUPPIEDGE";
const SENZA = "TESTGRUPPISENZA";
const GRUPPO = { famiglia: "windows" as const, ips: ["10.9.0.11", "10.9.0.12"], profile: "balanced" as const, nuclei_profilo: "quick" as const, assessment_profile_id: "smoke-interno" };

interface Chiamata { metodo: string; url: string; corpo: string }
let chiamate: Chiamata[] = [];
let lookup: { status: number; body: string };
let ensure: { status: number; body: string };
let gruppi: { status: number; body: string; testo?: boolean } | "chiudi";
let server: Server;
let rete = 0;
let reteSenzaEdge = 0;
let reteConImpianto = 0;

const VALIDA = { ok: true, scan_id: 41, network_id: 5, status: "pending", ip_tolti: [], error_message: null };

before(async () => {
  for (const [codice, ragione] of [[T, "Prova gruppi"], [SENZA, "Prova senza sonda"]]) {
    createTenant({
      codice_cliente: codice, ragione_sociale: ragione, indirizzo: null, citta: null, provincia: null,
      cap: null, telefono: null, email: null, piva: null, cf: null, referente: null, note: null, active: 1,
    });
  }
  server = createServer((req, res) => {
    let corpo = "";
    req.on("data", (c) => (corpo += c));
    req.on("end", () => {
      const url = (req.url ?? "").split("?")[0];
      chiamate.push({ metodo: req.method ?? "", url: req.url ?? "", corpo });
      let r: { status: number; body: string; testo?: boolean } = { status: 404, body: '{"detail":"Not Found"}' };
      if (url === "/api/v1/networks/lookup") r = lookup;
      else if (url === "/api/v1/networks/ensure") r = ensure;
      else if (url === "/api/v1/networks/5/gruppi" && req.method === "POST") {
        if (gruppi === "chiudi") { req.socket.destroy(); return; }
        r = gruppi;
      } else if (url === "/api/v1/networks/5/scan") r = { status: 200, body: '{"ok":true,"scan_id":99,"network_id":5,"profile":"balanced","status":"running"}' };
      res.writeHead(r.status, { "Content-Type": r.testo ? "text/plain; charset=utf-8" : "application/json" });
      res.end(r.body);
    });
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const d = getTenantDb(T);
  d.prepare("INSERT INTO vuln_scanners (name, base_url, token_encrypted, enabled) VALUES ('E', ?, ?, 1)")
    .run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, encrypt("t"));
  rete = Number(d.prepare("INSERT INTO networks (cidr, name) VALUES ('10.9.0.0/24', 'uffici')").run().lastInsertRowid);
  reteSenzaEdge = Number(d.prepare("INSERT INTO networks (cidr, name) VALUES ('172.16.0.0/24', 'altra')").run().lastInsertRowid);
  reteConImpianto = Number(d.prepare("INSERT INTO networks (cidr, name) VALUES ('10.9.1.0/24', 'con impianto')").run().lastInsertRowid);
  d.prepare("INSERT INTO hosts (network_id, ip, status, classification, vendor) VALUES (?, '10.9.0.50', 'online', 'plc', 'CREVIS Co., LTD')").run(reteConImpianto);
});
after(async () => {
  await new Promise<void>((ok) => server.close(() => ok()));
  deleteTenantDatabase(T);
  deleteTenantDatabase(SENZA);
  closeHubDb();
  removeTestHubDb();
});
beforeEach(() => {
  chiamate = [];
  lookup = { status: 200, body: '{"found":true,"network_id":5,"protetti":["10.9.0.50"]}' };
  ensure = { status: 200, body: '{"ok":true,"network_id":5,"host_count":0}' };
  gruppi = { status: 200, body: JSON.stringify(VALIDA) };
});

const dentro = <R>(f: () => Promise<R>): Promise<R> => withTenant(T, f);
const chiamateA = (parte: string) => chiamate.filter((c) => c.url.includes(parte));

test("risposta vera: il gruppo parte, e a Edge arriva esattamente il corpo del contratto", () =>
  dentro(async () => {
    const e = await avviaGruppoEdge(rete, GRUPPO);
    assert.deepEqual(e, { stato: "lanciato", scan_id: 41, status: "pending", ip_tolti: [] });
    const post = chiamateA("/networks/5/gruppi");
    assert.equal(post.length, 1);
    assert.deepEqual(JSON.parse(post[0].corpo), {
      ips: GRUPPO.ips, profile: "balanced", nuclei_profilo: "quick", assessment_profile_id: "smoke-interno",
    });
    assert.equal(chiamateA("/scan").filter((c) => c.url.endsWith("/scan")).length, 0, "mai la scansione della rete");
  }));

test("sonda vecchia (404 «Not Found»): da aggiornare, e NESSUNA scansione di rete né ripiego", () =>
  dentro(async () => {
    gruppi = { status: 404, body: '{"detail":"Not Found"}' };
    const e = await avviaGruppoEdge(rete, GRUPPO);
    assert.deepEqual(e, { stato: "da_aggiornare" });
    assert.equal(chiamateA("/networks/5/scan").length, 0, "nessuna chiamata a scan di rete");
    assert.ok(!chiamate.some((c) => c.metodo === "POST" && /\/networks\/\d+\/scan$/.test(c.url)));
    assert.equal(chiamateA("/networks/5/gruppi").length, 1, "un solo tentativo, niente ripetizioni");
  }));

test("404 con motivo («Rete edge non trovata») non è una sonda vecchia", () =>
  dentro(async () => {
    gruppi = { status: 404, body: "Rete edge non trovata", testo: true };
    const e = await avviaGruppoEdge(rete, GRUPPO);
    assert.equal(e.stato, "rete_non_registrata");
    assert.equal(chiamateA("/networks/5/scan").length, 0);
  }));

test("allineamento fallito: il gruppo non parte", () =>
  withTenant(T, async () => {
    ensure = { status: 500, body: "database locked", testo: true } as typeof ensure;
    // la rete con un impianto che la sonda non ha ancora: l'allineamento deve mandarlo, e fallisce
    lookup = { status: 200, body: '{"found":true,"network_id":5,"protetti":[]}' };
    const e = await avviaGruppoEdge(reteConImpianto, GRUPPO);
    assert.equal(e.stato, "allineamento_fallito");
    if (e.stato === "allineamento_fallito") assert.match(e.messaggio, /database locked/);
    assert.equal(chiamateA("/networks/ensure").length, 1);
    assert.equal(chiamateA("/gruppi").length, 0, "nessun lancio");
    assert.equal(chiamateA("/networks/5/scan").length, 0);
  }));

test("allineamento che serve e riesce: manda gli impianti, poi lancia", () =>
  withTenant(T, async () => {
    lookup = { status: 200, body: '{"found":true,"network_id":5,"protetti":[]}' };
    const e = await avviaGruppoEdge(reteConImpianto, GRUPPO);
    assert.equal(e.stato, "lanciato");
    const ens = chiamateA("/networks/ensure");
    assert.equal(ens.length, 1);
    assert.deepEqual(JSON.parse(ens[0].corpo).protetti, ["10.9.0.50"]);
    const ordine = chiamate.map((c) => c.url.split("?")[0]);
    assert.ok(ordine.indexOf("/api/v1/networks/ensure") < ordine.indexOf("/api/v1/networks/5/gruppi"), "prima l'allineamento");
  }));

test("422 e 503 sono errori distinti, col motivo di Edge", () =>
  dentro(async () => {
    gruppi = { status: 422, body: "IP fuori dalla rete 5 (10.9.0.0/24): 8.8.8.8. Il gruppo non parte.", testo: true };
    const a = await avviaGruppoEdge(rete, GRUPPO);
    assert.equal(a.stato, "rifiutato");
    if (a.stato === "rifiutato") { assert.equal(a.status, 422); assert.match(a.messaggio, /fuori dalla rete/); }
    gruppi = { status: 503, body: "Motore: gvmd non risponde", testo: true };
    const b = await avviaGruppoEdge(rete, GRUPPO);
    assert.equal(b.stato, "motore_non_disponibile");
    if (b.stato === "motore_non_disponibile") assert.match(b.messaggio, /gvmd/);
    assert.equal(chiamateA("/networks/5/scan").length, 0);
  }));

test("409 «già in corso»: esito distinto con lo scan_id esistente; un 409 diverso resta un rifiuto", () =>
  dentro(async () => {
    // forma vera: JSON con `detail` (frase), `scan_id` e `ip_in_comune`, come lo scrive la rotta di Edge
    gruppi = {
      status: 409,
      body: JSON.stringify({ ok: false, detail: "Gruppo già in corso: la scansione 41 ha già in coda o in corso 10.9.0.11, 10.9.0.12", scan_id: 41, ip_in_comune: ["10.9.0.11", "10.9.0.12"] }),
    };
    const a = await avviaGruppoEdge(rete, GRUPPO);
    assert.equal(a.stato, "gia_in_corso");
    if (a.stato === "gia_in_corso") { assert.equal(a.scan_id, 41); assert.match(a.messaggio, /già in corso/); }
    gruppi = { status: 409, body: "altro conflitto", testo: true };
    assert.equal((await avviaGruppoEdge(rete, GRUPPO)).stato, "rifiutato");
    assert.equal(chiamateA("/networks/5/scan").length, 0);
  }));

test("rete non registrata sulla sonda: non si crea, non si lancia", () =>
  dentro(async () => {
    lookup = { status: 200, body: '{"found":false}' };
    const e = await avviaGruppoEdge(reteSenzaEdge, GRUPPO);
    assert.equal(e.stato, "rete_non_registrata");
    assert.equal(chiamateA("/gruppi").length, 0);
    assert.equal(chiamateA("/networks/ensure").length, 0, "ensure creerebbe la rete: qui non si fa");
  }));

test("sonda assente o spenta: lo dice", () =>
  withTenant(SENZA, async () => {
    const n = Number(getTenantDb(SENZA).prepare("INSERT INTO networks (cidr, name) VALUES ('10.9.0.0/24', 'x')").run().lastInsertRowid);
    const e = await avviaGruppoEdge(n, GRUPPO);
    assert.equal(e.stato, "sonda_assente");
    assert.equal(chiamate.length, 0);
  }));

test("connessione chiusa o risposta di forma sbagliata: «non so», mai un successo", () =>
  dentro(async () => {
    gruppi = "chiudi";
    const a = await avviaGruppoEdge(rete, GRUPPO);
    assert.equal(a.stato, "non_so");
    gruppi = { status: 200, body: '{"ok":true}' };
    const b = await avviaGruppoEdge(rete, GRUPPO);
    assert.equal(b.stato, "non_so");
    gruppi = { status: 200, body: "non json", testo: true };
    assert.equal((await avviaGruppoEdge(rete, GRUPPO)).stato, "non_so");
    gruppi = { status: 500, body: "boom", testo: true };
    assert.equal((await avviaGruppoEdge(rete, GRUPPO)).stato, "non_so");
  }));

test("gruppo di soli impianti: 200 con status error, e il motivo arriva; non è un lancio", () =>
  dentro(async () => {
    gruppi = {
      status: 200,
      body: JSON.stringify({ ...VALIDA, status: "error", ip_tolti: ["10.9.0.50"], error_message: "non avviata: tutti gli IP del gruppo sono impianti protetti (10.9.0.50)" }),
    };
    const e = await avviaGruppoEdge(rete, GRUPPO);
    assert.equal(e.stato, "non_partito");
    if (e.stato === "non_partito") { assert.deepEqual(e.ip_tolti, ["10.9.0.50"]); assert.match(e.messaggio, /impianti protetti/); }
  }));

test("forma vera della risposta: si legge; un campo storto è un errore detto", () => {
  assert.deepEqual(leggiRispostaGruppo(VALIDA), { ok: true, dati: VALIDA });
  for (const x of [null, [], "x", {}, { ...VALIDA, scan_id: "41" }, { ...VALIDA, ip_tolti: "10.9.0.50" }, { ...VALIDA, status: 3 }, { ...VALIDA, error_message: 4 }, { ...VALIDA, ok: false }]) {
    assert.equal(leggiRispostaGruppo(x).ok, false, JSON.stringify(x));
  }
});
