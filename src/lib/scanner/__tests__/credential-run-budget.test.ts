/**
 * Test per `CredentialRunBudget` (fix post-review Critical, fase 1b: catene
 * detect senza anti-lockout). Pura, nessun DB/socket: verifica che l'helper
 * condiviso riusato dai tre loop detect (windows/ssh/ipam_full fase 4) e da
 * `credential_validate` applichi correttamente backoff + budget di run.
 *
 * Run: node --import tsx --test src/lib/scanner/__tests__/credential-run-budget.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CredentialRunBudget } from "../credential-run-budget";
import { MAX_CONSECUTIVE_FAILURES_PER_RUN } from "../credential-anti-lockout";

const NOW = "2026-07-27T10:00:00.000Z";
const FUTURE = "2026-07-27T11:00:00.000Z";

function collectingLogger(): { log: (msg: string) => void; lines: string[] } {
  const lines: string[] = [];
  return { log: (msg: string) => lines.push(msg), lines };
}

describe("CredentialRunBudget — backoff persistito", () => {
  it("credenziale in backoff futuro → gate:false, nessun tentativo, motivo loggato", () => {
    const { log, lines } = collectingLogger();
    const budget = new CredentialRunBudget(log);
    const attempt = budget.gate({
      ip: "10.0.0.5",
      credId: 42,
      credType: "ssh",
      hasWindowsIndicator: false,
      backoffUntil: FUTURE,
      nowIso: NOW,
    });
    assert.equal(attempt, false);
    assert.ok(lines.some((l) => l.includes("backoff")), "deve loggare il motivo backoff");
  });

  it("backoff scaduto (nel passato) → gate:true", () => {
    const budget = new CredentialRunBudget(() => {});
    const attempt = budget.gate({
      ip: "10.0.0.5",
      credId: 42,
      credType: "ssh",
      hasWindowsIndicator: false,
      backoffUntil: "2020-01-01T00:00:00.000Z",
      nowIso: NOW,
    });
    assert.equal(attempt, true);
  });
});

describe("CredentialRunBudget — budget di run (3 fallimenti consecutivi)", () => {
  it("dopo 3 fallimenti consecutivi la credenziale è esclusa per il resto del run", () => {
    const { log, lines } = collectingLogger();
    const budget = new CredentialRunBudget(log);
    const credId = 7;

    for (let i = 0; i < MAX_CONSECUTIVE_FAILURES_PER_RUN; i++) {
      const attempt = budget.gate({ ip: `10.0.0.${i}`, credId, credType: "ssh", hasWindowsIndicator: false, backoffUntil: null, nowIso: NOW });
      assert.equal(attempt, true, `tentativo ${i} deve essere ammesso (sotto soglia)`);
      budget.recordFailure(credId);
    }

    // Quarto host: il budget è esaurito, il gate deve rifiutare senza nemmeno provare.
    const attempt4 = budget.gate({ ip: "10.0.0.99", credId, credType: "ssh", hasWindowsIndicator: false, backoffUntil: null, nowIso: NOW });
    assert.equal(attempt4, false);
    assert.ok(lines.some((l) => l.includes("esclusa per il resto del run")), "deve loggare l'esclusione, mai in silenzio");
  });

  it("una credenziale esclusa resta esclusa per tentativi successivi (nessuna riabilitazione automatica)", () => {
    const budget = new CredentialRunBudget(() => {});
    const credId = 9;
    for (let i = 0; i < MAX_CONSECUTIVE_FAILURES_PER_RUN; i++) budget.recordFailure(credId);
    assert.equal(budget.gate({ ip: "a", credId, credType: "ssh", hasWindowsIndicator: false, backoffUntil: null, nowIso: NOW }), false);
    assert.equal(budget.gate({ ip: "b", credId, credType: "ssh", hasWindowsIndicator: false, backoffUntil: null, nowIso: NOW }), false);
  });

  it("un successo azzera il contatore — SOLO il successo, non altri eventi", () => {
    const budget = new CredentialRunBudget(() => {});
    const credId = 11;
    budget.recordFailure(credId);
    budget.recordFailure(credId);
    assert.equal(budget.consecutiveFailures(credId), 2);
    budget.recordSuccess(credId);
    assert.equal(budget.consecutiveFailures(credId), 0);
    // Dopo il reset, un nuovo host con la stessa credenziale deve poter riprovare.
    assert.equal(
      budget.gate({ ip: "c", credId, credType: "ssh", hasWindowsIndicator: false, backoffUntil: null, nowIso: NOW }),
      true
    );
  });

  it("il budget è per credenziale: un'altra credenziale non è affetta dall'esclusione della prima", () => {
    const budget = new CredentialRunBudget(() => {});
    const credA = 1;
    const credB = 2;
    for (let i = 0; i < MAX_CONSECUTIVE_FAILURES_PER_RUN; i++) budget.recordFailure(credA);
    assert.equal(budget.gate({ ip: "x", credId: credA, credType: "ssh", hasWindowsIndicator: false, backoffUntil: null, nowIso: NOW }), false);
    assert.equal(budget.gate({ ip: "x", credId: credB, credType: "ssh", hasWindowsIndicator: false, backoffUntil: null, nowIso: NOW }), true);
  });
});

describe("CredentialRunBudget — divieto windows senza indicatore", () => {
  it("credType windows su host senza indicatore Windows → gate:false anche a budget/backoff puliti", () => {
    const budget = new CredentialRunBudget(() => {});
    const attempt = budget.gate({
      ip: "10.0.0.5",
      credId: 3,
      credType: "windows",
      hasWindowsIndicator: false,
      backoffUntil: null,
      nowIso: NOW,
    });
    assert.equal(attempt, false);
  });

  it("credType windows su host CON indicatore Windows → gate:true", () => {
    const budget = new CredentialRunBudget(() => {});
    const attempt = budget.gate({
      ip: "10.0.0.5",
      credId: 3,
      credType: "windows",
      hasWindowsIndicator: true,
      backoffUntil: null,
      nowIso: NOW,
    });
    assert.equal(attempt, true);
  });
});

describe("CredentialRunBudget — logSummary", () => {
  it("logga un riepilogo per ogni credenziale esclusa, con conteggio tentativi risparmiati", () => {
    const { log, lines } = collectingLogger();
    const budget = new CredentialRunBudget(log);
    const credId = 21;
    for (let i = 0; i < MAX_CONSECUTIVE_FAILURES_PER_RUN; i++) budget.recordFailure(credId);
    // Due host successivi tentano ma vengono respinti dal budget.
    budget.gate({ ip: "h1", credId, credType: "ssh", hasWindowsIndicator: false, backoffUntil: null, nowIso: NOW });
    budget.gate({ ip: "h2", credId, credType: "ssh", hasWindowsIndicator: false, backoffUntil: null, nowIso: NOW });
    budget.logSummary();
    const summaryLine = lines.find((l) => l.includes("Riepilogo budget"));
    assert.ok(summaryLine, "deve esserci una riga di riepilogo, mai un troncamento silenzioso");
    assert.match(summaryLine ?? "", /2 tentativi successivi risparmiati/);
  });

  it("nessuna esclusione → logSummary non aggiunge righe", () => {
    const { log, lines } = collectingLogger();
    const budget = new CredentialRunBudget(log);
    budget.gate({ ip: "h1", credId: 1, credType: "ssh", hasWindowsIndicator: false, backoffUntil: null, nowIso: NOW });
    budget.logSummary();
    assert.equal(lines.length, 0);
  });
});
