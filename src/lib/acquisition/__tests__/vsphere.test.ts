import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSoap, parsePropertyObjects, escapeXml, object, array, text } from '../vsphere-transport';
const envelope = (body: string) => `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><soap:Body>${body}</soap:Body></soap:Envelope>`;
test('vSphere: attributo type MoRef distinto da xsi:type e logout vuoto valido', () => { const x = parseSoap(envelope('<RetrievePropertiesExResponse><returnval><objects><obj type="HostSystem">ha-host</obj><propSet><name>vm</name><val xsi:type="ArrayOfManagedObjectReference"><ManagedObjectReference type="VirtualMachine" xsi:type="ManagedObjectReference">vm-17</ManagedObjectReference></val></propSet></objects></returnval></RetrievePropertiesExResponse>'), 'RetrievePropertiesEx'); const rows = parsePropertyObjects(object(x.returnval)); const ref = array(object(rows[0].props.vm).ManagedObjectReference)[0]; assert.equal(object(ref)['@_type'], 'VirtualMachine'); assert.equal(text(ref), 'vm-17'); assert.deepEqual(parseSoap(envelope('<LogoutResponse/>'), 'Logout'), {}); });
test('vSphere: fault/DTD/XML malformato non diventano risposta vuota', () => {
    for (const xml of [envelope('<soap:Fault><faultstring>secret</faultstring></soap:Fault>'), '<!DOCTYPE x [<!ENTITY x "secret">]><x/>', '<broken>'])
        assert.throws(() => parseSoap(xml, 'Login'), /^Error: API_/);
});
test('vSphere: escaping credenziali XML e proprietà assenti conservate', () => { assert.equal(escapeXml('a<&"\''), 'a&lt;&amp;&quot;&apos;'); const r = parsePropertyObjects({ objects: { obj: { '#text': 'vm-1', '@_type': 'VirtualMachine' }, missingSet: { path: 'guest.net', fault: { localizedMessage: 'private' } } } }); assert.deepEqual(r[0].missing, ['guest.net']); assert.deepEqual(r[0].props, {}); });
import { parseVmwareInventory, byteValue, boolValue, numberValue } from '../vmware-parsers';
import { collectVmwareEsxi } from '../vmware-esxi';
import { acquisitionInputSchema, snapshotSchema } from '../schema';
import type { VsphereInventory, PropertyObject } from '../vsphere-transport';
const moref = (id: string, type: string) => ({ '#text': id, '@_type': type });
const prop = (ref: string, type: string, props: Record<string, unknown>): PropertyObject => ({ ref, type, props, missing: [] });
function fixture(): VsphereInventory { return { about: { apiType: 'HostAgent', apiVersion: '8.0.3.0', fullName: 'VMware ESXi 8.0.3', build: 'LAB' }, host: prop('ha-host', 'HostSystem', { name: 'lab-host', summary: { managementServerIp: '192.0.2.2', hardware: { cpuMhz: '2000' }, quickStats: { overallCpuUsage: '0', overallMemoryUsage: '0', uptime: '0' } }, hardware: { systemInfo: { vendor: 'Lab', model: 'LabServer', uuid: 'LABUUID', otherIdentifyingInfo: { identifierType: { key: 'ServiceTag' }, identifierValue: 'LABSERIAL' } }, memorySize: '9007199254740993', cpuInfo: { numCpuPackages: '2', numCpuCores: '16', numCpuThreads: '32' } }, runtime: { inMaintenanceMode: 'false', healthSystemRuntime: { systemHealthInfo: { numericSensorInfo: { name: 'CPU1 Temp', sensorType: 'temperature', baseUnits: 'degrees C', unitModifier: '-2', currentReading: '3150', healthState: { key: 'green' } } } } }, 'config.network': { pnic: { device: 'vmnic0', mac: '02:00:00:00:00:01', linkSpeed: { speedMb: '10000', duplex: 'true' } }, vswitch: { name: 'vSwitch0', mtu: '1500', pnic: 'key-vim.host.PhysicalNic-vmnic0' }, portgroup: [{ key: 'pg1', spec: { name: 'lab', vlanId: '17', vswitchName: 'vSwitch0' } }, { key: 'pg2', spec: { name: 'trunk', vlanId: '4095', vswitchName: 'vSwitch0' } }, { key: 'pg3', spec: { name: 'native', vlanId: '0', vswitchName: 'vSwitch0' } }], vnic: { device: 'vmk0', portgroup: 'lab', spec: { ip: { dhcp: 'false', ipAddress: '192.0.2.1', subnetMask: '255.255.255.0' } } } }, 'config.storageDevice.scsiLun': { ScsiLun: { canonicalName: 'naa.lab', capacity: { block: '9007199254740993', blockSize: '512' } } } }), vms: [prop('vm-1', 'VirtualMachine', { name: 'lab-vm', summary: { config: { guestId: 'otherLinux64Guest' } }, 'config.uuid': 'LABVM', 'config.hardware.numCPU': '2', 'config.hardware.memoryMB': '4096', 'config.template': 'false', 'config.hardware.device': { VirtualDevice: [{ '@_xsi:type': 'VirtualVmxnet3', key: '4000', macAddress: '02:00:00:00:00:02', connectable: { connected: 'false' }, backing: { port: { switchUuid: 'LABDVS', portgroupKey: 'dvportgroup-1', portKey: '17' } } }, { '@_xsi:type': 'VirtualDisk', key: '2000', capacityInKB: '1048576', backing: { '@_xsi:type': 'VirtualDiskFlatVer2BackingInfo', datastore: moref('ds-1', 'Datastore'), thinProvisioned: 'false' } }] }, 'guest.net': { GuestNicInfo: { deviceConfigId: '4000', macAddress: '02:00:00:00:00:02', ipConfig: { ipAddress: [{ ipAddress: '192.0.2.17', prefixLength: '24' }, { ipAddress: '2001:db8::17', prefixLength: '64' }] } } }, 'snapshot.rootSnapshotList': { VirtualMachineSnapshotTree: { snapshot: moref('snap-1', 'VirtualMachineSnapshot'), name: 'lab', childSnapshotList: { snapshot: moref('snap-2', 'VirtualMachineSnapshot'), name: 'child' } } } })], datastores: [prop('ds-1', 'Datastore', { name: 'lab', summary: { type: 'VMFS', capacity: '9007199254740993', freeSpace: '0', accessible: 'false', multipleHostAccess: 'true' }, info: { vmfs: { uuid: 'LABVMFS', extent: { diskName: 'naa.lab', partition: '1' } } } })], warnings: [] }; }
test('vSphere: byte esatti oltre Number safe, false/zero conservati e VLAN 4095 trunk', () => { const v = parseVmwareInventory(fixture()); assert.equal(v.hardware.memory_bytes, '9007199254740993'); assert.equal(v.runtime.cpu_usage_mhz, 0); assert.equal(v.runtime.maintenance_mode, false); assert.equal(v.storage_devices[0].capacity_bytes, (BigInt('9007199254740993') * BigInt(512)).toString()); assert.equal(v.datastores[0].accessible, false); assert.equal(v.datastores[0].free_bytes, '0'); assert.equal(v.portgroups[1].vlan_mode, 'trunk'); assert.equal(v.portgroups[2].vlan_mode, 'untagged'); assert.equal(v.virtual_machines[0].disks[0].capacity_bytes, '1073741824'); assert.equal(v.virtual_machines[0].nics[0].connected, false); assert.equal(v.virtual_machines[0].nics[0].guest_addresses.length, 2); assert.equal(v.virtual_machines[0].snapshots[1].parent_ref, 'snap-1'); assert.equal(byteValue('1.5'), null); assert.equal(boolValue('unknown'), null); assert.equal(numberValue(''), null); });
test('vSphere collector: stato parziale esplicito, sensori scalati, niente VLAN 4095 come access', async () => { const request = { collector: 'vmware-esxi' as const, host: '192.0.2.1', api: { username: 'root', password: 'LABSECRET' } }; const raw = fixture(); raw.host.props.name = 'LABSECRET'; const s = await collectVmwareEsxi(request, async () => raw); assert.equal(s.status, 'partial'); assert.equal(s.identity.data?.hostname, '[REDACTED]'); assert.equal(s.sensors.data[0].value, 31.5); assert.equal(s.vlans.data.length, 1); assert.equal(s.vlans.data[0].id, 17); assert.equal(s.network.status, 'partial'); assert.equal(s.virtualization?.data.virtual_machines.length, 1); assert.equal(s.forwarding.status, 'skipped'); assert.equal(snapshotSchema.safeParse(s).success, true); });
test('vSphere collector: errore non stampa dettagli e nessuna VM vuota autorevole', async () => { const s = await collectVmwareEsxi({ collector: 'vmware-esxi', host: '192.0.2.1', api: { username: 'root', password: 'secret' } }, async () => { throw Error('token=secret'); }); assert.equal(s.status, 'error'); assert.equal(s.virtualization, undefined); assert.deepEqual(s.identity.warnings, ['API_COLLECTION_FAILED']); });
test('vSphere input: api obbligatoria e credenziali incompatibili respinte', () => { assert.equal(acquisitionInputSchema.safeParse({ collector: 'vmware-esxi', host: '192.0.2.1', ssh: { username: 'root', password: 'lab' } }).success, false); assert.equal(acquisitionInputSchema.safeParse({ collector: 'hp-comware', host: '192.0.2.1', api: { username: 'root', password: 'lab' } }).success, false); assert.equal(acquisitionInputSchema.safeParse({ collector: 'vmware-esxi', host: '192.0.2.1', api: { username: 'root', password: 'lab', tls_sha256: 'not-a-pin' } }).success, false); });
import { EventEmitter } from 'node:events';
import https from 'node:https';
import { acquireVsphere } from '../vsphere-transport';
const pin = Array(32).fill('AB').join(':');
function fakeApi(reply: (method: string, payload: string) => string, opts: {
    fingerprint?: string;
    hang?: boolean;
} = {}) {
    const calls: string[] = [], sent: string[] = [], requests: EventEmitter[] = [];
    const request = ((options: https.RequestOptions, callback: (response: unknown) => void) => {
        assert.equal(options.agent, false);
        const req = new EventEmitter() as EventEmitter & {
            end: (body: string) => void;
            destroy: () => void;
        };
        requests.push(req);
        req.destroy = () => { };
        req.end = body => {
            sent.push(body);
            const method = body.match(/<soapenv:Body><(\w+)/)?.[1] ?? '';
            calls.push(method);
            if (opts.hang)
                return;
            const response = new EventEmitter() as EventEmitter & {
                statusCode: number;
                headers: Record<string, unknown>;
            };
            response.statusCode = 200;
            response.headers = method === 'Login' ? { 'set-cookie': ['vmware_soap_session="LABSESSION"; HttpOnly'] } : {};
            queueMicrotask(() => { callback(response); const content = reply(method, body), data = Buffer.from(envelope(content)); response.emit('data', data.subarray(0, Math.floor(data.length / 2))); response.emit('data', data.subarray(Math.floor(data.length / 2))); response.emit('end'); });
        };
        queueMicrotask(() => {
            const socket = new EventEmitter() as EventEmitter & {
                getPeerCertificate: () => {
                    fingerprint256: string;
                };
            };
            socket.getPeerCertificate = () => ({ fingerprint256: opts.fingerprint ?? pin });
            req.emit('socket', socket);
            socket.emit('secureConnect');
        });
        return req;
    }) as unknown as typeof https.request;
    return { request, calls, sent, requests };
}
const service = '<RetrieveServiceContentResponse><returnval><about><apiType>HostAgent</apiType><apiVersion>8.0</apiVersion></about><sessionManager type="SessionManager">sm</sessionManager><propertyCollector type="PropertyCollector">pc</propertyCollector><searchIndex type="SearchIndex">si</searchIndex></returnval></RetrieveServiceContentResponse>';
function replyApi(method: string, body: string) {
    if (method === 'RetrieveServiceContent')
        return service;
    if (method === 'Login')
        return '<LoginResponse><returnval><key>LABSESSION</key></returnval></LoginResponse>';
    if (method === 'FindByIp')
        return '<FindByIpResponse><returnval type="HostSystem">ha-host</returnval></FindByIpResponse>';
    if (method === 'Logout')
        return '<LogoutResponse/>';
    if (method === 'RetrievePropertiesEx' && body.includes('<type>HostSystem</type>'))
        return '<RetrievePropertiesExResponse><returnval><objects><obj type="HostSystem">ha-host</obj><propSet><name>name</name><val>lab</val></propSet><propSet><name>vm</name><val><ManagedObjectReference type="VirtualMachine">vm-1</ManagedObjectReference><ManagedObjectReference type="VirtualMachine">vm-2</ManagedObjectReference></val></propSet></objects></returnval></RetrievePropertiesExResponse>';
    return '<RetrievePropertiesExResponse><returnval><objects><obj type="VirtualMachine">vm-1</obj><propSet><name>name</name><val>lab-vm</val></propSet></objects><token>page-2</token></returnval></RetrievePropertiesExResponse>';
}
const apiInput = () => acquisitionInputSchema.parse({ collector: 'vmware-esxi', host: '192.0.2.1', api: { username: 'root', password: 'a<&"\'', tls_sha256: pin } });
test('vSphere trasporto: sessione/cookie, paginazione e logout; password con caratteri XML', async () => { const fake = fakeApi((method, body) => method === 'ContinueRetrievePropertiesEx' ? '<ContinueRetrievePropertiesExResponse><returnval><objects><obj type="VirtualMachine">vm-2</obj></objects></returnval></ContinueRetrievePropertiesExResponse>' : replyApi(method, body)); const result = await acquireVsphere(apiInput(), fake.request); assert.equal(result.vms.length, 2); assert.equal(fake.calls.filter(m => m === 'Login').length, 1); assert.equal(fake.calls.at(-1), 'Logout'); assert.ok(fake.sent.find(b => b.includes('<password>a&lt;&amp;&quot;&apos;</password>'))); assert.deepEqual(result.warnings, []); });
test('vSphere trasporto: impronta diversa blocca prima di inviare richiesta o credenziali', async () => { const fake = fakeApi(replyApi, { fingerprint: Array(32).fill('CD').join(':') }); await assert.rejects(acquireVsphere(apiInput(), fake.request), /API_TLS_FINGERPRINT_MISMATCH/); assert.equal(fake.sent.length, 0); });
test('vSphere trasporto: fault dopo login provoca logout; vCenter rifiutato prima del login', async () => { const fake = fakeApi((method, body) => method === 'FindByIp' ? '<soap:Fault><faultstring>private</faultstring></soap:Fault>' : replyApi(method, body)); await assert.rejects(acquireVsphere(apiInput(), fake.request), /API_SOAP_FAULT/); assert.equal(fake.calls.at(-1), 'Logout'); const vc = fakeApi(() => service.replace('HostAgent', 'VirtualCenter')); await assert.rejects(acquireVsphere(apiInput(), vc.request), /API_TARGET_NOT_ESXI/); assert.deepEqual(vc.calls, ['RetrieveServiceContent']); });
test('vSphere trasporto: limite byte e timeout assoluto anche con risposta assente', async () => { const fake = fakeApi(() => '<RetrieveServiceContentResponse>' + 'x'.repeat(5000) + '</RetrieveServiceContentResponse>'); const input = apiInput(); input.limits.max_output_bytes = 4096; await assert.rejects(acquireVsphere(input, fake.request), /API_OUTPUT_LIMIT/); const hung = fakeApi(replyApi, { hang: true }); input.limits.timeout_ms = 20; await assert.rejects(acquireVsphere(input, hung.request), /API_TIMEOUT/); });
test('vSphere: riferimenti pNIC risolti tramite key, route come array diretto e nome rete guest distinto da MoRef', () => { const raw = fixture(); const net = object(raw.host.props['config.network']); object(net.pnic).key = 'key-vim.host.PhysicalNic-vmnic0'; net.routeTableInfo = { ipRoute: [{ network: '192.0.2.0', prefixLength: '24', gateway: '0.0.0.0', deviceName: 'vmk0' }], ipv6Route: [{ network: '2001:db8::', prefixLength: '64', gateway: '::', deviceName: 'vmk0' }] }; object(object(raw.vms[0].props['guest.net']).GuestNicInfo).network = 'guest-portgroup-name'; const v = parseVmwareInventory(raw); assert.deepEqual(v.vswitches[0].physical_nics, ['vmnic0']); assert.equal(v.routes.length, 2); assert.equal(v.routes[1].prefix_length, 64); assert.equal(v.virtual_machines[0].guest_networks[0].network_name, 'guest-portgroup-name'); assert.equal(v.virtual_machines[0].guest_networks[0].device_key, 4000); });

test('vSphere: segreto uguale a un enum non rompe il contratto, ma nomi liberi restano oscurati',async()=>{const raw=fixture();raw.host.props.name='lab-host';const s=await collectVmwareEsxi({collector:'vmware-esxi',host:'192.0.2.1',api:{username:'root',password:'host'}},async()=>raw);assert.equal(s.virtualization?.data.scope,'host');assert.equal(s.identity.data?.hostname,'lab-[REDACTED]');assert.equal(snapshotSchema.safeParse(s).success,true);});
