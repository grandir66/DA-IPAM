import { describe, it } from "node:test";
import assert from "node:assert";
import { decideNotification } from "../wazuh-health-notify";

const ORA = Date.parse("2026-07-29T12:00:00Z");
const ORE = (n: number) => n * 3600_000;

describe("decideNotification", () => {
  it("primo rilevamento di un guasto notifica", () => {
    const d = decideNotification(null, "fail", ORA);
    assert.equal(d.notify, true);
    assert.equal(d.reason, "transizione");
  });
  it("primo rilevamento di uno stato ok non notifica", () => {
    assert.equal(decideNotification(null, "ok", ORA).notify, false);
  });
  it("stesso guasto entro 6 ore non ripete", () => {
    const d = decideNotification({ verdict: "fail", lastNotifiedAtMs: ORA - ORE(2) }, "fail", ORA);
    assert.equal(d.notify, false);
  });
  it("stesso guasto dopo 6 ore ripete", () => {
    const d = decideNotification({ verdict: "fail", lastNotifiedAtMs: ORA - ORE(7) }, "fail", ORA);
    assert.equal(d.notify, true);
    assert.equal(d.reason, "ripetizione");
  });
  it("peggioramento da degradato a errore notifica subito", () => {
    const d = decideNotification({ verdict: "degraded", lastNotifiedAtMs: ORA - ORE(1) }, "fail", ORA);
    assert.equal(d.notify, true);
    assert.equal(d.reason, "transizione");
  });
  it("rientro alla normalità notifica la chiusura", () => {
    const d = decideNotification({ verdict: "fail", lastNotifiedAtMs: ORA - ORE(1) }, "ok", ORA);
    assert.equal(d.notify, true);
    assert.equal(d.reason, "rientro");
  });
  it("da ok a ok non notifica", () => {
    assert.equal(decideNotification({ verdict: "ok", lastNotifiedAtMs: null }, "ok", ORA).notify, false);
  });
});
