import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCxIdentity, parseCxInterfaces, parseCxVlans, parseCxPoe, parseCxNeighbors, parseCxStp } from '../aruba-cx-parsers';

test('AOS-CX: identità propria, firmware distinto da BIOS, nessun ProCurve', () => {
    const id = parseCxIdentity('ArubaOS-CX\nVersion : PL.10.12.0006\nBIOS Version : PL.01.0002', 'Hostname : switch-lab\nProduct Name : JL675A 6100 48G CL4 4SFP+ Swch\nChassis Serial Nbr : LAB123\nUp Time : 37 minutes');
    assert.equal(id?.firmware, 'PL.10.12.0006');
    assert.equal(id?.part_number, 'JL675A');
    assert.equal(id?.uptime_seconds, 2220);
    assert.equal(parseCxIdentity('ArubaOS-Switch YC.16.11', 'Hostname : lab'), null);
    assert.equal(parseCxIdentity('ArubaOS-CX\nVersion : PL.10.13.0005', 'Product Name : R8N85A 6000 48G CL4 4SFP Swch')?.part_number, 'R8N85A');
});
const brief = 'Port           Native  Mode   Type             Enabled Status  Reason                  Speed   Description\n               VLAN                                                                    (Mb/s)\n1/1/1          1       access 1GbT             yes     up                              1000    lab\n1/1/2          16      trunk  1GbT             yes     down    Waiting for link        --      --';
test('AOS-CX: velocità negoziata, down senza velocità inventata e ifIndex ignoto', () => {
    const p = parseCxInterfaces(brief);
    assert.equal(p.length, 2); assert.equal(p[0].speed_bps, 1e9); assert.equal(p[0].if_index, null);
    assert.equal(p[1].pvid, 16); assert.equal(p[1].speed_bps, null);
});
test('AOS-CX: intervalli VLAN e continuazioni; native distinte dalle tagged', () => {
    const v = parseCxVlans('VLAN  Name                              Status  Reason                  Type        Interfaces\n1     VLAN_LAB                          up      ok                      default     1/1/1,\n                                                                                    1/1/2\n16    VLAN_16                           down    no_member_forwarding    static      1/1/1-1/1/2', parseCxInterfaces(brief));
    assert.equal(v.length, 2); assert.deepEqual(v[0].untagged_ports, ['1/1/1']); assert.deepEqual(v[1].untagged_ports, ['1/1/2']); assert.deepEqual(v[1].tagged_ports, ['1/1/1']);
});
test('AOS-CX: potenza PD erogata, non riservata; zero valido', () => {
    const p = parseCxPoe('1/1/1    Yes low      Off     usage         30.0 W  12.5 W  delivering    N/A    4   2\n1/1/2    No  low      Off     usage         0.0 W   0.0 W  disabled      N/A    N/A N/A');
    assert.equal(p[0].power_watts, 12.5); assert.equal(p[1].power_watts, 0); assert.equal(p[1].enabled, false);
});
test('AOS-CX: più vicini sulla stessa porta, più istanze STP', () => {
    const n = parseCxNeighbors('Port : 1/1/1\nNeighbor Chassis-ID : 02:00:00:00:00:01\nNeighbor Port-ID : 1/1/8\nNeighbor System-Name : sw-lab\nTTL : 120\nPort : 1/1/1\nNeighbor Chassis-ID : 02:00:00:00:00:02\nNeighbor Port-ID : 1/1/9');
    assert.equal(n.length, 2); assert.equal(n[0].ttl_seconds, 120);
    const s = parseCxStp('Spanning tree status : Enabled Protocol: MSTP\nMST0\n1/1/1 Root Forwarding 20000 128 P2P\nMST1\n1/1/1 Alternate Blocking 20000 128 P2P');
    assert.equal(s.ports.length, 2); assert.equal(s.ports[1].instance, 'MST1');
});
test('AOS-CX: continuazione VLAN senza virgola finale e LAG su riga a parte', () => {
    const v = parseCxVlans('VLAN  Name                              Status  Reason                  Type        Interfaces\n16    VLAN_16                           up      ok                      static      1/1/1\n                                                                                    lag1', [...parseCxInterfaces(brief), { ...parseCxInterfaces(brief)[0], name: 'lag1', pvid: 1 }]);
    assert.deepEqual(v[0].tagged_ports, ['1/1/1', 'lag1']);
});
