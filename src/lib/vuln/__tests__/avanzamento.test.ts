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
import { leggiRispostaInCorso } from "@/lib/vuln/avanzamento";
import { leggiAvanzamento } from "@/lib/vuln/edge-subnet-bridge";
import { leggiAvanzamentoRotta } from "@/lib/vuln/avanzamento-rotta";

const T = "TESTAVANZAMENTO";
const VERA = [
  { scan_id: 88, network_id: 3, cidr: "192.168.5.0/24", percento: 96, partita_at: "2026-11-06 08:00:00", totale: 29, finiti: 28,
    in_analisi: [{ ip: "192.168.5.108", da: "2026-11-06 08:10:00" }], da_fare: ["192.168.5.109"], lenti: [] },
  { scan_id: 89, network_id: 4, cidr: "10.9.0.0/24", percento: null, partita_at: "2026-11-06 09:00:00", totale: 10, finiti: 0,
    in_analisi: [], da_fare: [], lenti: [] },
];

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
    const ok = (req.url ?? "").split("?")[0] === "/api/v1/scans/in-corso";
    const r = ok ? risposta : { status: 404, body: '{"detail":"Not Found"}' };
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
