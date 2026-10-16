import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AUDIT_SUBCATEGORIES,
  auditGaps,
  parseAuditpolCsv,
  type AuditSetting,
} from "../audit-policy";

const HEADER =
  "Machine Name,Policy Target,Subcategory,Subcategory GUID,Inclusion Setting,Exclusion Setting";

function csv(rows: string[]): string {
  return [HEADER, ...rows].join("\r\n");
}

test("parses the auditpol CSV keyed by subcategory GUID", () => {
  const raw = csv([
    'DC01,System,Logon,{0CCE9215-69AE-11D9-BED3-505054503030},Success and Failure,',
    'DC01,System,User Account Management,{0CCE9235-69AE-11D9-BED3-505054503030},No Auditing,',
  ]);
  const p = parseAuditpolCsv(raw);
  assert.equal(p.get("0CCE9215-69AE-11D9-BED3-505054503030"), "success+failure");
  assert.equal(p.get("0CCE9235-69AE-11D9-BED3-505054503030"), "none");
});

test("understands Italian auditpol output", () => {
  // I DC italiani emettono le impostazioni tradotte: ancorarsi ai nomi inglesi
  // avrebbe prodotto finding falsi su meta' del parco installato.
  const raw = csv([
    'DC01,Sistema,Accesso,{0CCE9215-69AE-11D9-BED3-505054503030},Riuscito e non riuscito,',
    'DC01,Sistema,Gestione account utente,{0CCE9235-69AE-11D9-BED3-505054503030},Nessun controllo,',
    'DC01,Sistema,Convalida credenziali,{0CCE923F-69AE-11D9-BED3-505054503030},Non riuscito,',
  ]);
  const p = parseAuditpolCsv(raw);
  assert.equal(p.get("0CCE9215-69AE-11D9-BED3-505054503030"), "success+failure");
  assert.equal(p.get("0CCE9235-69AE-11D9-BED3-505054503030"), "none");
  assert.equal(p.get("0CCE923F-69AE-11D9-BED3-505054503030"), "failure");
});

test("an unrecognised setting becomes unknown, never a gap", () => {
  const raw = csv([
    'DC01,System,Logon,{0CCE9215-69AE-11D9-BED3-505054503030},Einstellung unbekannt,',
  ]);
  assert.equal(parseAuditpolCsv(raw).get("0CCE9215-69AE-11D9-BED3-505054503030"), "unknown");
});

test("garbage input yields an empty map instead of throwing", () => {
  assert.equal(parseAuditpolCsv("").size, 0);
  assert.equal(parseAuditpolCsv("qualcosa di non CSV").size, 0);
});

test("every tracked subcategory declares what it is needed for", () => {
  assert.ok(AUDIT_SUBCATEGORIES.length >= 6);
  for (const s of AUDIT_SUBCATEGORIES) {
    assert.match(s.guid, /^[0-9A-F]{8}-/);
    assert.ok(s.labelIt.length > 3, s.guid);
    assert.ok(s.eventIds.length > 0, s.guid);
    assert.ok(s.needs === "success" || s.needs === "failure" || s.needs === "both");
  }
});

test("a subcategory switched off is reported as a gap", () => {
  const parsed = new Map<string, AuditSetting>([["0CCE9235-69AE-11D9-BED3-505054503030", "none"]]);
  const gaps = auditGaps(parsed);
  assert.equal(gaps.length, 1);
  assert.ok(gaps[0]!.labelIt.length > 0);
  assert.ok(gaps[0]!.eventIds.includes("4740"));
});

test("auditing only successes is a gap when failures are what matter", () => {
  const parsed = new Map<string, AuditSetting>([["0CCE923F-69AE-11D9-BED3-505054503030", "success"]]);
  const gaps = auditGaps(parsed);
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0]!.guid, "0CCE923F-69AE-11D9-BED3-505054503030");
});

test("a subcategory absent from the output is not reported", () => {
  // Se il GUID non compare non sappiamo nulla: tacere e' meglio che inventare.
  assert.deepEqual(auditGaps(new Map<string, AuditSetting>()), []);
});

test("a correctly configured subcategory produces no gap", () => {
  const parsed = new Map<string, AuditSetting>([
    ["0CCE9235-69AE-11D9-BED3-505054503030", "success"],
    ["0CCE923F-69AE-11D9-BED3-505054503030", "success+failure"],
  ]);
  assert.deepEqual(auditGaps(parsed), []);
});
