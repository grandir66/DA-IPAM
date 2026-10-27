import { acquisitionInputSchema } from './schema';
import type { AcquisitionRequest, AcquisitionSnapshot, AcquisitionTransports } from './schema';
import { createTransports } from './transports';
import { ARUBA_CX_COMMANDS } from './comandi';
import { versioneCollector } from './catalogo';
import { sez, daLettura, leggiTutto, nonLetto, statoGlobale, chiudi } from './costruzione';
import { parseCxIdentity, parseCxInterfaces, parseCxVlans, parseCxFdb, parseCxNeighbors, parseCxStp, parseCxPoe, parseCxTemperatures, parseCxNetwork } from './aruba-cx-parsers';

/** Solo SSH e show statici: nessun accesso a DB o configurazione dell'apparato. */
export async function collectArubaCx(request: AcquisitionRequest, transports?: AcquisitionTransports): Promise<AcquisitionSnapshot> {
    const input = acquisitionInputSchema.parse(request), start = Date.now();
    if (input.collector !== 'aruba-cx') throw Error('COLLECTOR_MISMATCH');
    const io = transports ?? createTransports(input);
    const reads = await leggiTutto(c => io.shell(c), ARUBA_CX_COMMANDS, 'SSH_TRANSPORT_EXCEPTION');
    const read = (c: string) => reads[c] ?? nonLetto();
    // Non usare dati parziali o messaggi d'errore per identificare la famiglia.
    const version = read('show version'), system = read('show system');
    const id = parseCxIdentity(version.status === 'ok' ? version.data : '', system.status === 'ok' ? system.data : '');
    const snap: AcquisitionSnapshot = {
        schema_version: '1.0', collector: 'aruba-cx', collector_version: versioneCollector('aruba-cx'), target: input.host,
        collected_at: new Date(start).toISOString(), duration_ms: 0, status: 'error',
        identity: sez(id, id ? (id.model && id.firmware && system.status === 'ok' && version.status === 'ok' ? 'ok' : 'partial') : 'error', ['ssh:show version', 'ssh:show system'], [...version.warnings, ...system.warnings, ...(id ? [] : ['DEVICE_NOT_IDENTIFIED_AS_AOS_CX'])]),
        interfaces: sez([]), vlans: sez([]), forwarding: sez([]), neighbors: sez([]), spanning_tree: sez({ enabled: null, protocol: null, ports: [] }), aggregation: sez([]), poe: sez([]), sensors: sez([]), network: sez({ ipv4_addresses: [], arp: [] }),
    };
    if (!id) return chiudi(snap, input, start);
    snap.interfaces = daLettura(read('show interface brief'), parseCxInterfaces, [], 'ssh:show interface brief', v => v.length > 0);
    // La CLI brief non offre contatori, duplex o ifIndex: non inventarli dal nome della porta.
    if (snap.interfaces.data.length) snap.interfaces.warnings.push('IFINDEX_COUNTERS_DUPLEX_NOT_COLLECTED');
    snap.vlans = daLettura(read('show vlan'), s => parseCxVlans(s, snap.interfaces.data), [], 'ssh:show vlan', v => v.length > 0 && snap.interfaces.status === 'ok');
    if (snap.vlans.data.length) snap.vlans.warnings.push('VLAN_MEMBERSHIP_WITHOUT_KNOWN_NATIVE_PORT_OMITTED');
    snap.forwarding = daLettura(read('show mac-address-table'), parseCxFdb, [], 'ssh:show mac-address-table', v => v.length > 0 || /Number of MAC addresses\s*:\s*0\b/i.test(read('show mac-address-table').data));
    snap.neighbors = daLettura(read('show lldp neighbor-info detail'), parseCxNeighbors, [], 'ssh:show lldp neighbor-info detail', v => v.length > 0 || /Total Neighbor Entries\s*:\s*0\b/i.test(read('show lldp neighbor-info detail').data));
    snap.spanning_tree = daLettura(read('show spanning-tree'), parseCxStp, { enabled: null, protocol: null, ports: [] }, 'ssh:show spanning-tree', v => v.enabled === false || v.enabled === true && v.ports.length > 0);
    const lacp = read('show lacp interfaces');
    // Il target vero non ha LAG; una tabella popolata resta parziale finché è collaudata su un LAG vero.
    snap.aggregation = daLettura(lacp, () => [], [], 'ssh:show lacp interfaces', () => /\bNo LAG configured\b/i.test(lacp.data));
    if (snap.aggregation.status === 'partial') snap.aggregation.warnings.push('LACP_POPULATED_TABLE_NOT_IMPLEMENTED');
    snap.poe = daLettura(read('show power-over-ethernet brief'), parseCxPoe, [], 'ssh:show power-over-ethernet brief', v => v.length > 0);
    snap.sensors = daLettura(read('show environment temperature'), parseCxTemperatures, [], 'ssh:show environment temperature', v => v.length > 0);
    const ip = read('show ip interface brief'), arp = read('show arp');
    const net = parseCxNetwork(['ok', 'partial'].includes(ip.status) ? ip.data : '', ['ok', 'partial'].includes(arp.status) ? arp.data : '');
    const ipKnown = /Interface\s+IP Address/.test(ip.data), arpKnown = /Total Number Of ARP Entries Listed:\s*\d+/i.test(arp.data);
    snap.network = sez(net, ip.status === 'ok' && arp.status === 'ok' && ipKnown && arpKnown ? 'ok' : [ip, arp].some(r => r.status === 'ok' || r.status === 'partial') ? 'partial' : 'error', ['ssh:show ip interface brief', 'ssh:show arp'], [...ip.warnings, ...arp.warnings, ...(!ipKnown || !arpKnown ? ['NETWORK_OUTPUT_INCOMPLETE'] : [])]);
    const cpu = system.status === 'ok' ? system.data.match(/^CPU Util \(%\)\s*:\s*(\d+(?:\.\d+)?)/m)?.[1] : undefined;
    snap.resources = sez({ cpu_percent: cpu === undefined ? null : Number(cpu), memory_total_bytes: null, memory_free_bytes: null }, 'partial', ['ssh:show system'], ['MEMORY_BYTES_NOT_AVAILABLE']);
    snap.status = statoGlobale([snap.identity, snap.interfaces, snap.vlans, snap.forwarding, snap.neighbors, snap.spanning_tree, snap.aggregation, snap.poe, snap.sensors, snap.network, snap.resources]);
    return chiudi(snap, input, start);
}
