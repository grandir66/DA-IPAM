import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSystem, parseInterfaces, parseVlans, parseNeighbors, parseAggregation, parseTemperatures, parseSnmpInterfaces, bitmapPorts, counter64 } from "../parsers";
test("QSS: firmware completo, uptime e sensori separati (banco 21/10)", () => {
    const d = parseSystem("Model name : QSW-M3216R-8S8T\nSwitch firmware : 4.5.0.847494 (20260908)\nSerial number : TEST0001\nSystem up time : 1 Days, 2 Hrs, 3 Mins, 4 Secs\nTemperature : 42\nFan 1 speed : 4272");
    assert.equal(d.model, "QSW-M3216R-8S8T");
    assert.equal(d.firmware, "4.5.0.847494 (20260908)");
    assert.equal(d.uptime_seconds, 93784);
});
test("QSS: not connected non è connected, velocità configurata non è negoziata", () => {
    const d = parseInterfaces("Ex0/1 not connected Full 10 Gbps Auto Auto-MDIX on\nEx0/7 connected Full 2.5 Gbps Auto Auto-MDIX on\npo1 not connected Full 10 Gbps Auto");
    assert.equal(d.length, 3);
    assert.equal(d[0].oper_status, "down");
    assert.equal(d[0].speed_bps, null);
    assert.equal(d[1].speed_bps, 2500000000);
    assert.equal(d[2].kind, "aggregate");
});
test("VLAN QSS: continuazioni e membership distinta da untagged (non dedurre PVID)", () => {
    const d = parseVlans("Vlan ID : 40\nMember Ports : Ex0/1, Ex0/2\n  Ex0/7, po1\nUntagged Ports : Ex0/7\nForbidden Ports : None\nName : TEST\nStatus : Permanent");
    assert.deepEqual(d[0].tagged_ports, ["Ex0/1", "Ex0/2", "po1"]);
    assert.deepEqual(d[0].untagged_ports, ["Ex0/7"]);
});
test("LLDP preserva port-id remoto non normalizzabile", () => {
    const d = parseNeighbors("02:00:00:00:00:01 Ex0/7 120 B,R tw4\nTotal Entries Displayed : 1");
    assert.equal(d[0].remote_port, "tw4");
    assert.equal(d[0].local_port, "Ex0/7");
});
test("LAG distingue gruppi configurati inattivi da collegamenti", () => {
    const d = parseAggregation("1 Po1(D)[AU,OD] Disabled\n2 Po2(U)[AU,OU] LACP Ex0/1(P) Ex0/2(P)");
    assert.equal(d[0].oper_status, "down");
    assert.deepEqual(d[1].members, ["Ex0/1", "Ex0/2"]);
});
test("Counter64 esatto e bitmap MSB; zero termico resta lettura non diagnosi", () => {
    assert.equal(counter64({ hex: "0020000000000001" }), "9007199254740993");
    assert.deepEqual(bitmapPorts({ hex: "8101" }), [1, 8, 16]);
    assert.equal(parseTemperatures("Phy9 Temperature : 0 C")[0].value, 0);
});
test("ifSpeed saturo è ignoto senza ifHighSpeed, ifIndex non è bridge port", () => {
    const d = parseSnmpInterfaces([{ oid: "1.3.6.1.2.1.2.2.1.1.7", value: 7 }, { oid: "1.3.6.1.2.1.2.2.1.2.7", value: "Port 07" }, { oid: "1.3.6.1.2.1.2.2.1.5.7", value: 4294967295 }], []);
    assert.equal(d[0].speed_bps, null);
    assert.equal(d[0].if_index, 7);
});
test('DDM: mW distinti da dBm, bias mA→A e righe tutte zero non sono ottiche presenti', async () => {
    const { parseDdm } = await import('../parsers');
    assert.deepEqual(parseDdm('Ex0/1 0.000 0.000 0.000 0.000 0.000'), []);
    const r = parseDdm('Ex0/2 30.000 3.300 5.000 0.500 0.100');
    assert.equal(r.find(s => s.kind === 'current')?.value, 0.005);
    assert.equal(r.find(s => s.kind === 'optical_rx')?.unit, 'milliwatt');
});
test('bridgePort→ifIndex per PVID e MAC; FDB ID non spacciato per VLAN', async () => {
    const { parseBridgeMap, parseFdb, applyPvid, emptyInterface } = await import('../parsers');
    const ports = [{ ...emptyInterface('Ex0/7'), if_index: 107 }];
    const b = parseBridgeMap([{ oid: '1.3.6.1.2.1.17.1.4.1.2.7', value: 107 }]);
    applyPvid(ports, [{ oid: '1.3.6.1.2.1.17.7.1.4.5.1.1.7', value: 40 }], b);
    assert.equal(ports[0].pvid, 40);
    const r = parseFdb([{ oid: '1.3.6.1.2.1.17.7.1.2.2.1.2.99.2.0.0.0.0.1', value: 7 }], b, ports, true);
    assert.equal(r[0].if_index, 107);
    assert.equal(r[0].fdb_id, 99);
    assert.equal(r[0].vlan_id, null);
});
