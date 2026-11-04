/**
 * Prove per `CredentialRunBudget.recordDenied` e `recordWrongPassword` (piano accesso Windows, Task 4).
 *
 * Incidente: 72729, 04/11/2026. 12 PC rifiutano un account di dominio con password giusta. Contare quei rifiuti come
 * fallimenti avrebbe fermato la scansione dopo 3 macchine, senza che nessuna password fosse sbagliata.
 *
 * Run: node --import tsx --test src/lib/scanner/__tests__/credential-run-budget-negato.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CredentialRunBudget } from "../credential-run-budget";
import { MAX_CONSECUTIVE_FAILURES_PER_RUN } from "../credential-anti-lockout";

const NOW = "2026-11-04T10:00:00.000Z";
const CRED = 7;

function ammesso(budget: CredentialRunBudget, ip = "10.0.0.1"): boolean {
  return budget.gate({ ip, credId: CRED, credType: "windows", hasWindowsIndicator: true, backoffUntil: null, nowIso: NOW });
}

function nuovoBudget(): { budget: CredentialRunBudget; righe: string[] } {
  const righe: string[] = [];
  return { budget: new CredentialRunBudget((m) => righe.push(m)), righe };
}

describe("recordDenied — accesso negato con password giusta", () => {
  it("30 rifiuti di fila: il gate resta vero e lo streak resta zero", () => {
    const { budget } = nuovoBudget();
    for (let i = 0; i < 30; i++) {
      assert.equal(ammesso(budget, `10.0.0.${i}`), true, `host ${i}`);
      budget.recordDenied(CRED);
    }
    assert.equal(ammesso(budget), true);
    assert.equal(budget.consecutiveFailures(CRED), 0);
  });

  it("3 recordFailure escludono come oggi, anche dopo 30 rifiuti", () => {
    const { budget } = nuovoBudget();
    for (let i = 0; i < 30; i++) budget.recordDenied(CRED);
    for (let i = 0; i < MAX_CONSECUTIVE_FAILURES_PER_RUN; i++) {
      assert.equal(ammesso(budget), true);
      budget.recordFailure(CRED);
    }
    assert.equal(ammesso(budget), false);
  });

  it("non azzera lo streak: fallimento, rifiuto, fallimento, fallimento esclude", () => {
    const { budget } = nuovoBudget();
    budget.recordFailure(CRED);
    budget.recordDenied(CRED);
    budget.recordFailure(CRED);
    assert.equal(budget.consecutiveFailures(CRED), 2);
    budget.recordDenied(CRED);
    budget.recordFailure(CRED);
    assert.equal(ammesso(budget), false);
  });

  it("il riepilogo dice quanti rifiuti e non parla di esclusione", () => {
    const { budget, righe } = nuovoBudget();
    for (let i = 0; i < 12; i++) budget.recordDenied(CRED);
    budget.logSummary();
    assert.equal(righe.length, 1);
    assert.match(righe[0], /#7/);
    assert.match(righe[0], /12/);
    assert.doesNotMatch(righe[0], /esclusa/);
  });

  it("senza rifiuti il riepilogo non scrive nulla", () => {
    const { budget, righe } = nuovoBudget();
    budget.logSummary();
    assert.deepEqual(righe, []);
  });
});

describe("recordWrongPassword — la verifica ha trovato la password errata", () => {
  it("conta un fallimento solo per voce, comunque la si chiami", () => {
    const { budget } = nuovoBudget();
    for (let i = 0; i < 20; i++) budget.recordWrongPassword(CRED);
    assert.equal(budget.consecutiveFailures(CRED), 1);
    assert.equal(ammesso(budget), true);
  });

  it("voci diverse contano ognuna per sé", () => {
    const { budget } = nuovoBudget();
    budget.recordWrongPassword(1);
    budget.recordWrongPassword(2);
    assert.equal(budget.consecutiveFailures(1), 1);
    assert.equal(budget.consecutiveFailures(2), 1);
  });

  it("si somma ai fallimenti veri: il limite resta sui logon errati reali", () => {
    const { budget } = nuovoBudget();
    budget.recordWrongPassword(CRED);
    budget.recordFailure(CRED);
    budget.recordFailure(CRED);
    assert.equal(ammesso(budget), false);
  });
});
