import type { VirtualizationData } from './vmware-schema';
import type { VsphereInventory, PropertyObject } from './vsphere-transport';
import { object as o, array as a, text as t } from './vsphere-transport';
export const numberValue = (v: unknown): number | null => {
    const s = t(v);
    if (s === null || !s.trim())
        return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
};
export const boolValue = (v: unknown): boolean | null => t(v) === 'true' ? true : t(v) === 'false' ? false : null;
export function byteValue(v: unknown, multiplier = BigInt(1)): string | null { const s = t(v); return s !== null && /^\d+$/.test(s) ? (BigInt(s) * multiplier).toString() : null; }
const strings = (v: unknown) => a(v).map(t).filter((s): s is string => s !== null);
const ref = (v: unknown) => ({ id: t(v), type: t(o(v)['@_type']) });
function ipAddresses(v: unknown) { return a(o(v).ipAddress).map(x => { const r = o(x); return { address: t(r.ipAddress), prefix_length: numberValue(r.prefixLength), state: t(r.state), origin: t(r.origin) }; }); }
function missing(r: PropertyObject) { return r.missing.map(path => 'PROPERTY_UNAVAILABLE:' + path); }
export function parseVmwareInventory(input: VsphereInventory): VirtualizationData {
    const h = input.host.props, summary = o(h.summary), hw = o(h.hardware), system = o(hw.systemInfo), cpu = o(hw.cpuInfo), bios = o(hw.biosInfo), runtime = o(h.runtime), quick = o(summary.quickStats), net = o(h['config.network']);
    const identifying = a(system.otherIdentifyingInfo).map(o), serial = identifying.find(v => t(o(v.identifierType).key) === 'ServiceTag' || t(o(v.identifierType).key) === 'SerialNumberTag');
    const vcenter = t(summary.managementServerIp);
    const pnicNames = new Map(a(net.pnic).map(v => [t(o(v).key), t(o(v).device)]));
    const switches = a(net.vswitch).map(x => { const r = o(x); return { key: t(r.key), name: t(r.name), mtu: numberValue(r.mtu), ports: numberValue(r.numPorts), physical_nics: strings(r.pnic).flatMap(key => pnicNames.get(key) ? [pnicNames.get(key)!] : []), physical_nic_refs: strings(r.pnic), portgroup_keys: strings(r.portgroup) }; });
    const portgroups = a(net.portgroup).map(x => { const r = o(x), spec = o(r.spec), team = o(o(r.computedPolicy).nicTeaming), order = o(team.nicOrder), vlan = numberValue(spec.vlanId); return { key: t(r.key), name: t(spec.name), vswitch_name: t(spec.vswitchName), vlan_id: vlan, vlan_mode: vlan === 4095 ? 'trunk' as const : vlan === 0 ? 'untagged' as const : vlan !== null && vlan >= 1 && vlan <= 4094 ? 'access' as const : 'unknown' as const, active_nics: strings(order.activeNic), standby_nics: strings(order.standbyNic) }; });
    const proxy = a(net.proxySwitch).map(x => { const r = o(x); return { key: t(r.key), dvs_uuid: t(r.dvsUuid), dvs_name: t(r.dvsName), mtu: numberValue(r.mtu), physical_nics: a(o(o(r.spec).backing).pnicSpec).map(p => t(o(p).pnicDevice)).filter((v): v is string => !!v), uplinks: a(r.uplinkPort).map(p => ({ key: t(o(p).key), name: t(o(p).value) })), configuration_scope: 'host_only' as const }; });
    const kernel = a(net.vnic).map(x => { const r = o(x), spec = o(r.spec), ip = o(spec.ip), dv = o(spec.distributedVirtualPort); return { device: t(r.device), portgroup: t(r.portgroup), mac: t(spec.mac), mtu: numberValue(spec.mtu), dhcp: boolValue(ip.dhcp), ipv4_address: t(ip.ipAddress), ipv4_netmask: t(ip.subnetMask), ipv6_addresses: ipAddresses(ip.ipV6Config), distributed_switch_uuid: t(dv.switchUuid), distributed_portgroup_key: t(dv.portgroupKey) }; });
    const dns = o(net.dnsConfig), routes: VirtualizationData['routes'] = [];
    const route = o(net.ipRouteConfig);
    if (t(route.defaultGateway))
        routes.push({ network: '0.0.0.0', prefix_length: 0, netmask: '0.0.0.0', gateway: t(route.defaultGateway), device: t(route.gatewayDevice), stack: 'defaultTcpipStack' });
    for (const r of [...a(o(net.routeTableInfo).ipRoute), ...a(o(net.routeTableInfo).ipv6Route)]) {
        const v = o(r);
        routes.push({ network: t(v.network), prefix_length: numberValue(v.prefixLength), netmask: t(v.netmask), gateway: t(v.gateway), device: t(v.deviceName), stack: 'defaultTcpipStack' });
    }
    const luns = a(o(h['config.storageDevice.scsiLun']).ScsiLun).map(x => { const r = o(x), cap = o(r.capacity), blocks = byteValue(cap.block), size = byteValue(cap.blockSize); return { key: t(r.key), uuid: t(r.uuid), canonical_name: t(r.canonicalName), display_name: t(r.displayName), type: t(r.deviceType), vendor: t(r.vendor), model: t(r.model), revision: t(r.revision), capacity_bytes: blocks && size ? (BigInt(blocks) * BigInt(size)).toString() : null, operational_state: strings(r.operationalState), is_ssd: boolValue(r.ssd) }; });
    const paths: VirtualizationData['storage_paths'] = a(h['config.storageDevice.multipathInfo'] ? o(h['config.storageDevice.multipathInfo']).lun : undefined).flatMap(x => { const lun = o(x); return a(lun.path).map(p => { const v = o(p); return { lun_key: t(lun.key), lun_id: t(lun.id), policy: t(o(lun.policy).policy), name: t(v.name), adapter: t(v.adapter), state: t(v.pathState), is_working: boolValue(v.isWorkingPath), transport_type: t(o(v.transport)['@_xsi:type']) }; }); });
    const datastores = input.datastores.map(row => { const r = row.props, s = o(r.summary), info = o(r.info), vmfs = o(info.vmfs), nas = o(info.nas); return { ref: row.ref, name: t(r.name) ?? t(s.name), type: t(s.type), url: t(s.url), accessible: boolValue(s.accessible), multiple_host_access: boolValue(s.multipleHostAccess), capacity_bytes: byteValue(s.capacity), free_bytes: byteValue(s.freeSpace), uncommitted_bytes: byteValue(s.uncommitted), maintenance_mode: t(s.maintenanceMode), vmfs_uuid: t(vmfs.uuid), vmfs_version: t(vmfs.version), extents: a(vmfs.extent).map(e => ({ disk_name: t(o(e).diskName), partition: numberValue(o(e).partition) })), nas: Object.keys(nas).length ? { remote_host: t(nas.remoteHost), remote_path: t(nas.remotePath), access_mode: t(nas.accessMode) } : null, warnings: missing(row) }; });
    const vms = input.vms.map(row => {
        const r = row.props, s = o(r.summary), config = o(s.config), run = o(r.runtime), guestNetworks = a(o(r['guest.net']).GuestNicInfo).map(x => {
            const v = o(x), ipconfig = o(v.ipConfig);
            const ips = ipAddresses(ipconfig);
            if (!ips.length)
                ips.push(...strings(v.ipAddress).map(address => ({ address, prefix_length: null, state: null, origin: null })));
            return { device_key: numberValue(v.deviceConfigId), mac: t(v.macAddress), connected: boolValue(v.connected), network_name: t(v.network), addresses: ips };
        });
        const devices = a(o(r['config.hardware.device']).VirtualDevice), nics: VirtualizationData['virtual_machines'][number]['nics'] = [], disks: VirtualizationData['virtual_machines'][number]['disks'] = [];
        for (const x of devices) {
            const v = o(x), type = t(v['@_xsi:type']) ?? '', back = o(v.backing), dv = o(back.port), key = numberValue(v.key), label = t(o(v.deviceInfo).label);
            if (/Virtual.*(?:Ethernet|Vmxnet|E1000|PCNet|Sriov)/i.test(type) || v.macAddress !== undefined) {
                const guest = guestNetworks.find(g => g.device_key === key);
                nics.push({ key, label, mac: t(v.macAddress), connected: boolValue(o(v.connectable).connected), network_name: t(back.deviceName), network_ref: t(back.network), distributed_switch_uuid: t(dv.switchUuid), distributed_portgroup_key: t(dv.portgroupKey), distributed_port_key: t(dv.portKey), guest_addresses: guest?.addresses ?? [] });
            }
            else if (/VirtualDisk$/.test(type)) {
                disks.push({ key, label, capacity_bytes: byteValue(v.capacityInBytes) ?? byteValue(v.capacityInKB, BigInt(1024)), controller_key: numberValue(v.controllerKey), unit_number: numberValue(v.unitNumber), datastore_ref: t(back.datastore), backing_type: t(back['@_xsi:type']), file_name: t(back.fileName), thin_provisioned: boolValue(back.thinProvisioned) });
            }
        }
        const rowWarnings = missing(row);
        if (guestNetworks.length)
            rowWarnings.push('GUEST_NETWORK_FROM_TOOLS_NOT_LIVE_SCAN');
        if (t(r['guest.toolsRunningStatus']) !== 'guestToolsRunning')
            rowWarnings.push('GUEST_NETWORK_MAY_BE_STALE_OR_UNAVAILABLE');
        const snapshots: VirtualizationData['virtual_machines'][number]['snapshots'] = [];
        function visit(nodes: unknown, parent: string | null, depth = 0) {
            if (depth > 64) {
                rowWarnings.push('SNAPSHOT_DEPTH_LIMIT');
                return;
            }
            for (const x of a(nodes)) {
                const v = o(x), id = t(v.snapshot);
                snapshots.push({ ref: id, parent_ref: parent, name: t(v.name), created_at: t(v.createTime), state: t(v.state) });
                visit(v.childSnapshotList, id, depth + 1);
            }
        }
        visit(o(r['snapshot.rootSnapshotList']).VirtualMachineSnapshotTree, null);
        return { ref: row.ref, name: t(r.name) ?? t(config.name), uuid: t(r['config.uuid']) ?? t(config.uuid), instance_uuid: t(r['config.instanceUuid']) ?? t(config.instanceUuid), guest_id: t(config.guestId), guest_full_name: t(o(s.guest).guestFullName), guest_hostname: t(r['guest.hostName']), power_state: t(run.powerState), connection_state: t(run.connectionState), tools_status: t(r['guest.toolsStatus']), tools_running_status: t(r['guest.toolsRunningStatus']), cpu_count: numberValue(r['config.hardware.numCPU']), memory_mib: numberValue(r['config.hardware.memoryMB']), template: boolValue(r['config.template']), host_ref: t(run.host), datastore_refs: a(o(r.datastore).ManagedObjectReference).map(t).filter((v): v is string => !!v), networks: a(o(r.network).ManagedObjectReference).map(ref), nics, disks, guest_networks: guestNetworks, snapshots, warnings: rowWarnings };
    });
    const health = o(o(runtime.healthSystemRuntime).systemHealthInfo), sensors = a(health.numericSensorInfo).map(x => { const r = o(x); return { name: t(r.name), type: t(r.sensorType), current_reading: t(r.currentReading), unit: t(r.baseUnits), unit_modifier: numberValue(r.unitModifier), health_state: t(o(r.healthState).key) }; });
    return { scope: 'host', api_version: t(input.about.apiVersion), api_type: t(input.about.apiType), host_ref: input.host.ref, managed_by_vcenter: vcenter === null ? null : !['', '0.0.0.0', '::'].includes(vcenter), vcenter_address: vcenter, hardware: { uuid: t(system.uuid), manufacturer: t(system.vendor), model: t(system.model), serial_number: serial ? t(serial.identifierValue) : null, bios_version: t(bios.biosVersion), bios_release_date: t(bios.releaseDate), cpu_model: t(o(a(hw.cpuPkg)[0]).description), cpu_packages: numberValue(cpu.numCpuPackages), cpu_cores: numberValue(cpu.numCpuCores), cpu_threads: numberValue(cpu.numCpuThreads), cpu_mhz: numberValue(o(summary.hardware).cpuMhz), memory_bytes: byteValue(hw.memorySize), pci_devices: a(hw.pciDevice).map(x => { const r = o(x); return { id: t(r.id), vendor_name: t(r.vendorName), device_name: t(r.deviceName), vendor_id: numberValue(r.vendorId), device_id: numberValue(r.deviceId) }; }) }, runtime: { connection_state: t(runtime.connectionState), power_state: t(runtime.powerState), maintenance_mode: boolValue(runtime.inMaintenanceMode), boot_time: t(runtime.bootTime), overall_status: t(summary.overallStatus), cpu_usage_mhz: numberValue(quick.overallCpuUsage), memory_usage_mib: numberValue(quick.overallMemoryUsage), uptime_seconds: numberValue(quick.uptime) }, vswitches: switches, portgroups, proxy_switches: proxy, vmkernel: kernel, dns: { hostname: t(dns.hostName), domain: t(dns.domainName), servers: strings(dns.address), search_domains: strings(dns.searchDomain) }, routes, storage_devices: luns, storage_paths: paths, datastores, virtual_machines: vms, health_sensors: sensors };
}
