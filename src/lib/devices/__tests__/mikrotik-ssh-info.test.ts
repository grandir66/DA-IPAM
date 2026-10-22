/**
 * Campi MikroTik letti in SSH e unione con l'SNMP (22/10, revisione finale della scheda MikroTik).
 *
 * Incidente evitato: su un CHR/x86 `/system routerboard print` non dà seriale né modello (o fallisce), e
 * `{ ...snmp, ...ssh }` in getDeviceInfo sovrascriveva con null il seriale e il part number letti in SNMP.
 *
 * Run: DA_INVENT_DATA_DIR=$(mktemp -d) node --import tsx --test src/lib/devices/__tests__/mikrotik-ssh-info.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { infoMikrotikDaSsh } from "../device-info";

const RISORSE = "uptime: 3d2h\n version: 7.15 (stable)\n board-name: CHR\n cpu-count: 2\n";
const snmp = { serial_number: "SN-SNMP", part_number: "PN-SNMP", model: "CHR" };

describe("infoMikrotikDaSsh", () => {
  it("routerboard vuoto (CHR o lettura fallita): seriale e part number dell'SNMP restano", () => {
    const ssh = infoMikrotikDaSsh({ resource: RISORSE, identity: "rtr", routerboard: "", filter: 3, nat: 1, mangle: NaN });
    const unito = { ...snmp, ...ssh };
    assert.equal(unito.serial_number, "SN-SNMP");
    assert.equal(unito.part_number, "PN-SNMP");
    assert.equal(unito.firmware, "7.15 (stable)");
    assert.equal(unito.firewall_mangle_count, null);
  });
  it("routerboard letto: vince l'SSH", () => {
    const rb = "routerboard: yes\n model: RB5009UG+S+\n serial-number: HEX123\n";
    const unito = { ...snmp, ...infoMikrotikDaSsh({ resource: RISORSE, identity: "rtr", routerboard: rb, filter: 0, nat: 0, mangle: 0 }) };
    assert.equal(unito.serial_number, "HEX123");
    assert.equal(unito.part_number, "RB5009UG+S+");
  });
});
