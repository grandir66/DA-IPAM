import { redactSnapshot } from "./redact";
import { acquisitionInputSchema, snapshotSchema } from "./schema";
import type { AcquisitionRequest, AcquisitionSnapshot, AcquisitionTransports, ReadResult, SnmpRow, DeviceInterface } from "./schema";
import { createTransports, QSS_COMMANDS } from "./transports";
import { parseSystem, parseSystemSensors, parseInterfaces, parseVlans, parseNeighbors, parseAggregation, parseTemperatures, parseSnmpInterfaces, parseBridgeMap, parseFdb, parseConsoleFdb, parseSnmpVlans, parseStp, parseDdm, enrichInterfaceDetails, textValue, applyPvid, parseIpNetwork } from "./parsers";
type Section<T> = {
    status: "ok" | "partial" | "unsupported" | "error" | "skipped";
    collected_at: string;
    sources: string[];
    warnings: string[];
    data: T;
};
function section<T>(data: T, status: Section<T>['status'] = 'skipped', sources: string[] = [], warnings: string[] = []): Section<T> { return { status, collected_at: new Date().toISOString(), sources, warnings, data }; }
const unread = <T>(data: T): ReadResult<T> => ({ status: 'error', data, warnings: ['NOT_COLLECTED'] });
function parsed<T>(r: ReadResult<string>, parser: (s: string) => T, data: T, command: string, recognized: (value: T) => boolean): Section<T> { if (r.status === 'error' || r.status === 'unsupported')
    return section(data, r.status, ['ssh:' + command], r.warnings); const value = parser(r.data); return section(value, r.status === 'ok' && recognized(value) ? 'ok' : 'partial', ['ssh:' + command], recognized(value) ? r.warnings : [...r.warnings, 'FORMAT_UNRECOGNIZED_OR_EMPTY']); }
function primary<T>(a: Section<T>, b: Section<T>): Section<T> { if (a.status === 'ok')
    return a; if (b.status === 'ok')
    return b; if (a.status === 'partial')
    return a; return b.status === 'partial' ? b : a; }
const SYSTEM = ['1.3.6.1.2.1.1.1.0', '1.3.6.1.2.1.1.2.0', '1.3.6.1.2.1.1.3.0', '1.3.6.1.2.1.1.5.0'];
export async function collectQnapSwitch(request: AcquisitionRequest, transports?: AcquisitionTransports): Promise<AcquisitionSnapshot> {
    const input = acquisitionInputSchema.parse(request), start = Date.now(), io = transports ?? createTransports(input);
    // The wrapper also protects against transport mocks and unexpected library errors; no raw error can leak a secret.
    const safe = async <T>(op: () => Promise<ReadResult<T>>, data: T): Promise<ReadResult<T>> => { try {
        return await op();
    }
    catch {
        return { status: 'error', data, warnings: ['TRANSPORT_EXCEPTION'] };
    } };
    const shell = async (cmds: readonly string[]) => { try {
        return await io.shell(cmds);
    }
    catch {
        return Object.fromEntries(cmds.map(c => [c, { status: 'error' as const, data: '', warnings: ['SSH_TRANSPORT_EXCEPTION'] }]));
    } };
    const [sys, ident] = await Promise.all([input.snmp ? safe(() => io.get(SYSTEM), []) : Promise.resolve(unread<SnmpRow[]>([])), input.ssh ? shell(['show system-information']) : Promise.resolve({} as Record<string, ReadResult<string>>)]);
    const identRead = ident['show system-information'] ?? unread(''), identity = parseSystem(identRead.status === 'ok' ? identRead.data : '');
    const value = (oid: string) => textValue(sys.data.find(r => r.oid === oid)?.value);
    identity.sys_object_id = value(SYSTEM[1]);
    const qnap = /^QSW-[A-Z0-9-]+$/i.test(identity.model ?? '') || identity.sys_object_id === '1.3.6.1.4.1.55062.31';
    identity.manufacturer = qnap ? 'QNAP' : null;
    if (!identity.hostname)
        identity.hostname = value(SYSTEM[3]);
    if (identity.uptime_seconds === null && value(SYSTEM[2]) !== null) {
        const ticks = Number(value(SYSTEM[2]));
        identity.uptime_seconds = Number.isFinite(ticks) && ticks >= 0 ? ticks / 100 : null;
    }
    const snapshot: AcquisitionSnapshot = { schema_version: '1.0', collector: 'qnap-switch', collector_version: '1.0.0', target: input.host, collected_at: new Date(start).toISOString(), duration_ms: 0, status: 'error', network: section({ ipv4_addresses: [], arp: [] }), identity: section(qnap ? identity : null, qnap ? (identity.model && identity.firmware ? 'ok' : 'partial') : 'error', [...(input.snmp ? ['snmp:system'] : []), ...(input.ssh ? ['ssh:show system-information'] : [])], qnap ? (identity.model ? [] : ['MODEL_NOT_AVAILABLE_VIA_SNMP']) : ['DEVICE_NOT_IDENTIFIED_AS_QNAP_SWITCH']), interfaces: section([]), vlans: section([]), forwarding: section([]), neighbors: section([]), spanning_tree: section({ enabled: null, protocol: null, ports: [] }), aggregation: section([]), poe: section([], 'skipped', [], ['POE_NOT_IMPLEMENTED_FOR_THIS_PROFILE']), sensors: section([]) };
    if (input.ssh && identRead.status !== 'ok') snapshot.identity.warnings.push(...identRead.warnings);
    if (input.snmp && sys.status !== 'ok') snapshot.identity.warnings.push(...sys.warnings);
    if (!qnap) {
        snapshot.duration_ms = Date.now() - start;
        return snapshotSchema.parse(redactSnapshot(snapshot, input));
    }
    const commands = QSS_COMMANDS.filter(c => c !== 'show system-information');
    // If authentication/system identification failed, do not make another SSH login attempt.
    const sshPromise = input.ssh && identRead.status === 'ok' ? shell(commands) : Promise.resolve({} as Record<string, ReadResult<string>>);
    const walks: Record<string, ReadResult<SnmpRow[]>> = {};
    const snmpPromise = (async () => { if (!input.snmp || sys.status === 'error')
        return; for (const [name, oid] of Object.entries({ interfaces: '1.3.6.1.2.1.2.2.1', extended: '1.3.6.1.2.1.31.1.1.1', bridge: '1.3.6.1.2.1.17.1.4.1', vlans: '1.3.6.1.2.1.17.7.1.4.3.1', qfdb: '1.3.6.1.2.1.17.7.1.2.2.1', fdb: '1.3.6.1.2.1.17.4.3.1', pvid: '1.3.6.1.2.1.17.7.1.4.5.1.1', ip: '1.3.6.1.2.1.4.20.1', arp: '1.3.6.1.2.1.4.22.1' })) {
        walks[name] = await safe(() => io.walk(oid), []);
    } })();
    const ssh = await sshPromise;
    await snmpPromise;
    const read = (c: string) => ssh[c] ?? unread(''), walk = (n: string) => walks[n] ?? unread<SnmpRow[]>([]);
    const sshInterfaces = parsed(read('show interfaces status'), parseInterfaces, [], 'show interfaces status', v => v.length > 0);
    const details = read('show interfaces');
    if (details.status === 'ok')
        enrichInterfaceDetails(sshInterfaces.data, details.data);
    else if (input.ssh)
        sshInterfaces.warnings.push('INTERFACE_DETAILS_UNAVAILABLE');
    const snmpInterfaces = parseSnmpInterfaces(walk('interfaces').data, walk('extended').data);
    const fromSnmp = section(snmpInterfaces, walk('interfaces').status === 'ok' && snmpInterfaces.length === 0 ? 'partial' : walk('interfaces').status, ['snmp:ifTable', 'snmp:ifXTable'], [...walk('interfaces').warnings, ...(snmpInterfaces.length === 0 ? ['NO_INTERFACES_OBSERVED'] : [])]);
    snapshot.interfaces = primary(sshInterfaces, fromSnmp);
    if (snapshot.interfaces === sshInterfaces) {
        const merged = new Set<DeviceInterface>();
        for (const d of snapshot.interfaces.data) {
            const candidates = snmpInterfaces.filter(s => d.mac && s.mac === d.mac);
            if (candidates.length !== 1)
                continue;
            const s = candidates[0];
            merged.add(s);
            d.if_index = s.if_index;
            d.counters = { ...d.counters, ...s.counters };
            if (d.admin_status === null)
                d.admin_status = s.admin_status;
            d.pvid = s.pvid;
        }
        if (input.snmp) snapshot.interfaces.sources.push(...fromSnmp.sources);
        snapshot.interfaces.data.push(...snmpInterfaces.filter(i => !merged.has(i) && i.kind === 'other'));
    }
    const bridge = parseBridgeMap(walk('bridge').data);
    applyPvid(snapshot.interfaces.data, walk('pvid').data, bridge);
    if (input.snmp) snapshot.interfaces.sources.push('snmp:dot1qPvid');
    if (input.snmp && !snapshot.interfaces.data.some(i => i.pvid !== null)) snapshot.interfaces.warnings.push('PVID_NOT_OBSERVED');
    const network = parseIpNetwork(walk('ip').data, walk('arp').data);
    const netReads = [walk('ip'), walk('arp')];
    snapshot.network = input.snmp
        ? section(network, netReads.every(r => r.status === 'ok')
            ? (network.ipv4_addresses.length || network.arp.length ? 'ok' : 'partial')
            : netReads.some(r => r.status === 'ok' || r.status === 'partial') ? 'partial' : 'error',
          ['snmp:ipAddrTable', 'snmp:ipNetToMediaTable'],
          [...netReads.flatMap(r => r.warnings), ...(!network.ipv4_addresses.length && !network.arp.length ? ['NO_IP_DATA_OBSERVED'] : [])])
        : section(network, 'skipped', [], ['SNMP_CREDENTIAL_NOT_PROVIDED']);
    snapshot.vlans = primary(parsed(read('show vlan'), parseVlans, [], 'show vlan', v => v.length > 0), section(parseSnmpVlans(walk('vlans').data, bridge, snapshot.interfaces.data), walk('vlans').status === 'ok' && walk('vlans').data.length === 0 ? 'partial' : walk('vlans').status, ['snmp:dot1qVlanStaticTable'], walk('vlans').warnings));
    snapshot.forwarding = parsed(read('show mac-address-table'), parseConsoleFdb, [], 'show mac-address-table', v => v.length > 0 || /Total Mac Addresses displayed:\s*0/i.test(read('show mac-address-table').data));
    if (snapshot.forwarding.status !== 'ok') {
        const q = walk('qfdb'), b = walk('fdb'), useQ = q.data.length > 0, r = useQ ? q : b;
        const data = parseFdb(r.data, bridge, snapshot.interfaces.data, useQ);
        snapshot.forwarding = primary(snapshot.forwarding, section(data, r.status === 'ok' && !data.length ? 'partial' : r.status, [useQ ? 'snmp:dot1qTpFdbTable' : 'snmp:dot1dTpFdbTable'], [...r.warnings, ...(useQ ? ['FDB_ID_IS_NOT_VLAN_ID'] : [])]));
    }
    for (const d of snapshot.forwarding.data) {
        if (d.if_index === null && d.port) {
            const i = snapshot.interfaces.data.find(i => i.name.toLowerCase() === d.port!.toLowerCase());
            if (i)
                d.if_index = i.if_index;
        }
    }
    snapshot.neighbors = parsed(read('show lldp neighbors'), parseNeighbors, [], 'show lldp neighbors', v => v.length > 0 || /Total Entries Displayed\s*:\s*0/i.test(read('show lldp neighbors').data));
    if (snapshot.neighbors.status === 'ok')
        snapshot.neighbors.warnings.push('LLDP_SUMMARY_ONLY');
    const stp = read('show spanning-tree ports-summary');
    const enabled = stp.data.match(/Spanning Tree Global Status\s*:\s*(Enabled|Disabled)/i)?.[1], protocol = stp.data.match(/Spanning tree enabled protocol is (\w+)/i)?.[1] ?? null;
    snapshot.spanning_tree = section({ enabled: enabled ? enabled.toLowerCase() === 'enabled' : null, protocol, ports: parseStp(stp.data) }, stp.status === 'ok' && enabled ? 'ok' : stp.status === 'ok' ? 'partial' : stp.status, ['ssh:show spanning-tree ports-summary'], stp.warnings);
    snapshot.aggregation = parsed(read('show etherchannel summary'), parseAggregation, [], 'show etherchannel summary', v => v.length > 0 || /Number of channel-groups in use:\s*0/i.test(read('show etherchannel summary').data));
    const temp = read('show system temperature'), ddm = read('show interfaces ddm'), optics = parseDdm(ddm.data), sensors = [...parseSystemSensors(identRead.data), ...parseTemperatures(temp.data), ...optics];
    snapshot.sensors = section(sensors, sensors.length && ![temp, ddm].some(r => r.status === 'error' || r.status === 'partial') ? 'ok' : 'partial', ['ssh:show system-information', 'ssh:show system temperature', 'ssh:show interfaces ddm'], [...(temp.status === 'ok' ? [] : temp.warnings), ...(ddm.status === 'ok' && optics.length === 0 ? ['DDM_NO_VALID_SAMPLE'] : ddm.warnings)]);
    if (!input.ssh) {
        snapshot.neighbors = section([], 'skipped', [], ['SSH_CREDENTIAL_NOT_PROVIDED']);
        snapshot.spanning_tree = section({enabled:null,protocol:null,ports:[]}, 'skipped', [], ['SSH_CREDENTIAL_NOT_PROVIDED']);
        snapshot.aggregation = section([], 'skipped', [], ['SSH_CREDENTIAL_NOT_PROVIDED']);
        snapshot.sensors = section([], 'skipped', [], ['SSH_CREDENTIAL_NOT_PROVIDED']);
    }
    if (input.ssh && (!identity.model || identRead.status !== 'ok'))
        snapshot.identity.warnings.push('SSH_IDENTITY_UNAVAILABLE');
    const sections = [...(input.snmp ? [snapshot.network] : []), snapshot.identity, snapshot.interfaces, snapshot.vlans, snapshot.forwarding, snapshot.neighbors, snapshot.spanning_tree, snapshot.aggregation, snapshot.sensors];
    snapshot.status = sections.every(s => s.status === 'ok') ? 'ok' : sections.some(s => s.status === 'ok' || s.status === 'partial') ? 'partial' : 'error';
    snapshot.duration_ms = Date.now() - start;
    return snapshotSchema.parse(redactSnapshot(snapshot, input));
}
