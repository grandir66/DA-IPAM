import { TEST_DATA_DIR } from "./support/data-dir-isolata";

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { getDb, closeDb } from "@/lib/db";
import { withTenant, getTenantDb, closeAllTenantDbs, TenantContextError } from "@/lib/db-tenant";
import { getHubDb, closeHubDb, createTenant } from "@/lib/db-hub";
import { contaRipieghi, riepilogoRipieghi, DIR_REGISTRO_RIPIEGHI } from "@/lib/db-maintenance/ripieghi";
import { GET as healthGet } from "@/app/api/health/route";

/**
 * NUC-1, fase A. INCIDENTE 2026-09-02: con il contesto tenant perso, `getDb()`
 * ripiegava in silenzio su DEFAULT e 179 host di un tenant finirono in
 * DEFAULT.db, senza un allarme. Qui si prova che:
 *   - un tenant che NON si apre è un errore, non una scrittura su DEFAULT;
 *   - ogni accesso senza contesto (DEFAULT o ipam.db legacy) lascia una riga
 *     nel registro persistente, deduplicata e con lo stack una volta sola;
 *   - /api/health (pubblico) non dipende da `getDb()` e dà solo un numero.
 */

const DEFAULT_PATH = path.join(TEST_DATA_DIR, "tenants", "DEFAULT.db");

function righeRegistro(): Array<Record<string, unknown>> {
  if (!fs.existsSync(DIR_REGISTRO_RIPIEGHI())) return [];
  const out: Array<Record<string, unknown>> = [];
  for (const f of fs.readdirSync(DIR_REGISTRO_RIPIEGHI())) {
    for (const riga of fs.readFileSync(path.join(DIR_REGISTRO_RIPIEGHI(), f), "utf8").split("\n")) {
      if (riga.trim()) out.push(JSON.parse(riga) as Record<string, unknown>);
    }
  }
  return out;
}

after(() => {
  closeDb();
  closeAllTenantDbs();
  closeHubDb();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

test("hub presente, DEFAULT assente: getDb() senza contesto apre il legacy e lo registra", () => {
  getHubDb(); // crea hub.db nella cartella di prova
  assert.ok(fs.existsSync(path.join(TEST_DATA_DIR, "hub.db")));
  assert.ok(!fs.existsSync(DEFAULT_PATH));
  const prima = contaRipieghi();
  getDb().prepare("SELECT 1").get(); // apre ipam.db: l'inizializzazione può richiamare il facade
  assert.ok(contaRipieghi() > prima);
  const aRegime = contaRipieghi();
  getDb();
  assert.equal(contaRipieghi(), aRegime + 1);
  const legacy = righeRegistro().filter((r) => r.caso === "legacy");
  assert.ok(legacy.length >= 1, "manca la riga del ripiego legacy nel registro persistente");
  assert.match(String(legacy[0].firma), /db-facade-fail-closed/);
});

test("tenant non registrato nell'hub: contato prima che getTenantDb crei il file (fase A: il file nasce ancora)", () => {
  const prima = riepilogoRipieghi().per_caso.tenant_non_registrato ?? 0;
  getTenantDb("NONREGISTRATO");
  assert.equal(riepilogoRipieghi().per_caso.tenant_non_registrato, prima + 1);
  assert.ok(fs.existsSync(path.join(TEST_DATA_DIR, "tenants", "NONREGISTRATO.db")));
  assert.ok(righeRegistro().some((r) => r.caso === "tenant_non_registrato" && r.tenant === "NONREGISTRATO"));

  // Un tenant registrato non si conta.
  createTenant({ codice_cliente: "REGISTRATO", ragione_sociale: "Prova", active: 1 } as Parameters<typeof createTenant>[0]);
  getTenantDb("REGISTRATO");
  assert.equal(riepilogoRipieghi().per_caso.tenant_non_registrato, prima + 1);
});

test("un tenant che non si apre è un errore, non una scrittura su DEFAULT", () => {
  const def = getTenantDb("DEFAULT");
  def.exec("CREATE TABLE IF NOT EXISTS segno (n INTEGER)");
  const righePrima = (def.prepare("SELECT COUNT(*) AS c FROM segno").get() as { c: number }).c;

  // "../hub" fa fallire getTenantDb (contenimento del percorso).
  assert.throws(
    () => withTenant("../hub", () => getDb().prepare("INSERT INTO segno (n) VALUES (1)").run()),
    (e: unknown) => e instanceof Error && e.name === "TenantContextError",
  );
  assert.equal((def.prepare("SELECT COUNT(*) AS c FROM segno").get() as { c: number }).c, righePrima);
  assert.equal(typeof TenantContextError, "function");
});

test("hub e DEFAULT presenti: getDb() senza contesto va ancora su DEFAULT (fase A) ma si registra", () => {
  assert.ok(fs.existsSync(DEFAULT_PATH));
  const prima = riepilogoRipieghi().per_caso.default ?? 0;
  const db = getDb();
  assert.equal(db, getTenantDb("DEFAULT"));
  assert.equal(riepilogoRipieghi().per_caso.default, prima + 1);
  assert.ok(righeRegistro().some((r) => r.caso === "default"));
});

test("mille chiamate dallo stesso punto: una sola riga di stack, righe del registro limitate", () => {
  for (let i = 0; i < 1000; i++) getDb();
  const righe = righeRegistro().filter((r) => r.caso === "default");
  const firme = new Set(righe.map((r) => r.firma));
  const stackPerFirma = new Map<unknown, number>();
  for (const r of righe) if (r.tipo === "stack") stackPerFirma.set(r.firma, (stackPerFirma.get(r.firma) ?? 0) + 1);
  for (const [firma, n] of stackPerFirma) assert.equal(n, 1, `stack ripetuto per ${String(firma)}`);
  // per firma: uno stack + al più una riga per ordine di grandezza (1, 10, 100, 1000)
  assert.ok(righe.length <= firme.size * 6, `troppe righe nel registro: ${righe.length}`);
  const totale = riepilogoRipieghi().chiamanti.reduce((s, c) => s + c.n, 0);
  assert.ok(totale >= 1001);
});

test("/api/health non usa getDb(), è pubblico e dà solo il numero dei ripieghi", async () => {
  const prima = contaRipieghi();
  const res = await healthGet(new Request("http://localhost/api/health"));
  const testo = await res.text();
  assert.equal(contaRipieghi(), prima, "il probe di salute è passato da getDb()");
  const corpo = JSON.parse(testo) as Record<string, unknown>;
  assert.equal(corpo.db, "ok");
  assert.equal(corpo.ripieghi, prima);
  assert.doesNotMatch(testo, /stack|firma|db-facade-fail-closed|\.ts:/i);
});
