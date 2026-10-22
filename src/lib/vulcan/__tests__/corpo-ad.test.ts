/**
 * A-IPAM, Task 3: il corpo AD Health per l'hub è `toHubExport()` più `run_id`,
 * `integrazione` (alias `ad-<id>`, mai il nome dell'integrazione) e `codcli`.
 * Lo stesso run dà sempre gli stessi byte (doppione per sha256 sull'hub):
 * `generated_at` è la fine del run, mai «adesso».
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import type { AdHealthRunRow } from "@/lib/ad/health/persist";
import type { HealthFinding } from "@/lib/ad/health/types";
import { MAX_REGOLE_AD, corpoAdHealth } from "../corpo-ad";
import { exportSchemaHub } from "./fixtures/schemi-hub";

const RUN: AdHealthRunRow = {
  id: 8,
  integrationId: 7,
  startedAt: "2026-10-20 07:58:00",
  finishedAt: "2026-10-20 08:00:00",
  status: "ok",
  errorMessage: null,
  scoreGlobal: 35,
  scoreStale: 0,
  scorePrivileged: 10,
  scoreTrust: 5,
  scoreAnomaly: 35,
  engineVersion: "x",
  statsJson: null,
  createdAt: "2026-10-20 07:58:00",
};

const FINDINGS: HealthFinding[] = [
  {
    ruleId: "DA-A-GuestEnabled",
    axis: "anomaly",
    points: 20,
    severity: "High",
    title: "Guest account enabled",
    description: "Guest is enabled",
    objectCount: 1,
    sampleDns: ["CN=Guest,CN=Users,DC=esempio,DC=local"],
  },
  {
    ruleId: "DA-A-LdapQueryFailed",
    axis: "anomaly",
    points: 0,
    severity: "Low",
    title: "Query LDAP fallita",
    description: "diagnostica",
    objectCount: 0,
    sampleDns: [],
    diagnostic: true,
  },
];

const ARGS = { run: RUN, findings: FINDINGS, integrazioneId: 7, domainFqdn: "esempio.local", codcli: "70791" };

function ok(r: ReturnType<typeof corpoAdHealth>): { json: string; regole: number } {
  if ("errore" in r) throw new Error(`atteso un corpo, avuto errore: ${r.errore}`);
  return r;
}

test("stesso run due volte → stessi byte, stesso sha256", () => {
  const a = ok(corpoAdHealth(ARGS));
  const b = ok(corpoAdHealth({ ...ARGS, findings: FINDINGS.map((f) => ({ ...f })) }));
  assert.equal(a.json, b.json);
  const sha = (s: string) => crypto.createHash("sha256").update(s, "utf8").digest("hex");
  assert.equal(sha(a.json), sha(b.json));
  assert.equal(a.regole, 2);
});

test("generated_at = fine del run (UTC), non l'ora della prova", () => {
  const j = JSON.parse(ok(corpoAdHealth(ARGS)).json) as Record<string, unknown>;
  assert.equal(j.generated_at, "2026-10-20T08:00:00.000Z");
});

test("run_id, integrazione = ad-<id>, codcli; nessun nome, dc_host, base_dn, encrypted_*", () => {
  const { json } = ok(corpoAdHealth(ARGS));
  const j = JSON.parse(json) as Record<string, unknown>;
  assert.equal(j.run_id, 8);
  assert.equal(j.integrazione, "ad-7");
  assert.equal(j.codcli, "70791");
  assert.equal(j.source, "domarc-ad-health");
  const chiavi = new Set<string>();
  const visita = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(visita);
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { chiavi.add(k); visita(x); }
  };
  visita(j);
  for (const vietata of ["name", "dc_host", "base_dn", "username"]) assert.ok(!chiavi.has(vietata), `chiave ${vietata} nel corpo`);
  assert.ok(![...chiavi].some((k) => k.startsWith("encrypted")), "chiave encrypted_* nel corpo");
});

test("la forma passa lo schema dell'hub (exportSchema di domarc-ad-health)", () => {
  const j = JSON.parse(ok(corpoAdHealth(ARGS)).json) as unknown;
  const r = exportSchemaHub.safeParse(j);
  assert.ok(r.success, r.success ? "" : JSON.stringify(r.error.issues.slice(0, 3)));
});

test("chiavi in ordine fisso: l'export prima, poi run_id, integrazione, codcli", () => {
  const j = JSON.parse(ok(corpoAdHealth(ARGS)).json) as Record<string, unknown>;
  assert.deepEqual(Object.keys(j), [
    "source", "domain_fqdn", "engine_version", "generated_at", "scores", "findings", "run_id", "integrazione", "codcli",
  ]);
});

test("oltre 5.000 regole → errore, niente corpo", () => {
  assert.equal(MAX_REGOLE_AD, 5000);
  const tante = Array.from({ length: 5001 }, (_, i) => ({ ...FINDINGS[0], ruleId: `R-${i}` }));
  const r = corpoAdHealth({ ...ARGS, findings: tante });
  assert.ok("errore" in r);
  assert.match(r.errore, /5\.000 regole/);
  assert.ok("json" in corpoAdHealth({ ...ARGS, findings: tante.slice(0, 5000) }));
});

test("run senza fine o senza punteggio → errore", () => {
  assert.ok("errore" in corpoAdHealth({ ...ARGS, run: { ...RUN, finishedAt: null } }));
  assert.ok("errore" in corpoAdHealth({ ...ARGS, run: { ...RUN, scoreGlobal: null } }));
  assert.ok("errore" in corpoAdHealth({ ...ARGS, run: { ...RUN, finishedAt: "non è una data" } }));
});
