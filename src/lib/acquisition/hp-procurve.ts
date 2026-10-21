import { acquisitionInputSchema, snapshotSchema } from './schema';
import { versioneCollector } from './catalogo';
import type { AcquisitionRequest, AcquisitionSnapshot, AcquisitionTransports, ReadResult, SnmpRow, DeviceInterface } from './schema';
import { createTransports, PROCURVE_COMMANDS } from './transports';
import { parseProcurveIdentity, parseProcurvePorts, parseProcurveVlans, parseProcurveLldp, parseProcurveTrunks, parseProcurvePoe, parseProcurveStp, parseProcurveFdb, parseProcurveResources, parseProcurveEnvironment, parseProcurveHardware, parseProcurveModules, cleanProcurveConsole } from './procurve-parsers';
import { textValue, parseSnmpInterfaces, parseBridgeMap, applyPvid, parseSnmpVlans, parseFdb, parseIpNetwork } from './parsers';
import { redactSnapshot } from './redact';
type Section<T> = {
    status: 'ok' | 'partial' | 'error' | 'unsupported' | 'skipped';
    data: T;
    collected_at: string;
    sources: string[];
    warnings: string[];
};
function section<T>(data: T, status: Section<T>['status'] = 'skipped', sources: string[] = [], warnings: string[] = []): Section<T> { return { data, status, collected_at: new Date().toISOString(), sources, warnings }; }
const emptyRead = <T>(data: T): ReadResult<T> => ({ status: 'error', data, warnings: ['NOT_COLLECTED'] });
export async function collectHpProcurve(request: AcquisitionRequest, transports?: AcquisitionTransports): Promise<AcquisitionSnapshot> {
    const input = acquisitionInputSchema.parse(request);
    if (input.collector !== 'hp-procurve')
        throw Error('COLLECTOR_MISMATCH');
    const start = Date.now(), io = transports ?? createTransports(input);
    async function safe<T>(op: () => Promise<ReadResult<T>>, empty: T): Promise<ReadResult<T>> {
        try {
            return await op();
        }
        catch {
            return { status: 'error', data: empty, warnings: ['TRANSPORT_EXCEPTION'] };
        }
    }
    async function shell(commands: readonly string[]) {
        try {
            return await io.shell(commands);
        }
        catch {
            return Object.fromEntries(commands.map(c => [c, { status: 'error' as const, data: '', warnings: ['SSH_TRANSPORT_EXCEPTION'] }]));
        }
    }
    const oids = ['1.3.6.1.2.1.1.1.0', '1.3.6.1.2.1.1.2.0', '1.3.6.1.2.1.1.3.0', '1.3.6.1.2.1.1.5.0'];
    const [sys, ident] = await Promise.all([input.snmp ? safe(() => io.get(oids), []) : emptyRead<SnmpRow[]>([]), input.ssh ? shell(['show system', 'show version']) : {} as Record<string, ReadResult<string>>]);
    const identityRead = ident['show system'] ?? emptyRead(''), versionRead = ident['show version'] ?? emptyRead(''), value = (oid: string) => textValue(sys.data.find(r => r.oid === oid)?.value);
    let description = value(oids[0]) ?? '';
    const rawIdentity = identityRead.status === 'ok' ? identityRead.data : '';
    const revision = rawIdentity.match(/Software revision\s*:\s*([A-Z]{1,3}\.\d{2}\.\d{2}[^\s]*)/i)?.[1];
    const sshOnly = !description && !!revision;
    if (sshOnly)
        description = 'HP ProCurve, revision ' + revision;
    const identity = parseProcurveIdentity(rawIdentity, description);
    if (identity) {
        if (sshOnly)
            identity.model = null;
        identity.sys_object_id = value(oids[1]);
        identity.hostname = identity.hostname ?? value(oids[3]);
        const ticks = Number(value(oids[2]));
        identity.uptime_seconds = value(oids[2]) !== null && Number.isFinite(ticks) && ticks >= 0 ? ticks / 100 : null;
    }
    const snapshot: AcquisitionSnapshot = { schema_version: '1.0', collector: 'hp-procurve', collector_version: versioneCollector('hp-procurve'), target: input.host, collected_at: new Date(start).toISOString(), duration_ms: 0, status: 'error', identity: section(identity, identity ? (identity.model ? 'ok' : 'partial') : 'error', [...(input.snmp ? ['snmp:system'] : []), ...(input.ssh ? ['ssh:show system', 'ssh:show version'] : [])], [...(identity ? [] : ['DEVICE_NOT_IDENTIFIED_AS_PROCURVE']), ...(input.snmp ? sys.warnings : []), ...(input.ssh ? identityRead.warnings : [])]), interfaces: section([]), vlans: section([]), forwarding: section([]), neighbors: section([]), spanning_tree: section({ enabled: null, protocol: null, ports: [] }), aggregation: section([]), poe: section([]), sensors: section([], 'skipped', [], ['NUMERIC_SENSORS_NOT_IMPLEMENTED']), network: section({ ipv4_addresses: [], arp: [] }) };
    const finish = () => { snapshot.duration_ms = Date.now() - start; return snapshotSchema.parse(redactSnapshot(snapshot, input)); };
    if (!identity)
        return finish();
    // A failed login is never retried: the next shell is only a continuation after successful identity commands.
    const modular = /540[0-9]|820[0-9]|zl2/i.test(identity.model ?? '');
    const sshPromise = input.ssh && identityRead.status === 'ok' && versionRead.status === 'ok' ? shell(PROCURVE_COMMANDS.slice(2).filter(c => c !== 'show modules' || modular)) : Promise.resolve({} as Record<string, ReadResult<string>>);
    const walks: Record<string, ReadResult<SnmpRow[]>> = {};
    const snmpPromise = (async () => {
        if (!input.snmp || sys.status === 'error')
            return;
        for (const [name, oid] of Object.entries({ interfaces: '1.3.6.1.2.1.2.2.1', extended: '1.3.6.1.2.1.31.1.1.1', bridge: '1.3.6.1.2.1.17.1.4.1', vlans: '1.3.6.1.2.1.17.7.1.4.3.1', pvid: '1.3.6.1.2.1.17.7.1.4.5.1.1', fdb: '1.3.6.1.2.1.17.7.1.2.2.1', ip: '1.3.6.1.2.1.4.20.1', arp: '1.3.6.1.2.1.4.22.1', hardware: '1.3.6.1.2.1.47.1.1.1.1' }))
            walks[name] = await safe(() => io.walk(oid), []);
    })();
    const ssh = await sshPromise;
    await snmpPromise;
    const read = (command: string) => ssh[command] ?? emptyRead(''), walk = (name: string) => walks[name] ?? emptyRead<SnmpRow[]>([]);
    function parsed<T>(command: string, parser: (text: string) => T, empty: T, valid: (data: T) => boolean): Section<T> {
        const r = read(command);
        if (!input.ssh)
            return section(empty, 'skipped', [], ['SSH_CREDENTIAL_NOT_PROVIDED']);
        if (r.status === 'error' || r.status === 'unsupported')
            return section(empty, r.status, ['ssh:' + command], r.warnings);
        const data = parser(r.data);
        return section(data, valid(data) && r.status === 'ok' ? 'ok' : 'partial', ['ssh:' + command], [...r.warnings, ...(valid(data) ? [] : ['FORMAT_UNRECOGNIZED_OR_EMPTY'])]);
    }
    const ports = parseSnmpInterfaces(walk('interfaces').data, walk('extended').data);
    const consolePorts = parsed('show interfaces brief', parseProcurvePorts, [], p => p.length > 0);
    const portCandidates = (cleanProcurveConsole(read('show interfaces brief').data).match(/^\s*[A-Z]?\d+(?:-Trk\d+)?\s+[^|\n]*\|/gmi) || []).length;
    if (consolePorts.status === 'ok' && portCandidates !== consolePorts.data.length) {
        consolePorts.status = 'partial';
        consolePorts.warnings.push('INTERFACE_ROWS_UNRECOGNIZED');
    }
    snapshot.interfaces = consolePorts.data.length ? consolePorts : section(ports, ports.length ? walk('interfaces').status === 'ok' ? 'ok' : 'partial' : 'error', input.snmp ? ['snmp:ifTable', 'snmp:ifXTable'] : [], walk('interfaces').warnings);
    if (consolePorts.data.length && input.snmp) {
        const used = new Set<DeviceInterface>();
        for (const p of consolePorts.data) {
            const matches = ports.filter(s => s.name === p.name);
            if (matches.length !== 1)
                continue;
            const s = matches[0];
            used.add(s);
            Object.assign(p, { if_index: s.if_index, mtu: s.mtu, mac: s.mac, description: s.description, counters: s.counters });
        }
        snapshot.interfaces.data.push(...ports.filter(s => !used.has(s)));
        snapshot.interfaces.sources.push('snmp:ifTable', 'snmp:ifXTable');
        if (walk('interfaces').status !== 'ok' || walk('extended').status !== 'ok') {
            snapshot.interfaces.status = 'partial';
            snapshot.interfaces.warnings.push('SNMP_INTERFACE_DETAILS_PARTIAL', ...walk('interfaces').warnings, ...walk('extended').warnings);
        }
    }
    const bridge = parseBridgeMap(walk('bridge').data);
    applyPvid(snapshot.interfaces.data, walk('pvid').data, bridge);
    if (input.snmp)
        snapshot.interfaces.sources.push('snmp:dot1qPvid');
    const detail = read('show vlans ports all detail'), vlans = parseProcurveVlans(read('show vlans').data, detail.status === 'ok' ? detail.data : '');
    snapshot.vlans = parsed('show vlans', () => vlans, [], v => v.length > 0);
    if (detail.status === 'ok' && vlans.some(v => v.tagged_ports.length || v.untagged_ports.length))
        snapshot.vlans.sources.push('ssh:show vlans ports all detail');
    else {
        const fromSnmp = parseSnmpVlans(walk('vlans').data, bridge, snapshot.interfaces.data);
        if (fromSnmp.length) {
            snapshot.vlans = section(fromSnmp, walk('vlans').status, ['snmp:dot1qVlanStaticTable'], walk('vlans').warnings);
        }
        else if (snapshot.vlans.data.length) {
            snapshot.vlans.status = 'partial';
            snapshot.vlans.warnings.push('VLAN_MEMBERSHIP_UNAVAILABLE');
        }
    }
    snapshot.forwarding = parsed('show mac-address', parseProcurveFdb, [], v => v.length > 0 || /No entries|No MAC addresses/i.test(read('show mac-address').data));
    if (snapshot.forwarding.status !== 'ok' && walk('fdb').data.length) {
        snapshot.forwarding = section(parseFdb(walk('fdb').data, bridge, snapshot.interfaces.data, true), walk('fdb').status, ['snmp:dot1qTpFdbTable'], [...walk('fdb').warnings, 'FDB_ID_IS_NOT_VLAN_ID']);
    }
    for (const f of snapshot.forwarding.data)
        if (f.if_index === null && f.port) {
            const matches = snapshot.interfaces.data.filter(p => p.name === f.port);
            if (matches.length === 1)
                f.if_index = matches[0].if_index;
        }
    const fdbCandidates = (cleanProcurveConsole(read('show mac-address').data).match(/\b[0-9a-f]{6}-[0-9a-f]{6}\b/gi) || []).length;
    if (snapshot.forwarding.sources.includes('ssh:show mac-address') && fdbCandidates !== snapshot.forwarding.data.length) {
        snapshot.forwarding.status = 'partial';
        snapshot.forwarding.warnings.push('FDB_ROWS_UNRECOGNIZED');
    }
    if (detail.status === 'ok' && snapshot.vlans.sources.includes('ssh:show vlans ports all detail')) {
        const expected = (cleanProcurveConsole(detail.data).match(/Port-based\s+\S+\s+\S+\s+(?:Tagged|Untagged|Forbid)\b/gi) || []).length;
        const actual = snapshot.vlans.data.reduce((n, v) => n + v.tagged_ports.length + v.untagged_ports.length + v.forbidden_ports.length, 0);
        if (actual !== expected) {
            snapshot.vlans.status = 'partial';
            snapshot.vlans.warnings.push('VLAN_ROWS_UNRECOGNIZED');
        }
    }
    snapshot.neighbors = parsed('show lldp info remote-device detail', parseProcurveLldp, [], v => v.length > 0 || /No LLDP|No remote|0 entries/i.test(read('show lldp info remote-device detail').data));
    const neighborCandidates = (read('show lldp info remote-device detail').data.match(/Local Port\s*:/gi) || []).length;
    if (snapshot.neighbors.status === 'ok' && neighborCandidates !== snapshot.neighbors.data.length) {
        snapshot.neighbors.status = 'partial';
        snapshot.neighbors.warnings.push('LLDP_ROWS_UNRECOGNIZED');
    }
    snapshot.aggregation = parsed('show trunks', parseProcurveTrunks, [], v => v.length > 0 || /No trunk|No ports|No entries/i.test(read('show trunks').data));
    for (const lag of snapshot.aggregation.data) {
        const match = snapshot.interfaces.data.find(p => p.name === lag.name);
        if (match) {
            lag.admin_status = match.admin_status;
            lag.oper_status = match.oper_status;
        }
    }
    snapshot.poe = parsed('show power-over-ethernet brief', parseProcurvePoe, [], v => v.length > 0);
    const poeCandidates = (cleanProcurveConsole(read('show power-over-ethernet brief').data).match(/^\s*[A-Z]?\d+\s+(?:Yes|No)\s+/gmi) || []).length;
    if (snapshot.poe.status === 'ok' && poeCandidates !== snapshot.poe.data.length) {
        snapshot.poe.status = 'partial';
        snapshot.poe.warnings.push('POE_ROWS_UNRECOGNIZED');
    }
    snapshot.spanning_tree = parsed('show spanning-tree', parseProcurveStp, { enabled: null, protocol: null, ports: [] }, v => v.enabled !== null);
    if (snapshot.spanning_tree.data.protocol?.includes('MSTP'))
        snapshot.spanning_tree.warnings.push('CIST_ONLY_MST_INSTANCES_NOT_COLLECTED');
    const resources = parseProcurveResources(rawIdentity);
    snapshot.resources = section(resources, identityRead.status === 'ok' && resources.memory_total_bytes !== null ? 'ok' : 'partial', ['ssh:show system'], identityRead.warnings);
    const environment = parseProcurveEnvironment(read('show system fans').data, read('show power-over-ethernet brief').data);
    snapshot.environment = section(environment, read('show system fans').status === 'ok' && environment.fans.length ? 'ok' : read('show system fans').status === 'ok' ? 'partial' : read('show system fans').status, ['ssh:show system fans', 'ssh:show power-over-ethernet brief'], read('show system fans').warnings);
    if (!input.ssh) {
        snapshot.resources = section(resources, 'skipped', [], ['SSH_CREDENTIAL_NOT_PROVIDED']);
        snapshot.environment = section(environment, 'skipped', [], ['SSH_CREDENTIAL_NOT_PROVIDED']);
    }
    const ipReads = [walk('ip'), walk('arp')], net = parseIpNetwork(walk('ip').data, walk('arp').data);
    snapshot.network = input.snmp ? section(net, ipReads.every(r => r.status === 'ok') ? (net.ipv4_addresses.length || net.arp.length ? 'ok' : 'partial') : ipReads.some(r => r.status === 'ok' || r.status === 'partial') ? 'partial' : 'error', ['snmp:ipAddrTable', 'snmp:ipNetToMediaTable'], ipReads.flatMap(r => r.warnings)) : section(net, 'skipped', [], ['SNMP_CREDENTIAL_NOT_PROVIDED']);
    const hardware = parseProcurveHardware(walk('hardware').data);
    snapshot.hardware = input.snmp ? section(hardware, walk('hardware').status === 'ok' && !hardware.length ? 'partial' : walk('hardware').status, ['snmp:entPhysicalTable'], walk('hardware').warnings) : section(hardware, 'skipped', [], ['SNMP_CREDENTIAL_NOT_PROVIDED']);
    const indexes = new Set(hardware.map(h => h.entity_index));
    if (hardware.some(h => h.parent_index !== null && h.parent_index !== 0 && !indexes.has(h.parent_index))) {
        snapshot.hardware.status = 'partial';
        snapshot.hardware.warnings.push('ENTITY_PARENT_NOT_OBSERVED');
    }
    if (modular) {
        snapshot.modules = parsed('show modules', parseProcurveModules, [], rows => rows.length > 0);
        const candidates = (cleanProcurveConsole(read('show modules').data).match(/^\s*(?:MM\d+|[A-Z])\s+/gm) || []).length;
        if (snapshot.modules.status === 'ok' && candidates !== snapshot.modules.data.length) {
            snapshot.modules.status = 'partial';
            snapshot.modules.warnings.push('MODULE_ROWS_UNRECOGNIZED');
        }
        if (snapshot.modules.status === 'ok') {
            const slots = new Set(snapshot.modules.data.map(m => m.slot));
            for (const port of snapshot.interfaces.data) {
                const slot = port.name.match(/^([A-Z])\d+$/)?.[1];
                if (slot) {
                    port.slot = slot;
                    port.module_observed = slots.has(slot);
                }
            }
            for (const port of snapshot.poe.data) {
                port.module_observed = snapshot.interfaces.data.find(i => i.name === port.port)?.module_observed ?? null;
            }
            if (snapshot.interfaces.data.some(p => p.module_observed === false))
                snapshot.interfaces.warnings.push('INTERFACES_WITHOUT_OBSERVED_MODULE');
            if (snapshot.poe.data.some(p => p.module_observed === false))
                snapshot.poe.warnings.push('POE_PORTS_WITHOUT_OBSERVED_MODULE');
        }
    }
    const all = [...(snapshot.modules ? [snapshot.modules] : []), snapshot.hardware, snapshot.identity, snapshot.interfaces, snapshot.vlans, snapshot.forwarding, snapshot.neighbors, snapshot.spanning_tree, snapshot.aggregation, snapshot.poe, snapshot.resources, snapshot.environment, snapshot.network].filter(s => s.status !== 'skipped');
    snapshot.status = all.every(s => s.status === 'ok') ? 'ok' : all.some(s => s.status === 'ok' || s.status === 'partial') ? 'partial' : 'error';
    return finish();
}
