import { acquisitionInputSchema, snapshotSchema } from './schema';
import type { AcquisitionRequest, AcquisitionSnapshot, AcquisitionTransports, ReadResult, SnmpRow, Identity } from './schema';
import { createTransports, COMWARE_COMMANDS } from './transports';
import { textValue, parseSnmpInterfaces, parseBridgeMap, applyPvid, parseIpNetwork, parseEntityHardware } from './parsers';
import * as p from './comware-parsers';
import { redactSnapshot } from './redact';
type Section<T> = {
    data: T;
    status: 'ok' | 'partial' | 'error' | 'unsupported' | 'skipped';
    sources: string[];
    warnings: string[];
    collected_at: string;
};
function section<T>(data: T, status: Section<T>['status'] = 'skipped', sources: string[] = [], warnings: string[] = []): Section<T> { return { data, status, sources, warnings, collected_at: new Date().toISOString() }; }
export async function collectHpComware(request: AcquisitionRequest, transports?: AcquisitionTransports): Promise<AcquisitionSnapshot> {
    const input = acquisitionInputSchema.parse(request);
    if (input.collector !== 'hp-comware')
        throw Error('COLLECTOR_MISMATCH');
    const start = Date.now(), io = transports ?? createTransports(input);
    const failed = <T>(data: T): ReadResult<T> => ({ data, status: 'error', warnings: ['NOT_COLLECTED'] });
    async function safe<T>(op: () => Promise<ReadResult<T>>, empty: T) { try {
        return await op();
    }
    catch {
        return { data: empty, status: 'error' as const, warnings: ['TRANSPORT_EXCEPTION'] };
    } }
    async function shell(commands: readonly string[]) { try {
        return await io.shell(commands);
    }
    catch {
        return Object.fromEntries(commands.map(c => [c, failed('')]));
    } }
    const oids = ['1.3.6.1.2.1.1.1.0', '1.3.6.1.2.1.1.2.0', '1.3.6.1.2.1.1.3.0', '1.3.6.1.2.1.1.5.0'];
    const [sys, ident] = await Promise.all([input.snmp ? safe(() => io.get(oids), []) : failed<SnmpRow[]>([]), input.ssh ? shell(['display version']) : Promise.resolve({} as Record<string, ReadResult<string>>)]);
    const value = (oid: string) => textValue(sys.data.find(r => r.oid === oid)?.value), version = ident['display version'] ?? failed(''), description = value(oids[0]) ?? '', versionText = p.comwareText(version.data), recognized = /Comware/i.test(description + ' ' + versionText);
    const ticks = Number(value(oids[2]));
    const identity: Identity | null = recognized ? { manufacturer: /H3C/i.test(description + ' ' + versionText) ? 'H3C' : 'HPE', model: versionText.match(/^\s*(?:HPE?|H3C)\s+(.+?)\s+(?:uptime|with)/mi)?.[1] ?? description.match(/(?:HPE?|H3C)\s+([^\n,]+)/i)?.[1] ?? null, firmware: versionText.match(/Comware Software,?\s*(?:Version\s*)?([^\n]+)/i)?.[1]?.trim() ?? description.match(/Version\s+([^\n]+)/i)?.[1] ?? null, serial_number: null, hostname: value(oids[3]), mac: null, sys_object_id: value(oids[1]), uptime_seconds: value(oids[2]) !== null && Number.isFinite(ticks) ? ticks / 100 : null } : null;
    const snapshot: AcquisitionSnapshot = { schema_version: '1.0', collector: 'hp-comware', collector_version: '1.0.0', target: input.host, collected_at: new Date(start).toISOString(), duration_ms: 0, status: 'error', identity: section(identity, identity ? 'ok' : 'error', [...(input.snmp ? ['snmp:system'] : []), ...(input.ssh ? ['ssh:display version'] : [])], identity ? [...(input.snmp ? sys.warnings : []), ...(input.ssh ? version.warnings : [])] : ['DEVICE_NOT_IDENTIFIED_AS_COMWARE']), interfaces: section([]), vlans: section([]), forwarding: section([]), neighbors: section([]), spanning_tree: section({ enabled: null, protocol: null, ports: [] }), aggregation: section([]), poe: section([]), sensors: section([]), network: section({ ipv4_addresses: [], arp: [] }) };
    const finish = () => { snapshot.duration_ms = Date.now() - start; return snapshotSchema.parse(redactSnapshot(snapshot, input)); };
    if (!identity)
        return finish();
    const walks: Record<string, ReadResult<SnmpRow[]>> = {};
    const snmpPromise = (async () => { if (!input.snmp || sys.status === 'error')
        return; for (const [name, oid] of Object.entries({ interfaces: '1.3.6.1.2.1.2.2.1', extended: '1.3.6.1.2.1.31.1.1.1', bridge: '1.3.6.1.2.1.17.1.4.1', pvid: '1.3.6.1.2.1.17.7.1.4.5.1.1', ip: '1.3.6.1.2.1.4.20.1', arp: '1.3.6.1.2.1.4.22.1', hardware: '1.3.6.1.2.1.47.1.1.1.1' }))
        walks[name] = await safe(() => io.walk(oid), []); })();
    const ssh = input.ssh && version.status === 'ok' ? await shell(COMWARE_COMMANDS.slice(1)) : {};
    await snmpPromise;
    const read = (command: string): ReadResult<string> => ssh[command] ?? failed(''), walk = (name: string) => walks[name] ?? failed<SnmpRow[]>([]);
    function parsed<T>(command: string, parser: (text: string) => T, empty: T, valid: (data: T) => boolean): Section<T> { if (!input.ssh)
        return section(empty, 'skipped', [], ['SSH_CREDENTIAL_NOT_PROVIDED']); const r = read(command); if (r.status === 'error' || r.status === 'unsupported')
        return section(empty, r.status, ['ssh:' + command], r.warnings); const data = parser(r.data), ok = valid(data); return section(data, ok && r.status === 'ok' ? 'ok' : 'partial', ['ssh:' + command], [...r.warnings, ...ok ? [] : ['FORMAT_UNRECOGNIZED_OR_EMPTY']]); }
    const snmpPorts = parseSnmpInterfaces(walk('interfaces').data, walk('extended').data);
    for (const port of snmpPorts)
        port.name = p.comwarePort(port.name);
    snapshot.interfaces = parsed('display interface brief', p.parseComwarePorts, [], rows => rows.length > 0);
    const used = new Set<string>();
    for (const port of snapshot.interfaces.data) {
        const matches = snmpPorts.filter(s => s.name === port.name);
        if (matches.length === 1) {
            const s = matches[0];
            used.add(s.name);
            Object.assign(port, { if_index: s.if_index, mtu: s.mtu, mac: s.mac, description: s.description, counters: s.counters });
        }
    }
    if (input.snmp) {
        snapshot.interfaces.data.push(...snmpPorts.filter(s => !used.has(s.name)));
        snapshot.interfaces.sources.push('snmp:ifTable', 'snmp:ifXTable');
        if (snapshot.interfaces.status !== 'ok' || walk('interfaces').status !== 'ok' || walk('extended').status !== 'ok') {
            snapshot.interfaces.status = snapshot.interfaces.data.length ? 'partial' : 'error';
            snapshot.interfaces.warnings.push('INTERFACE_SOURCES_INCOMPLETE', ...walk('interfaces').warnings, ...walk('extended').warnings);
        }
    }
    applyPvid(snapshot.interfaces.data, walk('pvid').data, parseBridgeMap(walk('bridge').data));
    snapshot.vlans = parsed('display vlan all', p.parseComwareVlans, [], rows => rows.length > 0);
    snapshot.forwarding = parsed('display mac-address', p.parseComwareFdb, [], rows => rows.length > 0 || /No MAC address|0 MAC/i.test(read('display mac-address').data));
    for (const row of snapshot.forwarding.data) { const ports = snapshot.interfaces.data.filter(port => port.name === row.port); if (ports.length === 1) row.if_index = ports[0].if_index; }
    snapshot.neighbors = parsed('display lldp neighbor-information verbose', p.parseComwareLldp, [], rows => rows.length > 0 || /No neighbor|0 neighbor/i.test(read('display lldp neighbor-information verbose').data));
    snapshot.aggregation = parsed('display link-aggregation verbose', p.parseComwareLags, [], rows => rows.length > 0 || /No aggregation/i.test(read('display link-aggregation verbose').data));
    for (const lag of snapshot.aggregation.data) {
        const port = snapshot.interfaces.data.find(i => i.name === lag.name);
        if (port) {
            lag.admin_status = port.admin_status;
            lag.oper_status = port.oper_status;
        }
    }
    snapshot.spanning_tree = parsed('display stp brief', text => p.parseComwareStp(text, read('display stp').status === 'ok' ? read('display stp').data : ''), { enabled: null, protocol: null, ports: [] }, data => data.enabled !== null);
    snapshot.spanning_tree.sources.push('ssh:display stp');
    const poe = read('display poe interface');
    snapshot.poe = section([], !input.ssh ? 'skipped' : poe.status === 'ok' && /PoE is disabled/i.test(poe.data) ? 'ok' : poe.status === 'ok' ? 'partial' : poe.status, ['ssh:display poe interface'], poe.warnings);
    if (poe.status === 'ok' && /PoE is disabled/i.test(poe.data)) {
        snapshot.poe.enabled = false;
        snapshot.poe.warnings.push('POE_GLOBALLY_DISABLED');
    }
    else if (poe.status === 'ok')
        snapshot.poe.warnings.push('POE_ENABLED_FORMAT_NOT_IMPLEMENTED');
    snapshot.sensors = parsed('display environment', p.parseComwareSensors, [], rows => rows.length > 0);
    snapshot.modules = parsed('display device', p.parseComwareModules, [], rows => rows.length > 0);
    snapshot.hardware = input.snmp ? section(parseEntityHardware(walk('hardware').data), walk('hardware').status, ['snmp:entPhysicalTable'], walk('hardware').warnings) : section([], 'skipped');
    if (snapshot.hardware.status === 'ok' && !snapshot.hardware.data.length)
        snapshot.hardware.status = 'partial';
    const resources = p.parseComwareResources(read('display cpu-usage').data, read('display memory').data);
    snapshot.resources = section(resources, input.ssh ? 'partial' : 'skipped', ['ssh:display cpu-usage', 'ssh:display memory']);
    if (read('display cpu-usage').status === 'ok' && read('display memory').status === 'ok' && resources.instances?.length && resources.instances.every(i => i.cpu_percent !== null && i.memory_total_bytes !== null))
        snapshot.resources.status = 'ok';
    snapshot.resources.warnings.push(...read('display cpu-usage').warnings, ...read('display memory').warnings);
    snapshot.environment = section(p.parseComwareEnvironment(read('display fan').data, read('display power').data), input.ssh ? 'partial' : 'skipped', ['ssh:display fan', 'ssh:display power']);
    if (read('display fan').status === 'ok' && read('display power').status === 'ok' && snapshot.environment.data.fans.length && snapshot.environment.data.power_supplies?.length)
        snapshot.environment.status = 'ok';
    snapshot.environment.warnings.push(...read('display fan').warnings, ...read('display power').warnings);
    snapshot.network = input.snmp ? section(parseIpNetwork(walk('ip').data, walk('arp').data), walk('ip').status === 'ok' && walk('arp').status === 'ok' ? 'ok' : 'partial', ['snmp:ipAddrTable', 'snmp:ipNetToMediaTable'], [...walk('ip').warnings, ...walk('arp').warnings]) : section({ ipv4_addresses: [], arp: [] }, 'skipped');
    for (const [command, part, expected] of [['display vlan all', snapshot.vlans, (read('display vlan all').data.match(/VLAN ID:/g) || []).length], ['display mac-address', snapshot.forwarding, (read('display mac-address').data.match(/^\s*(?:[a-f\d]{4}-){2}[a-f\d]{4}\b/gmi) || []).length], ['display lldp neighbor-information verbose', snapshot.neighbors, (read('display lldp neighbor-information verbose').data.match(/LLDP neighbor index\s*:/gi) || []).length]] as const) {
        if (part.status === 'ok' && part.data.length !== expected) {
            part.status = 'partial';
            part.warnings.push('ROWS_UNRECOGNIZED:' + command);
        }
    }
    if (snapshot.modules.status === 'ok') {
        const slots = new Set(snapshot.modules.data.map(m => m.slot));
        for (const port of snapshot.interfaces.data)
            if (port.slot)
                port.module_observed = slots.has(port.slot);
        if (resources.instances?.length !== slots.size) {
            snapshot.resources.status = 'partial';
            snapshot.resources.warnings.push('IRF_RESOURCE_MEMBERS_INCOMPLETE');
        }
    }
    if (!input.ssh) { for (const part of [snapshot.resources, snapshot.environment, snapshot.poe, snapshot.spanning_tree]) part.sources = []; }
    if (snapshot.modules.data.length > 1)
        snapshot.identity.warnings.push('IRF_LOGICAL_IDENTITY_NO_SINGLE_CHASSIS_SERIAL');
    for (const lag of snapshot.aggregation.data)
        if (!lag.members.length) {
            snapshot.aggregation.status = 'partial';
            snapshot.aggregation.warnings.push('LAG_WITHOUT_OBSERVED_LOCAL_MEMBERS');
            break;
        }
    if (/\bto\b/.test(read('display vlan all').data)) {
        snapshot.vlans.status = 'partial';
        snapshot.vlans.warnings.push('VLAN_RANGE_FORMAT_NOT_IMPLEMENTED');
    }
    const sections = [snapshot.identity, snapshot.interfaces, snapshot.vlans, snapshot.forwarding, snapshot.neighbors, snapshot.spanning_tree, snapshot.aggregation, snapshot.poe, snapshot.sensors, snapshot.modules, snapshot.hardware, snapshot.resources, snapshot.environment, snapshot.network].filter(s => s.status !== 'skipped');
    snapshot.status = sections.every(s => s.status === 'ok') ? 'ok' : sections.some(s => s.status === 'ok' || s.status === 'partial') ? 'partial' : 'error';
    return finish();
}
