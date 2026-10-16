// Banco delle scansioni (T3-16): il vero `runDiscovery` gira su un tenant di
// prova con un esecutore finto, e la guardia di rete fa fallire la prova se
// qualcosa esce davvero (ping, socket, DNS, processi esterni).
//
// È lo strumento delle prove di INV-1 (scansioni che si accavallano) e INV-2
// (host vivi spenti): senza un banco così, `runDiscovery` si prova solo
// mandando pacchetti veri.
//
// Hub isolato importato per primo, guardia di rete subito dopo (prima dei
// moduli dello scanner). I tenant stanno in DA_INVENT_DATA_DIR: lanciare con
// una cartella di prova, es.
//   DA_INVENT_DATA_DIR=$(mktemp -d "${TMPDIR:-/tmp}/x.XXXXXX") node --import tsx --test src/lib/scanner/__tests__/esecutore-finto.test.ts
import { removeTestHubDb } from "@/lib/integrations/__tests__/support/hub-isolato";
import { tentativiBloccati, togliGuardiaRete } from "./support/guardia-rete";
import fs from "node:fs";
import path from "node:path";
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { closeHubDb, createTenant } from "@/lib/db-hub";
import { deleteTenantDatabase, getTenantDb, withTenant } from "@/lib/db-tenant";
import { resolveDataDir } from "@/lib/data-dir";
import { getExecutor } from "@/lib/executor";
import { LocalExecutor } from "@/lib/executor/local";
import { discoverNetwork, getScanProgress } from "@/lib/scanner/discovery";
import { creaEsecutoreFinto, installaEsecutoreFinto, togliEsecutoreFinto } from "./support/esecutore-finto";

const T = "TESTBANCOSCAN";

createTenant({
  codice_cliente: T,
  ragione_sociale: "Banco scansioni",
  indirizzo: null,
  citta: null,
  provincia: null,
  cap: null,
  telefono: null,
  email: null,
  piva: null,
  cf: null,
  referente: null,
  note: null,
  active: 1,
});

beforeEach(() => {
  togliEsecutoreFinto();
  deleteTenantDatabase(T);
  tentativiBloccati.length = 0;
});

after(() => {
  togliEsecutoreFinto();
  togliGuardiaRete();
  deleteTenantDatabase(T);
  closeHubDb();
  removeTestHubDb();
});

function db() {
  return getTenantDb(T);
}

/** Rete /29 (6 IP) con un host già noto e acceso, che il giro deve spegnere. */
function preparaRete(): number {
  const d = db();
  const id = Number(
    d.prepare("INSERT INTO networks (cidr, name) VALUES ('10.250.0.0/29', 'banco')").run().lastInsertRowid,
  );
  d.prepare("INSERT INTO hosts (network_id, ip, status) VALUES (?, '10.250.0.5', 'online')").run(id);
  return id;
}

async function attendiFine(scanId: string): Promise<string> {
  const limite = Date.now() + 10_000;
  for (;;) {
    const p = getScanProgress(scanId);
    if (p && p.status !== "running") return p.status;
    if (Date.now() > limite) throw new Error(`scansione ${scanId} ancora in corso dopo 10 s`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

test("discovery «ping» col doppio: gli host prendono gli esiti del doppio e niente esce sulla rete", async () => {
  const reteId = withTenant(T, preparaRete);
  const { override, chiamate } = creaEsecutoreFinto({ vivi: ["10.250.0.1", "10.250.0.2"] });
  installaEsecutoreFinto(override);

  const { id } = await withTenant(T, () => discoverNetwork(reteId, "ping"));
  const esito = await attendiFine(id);

  assert.deepEqual(tentativiBloccati, [], "la scansione ha provato a uscire sulla rete");
  assert.equal(esito, "completed");
  assert.equal(chiamate.pingSweep, 1, "il ping deve passare dal doppio");

  const righe = db()
    .prepare("SELECT ip, status FROM hosts WHERE network_id = ? ORDER BY ip")
    .all(reteId) as Array<{ ip: string; status: string }>;
  assert.deepEqual(righe, [
    { ip: "10.250.0.1", status: "online" },
    { ip: "10.250.0.2", status: "online" },
    { ip: "10.250.0.5", status: "offline" },
  ]);
  const storia = db().prepare("SELECT COUNT(*) AS n FROM scan_history WHERE network_id = ? AND host_id IS NULL AND scan_type = 'ping'").get(reteId) as { n: number };
  assert.equal(storia.n, 1);
  // Niente ripiego sul database legacy: tutto è finito nel tenant.
  assert.equal(fs.existsSync(path.join(resolveDataDir(), "ipam.db")), false);
});

test("getExecutor: senza doppio restituisce l'esecutore normale; col doppio lo legge prima del tenant", () => {
  const normale = getExecutor(T);
  assert.ok(normale instanceof LocalExecutor);
  assert.equal(normale.mode, "local");

  const { override } = creaEsecutoreFinto({ vivi: [] });
  installaEsecutoreFinto(override);
  assert.equal(getExecutor(T), override.executor);
  // Letto in testa: vale anche per un tenant che non esiste.
  assert.equal(getExecutor("TENANT-INESISTENTE"), override.executor);
});

// Il doppio deve saper riprodurre giri lenti, accavallati o in errore: le prove
// di INV-1/INV-2 (T3-17, T3-20, T3-22) forzano l'ordine dei passi.
test("doppio: nmapDiscoverHosts restituisce solo gli host della rete chiesta", async () => {
  const { override } = creaEsecutoreFinto({ vivi: ["10.250.0.5", "10.251.0.7"] });
  const r1 = await override.executor.nmapDiscoverHosts("10.250.0.0/29");
  const r2 = await override.executor.nmapDiscoverHosts("10.251.0.0/29");
  assert.deepEqual(r1.map((h) => h.ip), ["10.250.0.5"]);
  assert.deepEqual(r2.map((h) => h.ip), ["10.251.0.7"]);
});

test("doppio: il cancello trattiene ping e nmap finché la prova non lo apre", async () => {
  let apri!: () => void;
  const cancello = new Promise<void>((r) => { apri = r; });
  const { override } = creaEsecutoreFinto({ vivi: ["10.250.0.5"], cancello });
  let finiti = 0;
  const sweep = override.executor.pingSweep(["10.250.0.5"]).then(() => finiti++);
  const nmap = override.executor.nmapDiscoverHosts("10.250.0.0/29").then(() => finiti++);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(finiti, 0);
  apri();
  await Promise.all([sweep, nmap]);
  assert.equal(finiti, 2);
});

test("doppio: ritardoMs rallenta il giro", async () => {
  const { override } = creaEsecutoreFinto({ vivi: [], ritardoMs: 60 });
  const t0 = Date.now();
  await override.executor.pingSweep(["10.250.0.1"]);
  assert.ok(Date.now() - t0 >= 55, `durata ${Date.now() - t0} ms`);
});

test("doppio: lancia fa fallire ping e nmap con l'errore dato", async () => {
  const errore = new Error("esecutore guasto");
  const { override } = creaEsecutoreFinto({ vivi: [], lancia: errore });
  await assert.rejects(override.executor.pingSweep(["10.250.0.1"]), errore);
  await assert.rejects(override.executor.nmapDiscoverHosts("10.250.0.0/29"), errore);
  await assert.rejects(override.executor.pingHost("10.250.0.1"), errore);
});
