/**
 * MDM nel catalogo dei moduli (analisi del 19/10, F11, approvato da Riccardo):
 * l'MDM stava solo in Impostazioni → Sistema, fuori da salute e Launchpad.
 * La salute si legge dalla sincronizzazione: nessuna sonda di rete in più.
 *
 * Run: node --import tsx --test src/lib/modules/__tests__/salute-mdm.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { saluteMdm } from "../salute-mdm";

const base = {
  base_url: "https://mdm.esempio.it", username: "u", user_field: "description", enabled: true,
  last_sync_at: null, last_error: null, consecutive_errors: 0, last_attempt_at: null, last_success_at: null, auto_disabled: false, max_errori: 5,
};

test("spento dall'admin → off", () => {
  assert.equal(saluteMdm({ ...base, enabled: false }).verdict, "off");
});
test("spento da solo dopo gli errori → fail, col motivo", () => {
  const s = saluteMdm({ ...base, enabled: false, auto_disabled: true, consecutive_errors: 5, last_error: "401" });
  assert.equal(s.verdict, "fail");
  assert.match(s.detail, /spento da solo/);
});
test("acceso senza nessuna sincronizzazione → unverified", () => {
  assert.equal(saluteMdm(base).verdict, "unverified");
});
test("ultima sincronizzazione riuscita → ok", () => {
  assert.equal(saluteMdm({ ...base, last_success_at: "2026-10-19 10:00:00", last_attempt_at: "2026-10-19 10:00:00" }).verdict, "ok");
});
test("errori di fila dopo un successo → degraded, col numero e l'errore", () => {
  const s = saluteMdm({ ...base, last_success_at: "2026-10-19 08:00:00", consecutive_errors: 2, last_error: "timeout" });
  assert.equal(s.verdict, "degraded");
  assert.match(s.detail, /2 .*timeout/);
});
