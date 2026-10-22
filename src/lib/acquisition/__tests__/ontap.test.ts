import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import https from 'node:https';
import { ONTAP_ENDPOINTS, parseOntapJson, ontapNextPath, acquireOntap } from '../ontap-transport';
import type { OntapInventory } from '../ontap-transport';
import { parseOntapInventory } from '../ontap-parsers';
import { collectNetappOntap } from '../netapp-ontap';
import { acquisitionInputSchema, snapshotSchema } from '../schema';
const pin = Array(32).fill('AB').join(':');
const input = () => acquisitionInputSchema.parse({ collector: 'netapp-ontap', host: '192.0.2.1', api: { username: 'readonly', password: 'LABSECRET', tls_sha256: pin } });
function fixture(): OntapInventory { const raw = Object.fromEntries(Object.keys(ONTAP_ENDPOINTS).map(k => [k, { status: 'ok', data: [], warnings: [] }])) as unknown as OntapInventory; raw.cluster.data = [{ uuid: 'cluster-1', name: 'LABSECRET', version: { full: 'NetApp Release 9.16.1' } }]; raw.nodes.data = [{ uuid: 'node-1', name: 'lab', model: 'AFF-LAB', uptime: 0, ha: { enabled: false, partners: [{ uuid: 'node-2', name: 'partner' }], takeover: { state: 'not_in_takeover' } } }]; raw.metrocluster.data = [{ configuration_type: 'ip_fabric', local: { cluster: { uuid: 'cluster-1' }, mode: 'normal', configuration_state: 'configured' }, remote: { cluster: { uuid: 'cluster-2' }, mode: 'normal', configuration_state: 'configured' } }]; raw.volumes.data = [{ uuid: 'vol-1', name: 'lab', svm: { uuid: 'svm-1' }, nas: { path: '/lab', export_policy: { id: 0, name: 'lab' } }, space: { size: '9007199254740993', used: 0, available: '1000', logical_space: { used: 0 } } }]; raw.luns.data = [{ uuid: 'lun-1', name: '/vol/lab/lun', svm: { uuid: 'svm-1' }, location: { volume: { uuid: 'vol-1' } }, enabled: false, status: { mapped: false }, space: { size: 1073741824, used: 0 } }]; raw.ethernet.data = [{ uuid: 'p-1', name: 'e0a', node: { uuid: 'node-1' }, type: 'physical', enabled: true, state: 'up', speed: 25000, mtu: 9000 }]; raw.ip.data = [{ uuid: 'lif-1', ip: { address: '192.0.2.1', netmask: '24', family: 'ipv4' }, location: { is_home: false, node: { uuid: 'node-2' }, home_node: { uuid: 'node-1' } } }]; return raw; }
test('ONTAP JSON: interi oltre 2^53 mantengono il token esatto; zero/false non spariscono', () => { const x = parseOntapJson('{"size":9007199254740993,"zero":0,"enabled":false,"metric":1.5}'); assert.equal(x.size, '9007199254740993'); assert.equal(x.zero, 0); assert.equal(x.enabled, false); assert.equal(x.metric, 1.5); assert.throws(() => parseOntapJson('{broken}')); });
test('ONTAP: next link può restare solo sullo stesso endpoint HTTPS', () => {
    assert.equal(ontapNextPath('/api/storage/volumes?start.uuid=lab', 'https://192.0.2.1:443', '/api/storage/volumes?fields=*'), '/api/storage/volumes?start.uuid=lab');
    for (const href of ['https://example.test/api/storage/volumes', 'http://192.0.2.1/api/storage/volumes', '/api/security/accounts', '//example.test/api/storage/volumes', 'https://root:pass@192.0.2.1/api/storage/volumes'])
        assert.throws(() => ontapNextPath(href, 'https://192.0.2.1', '/api/storage/volumes'), /REST_NEXT_LINK_REJECTED/);
});
test('ONTAP parser: cluster diverso dai nodi, UUID relazionali, LIF migrata e spazio esatto', () => { const x = parseOntapInventory(fixture()); assert.equal(x.cluster_uuid, 'cluster-1'); assert.equal(x.nodes.data[0].ha_enabled, false); assert.equal(x.nodes.data[0].uptime_seconds, 0); assert.equal(x.metrocluster.data[0].remote_cluster.uuid, 'cluster-2'); assert.equal(x.volumes.data[0].size_bytes, '9007199254740993'); assert.equal(x.volumes.data[0].used_bytes, '0'); assert.equal(x.volumes.data[0].export_policy_id, '0'); assert.equal(x.luns.data[0].volume.uuid, 'vol-1'); assert.equal(x.luns.data[0].enabled, false); assert.equal(x.ip_interfaces.data[0].current_node.uuid, 'node-2'); assert.equal(x.ip_interfaces.data[0].is_home, false); });
test('ONTAP collector: errore per sottosezione resta visibile; cluster non diventa chassis', async () => { const raw = fixture(); raw.disks = { status: 'error', data: [], warnings: ['REST_HTTP_403'] }; const s = await collectNetappOntap(input(), async () => raw); assert.equal(s.identity.data?.hostname, '[REDACTED]'); assert.equal(s.identity.data?.serial_number, null); assert.equal(s.storage?.status, 'partial'); assert.equal(s.storage?.data.disks.status, 'error'); assert.equal(s.interfaces.data[0].speed_bps, 25000000000); assert.equal(s.network.status, 'partial'); assert.equal(snapshotSchema.safeParse(s).success, true); });
function fakeApi(reply: (path: string) => {
    status?: number;
    body?: unknown;
    raw?: string;
}, certificate = pin) {
    const calls: string[] = [], auth: string[] = [];
    const request = ((opts: https.RequestOptions, cb: (r: unknown) => void) => {
        const req = new EventEmitter() as EventEmitter & {
            destroy: () => void;
            setHeader: (k: string, v: string) => void;
            end: () => void;
        };
        req.destroy = () => { };
        req.setHeader = (k, v) => {
            if (k === 'Authorization')
                auth.push(v);
        };
        req.end = () => {
            const path = String(opts.path);
            calls.push(path);
            const response = new EventEmitter() as EventEmitter & {
                statusCode: number;
            };
            const r = reply(path);
            response.statusCode = r.status ?? 200;
            queueMicrotask(() => { cb(response); response.emit('data', Buffer.from(r.raw ?? JSON.stringify(r.body ?? {}))); response.emit('end'); });
        };
        queueMicrotask(() => {
            const socket = new EventEmitter() as EventEmitter & {
                getPeerCertificate: () => {
                    fingerprint256: string;
                };
            };
            socket.getPeerCertificate = () => ({ fingerprint256: certificate });
            req.emit('socket', socket);
            socket.emit('secureConnect');
        });
        return req;
    }) as unknown as typeof https.request;
    return { request, calls, auth };
}
const empty = (path: string) => path.startsWith('/api/cluster?') ? { body: { uuid: 'cluster-1', name: 'lab', version: { full: 'NetApp Release 9.16.1' } } } : path === '/api/cluster/metrocluster' ? { body: { configuration_type: 'ip_fabric' } } : { body: { records: [], num_records: 0 } };
test('ONTAP trasporto: GET paginati, conteggi verificati e nessun redirect', async () => { const f = fakeApi(path => path.startsWith('/api/storage/volumes?fields=') ? { body: { records: [{ uuid: 'v1' }], num_records: 1, _links: { next: { href: '/api/storage/volumes?start.uuid=v1' } } } } : path.includes('start.uuid=') ? { body: { records: [{ uuid: 'v2' }], num_records: 1 } } : empty(path)); const x = await acquireOntap(input(), f.request); assert.equal(x.volumes.data.length, 2); assert.equal(x.volumes.status, 'ok'); assert.equal(f.calls.length, Object.keys(ONTAP_ENDPOINTS).length + 1); assert.equal(f.auth.length, f.calls.length); });
test('ONTAP trasporto: mismatch TLS ferma prima di Basic auth; 401 non viene ritentato', async () => { const f = fakeApi(empty, Array(32).fill('CD').join(':')); const x = await acquireOntap(input(), f.request); assert.equal(f.auth.length, 0); assert.equal(f.calls.length, 0); assert.equal(x.cluster.status, 'error'); const denied = fakeApi(() => ({ status: 401 })); await acquireOntap(input(), denied.request); assert.equal(denied.calls.length, 1); });
test('ONTAP trasporto: 403 e 404 distinti da collezione vuota valida', async () => { const f = fakeApi(path => path.startsWith('/api/storage/disks?') ? { status: 403 } : path.startsWith('/api/cluster/metrocluster/nodes?') ? { status: 404 } : empty(path)); const x = await acquireOntap(input(), f.request); assert.equal(x.disks.status, 'error'); assert.equal(x.metro_nodes.status, 'unsupported'); assert.equal(x.fc.status, 'ok'); assert.deepEqual(x.fc.data, []); });
test('ONTAP trasporto: conteggio incongruente e paginazione esterna non sono successi', async () => { const f = fakeApi(path => path.startsWith('/api/storage/volumes?') ? { body: { records: [{ uuid: 'v1' }], num_records: 2 } } : empty(path)); assert.equal((await acquireOntap(input(), f.request)).volumes.status, 'error'); const external = fakeApi(path => path.startsWith('/api/storage/volumes?') ? { body: { records: [{ uuid: 'v1' }], num_records: 1, _links: { next: { href: 'https://example.test/api/storage/volumes' } } } } : empty(path)); const x = await acquireOntap(input(), external.request); assert.equal(x.volumes.status, 'partial'); assert.equal(x.volumes.data.length, 1); assert.ok(x.volumes.warnings.includes('REST_NEXT_LINK_REJECTED')); });
test('ONTAP: mirror interconnect è oggetto con stato/abilitazione; FRU mantiene part number e firmware', () => { const r = fixture(); r.metro_connections.data = [{ mirror: { state: 'normal', enabled: false } }]; r.shelves.data = [{ frus: [{ type: 'psu', part_number: 'LABPART', firmware_version: 'LABFW', installed: false }] }]; const s = parseOntapInventory(r); assert.equal(s.metro_connections.data[0].mirror_enabled, false); assert.equal(s.metro_connections.data[0].mirror_state, 'normal'); assert.equal(s.shelves.data[0].frus[0].part_number, 'LABPART'); assert.equal(s.shelves.data[0].frus[0].installed, false); });
