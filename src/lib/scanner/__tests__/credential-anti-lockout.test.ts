/**
 * Test tabellari per `shouldAttemptCredential` (fase 1b credenziali, Task 3).
 * Pura, nessun DB/socket: verifica l'ordine di priorità delle 4 regole
 * anti-lockout e i casi limite del budget di run.
 *
 * Run: node --import tsx --test src/lib/scanner/__tests__/credential-anti-lockout.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  shouldAttemptCredential,
  MAX_CONSECUTIVE_FAILURES_PER_RUN,
  type ShouldAttemptCredentialInput,
} from "../credential-anti-lockout";

const NOW = "2026-07-27T10:00:00.000Z";
const PAST = "2026-07-27T09:00:00.000Z";
const FUTURE = "2026-07-27T11:00:00.000Z";

function base(overrides: Partial<ShouldAttemptCredentialInput> = {}): ShouldAttemptCredentialInput {
  return {
    credType: "ssh",
    hasWindowsIndicator: false,
    backoffUntil: null,
    consecutiveFailures: 0,
    isMultihomedSecondary: false,
    nowIso: NOW,
    ...overrides,
  };
}

describe("shouldAttemptCredential — caso felice", () => {
  it("nessun impedimento → attempt:true, nessun reason", () => {
    const r = shouldAttemptCredential(base());
    assert.equal(r.attempt, true);
    assert.equal(r.reason, undefined);
  });

  it("credenziale windows su host CON indicatore Windows → attempt:true", () => {
    const r = shouldAttemptCredential(base({ credType: "windows", hasWindowsIndicator: true }));
    assert.equal(r.attempt, true);
  });

  it("backoff nel PASSATO (scaduto) → attempt:true", () => {
    const r = shouldAttemptCredential(base({ backoffUntil: PAST }));
    assert.equal(r.attempt, true);
  });

  it("consecutiveFailures appena sotto soglia → attempt:true", () => {
    const r = shouldAttemptCredential(base({ consecutiveFailures: MAX_CONSECUTIVE_FAILURES_PER_RUN - 1 }));
    assert.equal(r.attempt, true);
  });
});

describe("shouldAttemptCredential — multihomed secondary (priorità 1)", () => {
  it("host secondary → mai testare, indipendentemente da tutto il resto", () => {
    const r = shouldAttemptCredential(
      base({ isMultihomedSecondary: true, credType: "windows", hasWindowsIndicator: true })
    );
    assert.equal(r.attempt, false);
    assert.match(r.reason ?? "", /multihomed secondary/);
  });
});

describe("shouldAttemptCredential — divieto windows senza indicatore (priorità 2)", () => {
  it("credType windows, hasWindowsIndicator false → skip con motivo esplicito", () => {
    const r = shouldAttemptCredential(base({ credType: "windows", hasWindowsIndicator: false }));
    assert.equal(r.attempt, false);
    assert.match(r.reason ?? "", /nessun indicatore Windows/);
  });

  it("credType non-windows (ssh) senza indicatore Windows → non è vietato da questa regola", () => {
    const r = shouldAttemptCredential(base({ credType: "ssh", hasWindowsIndicator: false }));
    assert.equal(r.attempt, true);
  });

  it("case-sensitivity: il chiamante deve passare credType già lowercase (\"Windows\" non matcha)", () => {
    const r = shouldAttemptCredential(base({ credType: "Windows", hasWindowsIndicator: false }));
    // Documenta il contratto: la normalizzazione lowercase è responsabilità del chiamante.
    assert.equal(r.attempt, true);
  });
});

describe("shouldAttemptCredential — backoff persistito nel futuro (priorità 3)", () => {
  it("backoffUntil futuro → skip con orario nel motivo", () => {
    const r = shouldAttemptCredential(base({ backoffUntil: FUTURE }));
    assert.equal(r.attempt, false);
    assert.match(r.reason ?? "", /backoff/);
    assert.match(r.reason ?? "", new RegExp(FUTURE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });

  it("backoffUntil uguale a nowIso (bordo, non strettamente futuro) → attempt:true", () => {
    const r = shouldAttemptCredential(base({ backoffUntil: NOW }));
    assert.equal(r.attempt, true);
  });
});

describe("shouldAttemptCredential — budget di run (priorità 4)", () => {
  it(`consecutiveFailures === ${MAX_CONSECUTIVE_FAILURES_PER_RUN} (soglia) → escluso`, () => {
    const r = shouldAttemptCredential(base({ consecutiveFailures: MAX_CONSECUTIVE_FAILURES_PER_RUN }));
    assert.equal(r.attempt, false);
    assert.match(r.reason ?? "", /budget esaurito/);
  });

  it("consecutiveFailures oltre soglia → resta escluso (non ri-abilitato)", () => {
    const r = shouldAttemptCredential(base({ consecutiveFailures: MAX_CONSECUTIVE_FAILURES_PER_RUN + 5 }));
    assert.equal(r.attempt, false);
  });
});

describe("shouldAttemptCredential — priorità tra regole", () => {
  it("multihomed secondary vince anche se il budget non è esaurito e non c'è backoff", () => {
    const r = shouldAttemptCredential(
      base({ isMultihomedSecondary: true, consecutiveFailures: 0, backoffUntil: null })
    );
    assert.equal(r.attempt, false);
    assert.match(r.reason ?? "", /multihomed/);
  });

  it("divieto windows vince sul backoff quando entrambi si applicherebbero", () => {
    const r = shouldAttemptCredential(
      base({ credType: "windows", hasWindowsIndicator: false, backoffUntil: FUTURE })
    );
    assert.match(r.reason ?? "", /nessun indicatore Windows/);
  });

  it("backoff vince sul budget quando entrambi si applicherebbero", () => {
    const r = shouldAttemptCredential(
      base({ backoffUntil: FUTURE, consecutiveFailures: MAX_CONSECUTIVE_FAILURES_PER_RUN })
    );
    assert.match(r.reason ?? "", /backoff/);
  });
});
