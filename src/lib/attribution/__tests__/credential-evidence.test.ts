/**
 * Test tabellari per `evidenceFromAuthOutcome` (fase 1b credenziali, Task 4, §7.3).
 * Pura, nessun DB: verifica le regole banner→evidenza e che ogni claim di
 * categoria emesso sia un valore valido di `isValidCategory`.
 *
 * Run: node --import tsx --test src/lib/attribution/__tests__/credential-evidence.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { evidenceFromAuthOutcome, type AuthOutcome } from "../credential-evidence";
import { isValidCategory } from "../taxonomy";
import { AUTHORITATIVE_SOURCES } from "../weights";
import { AUTHORITY_MIN_CONFIDENCE } from "../types";

function find(inputs: ReturnType<typeof evidenceFromAuthOutcome>, dimension: string) {
  return inputs.filter((i) => i.dimension === dimension);
}

describe("evidenceFromAuthOutcome — WinRM", () => {
  it("OK → os=windows @0.95, autoritativa (winrm ∈ AUTHORITATIVE_SOURCES.os, 0.95 ≥ soglia)", () => {
    const o: AuthOutcome = { protocol: "winrm", ok: true, banner: "DESKTOP-ABC123" };
    const ev = evidenceFromAuthOutcome(o);
    assert.equal(ev.length, 1);
    assert.equal(ev[0].source, "winrm");
    assert.equal(ev[0].dimension, "os");
    assert.equal(ev[0].claim, "windows");
    assert.equal(ev[0].confidence, 0.95);
    assert.ok(AUTHORITATIVE_SOURCES.os.includes("winrm"));
    assert.ok(ev[0].confidence >= AUTHORITY_MIN_CONFIDENCE);
  });

  it("OK senza banner → emette comunque os=windows (l'esito ok è la prova, il banner è opzionale)", () => {
    const ev = evidenceFromAuthOutcome({ protocol: "winrm", ok: true, banner: null });
    assert.equal(ev.length, 1);
    assert.equal(ev[0].claim, "windows");
  });

  it("auth rifiutata ma servizio presente (banner/marker non vuoto) → category=compute @0.3, debole", () => {
    const ev = evidenceFromAuthOutcome({ protocol: "winrm", ok: false, banner: "AUTH_REJECTED" });
    assert.equal(ev.length, 1);
    assert.equal(ev[0].dimension, "category");
    assert.equal(ev[0].claim, "compute");
    assert.ok(ev[0].confidence < AUTHORITY_MIN_CONFIDENCE);
    assert.equal(ev[0].confidence, 0.3);
  });

  it("auth rifiutata senza segnale di servizio (porta chiusa/timeout, banner vuoto) → nessuna evidenza", () => {
    const ev = evidenceFromAuthOutcome({ protocol: "winrm", ok: false, banner: null });
    assert.deepEqual(ev, []);
  });
});

describe("evidenceFromAuthOutcome — SSH, banner Linux", () => {
  const cases = [
    "SSH-2.0-OpenSSH_8.9p1 Ubuntu-3ubuntu0.6",
    "SSH-2.0-OpenSSH_7.9p1 Debian-10+deb10u2",
    "SSH-2.0-OpenSSH_9.6",
  ];
  for (const banner of cases) {
    it(`"${banner}" → os=linux @0.9 + category=compute @0.6`, () => {
      const ev = evidenceFromAuthOutcome({ protocol: "ssh", ok: true, banner });
      const os = find(ev, "os");
      const cat = find(ev, "category");
      assert.equal(os.length, 1);
      assert.equal(os[0].claim, "linux");
      assert.equal(os[0].confidence, 0.9);
      assert.equal(cat.length, 1);
      assert.equal(cat[0].claim, "compute");
      assert.equal(cat[0].confidence, 0.6);
      assert.equal(ev.length, 2);
    });
  }
});

describe("evidenceFromAuthOutcome — SSH, banner network-os", () => {
  const cases: Array<{ banner: string; vendor: string }> = [
    { banner: "SSH-2.0-ROSSSH RouterOS", vendor: "mikrotik" },
    { banner: "Cisco IOS Software, C2960 Software", vendor: "cisco" },
    { banner: "VyOS SSH gateway", vendor: "vyos" },
    { banner: "EdgeOS SSH-2.0-dropbear_2020.81", vendor: "ubiquiti" },
  ];
  for (const { banner, vendor } of cases) {
    it(`"${banner}" → os=network-os @0.9 + category=network @0.7 + vendor=${vendor} @0.7`, () => {
      const ev = evidenceFromAuthOutcome({ protocol: "ssh", ok: true, banner });
      const os = find(ev, "os");
      const cat = find(ev, "category");
      const ven = find(ev, "vendor");
      assert.equal(os.length, 1);
      assert.equal(os[0].claim, "network-os");
      assert.equal(os[0].confidence, 0.9);
      assert.equal(cat.length, 1);
      assert.equal(cat[0].claim, "network");
      assert.equal(cat[0].confidence, 0.7);
      assert.equal(ven.length, 1);
      assert.equal(ven[0].claim, vendor);
      assert.equal(ven[0].confidence, 0.7);
      assert.equal(ev.length, 3);
    });
  }
});

describe("evidenceFromAuthOutcome — SSH, banner Windows (Minor 2 fix post-review)", () => {
  it('"SSH-2.0-OpenSSH_for_Windows_8.1" → NESSUNA evidenza os=linux (meglio nessuna evidenza che una sbagliata)', () => {
    const ev = evidenceFromAuthOutcome({ protocol: "ssh", ok: true, banner: "SSH-2.0-OpenSSH_for_Windows_8.1" });
    assert.deepEqual(find(ev, "os"), []);
    assert.deepEqual(ev, []);
  });

  it('variante case-insensitive "SSH-2.0-OpenSSH_for_windows_7.7" → nessuna evidenza os=linux', () => {
    const ev = evidenceFromAuthOutcome({ protocol: "ssh", ok: true, banner: "SSH-2.0-OpenSSH_for_windows_7.7" });
    assert.deepEqual(find(ev, "os"), []);
  });
});

describe("evidenceFromAuthOutcome — SSH, auth rifiutata o banner ignoto", () => {
  it("auth rifiutata (servizio presente) → nessuna evidenza: troppo generico per SSH", () => {
    const ev = evidenceFromAuthOutcome({ protocol: "ssh", ok: false, banner: "SSH-2.0-OpenSSH_8.9p1 Ubuntu" });
    assert.deepEqual(ev, []);
  });

  it("OK ma banner assente → nessuna evidenza (nessun segnale da interpretare)", () => {
    const ev = evidenceFromAuthOutcome({ protocol: "ssh", ok: true, banner: null });
    assert.deepEqual(ev, []);
  });

  it("OK ma banner non riconosciuto (es. apparato non mappato) → nessuna evidenza inventata", () => {
    const ev = evidenceFromAuthOutcome({ protocol: "ssh", ok: true, banner: "SSH-2.0-libssh-0.9.6" });
    assert.deepEqual(ev, []);
  });
});

describe("evidenceFromAuthOutcome — SNMP e API: nessuna evidenza qui", () => {
  it("SNMP OK → [] (già coperto da emitEvidenceFromSignals su sysobj/sysdescr)", () => {
    assert.deepEqual(evidenceFromAuthOutcome({ protocol: "snmp", ok: true, banner: "sysDescr qualunque" }), []);
  });
  it("SNMP rifiutata → []", () => {
    assert.deepEqual(evidenceFromAuthOutcome({ protocol: "snmp", ok: false, banner: null }), []);
  });
  it("API OK → [] (nessuna regola in questa fase)", () => {
    assert.deepEqual(evidenceFromAuthOutcome({ protocol: "api", ok: true, banner: "qualunque" }), []);
  });
});

describe("evidenceFromAuthOutcome — invarianti generali su tutti i casi", () => {
  const allOutcomes: AuthOutcome[] = [
    { protocol: "winrm", ok: true, banner: "HOST1" },
    { protocol: "winrm", ok: false, banner: "AUTH_REJECTED" },
    { protocol: "winrm", ok: false, banner: null },
    { protocol: "ssh", ok: true, banner: "SSH-2.0-OpenSSH_8.9p1 Ubuntu" },
    { protocol: "ssh", ok: true, banner: "RouterOS SSH-2.0-ROSSSH" },
    { protocol: "ssh", ok: false, banner: "SSH-2.0-OpenSSH_8.9p1 Ubuntu" },
    { protocol: "snmp", ok: true, banner: "x" },
    { protocol: "api", ok: true, banner: "x" },
  ];

  it("ogni claim di dimension=category è un CategorySlug valido (isValidCategory)", () => {
    for (const o of allOutcomes) {
      for (const cat of find(evidenceFromAuthOutcome(o), "category")) {
        assert.ok(isValidCategory(cat.claim), `claim categoria non valido: ${cat.claim}`);
      }
    }
  });

  it("ogni evidenza ha phase=credential_validate", () => {
    for (const o of allOutcomes) {
      for (const e of evidenceFromAuthOutcome(o)) {
        assert.equal(e.phase, "credential_validate");
      }
    }
  });

  it("nessuna evidenza autoritativa sotto soglia: se source ∈ AUTHORITATIVE_SOURCES[dimension], confidence ≥ 0.9 oppure la sorgente non è realmente dichiarativa per questo claim", () => {
    for (const o of allOutcomes) {
      for (const e of evidenceFromAuthOutcome(o)) {
        const authoritativeSources = AUTHORITATIVE_SOURCES[e.dimension] as readonly string[];
        if (authoritativeSources.includes(e.source) && e.confidence < AUTHORITY_MIN_CONFIDENCE) {
          assert.fail(
            `${e.source}/${e.dimension}=${e.claim} è autoritativa ma confidence ${e.confidence} < ${AUTHORITY_MIN_CONFIDENCE}`
          );
        }
      }
    }
  });
});
