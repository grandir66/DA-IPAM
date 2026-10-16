import { describe, it } from "node:test";
import assert from "node:assert";
import { decideNotification, buildHealthMessage } from "../wazuh-health-notify";
import { buildWebhookPayload } from "../../notifications/policy";
import type { BlockHealth } from "../wazuh-health-thresholds";

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

// Fix "review Important": il canale webhook riceveva un payload vuoto quando
// evaluateAndNotifyWazuhHealth passava events: [] a dispatchNotification, e
// il messaggio veniva scartato — sendWebhook ricostruiva il testo dagli
// eventi (nessuno) invece di usare il messaggio già composto. Con la webhook
// che risponde comunque 200, `notified` diventava true senza che fosse
// arrivato nulla di leggibile. Questi test dimostrano che il messaggio di
// salute arriva davvero nel payload webhook.
describe("buildHealthMessage + payload webhook (regressione: payload vuoto)", () => {
  const block: BlockHealth = {
    key: "manager",
    verdict: "fail",
    headline: "wazuh-analysisd fermo",
    configured: true,
  };

  it("il messaggio contiene il nome del blocco, il verdetto e la headline", () => {
    const msg = buildHealthMessage(block, "ACME", "transizione");
    assert.ok(msg.text.includes("Manager Wazuh"), msg.text);
    assert.ok(msg.text.includes("wazuh-analysisd fermo"), msg.text);
    assert.ok(!/https?:\/\//.test(msg.text), "il messaggio non deve mai contenere URL");
  });

  it("il payload webhook porta il messaggio anche con events vuoto (fix)", () => {
    const msg = buildHealthMessage(block, "ACME", "transizione");
    const payload = buildWebhookPayload("immediate", [], "ACME", msg);
    assert.ok(payload.text.length > 0, "il payload non deve essere vuoto");
    assert.ok(payload.text.includes("Manager Wazuh"));
    assert.ok(payload.text.includes("wazuh-analysisd fermo"));
  });

  it("senza passare message esplicitamente, events vuoto produce testo vuoto (perché il chiamante DEVE sempre passare message)", () => {
    const payload = buildWebhookPayload("immediate", [], "ACME");
    assert.equal(payload.text, "");
  });
});
