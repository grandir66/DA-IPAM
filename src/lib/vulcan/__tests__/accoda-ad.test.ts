/**
 * A-IPAM, Task 3: a fine esecuzione AD Health riuscita l'export va in coda solo se
 * il flusso è acceso (gettone presente) e il tenant corrente è quello dell'invio
 * (caso 2 del piano: hub DA-IPAM multi-tenant). Mai un'eccezione verso il motore.
 *
 * Cartella dati isolata: `support/data-dir-isolata` va importato PER PRIMO.
 */
import "@/lib/__tests__/support/data-dir-isolata";
import { test } from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import Database from "better-sqlite3";
import { migrateVulcanCoda } from "@/lib/db-tenant";
import { TENANT_SCHEMA_SQL } from "@/lib/db-tenant-schema";
import { ensureAdHealthSchema, finishRun, insertFindings, insertRun } from "@/lib/ad/health/persist";
import type { HealthFinding } from "@/lib/ad/health/types";
import type { ConfigVulcan } from "../config";
import { accodaAdHealthSeAcceso, type DipAccodaAd } from "../accoda-ad";

const PRONTA: ConfigVulcan = {
  stato: "pronta",
  url: new URL("https://hub.esempio.invalid"),
  token: "a".repeat(64),
  codcli: "70791",
  nodo: "nodo-1",
  improntaGettone: "0123456789abcdef",
};

const F: HealthFinding = {
  ruleId: "DA-A-GuestEnabled",
  axis: "anomaly",
  points: 20,
  severity: "High",
  title: "Guest account enabled",
  description: "Guest is enabled",
  objectCount: 1,
  sampleDns: ["CN=Guest,CN=Users,DC=esempio,DC=local"],
};

function nuovoDb(): { db: Database.Database; runId: number } {
  const db = new Database(":memory:");
  db.exec(TENANT_SCHEMA_SQL);
  migrateVulcanCoda(db);
  ensureAdHealthSchema(db);
  // Integrazione 7 con nome, DC e credenziali sentinella: nessuno deve finire nel corpo.
  db.prepare(
    `INSERT INTO ad_integrations (id, name, dc_host, domain, base_dn, encrypted_username, encrypted_password)
     VALUES (7, 'SENTINELLA-nome', 'SENTINELLA-dc', 'esempio.local', 'SENTINELLA-dn', 'SENTINELLA-u', 'SENTINELLA-p')`,
  ).run();
  const runId = insertRun(db, { integrationId: 7, startedAt: "2026-10-20T07:58:00.000Z" });
  insertFindings(db, runId, [F]);
  finishRun(db, runId, {
    status: "ok",
    finishedAt: "2026-10-20T08:00:00.000Z",
    score: { global: 35, stale: 0, privileged: 10, trust: 5, anomaly: 35 },
  });
  return { db, runId };
}

const righe = (db: Database.Database) =>
  db.prepare("SELECT tipo, rif, corpo_gz, oggetti FROM vulcan_coda").all() as {
    tipo: string; rif: string; corpo_gz: Buffer; oggetti: number;
  }[];

function dip(over: Partial<DipAccodaAd> = {}): DipAccodaAd {
  return {
    config: () => PRONTA,
    tenantCorrente: () => "70791",
    tenantInvio: () => "70791",
    integrazione: () => ({ domain: "esempio.local" }),
    ...over,
  };
}

/** Cattura console.warn/error durante fn: le righe di diagnostica. */
function conConsole<T>(fn: () => T): { r: T; righe: string[] } {
  const prima = { warn: console.warn, error: console.error };
  const out: string[] = [];
  console.warn = (...a: unknown[]) => out.push(a.map(String).join(" "));
  console.error = (...a: unknown[]) => out.push(a.map(String).join(" "));
  try {
    return { r: fn(), righe: out };
  } finally {
    console.warn = prima.warn;
    console.error = prima.error;
  }
}

test("config spenta → spento, nessuna riga", () => {
  const { db, runId } = nuovoDb();
  assert.equal(accodaAdHealthSeAcceso(db, runId, dip({ config: () => ({ stato: "spento" }) })), "spento");
  assert.equal(righe(db).length, 0);
});

test("config non valida → spento, nessuna riga", () => {
  const { db, runId } = nuovoDb();
  const { r } = conConsole(() =>
    accodaAdHealthSeAcceso(db, runId, dip({ config: () => ({ stato: "non_valida", motivo: "permessi" }) })),
  );
  assert.equal(r, "spento");
  assert.equal(righe(db).length, 0);
});

test("tenant corrente diverso da quello dell'invio → altro_cliente, nessuna riga", () => {
  const { db, runId } = nuovoDb();
  assert.equal(accodaAdHealthSeAcceso(db, runId, dip({ tenantCorrente: () => "DEFAULT" })), "altro_cliente");
  assert.equal(accodaAdHealthSeAcceso(db, runId, dip({ tenantInvio: () => null })), "altro_cliente");
  assert.equal(accodaAdHealthSeAcceso(db, runId, dip({ tenantCorrente: () => null })), "altro_cliente");
  assert.equal(righe(db).length, 0);
});

test("config pronta → una riga ad-health con rif = run id, corpo = export del run", () => {
  const { db, runId } = nuovoDb();
  assert.equal(accodaAdHealthSeAcceso(db, runId, dip()), "accodato");
  const r = righe(db);
  assert.equal(r.length, 1);
  assert.equal(r[0].tipo, "ad-health");
  assert.equal(r[0].rif, String(runId));
  assert.equal(r[0].oggetti, 1);
  const j = JSON.parse(zlib.gunzipSync(r[0].corpo_gz).toString("utf8")) as Record<string, unknown>;
  assert.equal(j.run_id, runId);
  assert.equal(j.integrazione, "ad-7");
  assert.equal(j.codcli, "70791");
  assert.equal(j.domain_fqdn, "esempio.local");
  assert.equal(j.generated_at, "2026-10-20T08:00:00.000Z");
  assert.ok(!zlib.gunzipSync(r[0].corpo_gz).toString("utf8").includes("SENTINELLA"));
});

test("integrazione letta dal DB del run (dipendenza vera) se non sostituita", () => {
  const { db, runId } = nuovoDb();
  const d = dip({ integrazione: (id) => db.prepare("SELECT * FROM ad_integrations WHERE id = ?").get(id) as { domain: string } });
  assert.equal(accodaAdHealthSeAcceso(db, runId, d), "accodato");
  const j = zlib.gunzipSync(righe(db)[0].corpo_gz).toString("utf8");
  assert.ok(!j.includes("SENTINELLA"), "nome, DC, base DN o credenziali nel corpo");
});

test("seconda chiamata sullo stesso run → doppione, sempre una riga", () => {
  const { db, runId } = nuovoDb();
  assert.equal(accodaAdHealthSeAcceso(db, runId, dip()), "accodato");
  assert.equal(accodaAdHealthSeAcceso(db, runId, dip()), "doppione");
  assert.equal(righe(db).length, 1);
});

test("errore finto di getFindings → errore, non lancia, una riga [vulcan] senza dominio", () => {
  const { db, runId } = nuovoDb();
  const { r, righe: log } = conConsole(() =>
    accodaAdHealthSeAcceso(db, runId, dip({ findings: () => { throw new Error("disco pieno"); } })),
  );
  assert.equal(r, "errore");
  assert.equal(righe(db).length, 0);
  assert.equal(log.length, 1);
  assert.match(log[0], new RegExp(`^\\[vulcan\\] AD Health run=${runId} non accodato: `));
  assert.ok(!log[0].includes("esempio.local"));
});

test("errore della config o del tenant → errore, non lancia", () => {
  const { db, runId } = nuovoDb();
  const { r } = conConsole(() => accodaAdHealthSeAcceso(db, runId, dip({ config: () => { throw new Error("x"); } })));
  assert.equal(r, "errore");
  const { r: r2 } = conConsole(() => accodaAdHealthSeAcceso(db, runId, dip({ tenantInvio: () => { throw new Error("x"); } })));
  assert.equal(r2, "errore");
  assert.equal(righe(db).length, 0);
});

test("run inesistente, run non ok, integrazione sparita → errore, nessuna riga", () => {
  const { db, runId } = nuovoDb();
  const a = conConsole(() => accodaAdHealthSeAcceso(db, 9999, dip()));
  assert.equal(a.r, "errore");
  const b = conConsole(() => accodaAdHealthSeAcceso(db, runId, dip({ integrazione: () => undefined })));
  assert.equal(b.r, "errore");
  const id2 = insertRun(db, { integrationId: 7 });
  finishRun(db, id2, { status: "error", errorMessage: "x" });
  const c = conConsole(() => accodaAdHealthSeAcceso(db, id2, dip()));
  assert.equal(c.r, "errore");
  assert.equal(righe(db).length, 0);
});

test("oltre 5.000 regole → errore col motivo, nessuna riga", () => {
  const { db, runId } = nuovoDb();
  const tante = Array.from({ length: 5001 }, (_, i) => ({ ...F, ruleId: `R-${i}` }));
  const { r, righe: log } = conConsole(() => accodaAdHealthSeAcceso(db, runId, dip({ findings: () => tante })));
  assert.equal(r, "errore");
  assert.match(log[0], /5\.000 regole/);
  assert.equal(righe(db).length, 0);
});
