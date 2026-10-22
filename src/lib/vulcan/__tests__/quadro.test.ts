/**
 * A-IPAM, Task 8: lo stato dell'invio verso DA-Vul-can come lo mostra «Cosa esce» e la
 * pagina AD. Letto dal sistema vivo (config + coda), mai da file del repo; spento si
 * dice anche quando non parte niente. Mai il gettone, mai l'URL completo.
 *
 * Run: DA_INVENT_DATA_DIR=$(mktemp -d) node --import tsx --test src/lib/vulcan/__tests__/quadro.test.ts
 */
import "@/lib/__tests__/support/data-dir-isolata";
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { migrateVulcanCoda } from "@/lib/db-tenant";
import { TENANT_SCHEMA_SQL } from "@/lib/db-tenant-schema";
import { accoda, scriviStatoVulcan, segnaInviato, segnaScartato } from "../coda";
import type { ConfigVulcan } from "../config";
import { quadroVulcan, statoInvioAd } from "../quadro";

const TOKEN = "Zk3".repeat(16);
const PRONTA: ConfigVulcan = {
  stato: "pronta",
  url: new URL("https://da-vulcan.example.test"),
  token: TOKEN,
  codcli: "70791",
  nodo: "70791-ipam",
  improntaGettone: "0123456789abcdef",
};

function nuovoDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(TENANT_SCHEMA_SQL);
  migrateVulcanCoda(db);
  return db;
}

test("spento: lo dice, coda a zero, senza aprire il DB", () => {
  let aperto = 0;
  const q = quadroVulcan({ config: () => ({ stato: "spento" }), db: () => (aperto++, nuovoDb()) });
  assert.equal(q.stato, "spento");
  assert.deepEqual(q.coda, { in_attesa: 0, falliti: 0 });
  assert.equal(q.destinazione, null);
  assert.equal(aperto, 0);
});

test("non valida: il motivo, senza DB", () => {
  let aperto = 0;
  const q = quadroVulcan({ config: () => ({ stato: "non_valida", motivo: "VULCAN_URL deve essere https" }), db: () => (aperto++, null) });
  assert.equal(q.stato, "non_valida");
  assert.equal(q.motivo, "VULCAN_URL deve essere https");
  assert.equal(aperto, 0);
});

test("cliente assente sull'istanza: non valida col motivo", () => {
  const q = quadroVulcan({ config: () => PRONTA, db: () => null });
  assert.equal(q.stato, "non_valida");
  assert.match(q.motivo ?? "", /cliente non presente/);
});

test("attivo: conteggi, ultimi invii, ultimo errore, battito; mai il gettone", () => {
  const db = nuovoDb();
  const ora = new Date("2026-10-22T08:00:00Z");
  const ad = accoda(db, { tipo: "ad-health", rif: "8", json: '{"r":8}', oggetti: 12 });
  segnaInviato(db, ad.id, "272", ora);
  const inv = accoda(db, { tipo: "inventario", rif: null, json: '{"i":1}', oggetti: 340 });
  segnaInviato(db, inv.id, "5", ora);
  const ko = accoda(db, { tipo: "inventario", rif: null, json: '{"i":2}', oggetti: 341 });
  segnaScartato(db, ko.id, "http_404", "l'hub non riceve ancora l'inventario (404): scartato", ora);
  accoda(db, { tipo: "ad-health", rif: "9", json: '{"r":9}', oggetti: 3 });
  const f = accoda(db, { tipo: "ad-health", rif: "10", json: '{"r":10}', oggetti: 3 });
  db.prepare("UPDATE vulcan_coda SET stato = 'fallito' WHERE id = ?").run(f.id);
  scriviStatoVulcan(db, { battito_il: "2026-10-22 08:00:00", battito_esito: "ok" });

  const q = quadroVulcan({ config: () => PRONTA, db: () => db });
  assert.equal(q.stato, "attivo");
  assert.equal(q.destinazione, "da-vulcan.example.test");
  assert.deepEqual(q.coda, { in_attesa: 1, falliti: 1 });
  assert.deepEqual(q.battito, { il: "2026-10-22 08:00:00", esito: "ok" });
  assert.equal(q.ultimo_ad?.report_id, "272");
  assert.equal(q.ultimo_inventario?.oggetti, 340);
  assert.equal(q.ultimo_errore?.tipo, "inventario");
  assert.match(q.ultimo_errore?.errore ?? "", /404/);
  assert.ok(!JSON.stringify(q).includes(TOKEN));
  assert.ok(!JSON.stringify(q).includes("https://"));
});

test("sospeso per questo gettone: stato sospeso col motivo; gettone diverso → attivo", () => {
  const db = nuovoDb();
  scriviStatoVulcan(db, { sospeso_gettone: PRONTA.stato === "pronta" ? PRONTA.improntaGettone : "", sospeso_motivo: "l'hub ha rifiutato il gettone (401)" });
  let q = quadroVulcan({ config: () => PRONTA, db: () => db });
  assert.equal(q.stato, "sospeso");
  assert.match(q.motivo ?? "", /401/);
  q = quadroVulcan({ config: () => ({ ...PRONTA, improntaGettone: "ffffffffffffffff" }) as ConfigVulcan, db: () => db });
  assert.equal(q.stato, "attivo");
});

const STESSO = { config: () => PRONTA, tenantCorrente: () => "70791", tenantInvio: () => "70791" };

test("riga della pagina AD: un tenant che non è il cliente dell'invio lo dice, anche con righe in coda", () => {
  const db = nuovoDb();
  accoda(db, { tipo: "ad-health", rif: "8", json: '{"r":8}', oggetti: 1 });
  const altro = { config: () => PRONTA, tenantCorrente: () => "12345", tenantInvio: () => "70791" };
  assert.deepEqual(statoInvioAd(db, 8, altro), { stato: "altro_cliente", il: null, motivo: null });
  assert.equal(statoInvioAd(db, 8, { ...altro, tenantInvio: () => null })?.stato, "altro_cliente");
  assert.equal(statoInvioAd(db, 8, STESSO)?.stato, "in_coda");
});

test("riga della pagina AD: spento, mai, in coda, inviato, scartato, fallito", () => {
  const db = nuovoDb();
  const ora = new Date("2026-10-22T08:00:00Z");
  assert.deepEqual(statoInvioAd(db, 8, { config: () => ({ stato: "spento" }) }), { stato: "spento", il: null, motivo: null });
  assert.equal(statoInvioAd(db, 8, STESSO), null);
  const r = accoda(db, { tipo: "ad-health", rif: "8", json: '{"r":8}', oggetti: 1 });
  assert.equal(statoInvioAd(db, 8, STESSO)?.stato, "in_coda");
  segnaInviato(db, r.id, "272", ora);
  assert.deepEqual(statoInvioAd(db, 8, STESSO), { stato: "inviato", il: "2026-10-22 08:00:00", motivo: null });
  const s = accoda(db, { tipo: "ad-health", rif: "9", json: '{"r":9}', oggetti: 1 });
  segnaScartato(db, s.id, "http_422", "l'hub ha rifiutato la forma dei dati (422): scartato", ora);
  assert.equal(statoInvioAd(db, 9, STESSO)?.stato, "scartato");
  assert.match(statoInvioAd(db, 9, STESSO)?.motivo ?? "", /422/);
  const f = accoda(db, { tipo: "ad-health", rif: "10", json: '{"r":10}', oggetti: 1 });
  db.prepare("UPDATE vulcan_coda SET stato = 'fallito', ultimo_errore = 'ricezione spenta' WHERE id = ?").run(f.id);
  assert.equal(statoInvioAd(db, 10, STESSO)?.stato, "fallito");
});
