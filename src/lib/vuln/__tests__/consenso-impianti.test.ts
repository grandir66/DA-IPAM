/**
 * Anche sugli impianti, col consenso (Riccardo, 07/11/2026): rete bloccata senza consenso, consenso solo
 * per il lancio immediato, copia del registro che non si cancella. Edge è finto: le sue regole stanno in
 * `tests/test_consenso_impianti.py` del repo DA-Vul-can.
 */
process.env.ENCRYPTION_KEY ||= "test-encryption-key-consenso";
import "./support/dati-isolati";

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { withTenant, getTenantDb, deleteTenantDatabase } from "@/lib/db-tenant";
import { closeHubDb } from "@/lib/db-hub";
import { removeTestHubDb } from "@/lib/integrations/__tests__/support/hub-isolato";
import { encrypt } from "@/lib/crypto";
import { lanciaSuReti, reteDaLookup, type Lancio } from "@/lib/vuln/scansioni-va";
import { cosaCambia, dataRegistro, dettaglioRegistro, scadenzaConsenso, testoConsenso, type ConsensoRete, type ReteScansione } from "@/lib/vuln/scansioni-va-regole";
import { daiConsenso, leggiRegistro, registroCsv, revocaConsenso, sincronizzaRegistro } from "@/lib/vuln/registro-impianti";
import { resetLabNetworkConfig } from "@/lib/lab-config-reset";
import type { EdgeAssessmentProfile } from "@/lib/vuln/edge-profiles";

const CONSENSO: ConsensoRete = { id: 7, chi: "riccardo", riferimento: "Mail", ips: ["10.5.0.2", "10.5.0.3"], dato_il: "2026-11-07 10:00:00", scade_il: "2026-11-07 14:00:00" };
const rete = (x: Partial<ReteScansione> = {}): ReteScansione => ({
  id: 1, nome: "Produzione", cidr: "10.5.0.0/24", vlan: null, hostOnline: 0, sonda: "nota", ultimaVa: null, ultimaVaStato: null,
  attivita: null, piano: null, assessmentId: null, impianti: 2, impiantiEsempi: [], ...x,
});

// 08/11/2026 (Riccardo, tavola 40-44): senza consenso la rete si sceglie lo stesso, con gli impianti esclusi; il
// consenso li include solo nel lancio immediato. Prima la rete senza consenso era bloccata.
test("cosa cambia: senza consenso si sceglie con gli impianti esclusi; il consenso li include solo nel lancio immediato", () => {
  const senza = cosaCambia(rete(), { modo: "immediata", assessmentId: "x" });
  assert.deepEqual([senza.tono, senza.blocca], ["impianto", false]);
  assert.match(senza.testo, /impiant[oi] esclus[oi]/);
  const c = cosaCambia(rete({ consenso: CONSENSO }), { modo: "immediata", assessmentId: "x" });
  assert.deepEqual([c.tono, c.blocca], ["consenso", false]);
  assert.equal(c.testo, "▲ Anche 2 impianti, fino alle 15:00");
  for (const modo of ["pianificata", "finestra"] as const) {
    const p = cosaCambia(rete({ consenso: CONSENSO }), { modo, assessmentId: "x" });
    assert.deepEqual([p.tono, p.blocca], ["impianto", false], modo);
  }
  assert.equal(cosaCambia(rete({ consenso: CONSENSO, attivita: "in_corso" }), { modo: "immediata", assessmentId: "x" }).blocca, true);
});

test("il registro si legge in ora italiana, coi secondi", () => {
  assert.equal(dataRegistro("2026-11-07 17:40:12"), "07/11/2026, 18:40:12");
  assert.equal(dettaglioRegistro("Mail · vale fino al 2026-11-07 21:40:00 UTC"), "Mail · vale fino al 07/11/2026, 22:40:00");
  assert.equal(testoConsenso({ ...CONSENSO, ips: ["10.5.0.2"] }), "▲ Anche 1 impianto, fino alle 15:00");
});

test("quanto vale un consenso, in poche parole (tappa 2)", () => {
  assert.equal(scadenzaConsenso(CONSENSO), "fino a sab 15:00");
  assert.equal(scadenzaConsenso({ ...CONSENSO, valido_dal: "2026-11-08 21:00:00", scade_il: "2026-11-09 05:00:00", in_vigore: false }), "dal dom 22:00 al lun 06:00");
  assert.equal(scadenzaConsenso({ ...CONSENSO, definitivo: true, scade_il: "9999-12-31 23:59:59" }), "definitivo");
  assert.equal(testoConsenso({ ...CONSENSO, definitivo: true, scade_il: "9999-12-31 23:59:59" }), "▲ Anche 2 impianti, consenso definitivo");
});

test("il CSV non fa partire una formula in Excel", () => {
  const riga = { id: 1, at: "2026-11-07 17:40:12", cidr: "10.5.0.0/24", rete: "Produzione", evento: "consenso_dato", chi: "r", scan_id: null, impianti: 2, ips: "", profilo: null, dettaglio: '=HYPERLINK("x");1' };
  const csv = registroCsv([riga]);
  assert.match(csv, /"'=HYPERLINK\(""x""\);1"/);
  assert.match(csv, /Consenso dato/);
});

const TENANT = "CONSENSO";
const ID = ["completo", "interno"].join("-");
const p = (id: string): EdgeAssessmentProfile => ({ id, label: id, image: null, requires_authorization: false, steps: ["a"] });
let server: Server;
let porta = 0;
let lookup: Record<string, unknown>;
let corpi: Array<{ url: string; body: Record<string, unknown> }>;
let righeEdge: Array<Record<string, unknown>>;
let rifiutaConsenso = false;
let sondaVecchia = false;

function db() {
  return getTenantDb(TENANT);
}

const LANCIO = { modo: "immediata", voce: "bilanciato", ambito: "full_subnet", reti: [1], assessment_id: ID } as unknown as Lancio;
const riga = (id: number, x: Record<string, unknown> = {}) => ({
  id, cidr: "10.5.0.0/24", evento: "consenso_dato", chi: "r", consenso_id: 7, scan_id: null, impianti: 2, ips: "10.5.0.2", profilo: null,
  dettaglio: "x", at: `2026-11-07 10:00:${String(id).padStart(2, "0")}`, ...x,
});

before(async () => {
  server = createServer((req, res) => {
    let testo = "";
    req.on("data", (d) => (testo += d));
    req.on("end", () => {
      const url = req.url ?? "";
      const invia = (o: unknown, status = 200) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(o));
      };
      if (req.method === "POST") corpi.push({ url, body: testo ? JSON.parse(testo) : {} });
      if (url.startsWith("/api/v1/profiles")) return invia({ profiles: [p(ID)], total: 1 });
      if (url.startsWith("/api/v1/networks/lookup")) return invia(lookup);
      if (url.startsWith("/api/v1/registro-impianti")) {
        const dopo = Number(new URL(url, "http://x").searchParams.get("dopo"));
        return invia({ righe: righeEdge.filter((r) => Number(r.id) > dopo) });
      }
      if (url.endsWith("/networks/ensure")) return invia({ ok: true, network_id: 9, host_count: 2 });
      if (url.endsWith("/consenso/revoca")) return "consenso" in lookup ? invia({ ok: true }) : invia({ detail: "Not Found" }, 404);
      if (url.endsWith("/consenso") && req.method === "GET") return sondaVecchia ? invia({ consenso: null }) : invia({ consenso: null, prossima_finestra: null, definibili: [] });
      if (url.endsWith("/consenso")) return rifiutaConsenso ? invia({ detail: "Non sono impianti di questa rete: 10.5.0.2" }, 409) : invia({ ok: true, id: 7, consenso: CONSENSO });
      if (url.endsWith("/scan")) return invia({ ok: true, scan_id: 5 });
      return invia({ ok: true });
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  porta = (server.address() as AddressInfo).port;
  withTenant(TENANT, () => {
    const d = db();
    d.prepare("INSERT INTO vuln_scanners (name, base_url, token_encrypted, enabled) VALUES ('edge', ?, ?, 1)").run(`http://127.0.0.1:${porta}`, encrypt("t"));
    d.prepare("INSERT INTO networks (id, cidr, name) VALUES (1, '10.5.0.0/24', 'Produzione')").run();
    for (const [ip, classification] of [["10.5.0.2", "plc"], ["10.5.0.3", "hmi"], ["10.5.0.1", "workstation"]]) {
      d.prepare("INSERT INTO hosts (network_id, ip, classification, status) VALUES (1, ?, ?, 'online')").run(ip, classification);
    }
  });
});

after(async () => {
  await new Promise((r) => server.close(r));
  closeHubDb();
  deleteTenantDatabase(TENANT);
  removeTestHubDb();
});

beforeEach(() => {
  corpi = [];
  righeEdge = [];
  rifiutaConsenso = false;
  sondaVecchia = false;
  lookup = { found: true, network_id: 9, last_scan: null, consenso: null, protetti: ["10.5.0.2", "10.5.0.3"] };
});

// 08/11/2026: senza consenso la rete parte con gli impianti esclusi (non chiede anche_impianti); prima si saltava.
test("lancio: senza consenso la rete con impianti parte senza chiedere gli impianti", async () => {
  await withTenant(TENANT, async () => {
    const r = await lanciaSuReti(LANCIO, "riccardo");
    assert.equal(r.ok && r.esiti[0].esito, "avviata");
    const scan = corpi.find((c) => c.url.endsWith("/scan"));
    assert.ok(scan, "la scansione parte");
    assert.notEqual(scan?.body.anche_impianti, true);
  });
});

test("lancio: col consenso letto da Edge parte con anche_impianti e il nome", async () => {
  lookup.consenso = CONSENSO;
  await withTenant(TENANT, async () => {
    const r = await lanciaSuReti(LANCIO, "riccardo");
    assert.equal(r.ok && r.esiti[0].esito, "avviata");
    const scan = corpi.find((c) => c.url.endsWith("/scan"));
    assert.equal(scan?.body.anche_impianti, true);
    assert.equal(scan?.body.chi, "riccardo");
  });
});

// 08/11/2026: una pianificata non si salta più, ma non porta mai il consenso: gli impianti restano fuori.
test("lancio: pianificata non si salta, e non chiede mai gli impianti anche col consenso", async () => {
  lookup.consenso = CONSENSO;
  await withTenant(TENANT, async () => {
    const l = { ...LANCIO, modo: "pianificata", frequency: "daily", at_time: "02:00" } as unknown as Lancio;
    const r = await lanciaSuReti(l, "riccardo");
    assert.notEqual(r.ok && r.esiti[0].esito, "saltata");
    assert.equal(corpi.some((c) => c.body?.anche_impianti === true), false);
  });
});

test("consenso: gli IP vengono dall'inventario, il rifiuto di Edge arriva con il suo motivo", async () => {
  await withTenant(TENANT, async () => {
    const ok = await daiConsenso(1, { chi: "riccardo", riferimento: "Mail", ore: 4 });
    assert.equal(ok.ok, true);
    const c = corpi.find((x) => x.url.endsWith("/consenso"));
    assert.deepEqual(c?.body.ips, ["10.5.0.2", "10.5.0.3"]);
    rifiutaConsenso = true;
    const no = await daiConsenso(1, { chi: "r", riferimento: "Mail", ore: 4 });
    assert.equal(!no.ok && no.error, "Non sono impianti di questa rete: 10.5.0.2");
  });
});

test("consenso: una rete che la sonda non ha mai visto si registra prima", async () => {
  lookup = { found: false };
  await withTenant(TENANT, async () => {
    const r = await daiConsenso(1, { chi: "riccardo", riferimento: "Mail", ore: 4 });
    assert.equal(r.ok, true);
    assert.equal(corpi.some((c) => c.url.endsWith("/networks/ensure")), true);
  });
});

test("consenso: una sonda vecchia dice di aggiornarsi", async () => {
  lookup = { found: true, network_id: 9 };
  await withTenant(TENANT, async () => {
    const r = await revocaConsenso(1, "r");
    assert.equal(!r.ok && r.daAggiornare, true);
  });
});

// Tappa 2 (Riccardo, 08/11/2026, tavola oggetto 42): il consenso va solo agli impianti selezionati, con una durata.
test("consenso: solo gli impianti scelti, con la durata scelta", async () => {
  await withTenant(TENANT, async () => {
    const r = await daiConsenso(1, { chi: "riccardo", riferimento: "Mail", durata: "finestra", ips: ["10.5.0.3"] });
    assert.equal(r.ok, true);
    const c = corpi.find((x) => x.url.endsWith("/consenso"));
    assert.deepEqual(c?.body.ips, ["10.5.0.3"]);
    assert.equal(c?.body.durata, "finestra");
  });
});

test("consenso: una sonda che non conosce le durate non riceve «finestra» (darebbe 4 ore in silenzio)", async () => {
  sondaVecchia = true;
  await withTenant(TENANT, async () => {
    const r = await daiConsenso(1, { chi: "riccardo", riferimento: "Mail", durata: "finestra", ips: ["10.5.0.3"] });
    assert.equal(!r.ok && r.daAggiornare, true);
    assert.equal(corpi.some((x) => x.url.endsWith("/consenso")), false);
  });
});

test("consenso: un IP scelto che non è un impianto non arriva nemmeno alla sonda", async () => {
  await withTenant(TENANT, async () => {
    const r = await daiConsenso(1, { chi: "riccardo", riferimento: "Mail", durata: "ore", ips: ["10.5.0.3", "10.5.0.1"] });
    assert.equal(!r.ok && r.error, "Non sono impianti di questa rete: 10.5.0.1");
    assert.equal(corpi.some((x) => x.url.endsWith("/consenso")), false);
  });
});

test("un consenso che comincia più tardi non vale per il lancio, ma si vede", () => {
  const futuro = { ...CONSENSO, valido_dal: "2030-11-04 21:00:00", in_vigore: false };
  const letta = reteDaLookup({ found: true, consenso: futuro });
  assert.equal(letta.consenso, null);
  assert.equal(letta.consensoFuturo?.valido_dal, "2030-11-04 21:00:00");
  assert.equal(reteDaLookup({ found: true, consenso: CONSENSO }).consenso?.id, 7, "senza in_vigore (sonda di prima) vale");
});

test("registro: copia, non si raddoppia, non si cancella, una sonda rifatta non si perde", async () => {
  await withTenant(TENANT, async () => {
    righeEdge = [riga(1), riga(2)];
    assert.equal(await sincronizzaRegistro(), 2);
    assert.equal(await sincronizzaRegistro(), 0);
    assert.equal(leggiRegistro()[0].rete, "Produzione");
    assert.throws(() => db().exec(`DELETE FROM va_registro_impianti`), /non si cancella/);
    assert.throws(() => db().exec(`UPDATE va_registro_impianti SET chi='x'`), /non si cambia/);
    // Sonda rifatta, con già più righe di quelle ricordate.
    righeEdge = [1, 2, 3].map((i) => riga(i, { at: `2026-11-08 09:00:0${i}` }));
    assert.equal(await sincronizzaRegistro(), 3);
    assert.equal(leggiRegistro().length, 5);
    assert.equal(await sincronizzaRegistro(), 0);
    // Il reset per nuovo cliente lo svuota, e il blocco torna.
    resetLabNetworkConfig(TENANT);
    assert.equal(leggiRegistro().length, 0);
    righeEdge = [riga(1)];
    assert.equal(await sincronizzaRegistro(), 1);
    assert.throws(() => db().exec(`DELETE FROM va_registro_impianti`), /non si cancella/);
  });
});

test("una rete mai vista dalla sonda non vuol dire sonda vecchia; la chiave assente su una rete nota sì", () => {
  // VLAN 102 di 79993-ipam-2, 07/11/2026: sonda 0.8.264, «Sonda da aggiornare» al posto di Autorizza.
  assert.equal(reteDaLookup({ found: false }).consensoNoto, true);
  assert.equal(reteDaLookup({ found: true, last_scan: null }).consensoNoto, false);
  assert.equal(reteDaLookup({ found: true, last_scan: null, consenso: null }).consensoNoto, true);
});

