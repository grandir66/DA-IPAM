/**
 * Migrazione del riconoscimento degli apparati (piano 2026-11-06): un tenant esistente ha `trunk_vicini` senza i campi
 * nuovi, e `CREATE TABLE IF NOT EXISTS` non glieli porta.
 *
 * Run: node --import tsx --test src/lib/__tests__/riconoscimento-migration.test.ts
 */
import "@/lib/__tests__/support/data-dir-isolata";
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { migrateRiconoscimento } from "@/lib/db-tenant";

const VECCHIA = `CREATE TABLE trunk_vicini (protocollo TEXT NOT NULL, sistema TEXT NOT NULL, porta TEXT NOT NULL,
  vid INTEGER NOT NULL DEFAULT 0, indirizzo TEXT, vlan_nativa INTEGER, ultima_vista TEXT NOT NULL,
  PRIMARY KEY (protocollo, sistema, porta))`;

test("aggiunge colonne e tabella, tiene le righe, la seconda volta non fa niente", () => {
  const db = new Database(":memory:");
  db.exec(VECCHIA);
  db.prepare("INSERT INTO trunk_vicini (protocollo, sistema, porta, ultima_vista) VALUES ('cdp', 'sw', 'gi1', 'ora')").run();
  assert.deepEqual(migrateRiconoscimento(db).sort(), [
    "riconoscimento_tentativi", "trunk_vicini.capacita", "trunk_vicini.host_id", "trunk_vicini.mac",
    "trunk_vicini.piattaforma", "trunk_vicini.versione",
  ]);
  assert.deepEqual(migrateRiconoscimento(db), []);
  const r = db.prepare("SELECT sistema, piattaforma FROM trunk_vicini").get();
  assert.deepEqual(r, { sistema: "sw", piattaforma: null });
  db.close();
});
