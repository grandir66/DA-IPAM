import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { applyClassificationDecision } from "../persist";
import type { ClassificationDecision } from "../types";
import { ENGINE_VERSION } from "../types";

function memDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE hosts (
      id INTEGER PRIMARY KEY,
      classification TEXT,
      classification_manual INTEGER DEFAULT 0,
      inferred_confidence INTEGER DEFAULT 0,
      classification_reason TEXT,
      classification_json TEXT
    );
    CREATE TABLE host_classification_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      host_id INTEGER NOT NULL,
      at TEXT NOT NULL DEFAULT (datetime('now')),
      classification TEXT,
      confidence INTEGER NOT NULL DEFAULT 0,
      reason TEXT,
      evidence_json TEXT,
      conflicts_json TEXT,
      trigger TEXT NOT NULL
    );
  `);
  db.prepare("INSERT INTO hosts (id, classification, inferred_confidence) VALUES (1, 'unknown', 0)").run();
  return db;
}

test("persist upgrades classification and writes history", () => {
  const db = memDb();
  const decision: ClassificationDecision = {
    classification: "hypervisor",
    confidence: 93,
    reason: "ESXi UI",
    evidence: [],
    conflicts: [],
    fingerprint_hash: "abc",
    engine_version: ENGINE_VERSION,
    sources: ["http"],
  };
  const r = applyClassificationDecision(db, 1, decision, {
    classification_manual: false,
    previous_classification: "unknown",
    previous_confidence: 0,
    trigger: "scan",
  });
  assert.equal(r.touchedClassification, true);
  assert.equal(r.historyAppended, true);
  const row = db.prepare("SELECT classification, inferred_confidence, classification_reason FROM hosts WHERE id=1").get() as {
    classification: string; inferred_confidence: number; classification_reason: string;
  };
  assert.equal(row.classification, "hypervisor");
  assert.equal(row.inferred_confidence, 93);
  assert.equal(row.classification_reason, "ESXi UI");
});

test("manual lock updates reason/json but not classification", () => {
  const db = memDb();
  db.prepare("UPDATE hosts SET classification='workstation', classification_manual=1, inferred_confidence=80 WHERE id=1").run();
  const decision: ClassificationDecision = {
    classification: "switch",
    confidence: 95,
    reason: "SNMP",
    evidence: [],
    conflicts: [],
    fingerprint_hash: "x",
    engine_version: ENGINE_VERSION,
    sources: ["snmp"],
  };
  const r = applyClassificationDecision(db, 1, decision, {
    classification_manual: true,
    previous_classification: "workstation",
    previous_confidence: 80,
    trigger: "scan",
  });
  assert.equal(r.touchedClassification, false);
  const row = db.prepare(
    "SELECT classification, inferred_confidence, classification_reason, classification_json FROM hosts WHERE id=1"
  ).get() as {
    classification: string;
    inferred_confidence: number;
    classification_reason: string;
    classification_json: string;
  };
  assert.equal(row.classification, "workstation");
  assert.equal(row.inferred_confidence, 95);
  assert.equal(row.classification_reason, "SNMP");
  assert.ok(row.classification_json != null && row.classification_json.length > 0);
  const json = JSON.parse(row.classification_json) as {
    fingerprint_hash: string;
    engine_version: string;
    sources: string[];
  };
  assert.equal(json.fingerprint_hash, "x");
  assert.equal(json.engine_version, ENGINE_VERSION);
  assert.deepEqual(json.sources, ["snmp"]);
});
