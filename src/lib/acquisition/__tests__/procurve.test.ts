import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseProcurveIdentity, parseProcurvePorts, parseProcurveVlans, parseProcurveLldp, parseProcurveTrunks, parseProcurvePoe, parseProcurveStp, parseProcurveFdb, parseProcurveResources, parseProcurveEnvironment } from '../procurve-parsers';
test('ProCurve: sorgente vera per modello/revisione; non riconoscere CX o Comware', () => {
    const d = parseProcurveIdentity('Software revision : YC.16.11.0020  Base MAC Addr : 020000-000001\nROM Version : YC.16.01.0003  Serial Number : LAB001\nSystem Name : LAB-SW', 'Aruba JL357A 2540-48G-PoE+-4SFP+ Switch, revision YC.16.11.0020, ROM YC.16.01.0003');
    assert.equal(d?.firmware, 'YC.16.11.0020');
    assert.equal(d?.part_number, 'JL357A');
    assert.equal(d?.serial_number, 'LAB001');
    assert.equal(parseProcurveIdentity('', 'Aruba JL658A CX 6300, Version 10.13'), null);
});
test('porta aggregata 49-Trk3 mantiene nome fisico 49; modo 10GigFD e down distinti', () => {
    const p = parseProcurvePorts('49-Trk3 SFP+SR | No Yes Up 10GigFD NA off 0\n50-Trk3 SFP+SR | No Yes Down 10GigFD NA off 0\n1 100/1000T | No No Down 1000FDx Auto off 0');
    assert.equal(p.length, 3);
    assert.equal(p[0].name, '49');
    assert.equal(p[0].speed_bps, 10000000000);
    assert.equal(p[1].speed_bps, null);
    assert.equal(p[2].admin_status, 'down');
});
test('VLAN catalogo non implica membership; dettaglio porte distingue Tagged/Untagged', () => {
    const v = parseProcurveVlans('1 DEFAULT | Port-based No No\n40 LAB | Port-based No No', 'Status and Counters - VLAN Information - for ports 49\n40 LAB | Port-based No No Tagged\n1 DEFAULT | Port-based No No Untagged');
    assert.equal(v.find(v => v.id === 40)?.tagged_ports[0], '49');
    assert.equal(v.find(v => v.id === 1)?.untagged_ports[0], '49');
});
test('LLDP: chassis non MAC e PortId testuale preservati; versione e indirizzo', () => {
    const n = parseProcurveLldp('Local Port : 49\nChassisId : 02 00 00 00 00 01\nPortId : Ethernet 1/1\nSysName : LAB-PEER\nSystem Descr : LAB OS\nPortDescr : uplink\nSystem Capabilities Enabled : bridge, router\nAddress : 192.0.2.2\nLocal Port : 3\nChassisId : lab-host\nPortId : eth0');
    assert.equal(n.length, 2);
    assert.equal(n[0].remote_chassis, '02:00:00:00:00:01');
    assert.equal(n[0].remote_port, 'Ethernet 1/1');
    assert.deepEqual(n[0].management_addresses, ['192.0.2.2']);
    assert.equal(n[1].remote_chassis, 'lab-host');
});
test('PoE PD Draw non PSE Reserved e senza conversioni errate', () => {
    const p = parseProcurvePoe('3 Yes low off usage lldp 10.2 W 9.4 W Delivering 4 2');
    assert.equal(p[0].power_watts, 9.4);
    assert.equal(p[0].status, 'Delivering');
});
test('trunk e STP: aggregati preservati, ruolo non inventato', () => {
    const l = parseProcurveTrunks('49 | uplink SFP+SR | Trk3 LACP\n50 | uplink SFP+SR | Trk3 LACP');
    assert.deepEqual(l[0].members, ['49', '50']);
    const s = parseProcurveStp('STP Enabled : Yes\nForce Version : MSTP-operation\nCST Root Port : Trk3\n3 100/1000T | 20000 128 Forwarding | 020000-000001 3 Yes Yes\nTrk3 | 2000 64 Forwarding | 020000-000001 3 Yes No');
    assert.equal(s.enabled, true);
    assert.equal(s.ports[0].role, null);
    assert.equal(s.ports[1].role, 'root');
});
test('FDB HP a sei cifre con trattino e VLAN in colonna; fan OK non significa 0 RPM', () => {
    const d = parseProcurveFdb('020000-000001 Trk3 40');
    assert.equal(d[0].vlan_id, 40);
    assert.equal(d[0].port, 'Trk3');
    const e = parseProcurveEnvironment('Fan-1 | Fan OK | 0 | Chassis', 'Available: 370 W Used: 61 W Remaining: 309 W');
    assert.equal(e.fans[0].status, 'ok');
    assert.equal(e.poe_budget_watts.used, 61);
    assert.equal('rpm' in e.fans[0], false);
});
test('CPU zero e memoria con virgole restano dati numerici esatti', () => {
    const r = parseProcurveResources('Up Time : 72 days Memory - Total : 358,912,512\nCPU Util (%) : 0 Free : 255,372,548');
    assert.equal(r.cpu_percent, 0);
    assert.equal(r.memory_total_bytes, 358912512);
    assert.equal(r.memory_free_bytes, 255372548);
});
test('pager ProCurve Enter/Return incollato alla riga seguente non perde porte o MAC', () => {
    for (const key of ['Enter', 'Return']) {
        const footer = ', next page: Space, next line: ' + key + ', quit: Control-C';
        const poe = parseProcurvePoe('39 Yes low off usage usage 0.0 W 0.0 W Searching 0 -\n' + footer + ' 40 Yes low off usage usage 3.2 W 3.1 W Delivering 2 1');
        assert.equal(poe.length, 2);
        assert.equal(poe[1].port, '40');
        const fdb = parseProcurveFdb('020000-000001 Trk3 40\n' + footer + ' 020000-000002 40 40');
        assert.equal(fdb.length, 2);
        const vlan = parseProcurveVlans('40 LAB | Port-based No No', 'VLAN Information - for ports 40\n' + footer + ' 40 LAB | Port-based No No Untagged');
        assert.deepEqual(vlan[0].untagged_ports, ['40']);
    }
});
