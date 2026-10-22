// src/lib/transfer/__tests__/registry.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { TENANT_SCHEMA_SQL, TENANT_INDEXES_SQL } from "../../db-tenant-schema";
import { HUB_SCHEMA_SQL } from "../../db-hub-schema";
import { migrateLibrenmsFonte, migrateSchedaMikrotik, migrateSwitchVlan, migrateSwitchVlanNativa, migrateVulcanCoda, migrateTopologyPhase1, migrateTopologyPhase2 } from "../../db-tenant";
import {
  TENANT_TABLES,
  HUB_TABLES,
  EXCLUDED_TENANT_TABLES,
  EXCLUDED_HUB_TABLES,
} from "../table-registry";

function realTables(...sqlParts: string[]): string[] {
  const db = new Database(":memory:");
  for (const sql of sqlParts) db.exec(sql);
  // Le tabelle nate nelle migrazioni runtime (topology_maps, revisione finale I6) contano come quelle dello schema.
  if (sqlParts.includes(TENANT_SCHEMA_SQL)) {
    migrateTopologyPhase1(db);
    migrateTopologyPhase2(db);
    migrateSchedaMikrotik(db); // le tabelle della scheda MikroTik nascono solo qui (ADR 0027)
    migrateSwitchVlan(db); // e quelle delle VLAN degli switch (ADR 0029)
    migrateSwitchVlanNativa(db); // e le VLAN native dal controller UniFi (Task 13)
    migrateLibrenmsFonte(db); // e le fotografie di LibreNMS (piano 2026-10-22 LibreNMS)
    migrateVulcanCoda(db); // e la coda degli invii verso DA-Vul-can (piano 2026-10-22)
  }
  const rows = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
    )
    .all() as { name: string }[];
  db.close();
  return rows.map((r) => r.name);
}

test("ogni tabella tenant è classificata o esclusa", () => {
  const real = realTables(TENANT_SCHEMA_SQL, TENANT_INDEXES_SQL);
  const known = new Set([
    ...TENANT_TABLES.map((t) => t.table),
    ...EXCLUDED_TENANT_TABLES,
  ]);
  const missing = real.filter((t) => !known.has(t));
  assert.deepEqual(missing, [], `Tabelle tenant non classificate: ${missing.join(", ")}`);
});

test("ogni tabella hub è classificata o esclusa", () => {
  const real = realTables(HUB_SCHEMA_SQL);
  const known = new Set([
    ...HUB_TABLES.map((t) => t.table),
    ...EXCLUDED_HUB_TABLES,
  ]);
  const missing = real.filter((t) => !known.has(t));
  assert.deepEqual(missing, [], `Tabelle hub non classificate: ${missing.join(", ")}`);
});

test("registry non referenzia tabelle inesistenti", () => {
  const tReal = new Set(realTables(TENANT_SCHEMA_SQL, TENANT_INDEXES_SQL));
  const hReal = new Set(realTables(HUB_SCHEMA_SQL));
  for (const t of TENANT_TABLES) assert.ok(tReal.has(t.table), `tenant table mancante: ${t.table}`);
  for (const t of HUB_TABLES) assert.ok(hReal.has(t.table), `hub table mancante: ${t.table}`);
});
