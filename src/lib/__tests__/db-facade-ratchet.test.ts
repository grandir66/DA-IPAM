/**
 * Cricchetto della facciata `db.ts` (NUC-2).
 *
 * `db.ts` e `db-tenant.ts` hanno due copie di centinaia di funzioni dati, e le
 * copie si separano: una correzione fatta in una non arriva all'altra
 * (analisi del sistema, 2026-10). La fusione si fa a gruppi; questo test
 * impedisce di tornare indietro fra un gruppo e l'altro:
 * - il numero di funzioni DEFINITE in `db.ts` (dichiarazioni esportate con
 *   corpo e `export const f = (…) => …` / `function (…)`, contate col parser di
 *   TypeScript) è esattamente SOGLIA: se sale, una funzione nuova è finita
 *   nella facciata; se scende, si abbassa SOGLIA nello stesso commit, così il
 *   margine non resta libero per funzioni nuove;
 * - una funzione spostata in `db-tenant.ts` non può riapparire in `db.ts` con
 *   nessuna dichiarazione, esportata o no (una copia locale usata da un'altra
 *   funzione della facciata è di nuovo una seconda copia).
 * Quando un gruppo si sposta, si abbassa SOGLIA e si aggiungono i nomi a SPOSTATE.
 * Buchi chiusi nella revisione del 2026-10-12.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

/** Funzioni esportate definite in db.ts dopo il gruppo 0 (erano 275) e T3-20. */
const SOGLIA = 269;

/** Funzioni che vivono in db-tenant.ts: db.ts le riesporta e basta. */
const SPOSTATE = [
  // gruppo 0 (T3-04)
  "cleanOrphanedForeignKeys",
  "updateScheduledJobInterval",
  "getStatusOverTime",
  "getRecentStatusChanges",
  // T3-20 (scansioni)
  "markHostsOffline",
];

interface Dichiarazione {
  nome: string;
  esportata: boolean;
  funzione: boolean;
}

function dichiarazioni(file: string): Dichiarazione[] {
  const testo = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(path.basename(file), testo, ts.ScriptTarget.Latest, true);
  const out: Dichiarazione[] = [];
  const esportata = (s: ts.Statement) =>
    ts.canHaveModifiers(s) && (ts.getModifiers(s) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
  for (const s of sf.statements) {
    if (ts.isFunctionDeclaration(s) && s.name) {
      out.push({ nome: s.name.text, esportata: esportata(s), funzione: !!s.body });
    } else if (ts.isVariableStatement(s)) {
      for (const d of s.declarationList.declarations) {
        if (!ts.isIdentifier(d.name)) continue;
        const init = d.initializer;
        const funzione = !!init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init));
        out.push({ nome: d.name.text, esportata: esportata(s), funzione });
      }
    }
  }
  return out;
}

function funzioniDefinite(file: string): string[] {
  return dichiarazioni(file).filter((d) => d.esportata && d.funzione).map((d) => d.nome);
}

const DB_TS = path.join(process.cwd(), "src", "lib", "db.ts");
const DB_TENANT_TS = path.join(process.cwd(), "src", "lib", "db-tenant.ts");

test("db.ts: le funzioni definite sono esattamente SOGLIA", () => {
  const n = funzioniDefinite(DB_TS).length;
  assert.ok(n <= SOGLIA, `db.ts definisce ${n} funzioni, la soglia è ${SOGLIA}: una funzione nuova va in db-tenant.ts`);
  assert.equal(n, SOGLIA, `db.ts definisce ${n} funzioni, meno della soglia ${SOGLIA}: sono scese, abbassa SOGLIA a ${n}`);
});

test("db.ts: le funzioni spostate non vi sono ridichiarate, nemmeno in locale", () => {
  const nomi = new Set(dichiarazioni(DB_TS).map((d) => d.nome));
  const tornate = SPOSTATE.filter((n) => nomi.has(n));
  assert.deepEqual(tornate, [], "funzioni spostate in db-tenant.ts dichiarate di nuovo in db.ts");
});

test("db-tenant.ts: definisce tutte le funzioni spostate", () => {
  const definite = new Set(funzioniDefinite(DB_TENANT_TS));
  const mancanti = SPOSTATE.filter((n) => !definite.has(n));
  assert.deepEqual(mancanti, [], "funzioni spostate che db-tenant.ts non definisce");
});
