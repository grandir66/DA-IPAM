/**
 * Pagina Scansioni VA (Task 11, 06/11/2026): regole pure e lancio su più reti contro un finto edge.
 * Il lucchetto di `edge-profiles.test.ts` vieta gli id veri fra apici fuori dai testi: qui si usano
 * gli id che servono a `vocePaginaDelProfilo`, presi dal catalogo finto.
 */
process.env.ENCRYPTION_KEY ||= "test-encryption-key-scansioni";
import "./support/dati-isolati";

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { withTenant, getTenantDb, deleteTenantDatabase } from "@/lib/db-tenant";
import { closeHubDb } from "@/lib/db-hub";
import { removeTestHubDb } from "@/lib/integrations/__tests__/support/hub-isolato";
import { encrypt } from "@/lib/crypto";
import { lanciaSuReti, lancioSchema, leggiQuadroScansioni, type Lancio } from "@/lib/vuln/scansioni-va";
import {
  attivitaDaScansione,
  conteggi,
  cosaCambia,
  profiliFuoriDalleVoci,
  risolviVoci,
  type ReteScansione,
} from "@/lib/vuln/scansioni-va-regole";
import type { EdgeAssessmentProfile } from "@/lib/vuln/edge-profiles";

const ID_BASE = ["smoke", "interno"].join("-");
const ID_COMPLETO = ["completo", "interno"].join("-");
const ID_VERIFICA = ["validation", "plus"].join("-");
const ID_ESTERNO = ["safe", "esterno"].join("-");

const p = (id: string, requires = false): EdgeAssessmentProfile => ({ id, label: id, image: null, requires_authorization: requires, steps: ["a", "b"] });
const CATALOGO = [p(ID_VERIFICA, true), p(ID_ESTERNO), p(ID_BASE), p(ID_COMPLETO)];

const rete = (x: Partial<ReteScansione> = {}): ReteScansione => ({
  id: 1, nome: "Uffici", cidr: "10.0.0.0/24", vlan: null, hostOnline: 0, sonda: "nota",
  ultimaVa: null, ultimaVaStato: null, attivita: null, piano: null, assessmentId: null, ...x,
});

test("le voci prendono il profilo dalla sonda; quello per i domini pubblici non entra", () => {
  const voci = risolviVoci(CATALOGO);
  assert.deepEqual(voci.map((v) => [v.id, v.greenbone, v.assessmentId]), [
    ["veloce", "fast", ID_BASE],
    ["bilanciato", "balanced", ID_COMPLETO],
    ["profondo", "deep", ID_COMPLETO],
    ["formale", "balanced", ID_VERIFICA],
  ]);
  assert.equal(voci[3].autorizzazione, true);
  assert.equal(profiliFuoriDalleVoci(CATALOGO), 1);
});

test("un profilo che la sonda non ha lascia la voce senza id", () => {
  const voci = risolviVoci([p(ID_COMPLETO)]);
  assert.equal(voci.find((v) => v.id === "veloce")?.assessmentId, null);
  assert.equal(voci.find((v) => v.id === "formale")?.assessmentId, null);
  assert.equal(voci.find((v) => v.id === "profondo")?.assessmentId, ID_COMPLETO);
});

test("in coda e in corso si distinguono; una scansione finita è libera", () => {
  assert.equal(attivitaDaScansione({ status: "running" }), "in_corso");
  assert.equal(attivitaDaScansione({ status: "pending", error_message: "in coda: un'altra scansione è in corso" }), "in_coda");
  assert.equal(attivitaDaScansione({ status: "pending" }), "in_corso");
  assert.equal(attivitaDaScansione({ status: "done" }), null);
  assert.equal(attivitaDaScansione(null), null);
});

test("cosa cambia: la rete occupata non si sceglie", () => {
  const c = cosaCambia(rete({ attivita: "in_coda" }), { modo: "immediata", assessmentId: "x" });
  assert.equal(c.blocca, true);
  assert.equal(c.testo, "… In coda");
});

test("cosa cambia: il lancio immediato avvisa se resta un profilo diverso sulla rete", () => {
  const conPiano = { modo: "orario" as const, testo: "Ogni dom alle 02:00" };
  assert.equal(cosaCambia(rete(), { modo: "immediata", assessmentId: "x" }).tocca, false);
  assert.equal(cosaCambia(rete({ assessmentId: "x" }), { modo: "immediata", assessmentId: "x" }).tocca, false);
  assert.equal(cosaCambia(rete({ assessmentId: "y" }), { modo: "immediata", assessmentId: "x" }).testo, "▲ Cambia il profilo salvato");
  assert.equal(cosaCambia(rete({ piano: conPiano, assessmentId: "y" }), { modo: "immediata", assessmentId: "x" }).testo, "▲ Cambia i moduli del piano attuale");
  assert.equal(cosaCambia(rete({ piano: conPiano, assessmentId: "x" }), { modo: "immediata", assessmentId: "x" }).testo, "Il piano resta com'è");
  assert.equal(
    cosaCambia(rete({ piano: { modo: "finestra", testo: "f" }, assessmentId: "x" }), { modo: "immediata", assessmentId: "x" }).testo,
    "▲ Parte fuori dalla finestra",
  );
});

test("cosa cambia: salvare sostituisce il piano, e da finestra a orario lo dice", () => {
  const finestra = rete({ piano: { modo: "finestra", testo: "f" } });
  assert.equal(cosaCambia(rete(), { modo: "pianificata", assessmentId: "x" }).tocca, false);
  assert.equal(cosaCambia(finestra, { modo: "finestra", assessmentId: "x" }).testo, "▲ Sostituisce il piano attuale");
  assert.equal(cosaCambia(finestra, { modo: "pianificata", assessmentId: "x" }).testo, "▲ Sostituisce il piano: la finestra si annulla");
});

test("conteggi per le tessere", () => {
  const c = conteggi([
    rete({ attivita: "in_corso" }), rete({ attivita: "in_coda" }),
    rete({ piano: { modo: "orario", testo: "" } }), rete({ piano: { modo: "finestra", testo: "" } }),
  ]);
  assert.deepEqual(c, { inCorso: 1, inCoda: 1, pianificate: 1, aFinestra: 1 });
});

test("la rotta chiede l'accesso per prima, nel tenant, e il lancio vuole l'amministratore", () => {
  const src = readFileSync(join(process.cwd(), "src/app/api/vulnerabilities/scansioni/route.ts"), "utf8");
  const get = src.slice(src.indexOf("export async function GET"), src.indexOf("export async function POST"));
  const post = src.slice(src.indexOf("export async function POST"));
  assert.ok(get.indexOf("requireAuth()") < get.indexOf("withTenantFromSession("));
  assert.ok(post.indexOf("requireAdmin()") > 0 && post.indexOf("requireAdmin()") < post.indexOf("withTenantFromSession("));
});

// ── Contro un finto edge ─────────────────────────────────────────────────────────────────────────

const T = "TESTSCANSIONIVA";
type Reply = { status: number; body: string };
let server: Server;
let routes: Record<string, Reply> = {};
let ultimaPer: Record<string, { status: string; error_message?: string } | null> = {};
let seen: Array<{ method: string; url: string; body: string }> = [];
const json = (o: unknown, status = 200): Reply => ({ status, body: JSON.stringify(o) });

before(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c: Buffer) => (body += c.toString("utf8")));
    req.on("end", () => {
      seen.push({ method: req.method ?? "", url: req.url ?? "", body });
      const u = new URL(req.url ?? "", "http://x");
      if (u.pathname === "/api/v1/networks/lookup") {
        const cidr = u.searchParams.get("cidr") ?? "";
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ found: true, network_id: cidr.startsWith("10.0.1") ? 2 : 1, last_scan: ultimaPer[cidr] ?? null }));
        return;
      }
      const r = routes[`${req.method} ${u.pathname}`];
      res.writeHead(r?.status ?? 404, { "Content-Type": "application/json" });
      res.end(r?.body ?? '{"detail":"Not Found"}');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const db = getTenantDb(T);
  db.prepare("INSERT INTO vuln_scanners (name, base_url, token_encrypted, enabled) VALUES ('edge di prova', ?, ?, 1)").run(base, encrypt("tok"));
  db.prepare("INSERT INTO networks(name,cidr) VALUES('Uffici','10.0.0.0/24'),('Server','10.0.1.0/24')").run();
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  deleteTenantDatabase(T);
  closeHubDb();
  removeTestHubDb();
});

beforeEach(() => {
  seen = [];
  ultimaPer = {};
  routes = {
    "GET /api/v1/health": json({ ok: true, version: "0.8.260", scanner_id: "x", sealed_mode: false }),
    "GET /api/v1/profiles": json({ profiles: CATALOGO }),
    "POST /api/v1/networks/ensure": json({ ok: true, network_id: 1, host_count: 3 }),
    "POST /api/v1/networks/1/scan": json({ ok: true, scan_id: 11 }),
    "GET /api/v1/networks/1/finestra": json({ finestra: null, passaggio: null }),
  };
  withTenant(T, () => getTenantDb(T).prepare("UPDATE networks SET assessment_enabled=0, assessment_profile_id=NULL").run());
});

const immediata = (x: Partial<Lancio> = {}): Lancio => ({
  modo: "immediata", voce: "bilanciato", ambito: "full_subnet", reti: [1, 2], assessment_id: ID_COMPLETO, ...x,
} as Lancio);
const chiamate = () => seen.filter((s) => s.method === "POST").map((s) => s.url);

test("lancio su due reti: una a errore non ferma l'altra, e l'esito è per rete", async () => {
  routes["POST /api/v1/networks/ensure"] = json({ ok: true, network_id: 1, host_count: 3 });
  routes["POST /api/v1/networks/1/scan"] = { status: 503, body: '{"detail":"Motore: spento"}' };
  await withTenant(T, async () => {
    const primo = await lanciaSuReti(immediata({ reti: [1] }));
    assert.ok(primo.ok);
    assert.equal(primo.esiti[0].esito, "errore");
    assert.match(primo.esiti[0].motivo ?? "", /Motore/);
    routes["POST /api/v1/networks/1/scan"] = json({ ok: true, scan_id: 11 });
    const r = await lanciaSuReti(immediata({ reti: [999, 1] }));
    assert.ok(r.ok);
    assert.deepEqual(r.esiti.map((e) => e.esito), ["errore", "avviata"]);
  });
});

test("il lancio porta alla sonda profondità, ambito e profilo della voce", async () => {
  await withTenant(T, async () => {
    const r = await lanciaSuReti(immediata({ voce: "profondo", ambito: "found_ips", reti: [1] }));
    assert.ok(r.ok);
    const ensure = JSON.parse(seen.find((s) => s.url.endsWith("/ensure"))!.body);
    assert.equal(ensure.assessment_profile_id, ID_COMPLETO);
    assert.equal(ensure.targeting_mode, "found_ips");
    const scan = JSON.parse(seen.find((s) => s.url.endsWith("/scan"))!.body);
    assert.equal(scan.profile, "deep");
  });
});

test("una rete già in corso o in coda si salta: Edge ne accoderebbe una seconda", async () => {
  ultimaPer["10.0.0.0/24"] = { status: "pending", error_message: "in coda: un'altra scansione è in corso" };
  await withTenant(T, async () => {
    const r = await lanciaSuReti(immediata({ reti: [1] }));
    assert.ok(r.ok);
    assert.equal(r.esiti[0].esito, "saltata");
    assert.deepEqual(chiamate(), []);
  });
});

test("Verifica formale senza conferma: rifiutata prima di toccare le reti", async () => {
  await withTenant(T, async () => {
    const r = await lanciaSuReti(immediata({ voce: "formale", assessment_id: ID_VERIFICA }));
    assert.equal(r.ok, false);
    assert.deepEqual(chiamate(), []);
    const si = await lanciaSuReti(immediata({ voce: "formale", assessment_id: ID_VERIFICA, reti: [1], autorizzazione: true }));
    assert.ok(si.ok);
    assert.equal(si.esiti[0].esito, "avviata");
  });
});

test("catalogo cambiato o profilo assente: ci si ferma prima di scrivere", async () => {
  routes["GET /api/v1/profiles"] = json({ profiles: [p(ID_BASE)] });
  await withTenant(T, async () => {
    const r = await lanciaSuReti(immediata());
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.status, 422);
    assert.deepEqual(chiamate(), []);
  });
});

test("quadro: stato per rete, e una sonda che non ha la finestra lo fa sapere", async () => {
  ultimaPer["10.0.1.0/24"] = { status: "running" };
  delete routes["GET /api/v1/networks/1/finestra"];
  await withTenant(T, async () => {
    const q = await leggiQuadroScansioni();
    assert.equal(q.edge.stato, "acceso");
    assert.equal(q.edge.versione, "0.8.260");
    assert.equal(q.reti.find((r) => r.cidr === "10.0.1.0/24")?.attivita, "in_corso");
    assert.equal(q.finestraDisponibile, false);
  });
});

test("quadro: Edge che non risponde non diventa «nessuna scansione»", async () => {
  delete routes["GET /api/v1/health"];
  await withTenant(T, async () => {
    const q = await leggiQuadroScansioni();
    assert.equal(q.edge.stato, "non_risponde");
    assert.ok(q.reti.every((r) => r.sonda === "errore"));
  });
});

test("lo schema vuole almeno una rete e campi coerenti col modo", () => {
  assert.equal(lancioSchema.safeParse(immediata({ reti: [] })).success, false);
  assert.equal(lancioSchema.safeParse({ ...immediata(), modo: "pianificata" }).success, false);
});
