/**
 * Cricchetto della facciata `db.ts` (NUC-2).
 *
 * `db.ts` e `db-tenant.ts` hanno due copie di centinaia di funzioni dati, e le
 * copie si separano: una correzione fatta in una non arriva all'altra
 * (analisi del sistema, 2026-10). La fusione si fa a gruppi; questo test
 * impedisce di tornare indietro fra un gruppo e l'altro:
 * - il numero di funzioni DEFINITE in `db.ts` (dichiarazioni esportate con
 *   corpo, contate col parser di TypeScript) può solo scendere;
 * - una funzione spostata in `db-tenant.ts` non può essere ridefinita in `db.ts`.
 * Quando un gruppo si sposta, si abbassa SOGLIA e si aggiungono i nomi a SPOSTATE.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

/** Funzioni esportate definite in db.ts dopo il gruppo 0 (erano 275). */
const SOGLIA = 271;

/** Funzioni che vivono in db-tenant.ts: db.ts le riesporta e basta. */
const SPOSTATE = [
  // gruppo 0 (T3-04)
  "cleanOrphanedForeignKeys",
  "updateScheduledJobInterval",
  "getStatusOverTime",
  "getRecentStatusChanges",
];

function funzioniDefinite(file: string): string[] {
  const testo = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(path.basename(file), testo, ts.ScriptTarget.Latest, true);
  const nomi: string[] = [];
  for (const s of sf.statements) {
    if (!ts.isFunctionDeclaration(s) || !s.body || !s.name) continue;
    if (!s.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) continue;
    nomi.push(s.name.text);
  }
  return nomi;
}

const DB_TS = path.join(process.cwd(), "src", "lib", "db.ts");
const DB_TENANT_TS = path.join(process.cwd(), "src", "lib", "db-tenant.ts");

test("db.ts: le funzioni definite non risalgono sopra la soglia", () => {
  const n = funzioniDefinite(DB_TS).length;
  assert.ok(n <= SOGLIA, `db.ts definisce ${n} funzioni, la soglia è ${SOGLIA}: una funzione nuova va in db-tenant.ts`);
});

test("db.ts: le funzioni spostate non vi sono ridefinite", () => {
  const definite = new Set(funzioniDefinite(DB_TS));
  const tornate = SPOSTATE.filter((n) => definite.has(n));
  assert.deepEqual(tornate, [], "funzioni spostate in db-tenant.ts ridefinite in db.ts");
});

test("db-tenant.ts: definisce tutte le funzioni spostate", () => {
  const definite = new Set(funzioniDefinite(DB_TENANT_TS));
  const mancanti = SPOSTATE.filter((n) => !definite.has(n));
  assert.deepEqual(mancanti, [], "funzioni spostate che db-tenant.ts non definisce");
});
