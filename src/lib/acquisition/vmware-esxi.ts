import { acquisitionInputSchema, snapshotSchema } from './schema';
import { versioneCollector } from './catalogo';
import type { AcquisitionRequest, AcquisitionSnapshot, DeviceInterface, Sensor } from './schema';
import { acquireVsphere, object, array, text } from './vsphere-transport';
import type { VsphereInventory } from './vsphere-transport';
import { parseVmwareInventory, numberValue, boolValue } from './vmware-parsers';
import { emptyInterface } from './parsers';
import { redactSnapshot } from './redact';
type Section<T> = {
    data: T;
    status: 'ok' | 'partial' | 'error' | 'skipped' | 'unsupported';
    collected_at: string;
    sources: string[];
    warnings: string[];
};
const part = <T>(data: T, status: Section<T>['status'] = 'skipped', sources: string[] = [], warnings: string[] = []): Section<T> => ({ data, status, collected_at: new Date().toISOString(), sources, warnings });
export async function collectVmwareEsxi(request: AcquisitionRequest, acquire: typeof acquireVsphere = acquireVsphere): Promise<AcquisitionSnapshot> {
    const input = acquisitionInputSchema.parse(request);
    if (input.collector !== 'vmware-esxi')
        throw Error('COLLECTOR_MISMATCH');
    const start = Date.now();
    const snapshot: AcquisitionSnapshot = { schema_version: '1.0', collector: 'vmware-esxi', collector_version: versioneCollector('vmware-esxi'), target: input.host, collected_at: new Date(start).toISOString(), duration_ms: 0, status: 'error', identity: part(null, 'error'), interfaces: part([]), vlans: part([]), forwarding: part([], 'skipped', [], ['NOT_COLLECTED_BY_HOST_API']), neighbors: part([], 'skipped', [], ['LLDP_CDP_NOT_COLLECTED']), spanning_tree: part({ enabled: null, protocol: null, ports: [] }, 'skipped', [], ['NOT_COLLECTED_BY_HOST_API']), aggregation: part([], 'skipped', [], ['TEAMING_IS_IN_VIRTUALIZATION_NOT_LACP_INVENTORY']), poe: part([], 'unsupported', [], ['NOT_APPLICABLE']), sensors: part([]), network: part({ ipv4_addresses: [], arp: [] }) };
    const finish = () => { snapshot.duration_ms = Date.now() - start; return snapshotSchema.parse(redactSnapshot(snapshot, input)); };
    let raw: VsphereInventory;
    try {
        raw = await acquire(input);
    }
    catch (e) {
        snapshot.identity.warnings.push(e instanceof Error && /^API_[A-Z_]+$/.test(e.message) ? e.message : 'API_COLLECTION_FAILED');
        return finish();
    }
    const v = parseVmwareInventory(raw), sources = ['api:HostSystem', 'api:VirtualMachine', 'api:Datastore'];
    const warnings = [...raw.warnings, ...raw.host.missing.map(k => 'PROPERTY_UNAVAILABLE:' + k)];
    for (const r of [...raw.vms, ...raw.datastores])
        if (r.missing.length)
            warnings.push('OBJECT_PROPERTIES_UNAVAILABLE:' + r.type);
    if (v.vswitches.some(s => s.physical_nic_refs.length !== s.physical_nics.length))
        warnings.push('PNIC_REFERENCES_UNRESOLVED');
    if (v.proxy_switches.length)
        warnings.push('DISTRIBUTED_SWITCH_HOST_CONFIGURATION_ONLY');
    snapshot.virtualization = part(v, warnings.length ? 'partial' : 'ok', sources, warnings);
    snapshot.identity = part({ manufacturer: v.hardware.manufacturer, model: v.hardware.model, firmware: [text(raw.about.fullName), text(raw.about.build)].filter(Boolean).join(' / ') || null, serial_number: v.hardware.serial_number, hostname: text(raw.host.props.name), mac: null, sys_object_id: null, uptime_seconds: v.runtime.uptime_seconds }, 'ok', ['api:HostSystem.hardware', 'api:HostSystem.name', 'api:ServiceContent.about']);
    const net = object(raw.host.props['config.network']), ports: DeviceInterface[] = [];
    for (const x of array(net.pnic)) {
        const r = object(x), p = emptyInterface(text(r.device) ?? text(r.key) ?? 'unknown'), speed = object(r.linkSpeed);
        p.kind = 'physical';
        p.mac = text(r.mac);
        p.mtu = null;
        p.admin_status = null;
        p.oper_status = numberValue(speed.speedMb) !== null ? 'up' : r.linkSpeed === undefined ? 'down' : null;
        p.reported_speed_bps = numberValue(speed.speedMb) === null ? null : numberValue(speed.speedMb)! * 1e6;
        p.speed_bps = p.oper_status === 'up' ? p.reported_speed_bps : null;
        p.duplex = boolValue(speed.duplex) === true ? 'full' : boolValue(speed.duplex) === false ? 'half' : null;
        p.description = text(r.driver);
        ports.push(p);
    }
    for (const k of v.vmkernel) {
        const p = emptyInterface(k.device ?? 'unknown');
        p.mac = k.mac;
        p.mtu = k.mtu;
        p.description = k.portgroup;
        ports.push(p);
    }
    snapshot.interfaces = part(ports, raw.host.missing.includes('config.network') ? 'error' : ports.length ? 'ok' : 'partial', ['api:HostSystem.config.network'], ['API_NO_IFINDEX_OR_PACKET_COUNTERS']);
    const ids = [...new Set(v.portgroups.filter(p => p.vlan_mode === 'access').map(p => p.vlan_id!))];
    snapshot.vlans = part(ids.map(id => ({ id, name: v.portgroups.filter(p => p.vlan_id === id).map(p => p.name).filter(Boolean).join(', ') || null, tagged_ports: [], untagged_ports: [], forbidden_ports: [] })), 'partial', ['api:HostSystem.config.network.portgroup'], ['PORTGROUP_VLAN_POLICY_NOT_PHYSICAL_PORT_MEMBERSHIP', ...(v.proxy_switches.length ? ['DISTRIBUTED_PORTGROUP_VLANS_REQUIRE_VCENTER'] : [])]);
    snapshot.network = part({ ipv4_addresses: v.vmkernel.filter(k => !!k.ipv4_address).map(k => ({ address: k.ipv4_address!, netmask: k.ipv4_netmask, if_index: null })), arp: [] }, 'partial', ['api:HostSystem.config.network.vnic'], ['ARP_NOT_COLLECTED']);
    const numeric: Sensor[] = [];
    for (const s of v.health_sensors) {
        const reading = numberValue(s.current_reading), modifier = s.unit_modifier;
        if (reading === null || modifier === null)
            continue;
        const value = reading * Math.pow(10, modifier);
        if (!Number.isFinite(value))
            continue;
        if (s.unit === 'degrees C')
            numeric.push({ name: s.name ?? 'unknown', kind: 'temperature', unit: 'celsius', value, note: s.health_state });
        else if (s.unit === 'RPM')
            numeric.push({ name: s.name ?? 'unknown', kind: 'fan', unit: 'rpm', value, note: s.health_state });
    }
    snapshot.sensors = part(numeric, v.health_sensors.length ? 'ok' : 'partial', ['api:HostSystem.runtime.healthSystemRuntime'], v.health_sensors.length ? ['OTHER_SENSOR_TYPES_RETAINED_IN_VIRTUALIZATION'] : ['HEALTH_SENSORS_NOT_AVAILABLE']);
    snapshot.status = 'partial';
    return finish();
}
