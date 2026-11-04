/**
 * Detect dei vendor OT non classificati (richiesta Riccardo 04/11, sonda 72729-ipam):
 * Weintek (HMI), CREVIS (remote I/O), Kronotech (presenze/accessi) dall'OUI; Modbus/EtherNet-IP
 * dalle porte; Microchip NON classificato per vendor (OUI di chip ambiguo) ma preso dalle porte.
 *
 * Copre i due rami: il classifier di fallback (device-classifier.ts) e la mappa
 * etichetta→slug del fingerprint (device-fingerprint-classification.ts), più un giro
 * end-to-end di buildDeviceFingerprint con le regole mac_vendor passate a mano (sonde spente,
 * niente rete: nessun IP/MAC vero, repo pubblico).
 *
 * Run: node --import tsx --test src/lib/__tests__/classificazione-vendor-ot.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyDeviceDetailed } from "@/lib/device-classifier";
import { getClassificationFromFingerprintSnapshot } from "@/lib/device-fingerprint-classification";
import { buildDeviceFingerprint } from "@/lib/scanner/device-fingerprint";
import type { DeviceFingerprintRuleRow } from "@/lib/db";

function rule(partial: Partial<DeviceFingerprintRuleRow> & { device_label: string; classification: string }): DeviceFingerprintRuleRow {
  return {
    id: 1,
    name: partial.name ?? partial.device_label,
    device_label: partial.device_label,
    classification: partial.classification,
    priority: partial.priority ?? 68,
    enabled: 1,
    tcp_ports_key: partial.tcp_ports_key ?? null,
    tcp_ports_optional: partial.tcp_ports_optional ?? null,
    min_key_ports: partial.min_key_ports ?? null,
    oid_prefix: partial.oid_prefix ?? null,
    sysdescr_pattern: partial.sysdescr_pattern ?? null,
    hostname_pattern: partial.hostname_pattern ?? null,
    mac_vendor_pattern: partial.mac_vendor_pattern ?? null,
    banner_pattern: partial.banner_pattern ?? null,
    ttl_min: partial.ttl_min ?? null,
    ttl_max: partial.ttl_max ?? null,
    note: partial.note ?? null,
    builtin: 1,
    created_at: "",
    updated_at: "",
  };
}

test("vendor OUI OT → slug corretto (classifier di fallback)", () => {
  assert.equal(classifyDeviceDetailed({ vendor: "Weintek Labs., Inc." }).classification, "hmi");
  assert.equal(classifyDeviceDetailed({ vendor: "CREVIS Co.,LTD" }).classification, "plc");
  assert.equal(classifyDeviceDetailed({ vendor: "Kronotech srl" }).classification, "iot");
});

test("Microchip da solo resta ambiguo (nessuna classificazione sbagliata per vendor)", () => {
  const r = classifyDeviceDetailed({ vendor: "Microchip Technology Inc." });
  assert.equal(r.classification, undefined);
});

test("Microchip con Modbus 502 → plc (via porte, vendor-neutro)", () => {
  const r = classifyDeviceDetailed({
    vendor: "Microchip Technology Inc.",
    openPorts: [{ port: 502 }, { port: 80 }],
  });
  assert.equal(r.classification, "plc");
  assert.equal(r.method, "port");
});

test("firme di porta OT senza vendor → plc", () => {
  assert.equal(classifyDeviceDetailed({ openPorts: [{ port: 502 }] }).classification, "plc");
  assert.equal(classifyDeviceDetailed({ openPorts: [{ port: 44818 }] }).classification, "plc");
});

test("mappa etichetta fingerprint → slug (nuove etichette OT)", () => {
  const mk = (final_device: string) =>
    getClassificationFromFingerprintSnapshot({ final_device, final_confidence: 0.6 });
  assert.equal(mk("Weintek HMI"), "hmi");
  assert.equal(mk("CREVIS Remote I/O"), "plc");
  assert.equal(mk("Kronotech"), "iot");
  assert.equal(mk("PLC Modbus"), "plc");
  assert.equal(mk("PLC EtherNet/IP"), "plc");
});

test("end-to-end: regola Modbus 502 → final_device + classificazione dal fingerprint (sonde spente)", async () => {
  const rules = [rule({ device_label: "PLC Modbus", classification: "plc", tcp_ports_key: "[502]", tcp_ports_optional: "[80]", priority: 40 })];
  const snap = await buildDeviceFingerprint(
    { ip: "203.0.113.8", openPorts: [{ port: 502 }, { port: 80 }], activeProbes: false },
    rules,
  );
  assert.equal(snap.final_device, "PLC Modbus");
  // firma di porta ~0.68 ≥ soglia 0.56 → la classificazione dal fingerprint si applica
  assert.equal(getClassificationFromFingerprintSnapshot(snap), "plc");
});

test("end-to-end: regola mac_vendor Weintek → final_device etichetta (sonde spente)", async () => {
  const rules = [rule({ device_label: "Weintek HMI", classification: "hmi", mac_vendor_pattern: "weintek", priority: 68 })];
  const snap = await buildDeviceFingerprint(
    { ip: "203.0.113.7", openPorts: [{ port: 80 }], macVendor: "Weintek Labs., Inc.", activeProbes: false },
    rules,
  );
  // mac_vendor decide l'etichetta (final_device = modello mostrato), ma a 0.5 resta sotto la soglia
  // 0.56 del fingerprint: in discovery la classificazione arriva dal classifier di fallback (vendor → hmi).
  assert.equal(snap.final_device, "Weintek HMI");
  assert.equal(classifyDeviceDetailed({ vendor: "Weintek Labs., Inc." }).classification, "hmi");
});
