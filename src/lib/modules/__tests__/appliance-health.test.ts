import { describe, it } from "node:test";
import assert from "node:assert";

/**
 * `composeApplianceHealth` è la parte PURA del probe "Sistema appliance"
 * (modules/health.ts): verdetto+messaggio da lettura disco e stato Docker.
 * I casi coprono i tre incident reali che hanno motivato la voce:
 *  - DTS 2026-07-28 / PX-NAS 2026-07-30: disco oltre soglia → ambra/rosso;
 *  - da-va-ovh 2026-07-29: demone Docker giù → rosso anche a disco sano.
 */
import { composeApplianceHealth } from "../health";

const dockerOk = { state: "attivo" as const, detail: "Docker 29.4.3 attivo" };

describe("composeApplianceHealth", () => {
  it("disco sano + Docker attivo → ok, con percentuale e GB nel dettaglio", () => {
    const r = composeApplianceHealth({ disk: { usePercent: 46, freeGb: 102.3 }, docker: dockerOk });
    assert.equal(r.verdict, "ok");
    assert.ok(r.detail.includes("46% occupato"));
    assert.ok(r.detail.includes("102.3 GB liberi"));
    assert.ok(r.detail.includes("Docker 29.4.3 attivo"));
  });

  it("disco ≥85% (caso da-invent al 91%) → degraded", () => {
    const r = composeApplianceHealth({ disk: { usePercent: 91, freeGb: 18.2 }, docker: dockerOk });
    assert.equal(r.verdict, "degraded");
  });

  it("disco ≥95% (caso DTS/PX-NAS al 100%) → fail", () => {
    const r = composeApplianceHealth({ disk: { usePercent: 100, freeGb: 0 }, docker: dockerOk });
    assert.equal(r.verdict, "fail");
  });

  it("demone Docker giù (caso da-va-ovh) → fail anche a disco sano", () => {
    const r = composeApplianceHealth({
      disk: { usePercent: 40, freeGb: 100 },
      docker: { state: "giu", detail: "demone Docker non raggiungibile: connect ENOENT" },
    });
    assert.equal(r.verdict, "fail");
    assert.ok(r.detail.includes("non raggiungibile"));
  });

  it("Docker non installato NON è un guasto", () => {
    const r = composeApplianceHealth({
      disk: { usePercent: 40, freeGb: 100 },
      docker: { state: "assente", detail: "Docker non installato" },
    });
    assert.equal(r.verdict, "ok");
  });

  it("disco non leggibile → degraded, mai ok (era lo stato cieco degli incident)", () => {
    const r = composeApplianceHealth({ disk: { error: "EACCES" }, docker: dockerOk });
    assert.equal(r.verdict, "degraded");
    assert.ok(r.detail.includes("non leggibile"));
  });
});
