/**
 * Lancio dei gruppi dalle proposte confermate (piano profili-per-device, Passo 4, 06/11/2026).
 *
 * Perché: al 72729 nove PLC sono spariti dentro una scansione della loro rete (05-06/11/2026; la causa
 * NON è accertata). Il lancio rilegge le conferme dal database e gli host com'è oggi: un impianto
 * confermato per errore (o diventato impianto dopo la conferma) non deve arrivare alla sonda. Il primo
 * «da aggiornare» ferma tutto: nessun gruppo dopo, nessun ripiego. Il freno di Edge resta sotto.
 * La guardia della rotta (solo admin, auth prima di tutto) non si prova chiamando `auth()`: `mock.module`
 * non gira sotto Node 22 con tsx. La provano il censimento delle rotte e il lucchetto sul sorgente qui sotto.
 *
 * Run: DA_INVENT_DATA_DIR=$(mktemp -d) node --import tsx --test src/lib/vuln/proposta/__tests__/lancio.test.ts
 */
import "@/lib/vuln/__tests__/support/dati-isolati";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { withTenant, getTenantDb, deleteTenantDatabase } from "@/lib/db-tenant";
import { closeHubDb } from "@/lib/db-hub";
import { rilevaGestori } from "@/lib/permessi/rilevatore-guardie";
import { lanciaGruppiConfermati, type DipendenzeLancio } from "@/lib/vuln/proposta/lancio";
import type { EsitoGruppoEdge, GruppoPerEdge } from "@/lib/vuln/gruppi-edge";
import type { EdgeAssessmentProfile } from "@/lib/vuln/edge-profiles";

const T = "TESTLANCIO06";
let k = 0;
const CATALOGO: EdgeAssessmentProfile[] = [
  { id: "smoke-interno", label: "Smoke interno", image: "advanced", requires_authorization: false, steps: ["service-fp"] },
  { id: "completo-interno", label: "Completo interno", image: "advanced", requires_authorization: false, steps: ["service-fp", "snmp-enum"] },
];

after(() => {
  try { deleteTenantDatabase(T); } catch { /* già tolto */ }
  closeHubDb();
});

/** Rete con: un PC Windows e un router (proposti e confermati), un server Linux, un PLC CONFERMATO PER ERRORE come «rete». */
async function preparaRete(): Promise<{ rete: number; plc: string }> {
  return withTenant(T, async () => {
    const d = getTenantDb(T);
    const rete = Number(d.prepare("INSERT INTO networks (cidr, name) VALUES (?, 'x')").run(`10.7.${++k}.0/24`).lastInsertRowid);
    const h = d.prepare("INSERT INTO hosts (network_id, ip, status, classification, vendor, os_info) VALUES (?, ?, 'online', ?, ?, ?)");
    const id = (ip: string, cls: string, vendor: string | null, os: string | null = null) => Number(h.run(rete, ip, cls, vendor, os).lastInsertRowid);
    const win = id("10.7.0.11", "workstation", "Dell Inc.", "Windows 11 Pro");
    const router = id("10.7.0.1", "router", "MikroTik");
    const linux = id("10.7.0.21", "server_linux", null, "Ubuntu 22.04 Linux");
    const plc = id("10.7.0.50", "plc", "CREVIS Co., LTD");
    const p = d.prepare(
      `INSERT INTO va_proposte (host_id, famiglia, voce, con_web, confidenza, motivo, stato, da_rivedere, confermata_da, confermata_il, aggiornata_il)
       VALUES (?, ?, ?, 0, 'alta', 'prova', 'confermato', 0, 'admin', datetime('now'), datetime('now'))`,
    );
    p.run(win, "windows", "bilanciato");
    p.run(router, "rete", "bilanciato");
    p.run(linux, "linux", "bilanciato");
    p.run(plc, "rete", "bilanciato"); // l'errore: un PLC dentro un gruppo di rete
    return { rete, plc: "10.7.0.50" };
  });
}

function avviaFinto(esiti: Array<EsitoGruppoEdge | undefined> = []) {
  const chiamate: GruppoPerEdge[] = [];
  const f: DipendenzeLancio["avvia"] = async (_rete, g) => {
    chiamate.push(g);
    return esiti[chiamate.length - 1] ?? { stato: "lanciato", scan_id: 100 + chiamate.length, status: "pending", ip_tolti: [] };
  };
  return { f, chiamate };
}
const catalogo: DipendenzeLancio["catalogo"] = async () => ({ profili: CATALOGO, avviso: null });

test("un impianto confermato per errore non arriva alla sonda, e si dice perché", async () => {
  const { rete, plc } = await preparaRete();
  const { f, chiamate } = avviaFinto();
  const e = await withTenant(T, () => lanciaGruppiConfermati(rete, { avvia: f, catalogo }));
  const inviati = chiamate.flatMap((g) => g.ips);
  assert.ok(!inviati.includes(plc), `il PLC è stato mandato: ${inviati}`);
  assert.deepEqual(inviati.sort(), ["10.7.0.1", "10.7.0.11", "10.7.0.21"]);
  assert.equal(e.tolti.length, 1);
  assert.equal(e.tolti[0].ip, plc);
  assert.match(e.tolti[0].motivo, /impianto/i);
  assert.equal(e.fermato, false);
  assert.deepEqual(e.gruppi.map((g) => [g.famiglia, g.esito.stato]), [["rete", "lanciato"], ["windows", "lanciato"], ["linux", "lanciato"]]);
});

test("il corpo mandato a Edge ha solo i campi del contratto (niente famiglia)", async () => {
  const { rete } = await preparaRete();
  const { f, chiamate } = avviaFinto();
  await withTenant(T, () => lanciaGruppiConfermati(rete, { avvia: f, catalogo }));
  for (const g of chiamate) assert.deepEqual(Object.keys(g).sort(), ["assessment_profile_id", "ips", "nuclei_profilo", "profile"]);
});

test("il primo «da aggiornare» ferma tutto: nessun altro gruppo parte", async () => {
  const { rete } = await preparaRete();
  const { f, chiamate } = avviaFinto([{ stato: "da_aggiornare" }]);
  const e = await withTenant(T, () => lanciaGruppiConfermati(rete, { avvia: f, catalogo }));
  assert.equal(chiamate.length, 1, "un solo tentativo");
  assert.equal(e.fermato, true);
  assert.deepEqual(e.gruppi.map((g) => g.esito.stato), ["da_aggiornare", "non_tentato", "non_tentato"]);
});

test("se si ferma al secondo, il primo resta lanciato e il terzo non parte", async () => {
  const { rete } = await preparaRete();
  const { f, chiamate } = avviaFinto([undefined, { stato: "da_aggiornare" }]);
  const e = await withTenant(T, () => lanciaGruppiConfermati(rete, { avvia: f, catalogo }));
  assert.equal(chiamate.length, 2);
  assert.deepEqual(e.gruppi.map((g) => g.esito.stato), ["lanciato", "da_aggiornare", "non_tentato"]);
});

test("«non so» (timeout) e guasti a monte fermano; un gruppo rifiutato con 422 non ferma gli altri", async () => {
  const { rete } = await preparaRete();
  const a = avviaFinto([{ stato: "non_so", messaggio: "timeout" }]);
  const ea = await withTenant(T, () => lanciaGruppiConfermati(rete, { avvia: a.f, catalogo }));
  assert.equal(a.chiamate.length, 1);
  assert.equal(ea.fermato, true);
  const b = avviaFinto([{ stato: "rifiutato", status: 422, messaggio: "IP fuori dalla rete" }]);
  const eb = await withTenant(T, () => lanciaGruppiConfermati(rete, { avvia: b.f, catalogo }));
  assert.equal(b.chiamate.length, 3);
  assert.equal(eb.fermato, false);
  assert.equal(eb.gruppi[0].esito.stato, "rifiutato");
});

test("catalogo illeggibile per un errore: il lancio non parte e dice il motivo", async () => {
  const { rete } = await preparaRete();
  const { f, chiamate } = avviaFinto();
  const e = await withTenant(T, () =>
    lanciaGruppiConfermati(rete, { avvia: f, catalogo: async () => ({ profili: [], avviso: null, errore: "Profili assessment non letti dalla sonda (timeout)" }) }));
  assert.equal(chiamate.length, 0, "nessun gruppo parte");
  assert.match(e.errore ?? "", /timeout/);
  assert.deepEqual(e.gruppi, []);
});

test("catalogo letto e davvero vuoto: i gruppi partono senza assessment, con un avviso", async () => {
  const { rete } = await preparaRete();
  const { f, chiamate } = avviaFinto();
  const e = await withTenant(T, () => lanciaGruppiConfermati(rete, { avvia: f, catalogo: async () => ({ profili: [], avviso: null }) }));
  assert.equal(chiamate.length, 3);
  assert.ok(chiamate.every((g) => g.assessment_profile_id === null));
  assert.equal(e.errore, null);
  assert.ok(e.avvisi.some((a) => /vuoto/i.test(a)));
});

test("un modulo ignoto nel profilo di Rete o Windows: il gruppo parte senza assessment e l'avviso arriva", async () => {
  const { rete } = await preparaRete();
  const { f, chiamate } = avviaFinto();
  const nuovo = CATALOGO.map((p) => (p.id === "smoke-interno" ? { ...p, steps: ["service-fp", "modulo-mai-visto"] } : p));
  const e = await withTenant(T, () => lanciaGruppiConfermati(rete, { avvia: f, catalogo: async () => ({ profili: nuovo, avviso: null }) }));
  assert.equal(chiamate.length, 3);
  assert.deepEqual(chiamate.map((g) => g.assessment_profile_id), [null, null, "completo-interno"]);
  assert.ok(e.avvisi.some((a) => /assessment/i.test(a)));
});

test("tipo cambiato dopo la conferma: l'host resta fuori e compare in tolti, la riga non si riscrive", async () => {
  const { rete } = await preparaRete();
  await withTenant(T, async () => {
    // il PC Windows confermato ora non ha più né sistema né tipo noti; il server Linux è diventato conteso
    getTenantDb(T).prepare("UPDATE hosts SET classification='unknown', os_info=NULL, vendor=NULL WHERE ip='10.7.0.11' AND network_id=?").run(rete);
  });
  const conteso = await withTenant(T, async () => Number((getTenantDb(T).prepare("SELECT id FROM hosts WHERE ip='10.7.0.21' AND network_id=?").get(rete) as { id: number }).id));
  const prima = await withTenant(T, async () => getTenantDb(T).prepare("SELECT host_id, famiglia, stato FROM va_proposte ORDER BY host_id").all());
  const { f, chiamate } = avviaFinto();
  const e = await withTenant(T, () =>
    lanciaGruppiConfermati(rete, { avvia: f, catalogo, contesi: () => new Set([conteso]) }));
  assert.deepEqual(chiamate.flatMap((g) => g.ips), ["10.7.0.1"], "parte solo il router");
  const cambiati = e.tolti.filter((t) => /tipo cambiato, da rivedere/.test(t.motivo)).map((t) => t.ip).sort();
  assert.deepEqual(cambiati, ["10.7.0.11", "10.7.0.21"]);
  const dopo = await withTenant(T, async () => getTenantDb(T).prepare("SELECT host_id, famiglia, stato FROM va_proposte ORDER BY host_id").all());
  assert.deepEqual(dopo, prima, "il lancio non riscrive va_proposte");
});

test("«già in corso» non ferma gli altri gruppi: non è un guasto", async () => {
  const { rete } = await preparaRete();
  const { f, chiamate } = avviaFinto([{ stato: "gia_in_corso", scan_id: 7, messaggio: "già in corso" }]);
  const e = await withTenant(T, () => lanciaGruppiConfermati(rete, { avvia: f, catalogo }));
  assert.equal(chiamate.length, 3);
  assert.equal(e.fermato, false);
  assert.equal(e.gruppi[0].esito.stato, "gia_in_corso");
});

test("nessuna proposta confermata: nessun lancio, e lo dice", async () => {
  const rete = await withTenant(T, async () =>
    Number(getTenantDb(T).prepare("INSERT INTO networks (cidr, name) VALUES ('10.8.0.0/24', 'vuota')").run().lastInsertRowid));
  const { f, chiamate } = avviaFinto();
  const e = await withTenant(T, () => lanciaGruppiConfermati(rete, { avvia: f, catalogo }));
  assert.equal(chiamate.length, 0);
  assert.deepEqual(e.gruppi, []);
  assert.ok(e.avvisi.length > 0);
});

// --- la rotta: guardia e forma, dal sorgente (vedi la nota in testa) -----------------------------

const ROTTA = join(process.cwd(), "src/app/api/networks/[id]/proposte-va/lancia/route.ts");

test("la rotta lancia solo con l'amministratore, e l'auth viene prima di tutto", () => {
  const src = readFileSync(ROTTA, "utf8");
  const g = rilevaGestori(src).map((x) => [x.metodo, x.guardia]);
  assert.deepEqual(g, [["POST", "admin"]]);
  const corpo = src.slice(src.search(/export\s+async\s+function\s+POST\b/));
  const auth = corpo.indexOf("requireAdmin()");
  const tenant = corpo.indexOf("withTenantFromSession(");
  const lancio = corpo.indexOf("lanciaGruppiConfermati(");
  assert.ok(auth > 0 && tenant > auth && lancio > tenant, "requireAdmin, poi il tenant, poi il lancio");
});

test("la rotta non si fida del client e non ripiega sulla rete intera", () => {
  const src = readFileSync(ROTTA, "utf8");
  assert.doesNotMatch(src, /\.json\(\)/, "gli IP non arrivano dal corpo della richiesta: si rileggono dal database");
  assert.doesNotMatch(src, /triggerSubnetEdgeScan|edge-scan|\/scan\b/, "mai la scansione della rete intera");
});
