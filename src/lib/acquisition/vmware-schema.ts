import { z } from 'zod';
const s = z.string().nullable(), n = z.number().finite().nullable(), b = z.boolean().nullable(), bytes = z.string().regex(/^\d+$/).nullable();
const reference = z.object({ type: s, id: s });
const ip = z.object({ address: s, prefix_length: n, state: s, origin: s });
const vmNic = z.object({ key: n, label: s, mac: s, connected: b, network_name: s, network_ref: s, distributed_switch_uuid: s, distributed_portgroup_key: s, distributed_port_key: s, guest_addresses: z.array(ip) });
const disk = z.object({ key: n, label: s, capacity_bytes: bytes, controller_key: n, unit_number: n, datastore_ref: s, backing_type: s, file_name: s, thin_provisioned: b });
export const virtualizationSchema = z.object({
    scope: z.literal('host'), api_version: s, api_type: s, host_ref: s, managed_by_vcenter: b, vcenter_address: s,
    hardware: z.object({ uuid: s, manufacturer: s, model: s, serial_number: s, bios_version: s, bios_release_date: s, cpu_model: s, cpu_packages: n, cpu_cores: n, cpu_threads: n, cpu_mhz: n, memory_bytes: bytes, pci_devices: z.array(z.object({ id: s, vendor_name: s, device_name: s, vendor_id: n, device_id: n })) }),
    runtime: z.object({ connection_state: s, power_state: s, maintenance_mode: b, boot_time: s, overall_status: s, cpu_usage_mhz: n, memory_usage_mib: n, uptime_seconds: n }),
    vswitches: z.array(z.object({ key: s, name: s, mtu: n, ports: n, physical_nics: z.array(z.string()), physical_nic_refs: z.array(z.string()), portgroup_keys: z.array(z.string()) })),
    portgroups: z.array(z.object({ key: s, name: s, vswitch_name: s, vlan_id: n, vlan_mode: z.enum(['untagged', 'access', 'trunk', 'unknown']), active_nics: z.array(z.string()), standby_nics: z.array(z.string()) })),
    proxy_switches: z.array(z.object({ key: s, dvs_uuid: s, dvs_name: s, mtu: n, physical_nics: z.array(z.string()), uplinks: z.array(z.object({ key: s, name: s })), configuration_scope: z.literal('host_only') })),
    vmkernel: z.array(z.object({ device: s, portgroup: s, mac: s, mtu: n, dhcp: b, ipv4_address: s, ipv4_netmask: s, ipv6_addresses: z.array(ip), distributed_switch_uuid: s, distributed_portgroup_key: s })),
    dns: z.object({ hostname: s, domain: s, servers: z.array(z.string()), search_domains: z.array(z.string()) }),
    routes: z.array(z.object({ network: s, prefix_length: n, netmask: s, gateway: s, device: s, stack: s })),
    storage_devices: z.array(z.object({ key: s, uuid: s, canonical_name: s, display_name: s, type: s, vendor: s, model: s, revision: s, capacity_bytes: bytes, operational_state: z.array(z.string()), is_ssd: b })),
    storage_paths: z.array(z.object({ lun_key: s, lun_id: s, policy: s, name: s, adapter: s, state: s, is_working: b, transport_type: s })),
    datastores: z.array(z.object({ ref: s, name: s, type: s, url: s, accessible: b, multiple_host_access: b, capacity_bytes: bytes, free_bytes: bytes, uncommitted_bytes: bytes, maintenance_mode: s, vmfs_uuid: s, vmfs_version: s, extents: z.array(z.object({ disk_name: s, partition: n })), nas: z.object({ remote_host: s, remote_path: s, access_mode: s }).nullable(), warnings: z.array(z.string()) })),
    virtual_machines: z.array(z.object({ ref: s, name: s, uuid: s, instance_uuid: s, guest_id: s, guest_full_name: s, guest_hostname: s, power_state: s, connection_state: s, tools_status: s, tools_running_status: s, cpu_count: n, memory_mib: n, template: b, host_ref: s, datastore_refs: z.array(z.string()), networks: z.array(reference), nics: z.array(vmNic), disks: z.array(disk), guest_networks: z.array(z.object({ device_key: n, mac: s, connected: b, network_name: s, addresses: z.array(ip) })), snapshots: z.array(z.object({ ref: s, parent_ref: s, name: s, created_at: s, state: s })), warnings: z.array(z.string()) })),
    health_sensors: z.array(z.object({ name: s, type: s, current_reading: s, unit: s, unit_modifier: n, health_state: s }))
});
export type VirtualizationData = z.infer<typeof virtualizationSchema>;
