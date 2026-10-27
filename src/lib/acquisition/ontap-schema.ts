import { z } from 'zod';
const s = z.string().nullable(), n = z.number().finite().nullable(), b = z.boolean().nullable(), bytes = z.string().regex(/^\d+$/).nullable();
const ref = z.object({ uuid: s, name: s });
const status = z.enum(['ok', 'partial', 'error', 'unsupported', 'skipped']);
function collection<T extends z.ZodType>(data: T) { return z.object({ status, data: z.array(data), sources: z.array(z.string()), warnings: z.array(z.string()), collected_at: z.string().datetime() }); }
export const ontapStorageSchema = z.object({
    scope: z.literal('cluster'), cluster_uuid: s, cluster_name: s, ontap_version: s,
    nodes: collection(z.object({ uuid: s, name: s, model: s, serial_number: s, system_id: s, state: s, uptime_seconds: n, version: s, ha_partner: ref, ha_enabled: b, takeover_state: s })),
    metrocluster: collection(z.object({ configuration_type: s, local_cluster: ref, remote_cluster: ref, local_mode: s, remote_mode: s, local_configuration_state: s, remote_configuration_state: s })),
    metro_nodes: collection(z.object({ dr_group_id: n, cluster: ref, node: ref, ha_partner: ref, dr_partner: ref, dr_partner_cluster: ref, dr_auxiliary_partner: ref, dr_mirroring_state: s, configuration_state: s, dr_operation_state: s, is_mccip: b, encryption_enabled: b })),
    metro_connections: collection(z.object({ node: ref, partner_type: s, adapter: s, state: s, type: s, mirror_enabled: b, mirror_state: s })),
    aggregates: collection(z.object({ uuid: s, name: s, node: ref, state: s, size_bytes: bytes, used_bytes: bytes, available_bytes: bytes, mirror_state: s, raid_type: s, disk_count: n })),
    volumes: collection(z.object({ uuid: s, name: s, svm: ref, state: s, type: s, style: s, aggregates: z.array(ref), junction_path: s, export_policy_name: s, export_policy_id: s, size_bytes: bytes, used_bytes: bytes, available_bytes: bytes, logical_used_bytes: bytes })),
    luns: collection(z.object({ uuid: s, name: s, svm: ref, volume: ref, enabled: b, os_type: s, serial_number: s, state: s, mapped: b, size_bytes: bytes, used_bytes: bytes })),
    lun_maps: collection(z.object({ svm: ref, lun: ref, igroup: ref, lun_id: n, reporting_nodes: z.array(ref) })),
    svms: collection(z.object({ uuid: s, name: s, state: s, subtype: s, ipspace: ref })),
    disks: collection(z.object({ uid: s, name: s, serial_number: s, model: s, vendor: s, firmware_version: s, type: s, container_type: s, state: s, home_node: ref, shelf: s, bay: s, physical_size_bytes: bytes, usable_size_bytes: bytes, local: b })),
    shelves: collection(z.object({ uid: s, name: s, id: s, model: s, serial_number: s, state: s, disk_count: n, local: b, frus: z.array(z.object({ id: s, type: s, state: s, model: s, serial_number: s, part_number: s, firmware_version: s, installed: b })) })),
    ethernet: collection(z.object({ uuid: s, name: s, node: ref, type: s, mac: s, enabled: b, state: s, mtu: n, speed_mbps: n, broadcast_domain: ref, vlan_tag: n, vlan_base_port: s, lag_members: z.array(z.string()) })),
    ip_interfaces: collection(z.object({ uuid: s, name: s, address: s, netmask: s, family: s, enabled: b, state: s, scope: s, svm: ref, ipspace: ref, home_node: ref, current_node: ref, home_port: ref, current_port: ref, is_home: b, services: z.array(z.string()) })),
    fc_ports: collection(z.object({ uuid: s, name: s, node: ref, wwnn: s, wwpn: s, state: s, enabled: b, speed_gbps: n })),
    snapmirror: collection(z.object({ uuid: s, source_path: s, destination_path: s, state: s, healthy: b, lag_time: s }))
});
export type OntapStorage = z.infer<typeof ontapStorageSchema>;
