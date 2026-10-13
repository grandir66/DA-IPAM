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
 * Quando un gruppo si sposta, si abbassa SOGLIA e si aggiungono i nomi a SPOSTATE
 * (`support/facciata-spostate.ts`, condiviso con la prova d'identità). Lo stesso
 * vale per i tipi: un tipo spostato (TIPI_SPOSTATI) non si ridichiara in `db.ts`.
 * Buchi chiusi nella revisione del 2026-10-12.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { SPOSTATE, TIPI_SPOSTATI } from "./support/facciata-spostate";

/**
 * Funzioni esportate definite in db.ts: 275 all'inizio, 271 dopo il gruppo 0
 * (T3-04), 168 dopo il gruppo 1a (T3-05, 103 letture); nel gruppo 1b (T3-06):
 * 144 dopo le credenziali, 133 dopo AD, 125 dopo DHCP,
 * 104 dopo inventario e licenze.
 */
const SOGLIA = 104;

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
    } else if (ts.isInterfaceDeclaration(s) || ts.isTypeAliasDeclaration(s)) {
      out.push({ nome: s.name.text, esportata: esportata(s), funzione: false });
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

test("db.ts: i tipi spostati non vi sono ridichiarati; db-tenant.ts li esporta", () => {
  const inFacciata = new Set(dichiarazioni(DB_TS).map((d) => d.nome));
  assert.deepEqual(TIPI_SPOSTATI.filter((n) => inFacciata.has(n)), [], "tipi spostati dichiarati di nuovo in db.ts");
  const esportatiTenant = new Set(dichiarazioni(DB_TENANT_TS).filter((d) => d.esportata).map((d) => d.nome));
  assert.deepEqual(TIPI_SPOSTATI.filter((n) => !esportatiTenant.has(n)), [], "tipi spostati che db-tenant.ts non esporta");
});
