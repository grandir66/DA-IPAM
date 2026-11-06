process.env.ENCRYPTION_KEY ||= "test-encryption-key-avanzamento-0123456789";

/**
 * Avanzamento per IP (06/11/2026, piano host lenti Task 2). La sonda dà `/api/v1/scans/in-corso`;
 * DA-IPAM lo abbina alla rete per CIDR. Una sonda vecchia (422: «in-corso» cade su `/scans/{scan_id}`;
 * 404: rotta assente) è «sonda da aggiornare», mai un errore.
 *
 * Run: node --import tsx --test src/lib/vuln/__tests__/avanzamento.test.ts
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
import { leggiRispostaInCorso, testoDurata, daQuanto, percentoBarra } from "@/lib/vuln/avanzamento";
import { leggiAvanzamento, leggiHostLenti, salvaHostLenti } from "@/lib/vuln/edge-subnet-bridge";
import { leggiAvanzamentoRotta } from "@/lib/vuln/avanzamento-rotta";

const T = "TESTAVANZAMENTO";
const VERA = [
  { scan_id: 88, network_id: 3, cidr: "192.168.5.0/24", percento: 96, partita_at: "2026-11-06 08:00:00", totale: 29, finiti: 28,
    in_analisi: [{ ip: "192.168.5.108", da: "2026-11-06 08:10:00" }], da_fare: ["192.168.5.109"], lenti: [] },
  { scan_id: 89, network_id: 4, cidr: "10.9.0.0/24", percento: null, partita_at: "2026-11-06 09:00:00", totale: 10, finiti: 0,
    in_analisi: [], da_fare: [], lenti: [] },
];

const LENTI = { escludi_lenti: true, host: [{ ip: "192.168.5.7", durata_s: null, volte: 3, visto_at: "2026-11-06 08:00:00" }] };
let lentiVecchia = false;
let server: Server;
let risposta: { status: number; body: string } = { status: 200, body: "[]" };
let rete = 0;
let altra = 0;

before(async () => {
  createTenant({
    codice_cliente: T, ragione_sociale: "Prova avanzamento", indirizzo: null, citta: null, provincia: null,
    cap: null, telefono: null, email: null, piva: null, cf: null, referente: null, note: null, active: 1,
  });
  server = createServer((req, res) => {
    const url = (req.url ?? "").split("?")[0];
    let r = { status: 404, body: '{"detail":"Not Found"}' };
    if (url === "/api/v1/scans/in-corso") r = risposta;
    else if (url === "/api/v1/networks/lookup") r = { status: 200, body: '{"found":true,"network_id":5}' };
    else if (url === "/api/v1/networks/5/host-lenti" && !lentiVecchia) {
      r = req.method === "PUT" ? { status: 404, body: '{"detail":"ip non presente"}' } : { status: 200, body: JSON.stringify(LENTI) };
    }
    res.writeHead(r.status, { "Content-Type": "application/json" });
    res.end(r.body);
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const d = getTenantDb(T);
  d.prepare("INSERT INTO vuln_scanners (name, base_url, token_encrypted, enabled) VALUES ('E', ?, ?, 1)")
    .run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, encrypt("t"));
  rete = Number(d.prepare("INSERT INTO networks (cidr, name) VALUES ('192.168.5.0/24', 'uffici')").run().lastInsertRowid);
  altra = Number(d.prepare("INSERT INTO networks (cidr, name) VALUES ('172.16.0.0/24', 'altra')").run().lastInsertRowid);
});
after(async () => {
  await new Promise<void>((ok) => server.close(() => ok()));
  deleteTenantDatabase(T);
  closeHubDb();
  removeTestHubDb();
});
beforeEach(() => { risposta = { status: 200, body: JSON.stringify(VERA) }; });

const dentro = <R>(f: () => Promise<R>): Promise<R> => withTenant(T, f);

test("la risposta vera si legge; una forma diversa è un errore detto", () => {
  const ok = leggiRispostaInCorso(VERA);
  assert.equal(ok.ok, true);
  if (ok.ok) { assert.equal(ok.scans[0].in_analisi[0].ip, "192.168.5.108"); assert.equal(ok.scans[1].percento, null); }
  assert.equal(leggiRispostaInCorso({ scans: [] }).ok, false);
  assert.equal(leggiRispostaInCorso([{ ...VERA[0], da_fare: "no" }]).ok, false);
  assert.equal(leggiRispostaInCorso([{ ...VERA[0], totale: undefined }]).ok, false);
});

test("una scansione senza rete (cidr null) o con un «da» null non rompe l'elenco; «lenti» ha la sua forma", () => {
  const lento = { ip: "192.168.5.7", durata_s: 1900, volte: 2, visto_at: "2026-11-06 08:00:00" };
  const r = leggiRispostaInCorso([
    { ...VERA[0], cidr: null, in_analisi: [{ ip: "192.168.5.1", da: null }] },
    { ...VERA[1], lenti: [lento, { ...lento, durata_s: null }] },
  ]);
  assert.equal(r.ok, true);
  if (r.ok) { assert.equal(r.scans[0].cidr, null); assert.equal(r.scans[0].in_analisi[0].da, null); assert.equal(r.scans[1].lenti.length, 2); }
  assert.equal(leggiRispostaInCorso([{ ...VERA[0], lenti: [{ ip: "x" }] }]).ok, false);
  assert.equal(leggiRispostaInCorso([{ ...VERA[0], lenti: ["x"] }]).ok, false);
});

test("leggiAvanzamento abbina la scansione alla rete per CIDR", () =>
  dentro(async () => {
    const a = await leggiAvanzamento(rete);
    assert.equal(a?.stato, "ok");
    if (a?.stato === "ok") { assert.equal(a.scan_id, 88); assert.equal(a.finiti, 28); assert.equal(a.percento, 96); }
    assert.equal(await leggiAvanzamento(altra), null, "nessuna scansione aperta per questa rete");
  }));

test("sonda vecchia: 422 e 404 sono «da aggiornare», non un errore; la rotta risponde 200", () =>
  dentro(async () => {
    risposta = { status: 422, body: '{"detail":[{"type":"int_parsing","loc":["path","scan_id"],"msg":"Input should be a valid integer"}]}' };
    assert.deepEqual(await leggiAvanzamento(rete), { stato: "da_aggiornare" });
    assert.deepEqual(await leggiAvanzamentoRotta(rete), { status: 200, body: { stato: "da_aggiornare" } });
    risposta = { status: 404, body: '{"detail":"Not Found"}' };
    assert.deepEqual(await leggiAvanzamento(rete), { stato: "da_aggiornare" });
  }));

test("un guasto vero resta un errore col suo motivo; la rotta dà «nessuna» solo a sonda a posto", () =>
  dentro(async () => {
    risposta = { status: 500, body: '{"detail":"database locked"}' };
    const e = await leggiAvanzamento(rete);
    assert.equal(e?.stato, "errore");
    risposta = { status: 200, body: '{"boh":1}' };
    assert.equal((await leggiAvanzamento(rete))?.stato, "errore");
    risposta = { status: 200, body: "[]" };
    assert.deepEqual(await leggiAvanzamentoRotta(rete), { status: 200, body: { stato: "nessuna" } });
  }));

test("host lenti: lettura valida, sonda vecchia = da aggiornare, 404 della sonda per un IP assente resta 404", () =>
  dentro(async () => {
    lentiVecchia = false;
    assert.deepEqual(await leggiHostLenti(rete), { stato: "ok", ...LENTI });
    const e = await salvaHostLenti(rete, { togli_ip: "192.168.5.99" });
    assert.equal(e.ok, false);
    if (!e.ok) { assert.equal(e.status, 404); assert.equal(e.daAggiornare, undefined); }
    lentiVecchia = true;
    assert.deepEqual(await leggiHostLenti(rete), { stato: "da_aggiornare" });
    const v = await salvaHostLenti(rete, { escludi_lenti: false });
    assert.equal(v.ok, false);
    if (!v.ok) { assert.equal(v.status, 409); assert.equal(v.daAggiornare, true); }
    lentiVecchia = false;
  }));

test("testoDurata scrive come la tabella di Edge", () => {
  assert.equal(testoDurata(null), "–");
  assert.equal(testoDurata(59), "<1 min");
  assert.equal(testoDurata(120), "2 min");
  assert.equal(testoDurata(7260), "2h 01");
  assert.equal(testoDurata(26400), "7h 20");
});

test("daQuanto parte dall'ora UTC della sonda", () => {
  const adesso = new Date("2026-11-06T11:20:00Z");
  assert.equal(daQuanto("2026-11-06 08:10:00", adesso), "da 3 ore e 10");
  assert.equal(daQuanto("2026-11-06 10:20:00", adesso), "da 1 ora");
  assert.equal(daQuanto("2026-11-06 11:08:00", adesso), "da 12 min");
  assert.equal(daQuanto("2026-11-06 11:19:40", adesso), "da meno di un minuto");
  assert.equal(daQuanto(null, adesso), "");
  assert.equal(daQuanto("boh", adesso), "");
});

test("percentoBarra preferisce Greenbone e ripiega sugli IP finiti", () => {
  assert.equal(percentoBarra({ percento: 96, finiti: 1, totale: 4 }), 96);
  assert.equal(percentoBarra({ percento: null, finiti: 1, totale: 4 }), 25);
  assert.equal(percentoBarra({ percento: null, finiti: 0, totale: 0 }), 0);
});

test("fatti: una sonda senza il campo dà elenco vuoto, un campo sbagliato è un errore", () => {
  const senza = leggiRispostaInCorso(VERA);
  assert.ok(senza.ok && senza.scans[0].fatti.length === 0);
  const con = leggiRispostaInCorso([{ ...VERA[0], fatti: ["192.168.5.1"] }]);
  assert.ok(con.ok && con.scans[0].fatti[0] === "192.168.5.1");
  assert.equal(leggiRispostaInCorso([{ ...VERA[0], fatti: "no" }]).ok, false);
});
