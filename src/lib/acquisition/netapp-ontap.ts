import { acquisitionInputSchema, snapshotSchema } from './schema';
import type { AcquisitionRequest, AcquisitionSnapshot, DeviceInterface } from './schema';
import { acquireOntap } from './ontap-transport';
import { parseOntapInventory } from './ontap-parsers';
import { emptyInterface } from './parsers';
import { redactSnapshot } from './redact';
const section = <T>(data: T, status: 'ok' | 'partial' | 'error' | 'skipped' | 'unsupported' = 'skipped', sources: string[] = [], warnings: string[] = []) => ({ data, status, collected_at: new Date().toISOString(), sources, warnings });
export async function collectNetappOntap(request: AcquisitionRequest, acquire: typeof acquireOntap = acquireOntap): Promise<AcquisitionSnapshot> {
    const input = acquisitionInputSchema.parse(request);
    if (input.collector !== 'netapp-ontap')
        throw Error('COLLECTOR_MISMATCH');
    const start = Date.now();
    const s: AcquisitionSnapshot = { schema_version: '1.0', collector: 'netapp-ontap', collector_version: '1.0.0', target: input.host, collected_at: new Date(start).toISOString(), duration_ms: 0, status: 'error', identity: section(null, 'error'), interfaces: section([]), vlans: section([]), forwarding: section([], 'skipped', [], ['NOT_COLLECTED_BY_STORAGE_API']), neighbors: section([], 'skipped', [], ['NOT_COLLECTED_BY_STORAGE_API']), spanning_tree: section({ enabled: null, protocol: null, ports: [] }, 'unsupported', [], ['NOT_APPLICABLE']), aggregation: section([], 'skipped', [], ['STORAGE_LAG_MEMBERSHIP_IN_STORAGE_SECTION']), poe: section([], 'unsupported', [], ['NOT_APPLICABLE']), sensors: section([], 'skipped', [], ['NUMERIC_SENSORS_NOT_COLLECTED']), network: section({ ipv4_addresses: [], arp: [] }) };
    const finish = () => { s.duration_ms = Date.now() - start; return snapshotSchema.parse(redactSnapshot(s, input)); };
    let raw;
    try {
        raw = await acquire(input);
    }
    catch {
        s.identity.warnings.push('REST_COLLECTION_FAILED');
        return finish();
    }
    if (raw.cluster.status !== 'ok') {
        s.identity.warnings.push(...raw.cluster.warnings);
        return finish();
    }
    const data = parseOntapInventory(raw);
    const parts = [data.nodes, data.metrocluster, data.metro_nodes, data.metro_connections, data.aggregates, data.volumes, data.luns, data.lun_maps, data.svms, data.disks, data.shelves, data.ethernet, data.ip_interfaces, data.fc_ports, data.snapmirror];
    s.storage = section(data, parts.every(p => p.status === 'ok') ? 'ok' : 'partial', ['api:ONTAP_REST'], parts.flatMap(p => p.warnings));
    s.identity = section({ manufacturer: 'NetApp', model: null, serial_number: null, hostname: data.cluster_name, firmware: data.ontap_version, mac: null, sys_object_id: null, uptime_seconds: null }, 'ok', ['api:/api/cluster'], ['CLUSTER_IS_NOT_A_SINGLE_CHASSIS']);
    const ports: DeviceInterface[] = data.ethernet.data.map(r => { const p = emptyInterface((r.node.uuid ?? r.node.name ?? 'unknown') + '/' + (r.name ?? r.uuid ?? 'unknown')); p.kind = r.type === 'physical' ? 'physical' : r.type === 'lag' ? 'aggregate' : 'other'; p.mac = r.mac; p.mtu = r.mtu; p.admin_status = r.enabled === null ? null : r.enabled ? 'up' : 'down'; p.oper_status = r.state === 'up' ? 'up' : r.state === 'down' ? 'down' : r.state; p.reported_speed_bps = r.speed_mbps === null ? null : r.speed_mbps * 1e6; p.speed_bps = p.oper_status === 'up' ? p.reported_speed_bps : null; return p; });
    s.interfaces = section(ports, data.ethernet.status, ['api:/api/network/ethernet/ports'], data.ethernet.warnings);
    const vids = [...new Set(data.ethernet.data.map(p => p.vlan_tag).filter((v): v is number => v !== null && v >= 1 && v <= 4094))];
    s.vlans = section(vids.map(id => ({ id, name: null, tagged_ports: [], untagged_ports: [], forbidden_ports: [] })), data.ethernet.status === 'ok' ? 'partial' : data.ethernet.status, ['api:/api/network/ethernet/ports'], ['ONTAP_VLAN_SUBINTERFACES_NOT_SWITCH_PORT_MEMBERSHIP']);
    s.network = section({ ipv4_addresses: data.ip_interfaces.data.filter(i => i.address && i.family === 'ipv4').map(i => ({ address: i.address!, netmask: i.netmask, if_index: null })), arp: [] }, data.ip_interfaces.status === 'ok' ? 'partial' : data.ip_interfaces.status, ['api:/api/network/ip/interfaces'], [...data.ip_interfaces.warnings, 'ARP_NOT_COLLECTED']);
    s.status = 'partial';
    return finish();
}
